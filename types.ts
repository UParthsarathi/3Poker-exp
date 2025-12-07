export enum Suit {
  Hearts = '♥',
  Diamonds = '♦',
  Clubs = '♣',
  Spades = '♠',
}

export enum Rank {
  Ace = 'A',
  Two = '2',
  Three = '3',
  Four = '4',
  Five = '5',
  Six = '6',
  Seven = '7',
  Eight = '8',
  Nine = '9',
  Ten = '10',
  Jack = 'J',
  Queen = 'Q',
  King = 'K',
}

export interface CardData {
  id: string; // Unique ID for React keys
  suit: Suit;
  rank: Rank;
  value: number; // Base value (1, 2-9, 10)
  isJoker?: boolean; // Calculated property for the round
}

export enum GamePhase {
  SETUP = 'SETUP',
  PLAYER_TURN_START = 'PLAYER_TURN_START', // Can Toss, Show, or Select Discard
  PLAYER_TOSSING_DRAW = 'PLAYER_TOSSING_DRAW', // Must draw after toss
  PLAYER_DRAW = 'PLAYER_DRAW', // Must draw after discard
  ROUND_END = 'ROUND_END',
  MATCH_END = 'MATCH_END',
}

export type GameMode = 'SINGLE_PLAYER' | 'MULTIPLAYER' | 'ONLINE_HOST' | 'ONLINE_CLIENT' | null;

export interface Player {
  id: number;
  name: string;
  isBot: boolean;
  hand: CardData[];
  score: number;
  totalScore: number;
  lastAction: string;
  wasCaller?: boolean; // New property to track who called SHOW
}

export interface GameState {
  gameMode: GameMode;
  deck: CardData[];
  openDeck: CardData[];
  players: Player[];
  currentPlayerIndex: number;
  roundJoker: CardData | null;
  roundNumber: number;
  totalRounds: number;
  phase: GamePhase;
  turnLog: string[];
  winner: Player | null;
  lastDiscardedId: string | null; // ID of the card just discarded (cannot be picked up)
  tossedThisTurn: boolean; // Tracks if the current player has already tossed this turn
  pendingDiscard: CardData | null; // The card currently being discarded, waiting for draw to complete
  pendingToss: CardData[]; // The cards currently being tossed, waiting for draw to complete
  playerNames: string[]; // Custom names for the players
}

export interface BotAction {
  type: 'TOSS' | 'DISCARD' | 'SHOW';
  cardIds?: string[]; // For toss or discard
}

export interface OnlineRoom {
  code: string;
  host_id: string;
  players: { id: number; name: string }[]; // Basic metadata
  game_state: GameState | null;
  status: 'WAITING' | 'PLAYING' | 'FINISHED';
}