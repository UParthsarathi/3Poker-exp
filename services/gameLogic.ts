
import { CardData, Player, Rank, Suit, BotAction } from '../types';
import { SUITS, RANKS, RANK_VALUES } from '../constants';

// --- Deck Management ---

export const createDeck = (): CardData[] => {
  const deck: CardData[] = [];
  let idCounter = 0;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `card-${idCounter++}-${rank}-${suit}`,
        suit,
        rank,
        value: RANK_VALUES[rank],
      });
    }
  }
  return shuffleDeck(deck);
};

export const shuffleDeck = (deck: CardData[]): CardData[] => {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
};

// --- Scoring ---

export const calculateHandValue = (hand: CardData[] | undefined, joker: CardData | null): number => {
  if (!hand || !Array.isArray(hand) || hand.length === 0) return 0;
  
  return hand.reduce((sum, card) => {
    if (!card) return sum;
    // Check if card is the joker (Rank matches)
    if (joker && card.rank === joker.rank) {
      return sum + 0;
    }
    return sum + (card.value || 0);
  }, 0);
};

export const getRoundScores = (
  players: Player[], 
  callerIndex: number, 
  joker: CardData | null
): { playerId: number; roundScore: number }[] => {
  if (!players || players.length === 0) return [];
  
  const handValues = players.map(p => ({
    id: p.id,
    val: calculateHandValue(p.hand, joker)
  }));

  const callerPlayer = players[callerIndex];
  if (!callerPlayer) return players.map(p => ({ playerId: p.id, roundScore: calculateHandValue(p.hand, joker) }));

  const callerValue = handValues.find(h => h.id === callerPlayer.id)?.val || 0;
  const lowestValue = Math.min(...handValues.map(h => h.val));
  
  const winnersCount = handValues.filter(h => h.val === lowestValue).length;
  const callerIsLowest = callerValue === lowestValue;

  return players.map(p => {
    const handVal = calculateHandValue(p.hand, joker);
    let roundScore = handVal;

    if (p.id === callerPlayer.id) {
      if (callerIsLowest && winnersCount === 1) {
        roundScore = 0;
      } else if (callerIsLowest && winnersCount > 1) {
        roundScore = 25;
      } else {
        roundScore = 50;
      }
    }

    return { playerId: p.id, roundScore };
  });
};

// --- Bot Logic ---

export const decideBotAction = (player: Player | undefined, joker: CardData | null, tossedThisTurn: boolean): BotAction => {
  if (!player || !player.hand || player.hand.length === 0) {
    return { type: 'DISCARD', cardIds: [] };
  }

  const hand = player.hand.filter(Boolean);
  const currentScore = calculateHandValue(hand, joker);

  // 1. Check for TOSS
  if (!tossedThisTurn && hand.length >= 2) {
    const rankCounts: Record<string, CardData[]> = {};
    for (const card of hand) {
      if (!card) continue;
      if (!rankCounts[card.rank]) rankCounts[card.rank] = [];
      rankCounts[card.rank].push(card);
    }
  
    for (const rank in rankCounts) {
      if (rankCounts[rank].length >= 2) {
        // Skip tossing Jokers
        if (joker && rankCounts[rank][0].rank === joker.rank) continue; 
        return { 
          type: 'TOSS', 
          cardIds: [rankCounts[rank][0].id, rankCounts[rank][1].id] 
        };
      }
    }
  }

  // 2. Check for SHOW
  if (currentScore <= 5) {
    return { type: 'SHOW' };
  }

  // 3. DISCARD highest
  let highestCard = hand[0];
  let highestVal = -1;

  hand.forEach(c => {
    if (!c) return;
    const val = (joker && c.rank === joker.rank) ? 0 : (c.value || 0);
    if (val > highestVal) {
      highestVal = val;
      highestCard = c;
    }
  });

  return { type: 'DISCARD', cardIds: highestCard ? [highestCard.id] : [] };
};
