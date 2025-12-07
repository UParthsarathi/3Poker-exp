import React from 'react';
import { CardData, Suit } from '../types';
import { Heart, Diamond, Club, Spade, Sparkles } from 'lucide-react';

interface CardProps {
  card?: CardData; // If undefined, it's a face-down card
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  isJoker?: boolean;
  small?: boolean;
  className?: string;
}

const Card: React.FC<CardProps> = ({ 
  card, 
  onClick, 
  selected, 
  disabled, 
  isJoker, 
  small,
  className = ''
}) => {
  if (!card) {
    // Back of card
    return (
      <div 
        onClick={!disabled ? onClick : undefined}
        className={`
          relative bg-blue-900 border-2 border-white rounded-xl shadow-md 
          flex items-center justify-center overflow-hidden transition-transform duration-200
          ${small ? 'w-12 h-16' : 'w-20 h-28 md:w-24 md:h-36'}
          ${!disabled && onClick ? 'cursor-pointer hover:-translate-y-2' : ''}
          ${className}
        `}
      >
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle,_transparent_20%,_#000_20%)] bg-[length:8px_8px]" />
        <div className="w-8 h-8 md:w-12 md:h-12 border-2 border-yellow-500 rounded-full flex items-center justify-center bg-blue-800">
           <span className="text-yellow-500 text-xs md:text-sm font-bold">TS</span>
        </div>
      </div>
    );
  }

  const isRed = card.suit === Suit.Hearts || card.suit === Suit.Diamonds;
  
  const SuitIcon = () => {
    switch (card.suit) {
      case Suit.Hearts: return <Heart className="fill-current" size={small ? 10 : 16} />;
      case Suit.Diamonds: return <Diamond className="fill-current" size={small ? 10 : 16} />;
      case Suit.Clubs: return <Club className="fill-current" size={small ? 10 : 16} />;
      case Suit.Spades: return <Spade className="fill-current" size={small ? 10 : 16} />;
    }
  };

  return (
    <div 
      onClick={!disabled ? onClick : undefined}
      className={`
        relative bg-white rounded-xl shadow-md flex flex-col justify-between p-1 select-none transition-all duration-200
        ${small ? 'w-12 h-16 text-xs' : 'w-20 h-28 md:w-24 md:h-36 text-base md:text-xl'}
        ${selected ? 'ring-4 ring-yellow-400 -translate-y-4 z-10' : ''}
        ${!disabled && onClick && !selected ? 'cursor-pointer hover:-translate-y-2 hover:shadow-xl' : ''}
        ${disabled ? 'opacity-60 cursor-not-allowed' : ''}
        ${isRed ? 'text-red-600' : 'text-slate-900'}
        ${className}
      `}
    >
      {/* Top Left */}
      <div className="flex flex-col items-center leading-none">
        <span className="font-bold font-serif">{card.rank}</span>
        <SuitIcon />
      </div>

      {/* Center Big Icon */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
         <div className={`transform scale-[2.5] opacity-20 ${isRed ? 'text-red-600' : 'text-slate-900'}`}>
            <SuitIcon />
         </div>
      </div>

      {/* Joker Indicator */}
      {isJoker && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
           <div className="bg-purple-600 text-white text-[10px] md:text-xs font-bold px-2 py-1 rounded-full shadow-lg flex items-center gap-1 animate-pulse z-20">
             <Sparkles size={12} /> JOKER
           </div>
        </div>
      )}

      {/* Bottom Right (Rotated) */}
      <div className="flex flex-col items-center leading-none transform rotate-180">
        <span className="font-bold font-serif">{card.rank}</span>
        <SuitIcon />
      </div>
    </div>
  );
};

export default Card;