import { supabase } from './supabase';
import { GameState, OnlineRoom } from '../types';
import { gameReducer } from '../state/gameReducer';

// Every write below is compare-and-swap: it only lands if the row still holds
// what this client last read, so a stale or out-of-order write is refused
// instead of silently overwriting everyone's game.

// Match rows whose game_state is at `version`. 0 means "no game yet", which
// also matches a null game_state (lobby) and rooms from before versioning.
const atVersion = (q: any, version: number) =>
  version > 0 ? q.eq('game_state->>version', String(version)) : q.is('game_state->>version', null);

// Guard on what we read: the roster in the lobby, the game version once playing.
const unchangedSince = (q: any, room: OnlineRoom) =>
  room.status === 'WAITING' ? q.eq('players', JSON.stringify(room.players)) : atVersion(q, room.game_state?.version ?? 0);

// Generate a random 4-letter room code
const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const createRoom = async (hostName: string, hostId: string): Promise<{ code: string; error: any }> => {
  const code = generateRoomCode();
  
  const initialRoom: Partial<OnlineRoom> = {
    code,
    host_id: "0",
    players: [{ id: 0, name: hostName }],
    status: 'WAITING',
    game_state: null
  };

  const { error } = await supabase.from('rooms').insert([initialRoom]);
  return { code, error };
};

export const getRoomData = async (code: string): Promise<{ data: OnlineRoom | null; error: any }> => {
  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('code', code)
    .single();
    
  return { data: data as OnlineRoom, error };
};

// Joins and leaves re-read and retry when their compare-and-swap loses a race.
const ATTEMPTS = 5;

export const joinRoom = async (code: string, playerName: string): Promise<{ success: boolean; playerId?: number; players?: any[]; error?: string }> => {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { data: room, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('code', code)
      .single();

    if (error || !room) return { success: false, error: 'Room not found' };
    if (room.status !== 'WAITING') return { success: false, error: 'Game already started' };

    const currentPlayers = room.players || [];
    if (currentPlayers.length >= 10) return { success: false, error: 'Room full' };

    // SAFE ID GENERATION: Find max ID and add 1 (prevents duplicates if someone leaves)
    const maxId = currentPlayers.reduce((max: number, p: any) => Math.max(max, p.id), -1);
    const newPlayerId = maxId + 1;

    const updatedPlayers = [...currentPlayers, { id: newPlayerId, name: playerName }];

    // Two people joining at once both read the same roster; only one write lands.
    const { data, error: updateError } = await unchangedSince(
      supabase.from('rooms').update({ players: updatedPlayers }).eq('code', code),
      room
    ).select('code');

    if (updateError) return { success: false, error: updateError.message };
    if (data.length) return { success: true, playerId: newPlayerId, players: updatedPlayers };
  }
  return { success: false, error: 'Room is busy, try again' };
};

export const leaveRoom = async (code: string, playerId: number) => {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { data: room } = await supabase
      .from('rooms')
      .select('*')
      .eq('code', code)
      .single();

    if (!room || !room.players) return;

    const updatedPlayers = room.players.filter((p: any) => p.id !== playerId);

    if (updatedPlayers.length === 0) {
      // If room is empty, delete it
      await supabase.from('rooms').delete().eq('code', code);
      return;
    }

    // Otherwise update list and potentially host
    const updates: any = { players: updatedPlayers };

    if (room.host_id === playerId.toString()) {
      updates.host_id = updatedPlayers[0].id.toString();
    }

    // Mid-game the reducer takes them off the table (cards back, turn reset)
    if ((room.status === 'PLAYING' || room.status === 'FINISHED') && room.game_state) {
      const gs = gameReducer(room.game_state, { type: 'LEAVE', playerId });
      if (gs !== room.game_state) {
        updates.game_state = gs;
        if (gs.players.length <= 1 && room.status === 'PLAYING') updates.status = 'FINISHED';
      }
    }

    const { data } = await unchangedSince(supabase.from('rooms').update(updates).eq('code', code), room).select('code');
    if (data?.length) return;
  }
};

// Returns false when the write was refused (someone else changed the game
// first) or failed, so the caller can take the server's copy instead.
export const updateGameState = async (code: string, newState: GameState): Promise<boolean> => {
  if (!code) {
    console.error("Cannot sync state: No room code provided");
    return false;
  }

  // We only sync the state and status
  const status = newState.phase === 'MATCH_END' ? 'FINISHED' : 'PLAYING';

  // newState was built from version - 1, so that is what the row must still hold.
  const { data, error } = await atVersion(
    supabase.from('rooms').update({ game_state: newState, status }).eq('code', code),
    (newState.version ?? 1) - 1
  ).select('code');

  if (error) {
    console.error("Failed to sync game state:", error.message);
    return false;
  }
  return data.length > 0;
};

export const resetRoomToLobby = async (code: string) => {
  const { error } = await supabase
    .from('rooms')
    .update({
      status: 'WAITING',
      game_state: null
    })
    .eq('code', code);
    
  if (error) {
    console.error("Reset lobby failed", error);
  }
};

// Only one of several players noticing the host is gone gets to take over.
export const claimHost = async (code: string, oldHostId: number, newHostId: number) => {
  await supabase.from('rooms').update({ host_id: String(newHostId) }).eq('code', code).eq('host_id', String(oldHostId));
};

export const subscribeToRoom = (
  code: string,
  myId: number | null,
  onUpdate: (room: OnlineRoom) => void,
  onJoined: () => void,
  onPresence: (onlineIds: number[]) => void
) => {
  const channel = supabase.channel(`room:${code}`, { config: { presence: { key: String(myId) } } });
  return channel
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `code=eq.${code}` },
      (payload) => {
        if (payload.new) {
          onUpdate(payload.new as OnlineRoom);
        }
      }
    )
    // Who has the game open right now (used to hand host over).
    .on('presence', { event: 'sync' }, () => onPresence(Object.keys(channel.presenceState()).map(Number)))
    // Fires on the first join and again after every reconnect. Realtime does not
    // replay what was missed while offline, so the caller re-reads the room.
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      channel.track({ id: myId });
      onJoined();
    });
};