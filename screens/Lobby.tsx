import React from 'react';
import { Copy, Users, Play, AlertCircle } from 'lucide-react';
import { Screen } from '../components/ui';
import { RoundInput } from '../state/useRoundInput';

// Online waiting room. Host sees match length + start; everyone else waits.
// `transition-allWZ` on the preset buttons is preserved verbatim from the
// original - correcting the typo would add a transition that does not exist today.
const Lobby: React.FC<{
  roomCode: string;
  onlineLobbyPlayers: { id: number; name: string }[];
  onlineHostId: number;
  myOnlineId: number | null;
  rounds: RoundInput;
  onStart: () => void;
  onLeave: () => void;
}> = ({ roomCode, onlineLobbyPlayers, onlineHostId, myOnlineId, rounds, onStart, onLeave }) => {
     const canStart = onlineLobbyPlayers.length >= 2;

     return (
        <Screen>
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
                          {p.id === onlineHostId && <span className="text-xs bg-yellow-500 text-black px-2 py-1 rounded font-bold">HOST</span>}
                       </div>
                    ))}
                 </div>
              </div>

              <div className="flex flex-col gap-3">
                 {myOnlineId === onlineHostId ? (
                    <>
                    <div className="mb-2">
                       <label className="text-xs text-gray-400 font-bold uppercase block mb-1">Rounds (1-100)</label>
                       <div className="flex gap-2 justify-center items-center">
                          <input 
                            type="number" 
                            min="1" 
                            max="100" 
                            value={rounds.roundsInput} 
                            onChange={rounds.handleRoundInputChange}
                            onBlur={rounds.handleRoundInputBlur}
                            onFocus={rounds.handleRoundInputFocus}
                            className="w-20 bg-slate-800 text-white border border-slate-600 rounded-lg p-2 text-center font-bold focus:border-yellow-500 outline-none"
                          />
                          <div className="flex gap-1">
                             {[5, 10, 20].map(r => (
                                <button 
                                   key={r} 
                                   onClick={() => rounds.setRoundsAndSync(r)}
                                   className={`px-3 py-2 rounded-lg font-bold text-sm transition-allWZ border ${rounds.selectedTotalRounds === r ? 'bg-yellow-500 text-black border-yellow-500' : 'bg-slate-800 text-gray-400 border-slate-600 hover:bg-slate-700'}`}
                                >
                                   {r}
                                </button>
                             ))}
                          </div>
                       </div>
                    </div>

                    <button 
                      onClick={onStart} 
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
                 <button onClick={onLeave} className="text-red-400 text-sm hover:underline mt-2">Leave Room</button>
              </div>
           </div>
        </Screen>
     );
};

export default Lobby;
