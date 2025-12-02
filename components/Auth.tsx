import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { Mail, Lock, LogIn, UserPlus, Ghost, Loader2 } from 'lucide-react';

interface AuthProps {
  onGuestPlay: () => void;
}

const Auth: React.FC<AuthProps> = ({ onGuestPlay }) => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setMessage({ type: 'success', text: 'Check your email for the confirmation link!' });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        // Successful login will be caught by the onAuthStateChange listener in App.tsx
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'An error occurred' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-[100dvh] bg-[#1a2e1a] flex flex-col items-center justify-center p-4">
      <h1 className="font-serif text-5xl md:text-7xl font-bold text-yellow-500 mb-8 drop-shadow-2xl">TRI-STACK</h1>
      
      <div className="bg-slate-900/50 p-8 rounded-2xl backdrop-blur-sm border border-white/10 shadow-2xl flex flex-col gap-6 w-full max-w-md animate-in fade-in zoom-in duration-300">
        <div className="text-center mb-2">
          <h2 className="text-2xl text-white font-bold">{isSignUp ? 'Create Account' : 'Welcome Back'}</h2>
          <p className="text-gray-400 text-sm">{isSignUp ? 'Sign up to track your stats' : 'Login to your account'}</p>
        </div>

        {message && (
          <div className={`p-3 rounded-lg text-sm font-bold text-center ${message.type === 'error' ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}`}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleAuth} className="flex flex-col gap-4">
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input 
              type="email" 
              placeholder="Email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-slate-800 text-white pl-10 pr-4 py-3 rounded-xl border border-slate-600 focus:border-yellow-500 focus:outline-none transition-colors"
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input 
              type="password" 
              placeholder="Password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full bg-slate-800 text-white pl-10 pr-4 py-3 rounded-xl border border-slate-600 focus:border-yellow-500 focus:outline-none transition-colors"
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="bg-yellow-500 hover:bg-yellow-400 text-black py-3 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-yellow-900/20 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" /> : (isSignUp ? <UserPlus size={20} /> : <LogIn size={20} />)}
            {isSignUp ? 'Sign Up' : 'Login'}
          </button>
        </form>

        <div className="flex items-center gap-4 text-sm text-gray-400">
          <div className="h-px bg-white/10 flex-1" />
          <span>OR</span>
          <div className="h-px bg-white/10 flex-1" />
        </div>

        <button 
          onClick={onGuestPlay}
          className="bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
        >
          <Ghost size={20} /> Play as Guest
        </button>

        <p className="text-center text-sm text-gray-400 mt-2">
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}
          <button 
            onClick={() => { setIsSignUp(!isSignUp); setMessage(null); }}
            className="text-yellow-500 font-bold ml-1 hover:underline"
          >
            {isSignUp ? 'Login' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  );
};

export default Auth;