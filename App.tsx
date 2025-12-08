import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, Player, CardData, GamePhase, GameMode } from './types';
import { createDeck, getRoundScores, calculateHandValue, decideBotAction, shuffleDeck } from './services/gameLogic';
import { createRoom, joinRoom, subscribeToRoom, updateGameState, getRoomData, resetRoomToLobby } from './services/online';
import { DEFAULT_TOTAL_ROUNDS } from './constants';
import Card from './components/Card';
import Auth from './components/Auth';
import { supabase, signOut } from './services/supabase';
import { RefreshCw, Trophy, Users, AlertCircle, Hand, ChevronRight, EyeOff, Eye, User, Bot, ArrowRight, ChevronLeft, Play, Hash, Sparkles, LogOut, Globe, Wifi, Copy, CloudUpload, Lock, Edit2, Check, Loader2, BookOpen, X, Plus, Minus } from 'lucide-react';

const SESSION_KEY = 'TRI_STACK_SESSION';
const NAME_KEY = 'TRI_STACK_PLAYER_NAME';

const App: React.FC = () => {
  // --- Auth State ---
  const [session, setSession] = useState<any>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  // --- Game State ---
  const [gameState, setGameState] = useState<GameState>({
    gameMode: null,
    deck: [],
    openDeck: [],
    players: [],
    currentPlayerIndex: 0,
    roundJoker: null,
    roundNumber: 1,
    totalRounds: DEFAULT_TOTAL_ROUNDS,
    phase: GamePhase.SETUP,
    turnLog: [],
    winner: null,
    lastDiscardedId: null,
    tossedThisTurn: false,
    pendingDiscard: null,
    pendingToss: [],
    playerNames: []
  });

  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  // Local Multiplayer: Hides the screen between turns
  const [isTransitioning, setIsTransitioning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Menu State
  const [showMultiplayerSelection, setShowMultiplayerSelection] = useState(false);
  const [showOnlineSelection, setShowOnlineSelection] = useState(false); // New: Online Menu
  const [showRoundSelectionSP, setShowRoundSelectionSP] = useState(false);
  const [setupPlayerCount, setSetupPlayerCount] = useState(4);
  const [selectedTotalRounds, setSelectedTotalRounds] = useState(DEFAULT_TOTAL_ROUNDS);
  const [isNameEntryStep, setIsNameEntryStep] = useState(false);
  const [customPlayerNames, setCustomPlayerNames] = useState<string[]>([]);
  
  // Rules State
  const [showRules, setShowRules] = useState(false);
  const [ruleSlide, setRuleSlide] = useState(0);

  // User Customization
  const [customDisplayName, setCustomDisplayName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);

  // Online Specific State
  const [roomCode, setRoomCode] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [myOnlineId, setMyOnlineId] = useState<number | null>(null); // Who am I?
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
          
          // CRITICAL FIX: Bypass Auth Guard for reconnected user
          setIsGuest(true);

          if (roomData.status === 'WAITING') {
            setOnlineLobbyPlayers(roomData.players || []);
            setIsOnlineLobby(true); // Ensure we land in lobby
            setGameState(prev => ({ ...prev, gameMode: (playerId === 0 ? 'ONLINE_HOST' : 'ONLINE_CLIENT') as GameMode }));
          } else {
             // Game is in progress
             if (roomData.game_state) {
               const effectiveMode = (playerId === 0 ? 'ONLINE_HOST' : 'ONLINE_CLIENT') as GameMode;
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
      // 1. Lobby Updates (Waiting phase)
      if (roomData.status === 'WAITING') {
         setOnlineLobbyPlayers(roomData.players || []);
         
         // If we were playing but room went back to waiting (Host clicked Return to Lobby)
         if (!isOnlineLobby && gameState.gameMode) {
            setIsOnlineLobby(true);
            const mode = myOnlineId === 0 ? 'ONLINE_HOST' : 'ONLINE_CLIENT';
            setGameState(prev => ({ ...prev, gameMode: mode as GameMode }));
         }
      }
      // 2. Game Updates (Playing phase)
      else if (roomData.status === 'PLAYING' || roomData.status === 'FINISHED') {
         // Force the game state from server to local
         if (roomData.game_state) {
           // CRITICAL FIX: Determine correct local mode
           // Even if server says "ONLINE_HOST", if I am not ID 0, I treat it as CLIENT locally
           // This ensures the UI renders correctly (e.g. Next Round button hidden)
           const effectiveMode = (myOnlineId === 0 ? 'ONLINE_HOST' : 'ONLINE_CLIENT') as GameMode;
           
           setGameState({
             ...roomData.game_state,
             gameMode: effectiveMode
           });
           
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
  }, [roomCode, myOnlineId, isOnlineLobby, gameState.gameMode]);

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
    setGameState({
      gameMode: null,
      deck: [],
      openDeck: [],
      players: [],
      currentPlayerIndex: 0,
      roundJoker: null,
      roundNumber: 1,
      totalRounds: DEFAULT_TOTAL_ROUNDS,
      phase: GamePhase.SETUP,
      turnLog: [],
      winner: null,
      lastDiscardedId: null,
      tossedThisTurn: false,
      pendingDiscard: null,
      pendingToss: [],
      playerNames: []
    });
    
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
    setSelectedTotalRounds(5); // Reset rounds
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

  // --- LOCAL SETUP FLOWS ---
  const openSinglePlayerSetup = () => {
    setShowRoundSelectionSP(true);
    setSelectedTotalRounds(5); // Reset to default
  };

  const startSinglePlayerMatch = (rounds: number) => {
    setSelectedTotalRounds(rounds);
    const playerName = getDisplayName();
    const names = [playerName, 'Bot Alpha', 'Bot Beta', 'Bot Gamma'];
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
    setSelectedTotalRounds(5);
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
      // If no caller found (rare/first round), default to 0.
      
      const caller = existingPlayers.find(p => p.wasCaller);

      if (caller) {
        startingPlayerIndex = caller.id;
        startLog = `Round ${roundNum} started! ${caller.name} called SHOW last round and will start this round.`;
      } else {
         // Fallback logic if needed, but handleShow should guarantee a caller
         // defaulting to 0 is safe
      }

      players = existingPlayers.map(p => ({ 
        ...p, 
        hand: [], 
        score: 0,
        // CRITICAL: Preserve totalScore
        totalScore: p.totalScore || 0,
        lastAction: 'Waiting...',
        wasCaller: false // Reset flag for new round
      }));
    } else {
      // New Game Local Logic (SP or MP)
      if (mode === 'SINGLE_PLAYER') {
        const names = gameState.playerNames.length > 0 ? gameState.playerNames : ['You', 'Bot Alpha', 'Bot Beta', 'Bot Gamma'];
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
      currentPlayerIndex: startingPlayerIndex, // Set Caller as starter
      roundJoker,
      roundNumber: roundNum,
      totalRounds: selectedTotalRounds,
      phase: GamePhase.PLAYER_TURN_START,
      turnLog: [startLog],
      winner: null,
      lastDiscardedId: null,
      tossedThisTurn: false,
      pendingDiscard: null,
      pendingToss: [],
      gameMode: (mode || gameState.gameMode) as GameMode // Ensure mode is set
    };

    setGameState(newState);
    
    // IF ONLINE HOST: PUSH STATE
    if (mode === 'ONLINE_HOST' || gameState.gameMode === 'ONLINE_HOST') {
      updateGameState(roomCode, newState);
    }

    setSelectedCardIds([]);
    // Only transition if it's local multiplayer
    setIsTransitioning(mode === 'MULTIPLAYER' || (existingPlayers && gameState.gameMode === 'MULTIPLAYER'));
  }, [gameState.gameMode, setupPlayerCount, gameState.playerNames, selectedTotalRounds, roomCode, gameState]);

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
           // Handle Show Logic (Simplified for Bot)
           const results = getRoundScores(gameState.players, gameState.currentPlayerIndex, gameState.roundJoker);
           const updatedPlayers = gameState.players.map(pl => {
             const roundRes = results.find(r => r.playerId === pl.id);
             return { 
                ...pl, 
                score: roundRes?.roundScore || 0, 
                totalScore: (pl.totalScore || 0) + (roundRes?.roundScore || 0),
                wasCaller: pl.id === p.id // Mark bot as caller
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
        // Draw logic (Simplified duplicate of handleDraw)
        // RECYCLING LOGIC FOR BOT
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
             // Deadlock - for bot just end turn (failsafe)
             return;
           }
        }
        
        const drawn = newState.deck.shift()!;
        newState.players = newState.players.map(pl => pl.id === p.id ? { ...pl, hand: [...pl.hand, drawn] } : pl);
        
        // Commit pending
        if (newState.pendingToss.length) newState.openDeck = [...newState.openDeck, ...newState.pendingToss];
        if (newState.pendingDiscard) newState.openDeck = [...newState.openDeck, newState.pendingDiscard];
        
        // Finish Turn Logic
        newState.pendingToss = [];
        newState.pendingDiscard = null;
        newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % newState.players.length;
        newState.phase = GamePhase.PLAYER_TURN_START;
        newState.tossedThisTurn = false;
        newState.lastDiscardedId = null;
      }

      setGameState(newState);
      // No Online sync needed for Single Player bots
    }, 1500); 

    return () => clearTimeout(timeout);
  }, [gameState.phase, gameState.currentPlayerIndex, isBotThinking, gameState.players, gameState.deck, gameState.openDeck]); // Add deps


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
    syncOnlineState(newState); // SYNC
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
    syncOnlineState(newState); // SYNC
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
      // DECK DRAW LOGIC WITH RECYCLING
      if (newDeck.length === 0) {
         if (newOpenDeck.length > 1) {
            // RECYCLE
            const topCard = newOpenDeck.pop()!; // Keep top card
            const cardsToRecycle = [...newOpenDeck]; // Take the rest
            newDeck = shuffleDeck(cardsToRecycle); // Shuffle back to deck
            newOpenDeck = [topCard]; // Restore top card
            
            // Log this event so players know
            // We can't easily push to turnLog here without modifying state before finishTurn
            // but finishTurn accepts actionLog.
         } else {
            // DEADLOCK
            alert("No cards left in Deck or Open Pile! Ending round.");
            handleShow(); // Force end of round
            return;
         }
      }
      drawnCard = newDeck.shift()!;
    }

    const newHand = [...p.hand, drawnCard];

    // COMMIT PENDING
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
        // SAFE SCORE ADDITION
        totalScore: (p.totalScore || 0) + (roundRes ? roundRes.roundScore : 0),
        lastAction: p.id === currentPlayer.id ? 'CALLED SHOW!' : 'Revealed',
        wasCaller: p.id === currentPlayer.id // MARK THE CALLER
      };
    });

    const newState = {
      ...gameState,
      players: updatedPlayers,
      phase: GamePhase.ROUND_END,
      turnLog: [...gameState.turnLog, `${currentPlayer.name} called SHOW! Round Ended.`]
    };

    setGameState(newState);
    syncOnlineState(newState); // SYNC
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
    syncOnlineState(newState); // SYNC

    if (needsTransition) {
      setIsTransitioning(true);
    }
  };

  const nextRound = () => {
    if (gameState.roundNumber >= gameState.totalRounds) {
      // MATCH END (Handled in modal now, but kept for safety)
      return;
    } else {
      startRound(gameState.roundNumber + 1, gameState.players, gameState.gameMode);
    }
  };

  // --- AUTH GUARD ---
  if (authLoading || isReconnecting) return <div className="h-[100dvh] bg-[#1a2e1a] flex flex-col items-center justify-center text-white gap-4"><RefreshCw className="animate-spin text-yellow-500" size={48} /><h2 className="font-serif text-2xl">{isReconnecting ? 'Reconnecting to Game...' : 'Loading...'}</h2></div>;
  if (!session && !isGuest) return <Auth onGuestPlay={() => setIsGuest(true)} />;

  // --- ONLINE LOBBY SCREEN ---
  if (isOnlineLobby) {
     const canStart = onlineLobbyPlayers.length >= 2;

     return (
        <div className="h-[100dvh] bg-[#1a2e1a] flex flex-col items-center justify-center p-4">
           <div className="bg-slate-900/90 p-8 rounded-2xl border border-yellow-500/30 w-full max-w-md text-center">
              <h1 className="text-3xl font-serif font-bold text-yellow-500 mb-2">Lobby</h1>
              
              <div className="bg-black/40 p-4 rounded-xl mb-6 flex items-center justify-between border border-white/10">
                 <div className="text-left">
                    <p className="text-xs text-gray-400 uppercase">Room Code</p>
                    <p className="text-3xl font-mono font-bold text-white tracking-widest">{roomCode}</p>
                 </div>
                 <button onClick={() => navigator.clipboard.writeText(roomCode)} className="bg-slate-700 p-2 rounded hover:bg-slate-600">
                    <Copy size={20} className="text-gray-300" />
                 </button>
              </div>

              <div className="mb-8">
                 <h3 className="text-sm font-bold text-gray-400 mb-2 flex items-center justify-center gap-2">
                    <Users size={16}/> Players Joined ({onlineLobbyPlayers.length}/10)
                 </h3>
                 <div className="flex flex-col gap-2 max-h-[200px] overflow-y-auto">
                    {onlineLobbyPlayers.map(p => (
                       <div key={p.id} className="bg-slate-800 p-3 rounded-lg flex items-center justify-between">
                          <span className="font-bold text-white">{p.name}</span>
                          {p.id === 0 && <span className="text-xs bg-yellow-500 text-black px-2 py-1 rounded font-bold">HOST</span>}
                       </div>
                    ))}
                 </div>
              </div>

              {/* Host Controls */}
              <div className="flex flex-col gap-3">
                 {myOnlineId === 0 ? (
                    <>
                    {/* ROUND SELECTOR */}
                    <div className="mb-2">
                       <label className="text-xs text-gray-400 font-bold uppercase block mb-1">Rounds</label>
                       <div className="flex gap-2 justify-center">
                          {[3, 5, 7, 10].map(r => (
                             <button 
                                key={r} 
                                onClick={() => setSelectedTotalRounds(r)}
                                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all border ${selectedTotalRounds === r ? 'bg-yellow-500 text-black border-yellow-500' : 'bg-slate-800 text-gray-400 border-slate-600 hover:bg-slate-700'}`}
                             >
                                {r}
                             </button>
                          ))}
                       </div>
                    </div>

                    <button 
                      onClick={startOnlineGame} 
                      disabled={!canStart}
                      className={`w-full font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all ${canStart ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed opacity-50'}`}
                    >
                       Start Game <Play size={20} />
                    </button>
                    {!canStart && <div className="text-xs text-yellow-500 flex items-center justify-center gap-1 animate-pulse"><AlertCircle size={12} /> Waiting for at least 1 opponent...</div>}
                    </>
                 ) : (
                    <div className="w-full bg-slate-700 text-gray-400 font-bold py-4 rounded-xl flex items-center justify-center gap-2 animate-pulse">
                       Waiting for Host to start...
                    </div>
                 )}
                 <button onClick={clearSession} className="text-red-400 text-sm hover:underline mt-2">Leave Room</button>
              </div>
           </div>
        </div>
     );
  }

  // --- MAIN MENU ---
  if (!gameState.gameMode && !isNameEntryStep && !showRoundSelectionSP && !showOnlineSelection) {
    return (
      <div className="h-[100dvh] bg-[#1a2e1a] flex flex-col items-center justify-center p-4">
        <h1 className="font-serif text-5xl md:text-7xl font-bold text-yellow-500 mb-8 drop-shadow-2xl">TRI-STACK</h1>
        
        {/* Rules Button */}
        <div className="absolute top-4 left-4 z-50">
           <button 
             onClick={() => { setShowRules(true); setRuleSlide(0); }} 
             className="text-gray-400 hover:text-white transition-colors bg-black/30 p-2 rounded-lg backdrop-blur"
             title="How to Play"
           >
              <BookOpen size={24} />
           </button>
        </div>

        {/* User Info Bar */}
        <div className="absolute top-4 right-4 flex items-center gap-2 text-sm bg-black/30 p-2 rounded-lg backdrop-blur z-50">
          <User size={16} className="text-green-400" />
          
          {isEditingName ? (
            <div className="flex items-center gap-1">
               <input 
                 autoFocus
                 className="bg-slate-800 text-white border border-slate-600 rounded px-1 py-0.5 text-xs w-24 outline-none focus:border-yellow-500"
                 value={customDisplayName}
                 placeholder="Enter Name"
                 onChange={(e) => setCustomDisplayName(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter') {
                     saveCustomName();
                   }
                 }}
               />
               <button onClick={saveCustomName} className="text-green-400 hover:text-green-300">
                  <Check size={14} />
               </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
               <span className="text-gray-300 font-bold">{getDisplayName()}</span>
               <button onClick={() => { setCustomDisplayName(getDisplayName()); setIsEditingName(true); }} className="text-gray-500 hover:text-white transition-colors">
                  <Edit2 size={12} />
               </button>
            </div>
          )}

          {!isGuest && <button onClick={handleSignOut} className="ml-2 text-red-400 hover:text-red-300 border-l border-white/10 pl-2"><LogOut size={16} /></button>}
        </div>

        <div className="bg-slate-900/50 p-8 rounded-2xl backdrop-blur-sm border border-white/10 shadow-2xl flex flex-col gap-6 w-full max-w-md">
           
           {!showMultiplayerSelection ? (
             <>
                <button onClick={openSinglePlayerSetup} className="bg-blue-600 hover:bg-blue-500 text-white p-6 rounded-xl font-bold text-lg flex items-center gap-4 transition-all">
                  <div className="w-12 h-12 bg-blue-800 rounded-full flex items-center justify-center"><User size={24} /></div>
                  <div className="text-left"><div>Single Player</div><div className="text-sm text-blue-200 font-normal">Challenge the Bots</div></div>
                </button>

                <button onClick={() => setShowMultiplayerSelection(true)} className="bg-green-600 hover:bg-green-500 text-white p-6 rounded-xl font-bold text-lg flex items-center gap-4 transition-all">
                  <div className="w-12 h-12 bg-green-800 rounded-full flex items-center justify-center"><Users size={24} /></div>
                  <div className="text-left"><div>Local Multiplayer</div><div className="text-sm text-green-200 font-normal">Pass & Play on 1 Device</div></div>
                </button>

                <button onClick={() => setShowOnlineSelection(true)} className="bg-purple-600 hover:bg-purple-500 text-white p-6 rounded-xl font-bold text-lg flex items-center gap-4 transition-all">
                  <div className="w-12 h-12 bg-purple-800 rounded-full flex items-center justify-center"><Globe size={24} /></div>
                  <div className="text-left"><div>Online Multiplayer</div><div className="text-sm text-purple-200 font-normal">Play with friends remotely</div></div>
                </button>
             </>
           ) : (
             <>
               <button onClick={() => setShowMultiplayerSelection(false)} className="self-start text-gray-400 hover:text-white flex items-center gap-1 mb-2"><ChevronLeft size={20} /> Back</button>
               <h2 className="text-white text-xl text-center mb-4">How many players?</h2>
               <div className="grid grid-cols-2 gap-3 max-h-[40vh] overflow-y-auto">
                 {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(count => (
                   <button key={count} onClick={() => initMultiplayerSetup(count)} className="bg-slate-700 hover:bg-green-600 text-white p-4 rounded-xl font-bold flex items-center justify-center transition-all group">
                     <span className="flex items-center gap-2"><Users size={16} className="text-gray-400 group-hover:text-white" />{count}</span>
                   </button>
                 ))}
               </div>
             </>
           )}
        </div>

        {/* RULES MODAL (TUTORIAL CAROUSEL) */}
        {showRules && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
             <div className="bg-slate-900 border border-yellow-500/30 p-6 rounded-2xl max-w-sm w-full shadow-2xl relative min-h-[400px] flex flex-col">
                <button onClick={() => setShowRules(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white z-20"><X size={24}/></button>
                <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
                   {/* SLIDE CONTENT */}
                   {ruleSlide === 0 && (
                      <div className="animate-in fade-in slide-in-from-right-4">
                         <h2 className="text-2xl font-serif font-bold text-yellow-500 mb-4">The Race to Zero</h2>
                         <div className="w-24 h-24 bg-black/50 rounded-full flex items-center justify-center border-4 border-yellow-500 mx-auto mb-6">
                            <span className="text-5xl font-bold text-white">0</span>
                         </div>
                         <p className="text-gray-300">Your goal is simple: Get your hand value as close to <strong>ZERO</strong> as possible. Low score wins!</p>
                      </div>
                   )}
                   {ruleSlide === 1 && (
                      <div className="animate-in fade-in slide-in-from-right-4">
                         <h2 className="text-2xl font-serif font-bold text-yellow-500 mb-4">The Game Loop</h2>
                         <div className="flex flex-col gap-4 mb-6 px-2">
                            <div className="bg-slate-800 p-4 rounded-xl border border-white/5 flex items-center gap-4">
                               <div className="bg-green-600/20 text-green-500 p-3 rounded-full"><Plus size={24} /></div>
                               <div className="text-left">
                                  <div className="font-bold text-white">1. DRAW</div>
                                  <div className="text-xs text-gray-400">Take 1 card from Deck or Pile</div>
                               </div>
                            </div>
                            <div className="flex justify-center -my-2 z-10 text-gray-600"><ArrowRight className="rotate-90" size={20}/></div>
                            <div className="bg-slate-800 p-4 rounded-xl border border-white/5 flex items-center gap-4">
                               <div className="bg-red-600/20 text-red-500 p-3 rounded-full"><Minus size={24} /></div>
                               <div className="text-left">
                                  <div className="font-bold text-white">2. DISCARD</div>
                                  <div className="text-xs text-gray-400">Drop 1 card to end turn</div>
                               </div>
                            </div>
                         </div>
                         <p className="text-gray-300">You always start with 3 cards and end with 3 cards. Keep the low ones!</p>
                      </div>
                   )}
                   {ruleSlide === 2 && (
                      <div className="animate-in fade-in slide-in-from-right-4">
                         <h2 className="text-2xl font-serif font-bold text-yellow-500 mb-4">Discard High Cards</h2>
                         <div className="relative h-28 mx-auto mb-6 flex justify-center items-center">
                            <div className="absolute transform -rotate-6 w-16 h-24 bg-white rounded border border-gray-400 shadow-sm top-2 -ml-8"></div>
                            <div className="absolute transform rotate-6 w-16 h-24 bg-white rounded border border-gray-400 shadow-sm top-2 ml-8"></div>
                            <div className="relative w-16 h-24 bg-white rounded-lg flex items-center justify-center text-red-600 font-bold text-2xl border-2 border-red-500 shadow-xl transform -translate-y-4 animate-pulse">
                               Q♦
                            </div>
                            <div className="absolute -right-4 top-0 text-red-500 animate-bounce">
                                <ArrowRight size={24} className="rotate-[-45deg]" />
                            </div>
                         </div>
                         <p className="text-gray-300">To end your turn, you must <strong>DISCARD</strong> one card onto the pile. Try to drop your highest card!</p>
                      </div>
                   )}
                   {ruleSlide === 3 && (
                      <div className="animate-in fade-in slide-in-from-right-4">
                         <h2 className="text-2xl font-serif font-bold text-yellow-500 mb-4">Have a Pair?</h2>
                         <div className="flex justify-center items-center gap-2 mb-6">
                            <div className="w-14 h-20 bg-white rounded flex items-center justify-center text-black font-bold border border-gray-300">8♦</div>
                            <div className="w-14 h-20 bg-white rounded flex items-center justify-center text-black font-bold border border-gray-300">8♠</div>
                            <ArrowRight className="text-blue-400" />
                            <div className="w-14 h-20 bg-blue-900 rounded flex items-center justify-center border-2 border-white/20 text-xs text-white">DRAW 1</div>
                         </div>
                         <p className="text-gray-300">Select two of the same card and click <strong>TOSS</strong>. You trade 2 cards for 1 to lower your score fast.</p>
                      </div>
                   )}
                   {ruleSlide === 4 && (
                      <div className="animate-in fade-in slide-in-from-right-4">
                         <h2 className="text-2xl font-serif font-bold text-yellow-500 mb-4">Know Your Values</h2>
                         <div className="flex justify-center gap-8 mb-6">
                            <div className="flex flex-col items-center">
                               <div className="w-16 h-24 bg-white rounded-lg flex items-center justify-center text-black font-bold text-2xl mb-2 border-2 border-red-500 text-red-600">K♥</div>
                               <span className="text-red-400 font-bold">10 Pts</span>
                            </div>
                            <div className="flex flex-col items-center">
                               <div className="w-16 h-24 bg-white rounded-lg flex items-center justify-center text-black font-bold text-2xl mb-2 border-2 border-black">A♠</div>
                               <span className="text-green-400 font-bold">1 Pt</span>
                            </div>
                         </div>
                         <p className="text-gray-300">Picture cards (K, Q, J, 10) are heavy (10 pts). <br/>Aces are light (1 pt).</p>
                      </div>
                   )}
                   {ruleSlide === 5 && (
                      <div className="animate-in fade-in slide-in-from-right-4">
                         <h2 className="text-2xl font-serif font-bold text-yellow-500 mb-4">Zero is Hero</h2>
                         <div className="relative w-20 h-28 bg-white rounded-lg flex items-center justify-center text-black font-bold text-3xl mx-auto mb-6 border-2 border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.5)]">
                            9♣
                            <div className="absolute -top-3 -right-3 bg-purple-600 text-white text-[10px] font-bold px-2 py-1 rounded-full animate-bounce">JOKER</div>
                         </div>
                         <p className="text-gray-300">Every round, one rank is the <strong>JOKER</strong>. It is worth <strong>0 Points</strong>. Never throw these away!</p>
                      </div>
                   )}
                   {ruleSlide === 6 && (
                      <div className="animate-in fade-in slide-in-from-right-4">
                         <h2 className="text-2xl font-serif font-bold text-yellow-500 mb-4">Call "SHOW"</h2>
                         <div className="mb-6">
                            <button className="bg-red-600 text-white font-bold py-3 px-8 rounded-full shadow-lg shadow-red-900/50 scale-110 pointer-events-none">SHOW</button>
                         </div>
                         <p className="text-gray-300">Think you have the lowest score? Button mash <strong>SHOW</strong>. <br/><span className="text-xs text-gray-500 mt-2 block">(Careful! If you aren't the lowest, you pay a penalty.)</span></p>
                      </div>
                   )}
                </div>

                {/* NAVIGATION */}
                <div className="mt-6 flex flex-col gap-4">
                   <div className="flex justify-center gap-2">
                      {[0, 1, 2, 3, 4, 5, 6].map(i => (
                         <div key={i} className={`w-2 h-2 rounded-full transition-all ${i === ruleSlide ? 'bg-yellow-500 w-4' : 'bg-gray-600'}`} />
                      ))}
                   </div>
                   <div className="flex gap-3">
                      {ruleSlide > 0 ? (
                         <button onClick={() => setRuleSlide(prev => Math.max(0, prev - 1))} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-bold">Back</button>
                      ) : <div className="flex-1" />}
                      
                      {ruleSlide < 6 ? (
                         <button onClick={() => setRuleSlide(prev => Math.min(6, prev + 1))} className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black py-3 rounded-xl font-bold">Next</button>
                      ) : (
                         <button onClick={() => setShowRules(false)} className="flex-1 bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl font-bold">Play Now</button>
                      )}
                   </div>
                </div>
             </div>
          </div>
        )}
      </div>
    );
  }

  // --- ONLINE SELECTION SCREEN ---
  if (showOnlineSelection) {
    return (
      <div className="h-[100dvh] bg-[#1a2e1a] flex flex-col items-center justify-center p-4">
        <h1 className="font-serif text-3xl md:text-5xl font-bold text-yellow-500 mb-8">Online Play</h1>
        <div className="bg-slate-900/80 p-8 rounded-2xl border border-white/10 w-full max-w-md">
           
           <button onClick={() => setShowOnlineSelection(false)} className="text-gray-400 hover:text-white flex items-center gap-1 mb-6"><ChevronLeft size={20} /> Back</button>

           <div className="flex flex-col gap-4">
              <button onClick={handleCreateOnlineGame} className="bg-yellow-500 hover:bg-yellow-400 text-black p-6 rounded-xl font-bold text-xl flex flex-col items-center justify-center gap-2 shadow-lg">
                 <Wifi size={32} />
                 Create New Room
              </button>

              <div className="flex items-center gap-4 text-gray-500 text-sm my-2">
                 <div className="h-px bg-white/10 flex-1" /> OR <div className="h-px bg-white/10 flex-1" />
              </div>

              <div className="bg-black/30 p-4 rounded-xl border border-white/10">
                 <label className="text-xs text-gray-400 font-bold uppercase mb-2 block">Join Existing Room</label>
                 <div className="flex gap-2">
                    <input 
                      type="text" 
                      maxLength={4} 
                      placeholder="CODE"
                      value={joinCodeInput}
                      onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                      className="bg-slate-800 text-white font-mono text-center text-xl p-3 rounded-lg w-full border border-slate-600 focus:border-yellow-500 focus:outline-none uppercase tracking-widest"
                    />
                    <button 
                      onClick={handleJoinOnlineGame} 
                      disabled={isJoining}
                      className="bg-blue-600 hover:bg-blue-500 text-white px-6 rounded-lg font-bold disabled:opacity-50 flex items-center justify-center min-w-[80px]"
                    >
                      {isJoining ? <Loader2 className="animate-spin" size={20} /> : 'JOIN'}
                    </button>
                 </div>
              </div>
           </div>
        </div>
      </div>
    );
  }

  // 1.2 SINGLE PLAYER ROUND SELECTION (Omitted for brevity, same as before)
  if (showRoundSelectionSP) {
    return (
      <div className="h-[100dvh] bg-[#1a2e1a] flex flex-col items-center justify-center p-4">
        <h1 className="font-serif text-3xl md:text-5xl font-bold text-yellow-500 mb-6">Match Length</h1>
        <div className="bg-slate-900/80 p-6 rounded-2xl backdrop-blur-sm border border-white/10 shadow-2xl w-full max-w-md text-center">
           <h2 className="text-white text-xl mb-6">How many rounds?</h2>
           <div className="grid grid-cols-2 gap-4 mb-6">
              {[3, 5, 7, 10].map(r => (
                 <button key={r} onClick={() => startSinglePlayerMatch(r)} className="bg-slate-800 hover:bg-blue-600 text-white p-6 rounded-xl font-bold text-2xl transition-all border border-slate-600 hover:border-blue-400">{r}</button>
              ))}
           </div>
           <button onClick={() => setShowRoundSelectionSP(false)} className="text-gray-400 hover:text-white flex items-center gap-2 mx-auto"><ChevronLeft size={20} /> Cancel</button>
        </div>
      </div>
    );
  }

  // 1.5 MULTIPLAYER SETUP SCREEN (Omitted for brevity, same as before)
  if (isNameEntryStep) {
    return (
      <div className="h-[100dvh] bg-[#1a2e1a] flex flex-col items-center justify-center p-4">
        <h1 className="font-serif text-3xl md:text-5xl font-bold text-yellow-500 mb-6">Setup Game</h1>
        <div className="bg-slate-900/80 p-6 md:p-8 rounded-2xl backdrop-blur-sm border border-white/10 shadow-2xl w-full max-w-md flex flex-col gap-6">
           <div className="max-h-[30vh] overflow-y-auto pr-2 space-y-3">
             {customPlayerNames.map((name, idx) => (
               <div key={idx} className="flex flex-col gap-1">
                 <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Player {idx + 1}</label>
                 <input type="text" value={name} onChange={(e) => { const newNames = [...customPlayerNames]; newNames[idx] = e.target.value; setCustomPlayerNames(newNames); }} maxLength={12} className="bg-slate-800 text-white border border-slate-600 rounded-lg p-3 focus:border-yellow-500 focus:outline-none transition-colors" placeholder={`Player ${idx + 1}`} />
               </div>
             ))}
           </div>
           <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 mb-1"><Hash size={16} className="text-yellow-500" /><label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Number of Rounds</label></div>
              <div className="flex gap-2">{[3, 5, 7, 10].map(r => (<button key={r} onClick={() => setSelectedTotalRounds(r)} className={`flex-1 py-3 rounded-lg font-bold text-sm transition-all border ${selectedTotalRounds === r ? 'bg-yellow-500 text-black border-yellow-500 shadow-lg shadow-yellow-900/20' : 'bg-slate-800 text-gray-400 border-slate-600 hover:bg-slate-700'}`}>{r}</button>))}</div>
           </div>
           <div className="flex gap-3 mt-2">
             <button onClick={() => { setIsNameEntryStep(false); setShowMultiplayerSelection(true); }} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl font-bold">Back</button>
             <button onClick={finalizeMultiplayerStart} className="flex-[2] bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-900/20">Start Match <Play size={20} className="fill-current" /></button>
           </div>
        </div>
      </div>
    );
  }

  // 2. LOADING STATE
  if (gameState.phase === GamePhase.SETUP || !currentPlayer || gameState.players.length === 0) {
    return <div className="h-[100dvh] bg-[#1a2e1a] flex flex-col items-center justify-center text-white gap-4"><RefreshCw className="animate-spin text-yellow-500" size={48} /><h2 className="font-serif text-2xl">Setting up table...</h2></div>;
  }

  // 3. TRANSITION OVERLAY (PASS DEVICE - LOCAL ONLY)
  if (isTransitioning) {
    return (
      <div className="h-[100dvh] bg-slate-900 flex flex-col items-center justify-center p-4 z-50">
        <div className="max-w-md w-full bg-slate-800 p-8 rounded-2xl shadow-2xl border border-yellow-500/30 text-center animate-in fade-in">
           <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-500/20"><EyeOff size={40} className="text-white" /></div>
           <h2 className="text-2xl text-gray-400 font-serif mb-2">Turn Complete</h2>
           <p className="text-gray-500 mb-8">Please pass the device to</p>
           {/* CRITICAL FIX: Use safe currentPlayer variable instead of raw array access */}
           <h1 className="text-4xl font-bold text-white mb-8 tracking-tight">{currentPlayer.name}</h1>
           <button onClick={() => setIsTransitioning(false)} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-all transform hover:scale-[1.02]"><Eye size={24} /> I am {currentPlayer.name} - Ready</button>
        </div>
      </div>
    );
  }

  // --- MAIN GAME ---
  
  const showOpponentCards = gameState.phase === GamePhase.ROUND_END;

  // Determine if it is the last round
  const isLastRound = gameState.roundNumber >= gameState.totalRounds;

  // Find Winner
  const lowestScore = Math.min(...gameState.players.map(p => p.totalScore || 0));

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-[#1a2e1a]">
      {/* Top Bar: Info */}
      <div className="h-16 bg-[#0f1f0f] flex items-center justify-between px-4 shadow-lg z-20 shrink-0">
        <div className="flex items-center gap-4">
          {/* Universal Exit Button */}
          <button onClick={() => setShowExitConfirm(true)} className="text-red-400 hover:text-red-300 transition-colors bg-white/5 p-2 rounded-lg">
             <LogOut size={20} />
          </button>
          
          <h1 className="font-serif font-bold text-xl text-yellow-500 hidden md:block">TRI-STACK</h1>
          <div className="bg-slate-800 px-3 py-1 rounded-lg text-xs md:text-sm flex items-center gap-2 border border-white/10">
            <Trophy size={14} className="text-yellow-500" />
            <span className="text-gray-300">Round {gameState.roundNumber}/{gameState.totalRounds}</span>
          </div>
        </div>

        {/* Room Code Indicator (Online) */}
        {gameState.gameMode?.startsWith('ONLINE') && (
           <div className="bg-blue-900/50 px-3 py-1 rounded-lg border border-blue-500/30 text-xs font-mono font-bold text-blue-200">
              ROOM: {roomCode}
           </div>
        )}
        
        <div className="flex items-center gap-2">
           {isSyncing && <RefreshCw size={14} className="animate-spin text-gray-500" />}
           <div className="bg-purple-900/50 px-3 py-1 rounded-lg border border-purple-500/30 flex items-center gap-2 animate-pulse">
             <Sparkles size={14} className="text-purple-400" />
             <span className="text-xs font-bold text-purple-200">Joker: {gameState.roundJoker?.rank}</span>
           </div>
        </div>
      </div>

      {/* Game Area */}
      <div className="flex-1 relative overflow-hidden flex flex-col">
        
        {/* Opponents Area (Top) */}
        <div className="flex-1 flex items-start justify-center pt-4 md:pt-8 px-2 gap-2 md:gap-4 overflow-x-auto no-scrollbar">
          {opponentsToRender.map((player) => {
            const isTurn = gameState.currentPlayerIndex === player.id;
            const isWinner = gameState.phase === GamePhase.MATCH_END && player.totalScore === lowestScore;
            
            return (
              <div 
                key={player.id} 
                className={`
                   relative flex flex-col items-center transition-all duration-300 p-2 rounded-xl border
                   ${isTurn ? 'bg-yellow-500/10 border-yellow-500/50 scale-105' : 'bg-black/20 border-transparent scale-100 opacity-80'}
                   ${isWinner ? 'ring-4 ring-yellow-400 bg-yellow-500/20' : ''}
                   min-w-[80px] md:min-w-[120px]
                `}
              >
                {isTurn && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full animate-bounce z-10">TURN</div>}
                
                {/* Avatar */}
                <div className={`w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center mb-2 shadow-lg border-2 ${isTurn ? 'border-yellow-500 bg-yellow-600' : 'border-slate-600 bg-slate-700'}`}>
                  {player.isBot ? <Bot size={20} className="text-white" /> : <User size={20} className="text-white" />}
                </div>

                <div className="text-xs md:text-sm font-bold text-white mb-1 truncate max-w-[80px]">{player.name}</div>
                
                {/* Score Badge */}
                <div className="bg-black/40 px-2 py-0.5 rounded text-[10px] text-gray-300 mb-2">
                   {player.score} pts (Tot: {player.totalScore})
                </div>

                {/* Hand */}
                <div className="flex -space-x-4 md:-space-x-6">
                  {player.hand.map((card, idx) => (
                    <div key={idx} className="transform origin-bottom hover:-translate-y-2 transition-transform duration-300">
                      <Card 
                        card={showOpponentCards ? { ...card, isJoker: card.rank === gameState.roundJoker?.rank } : undefined} 
                        small 
                        disabled 
                        isJoker={showOpponentCards && card.rank === gameState.roundJoker?.rank}
                      />
                    </div>
                  ))}
                </div>
                
                {/* Action Bubble */}
                {player.lastAction && (
                  <div className="absolute top-10 z-20 bg-white text-black text-[10px] px-2 py-1 rounded-lg shadow-md whitespace-nowrap opacity-90 animate-in fade-in slide-in-from-bottom-2">
                    {player.lastAction}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Center Table (Decks) */}
        <div className="h-32 md:h-48 flex items-center justify-center gap-8 md:gap-16 my-2 shrink-0">
           
           {/* Draw Pile */}
           <div className="relative group">
              <div className="absolute -inset-2 bg-blue-500/20 rounded-xl blur-lg group-hover:bg-blue-500/40 transition-all opacity-0 group-hover:opacity-100" />
              {gameState.deck.length > 0 ? (
                 <div onClick={() => isPlayerTurn && (gameState.phase === GamePhase.PLAYER_DRAW || gameState.phase === GamePhase.PLAYER_TOSSING_DRAW) && handleDraw('DECK')}>
                   {/* Stack effect */}
                   <div className="absolute top-0 left-0 w-20 h-28 md:w-24 md:h-36 bg-blue-900 border-2 border-white rounded-xl transform translate-x-1 translate-y-1" />
                   <div className="absolute top-0 left-0 w-20 h-28 md:w-24 md:h-36 bg-blue-900 border-2 border-white rounded-xl transform translate-x-0.5 translate-y-0.5" />
                   <Card className="relative shadow-2xl" />
                 </div>
              ) : (
                 <div className="w-20 h-28 md:w-24 md:h-36 border-2 border-dashed border-gray-600 rounded-xl flex items-center justify-center">
                    <span className="text-xs text-gray-500">Empty</span>
                 </div>
              )}
              {isPlayerTurn && (gameState.phase === GamePhase.PLAYER_DRAW || gameState.phase === GamePhase.PLAYER_TOSSING_DRAW) && (
                 <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs font-bold text-blue-300 animate-bounce">
                    DRAW
                 </div>
              )}
           </div>

           {/* Discard Pile */}
           <div className="relative group">
              <div className="absolute -inset-2 bg-red-500/20 rounded-xl blur-lg group-hover:bg-red-500/40 transition-all opacity-0 group-hover:opacity-100" />
              {gameState.openDeck.length > 0 ? (
                <div onClick={() => isPlayerTurn && (gameState.phase === GamePhase.PLAYER_DRAW || gameState.phase === GamePhase.PLAYER_TOSSING_DRAW) && handleDraw('OPEN')}>
                  <Card 
                    card={{ ...gameState.openDeck[gameState.openDeck.length - 1], isJoker: gameState.openDeck[gameState.openDeck.length - 1].rank === gameState.roundJoker?.rank }} 
                    isJoker={gameState.openDeck[gameState.openDeck.length - 1].rank === gameState.roundJoker?.rank}
                    className="shadow-2xl rotate-2 hover:rotate-0 transition-transform" 
                  />
                </div>
              ) : (
                <div className="w-20 h-28 md:w-24 md:h-36 border-2 border-dashed border-gray-600 rounded-xl flex items-center justify-center bg-black/20">
                   <span className="text-xs text-gray-500">Discard Pile</span>
                </div>
              )}
              
              {/* Discard Indicator Arrow */}
              {isPlayerTurn && gameState.phase === GamePhase.PLAYER_TURN_START && selectedCardIds.length === 1 && (
                 <div className="absolute -top-10 left-1/2 -translate-x-1/2 text-red-400 animate-bounce flex flex-col items-center">
                    <ArrowRight className="rotate-90" />
                    <span className="text-xs font-bold bg-black/50 px-2 py-0.5 rounded">DISCARD HERE</span>
                 </div>
              )}
           </div>

        </div>

        {/* Player Controls (Bottom) */}
        <div className="bg-[#0f1f0f] p-4 pb-8 md:pb-4 border-t border-white/10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-10 mt-auto">
          <div className="max-w-3xl mx-auto">
            <div className="flex justify-between items-end mb-4">
               <div>
                  <div className="text-yellow-500 font-bold text-lg md:text-2xl flex items-center gap-2">
                     {bottomPlayer.id === currentPlayer.id && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
                     {bottomPlayer.id === currentPlayer.id ? "It's Your Turn" : `${currentPlayer.name}'s Turn`}
                  </div>
                  <div className="text-gray-400 text-xs md:text-sm">
                     {gameState.phase === GamePhase.PLAYER_TURN_START && "Select a card to discard, or pair to toss."}
                     {gameState.phase === GamePhase.PLAYER_DRAW && "Draw a card to finish your turn."}
                     {gameState.phase === GamePhase.PLAYER_TOSSING_DRAW && "Draw cards to refill your hand."}
                  </div>
               </div>
               
               {/* Action Buttons */}
               <div className="flex gap-2">
                  {isPlayerTurn && gameState.phase === GamePhase.PLAYER_TURN_START && (
                    <>
                      <button 
                        onClick={handleToss}
                        disabled={selectedCardIds.length !== 2 || gameState.tossedThisTurn}
                        className={`
                          px-4 py-2 md:px-6 md:py-3 rounded-xl font-bold text-sm md:text-base transition-all flex items-center gap-2
                          ${selectedCardIds.length === 2 && !gameState.tossedThisTurn ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/30' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}
                        `}
                      >
                         <Copy size={18} /> TOSS
                      </button>

                      <button 
                         onClick={handleDiscard}
                         disabled={selectedCardIds.length !== 1}
                         className={`
                           px-4 py-2 md:px-6 md:py-3 rounded-xl font-bold text-sm md:text-base transition-all flex items-center gap-2
                           ${selectedCardIds.length === 1 ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-500/30' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}
                         `}
                      >
                         <Hand size={18} /> DISCARD
                      </button>

                      {/* SHOW Button - Only available if hasn't tossed */}
                      {!gameState.tossedThisTurn && (
                         <button 
                           onClick={handleShow}
                           className="bg-yellow-500 hover:bg-yellow-400 text-black px-4 py-2 md:px-6 md:py-3 rounded-xl font-bold text-sm md:text-base shadow-lg shadow-yellow-500/20 flex items-center gap-2"
                         >
                            <Eye size={18} /> SHOW
                         </button>
                      )}
                    </>
                  )}
               </div>
            </div>

            {/* My Hand */}
            <div className="flex justify-center -space-x-4 md:-space-x-8 pt-4 pb-2">
              {bottomPlayer.hand.map((card) => (
                <div key={card.id} className="transition-all duration-200">
                   <Card 
                     card={{ ...card, isJoker: card.rank === gameState.roundJoker?.rank }} 
                     onClick={() => handleCardClick(card)}
                     selected={selectedCardIds.includes(card.id)}
                     disabled={!isPlayerTurn}
                     isJoker={card.rank === gameState.roundJoker?.rank}
                     className="hover:scale-105"
                   />
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* --- MODALS --- */}

      {/* ROUND END MODAL */}
      {gameState.phase === GamePhase.ROUND_END && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
           <div className="bg-slate-900 border border-yellow-500/30 p-6 md:p-8 rounded-2xl max-w-lg w-full shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-transparent via-yellow-500 to-transparent" />
              
              <div className="text-center mb-6">
                 <h2 className="text-3xl font-serif font-bold text-yellow-500 mb-1">Round Complete!</h2>
                 <p className="text-gray-400 text-sm">Caller was {gameState.players.find(p => p.wasCaller)?.name}</p>
              </div>

              <div className="flex flex-col gap-3 mb-8">
                 {gameState.players
                   .sort((a, b) => a.score - b.score)
                   .map((p, i) => (
                    <div key={p.id} className={`flex items-center justify-between p-3 rounded-xl ${i === 0 ? 'bg-yellow-500/20 border border-yellow-500/50' : 'bg-slate-800 border border-white/5'}`}>
                       <div className="flex items-center gap-3">
                          <span className={`font-bold font-serif w-6 ${i === 0 ? 'text-yellow-500' : 'text-gray-500'}`}>#{i + 1}</span>
                          <span className="font-bold text-white">{p.name}</span>
                          {p.wasCaller && <span className="text-[10px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded uppercase font-bold">Caller</span>}
                       </div>
                       <div className="text-right">
                          <div className="font-bold text-xl text-white">+{p.score}</div>
                          <div className="text-[10px] text-gray-400">Total: {p.totalScore}</div>
                       </div>
                    </div>
                 ))}
              </div>

              {/* Only Host (ID 0) or Local Player can click Next Round */}
              {(!gameState.gameMode?.includes('ONLINE') || myOnlineId === 0) ? (
                 <button onClick={nextRound} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-green-900/20 transition-transform active:scale-95">
                    {isLastRound ? 'See Final Results' : 'Next Round'} <ChevronRight size={20} />
                 </button>
              ) : (
                 <div className="text-center text-gray-500 animate-pulse">Waiting for Host...</div>
              )}
           </div>
        </div>
      )}

      {/* MATCH END MODAL */}
      {gameState.phase === GamePhase.MATCH_END && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur p-4 animate-in zoom-in duration-300">
           <div className="bg-slate-900 border border-yellow-500 p-8 rounded-2xl max-w-md w-full shadow-[0_0_50px_rgba(234,179,8,0.3)] text-center relative">
              <Trophy size={64} className="text-yellow-500 mx-auto mb-4 drop-shadow-[0_0_15px_rgba(234,179,8,0.5)]" />
              <h1 className="text-4xl font-serif font-bold text-white mb-2">Game Over!</h1>
              
              <div className="py-6">
                 <div className="text-gray-400 uppercase tracking-widest text-xs mb-2">WINNER</div>
                 <div className="text-3xl font-bold text-yellow-500 mb-1">
                    {gameState.players.reduce((prev, curr) => (prev.totalScore < curr.totalScore ? prev : curr)).name}
                 </div>
                 <div className="text-sm text-gray-400">Lowest Score: {lowestScore}</div>
              </div>

              <div className="space-y-3">
                 {(!gameState.gameMode?.includes('ONLINE') || myOnlineId === 0) ? (
                    <>
                       <button onClick={handleReturnToLobby} className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl">Play Again</button>
                       <button onClick={clearSession} className="w-full border border-white/10 text-gray-400 hover:text-white py-3 rounded-xl">Main Menu</button>
                    </>
                 ) : (
                    <button onClick={clearSession} className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl">Return to Menu</button>
                 )}
              </div>
           </div>
        </div>
      )}

      {/* EXIT CONFIRMATION MODAL */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
           <div className="bg-slate-900 border border-red-500/30 p-6 rounded-2xl max-w-xs w-full shadow-2xl text-center">
              <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Leave Game?</h2>
              <p className="text-gray-400 text-sm mb-6">Your progress will be lost.</p>
              <div className="flex gap-3">
                 <button onClick={() => setShowExitConfirm(false)} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-2 rounded-lg font-bold">Cancel</button>
                 <button onClick={clearSession} className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 rounded-lg font-bold">Leave</button>
              </div>
           </div>
        </div>
      )}

      {/* TURN LOG TOAST (AUTO-DISMISS) */}
      <div className="fixed bottom-24 md:bottom-8 left-4 z-40 max-w-[200px] pointer-events-none">
         {gameState.turnLog.length > 0 && (
            <div className="bg-black/60 backdrop-blur-md text-white text-xs p-3 rounded-lg border border-white/10 shadow-lg animate-in slide-in-from-left-4 fade-in">
               {gameState.turnLog[gameState.turnLog.length - 1]}
            </div>
         )}
      </div>

    </div>
  );
};

export default App;