import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, Player, CardData, GamePhase, GameMode } from './types';
import { createDeck, getRoundScores, calculateHandValue, decideBotAction } from './services/gameLogic';
import { DEFAULT_TOTAL_ROUNDS } from './constants';
import Card from './components/Card';
import Auth from './components/Auth';
import { supabase, signOut } from './services/supabase';
import { RefreshCw, Trophy, Users, AlertCircle, Hand, ChevronRight, EyeOff, Eye, User, Bot, ArrowRight, ChevronLeft, Play, Hash, Sparkles, LogOut } from 'lucide-react';

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
  const [showRoundSelectionSP, setShowRoundSelectionSP] = useState(false); // New state for SP round select
  const [setupPlayerCount, setSetupPlayerCount] = useState(4);
  const [selectedTotalRounds, setSelectedTotalRounds] = useState(DEFAULT_TOTAL_ROUNDS); // New state for round count
  const [isNameEntryStep, setIsNameEntryStep] = useState(false);
  const [customPlayerNames, setCustomPlayerNames] = useState<string[]>([]);

  // --- Auth Effect ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    }).catch((err) => {
      console.warn("Supabase auth check failed (likely missing keys):", err);
      // If auth fails (e.g. missing API keys), stop loading so user can play as guest
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // --- Helpers ---
  const currentPlayer = gameState.players[gameState.currentPlayerIndex] || {};
  
  // Perspective Logic
  // Single Player: Human (Player 0) is ALWAYS at bottom.
  // Multiplayer: Current Player is ALWAYS at bottom (Hotseat).
  let bottomPlayer = currentPlayer;
  let opponentsToRender = gameState.players.filter(p => p.id !== currentPlayer.id);

  if (gameState.gameMode === 'SINGLE_PLAYER' && gameState.players.length > 0) {
    bottomPlayer = gameState.players[0]; // Human
    opponentsToRender = gameState.players.filter(p => p.id !== 0); // Bots
  }

  // In multiplayer, it's always a "Player Turn" unless the round/match ended
  const isPlayerTurn = !isTransitioning && !currentPlayer.isBot && gameState.phase !== GamePhase.ROUND_END && gameState.phase !== GamePhase.MATCH_END;
  const isBotThinking = gameState.gameMode === 'SINGLE_PLAYER' && currentPlayer.isBot && !isTransitioning && gameState.phase !== GamePhase.ROUND_END;
  
  // Auto-scroll log
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [gameState.turnLog]);

  // --- Game Loop: Start Match Setup ---
  
  // 1. Single Player Setup Flow
  const openSinglePlayerSetup = () => {
    setShowRoundSelectionSP(true);
    setSelectedTotalRounds(5); // Reset to default
  };

  const startSinglePlayerMatch = (rounds: number) => {
    setSelectedTotalRounds(rounds);
    // Hardcoded names for Single Player
    // If logged in, use their email/name as Player 1
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

  // 2. Multiplayer Setup Flow
  const initMultiplayerSetup = (count: number) => {
    setSetupPlayerCount(count);
    setSelectedTotalRounds(5); // Reset to default
    // Initialize empty names
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
    
    // Select Joker
    const jokerIndex = Math.floor(Math.random() * newDeck.length);
    const roundJoker = { ...newDeck[jokerIndex] };
    
    // Initialize Players based on Mode
    let players: Player[] = [];

    if (existingPlayers) {
      players = existingPlayers.map(p => ({ 
        ...p, 
        hand: [], 
        score: 0, 
        lastAction: 'Waiting...' 
      }));
    } else {
      // New Game
      if (mode === 'SINGLE_PLAYER') {
        // Names are already in gameState.playerNames from initSinglePlayer
        const names = gameState.playerNames.length > 0 ? gameState.playerNames : ['You', 'Bot Alpha', 'Bot Beta', 'Bot Gamma'];
        players = [
          { id: 0, name: names[0], isBot: false, hand: [], score: 0, totalScore: 0, lastAction: 'Waiting...' },
          { id: 1, name: names[1], isBot: true, hand: [], score: 0, totalScore: 0, lastAction: 'Waiting...' },
          { id: 2, name: names[2], isBot: true, hand: [], score: 0, totalScore: 0, lastAction: 'Waiting...' },
          { id: 3, name: names[3], isBot: true, hand: [], score: 0, totalScore: 0, lastAction: 'Waiting...' }
        ];
      } else {
        // Multiplayer
        const count = setupPlayerCount > 0 ? setupPlayerCount : 4;
        const names = gameState.playerNames.length > 0 ? gameState.playerNames : Array.from({ length: count }, (_, i) => `Player ${i + 1}`);
        
        players = Array.from({ length: count }, (_, i) => ({
          id: i,
          name: names[i],
          isBot: false,
          hand: [],
          score: 0,
          totalScore: 0,
          lastAction: 'Waiting...'
        }));
      }
    }

    // Deal cards
    players.forEach(p => {
      p.hand = newDeck.splice(0, 3);
    });

    setGameState(prev => ({
      ...prev,
      deck: newDeck,
      openDeck: [],
      players,
      currentPlayerIndex: 0, 
      roundJoker,
      roundNumber: roundNum,
      totalRounds: selectedTotalRounds, // Use the selected number of rounds
      phase: GamePhase.PLAYER_TURN_START,
      turnLog: [`Round ${roundNum} started! Joker is ${roundJoker.rank}`], // Updated Log
      winner: null,
      lastDiscardedId: null,
      tossedThisTurn: false,
      pendingDiscard: null,
      pendingToss: []
    }));
    
    setSelectedCardIds([]);
    // Only transition if it's multiplayer
    setIsTransitioning(mode === 'MULTIPLAYER' || (existingPlayers && gameState.gameMode === 'MULTIPLAYER'));
  }, [gameState.gameMode, setupPlayerCount, gameState.playerNames, selectedTotalRounds]);

  // Initialize
  useEffect(() => {
    if (gameState.phase === GamePhase.SETUP && gameState.gameMode) {
      startRound(1, undefined, gameState.gameMode);
    }
  }, [gameState.phase, gameState.gameMode, startRound]);


  // --- BOT LOGIC ---
  useEffect(() => {
    if (!isBotThinking) return;

    const timeout = setTimeout(() => {
      const p = currentPlayer;
      
      // Phase 1: Toss or Discard/Show
      if (gameState.phase === GamePhase.PLAYER_TURN_START) {
        const action = decideBotAction(p, gameState.roundJoker, gameState.tossedThisTurn);
        
        if (action.type === 'SHOW') {
          handleShow();
        } else if (action.type === 'TOSS' && action.cardIds) {
          // Execute Toss
          const tossedCards = p.hand.filter(c => action.cardIds?.includes(c.id));
          const newHand = p.hand.filter(c => !action.cardIds?.includes(c.id));
          
          setGameState(prev => ({
            ...prev,
            players: prev.players.map(pl => pl.id === p.id ? { ...pl, hand: newHand, lastAction: `Tossed pair` } : pl),
            // Tossed cards go to pendingToss, NOT openDeck yet, to prevent drawing own toss
            pendingToss: tossedCards,
            phase: GamePhase.PLAYER_TOSSING_DRAW,
            tossedThisTurn: true,
            turnLog: [...prev.turnLog, `${p.name} tossed a pair`]
          }));
        } else if (action.type === 'DISCARD' && action.cardIds) {
          // Execute Discard
          const cardToDiscard = p.hand.find(c => c.id === action.cardIds![0])!;
          const newHand = p.hand.filter(c => c.id !== cardToDiscard.id);
          
          setGameState(prev => ({
            ...prev,
            players: prev.players.map(pl => pl.id === p.id ? { ...pl, hand: newHand, lastAction: `Discarded` } : pl),
            pendingDiscard: cardToDiscard, // Put in pending, don't block open deck yet
            lastDiscardedId: cardToDiscard.id,
            phase: GamePhase.PLAYER_DRAW,
            turnLog: [...prev.turnLog, `${p.name} discarded ${cardToDiscard.rank}${cardToDiscard.suit}`]
          }));
        }
      } 
      // Phase 2: Draw
      else if (gameState.phase === GamePhase.PLAYER_DRAW || gameState.phase === GamePhase.PLAYER_TOSSING_DRAW) {
        // Bot always draws from Deck for simplicity
        // Unless it's a toss draw, then logic is same
        handleDraw('DECK');
      }

    }, 1500); // Thinking delay

    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.phase, gameState.currentPlayerIndex, isBotThinking]);


  // --- Actions ---

  const handleCardClick = (card: CardData) => {
    if (!isPlayerTurn) return;

    if (gameState.phase === GamePhase.PLAYER_TURN_START) {
      // Toggle selection for Toss or Discard
      setSelectedCardIds(prev => {
        if (prev.includes(card.id)) return prev.filter(id => id !== card.id);
        if (prev.length >= 2) return [prev[1], card.id]; // Keep max 2
        return [...prev, card.id];
      });
    }
  };

  const handleToss = () => {
    if (selectedCardIds.length !== 2) return;
    if (gameState.tossedThisTurn) return;
    
    const p = currentPlayer;
    const cards = p.hand.filter(c => selectedCardIds.includes(c.id));
    
    // Validate Pair
    if (cards[0].rank !== cards[1].rank) {
      alert("Must toss a pair of the same rank!");
      return;
    }

    // Execute Toss
    const newHand = p.hand.filter(c => !selectedCardIds.includes(c.id));
    
    setGameState(prev => ({
      ...prev,
      players: prev.players.map(pl => pl.id === p.id ? { ...pl, hand: newHand, lastAction: `Tossed ${cards[0].rank}s` } : pl),
      // MOVE TO PENDING TOSS
      // This removes them from hand but keeps Open Deck accessible for the Draw step
      pendingToss: cards,
      phase: GamePhase.PLAYER_TOSSING_DRAW, // Must draw immediately
      tossedThisTurn: true,
      turnLog: [...prev.turnLog, `${p.name} tossed a pair of ${cards[0].rank}s`]
    }));
    setSelectedCardIds([]);
  };

  const handleDiscard = () => {
    if (selectedCardIds.length !== 1) return;

    const p = currentPlayer;
    const cardToDiscard = p.hand.find(c => c.id === selectedCardIds[0]);
    if (!cardToDiscard) return;

    const newHand = p.hand.filter(c => c.id !== selectedCardIds[0]);

    // MOVE TO PENDING DISCARD
    // This removes it from hand but keeps Open Deck accessible for the Draw step
    setGameState(prev => ({
      ...prev,
      players: prev.players.map(pl => pl.id === p.id ? { ...pl, hand: newHand, lastAction: `Discarded ${cardToDiscard.rank}${cardToDiscard.suit}` } : pl),
      pendingDiscard: cardToDiscard,
      lastDiscardedId: cardToDiscard.id,
      phase: GamePhase.PLAYER_DRAW,
      turnLog: [...prev.turnLog, `${p.name} discarded ${cardToDiscard.rank}${cardToDiscard.suit}`]
    }));
    setSelectedCardIds([]);
  };

  const handleDraw = (source: 'DECK' | 'OPEN') => {
    const p = currentPlayer;
    
    let drawnCard: CardData;
    let newOpenDeck = [...gameState.openDeck];
    let newDeck = [...gameState.deck];

    if (source === 'OPEN') {
      const topCard = newOpenDeck[newOpenDeck.length - 1];
      
      // Safety check (shouldn't happen with UI disabled)
      if (gameState.phase === GamePhase.PLAYER_DRAW && topCard && topCard.id === gameState.lastDiscardedId) {
        if (!p.isBot) alert("Cannot pick up the card you just discarded!");
        return;
      }
      drawnCard = newOpenDeck.pop()!;
    } else {
      // Draw from invisible
      drawnCard = newDeck.shift()!;
    }

    const newHand = [...p.hand, drawnCard];

    // COMMIT PENDING CARDS TO OPEN DECK
    
    // Case 1: Toss Draw (Commit tossed pair)
    if (gameState.pendingToss.length > 0) {
      newOpenDeck.push(...gameState.pendingToss);
    }
    
    // Case 2: Standard Draw (Commit discarded card)
    if (gameState.pendingDiscard) {
      newOpenDeck.push(gameState.pendingDiscard);
    }
      
    finishTurn(p.id, newHand, newOpenDeck, newDeck, source === 'OPEN' ? `Drew from Open Pile` : `Drew from Deck`);
  };

  const handleShow = () => {
    // Scoring
    const results = getRoundScores(gameState.players, gameState.currentPlayerIndex, gameState.roundJoker);
    
    // Update total scores
    const updatedPlayers = gameState.players.map(p => {
      const roundRes = results.find(r => r.playerId === p.id);
      return {
        ...p,
        score: roundRes ? roundRes.roundScore : 0,
        totalScore: p.totalScore + (roundRes ? roundRes.roundScore : 0),
        lastAction: p.id === currentPlayer.id ? 'CALLED SHOW!' : 'Revealed'
      };
    });

    setGameState(prev => ({
      ...prev,
      players: updatedPlayers,
      phase: GamePhase.ROUND_END,
      turnLog: [...prev.turnLog, `${currentPlayer.name} called SHOW! Round Ended.`]
    }));
    
    // No transition needed for Round End, we want to see results
    setIsTransitioning(false);
  };

  const finishTurn = (playerId: number, newHand: CardData[], openDeck: CardData[], deck: CardData[], actionLog: string) => {
    let logMsg = actionLog;

    const nextPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
    
    // Determine if we need a transition screen
    // Only in MULTIPLAYER mode
    const needsTransition = gameState.gameMode === 'MULTIPLAYER';

    setGameState(prev => ({
      ...prev,
      players: prev.players.map(pl => pl.id === playerId ? { ...pl, hand: newHand, lastAction: 'Ended Turn' } : pl),
      openDeck,
      deck,
      currentPlayerIndex: nextPlayerIndex,
      phase: GamePhase.PLAYER_TURN_START,
      turnLog: [...prev.turnLog, logMsg],
      lastDiscardedId: null, // Reset for new player
      tossedThisTurn: false, // Reset flag
      pendingDiscard: null, // Ensure cleared
      pendingToss: [] // Ensure cleared
    }));

    if (needsTransition) {
      setIsTransitioning(true);
    }
  };

  const nextRound = () => {
    if (gameState.roundNumber >= gameState.totalRounds) {
      // End Match
      const winner = [...gameState.players].sort((a, b) => a.totalScore - b.totalScore)[0];
      setGameState(prev => ({ ...prev, phase: GamePhase.MATCH_END, winner }));
    } else {
      startRound(gameState.roundNumber + 1, gameState.players, gameState.gameMode);
    }
  };

  // --- AUTH GUARD ---
  if (authLoading) {
    return (
      <div className="h-[100dvh] bg-[#1a2e1a] flex items-center justify-center">
        <RefreshCw className="animate-spin text-yellow-500" size={48} />
      </div>
    );
  }

  if (!session && !isGuest) {
    return <Auth onGuestPlay={() => setIsGuest(true)} />;
  }

  // --- Render ---

  // 1. MENU SCREEN
  if (!gameState.gameMode && !isNameEntryStep && !showRoundSelectionSP) {
    return (
      <div className="h-[100dvh] bg-[#1a2e1a] flex flex-col items-center justify-center p-4">
        <h1 className="font-serif text-5xl md:text-7xl font-bold text-yellow-500 mb-8 drop-shadow-2xl">TRI-STACK</h1>
        
        {/* User Info Bar */}
        <div className="absolute top-4 right-4 flex items-center gap-2 text-sm bg-black/30 p-2 rounded-lg backdrop-blur">
          <User size={16} className="text-green-400" />
          <span className="text-gray-300">
            {isGuest ? 'Guest' : (session?.user?.email || 'Logged In')}
          </span>
          {!isGuest && (
            <button onClick={signOut} className="ml-2 text-red-400 hover:text-red-300">
              <LogOut size={16} />
            </button>
          )}
          {isGuest && (
             <button onClick={() => window.location.reload()} className="ml-2 text-yellow-400 hover:text-yellow-300 font-bold">
               Login
             </button>
          )}
        </div>

        <div className="bg-slate-900/50 p-8 rounded-2xl backdrop-blur-sm border border-white/10 shadow-2xl flex flex-col gap-6 w-full max-w-md">
           
           {!showMultiplayerSelection ? (
             <>
                <h2 className="text-white text-xl text-center mb-2">Select Game Mode</h2>
                <button 
                  onClick={openSinglePlayerSetup}
                  className="bg-blue-600 hover:bg-blue-500 text-white p-6 rounded-xl font-bold text-lg flex items-center gap-4 transition-all hover:translate-x-2"
                >
                  <div className="w-12 h-12 bg-blue-800 rounded-full flex items-center justify-center">
                    <User size={24} />
                  </div>
                  <div className="text-left">
                    <div>Single Player</div>
                    <div className="text-sm text-blue-200 font-normal">Challenge the Bots</div>
                  </div>
                </button>

                <button 
                  onClick={() => setShowMultiplayerSelection(true)}
                  className="bg-green-600 hover:bg-green-500 text-white p-6 rounded-xl font-bold text-lg flex items-center gap-4 transition-all hover:translate-x-2"
                >
                  <div className="w-12 h-12 bg-green-800 rounded-full flex items-center justify-center">
                    <Users size={24} />
                  </div>
                  <div className="text-left">
                    <div>Multiplayer</div>
                    <div className="text-sm text-green-200 font-normal">Pass & Play with friends</div>
                  </div>
                </button>
             </>
           ) : (
             <>
               <button 
                 onClick={() => setShowMultiplayerSelection(false)}
                 className="self-start text-gray-400 hover:text-white flex items-center gap-1 mb-2"
               >
                 <ChevronLeft size={20} /> Back
               </button>
               <h2 className="text-white text-xl text-center mb-4">How many players?</h2>
               
               <div className="grid grid-cols-2 gap-3 max-h-[40vh] overflow-y-auto">
                 {[2, 3, 4, 5, 6, 7].map(count => (
                   <button 
                     key={count}
                     onClick={() => initMultiplayerSetup(count)}
                     className="bg-slate-700 hover:bg-green-600 text-white p-4 rounded-xl font-bold flex items-center justify-center transition-all group"
                   >
                     <span className="flex items-center gap-2">
                       <Users size={16} className="text-gray-400 group-hover:text-white" />
                       {count}
                     </span>
                   </button>
                 ))}
               </div>
             </>
           )}
        </div>
      </div>
    );
  }

  // 1.2 SINGLE PLAYER ROUND SELECTION
  if (showRoundSelectionSP) {
    return (
      <div className="h-[100dvh] bg-[#1a2e1a] flex flex-col items-center justify-center p-4">
        <h1 className="font-serif text-3xl md:text-5xl font-bold text-yellow-500 mb-6">Match Length</h1>
        <div className="bg-slate-900/80 p-6 rounded-2xl backdrop-blur-sm border border-white/10 shadow-2xl w-full max-w-md text-center">
           <h2 className="text-white text-xl mb-6">How many rounds?</h2>
           <div className="grid grid-cols-2 gap-4 mb-6">
              {[3, 5, 7, 10].map(r => (
                 <button 
                   key={r}
                   onClick={() => startSinglePlayerMatch(r)}
                   className="bg-slate-800 hover:bg-blue-600 text-white p-6 rounded-xl font-bold text-2xl transition-all border border-slate-600 hover:border-blue-400"
                 >
                   {r}
                 </button>
              ))}
           </div>
           <button 
             onClick={() => setShowRoundSelectionSP(false)}
             className="text-gray-400 hover:text-white flex items-center gap-2 mx-auto"
           >
             <ChevronLeft size={20} /> Cancel
           </button>
        </div>
      </div>
    );
  }

  // 1.5 MULTIPLAYER SETUP SCREEN (NAMES + ROUNDS)
  if (isNameEntryStep) {
    return (
      <div className="h-[100dvh] bg-[#1a2e1a] flex flex-col items-center justify-center p-4">
        <h1 className="font-serif text-3xl md:text-5xl font-bold text-yellow-500 mb-6">Setup Game</h1>
        <div className="bg-slate-900/80 p-6 md:p-8 rounded-2xl backdrop-blur-sm border border-white/10 shadow-2xl w-full max-w-md flex flex-col gap-6">
           
           {/* Player Names */}
           <div className="max-h-[30vh] overflow-y-auto pr-2 space-y-3">
             {customPlayerNames.map((name, idx) => (
               <div key={idx} className="flex flex-col gap-1">
                 <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Player {idx + 1}</label>
                 <input 
                   type="text"
                   value={name}
                   onChange={(e) => {
                     const newNames = [...customPlayerNames];
                     newNames[idx] = e.target.value;
                     setCustomPlayerNames(newNames);
                   }}
                   maxLength={12}
                   className="bg-slate-800 text-white border border-slate-600 rounded-lg p-3 focus:border-yellow-500 focus:outline-none transition-colors"
                   placeholder={`Player ${idx + 1}`}
                 />
               </div>
             ))}
           </div>

           {/* Round Selection */}
           <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 mb-1">
                 <Hash size={16} className="text-yellow-500" />
                 <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Number of Rounds</label>
              </div>
              <div className="flex gap-2">
                 {[3, 5, 7, 10].map(r => (
                    <button 
                       key={r}
                       onClick={() => setSelectedTotalRounds(r)}
                       className={`flex-1 py-3 rounded-lg font-bold text-sm transition-all border ${selectedTotalRounds === r ? 'bg-yellow-500 text-black border-yellow-500 shadow-lg shadow-yellow-900/20' : 'bg-slate-800 text-gray-400 border-slate-600 hover:bg-slate-700'}`}
                    >
                       {r}
                    </button>
                 ))}
              </div>
           </div>

           <div className="flex gap-3 mt-2">
             <button 
               onClick={() => {
                 setIsNameEntryStep(false);
                 setShowMultiplayerSelection(true);
               }}
               className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl font-bold"
             >
               Back
             </button>
             <button 
               onClick={finalizeMultiplayerStart}
               className="flex-[2] bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-900/20"
             >
               Start Match <Play size={20} className="fill-current" />
             </button>
           </div>
        </div>
      </div>
    );
  }

  // 2. LOADING STATE
  if (gameState.phase === GamePhase.SETUP || !currentPlayer || gameState.players.length === 0) {
    return (
      <div className="h-[100dvh] bg-[#1a2e1a] flex flex-col items-center justify-center text-white gap-4">
        <RefreshCw className="animate-spin text-yellow-500" size={48} />
        <h2 className="font-serif text-2xl">Setting up table...</h2>
      </div>
    );
  }

  // 3. TRANSITION OVERLAY (PASS DEVICE - MULTIPLAYER ONLY)
  if (isTransitioning) {
    return (
      <div className="h-[100dvh] bg-slate-900 flex flex-col items-center justify-center p-4 z-50">
        <div className="max-w-md w-full bg-slate-800 p-8 rounded-2xl shadow-2xl border border-yellow-500/30 text-center animate-in fade-in">
           <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-500/20">
              <EyeOff size={40} className="text-white" />
           </div>
           
           <h2 className="text-2xl text-gray-400 font-serif mb-2">Turn Complete</h2>
           <p className="text-gray-500 mb-8">Please pass the device to</p>
           
           <h1 className="text-4xl font-bold text-white mb-8 tracking-tight">{gameState.players[gameState.currentPlayerIndex].name}</h1>
           
           <button 
             onClick={() => setIsTransitioning(false)}
             className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-all transform hover:scale-[1.02]"
           >
             <Eye size={24} />
             I am {gameState.players[gameState.currentPlayerIndex].name} - Ready
           </button>
        </div>
      </div>
    );
  }

  // 4. MATCH END SCREEN
  if (gameState.phase === GamePhase.MATCH_END) {
    return (
      <div className="h-[100dvh] bg-slate-900 flex flex-col items-center justify-center p-4">
        <Trophy size={64} className="text-yellow-400 mb-4" />
        <h1 className="text-4xl font-serif font-bold text-white mb-2">Match Complete</h1>
        <p className="text-xl text-gray-300 mb-8">Winner: <span className="text-green-400 font-bold">{gameState.winner?.name}</span> with {gameState.winner?.totalScore} pts</p>
        
        <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md overflow-y-auto max-h-[40vh]">
          {gameState.players.sort((a,b) => a.totalScore - b.totalScore).map((p, i) => (
            <div key={p.id} className="flex justify-between border-b border-slate-700 py-3 last:border-0">
               <span className="flex items-center gap-2">
                 <span className="text-slate-500 font-mono">#{i+1}</span>
                 <span>{p.name}</span>
               </span>
               <span className="font-bold text-yellow-500">{p.totalScore}</span>
            </div>
          ))}
        </div>

        <button 
           onClick={() => {
             setGameState(prev => ({ ...prev, gameMode: null }));
             setShowMultiplayerSelection(false);
             setIsNameEntryStep(false);
             setShowRoundSelectionSP(false);
           }}
           className="mt-8 bg-green-600 hover:bg-green-500 text-white px-8 py-3 rounded-full font-bold flex items-center gap-2 transition-all"
        >
          <RefreshCw /> Back to Menu
        </button>
      </div>
    );
  }

  // --- MAIN GAME ---
  
  // View Perspective: 
  // MP: Active player is always "hero" at bottom (Hotseat).
  // SP: Human is always "hero" at bottom.
  const showOpponentCards = gameState.phase === GamePhase.ROUND_END;

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-[#1a2e1a]">
      {/* Top Bar: Info */}
      <div className="h-16 bg-[#0f1f0f] flex items-center justify-between px-4 shadow-lg z-20 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="font-serif font-bold text-xl text-yellow-500 hidden md:block">TRI-STACK</h1>
          <div className="bg-slate-800 px-3 py-1 rounded-lg text-xs md:text-sm flex items-center gap-2">
             <span className="text-gray-400">Round</span>
             <span className="font-bold text-white">{gameState.roundNumber}/{gameState.totalRounds}</span>
          </div>
        </div>
        
        {/* Joker Display */}
        <div className="flex items-center gap-2">
           <span className="text-xs uppercase tracking-widest text-purple-400 font-bold hidden sm:inline">All {gameState.roundJoker?.rank}s are Jokers</span>
           <span className="text-xs uppercase tracking-widest text-purple-400 font-bold sm:hidden">Joker: {gameState.roundJoker?.rank}</span>
           {gameState.roundJoker && (
             <div className="flex bg-white text-black px-2 py-1 rounded border-2 border-purple-500 items-center gap-1">
               <span className="font-bold">{gameState.roundJoker.rank}</span>
             </div>
           )}
        </div>

        <div className="flex items-center gap-4">
           {/* Current Turn Indicator */}
           <div className="flex items-center gap-2">
             <div className={`w-3 h-3 rounded-full ${isBotThinking ? 'bg-yellow-500' : 'bg-green-500'} animate-pulse`} />
             <span className="text-sm font-bold truncate max-w-[100px] text-white">
                {currentPlayer.name} {isBotThinking && '...'}
             </span>
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
                   <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-blue-900 rounded-full flex items-center justify-center text-[10px] font-bold border border-white">
                     {opp.hand.length}
                   </div>
                </div>
                <span className="text-xs font-bold mt-1 max-w-[60px] truncate">{opp.name}</span>
                <span className="text-[10px] text-yellow-400">{opp.totalScore} pts</span>
                
                {/* Status Badge */}
                {gameState.phase === GamePhase.ROUND_END && (
                  <div className="absolute top-10 z-30 flex gap-1 bg-black/80 p-1 rounded shadow-2xl animate-in fade-in zoom-in">
                     {opp.hand.map((c, i) => (
                       <Card 
                         key={c.id || i} 
                         card={showOpponentCards ? c : undefined} // Always hide opponent cards unless round end
                         small 
                         isJoker={gameState.roundJoker ? (c.rank === gameState.roundJoker.rank) : false}
                        />
                     ))}
                     <div className="bg-white text-black text-xs font-bold p-1 rounded flex items-center">
                       {calculateHandValue(opp.hand, gameState.roundJoker)}
                     </div>
                  </div>
                )}
                
                {/* Hand Backs (During Game) */}
                {gameState.phase !== GamePhase.ROUND_END && (
                  <div className="flex -space-x-4 mt-2">
                     {opp.hand.map((c, i) => (
                       <Card key={i} small className="scale-75" /> // No card prop = face down
                     ))}
                  </div>
                )}
             </div>
           ))}
        </div>

        {/* Center Table (Decks) */}
        <div className="flex-1 flex items-center justify-center gap-4 md:gap-16 my-2 relative">
            {/* Draw Deck */}
            <div className="flex flex-col items-center gap-2">
               <Card 
                 disabled={!isPlayerTurn || (gameState.phase !== GamePhase.PLAYER_DRAW && gameState.phase !== GamePhase.PLAYER_TOSSING_DRAW)}
                 onClick={() => handleDraw('DECK')}
               />
               <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Deck ({gameState.deck.length})</span>
            </div>

            {/* Middle Area: Open Deck, Pending Discard & Pending Toss */}
            <div className="flex gap-4 items-center">
              
              {/* Open Deck (Pile) */}
              <div className="flex flex-col items-center gap-2 relative">
                 {gameState.openDeck.length > 0 ? (
                   <Card 
                     card={gameState.openDeck[gameState.openDeck.length - 1]}
                     isJoker={gameState.roundJoker && gameState.openDeck[gameState.openDeck.length - 1].rank === gameState.roundJoker.rank}
                     onClick={() => handleDraw('OPEN')}
                     disabled={
                       // Disabled if not turn OR not draw phase OR (edge case safety) if we are in Toss Draw phase
                       !isPlayerTurn || 
                       (gameState.phase !== GamePhase.PLAYER_DRAW && gameState.phase !== GamePhase.PLAYER_TOSSING_DRAW)
                     }
                   />
                 ) : (
                   <div className="w-20 h-28 md:w-24 md:h-36 border-2 border-dashed border-white/20 rounded-xl flex items-center justify-center">
                      <span className="text-white/20 text-xs">Empty</span>
                   </div>
                 )}
                 <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Open Pile</span>
              </div>

              {/* Pending Discard Slot */}
              {gameState.pendingDiscard && (
                <div className="flex flex-col items-center gap-2 relative animate-in slide-in-from-left-4 fade-in">
                  <div className="relative">
                    <Card 
                      card={gameState.pendingDiscard}
                      isJoker={gameState.roundJoker && gameState.pendingDiscard.rank === gameState.roundJoker.rank}
                      disabled={true} // Purely visual
                      className="opacity-70 ring-2 ring-yellow-500/50"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                       <ArrowRight className="text-white drop-shadow-lg" size={32} />
                    </div>
                  </div>
                  <span className="text-xs uppercase tracking-wider font-bold text-yellow-400 animate-pulse">Discarding...</span>
                </div>
              )}

              {/* Pending TOSS Slot (2 cards) */}
              {gameState.pendingToss.length > 0 && (
                 <div className="flex flex-col items-center gap-1 relative animate-in slide-in-from-left-4 fade-in">
                    <div className="relative flex -space-x-8">
                       {gameState.pendingToss.map(c => (
                         <Card 
                            key={c.id}
                            card={c}
                            isJoker={gameState.roundJoker && c.rank === gameState.roundJoker.rank}
                            disabled={true} // Purely visual
                            className="opacity-70 ring-2 ring-blue-500/50"
                         />
                       ))}
                       <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                           <RefreshCw className="text-white drop-shadow-lg animate-spin" size={32} />
                       </div>
                    </div>
                    <span className="text-xs uppercase tracking-wider font-bold text-blue-400 animate-pulse">Tossing...</span>
                 </div>
              )}

            </div>

            {/* Round End Modal Overlay */}
            {gameState.phase === GamePhase.ROUND_END && (
               <div className="absolute inset-0 z-50 flex items-center justify-center">
                 <div className="bg-slate-900/95 p-6 rounded-2xl shadow-2xl border border-yellow-500/30 backdrop-blur-sm max-w-sm w-full text-center m-4">
                    <h2 className="text-2xl font-serif font-bold text-white mb-2">Round Over</h2>
                    <p className="text-gray-400 mb-6 text-sm">Review scores below</p>
                    
                    <div className="space-y-2 mb-6 text-left max-h-[40vh] overflow-y-auto">
                       {gameState.players.map(p => (
                         <div key={p.id} className="flex justify-between items-center p-2 bg-slate-800 rounded">
                            <span className={p.id === gameState.currentPlayerIndex ? 'text-red-400 font-bold' : 'text-gray-300'}>
                                {p.name} {p.id === gameState.currentPlayerIndex && '(Caller)'}
                            </span>
                            <div className="flex items-center gap-4">
                              <span className="text-xs text-gray-500">Hand: {calculateHandValue(p.hand, gameState.roundJoker)}</span>
                              <span className="font-bold text-yellow-400">+{p.score} pts</span>
                            </div>
                         </div>
                       ))}
                    </div>
                    
                    <button 
                      onClick={nextRound}
                      className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-3 rounded-lg flex items-center justify-center gap-2"
                    >
                      Next Round <ChevronRight size={18} />
                    </button>
                 </div>
               </div>
            )}
        </div>

        {/* ACTIVE PLAYER Controls & Hand (BOTTOM) */}
        <div className="flex flex-col items-center gap-4 pb-8 shrink-0">
           {/* Action Bar - Only show if it's the BOTTOM PLAYER's turn */}
           {isPlayerTurn && currentPlayer.id === bottomPlayer.id ? (
             <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md p-2 rounded-full border border-white/10 shadow-xl transition-all animate-in slide-in-from-bottom-4 z-10 scale-90 md:scale-100">
                {gameState.phase === GamePhase.PLAYER_TURN_START && (
                  <>
                    <button 
                      onClick={handleShow}
                      className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-full font-bold flex items-center gap-2 text-xs md:text-sm shadow-lg shadow-red-900/50"
                    >
                      <AlertCircle size={16} /> SHOW
                    </button>
                    <div className="w-px h-6 bg-white/20 mx-1"></div>
                    <button 
                      onClick={handleToss}
                      disabled={selectedCardIds.length !== 2 || gameState.tossedThisTurn}
                      className={`
                        px-4 py-2 rounded-full font-bold flex items-center gap-2 text-xs md:text-sm transition-all
                        ${selectedCardIds.length === 2 && !gameState.tossedThisTurn ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/50' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}
                      `}
                    >
                      <RefreshCw size={16} /> TOSS (2)
                    </button>
                    <button 
                      onClick={handleDiscard}
                      disabled={selectedCardIds.length !== 1}
                      className={`
                        px-4 py-2 rounded-full font-bold flex items-center gap-2 text-xs md:text-sm transition-all
                        ${selectedCardIds.length === 1 ? 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/50' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}
                      `}
                    >
                      <Hand size={16} /> DISCARD (1)
                    </button>
                  </>
                )}
                
                {(gameState.phase === GamePhase.PLAYER_DRAW || gameState.phase === GamePhase.PLAYER_TOSSING_DRAW) && (
                   <div className="px-4 py-2 text-white font-bold text-sm animate-pulse flex items-center gap-2">
                      <div className="w-2 h-2 bg-yellow-400 rounded-full" />
                      {gameState.phase === GamePhase.PLAYER_TOSSING_DRAW ? 'Toss complete. Draw a card!' : 'Draw to finish turn...'}
                   </div>
                )}
             </div>
           ) : (
             // Non-Interactive State Indicator
             <div className="h-10 flex items-center justify-center text-gray-400 text-sm italic">
                {currentPlayer.isBot ? 'Opponent is thinking...' : (currentPlayer.id !== bottomPlayer.id ? `Waiting for ${currentPlayer.name}...` : 'Waiting...')}
             </div>
           )}

           {/* Bottom Player Hand (Stable in SP, Hotseat in MP) */}
           <div className="flex items-end justify-center -space-x-4 md:-space-x-6 h-[140px] md:h-[160px]">
              {bottomPlayer.hand.map((card) => (
                <Card 
                  key={card.id} 
                  // HIDE CARDS IF:
                  // Multiplayer and it's not the active user's turn (e.g. transitioning)
                  // In Single Player, the bottom player is YOU, so always show.
                  card={(!isPlayerTurn && gameState.gameMode === 'MULTIPLAYER') ? undefined : card} 
                  isJoker={gameState.roundJoker ? (card.rank === gameState.roundJoker.rank) : false}
                  selected={selectedCardIds.includes(card.id)}
                  onClick={() => handleCardClick(card)}
                  className={`transition-all origin-bottom ${isPlayerTurn && currentPlayer.id === bottomPlayer.id ? 'hover:z-20' : 'opacity-80'}`}
                />
              ))}
           </div>
           
           <div className="text-xs text-gray-400 mt-2">
              <span className="text-green-400 font-bold uppercase tracking-wider">{bottomPlayer.name}</span> • Total Score: <span className="text-white font-bold text-lg">{bottomPlayer.totalScore}</span>
           </div>
        </div>
      </div>

      {/* Game Log */}
      <div className="fixed bottom-4 right-4 w-64 h-32 bg-black/50 backdrop-blur pointer-events-none rounded-lg p-2 overflow-hidden flex flex-col justify-end hidden md:flex">
         <div ref={scrollRef} className="overflow-y-auto space-y-1">
           {gameState.turnLog.map((log, i) => (
             <div key={i} className="text-[10px] text-gray-300 border-l-2 border-green-500 pl-2">
               {log}
             </div>
           ))}
         </div>
      </div>
    </div>
  );
};

export default App;