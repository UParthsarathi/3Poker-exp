import { GameState, GamePhase } from '../types';
import { DEFAULT_TOTAL_ROUNDS } from '../constants';

// Returns a fresh object each call: online code mutates game_state in place
// (see services/online.ts leaveRoom), so a shared frozen constant would bite.
export const createInitialGameState = (): GameState => ({
  gameMode: null,
  deck: [],
  openDeck: [],
  players: [],
  currentPlayerIndex: 0,
  roundJoker: null,
  roundNumber: 1,
  totalRounds: DEFAULT_TOTAL_ROUNDS,
  phase: GamePhase.SETUP,
  turnLog: [],
  winner: null,
  lastDiscardedId: null,
  tossedThisTurn: false,
  pendingDiscard: null,
  pendingToss: [],
  playerNames: []
});
