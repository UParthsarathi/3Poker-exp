import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, Player, CardData, GamePhase, GameMode } from './types';
import { createDeck, getRoundScores, decideBotAction, shuffleDeck } from './services/gameLogic';
import { createRoom, joinRoom, subscribeToRoom, updateGameState, getRoomData, resetRoomToLobby } from './services/online';
import { BOT_NAMES } from './constants';
import Auth from './components/Auth';
import { supabase, signOut } from './services/supabase';
import { createInitialGameState } from './state/initialState';
import { useRoundInput } from './state/useRoundInput';
import { LoadingScreen } from './components/ui';
import Transition from './screens/Transition';
import OnlineSelect from './screens/OnlineSelect';
import RoundSelect from './screens/RoundSelect';
import NameEntry from './screens/NameEntry';
import Lobby from './screens/Lobby';
import MainMenu from './screens/MainMenu';
import GameTable from './screens/GameTable';

const SESSION_KEY = 'TRI_STACK_SESSION';
const NAME_KEY = 'TRI_STACK_PLAYER_NAME';

const App: React.FC = () => {
  // --- Auth State ---
  const [session, setSession] = useState<any>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  // --- Game State ---
  const [gameState, setGameState] = useState<GameState>(createInitialGameState);

  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  // Local Multiplayer: Hides the screen between turns
  const [isTransitioning, setIsTransitioning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Menu State
  const [showMultiplayerSelection, setShowMultiplayerSelection] = useState(false);
  const [showOnlineSelection, setShowOnlineSelection] = useState(false); // New: Online Menu
  const [showRoundSelectionSP, setShowRoundSelectionSP] = useState(false);
  const [setupPlayerCount, setSetupPlayerCount] = useState(4);
  
  // Round Selection State (Decoupled for better UX)
  // Named roundInput, not rounds: startSinglePlayerMatch takes a `rounds: number`
  // parameter that would otherwise shadow it.
  const roundInput = useRoundInput();
  const { selectedTotalRounds, setSelectedTotalRounds } = roundInput;

  const [isNameEntryStep, setIsNameEntryStep] = useState(false);
  const [customPlayerNames, setCustomPlayerNames] = useState<string[]>([]);

  // User Customization
  const [customDisplayName, setCustomDisplayName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);

  // Online Specific State
  const [roomCode, setRoomCode] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [myOnlineId, setMyOnlineId] = useState<number | null>(null); // Who am I?
  const [onlineHostId, setOnlineHostId] = useState<number>(0); // Who is the host?
  const [onlineLobbyPlayers, setOnlineLobbyPlayers] = useState<{id: number, name: string}[]>([]);
  const [isOnlineLobby, setIsOnlineLobby] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false); // Visual indicator for online ops
  const [isReconnecting, setIsReconnecting] = useState(false); // Loading state for refresh logic
  const [isJoining, setIsJoining] = useState(false); // Prevent double-join clicks
  
  // Exit Confirmation State
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // --- Auth Effect ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    }).catch((err) => {
      console.warn("Supabase auth check failed:", err);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // --- Load Custom Name ---
  useEffect(() => {
    const savedName = localStorage.getItem(NAME_KEY);
    if (savedName) setCustomDisplayName(savedName);
  }, []);

  const getDisplayName = () => {
    if (customDisplayName) return customDisplayName;
    return isGuest ? 'Guest' : (session?.user?.email?.split('@')[0] || 'Player');
  };

  const saveCustomName = () => {
    if (customDisplayName.trim()) {
      localStorage.setItem(NAME_KEY, customDisplayName);
      setIsEditingName(false);
    }
  };

  // --- Reconnection Logic (Check LocalStorage) ---
  useEffect(() => {
    const checkSession = async () => {
      const savedSession = localStorage.getItem(SESSION_KEY);
      if (savedSession) {
        try {
          setIsReconnecting(true);
          const { code, playerId } = JSON.parse(savedSession);
          
          // Verify room still exists and fetch state
          const { data: roomData, error } = await getRoomData(code);
          
          if (error || !roomData) {
             // Session invalid (room deleted?), clear it
             console.warn("Session invalid, clearing.");
             localStorage.removeItem(SESSION_KEY);
             setIsReconnecting(false);
             return;
          }

          // Restore Session Data
          setRoomCode(code);
          setMyOnlineId(playerId);
          const currentHostId = parseInt(roomData.host_id, 10);
          setOnlineHostId(currentHostId);
          
          // CRITICAL FIX: Bypass Auth Guard for reconnected user
          setIsGuest(true);

          if (roomData.status === 'WAITING') {
            setOnlineLobbyPlayers(roomData.players || []);
            setIsOnlineLobby(true); // Ensure we land in lobby
            setGameState(prev => ({ ...prev, gameMode: (playerId === currentHostId ? 'ONLINE_HOST' : 'ONLINE_CLIENT') as GameMode }));
          } else {
             // Game is in progress
             if (roomData.game_state) {
               const effectiveMode = (playerId === currentHostId ? 'ONLINE_HOST' : 'ONLINE_CLIENT') as GameMode;
               setGameState({
                 ...roomData.game_state,
                 gameMode: effectiveMode
               });
               setIsOnlineLobby(false);
             }
          }
        } catch (e) {
          console.error("Reconnection failed", e);
          localStorage.removeItem(SESSION_KEY);
        } finally {
          setIsReconnecting(false);
        }
      }
    };

    checkSession();
  }, []);

  // --- Online Subscription Effect ---
  useEffect(() => {
    if (!roomCode) return;

    // Subscribe to changes in the room
    const subscription = subscribeToRoom(roomCode, (roomData) => {
      const currentHostId = parseInt(roomData.host_id, 10);
      setOnlineHostId(currentHostId);

      // 1. Lobby Updates (Waiting phase)
      if (roomData.status === 'WAITING') {
         setOnlineLobbyPlayers(roomData.players || []);
         
         setIsOnlineLobby(true);
         
         setGameState(prev => {
            // If we were playing but room went back to waiting (Host clicked Return to Lobby)
            if (prev.gameMode) {
               const mode = myOnlineId === currentHostId ? 'ONLINE_HOST' : 'ONLINE_CLIENT';
               if (prev.gameMode !== mode) {
                 return { ...prev, gameMode: mode as GameMode };
               }
            }
            return prev;
         });
      }
      // 2. Game Updates (Playing phase)
      else if (roomData.status === 'PLAYING' || roomData.status === 'FINISHED') {
         // Force the game state from server to local
         if (roomData.game_state) {
           // CRITICAL FIX: Determine correct local mode
           // Even if server says "ONLINE_HOST", if I am not the host, I treat it as CLIENT locally
           // This ensures the UI renders correctly (e.g. Next Round button hidden)
           const effectiveMode = (myOnlineId === currentHostId ? 'ONLINE_HOST' : 'ONLINE_CLIENT') as GameMode;
           
           setGameState(prev => ({
             ...roomData.game_state,
             gameMode: effectiveMode
           }));
           
           setIsOnlineLobby(false); // Game started, exit lobby view
           setIsNameEntryStep(false); // Cleanup
           setShowOnlineSelection(false); // Cleanup
           setIsSyncing(false); // Update received, sync complete
         }
      }
    });

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [roomCode, myOnlineId]);

  // --- Helper to Push State Online ---
  const syncOnlineState = async (newState: GameState) => {
    // Only sync if we have a room code and are in an online mode
    if ((gameState.gameMode === 'ONLINE_HOST' || gameState.gameMode === 'ONLINE_CLIENT') && roomCode) {
       setIsSyncing(true);
       await updateGameState(roomCode, newState);
    }
  };

  // --- Helper to Manage Session ---
  const saveSession = (code: string, playerId: number) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ code, playerId }));
  };

  const clearSession = () => {
    // 1. Leave Room in DB (Ghost Player Fix)
    if (gameState.gameMode === 'ONLINE_HOST' || gameState.gameMode === 'ONLINE_CLIENT' || roomCode) {
       if (myOnlineId !== null && roomCode) {
          // Fire and forget - attempting to remove player from DB
          // We import leaveRoom from services/online inside the component logic scope
          import('./services/online').then(({ leaveRoom }) => {
             leaveRoom(roomCode, myOnlineId!);
          });
       }
    }

    // 2. Clear Persistence
    localStorage.removeItem(SESSION_KEY);
    
    // 3. Reset Online State
    setRoomCode('');
    setMyOnlineId(null);
    setOnlineLobbyPlayers([]);
    setIsOnlineLobby(false);
    
    // 4. Reset Game State to Defaults (Soft Reset)
    setGameState(createInitialGameState());
    
    // 5. Reset UI States
    setSelectedCardIds([]);
    setIsTransitioning(false);
    setIsNameEntryStep(false);
    setShowMultiplayerSelection(false);
    setShowOnlineSelection(false);
    setShowRoundSelectionSP(false);
    setShowExitConfirm(false);
    setIsSyncing(false);
    setIsReconnecting(false);
    setIsJoining(false);
  };

  const handleSignOut = () => {
     clearSession();
     signOut();
  };

  // --- Helpers ---
  // ROBUST FALLBACK: If players array is empty, provide a dummy object to prevent crashes
  const currentPlayer = gameState.players[gameState.currentPlayerIndex] || { id: -1, name: 'Loading', isBot: false, hand: [], score: 0, totalScore: 0, lastAction: '' };
  
  // Perspective Logic
  // Single Player: Human (Player 0) is ALWAYS at bottom.
  // Local Multiplayer: Current Player is ALWAYS at bottom (Hotseat).
  // Online: 'myOnlineId' player is ALWAYS at bottom.
  let bottomPlayer = currentPlayer;
  let opponentsToRender = gameState.players.filter(p => p.id !== currentPlayer.id);

  if (gameState.gameMode === 'SINGLE_PLAYER' && gameState.players.length > 0) {
    bottomPlayer = gameState.players[0]; // Human
    opponentsToRender = gameState.players.filter(p => p.id !== 0); // Bots
  } else if ((gameState.gameMode === 'ONLINE_HOST' || gameState.gameMode === 'ONLINE_CLIENT') && myOnlineId !== null) {
    // Online: I am the bottom player
    bottomPlayer = gameState.players.find(p => p.id === myOnlineId) || currentPlayer;
    opponentsToRender = gameState.players.filter(p => p.id !== myOnlineId);
  }

  // Turn Logic
  // Online: It's my turn ONLY if currentPlayer.id === myOnlineId
  const isMyTurnOnline = (gameState.gameMode === 'ONLINE_HOST' || gameState.gameMode === 'ONLINE_CLIENT') 
      ? currentPlayer.id === myOnlineId 
      : true; // In local, it's always "my" turn if I'm holding the device

  const isPlayerTurn = !isTransitioning 
      && !currentPlayer.isBot 
      && gameState.phase !== GamePhase.ROUND_END 
      && gameState.phase !== GamePhase.MATCH_END
      && isMyTurnOnline; // Added check for online

  const isBotThinking = gameState.gameMode === 'SINGLE_PLAYER' && currentPlayer.isBot && !isTransitioning && gameState.phase !== GamePhase.ROUND_END;
  
  // Auto-scroll log
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [gameState.turnLog]);

  // --- ONLINE SETUP ---
  const handleCreateOnlineGame = async () => {
    const hostName = getDisplayName();
    const { code, error } = await createRoom(hostName, session?.user?.id || 'guest');
    
    if (error) {
      alert("Error creating room: " + (error.message || 'Check your connection'));
      return;
    }

    setRoomCode(code);
    setMyOnlineId(0); // Host is always ID 0
    saveSession(code, 0); // PERSIST SESSION
    
    setOnlineLobbyPlayers([{ id: 0, name: hostName }]);
    setIsOnlineLobby(true);
    setGameState(prev => ({ ...prev, gameMode: 'ONLINE_HOST' })); // Temporary mode until start
    // Removed forced reset to 5 here to respect user choice
  };

  const handleJoinOnlineGame = async () => {
    if (isJoining) return; // Prevent double clicks
    if (joinCodeInput.length !== 4) return alert("Enter a 4-letter code");
    
    setIsJoining(true);
    const myName = getDisplayName();
    
    const { success, error, playerId, players } = await joinRoom(joinCodeInput.toUpperCase(), myName);
    
    if (!success) {
      alert(error);
      setIsJoining(false);
      return;
    }

    const code = joinCodeInput.toUpperCase();
    setRoomCode(code);
    setMyOnlineId(playerId!);
    saveSession(code, playerId!); // PERSIST SESSION

    setOnlineLobbyPlayers(players!);
    setIsOnlineLobby(true);
    setGameState(prev => ({ ...prev, gameMode: 'ONLINE_CLIENT' }));
    setIsJoining(false);
  };

  const startOnlineGame = () => {
     // Triggered by Host in Lobby
     if (onlineLobbyPlayers.length < 2) return;

     // Create the player objects from the lobby list
     const players: Player[] = onlineLobbyPlayers.map(p => ({
        id: p.id,
        name: p.name,
        isBot: false,
        hand: [],
        score: 0,
        totalScore: 0,
        lastAction: 'Joined'
     }));

     // Call startRound with specific mode
     startRound(1, players, 'ONLINE_HOST');
  };

  const handleReturnToLobby = async () => {
    if (roomCode) {
      await resetRoomToLobby(roomCode);
      // The subscription will detect the 'WAITING' status and switch UI
    }
  };

  const handleKickPlayer = async (playerId: number) => {
    import('./services/online').then(({ leaveRoom }) => {
      leaveRoom(roomCode, playerId);
    });
  };

  // --- LOCAL SETUP FLOWS ---
  const openSinglePlayerSetup = () => {
    setShowRoundSelectionSP(true);
    // Removed forced reset to 5 here to respect user choice
  };

  const startSinglePlayerMatch = (rounds: number) => {
    setSelectedTotalRounds(rounds);
    const playerName = getDisplayName();
    
    // Pick 3 random names from the pool for bots
    const shuffledPool = shuffleDeck([...BOT_NAMES].map((name, idx) => ({ id: `bot-name-${idx}`, name } as unknown as CardData)));
    const selectedBotNames = (shuffledPool as any[]).slice(0, 3).map(item => "Bot " + item.name);
    
    const names = [playerName, ...selectedBotNames];
    
    setGameState(prev => ({
      ...prev,
      gameMode: 'SINGLE_PLAYER',
      playerNames: names,
      phase: GamePhase.SETUP
    }));
    setShowRoundSelectionSP(false);
  };

  const initMultiplayerSetup = (count: number) => {
    setSetupPlayerCount(count);
    // Removed forced reset to 5 here to respect user choice
    setCustomPlayerNames(Array.from({ length: count }, (_, i) => `Player ${i + 1}`));
    setIsNameEntryStep(true);
  };

  const finalizeMultiplayerStart = () => {
    setGameState(prev => ({
      ...prev,
      gameMode: 'MULTIPLAYER',
      playerNames: customPlayerNames,
      phase: GamePhase.SETUP
    }));
    setIsNameEntryStep(false);
  };

  // --- Game Loop: Start Round ---
  const startRound = useCallback((roundNum: number, existingPlayers?: Player[], mode?: GameMode) => {
    const newDeck = createDeck();
    const jokerIndex = Math.floor(Math.random() * newDeck.length);
    const roundJoker = { ...newDeck[jokerIndex] };
    
    let players: Player[] = [];
    let startingPlayerIndex = 0; // Default to host/player 0
    let startLog = `Round ${roundNum} started! Joker is ${roundJoker.rank}`;

    if (existingPlayers) {
      // LOGIC: The player who was the CALLER in the previous round starts.
      const caller = existingPlayers.find(p => p.wasCaller);

      if (caller) {
        startingPlayerIndex = caller.id;
        startLog = `Round ${roundNum} started! ${caller.name} called SHOW last round and will start this round.`;
      }

      players = existingPlayers.map(p => ({ 
        ...p, 
        hand: [], 
        score: 0,
        totalScore: p.totalScore || 0,
        lastAction: 'Waiting...',
        wasCaller: false // Reset flag for new round
      }));
    } else {
      // New Game Local Logic (SP or MP)
      if (mode === 'SINGLE_PLAYER') {
        const names = gameState.playerNames.length > 0 ? gameState.playerNames : [getDisplayName(), 'Bot Alpha', 'Bot Beta', 'Bot Gamma'];
        players = [
          { id: 0, name: names[0], isBot: false, hand: [], score: 0, totalScore: 0, lastAction: 'Waiting...' },
          { id: 1, name: names[1], isBot: true, hand: [], score: 0, totalScore: 0, lastAction: 'Waiting...' },
          { id: 2, name: names[2], isBot: true, hand: [], score: 0, totalScore: 0, lastAction: 'Waiting...' },
          { id: 3, name: names[3], isBot: true, hand: [], score: 0, totalScore: 0, lastAction: 'Waiting...' }
        ];
      } else if (mode === 'MULTIPLAYER') {
        const count = setupPlayerCount > 0 ? setupPlayerCount : 4;
        const names = gameState.playerNames.length > 0 ? gameState.playerNames : Array.from({ length: count }, (_, i) => `Player ${i + 1}`);
        players = Array.from({ length: count }, (_, i) => ({
          id: i, name: names[i], isBot: false, hand: [], score: 0, totalScore: 0, lastAction: 'Waiting...'
        }));
      }
    }

    // Deal cards
    players.forEach(p => {
      p.hand = newDeck.splice(0, 3);
    });

    const newState: GameState = {
      ...gameState, // Keep previous settings
      deck: newDeck,
      openDeck: [],
      players,
      currentPlayerIndex: startingPlayerIndex, 
      roundJoker,
      roundNumber: roundNum,
      totalRounds: roundNum === 1 ? selectedTotalRounds : gameState.totalRounds,
      phase: GamePhase.PLAYER_TURN_START,
      turnLog: [startLog],
      winner: null,
      lastDiscardedId: null,
      tossedThisTurn: false,
      pendingDiscard: null,
      pendingToss: [],
      gameMode: (mode || gameState.gameMode) as GameMode 
    };

    setGameState(newState);
    
    // IF ONLINE HOST: PUSH STATE
    if (mode === 'ONLINE_HOST' || gameState.gameMode === 'ONLINE_HOST') {
      updateGameState(roomCode, newState);
    }

    setSelectedCardIds([]);
    setIsTransitioning(!!(mode === 'MULTIPLAYER' || (existingPlayers && gameState.gameMode === 'MULTIPLAYER')));
  }, [gameState.gameMode, setupPlayerCount, gameState.playerNames, selectedTotalRounds, roomCode, gameState, getDisplayName]);

  // Initialize Local Games
  useEffect(() => {
    if (gameState.phase === GamePhase.SETUP && gameState.gameMode && gameState.gameMode !== 'ONLINE_HOST' && gameState.gameMode !== 'ONLINE_CLIENT') {
      startRound(1, undefined, gameState.gameMode);
    }
  }, [gameState.phase, gameState.gameMode, startRound]);


  // --- BOT LOGIC ---
  useEffect(() => {
    if (!isBotThinking) return;

    const timeout = setTimeout(() => {
      const p = currentPlayer;
      let newState = { ...gameState };

      if (gameState.phase === GamePhase.PLAYER_TURN_START) {
        const action = decideBotAction(p, gameState.roundJoker, gameState.tossedThisTurn);
        if (action.type === 'SHOW') {
           const results = getRoundScores(gameState.players, gameState.currentPlayerIndex, gameState.roundJoker);
           const updatedPlayers = gameState.players.map(pl => {
             const roundRes = results.find(r => r.playerId === pl.id);
             return { 
                ...pl, 
                score: roundRes?.roundScore || 0, 
                totalScore: (pl.totalScore || 0) + (roundRes?.roundScore || 0),
                wasCaller: pl.id === p.id 
             };
           });
           newState = { ...newState, players: updatedPlayers, phase: GamePhase.ROUND_END };
        } else if (action.type === 'TOSS' && action.cardIds) {
          const tossedCards = p.hand.filter(c => action.cardIds?.includes(c.id));
          const newHand = p.hand.filter(c => !action.cardIds?.includes(c.id));
          newState = {
            ...newState,
            players: newState.players.map(pl => pl.id === p.id ? { ...pl, hand: newHand } : pl),
            pendingToss: tossedCards,
            phase: GamePhase.PLAYER_TOSSING_DRAW,
            tossedThisTurn: true
          };
        } else if (action.type === 'DISCARD' && action.cardIds) {
          const cardToDiscard = p.hand.find(c => c.id === action.cardIds![0])!;
          const newHand = p.hand.filter(c => c.id !== cardToDiscard.id);
          newState = {
            ...newState,
            players: newState.players.map(pl => pl.id === p.id ? { ...pl, hand: newHand } : pl),
            pendingDiscard: cardToDiscard,
            lastDiscardedId: cardToDiscard.id,
            phase: GamePhase.PLAYER_DRAW
          };
        }
      } 
      else if (gameState.phase === GamePhase.PLAYER_DRAW || gameState.phase === GamePhase.PLAYER_TOSSING_DRAW) {
        let deckToDrawFrom = newState.deck;
        let openDeckForRecycle = newState.openDeck;
        
        if (deckToDrawFrom.length === 0) {
           if (openDeckForRecycle.length > 1) {
              const topCard = openDeckForRecycle.pop()!;
              const recycled = shuffleDeck([...openDeckForRecycle]);
              deckToDrawFrom = recycled;
              openDeckForRecycle = [topCard];
              newState.deck = deckToDrawFrom;
              newState.openDeck = openDeckForRecycle;
           } else {
             return;
           }
        }
        
        const drawn = newState.deck.shift()!;
        newState.players = newState.players.map(pl => pl.id === p.id ? { ...pl, hand: [...pl.hand, drawn] } : pl);
        
        if (newState.pendingToss.length) newState.openDeck = [...newState.openDeck, ...newState.pendingToss];
        if (newState.pendingDiscard) newState.openDeck = [...newState.openDeck, newState.pendingDiscard];
        
        newState.pendingToss = [];
        newState.pendingDiscard = null;
        newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % newState.players.length;
        newState.phase = GamePhase.PLAYER_TURN_START;
        newState.tossedThisTurn = false;
        newState.lastDiscardedId = null;
      }

      setGameState(newState);
    }, 1500); 

    return () => clearTimeout(timeout);
  }, [gameState.phase, gameState.currentPlayerIndex, isBotThinking, gameState.players, gameState.deck, gameState.openDeck, gameState.roundJoker, gameState.tossedThisTurn, currentPlayer]);


  // --- Actions ---

  const handleCardClick = (card: CardData) => {
    if (!isPlayerTurn) return;

    if (gameState.phase === GamePhase.PLAYER_TURN_START) {
      setSelectedCardIds(prev => {
        if (prev.includes(card.id)) return prev.filter(id => id !== card.id);
        if (prev.length >= 2) return [prev[1], card.id]; 
        return [...prev, card.id];
      });
    }
  };

  const handleToss = () => {
    if (selectedCardIds.length !== 2) return;
    if (gameState.tossedThisTurn) return;
    
    const p = currentPlayer;
    const cards = p.hand.filter(c => selectedCardIds.includes(c.id));
    
    if (cards[0].rank !== cards[1].rank) {
      alert("Must toss a pair of the same rank!");
      return;
    }

    const newHand = p.hand.filter(c => !selectedCardIds.includes(c.id));
    
    const newState = {
      ...gameState,
      players: gameState.players.map(pl => pl.id === p.id ? { ...pl, hand: newHand, lastAction: `Tossed ${cards[0].rank}s` } : pl),
      pendingToss: cards,
      phase: GamePhase.PLAYER_TOSSING_DRAW,
      tossedThisTurn: true,
      turnLog: [...gameState.turnLog, `${p.name} tossed a pair of ${cards[0].rank}s`]
    };

    setGameState(newState);
    syncOnlineState(newState); 
    setSelectedCardIds([]);
  };

  const handleDiscard = () => {
    if (selectedCardIds.length !== 1) return;

    const p = currentPlayer;
    const cardToDiscard = p.hand.find(c => c.id === selectedCardIds[0]);
    if (!cardToDiscard) return;

    const newHand = p.hand.filter(c => c.id !== selectedCardIds[0]);

    const newState = {
      ...gameState,
      players: gameState.players.map(pl => pl.id === p.id ? { ...pl, hand: newHand, lastAction: `Discarded ${cardToDiscard.rank}${cardToDiscard.suit}` } : pl),
      pendingDiscard: cardToDiscard,
      lastDiscardedId: cardToDiscard.id,
      phase: GamePhase.PLAYER_DRAW,
      turnLog: [...gameState.turnLog, `${p.name} discarded ${cardToDiscard.rank}${cardToDiscard.suit}`]
    };

    setGameState(newState);
    syncOnlineState(newState); 
    setSelectedCardIds([]);
  };

  const handleDraw = (source: 'DECK' | 'OPEN') => {
    const p = currentPlayer;
    
    let drawnCard: CardData;
    let newOpenDeck = [...gameState.openDeck];
    let newDeck = [...gameState.deck];

    if (source === 'OPEN') {
      const topCard = newOpenDeck[newOpenDeck.length - 1];
      if (gameState.phase === GamePhase.PLAYER_DRAW && topCard && topCard.id === gameState.lastDiscardedId) {
        if (!p.isBot) alert("Cannot pick up the card you just discarded!");
        return;
      }
      drawnCard = newOpenDeck.pop()!;
    } else {
      if (newDeck.length === 0) {
         if (newOpenDeck.length > 1) {
            const topCard = newOpenDeck.pop()!; 
            const cardsToRecycle = [...newOpenDeck]; 
            newDeck = shuffleDeck(cardsToRecycle); 
            newOpenDeck = [topCard]; 
         } else {
            alert("No cards left in Deck or Open Pile! Ending round.");
            handleShow(); 
            return;
         }
      }
      drawnCard = newDeck.shift()!;
    }

    const newHand = [...p.hand, drawnCard];

    if (gameState.pendingToss.length > 0) newOpenDeck.push(...gameState.pendingToss);
    if (gameState.pendingDiscard) newOpenDeck.push(gameState.pendingDiscard);
      
    finishTurn(p.id, newHand, newOpenDeck, newDeck, source === 'OPEN' ? `Drew from Open Pile` : `Drew from Deck`);
  };

  const handleShow = () => {
    const results = getRoundScores(gameState.players, gameState.currentPlayerIndex, gameState.roundJoker);
    
    const updatedPlayers = gameState.players.map(p => {
      const roundRes = results.find(r => r.playerId === p.id);
      return {
        ...p,
        score: roundRes ? roundRes.roundScore : 0,
        totalScore: (p.totalScore || 0) + (roundRes ? roundRes.roundScore : 0),
        lastAction: p.id === currentPlayer.id ? 'CALLED SHOW!' : 'Revealed',
        wasCaller: p.id === currentPlayer.id 
      };
    });

    const newState = {
      ...gameState,
      players: updatedPlayers,
      phase: GamePhase.ROUND_END,
      turnLog: [...gameState.turnLog, `${currentPlayer.name} called SHOW! Round Ended.`]
    };

    setGameState(newState);
    syncOnlineState(newState); 
    setIsTransitioning(false);
  };

  const finishTurn = (playerId: number, newHand: CardData[], openDeck: CardData[], deck: CardData[], actionLog: string) => {
    const nextPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
    const needsTransition = gameState.gameMode === 'MULTIPLAYER';

    const newState = {
      ...gameState,
      players: gameState.players.map(pl => pl.id === playerId ? { ...pl, hand: newHand, lastAction: 'Ended Turn' } : pl),
      openDeck,
      deck,
      currentPlayerIndex: nextPlayerIndex,
      phase: GamePhase.PLAYER_TURN_START,
      turnLog: [...gameState.turnLog, actionLog],
      lastDiscardedId: null,
      tossedThisTurn: false,
      pendingDiscard: null,
      pendingToss: []
    };

    setGameState(newState);
    syncOnlineState(newState); 

    if (needsTransition) {
      setIsTransitioning(true);
    }
  };

  const nextRound = () => {
    if (gameState.roundNumber >= gameState.totalRounds) {
      return;
    } else {
      startRound(gameState.roundNumber + 1, gameState.players, gameState.gameMode);
    }
  };

  // --- AUTH GUARD ---
  if (authLoading || isReconnecting) return <LoadingScreen>{isReconnecting ? 'Reconnecting to Game...' : 'Loading...'}</LoadingScreen>;
  if (!session && !isGuest) return <Auth onGuestPlay={() => setIsGuest(true)} />;

  // --- ONLINE LOBBY SCREEN ---
  if (isOnlineLobby) {
     return <Lobby
       roomCode={roomCode}
       onlineLobbyPlayers={onlineLobbyPlayers}
       onlineHostId={onlineHostId}
       myOnlineId={myOnlineId}
       rounds={roundInput}
       onStart={startOnlineGame}
       onLeave={clearSession}
     />;
  }

  // --- MAIN MENU ---
  if (!gameState.gameMode && !isNameEntryStep && !showRoundSelectionSP && !showOnlineSelection) {
    return <MainMenu
      isGuest={isGuest}
      isEditingName={isEditingName}
      setIsEditingName={setIsEditingName}
      customDisplayName={customDisplayName}
      setCustomDisplayName={setCustomDisplayName}
      getDisplayName={getDisplayName}
      saveCustomName={saveCustomName}
      onSignOut={handleSignOut}
      showMultiplayerSelection={showMultiplayerSelection}
      setShowMultiplayerSelection={setShowMultiplayerSelection}
      setShowOnlineSelection={setShowOnlineSelection}
      onSinglePlayer={openSinglePlayerSetup}
      onPlayerCount={initMultiplayerSetup}
    />;
  }

  // --- ONLINE SELECTION SCREEN ---
  if (showOnlineSelection) {
    return <OnlineSelect
      joinCodeInput={joinCodeInput}
      setJoinCodeInput={setJoinCodeInput}
      isJoining={isJoining}
      onBack={() => setShowOnlineSelection(false)}
      onCreate={handleCreateOnlineGame}
      onJoin={handleJoinOnlineGame}
    />;
  }
  // 1.2 SINGLE PLAYER ROUND SELECTION
  if (showRoundSelectionSP) {
    return <RoundSelect
      rounds={roundInput}
      onStart={startSinglePlayerMatch}
      onCancel={() => setShowRoundSelectionSP(false)}
    />;
  }
  // 1.5 MULTIPLAYER SETUP SCREEN 
  if (isNameEntryStep) {
    return <NameEntry
      customPlayerNames={customPlayerNames}
      setCustomPlayerNames={setCustomPlayerNames}
      rounds={roundInput}
      onBack={() => { setIsNameEntryStep(false); setShowMultiplayerSelection(true); }}
      onStart={finalizeMultiplayerStart}
    />;
  }

  // 2. LOADING STATE
  if (gameState.phase === GamePhase.SETUP || !currentPlayer || gameState.players.length === 0) {
    return <LoadingScreen>Setting up table...</LoadingScreen>;
  }

  // 3. TRANSITION OVERLAY
  if (isTransitioning) {
    return <Transition currentPlayer={currentPlayer} onReady={() => setIsTransitioning(false)} />;
  }

  // --- MAIN GAME ---
  return <GameTable
    gameState={gameState}
    currentPlayer={currentPlayer}
    bottomPlayer={bottomPlayer}
    opponentsToRender={opponentsToRender}
    isPlayerTurn={isPlayerTurn}
    isBotThinking={isBotThinking}
    selectedCardIds={selectedCardIds}
    roomCode={roomCode}
    myOnlineId={myOnlineId}
    onlineHostId={onlineHostId}
    isSyncing={isSyncing}
    showExitConfirm={showExitConfirm}
    setShowExitConfirm={setShowExitConfirm}
    handleCardClick={handleCardClick}
    handleToss={handleToss}
    handleDiscard={handleDiscard}
    handleDraw={handleDraw}
    handleShow={handleShow}
    handleKickPlayer={handleKickPlayer}
    handleReturnToLobby={handleReturnToLobby}
    nextRound={nextRound}
    clearSession={clearSession}
  />;
};

export default App;