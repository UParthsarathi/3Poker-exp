import React from 'react';
import { Hash, Play } from 'lucide-react';
import { Screen } from '../components/ui';
import { RoundInput } from '../state/useRoundInput';

// Local multiplayer setup: per-player names plus match length.
// `transition-allWZ` and the stray `finalizeMultiplayerStart` class below are
// preserved verbatim from the original - fixing either would change the UI.
const NameEntry: React.FC<{
  customPlayerNames: string[];
  setCustomPlayerNames: (names: string[]) => void;
  rounds: RoundInput;
  onBack: () => void;
  onStart: () => void;
}> = ({ customPlayerNames, setCustomPlayerNames, rounds, onBack, onStart }) => (
      <Screen>
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
              <div className="flex items-center gap-2 mb-1"><Hash size={16} className="text-yellow-500" /><label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Number of Rounds (1-100)</label></div>
              <div className="flex gap-2 items-center">
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
                 {[5, 10, 20].map(r => (<button key={r} onClick={() => rounds.setRoundsAndSync(r)} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-allWZ border ${rounds.selectedTotalRounds === r ? 'bg-yellow-500 text-black border-yellow-500 shadow-lg shadow-yellow-900/20' : 'bg-slate-800 text-gray-400 border-slate-600 hover:bg-slate-700'}`}>{r}</button>))}
              </div>
           </div>
           
           <div className="flex gap-3 mt-2">
             <button onClick={onBack} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl font-bold">Back</button>
             <button onClick={onStart} className="finalizeMultiplayerStart flex-[2] bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-900/20">Start Match <Play size={20} className="fill-current" /></button>
           </div>
        </div>
      </Screen>
);

export default NameEntry;
