import React, { useState, useEffect, useCallback } from 'react';
import { GameState, Player, CardData, GamePhase, GameMode } from './types';
import { createDeck, decideBotAction, shuffleDeck } from './services/gameLogic';
import { BOT_NAMES } from './constants';
import Auth from './components/Auth';
import { supabase, signOut } from './services/supabase';
import { createInitialGameState } from './state/initialState';
import { gameReducer, GameAction } from './state/gameReducer';
import { useRoundInput } from './state/useRoundInput';
import { useOnlineRoom } from './state/useOnlineRoom';
import { LoadingScreen } from './components/ui';
import Transition from './screens/Transition';
import OnlineSelect from './screens/OnlineSelect';
import RoundSelect from './screens/RoundSelect';
import NameEntry from './screens/NameEntry';
import Lobby from './screens/Lobby';
import MainMenu from './screens/MainMenu';
import GameTable from './screens/GameTable';

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

  // --- Online Room (identity, lobby, realtime sync, reconnect) ---
  const online = useOnlineRoom({
    session,
    gameMode: gameState.gameMode,
    setGameState,
    setIsGuest,
    getDisplayName,
    onGameStarted: () => { setIsNameEntryStep(false); setShowOnlineSelection(false); }
  });
  const {
    roomCode, joinCodeInput, setJoinCodeInput, myOnlineId, onlineHostId,
    onlineLobbyPlayers, isOnlineLobby, isSyncing, isReconnecting, isJoining,
    syncOnlineState
  } = online;

  // Full reset: drop the room, then clear game and menu state.
  const clearSession = () => {
    online.leave();
    setGameState(createInitialGameState());
    setSelectedCardIds([]);
    setIsTransitioning(false);
    setIsNameEntryStep(false);
    setShowMultiplayerSelection(false);
    setShowOnlineSelection(false);
    setShowRoundSelectionSP(false);
    setShowExitConfirm(false);
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

  // --- ONLINE SETUP ---
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

  // --- LOCAL SETUP FLOWS ---
  const openSinglePlayerSetup = () => {
    setShowRoundSelectionSP(true);
    // Removed forced reset to 5 here to respect user choice
  };

  const startSinglePlayerMatch = (rounds: number) => {
    setSelectedTotalRounds(rounds);
    const playerName = getDisplayName();
    
    // Pick 3 random names from the pool for bots
    const selectedBotNames = shuffleDeck([...BOT_NAMES]).slice(0, 3).map(name => "Bot " + name);
    
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
      // By seat, not id: online, ids stop matching seats once someone leaves.
      const callerIndex = existingPlayers.findIndex(p => p.wasCaller);
      const caller = existingPlayers[callerIndex];

      if (caller) {
        startingPlayerIndex = callerIndex;
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
      gameMode: (mode || gameState.gameMode) as GameMode,
      // A new match restarts versions under a new id; later rounds continue them.
      gameId: roundNum === 1 ? Date.now() : gameState.gameId,
      version: roundNum === 1 ? 1 : (gameState.version ?? 0) + 1
    };

    setGameState(newState);

    // IF ONLINE HOST: PUSH STATE
    if (mode === 'ONLINE_HOST' || gameState.gameMode === 'ONLINE_HOST') {
      syncOnlineState(newState);
    }

    setSelectedCardIds([]);
    setIsTransitioning(!!(mode === 'MULTIPLAYER' || (existingPlayers && gameState.gameMode === 'MULTIPLAYER')));
  }, [gameState.gameMode, setupPlayerCount, gameState.playerNames, selectedTotalRounds, syncOnlineState, gameState, getDisplayName]);

  // Initialize Local Games
  useEffect(() => {
    if (gameState.phase === GamePhase.SETUP && gameState.gameMode && gameState.gameMode !== 'ONLINE_HOST' && gameState.gameMode !== 'ONLINE_CLIENT') {
      startRound(1, undefined, gameState.gameMode);
    }
  }, [gameState.phase, gameState.gameMode, startRound]);


  // Apply a turn transition and its side effects. Returns false when the
  // reducer could not apply it (e.g. nothing left to draw).
  const applyAction = (action: GameAction): boolean => {
    const next = gameReducer(gameState, action);
    if (next === gameState) return false;

    setGameState(next);
    syncOnlineState(next);

    // finishTurn used to hide the board between hotseat turns; SHOW revealed it.
    if (action.type === 'DRAW' && gameState.gameMode === 'MULTIPLAYER') setIsTransitioning(true);
    if (action.type === 'SHOW') setIsTransitioning(false);
    return true;
  };

  // --- BOT LOGIC ---
  useEffect(() => {
    if (!isBotThinking) return;

    const timeout = setTimeout(() => {
      const p = currentPlayer;

      if (gameState.phase === GamePhase.PLAYER_TURN_START) {
        const action = decideBotAction(p, gameState.roundJoker, gameState.tossedThisTurn);
        if (action.type === 'SHOW') {
          applyAction({ type: 'SHOW', playerId: p.id });
        } else if (action.type === 'TOSS' && action.cardIds) {
          applyAction({ type: 'TOSS', playerId: p.id, cardIds: action.cardIds });
        } else if (action.type === 'DISCARD' && action.cardIds) {
          applyAction({ type: 'DISCARD', playerId: p.id, cardId: action.cardIds[0] });
        }
      } else if (gameState.phase === GamePhase.PLAYER_DRAW || gameState.phase === GamePhase.PLAYER_TOSSING_DRAW) {
        // A failed draw is a no-op, matching the original bot's bare `return`.
        applyAction({ type: 'DRAW', playerId: p.id, source: 'DECK' });
      }
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

    const cards = currentPlayer.hand.filter(c => selectedCardIds.includes(c.id));
    if (cards[0].rank !== cards[1].rank) {
      alert("Must toss a pair of the same rank!");
      return;
    }

    applyAction({ type: 'TOSS', playerId: currentPlayer.id, cardIds: selectedCardIds });
    setSelectedCardIds([]);
  };

  const handleDiscard = () => {
    if (selectedCardIds.length !== 1) return;

    applyAction({ type: 'DISCARD', playerId: currentPlayer.id, cardId: selectedCardIds[0] });
    setSelectedCardIds([]);
  };

  const handleShow = () => {
    applyAction({ type: 'SHOW', playerId: currentPlayer.id });
  };

  const handleDraw = (source: 'DECK' | 'OPEN') => {
    const p = currentPlayer;

    // Both refusals below are UI concerns, so they stay at the call site.
    if (source === 'OPEN') {
      const topCard = gameState.openDeck[gameState.openDeck.length - 1];
      if (gameState.phase === GamePhase.PLAYER_DRAW && topCard && topCard.id === gameState.lastDiscardedId) {
        if (!p.isBot) alert("Cannot pick up the card you just discarded!");
        return;
      }
    } else if (gameState.deck.length === 0 && gameState.openDeck.length <= 1) {
      alert("No cards left in Deck or Open Pile! Ending round.");
      handleShow(); 
      return;
    }

    applyAction({ type: 'DRAW', playerId: p.id, source });
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
      onCreate={online.createGame}
      onJoin={online.joinGame}
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
    handleKickPlayer={online.kickPlayer}
    handleReturnToLobby={online.returnToLobby}
    nextRound={nextRound}
    clearSession={clearSession}
  />;
};

export default App;