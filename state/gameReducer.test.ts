import { describe, it, expect } from 'vitest';
import { gameReducer } from './gameReducer';
import { createInitialGameState } from './initialState';
import { GameState, GamePhase, Rank, Suit, CardData, Player } from '../types';

const card = (rank: Rank, suit: Suit, value: number): CardData => ({
  id: `${rank}${suit}`, rank, suit, value
});

const player = (id: number, hand: CardData[], isBot = false): Player => ({
  id, name: `P${id}`, isBot, hand, score: 0, totalScore: 0, lastAction: ''
});

// Two players, P0 to act, a known deck and open pile.
const setup = (over: Partial<GameState> = {}): GameState => ({
  ...createInitialGameState(),
  phase: GamePhase.PLAYER_TURN_START,
  players: [
    player(0, [card(Rank.Five, Suit.Hearts, 5), card(Rank.Five, Suit.Spades, 5), card(Rank.King, Suit.Clubs, 10)]),
    player(1, [card(Rank.Two, Suit.Hearts, 2)], true)
  ],
  deck: [card(Rank.Nine, Suit.Diamonds, 9)],
  openDeck: [card(Rank.Three, Suit.Clubs, 3)],
  ...over
});

describe('gameReducer', () => {
  it('TOSS moves the pair to pendingToss and demands a draw', () => {
    const next = gameReducer(setup(), { type: 'TOSS', playerId: 0, cardIds: ['5♥', '5♠'] });
    expect(next.players[0].hand).toHaveLength(1);
    expect(next.pendingToss).toHaveLength(2);
    expect(next.tossedThisTurn).toBe(true);
    expect(next.phase).toBe(GamePhase.PLAYER_TOSSING_DRAW);
    // still P0's turn until they draw
    expect(next.currentPlayerIndex).toBe(0);
  });

  it('DISCARD records lastDiscardedId so it cannot be taken straight back', () => {
    const afterDiscard = gameReducer(setup(), { type: 'DISCARD', playerId: 0, cardId: 'K♣' });
    expect(afterDiscard.lastDiscardedId).toBe('K♣');
    expect(afterDiscard.phase).toBe(GamePhase.PLAYER_DRAW);

    // The discard is still pending (not yet on the pile), so the pile top is the
    // old card - but drawing OPEN while it IS the fresh discard must be refused.
    const blocked = gameReducer(
      { ...afterDiscard, openDeck: [...afterDiscard.openDeck, afterDiscard.pendingDiscard!] },
      { type: 'DRAW', playerId: 0, source: 'OPEN' }
    );
    expect(blocked.lastDiscardedId).toBe('K♣');   // unchanged: action refused
  });

  it('DRAW ends the turn, flushes pending cards to the pile and advances play', () => {
    const tossed = gameReducer(setup(), { type: 'TOSS', playerId: 0, cardIds: ['5♥', '5♠'] });
    const next = gameReducer(tossed, { type: 'DRAW', playerId: 0, source: 'DECK' });

    expect(next.players[0].hand).toHaveLength(2);        // 1 left + 1 drawn
    expect(next.openDeck).toHaveLength(3);               // original + 2 tossed
    expect(next.pendingToss).toEqual([]);
    expect(next.deck).toHaveLength(0);
    expect(next.currentPlayerIndex).toBe(1);
    expect(next.phase).toBe(GamePhase.PLAYER_TURN_START);
    expect(next.tossedThisTurn).toBe(false);
  });

  it('DRAW recycles the open pile when the deck runs dry, keeping the top card', () => {
    const state = setup({
      deck: [],
      openDeck: [card(Rank.Four, Suit.Hearts, 4), card(Rank.Six, Suit.Spades, 6), card(Rank.Eight, Suit.Clubs, 8)],
      phase: GamePhase.PLAYER_DRAW
    });
    const next = gameReducer(state, { type: 'DRAW', playerId: 0, source: 'DECK' });

    // 3 on the pile: top stays face up, other 2 reshuffle into the deck, 1 drawn.
    expect(next.openDeck).toHaveLength(1);
    expect(next.openDeck[0].id).toBe('8♣');
    expect(next.deck).toHaveLength(1);
    expect(next.players[0].hand).toHaveLength(4);
  });

  it('DRAW is refused, not crashed, when nothing is left to draw', () => {
    const state = setup({ deck: [], openDeck: [card(Rank.Four, Suit.Hearts, 4)], phase: GamePhase.PLAYER_DRAW });
    // Same object back = caller decides (human alerts and calls SHOW, bot waits).
    expect(gameReducer(state, { type: 'DRAW', playerId: 0, source: 'DECK' })).toBe(state);
  });

  it('SHOW scores every hand, flags the caller and ends the round', () => {
    // P0 holds 20, P1 holds 2 -> caller P0 is not lowest, so takes the 50 penalty.
    const next = gameReducer(setup(), { type: 'SHOW', playerId: 0 });

    expect(next.phase).toBe(GamePhase.ROUND_END);
    expect(next.players[0].wasCaller).toBe(true);
    expect(next.players[1].wasCaller).toBe(false);
    expect(next.players[0].totalScore).toBe(50);
    expect(next.players[1].totalScore).toBe(2);
  });

  it('is pure: the input state is never mutated', () => {
    const state = setup();
    const snapshot = JSON.stringify(state);
    gameReducer(state, { type: 'TOSS', playerId: 0, cardIds: ['5♥', '5♠'] });
    gameReducer(state, { type: 'DISCARD', playerId: 0, cardId: 'K♣' });
    gameReducer(state, { type: 'DRAW', playerId: 0, source: 'DECK' });
    gameReducer(state, { type: 'SHOW', playerId: 0 });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('ignores actions from a player who is not in the game', () => {
    const state = setup();
    expect(gameReducer(state, { type: 'SHOW', playerId: 99 })).toBe(state);
  });

  it('bumps version on every applied action and never on a refused one', () => {
    const state = setup({ version: 7 });
    expect(gameReducer(state, { type: 'SHOW', playerId: 0 }).version).toBe(8);
    expect(gameReducer(state, { type: 'SHOW', playerId: 99 }).version).toBe(7);
  });

  // Three seats; P0 to act.
  const three = (over: Partial<GameState> = {}) =>
    setup({ players: [...setup().players, player(2, [card(Rank.Seven, Suit.Hearts, 7)])], ...over });
  const cardCount = (s: GameState) =>
    s.deck.length + s.openDeck.length + s.pendingToss.length + (s.pendingDiscard ? 1 : 0) +
    s.players.reduce((n, p) => n + p.hand.length, 0);

  it('LEAVE mid-turn returns every card and gives the next player a clean turn', () => {
    const discarded = gameReducer(three(), { type: 'DISCARD', playerId: 0, cardId: 'K♣' });
    const next = gameReducer(discarded, { type: 'LEAVE', playerId: 0 });

    expect(cardCount(next)).toBe(cardCount(three()));
    expect(next.players.map(p => p.id)).toEqual([1, 2]);
    expect(next.players[next.currentPlayerIndex].id).toBe(1);
    expect(next.phase).toBe(GamePhase.PLAYER_TURN_START);
    expect(next.pendingDiscard).toBeNull();
  });

  it('LEAVE by an earlier seat keeps the turn with the same player', () => {
    const next = gameReducer(three({ currentPlayerIndex: 2 }), { type: 'LEAVE', playerId: 0 });
    expect(next.players[next.currentPlayerIndex].id).toBe(2);
  });

  it('gives every applied action its own rev, even two built on the same state', () => {
    const state = setup({ rev: 'r0' });
    const a = gameReducer(state, { type: 'SHOW', playerId: 0 });
    const b = gameReducer(state, { type: 'LEAVE', playerId: 1 });
    expect(a.version).toBe(b.version);   // same version...
    expect(a.rev).not.toBe(b.rev);       // ...but a write built on one can't land on the other
    expect(gameReducer(state, { type: 'SHOW', playerId: 99 }).rev).toBe('r0');
  });

  it('LEAVE after the last round leaves the final scoreboard alone', () => {
    const final = gameReducer(three({ roundNumber: 3, totalRounds: 3 }), { type: 'SHOW', playerId: 0 });
    expect(gameReducer(final, { type: 'LEAVE', playerId: 1 })).toBe(final);
    // Between rounds a leaver still goes.
    const between = gameReducer(three({ roundNumber: 2, totalRounds: 3 }), { type: 'SHOW', playerId: 0 });
    expect(gameReducer(between, { type: 'LEAVE', playerId: 1 }).players).toHaveLength(2);
  });

  it('LEAVE down to one player ends the match', () => {
    const next = gameReducer(setup({ roundNumber: 2, totalRounds: 9 }), { type: 'LEAVE', playerId: 1 });
    expect(next.phase).toBe(GamePhase.ROUND_END);
    expect(next.roundNumber).toBe(9);
    expect(next.winner?.id).toBe(0);
  });
});
