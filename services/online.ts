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

export const joinRoom = async (code: string, playerName: string): Promise<{ success: boolean; playerId?: number; players?: any[]; error?: string }> => {
  // 1. Fetch Room
  const { data: room, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('code', code)
    .single();

  if (error || !room) return { success: false, error: 'Room not found' };
  if (room.status !== 'WAITING') return { success: false, error: 'Game already started' };

  // 2. Add Player
  const currentPlayers = room.players || [];
  if (currentPlayers.length >= 7) return { success: false, error: 'Room full' };

  const newPlayerId = currentPlayers.length;
  const updatedPlayers = [...currentPlayers, { id: newPlayerId, name: playerName }];

  const { error: updateError } = await supabase
    .from('rooms')
    .update({ players: updatedPlayers })
    .eq('code', code);

  if (updateError) return { success: false, error: updateError.message };

  return { success: true, playerId: newPlayerId, players: updatedPlayers };
};

export const updateGameState = async (code: string, newState: GameState) => {
  // We only sync the state and status
  const status = newState.phase === 'MATCH_END' ? 'FINISHED' : 'PLAYING';
  
  await supabase
    .from('rooms')
    .update({ 
      game_state: newState,
      status: status
    })
    .eq('code', code);
};

export const subscribeToRoom = (code: string, onUpdate: (room: OnlineRoom) => void) => {
  return supabase
    .channel(`room:${code}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `code=eq.${code}` },
      (payload) => {
        onUpdate(payload.new as OnlineRoom);
      }
    )
    .subscribe();
};
