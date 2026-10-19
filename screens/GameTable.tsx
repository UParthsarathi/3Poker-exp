import React from 'react';
import { GameState, Player, CardData, GamePhase } from '../types';
import { calculateHandValue } from '../services/gameLogic';
import Card from '../components/Card';
import { LogOut, Globe, CloudUpload, Bot, Users, Trophy, RefreshCw, ArrowRight, AlertCircle, Hand, ChevronRight } from 'lucide-react';

// The table itself: top bar, opponents, piles, round-end summary, hand and
// controls. Handler props keep their original App names so the JSX below is a
// verbatim copy of what lived in App.tsx.
const GameTable: React.FC<{
  gameState: GameState;
  currentPlayer: Player;
  bottomPlayer: Player;
  opponentsToRender: Player[];
  isPlayerTurn: boolean;
  isBotThinking: boolean;
  selectedCardIds: string[];
  roomCode: string;
  myOnlineId: number | null;
  onlineHostId: number;
  isSyncing: boolean;
  showExitConfirm: boolean;
  setShowExitConfirm: (v: boolean) => void;
  handleCardClick: (card: CardData) => void;
  handleToss: () => void;
  handleDiscard: () => void;
  handleDraw: (source: 'DECK' | 'OPEN') => void;
  handleShow: () => void;
  handleKickPlayer: (playerId: number) => void;
  handleReturnToLobby: () => void;
  nextRound: () => void;
  clearSession: () => void;
}> = ({
  gameState, currentPlayer, bottomPlayer, opponentsToRender, isPlayerTurn,
  isBotThinking, selectedCardIds, roomCode, myOnlineId, onlineHostId, isSyncing,
  showExitConfirm, setShowExitConfirm, handleCardClick, handleToss, handleDiscard,
  handleDraw, handleShow, handleKickPlayer, handleReturnToLobby, nextRound, clearSession
}) => {
  const showOpponentCards = gameState.phase === GamePhase.ROUND_END;
  const isLastRound = gameState.roundNumber >= gameState.totalRounds;
  const lowestScore = Math.min(...gameState.players.map(p => p.totalScore || 0));

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-[#1a2e1a]">
      {/* Top Bar: Info */}
      <div className="h-16 bg-[#0f1f0f] flex items-center justify-between gap-2 px-4 shadow-lg z-20 shrink-0">
        <div className="flex items-center gap-2 md:gap-4">
          <button onClick={() => setShowExitConfirm(true)} className="text-red-400 hover:text-red-300 transition-colors bg-white/5 p-2 rounded-lg">
             <LogOut size={20} />
          </button>
          
          <h1 className="font-serif font-bold text-xl text-yellow-500 hidden md:block">TRI-STACK</h1>
          <div className="bg-slate-800 px-3 py-1 rounded-lg text-xs md:text-sm flex items-center gap-2">
             <span className="text-gray-400 hidden sm:inline">Round</span>
             <span className="font-bold text-white">{gameState.roundNumber}/{gameState.totalRounds}</span>
          </div>
          {(gameState.gameMode === 'ONLINE_HOST' || gameState.gameMode === 'ONLINE_CLIENT') && (
             // Syncing swaps the icon inside the pill rather than adding an element, so the bar never shifts.
             <div className="bg-blue-900/50 px-3 py-1 rounded-lg text-xs md:text-sm flex items-center gap-2 border border-blue-500/30" title={isSyncing ? 'Syncing...' : undefined}>
                {isSyncing ? <CloudUpload size={12} className="text-yellow-500 animate-pulse" /> : <Globe size={12} className="text-blue-400" />}
                <span className="font-mono font-bold text-blue-200">{roomCode}</span>
             </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
           <span className="text-xs uppercase tracking-widest text-purple-400 font-bold hidden sm:inline">All {gameState.roundJoker?.rank}s are Jokers</span>
           <span className="text-xs uppercase tracking-widest text-purple-400 font-bold whitespace-nowrap sm:hidden">Joker: {gameState.roundJoker?.rank}</span>
           {gameState.roundJoker && <div className="flex bg-white text-black px-2 py-1 rounded border-2 border-purple-500 items-center gap-1"><span className="font-bold">{gameState.roundJoker.rank}</span></div>}
        </div>

        <div className="flex items-center gap-4 min-w-0">
           <div className="flex items-center gap-2 min-w-0">
             <div className={`shrink-0 w-3 h-3 rounded-full ${isBotThinking ? 'bg-yellow-500' : 'bg-green-500'} animate-pulse`} />
             <span className="text-sm font-bold truncate max-w-[100px] text-white">{currentPlayer.name} {isBotThinking && '...'}</span>
           </div>
        </div>
      </div>

      {/* Game Area */}
      <div className="flex-1 relative flex flex-col justify-between p-2 md:p-4 max-w-7xl mx-auto w-full overflow-hidden">
        
        <div className="flex justify-center flex-wrap gap-2 md:gap-8 mb-2 max-h-[30vh] overflow-y-auto">
           {opponentsToRender.map(opp => (
             <div key={opp.id} className={`flex flex-col items-center p-2 rounded-lg transition-all ${opp.id === currentPlayer.id ? 'bg-yellow-500/10 scale-105 border border-yellow-500/30' : 'bg-black/20'}`}>
                <div className="relative group">
                   <div className="w-10 h-10 md:w-12 md:h-12 bg-slate-700 rounded-full flex items-center justify-center border-2 border-slate-500">
                     {opp.isBot ? <Bot size={20} className="text-slate-300" /> : <Users size={20} className="text-slate-300" />}
                   </div>
                   {opp.hand && <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-blue-900 rounded-full flex items-center justify-center text-[10px] font-bold border border-white">{opp.hand.length}</div>}
                   {myOnlineId === onlineHostId && !opp.isBot && (
                     <button 
                       onClick={() => handleKickPlayer(opp.id)}
                       className="absolute -top-2 -right-2 w-6 h-6 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10"
                       title="Kick Player"
                     >
                       <LogOut size={12} />
                     </button>
                   )}
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
                     {(opp.hand || []).map((_c, i) => (<Card key={i} small className="scale-75" />))}
                  </div>
                )}
             </div>
           ))}
        </div>

        <div className="flex-1 flex items-center justify-center gap-4 md:gap-16 my-2 relative">
            <div className="flex flex-col items-center gap-2">
               <Card disabled={!isPlayerTurn || (gameState.phase !== GamePhase.PLAYER_DRAW && gameState.phase !== GamePhase.PLAYER_TOSSING_DRAW)} onClick={() => handleDraw('DECK')} />
               <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Deck ({gameState.deck.length})</span>
            </div>

            <div className="flex gap-4 items-center">
              <div className="flex flex-col items-center gap-2 relative">
                 {gameState.openDeck.length > 0 ? (
                   <Card 
                     card={gameState.openDeck[gameState.openDeck.length - 1]}
                     isJoker={!!(gameState.roundJoker && gameState.openDeck[gameState.openDeck.length - 1].rank === gameState.roundJoker.rank)}
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
                    <Card card={gameState.pendingDiscard} isJoker={!!(gameState.roundJoker && gameState.pendingDiscard.rank === gameState.roundJoker.rank)} disabled={true} className="opacity-70 ring-2 ring-yellow-500/50" />
                    <div className="absolute inset-0 flex items-center justify-center"><ArrowRight className="text-white drop-shadow-lg" size={32} /></div>
                  </div>
                  <span className="text-xs uppercase tracking-wider font-bold text-yellow-400 animate-pulse">Discarding...</span>
                </div>
              )}

              {gameState.pendingToss.length > 0 && (
                 <div className="flex flex-col items-center gap-1 relative animate-in slide-in-from-left-4 fade-in">
                    <div className="relative flex -space-x-8">
                       {gameState.pendingToss.map(c => (<Card key={c.id} card={c} isJoker={!!(gameState.roundJoker && c.rank === gameState.roundJoker.rank)} disabled={true} className="opacity-70 ring-2 ring-blue-500/50" />))}
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
                       {[...gameState.players]
                         .sort((a, b) => isLastRound ? (a.totalScore - b.totalScore) : 0)
                         .map(p => {
                           const isWinner = isLastRound && (p.totalScore || 0) === lowestScore;
                           const handValue = calculateHandValue(p.hand, gameState.roundJoker);

                           return (
                             <div key={p.id} className={`flex justify-between items-center p-3 rounded-lg border ${isWinner ? 'bg-yellow-500/10 border-yellow-500/50' : 'bg-slate-800 border-white/5'}`}>
                                <span className={`flex items-center gap-2 ${p.id === gameState.currentPlayerIndex ? 'text-blue-400 font-bold' : (isWinner ? 'text-yellow-400 font-bold' : 'text-gray-300')}`}>
                                  {isWinner && <Trophy size={14} className="text-yellow-500" />} {p.name} {p.id === gameState.currentPlayerIndex && <span className="text-xs bg-blue-900 text-blue-200 px-1 rounded">CALLER</span>}
                                </span>
                                <div className="flex items-center gap-3">
                                   <div className="flex flex-col items-end">
                                      <span className="text-[10px] uppercase text-gray-500 font-bold">Hand</span>
                                      <span className="text-sm font-bold text-gray-400">{handValue}</span>
                                   </div>
                                   <div className="w-px h-8 bg-white/10"></div>
                                   <div className="flex flex-col items-end">
                                      <span className="text-[10px] uppercase text-gray-500 font-bold">Round</span>
                                      <span className={`text-sm font-bold ${p.score === 0 ? 'text-green-400' : 'text-red-400'}`}>{p.score > 0 ? `+${p.score}` : p.score}</span>
                                   </div>
                                   <div className="w-px h-8 bg-white/10"></div>
                                   <div className="flex flex-col items-end min-w-[30px]">
                                       <span className="text-[10px] uppercase text-gray-500 font-bold">Total</span>
                                       <span className={`text-lg font-bold ${isWinner ? 'text-yellow-400' : 'text-white'}`}>{p.totalScore || 0}</span>
                                   </div>
                                </div>
                             </div>
                           );
                       })}
                    </div>
                    {((gameState.gameMode !== 'ONLINE_CLIENT' && gameState.gameMode !== 'ONLINE_HOST') || (gameState.gameMode === 'ONLINE_HOST' && myOnlineId === onlineHostId)) && (
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
                          <button onClick={() => setShowExitConfirm(true)} className="text-red-400 hover:text-red-300 text-sm underline">Leave Room</button>
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

export default GameTable;
