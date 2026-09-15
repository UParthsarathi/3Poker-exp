import { GameState, GamePhase, CardData } from '../types';
import { getRoundScores, shuffleDeck } from '../services/gameLogic';

// One implementation of the four turn transitions, shared by the human handlers
// and the bot effect. Previously each existed twice and had drifted: the bot
// copy set no lastAction, wrote no turnLog, never synced, and recycled the open
// pile by mutating state in place. This version is the human (correct) copy.
//
// Pure. Returns the SAME state object when an action cannot be applied, so the
// caller can tell (human draw alerts and calls SHOW; bot draw just waits).
export type GameAction =
  | { type: 'TOSS'; playerId: number; cardIds: string[] }
  | { type: 'DISCARD'; playerId: number; cardId: string }
  | { type: 'DRAW'; playerId: number; source: 'DECK' | 'OPEN' }
  | { type: 'SHOW'; playerId: number };

export const gameReducer = (state: GameState, action: GameAction): GameState => {
  const player = state.players.find(p => p.id === action.playerId);
  if (!player) return state;

  switch (action.type) {
    case 'TOSS': {
      const cards = player.hand.filter(c => action.cardIds.includes(c.id));
      if (cards.length !== 2) return state;
      const newHand = player.hand.filter(c => !action.cardIds.includes(c.id));

      return {
        ...state,
        players: state.players.map(pl => pl.id === player.id ? { ...pl, hand: newHand, lastAction: `Tossed ${cards[0].rank}s` } : pl),
        pendingToss: cards,
        phase: GamePhase.PLAYER_TOSSING_DRAW,
        tossedThisTurn: true,
        turnLog: [...state.turnLog, `${player.name} tossed a pair of ${cards[0].rank}s`]
      };
    }

    case 'DISCARD': {
      const cardToDiscard = player.hand.find(c => c.id === action.cardId);
      if (!cardToDiscard) return state;
      const newHand = player.hand.filter(c => c.id !== action.cardId);

      return {
        ...state,
        players: state.players.map(pl => pl.id === player.id ? { ...pl, hand: newHand, lastAction: `Discarded ${cardToDiscard.rank}${cardToDiscard.suit}` } : pl),
        pendingDiscard: cardToDiscard,
        lastDiscardedId: cardToDiscard.id,
        phase: GamePhase.PLAYER_DRAW,
        turnLog: [...state.turnLog, `${player.name} discarded ${cardToDiscard.rank}${cardToDiscard.suit}`]
      };
    }

    case 'DRAW': {
      let drawnCard: CardData;
      let newOpenDeck = [...state.openDeck];
      let newDeck = [...state.deck];

      if (action.source === 'OPEN') {
        const topCard = newOpenDeck[newOpenDeck.length - 1];
        // Cannot immediately take back the card you just discarded.
        if (state.phase === GamePhase.PLAYER_DRAW && topCard && topCard.id === state.lastDiscardedId) return state;
        if (newOpenDeck.length === 0) return state;
        drawnCard = newOpenDeck.pop()!;
      } else {
        if (newDeck.length === 0) {
          // Recycle the open pile, keeping its top card face up.
          if (newOpenDeck.length > 1) {
            const topCard = newOpenDeck.pop()!;
            newDeck = shuffleDeck([...newOpenDeck]);
            newOpenDeck = [topCard];
          } else {
            return state;   // nothing left to draw - caller decides what to do
          }
        }
        drawnCard = newDeck.shift()!;
      }

      const newHand = [...player.hand, drawnCard];

      // Pending toss/discard only reach the open pile once the turn completes.
      if (state.pendingToss.length > 0) newOpenDeck.push(...state.pendingToss);
      if (state.pendingDiscard) newOpenDeck.push(state.pendingDiscard);

      return {
        ...state,
        players: state.players.map(pl => pl.id === player.id ? { ...pl, hand: newHand, lastAction: 'Ended Turn' } : pl),
        openDeck: newOpenDeck,
        deck: newDeck,
        currentPlayerIndex: (state.currentPlayerIndex + 1) % state.players.length,
        phase: GamePhase.PLAYER_TURN_START,
        turnLog: [...state.turnLog, action.source === 'OPEN' ? `Drew from Open Pile` : `Drew from Deck`],
        lastDiscardedId: null,
        tossedThisTurn: false,
        pendingDiscard: null,
        pendingToss: []
      };
    }

    case 'SHOW': {
      // getRoundScores takes the caller's INDEX, matching both original copies.
      const results = getRoundScores(state.players, state.currentPlayerIndex, state.roundJoker);

      const updatedPlayers = state.players.map(p => {
        const roundRes = results.find(r => r.playerId === p.id);
        return {
          ...p,
          score: roundRes ? roundRes.roundScore : 0,
          totalScore: (p.totalScore || 0) + (roundRes ? roundRes.roundScore : 0),
          lastAction: p.id === player.id ? 'CALLED SHOW!' : 'Revealed',
          wasCaller: p.id === player.id
        };
      });

      return {
        ...state,
        players: updatedPlayers,
        phase: GamePhase.ROUND_END,
        turnLog: [...state.turnLog, `${player.name} called SHOW! Round Ended.`]
      };
    }
  }
};
