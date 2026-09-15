import React from 'react';
import { User, Check, Edit2, LogOut, Users, Globe, ChevronLeft } from 'lucide-react';
import { Screen } from '../components/ui';

// Title screen: display-name editor, mode buttons, and the local-multiplayer
// player-count step (same screen, toggled by showMultiplayerSelection).
const MainMenu: React.FC<{
  isGuest: boolean;
  isEditingName: boolean;
  setIsEditingName: (v: boolean) => void;
  customDisplayName: string;
  setCustomDisplayName: (v: string) => void;
  getDisplayName: () => string;
  saveCustomName: () => void;
  onSignOut: () => void;
  showMultiplayerSelection: boolean;
  setShowMultiplayerSelection: (v: boolean) => void;
  setShowOnlineSelection: (v: boolean) => void;
  onSinglePlayer: () => void;
  onPlayerCount: (count: number) => void;
}> = ({
  isGuest, isEditingName, setIsEditingName, customDisplayName, setCustomDisplayName,
  getDisplayName, saveCustomName, onSignOut, showMultiplayerSelection,
  setShowMultiplayerSelection, setShowOnlineSelection, onSinglePlayer, onPlayerCount
}) => (
      <Screen>
        <h1 className="font-serif text-5xl md:text-7xl font-bold text-yellow-500 mb-8 drop-shadow-2xl">TRI-STACK</h1>
        
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

          {!isGuest && <button onClick={onSignOut} className="ml-2 text-red-400 hover:text-red-300 border-l border-white/10 pl-2"><LogOut size={16} /></button>}
        </div>

        <div className="bg-slate-900/50 p-8 rounded-2xl backdrop-blur-sm border border-white/10 shadow-2xl flex flex-col gap-6 w-full max-w-md">
           
           {!showMultiplayerSelection ? (
             <>
                <button onClick={onSinglePlayer} className="bg-blue-600 hover:bg-blue-500 text-white p-6 rounded-xl font-bold text-lg flex items-center gap-4 transition-all">
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
                   <button key={count} onClick={() => onPlayerCount(count)} className="bg-slate-700 hover:bg-green-600 text-white p-4 rounded-xl font-bold flex items-center justify-center transition-all group">
                     <span className="flex items-center gap-2"><Users size={16} className="text-gray-400 group-hover:text-white" />{count}</span>
                   </button>
                 ))}
               </div>
             </>
           )}
        </div>
      </Screen>
);

export default MainMenu;
