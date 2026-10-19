import React from 'react';
import { ChevronLeft, Wifi, Loader2 } from 'lucide-react';
import { Screen } from '../components/ui';

// Create-or-join entry point for online play.
const OnlineSelect: React.FC<{
  joinCodeInput: string;
  setJoinCodeInput: (v: string) => void;
  isJoining: boolean;
  onBack: () => void;
  onCreate: () => void;
  onJoin: () => void;
}> = ({ joinCodeInput, setJoinCodeInput, isJoining, onBack, onCreate, onJoin }) => (
      <Screen>
        <h1 className="font-serif text-3xl md:text-5xl font-bold text-yellow-500 mb-8">Online Play</h1>
        <div className="bg-slate-900/80 p-8 rounded-2xl border border-white/10 w-full max-w-md">
           
           <button onClick={onBack} className="text-gray-400 hover:text-white flex items-center gap-1 mb-6"><ChevronLeft size={20} /> Back</button>

           <div className="flex flex-col gap-4">
              <button onClick={onCreate} className="bg-yellow-500 hover:bg-yellow-400 text-black p-6 rounded-xl font-bold text-xl flex flex-col items-center justify-center gap-2 shadow-lg">
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
                      onClick={onJoin} 
                      disabled={isJoining}
                      className="bg-blue-600 hover:bg-blue-500 text-white px-6 rounded-lg font-bold disabled:opacity-50 flex items-center justify-center min-w-[80px]"
                    >
                      {isJoining ? <Loader2 className="animate-spin" size={20} /> : 'JOIN'}
                    </button>
                 </div>
              </div>
           </div>
        </div>
      </Screen>
);

export default OnlineSelect;
