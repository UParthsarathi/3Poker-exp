
import { Rank, Suit } from './types';

export const SUITS = [Suit.Hearts, Suit.Diamonds, Suit.Clubs, Suit.Spades];
export const RANKS = [
  Rank.Ace, Rank.Two, Rank.Three, Rank.Four, Rank.Five, Rank.Six, 
  Rank.Seven, Rank.Eight, Rank.Nine, Rank.Ten, Rank.Jack, Rank.Queen, Rank.King
];

export const RANK_VALUES: Record<Rank, number> = {
  [Rank.Ace]: 1,
  [Rank.Two]: 2,
  [Rank.Three]: 3,
  [Rank.Four]: 4,
  [Rank.Five]: 5,
  [Rank.Six]: 6,
  [Rank.Seven]: 7,
  [Rank.Eight]: 8,
  [Rank.Nine]: 9,
  [Rank.Ten]: 10,
  [Rank.Jack]: 10,
  [Rank.Queen]: 10,
  [Rank.King]: 10,
};

export const DEFAULT_TOTAL_ROUNDS = 5;
export const BOT_NAMES = [
  "Bot A", 
  "Bot B", 
  "Bot C", 
  "Bot D", 
];