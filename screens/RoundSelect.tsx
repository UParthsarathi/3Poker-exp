import React from 'react';
import { Play, ChevronLeft } from 'lucide-react';
import { Screen } from '../components/ui';
import { RoundInput } from '../state/useRoundInput';

// Single-player match length picker. Note the preset row is 4 wide (3/5/10/20)
// and the input is large here; the lobby and name-entry pickers differ on both,
// which is why they are not one shared component.
const RoundSelect: React.FC<{
  rounds: RoundInput;
  onStart: (rounds: number) => void;
  onCancel: () => void;
}> = ({ rounds, onStart, onCancel }) => (
      <Screen>
        <h1 className="font-serif text-3xl md:text-5xl font-bold text-yellow-500 mb-6">Match Length</h1>
        <div className="bg-slate-900/80 p-6 rounded-2xl backdrop-blur-sm border border-white/10 shadow-2xl w-full max-w-md text-center">
           <h2 className="text-white text-xl mb-6">How many rounds?</h2>
           
           {/* Custom Numeric Input */}
           <div className="mb-6 flex flex-col gap-4">
              <div className="flex items-center justify-center gap-2">
                 <input 
                   type="number" 
                   min="1" 
                   max="100" 
                   className="bg-slate-800 text-white text-3xl font-bold p-4 rounded-xl border border-slate-600 text-center w-32 focus:border-yellow-500 focus:outline-none"
                   value={rounds.roundsInput}
                   onChange={rounds.handleRoundInputChange}
                   onBlur={rounds.handleRoundInputBlur}
                   onFocus={rounds.handleRoundInputFocus}
                 />
                 <span className="text-gray-400 font-bold">Rounds</span>
              </div>
              
              <div className="grid grid-cols-4 gap-2">
                 {[3, 5, 10, 20].map(r => (
                    <button key={r} onClick={() => rounds.setRoundsAndSync(r)} className={`py-2 rounded-lg font-bold text-sm border ${rounds.selectedTotalRounds === r ? 'bg-yellow-500 text-black border-yellow-500' : 'bg-slate-800 text-gray-400 border-slate-600'}`}>
                       {r}
                    </button>
                 ))}
              </div>
           </div>

           <button onClick={() => onStart(rounds.selectedTotalRounds)} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-xl text-xl mb-4 shadow-lg shadow-green-900/20 flex items-center justify-center gap-2">
              Start Match <Play size={24} />
           </button>
           <button onClick={onCancel} className="text-gray-400 hover:text-white flex items-center gap-2 mx-auto"><ChevronLeft size={20} /> Cancel</button>
        </div>
      </Screen>
);

export default RoundSelect;
