import React from 'react';
import { RefreshCw } from 'lucide-react';

// The centred screen shell used by the lobby, menu, online, round and name screens.
export const Screen: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="h-[100dvh] bg-[#1a2e1a] flex flex-col items-center justify-center p-4">{children}</div>
);

// Full-screen spinner. Takes children rather than a string prop so the message
// stays a JSX text node.
export const LoadingScreen: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="h-[100dvh] bg-[#1a2e1a] flex flex-col items-center justify-center text-white gap-4"><RefreshCw className="animate-spin text-yellow-500" size={48} /><h2 className="font-serif text-2xl">{children}</h2></div>
);
