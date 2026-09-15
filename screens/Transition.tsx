import React from 'react';
import { Player } from '../types';
import { EyeOff, Eye } from 'lucide-react';

// Local multiplayer hotseat: hides the board while the device changes hands.
const Transition: React.FC<{
  currentPlayer: Player;
  onReady: () => void;
}> = ({ currentPlayer, onReady }) => (
      <div className="h-[100dvh] bg-slate-900 flex flex-col items-center justify-center p-4 z-50">
        <div className="max-w-md w-full bg-slate-800 p-8 rounded-2xl shadow-2xl border border-yellow-500/30 text-center animate-in fade-in">
           <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-500/20"><EyeOff size={40} className="text-white" /></div>
           <h2 className="text-2xl text-gray-400 font-serif mb-2">Turn Complete</h2>
           <p className="text-gray-500 mb-8">Please pass the device to</p>
           <h1 className="text-4xl font-bold text-white mb-8 tracking-tight">{currentPlayer.name}</h1>
           <button onClick={onReady} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-all transform hover:scale-[1.02]"><Eye size={24} /> I am {currentPlayer.name} - Ready</button>
        </div>
      </div>
);

export default Transition;
