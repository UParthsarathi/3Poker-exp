import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, Player, CardData, GamePhase, GameMode } from './types';
import { createDeck, getRoundScores, calculateHandValue, decideBotAction } from './services/gameLogic';
import { createRoom, joinRoom, subscribeToRoom, updateGameState, getRoomData, resetRoomToLobby } from './services/online';
import { DEFAULT_TOTAL_ROUNDS } from './constants';
import Card from './components/Card';
import Auth from './components/Auth';
import { supabase, signOut } from './services/supabase';
import { RefreshCw, Trophy, Users, AlertCircle, Hand, ChevronRight, EyeOff, Eye, User, Bot, ArrowRight, ChevronLeft, Play, Hash, Sparkles, LogOut, Globe, Wifi, Copy, CloudUpload, Lock } from 'lucide-react';

const SESSION_KEY = 'TRI_STACK_SESSION';

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

  // Online Specific State
  const [roomCode, setRoomCode] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [myOnlineId, setMyOnlineId] = useState<number | null>(null); // Who am I?
  const [onlineLobbyPlayers, setOnlineLobbyPlayers] = useState<{id: number, name: string}[]>([]);
  const [isOnlineLobby, setIsOnlineLobby] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false); // Visual indicator for online ops
  const [isReconnecting, setIsReconnecting] = useState(false); // Loading state for refresh logic
  
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
    // 1. Clear Persistence
    localStorage.removeItem(SESSION_KEY);
    
    // 2. Reset Online State
    setRoomCode('');
    setMyOnlineId(null);
    setOnlineLobbyPlayers([]);
    setIsOnlineLobby(false);
    
    // 3. Reset Game State to Defaults (Soft Reset)
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
    
    // 4. Reset UI States
    setSelectedCardIds([]);
    setIsTransitioning(false);
    setIsNameEntryStep(false);
    setShowMultiplayerSelection(false);
    setShowOnlineSelection(false);
    setShowRoundSelectionSP(false);
    setShowExitConfirm(false);
    setIsSyncing(false);
    setIsReconnecting(false);

    // No window.location.reload() - this prevents white screen crash
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
    const hostName = session?.user?.email?.split('@')[0] || 'Host';
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
    if (joinCodeInput.length !== 4) return alert("Enter a 4-letter code");
    const myName = session?.user?.email?.split('@')[0] || 'Guest';
    
    const { success, error, playerId, players } = await joinRoom(joinCodeInput.toUpperCase(), myName);
    
    if (!success) {
      alert(error);
      return;
    }

    const code = joinCodeInput.toUpperCase();
    setRoomCode(code);
    setMyOnlineId(playerId!);
    saveSession(code, playerId!); // PERSIST SESSION

    setOnlineLobbyPlayers(players!);
    setIsOnlineLobby(true);
    setGameState(prev => ({ ...prev, gameMode: 'ONLINE_CLIENT' }));
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
    const playerName = session?.user?.email?.split('@')[0] || 'You';
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

    if (existingPlayers) {
      players = existingPlayers.map(p => ({ 
        ...p, 
        hand: [], 
        score: 0,
        // CRITICAL: Preserve totalScore, default to 0 if undefined to prevent NaN
        totalScore: p.totalScore || 0,
        lastAction: 'Waiting...' 
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
      currentPlayerIndex: 0, 
      roundJoker,
      roundNumber: roundNum,
      totalRounds: selectedTotalRounds,
      phase: GamePhase.PLAYER_TURN_START,
      turnLog: [`Round ${roundNum} started! Joker is ${roundJoker.rank}`],
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
                totalScore: (pl.totalScore || 0) + (roundRes?.roundScore || 0) 
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
        lastAction: p.id === currentPlayer.id ? 'CALLED SHOW!' : 'Revealed'
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
                    <Users size={16}/> Players Joined ({onlineLobbyPlayers.length}/7)
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
        
        {/* User Info Bar */}
        <div className="absolute top-4 right-4 flex items-center gap-2 text-sm bg-black/30 p-2 rounded-lg backdrop-blur">
          <User size={16} className="text-green-400" />
          <span className="text-gray-300">{isGuest ? 'Guest' : (session?.user?.email?.split('@')[0] || 'Logged In')}</span>
          {!isGuest && <button onClick={signOut} className="ml-2 text-red-400 hover:text-red-300"><LogOut size={16} /></button>}
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
                 {[2, 3, 4, 5, 6, 7].map(count => (
                   <button key={count} onClick={() => initMultiplayerSetup(count)} className="bg-slate-700 hover:bg-green-600 text-white p-4 rounded-xl font-bold flex items-center justify-center transition-all group">
                     <span className="flex items-center gap-2"><Users size={16} className="text-gray-400 group-hover:text-white" />{count}</span>
                   </button>
                 ))}
               </div>
             </>
           )}
        </div>
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
                    <button onClick={handleJoinOnlineGame} className="bg-blue-600 hover:bg-blue-500 text-white px-6 rounded-lg font-bold">JOIN</button>
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
          <div className="bg-slate-800 px-3 py-1 rounded-lg text-xs md:text-sm flex items-center gap-2">
             <span className="text-gray-400">Round</span>
             <span className="font-bold text-white">{gameState.roundNumber}/{gameState.totalRounds}</span>
          </div>
          {/* Room Code Display if Online */}
          {(gameState.gameMode === 'ONLINE_HOST' || gameState.gameMode === 'ONLINE_CLIENT') && (
             <div className="flex items-center gap-2">
                <div className="bg-blue-900/50 px-3 py-1 rounded-lg text-xs md:text-sm flex items-center gap-2 border border-blue-500/30">
                  <Globe size={12} className="text-blue-400" />
                  <span className="font-mono font-bold text-blue-200">{roomCode}</span>
                </div>
                {isSyncing && (
                  <div className="text-yellow-500 animate-pulse flex items-center gap-1 text-xs font-bold">
                    <CloudUpload size={14} /> <span className="hidden sm:inline">Syncing...</span>
                  </div>
                )}
             </div>
          )}
        </div>
        
        {/* Joker Display */}
        <div className="flex items-center gap-2">
           <span className="text-xs uppercase tracking-widest text-purple-400 font-bold hidden sm:inline">All {gameState.roundJoker?.rank}s are Jokers</span>
           <span className="text-xs uppercase tracking-widest text-purple-400 font-bold sm:hidden">Joker: {gameState.roundJoker?.rank}</span>
           {gameState.roundJoker && <div className="flex bg-white text-black px-2 py-1 rounded border-2 border-purple-500 items-center gap-1"><span className="font-bold">{gameState.roundJoker.rank}</span></div>}
        </div>

        <div className="flex items-center gap-4">
           {/* Current Turn Indicator */}
           <div className="flex items-center gap-2">
             <div className={`w-3 h-3 rounded-full ${isBotThinking ? 'bg-yellow-500' : 'bg-green-500'} animate-pulse`} />
             <span className="text-sm font-bold truncate max-w-[100px] text-white">{currentPlayer.name} {isBotThinking && '...'}</span>
           </div>
        </div>
      </div>

      {/* Game Area */}
      <div className="flex-1 relative flex flex-col justify-between p-2 md:p-4 max-w-7xl mx-auto w-full overflow-hidden">
        
        {/* Opponents (Top Row - Dynamic) */}
        <div className="flex justify-center flex-wrap gap-2 md:gap-8 mb-2 max-h-[30vh] overflow-y-auto">
           {opponentsToRender.map(opp => (
             <div key={opp.id} className={`flex flex-col items-center p-2 rounded-lg transition-all ${opp.id === gameState.currentPlayerIndex ? 'bg-yellow-500/10 scale-105 border border-yellow-500/30' : 'bg-black/20'}`}>
                <div className="relative">
                   <div className="w-10 h-10 md:w-12 md:h-12 bg-slate-700 rounded-full flex items-center justify-center border-2 border-slate-500">
                     {opp.isBot ? <Bot size={20} className="text-slate-300" /> : <Users size={20} className="text-slate-300" />}
                   </div>
                   {opp.hand && <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-blue-900 rounded-full flex items-center justify-center text-[10px] font-bold border border-white">{opp.hand.length}</div>}
                </div>
                <span className="text-xs font-bold mt-1 max-w-[60px] truncate">{opp.name}</span>
                <span className="text-[10px] text-yellow-400">{opp.totalScore || 0} pts</span>
                
                {gameState.phase === GamePhase.ROUND_END && (
                  <div className="absolute top-10 z-30 flex gap-1 bg-black/80 p-1 rounded shadow-2xl animate-in fade-in zoom-in">
                     {(opp.hand || []).map((c, i) => (<Card key={c.id || i} card={showOpponentCards ? c : undefined} small isJoker={gameState.roundJoker ? (c.rank === gameState.roundJoker.rank) : false} />))}
                     <div className="bg-white text-black text-xs font-bold p-1 rounded flex items-center">{calculateHandValue(opp.hand || [], gameState.roundJoker)}</div>
                  </div>
                )}
                
                {gameState.phase !== GamePhase.ROUND_END && (
                  <div className="flex -space-x-4 mt-2">
                     {(opp.hand || []).map((c, i) => (<Card key={i} small className="scale-75" />))}
                  </div>
                )}
             </div>
           ))}
        </div>

        {/* Center Table (Decks) */}
        <div className="flex-1 flex items-center justify-center gap-4 md:gap-16 my-2 relative">
            <div className="flex flex-col items-center gap-2">
               <Card disabled={!isPlayerTurn || (gameState.phase !== GamePhase.PLAYER_DRAW && gameState.phase !== GamePhase.PLAYER_DRAW && gameState.phase !== GamePhase.PLAYER_TOSSING_DRAW)} onClick={() => handleDraw('DECK')} />
               <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Deck ({gameState.deck.length})</span>
            </div>

            <div className="flex gap-4 items-center">
              <div className="flex flex-col items-center gap-2 relative">
                 {gameState.openDeck.length > 0 ? (
                   <Card 
                     card={gameState.openDeck[gameState.openDeck.length - 1]}
                     isJoker={gameState.roundJoker && gameState.openDeck[gameState.openDeck.length - 1].rank === gameState.roundJoker.rank}
                     onClick={() => handleDraw('OPEN')}
                     disabled={!isPlayerTurn || (gameState.phase !== GamePhase.PLAYER_DRAW && gameState.phase !== GamePhase.PLAYER_TOSSING_DRAW)}
                   />
                 ) : (
                   <div className="w-20 h-28 md:w-24 md:h-36 border-2 border-dashed border-white/20 rounded-xl flex items-center justify-center"><span className="text-white/20 text-xs">Empty</span></div>
                 )}
                 <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Open Pile</span>
              </div>

              {gameState.pendingDiscard && (
                <div className="flex flex-col items-center gap-2 relative animate-in slide-in-from-left-4 fade-in">
                  <div className="relative">
                    <Card card={gameState.pendingDiscard} isJoker={gameState.roundJoker && gameState.pendingDiscard.rank === gameState.roundJoker.rank} disabled={true} className="opacity-70 ring-2 ring-yellow-500/50" />
                    <div className="absolute inset-0 flex items-center justify-center"><ArrowRight className="text-white drop-shadow-lg" size={32} /></div>
                  </div>
                  <span className="text-xs uppercase tracking-wider font-bold text-yellow-400 animate-pulse">Discarding...</span>
                </div>
              )}

              {gameState.pendingToss.length > 0 && (
                 <div className="flex flex-col items-center gap-1 relative animate-in slide-in-from-left-4 fade-in">
                    <div className="relative flex -space-x-8">
                       {gameState.pendingToss.map(c => (<Card key={c.id} card={c} isJoker={gameState.roundJoker && c.rank === gameState.roundJoker.rank} disabled={true} className="opacity-70 ring-2 ring-blue-500/50" />))}
                       <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><RefreshCw className="text-white drop-shadow-lg animate-spin" size={32} /></div>
                    </div>
                    <span className="text-xs uppercase tracking-wider font-bold text-blue-400 animate-pulse">Tossing...</span>
                 </div>
              )}
            </div>

            {gameState.phase === GamePhase.ROUND_END && (
               <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                 <div className="bg-slate-900/95 p-6 rounded-2xl shadow-2xl border border-yellow-500/30 backdrop-blur-sm max-w-sm w-full text-center m-4 animate-in fade-in zoom-in">
                    <h2 className="text-2xl font-serif font-bold text-white mb-1">{isLastRound ? "Match Complete" : "Round Over"}</h2>
                    <p className="text-gray-400 mb-6 text-xs uppercase tracking-widest">{isLastRound ? "Final Standings" : "Round Summary"}</p>
                    
                    <div className="space-y-3 mb-8 text-left max-h-[50vh] overflow-y-auto pr-1">
                       {gameState.players
                         .sort((a, b) => isLastRound ? (a.totalScore - b.totalScore) : 0)
                         .map(p => {
                           const isWinner = isLastRound && (p.totalScore || 0) === lowestScore;
                           return (
                             <div key={p.id} className={`flex justify-between items-center p-3 rounded-lg border ${isWinner ? 'bg-yellow-500/10 border-yellow-500/50' : 'bg-slate-800 border-white/5'}`}>
                                <span className={`flex items-center gap-2 ${p.id === gameState.currentPlayerIndex ? 'text-blue-400 font-bold' : (isWinner ? 'text-yellow-400 font-bold' : 'text-gray-300')}`}>
                                  {isWinner && <Trophy size={14} className="text-yellow-500" />} {p.name} {p.id === gameState.currentPlayerIndex && <span className="text-xs bg-blue-900 text-blue-200 px-1 rounded">CALLER</span>}
                                </span>
                                <div className="flex items-center gap-3">
                                   <div className="flex flex-col items-end">
                                      <span className="text-[10px] uppercase text-gray-500 font-bold">Round</span>
                                      <span className="text-sm font-bold text-red-400">+{p.score || 0}</span>
                                   </div>
                                   <div className="w-px h-8 bg-white/10"></div>
                                   <div className="flex flex-col items-end min-w-[40px]">
                                       <span className="text-[10px] uppercase text-gray-500 font-bold">Total</span>
                                       <span className={`text-lg font-bold ${isWinner ? 'text-yellow-400' : 'text-white'}`}>{p.totalScore || 0}</span>
                                   </div>
                                </div>
                             </div>
                           );
                       })}
                    </div>
                    {/* ONLY HOST CAN ADVANCE ONLINE GAME */}
                    {((gameState.gameMode !== 'ONLINE_CLIENT' && gameState.gameMode !== 'ONLINE_HOST') || (gameState.gameMode === 'ONLINE_HOST' && myOnlineId === 0)) && (
                       <button 
                         onClick={isLastRound ? (gameState.gameMode === 'ONLINE_HOST' ? handleReturnToLobby : clearSession) : nextRound} 
                         className={`w-full font-bold py-3 rounded-lg flex items-center justify-center gap-2 ${isLastRound ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-yellow-500 hover:bg-yellow-400 text-black'}`}
                       >
                         {isLastRound ? (gameState.gameMode === 'ONLINE_HOST' ? 'Return to Lobby' : 'Back to Menu') : 'Next Round'} {isLastRound ? <RefreshCw size={18} /> : <ChevronRight size={18} />}
                       </button>
                    )}
                    {gameState.gameMode === 'ONLINE_CLIENT' && (
                       <div className="flex flex-col gap-2">
                          <div className="text-sm text-yellow-500 animate-pulse">{isLastRound ? 'Waiting for Host to return to lobby...' : 'Waiting for Host...'}</div>
                          <button onClick={clearSession} className="text-red-400 hover:text-red-300 text-sm underline">Leave Room</button>
                       </div>
                    )}
                 </div>
               </div>
            )}
        </div>

        {/* ACTIVE PLAYER Controls & Hand (BOTTOM) */}
        <div className="flex flex-col items-center gap-4 pb-8 shrink-0">
           {isPlayerTurn && currentPlayer.id === bottomPlayer.id ? (
             <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md p-2 rounded-full border border-white/10 shadow-xl transition-all animate-in slide-in-from-bottom-4 z-10 scale-90 md:scale-100">
                {gameState.phase === GamePhase.PLAYER_TURN_START && (
                  <>
                    <button onClick={handleShow} className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-full font-bold flex items-center gap-2 text-xs md:text-sm shadow-lg shadow-red-900/50"><AlertCircle size={16} /> SHOW</button>
                    <div className="w-px h-6 bg-white/20 mx-1"></div>
                    <button onClick={handleToss} disabled={selectedCardIds.length !== 2 || gameState.tossedThisTurn} className={`px-4 py-2 rounded-full font-bold flex items-center gap-2 text-xs md:text-sm transition-all ${selectedCardIds.length === 2 && !gameState.tossedThisTurn ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/50' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}><RefreshCw size={16} /> TOSS (2)</button>
                    <button onClick={handleDiscard} disabled={selectedCardIds.length !== 1} className={`px-4 py-2 rounded-full font-bold flex items-center gap-2 text-xs md:text-sm transition-all ${selectedCardIds.length === 1 ? 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/50' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}><Hand size={16} /> DISCARD (1)</button>
                  </>
                )}
                {(gameState.phase === GamePhase.PLAYER_DRAW || gameState.phase === GamePhase.PLAYER_TOSSING_DRAW) && (
                   <div className="px-4 py-2 text-white font-bold text-sm animate-pulse flex items-center gap-2"><div className="w-2 h-2 bg-yellow-400 rounded-full" />{gameState.phase === GamePhase.PLAYER_TOSSING_DRAW ? 'Toss complete. Draw a card!' : 'Draw to finish turn...'}</div>
                )}
             </div>
           ) : (
             <div className="h-10 flex items-center justify-center text-gray-400 text-sm italic">
                {currentPlayer.isBot ? 'Opponent is thinking...' : (currentPlayer.id !== bottomPlayer.id ? `Waiting for ${currentPlayer.name}...` : 'Waiting...')}
             </div>
           )}

           <div className="flex items-end justify-center -space-x-4 md:-space-x-6 h-[140px] md:h-[160px]">
              {(bottomPlayer.hand || []).map((card) => (
                <Card 
                  key={card.id} 
                  card={(!isPlayerTurn && gameState.gameMode === 'MULTIPLAYER') ? undefined : card} 
                  isJoker={gameState.roundJoker ? (card.rank === gameState.roundJoker.rank) : false}
                  selected={selectedCardIds.includes(card.id)}
                  onClick={() => handleCardClick(card)}
                  className={`transition-all origin-bottom ${isPlayerTurn && currentPlayer.id === bottomPlayer.id ? 'hover:z-20' : 'opacity-80'}`}
                />
              ))}
           </div>
           <div className="text-xs text-gray-400 mt-2"><span className="text-green-400 font-bold uppercase tracking-wider">{bottomPlayer.name}</span> • Total Score: <span className="text-white font-bold text-lg">{bottomPlayer.totalScore || 0}</span></div>
        </div>
      </div>

      {/* Exit Confirmation Modal */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-red-500/30 p-6 rounded-2xl max-w-sm w-full text-center shadow-2xl">
             <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <LogOut size={32} className="text-red-500" />
             </div>
             <h2 className="text-xl font-bold text-white mb-2">Leave Game?</h2>
             <p className="text-gray-400 text-sm mb-6">Your progress will be lost. You cannot rejoin the same session easily.</p>
             <div className="flex gap-3">
                <button onClick={() => setShowExitConfirm(false)} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold">Cancel</button>
                <button onClick={() => { clearSession(); setShowExitConfirm(false); }} className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold">Exit</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;