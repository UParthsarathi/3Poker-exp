import { useState, useEffect } from 'react';
import { GameState, GameMode } from '../types';
import { createRoom, joinRoom, subscribeToRoom, updateGameState, getRoomData, resetRoomToLobby, leaveRoom } from '../services/online';
import { supabase } from '../services/supabase';

const SESSION_KEY = 'TRI_STACK_SESSION';

// Everything about being in a Supabase room: identity, lobby roster, the
// realtime subscription, reconnect-on-refresh and pushing state up.
//
// It does not own game rules. Server updates are handed to setGameState, and
// onGameStarted lets App close whatever menu the player was on.
export const useOnlineRoom = ({
  session,
  gameMode,
  setGameState,
  setIsGuest,
  getDisplayName,
  onGameStarted
}: {
  session: any;
  gameMode: GameMode;
  setGameState: React.Dispatch<React.SetStateAction<GameState>>;
  setIsGuest: (v: boolean) => void;
  getDisplayName: () => string;
  onGameStarted: () => void;
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

          if (error || !roomData) {
             // Session invalid (room deleted?), clear it
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

  // --- Online Subscription Effect ---
  useEffect(() => {
    if (!roomCode) return;

    // Subscribe to changes in the room
    const subscription = subscribeToRoom(roomCode, (roomData) => {
      const currentHostId = parseInt(roomData.host_id, 10);
      setOnlineHostId(currentHostId);

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
         // Force the game state from server to local
         if (roomData.game_state) {
           // CRITICAL FIX: Determine correct local mode
           // Even if server says "ONLINE_HOST", if I am not the host, I treat it as CLIENT locally
           // This ensures the UI renders correctly (e.g. Next Round button hidden)
           const effectiveMode = (myOnlineId === currentHostId ? 'ONLINE_HOST' : 'ONLINE_CLIENT') as GameMode;

           setGameState(prev => ({
             ...roomData.game_state,
             gameMode: effectiveMode
           }));

           setIsOnlineLobby(false); // Game started, exit lobby view
           onGameStarted();         // Cleanup: close name-entry / online menus
           setIsSyncing(false);     // Update received, sync complete
         }
      }
    });

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [roomCode, myOnlineId]);

  // --- Helper to Push State Online ---
  const syncOnlineState = async (newState: GameState) => {
    // Only sync if we have a room code and are in an online mode
    if ((gameMode === 'ONLINE_HOST' || gameMode === 'ONLINE_CLIENT') && roomCode) {
       setIsSyncing(true);
       await updateGameState(roomCode, newState);
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
  };

  return {
    roomCode,
    joinCodeInput,
    setJoinCodeInput,
    myOnlineId,
    onlineHostId,
    onlineLobbyPlayers,
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
