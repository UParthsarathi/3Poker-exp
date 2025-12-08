import { supabase } from './supabase';
import { GameState, OnlineRoom } from '../types';

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
    host_id: hostId,
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

export const joinRoom = async (code: string, playerName: string): Promise<{ success: boolean; playerId?: number; players?: any[]; error?: string }> => {
  // 1. Fetch Room initially to check existence
  let { data: room, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('code', code)
    .single();

  if (error || !room) return { success: false, error: 'Room not found' };
  if (room.status !== 'WAITING') return { success: false, error: 'Game already started' };

  // 2. Add Player with Race Condition Mitigation
  const { data: freshRoom, error: refreshError } = await supabase
    .from('rooms')
    .select('players')
    .eq('code', code)
    .single();

  if (refreshError || !freshRoom) return { success: false, error: 'Connection lost' };

  const currentPlayers = freshRoom.players || [];
  if (currentPlayers.length >= 10) return { success: false, error: 'Room full' };

  // SAFE ID GENERATION: Find max ID and add 1 (prevents duplicates if someone leaves)
  const maxId = currentPlayers.reduce((max: number, p: any) => Math.max(max, p.id), -1);
  const newPlayerId = maxId + 1;
  
  const updatedPlayers = [...currentPlayers, { id: newPlayerId, name: playerName }];

  const { error: updateError } = await supabase
    .from('rooms')
    .update({ players: updatedPlayers })
    .eq('code', code);

  if (updateError) return { success: false, error: updateError.message };

  return { success: true, playerId: newPlayerId, players: updatedPlayers };
};

export const leaveRoom = async (code: string, playerId: number) => {
  // 1. Fetch current players
  const { data: room } = await supabase
    .from('rooms')
    .select('players')
    .eq('code', code)
    .single();

  if (!room || !room.players) return;

  const updatedPlayers = room.players.filter((p: any) => p.id !== playerId);

  if (updatedPlayers.length === 0) {
    // If room is empty, delete it
    await supabase.from('rooms').delete().eq('code', code);
  } else {
    // Otherwise update list
    await supabase
      .from('rooms')
      .update({ players: updatedPlayers })
      .eq('code', code);
  }
};

export const updateGameState = async (code: string, newState: GameState) => {
  if (!code) {
    console.error("Cannot sync state: No room code provided");
    return;
  }

  // We only sync the state and status
  const status = newState.phase === 'MATCH_END' ? 'FINISHED' : 'PLAYING';
  
  const { error } = await supabase
    .from('rooms')
    .update({ 
      game_state: newState,
      status: status
    })
    .eq('code', code);

  if (error) {
    console.error("Failed to sync game state:", error.message);
  }
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

export const subscribeToRoom = (code: string, onUpdate: (room: OnlineRoom) => void) => {
  return supabase
    .channel(`room:${code}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `code=eq.${code}` },
      (payload) => {
        if (payload.new) {
          onUpdate(payload.new as OnlineRoom);
        }
      }
    )
    .subscribe();
};