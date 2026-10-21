import { useState, useEffect, useRef } from 'react';
import { GameState, GameMode, GamePhase, OnlineRoom } from '../types';
import { createRoom, joinRoom, subscribeToRoom, updateGameState, getRoomData, resetRoomToLobby, leaveRoom, claimHost } from '../services/online';
import { supabase } from '../services/supabase';

const SESSION_KEY = 'TRI_STACK_SESSION';
// How long the host must be offline before someone takes over: rides out a
// brief reconnect so host doesn't flap. Not a turn timer; nobody is rushed.
const HOST_GRACE_MS = 8000;
// Realtime can drop an update; this re-read is what brings the phone back.
const POLL_MS = 5000;

// Everything about being in a Supabase room: identity, lobby roster, the
// realtime subscription, reconnect-on-refresh and pushing state up.
//
// It does not own game rules. Server updates are handed to setGameState, and
// onGameStarted lets App close whatever menu the player was on; onRemoved tells
// it this phone is no longer in the room (kicked).
export const useOnlineRoom = ({
  session,
  gameMode,
  setGameState,
  setIsGuest,
  getDisplayName,
  onGameStarted,
  onRemoved
}: {
  session: any;
  gameMode: GameMode;
  setGameState: React.Dispatch<React.SetStateAction<GameState>>;
  setIsGuest: (v: boolean) => void;
  getDisplayName: () => string;
  onGameStarted: () => void;
  onRemoved: () => void;
}) => {
  const [roomCode, setRoomCode] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [myOnlineId, setMyOnlineId] = useState<number | null>(null); // Who am I?
  const [onlineHostId, setOnlineHostId] = useState<number>(0); // Who is the host?
  const [onlineLobbyPlayers, setOnlineLobbyPlayers] = useState<{id: number, name: string}[]>([]);
  const [isOnlineLobby, setIsOnlineLobby] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false); // Visual indicator for online ops
  const [isReconnecting, setIsReconnecting] = useState(false); // Loading state for refresh logic
  const [isJoining, setIsJoining] = useState(false); // Prevent double-join clicks
  const [onlineIds, setOnlineIds] = useState<number[]>([]); // Who has the game open

  const saveSession = (code: string, playerId: number) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ code, playerId }));
  };

  // --- Reconnection Logic (Check LocalStorage) ---
  useEffect(() => {
    const checkSession = async () => {
      const savedSession = localStorage.getItem(SESSION_KEY);
      if (savedSession) {
        try {
          setIsReconnecting(true);
          const { code, playerId } = JSON.parse(savedSession);

          // Verify room still exists and fetch state
          const { data: roomData, error } = await getRoomData(code);

          if (error || !roomData || !roomData.players?.some(p => p.id === playerId)) {
             // Session invalid (room deleted, or we were kicked), clear it
             console.warn("Session invalid, clearing.");
             localStorage.removeItem(SESSION_KEY);
             setIsReconnecting(false);
             return;
          }

          // Restore Session Data
          setRoomCode(code);
          setMyOnlineId(playerId);
          const currentHostId = parseInt(roomData.host_id, 10);
          setOnlineHostId(currentHostId);

          // CRITICAL FIX: Bypass Auth Guard for reconnected user
          setIsGuest(true);

          if (roomData.status === 'WAITING') {
            setOnlineLobbyPlayers(roomData.players || []);
            setIsOnlineLobby(true); // Ensure we land in lobby
            setGameState(prev => ({ ...prev, gameMode: (playerId === currentHostId ? 'ONLINE_HOST' : 'ONLINE_CLIENT') as GameMode }));
          } else {
             // Game is in progress
             if (roomData.game_state) {
               const effectiveMode = (playerId === currentHostId ? 'ONLINE_HOST' : 'ONLINE_CLIENT') as GameMode;
               setGameState({
                 ...roomData.game_state,
                 gameMode: effectiveMode
               });
               setIsOnlineLobby(false);
             }
          }
        } catch (e) {
          console.error("Reconnection failed", e);
          localStorage.removeItem(SESSION_KEY);
        } finally {
          setIsReconnecting(false);
        }
      }
    };

    checkSession();
  }, []);

  // Latest host / roster / who's online, for the host handover check.
  const hostRef = useRef(0);
  const rosterRef = useRef<number[]>([]);
  const onlineRef = useRef<number[]>([]);
  // Whose move the table waits on; null when it waits on the host (lobby, round end).
  const turnRef = useRef<number | null>(null);
  const hostTimer = useRef<ReturnType<typeof setTimeout>>();
  const writes = useRef(Promise.resolve());
  const queued = useRef(0); // writes started / finished, to tell when none is in flight
  const done = useRef(0);
  // The room this phone is in, so a late reply after leaving is ignored.
  const activeRoom = useRef('');

  // Host handover: once the host has been offline for HOST_GRACE_MS, the
  // lowest-id player still online claims it (compare-and-swap, so one wins).
  // Only when the table waits on the host (lobby, between rounds, or a player
  // dropped on their turn and needs kicking): a host who locks their phone
  // mid-round keeps the role.
  const checkHost = (code: string) => {
    const here = onlineRef.current.filter(id => rosterRef.current.includes(id));
    const host = hostRef.current, turn = turnRef.current;
    const needed = turn === null || !here.includes(turn);
    const shouldClaim = needed && myOnlineId !== null && here.length > 0 && !here.includes(host) && Math.min(...here) === myOnlineId;
    if (!shouldClaim) {
      clearTimeout(hostTimer.current);
      hostTimer.current = undefined;
    } else if (!hostTimer.current) {
      hostTimer.current = setTimeout(() => { hostTimer.current = undefined; claimHost(code, host, myOnlineId!); }, HOST_GRACE_MS);
    }
  };

  // Apply a room row from the server. Within one match an older version is
  // ignored, so a late echo of our own earlier move can't rewind the board.
  // `force` is for after a refused write: then the server copy wins outright.
  const applyRoom = (roomData: OnlineRoom, force = false) => {
    if (roomData.code !== activeRoom.current) return;
    rosterRef.current = (roomData.players || []).map(p => p.id);
    if (myOnlineId !== null && !rosterRef.current.includes(myOnlineId)) {
      activeRoom.current = '';
      return onRemoved();
    }
    const currentHostId = parseInt(roomData.host_id, 10);
    setOnlineHostId(currentHostId);
    hostRef.current = currentHostId;
    const g = roomData.game_state;
    turnRef.current = roomData.status !== 'WAITING' && g && g.phase !== GamePhase.ROUND_END ? g.players[g.currentPlayerIndex]?.id ?? null : null;
    checkHost(roomData.code);

    // 1. Lobby Updates (Waiting phase)
    if (roomData.status === 'WAITING') {
       setOnlineLobbyPlayers(roomData.players || []);

       setIsOnlineLobby(true);

       setGameState(prev => {
          // If we were playing but room went back to waiting (Host clicked Return to Lobby)
          if (prev.gameMode) {
             const mode = myOnlineId === currentHostId ? 'ONLINE_HOST' : 'ONLINE_CLIENT';
             if (prev.gameMode !== mode) {
               return { ...prev, gameMode: mode as GameMode };
             }
          }
          return prev;
       });
    }
    // 2. Game Updates (Playing phase)
    else if (roomData.status === 'PLAYING' || roomData.status === 'FINISHED') {
       const incoming = roomData.game_state;
       if (incoming) {
         // CRITICAL FIX: Determine correct local mode
         // Even if server says "ONLINE_HOST", if I am not the host, I treat it as CLIENT locally
         // This ensures the UI renders correctly (e.g. Next Round button hidden)
         const effectiveMode = (myOnlineId === currentHostId ? 'ONLINE_HOST' : 'ONLINE_CLIENT') as GameMode;

         setGameState(prev => {
           // Keep ours if it is newer (a late echo) or already this exact state;
           // the role is taken from the server either way.
           const keep = (!force && incoming.gameId === prev.gameId && (incoming.version ?? 0) < (prev.version ?? 0))
             || (!!incoming.rev && incoming.rev === prev.rev);
           if (keep && prev.gameMode === effectiveMode) return prev;
           return { ...(keep ? prev : incoming), gameMode: effectiveMode };
         });

         setIsOnlineLobby(false); // Game started, exit lobby view
         onGameStarted();         // Cleanup: close name-entry / online menus
         setIsSyncing(false);     // Update received, sync complete
       }
    }
  };

  // Re-read the room: realtime does not replay changes missed while offline,
  // and can drop one. If no write of ours was in flight meanwhile, the server
  // copy wins outright: that also frees a phone left ahead by a failed write.
  const resync = async (code: string, force = false) => {
    const seq = queued.current, idle = done.current === seq;
    const { data } = await getRoomData(code);
    if (data) applyRoom(data, force || (idle && queued.current === seq));
  };

  // --- Online Subscription Effect ---
  useEffect(() => {
    if (!roomCode) return;
    activeRoom.current = roomCode;

    const subscription = subscribeToRoom(
      roomCode,
      myOnlineId,
      roomData => applyRoom(roomData),
      () => resync(roomCode), // joined, or rejoined after a drop: catch up
      ids => { onlineRef.current = ids; setOnlineIds(ids); checkHost(roomCode); }
    );

    // A phone waking up may not have noticed its connection died.
    const onVisible = () => { if (document.visibilityState === 'visible') resync(roomCode); };
    document.addEventListener('visibilitychange', onVisible);
    const poll = setInterval(onVisible, POLL_MS);

    return () => {
      activeRoom.current = '';
      clearInterval(poll);
      clearTimeout(hostTimer.current);
      hostTimer.current = undefined;
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(subscription);
    };
  }, [roomCode, myOnlineId]);

  // --- Helper to Push State Online ---
  // Writes are queued so a quick second move can't overtake the first. A
  // refused write means the board changed under us: take the server's copy.
  // `parent` is the state newState was built from (null: a match's first round).
  const syncOnlineState = (newState: GameState, parent: GameState | null) => {
    // Only sync if we have a room code and are in an online mode
    if ((gameMode === 'ONLINE_HOST' || gameMode === 'ONLINE_CLIENT') && roomCode) {
       setIsSyncing(true);
       const code = roomCode;
       queued.current++;
       writes.current = writes.current
         .then(() => updateGameState(code, newState, parent))
         .then(ok => { if (!ok) return resync(code, true); })
         .catch(() => {}) // the next poll catches us up
         .then(() => { done.current++; });
    }
  };

  const createGame = async () => {
    const hostName = getDisplayName();
    const { code, error } = await createRoom(hostName, session?.user?.id || 'guest');

    if (error) {
      alert("Error creating room: " + (error.message || 'Check your connection'));
      return;
    }

    setRoomCode(code);
    setMyOnlineId(0); // Host is always ID 0
    saveSession(code, 0); // PERSIST SESSION

    setOnlineLobbyPlayers([{ id: 0, name: hostName }]);
    setIsOnlineLobby(true);
    setGameState(prev => ({ ...prev, gameMode: 'ONLINE_HOST' })); // Temporary mode until start
    // Removed forced reset to 5 here to respect user choice
  };

  const joinGame = async () => {
    if (isJoining) return; // Prevent double clicks
    if (joinCodeInput.length !== 4) return alert("Enter a 4-letter code");

    setIsJoining(true);
    const myName = getDisplayName();

    const { success, error, playerId, players } = await joinRoom(joinCodeInput.toUpperCase(), myName);

    if (!success) {
      alert(error);
      setIsJoining(false);
      return;
    }

    const code = joinCodeInput.toUpperCase();
    setRoomCode(code);
    setMyOnlineId(playerId!);
    saveSession(code, playerId!); // PERSIST SESSION

    setOnlineLobbyPlayers(players!);
    setIsOnlineLobby(true);
    setGameState(prev => ({ ...prev, gameMode: 'ONLINE_CLIENT' }));
    setIsJoining(false);
  };

  const returnToLobby = async () => {
    if (roomCode) {
      await resetRoomToLobby(roomCode);
      // The subscription will detect the 'WAITING' status and switch UI
    }
  };

  const kickPlayer = async (playerId: number) => {
    leaveRoom(roomCode, playerId);
  };

  // Drop out of the room: tell the DB, forget the session, reset online state.
  // App resets game + menu state around this.
  const leave = () => {
    // 1. Leave Room in DB (Ghost Player Fix)
    if (gameMode === 'ONLINE_HOST' || gameMode === 'ONLINE_CLIENT' || roomCode) {
       if (myOnlineId !== null && roomCode) {
          // Fire and forget - attempting to remove player from DB
          leaveRoom(roomCode, myOnlineId!);
       }
    }

    // 2. Clear Persistence
    localStorage.removeItem(SESSION_KEY);

    // 3. Reset Online State
    setRoomCode('');
    setMyOnlineId(null);
    setOnlineLobbyPlayers([]);
    setIsOnlineLobby(false);
    setIsSyncing(false);
    setIsReconnecting(false);
    setIsJoining(false);
    setOnlineIds([]);
  };

  return {
    roomCode,
    joinCodeInput,
    setJoinCodeInput,
    myOnlineId,
    onlineHostId,
    onlineLobbyPlayers,
    onlineIds,
    isOnlineLobby,
    isSyncing,
    isReconnecting,
    isJoining,
    syncOnlineState,
    createGame,
    joinGame,
    returnToLobby,
    kickPlayer,
    leave
  };
};
