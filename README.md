# 🎴 TRI-STACK

TRI-STACK is a turn-based multiplayer card game built with **React + TypeScript**, supporting
single-player AI, local pass-and-play, and real-time online multiplayer.

Unlike most casual card games, TRI-STACK is implemented as a **finite-state game engine**
with a **host-authoritative multiplayer model**, focusing on correctness, fairness,
and system design rather than visual polish.

---

## Why TRI-STACK?

This project was built to explore and demonstrate:

- Designing a finite-state game engine in the browser
- Handling multiplayer synchronization without a dedicated game server
- Managing fairness, randomness, and turn integrity
- Building a non-trivial system using strong static typing
- Safely developing complex logic with AI-assisted tooling

The emphasis is on **system architecture and correctness**, not graphics.

---

## Game Modes

### 🧠 Single Player
- Human player vs AI bots
- Bots follow the same rules and phases as human players
- Decisions are derived from the current game state

### 👥 Local Multiplayer
- Pass-and-play on a single device
- Active player is always shown at the bottom
- Screen transition overlay hides hands between turns

### 🌐 Online Multiplayer
- Real-time rooms with 4-letter room codes
- Host (Player ID `0`) acts as the single source of truth
- Clients subscribe to state updates and can act only on their turn
- Session persistence allows reconnection after refresh or network loss

---

## Game Engine Design

### Finite State Machine

Gameplay is driven by explicit game phases:
i.SETUP
ii.PLAYER_TURN_START
iii.PLAYER_TOSSING_DRAW
iv.PLAYER_DRAW
v.ROUND_END
vi.MATCH_END


Each user action is gated by the current phase, preventing:
- Illegal moves
- Double actions
- Out-of-turn interactions
- Online desynchronization

---

### Turn Lifecycle (Simplified)

1. **PLAYER_TURN_START**
   - Player may toss, discard, or call SHOW
2. **PLAYER_TOSSING_DRAW**
   - Toss animation → must draw
3. **PLAYER_DRAW**
   - Draw from deck or open pile
4. **Turn End**
   - Pending actions are committed
   - Turn advances to the next player

AI bots follow the **exact same lifecycle** as human players.

---

## Randomness & Fairness

- Deck creation and shuffling are implemented in `services/gameLogic.ts`
- Uses an unbiased shuffle algorithm (Fisher–Yates)
- Joker rank is selected randomly each round
- Open pile recycling preserves the top visible card

> Joker repetition across rounds is expected behavior in true randomness and is not a bug.

The game favors **mathematical fairness** over artificial smoothing.

---

## Online Multiplayer Model

### Authority
- Host (Player 0) is the single writer for the room
- Clients are read-only except during their own turn
- UI role (`ONLINE_HOST` / `ONLINE_CLIENT`) is determined locally

### Synchronization
- Entire `GameState` is synced via Supabase Realtime
- Clients rehydrate local state from server updates
- Prevents race conditions and split-brain states

### Session Persistence
Active sessions are stored in `localStorage`, enabling:
- Page refresh recovery
- Network interruption recovery
- Automatic rejoin if the room still exists

---

## TypeScript & Static Typing

The project uses TypeScript to enforce correctness at compile time:

- Strongly typed `GameState`, `Player`, and `CardData`
- Enum-based game phases
- Prevention of invalid state transitions
- Safer AI-assisted development

Static typing prevents entire classes of runtime errors before the game runs.

---

## Project Structure

┌─────────────────────────────┐
│        React UI (TSX)       │
│  - Renders based on state   │
│  - No game rules            │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│      Game Orchestrator      │
│          (App.tsx)          │
│  - Controls phases          │
│  - Validates actions        │
│  - Advances turns           │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│     Pure Game Logic Layer   │
│   (services/gameLogic.ts)  │
│  - Deck creation & shuffle │
│  - Scoring rules            │
│  - Bot decisions            │
└───────────────┬─────────────┘
                │
                ▼
┌─────────────────────────────┐
│   Realtime Sync Layer       │
│   (services/online.ts)      │
│  - Room creation            │
│  - State broadcasting       │
│  - Client subscriptions    │
└─────────────────────────────┘
##Game State Model

The entire game is represented by a strongly typed GameState object.

Responsibilities of GameState:

Tracks players, hands, scores, and turn order

Stores deck, open pile, and round joker

Controls the current phase of gameplay

Acts as the single source of truth for UI and logic

UI components never infer rules — they only reflect GameState

---

## Tech Stack

- **Frontend:** React + TypeScript (`.tsx`)
- **Build Tool:** Vite
- **Realtime Backend:** Supabase
- **State Model:** Finite-state machine
- **Icons:** lucide-react

---

## Known Limitations 

- Full game state is synced per turn (not event-based)
- No cheating prevention against malicious hosts
- Designed for small-to-medium concurrent rooms

These trade-offs prioritize **clarity, correctness, and iteration speed**.

---

## Future Improvements

- Event-based state synchronization
- Seeded randomness for replay/debugging
- Server-side validation for competitive modes
- Reducer-based game engine extraction
- Spectator and replay support

---

## Running the Project
npm install
npm run dev


