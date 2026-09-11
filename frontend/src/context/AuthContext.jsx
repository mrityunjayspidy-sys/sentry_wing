import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  supabase,
  isSupabaseConfigured,
  supabaseSignIn,
  supabaseSignUp,
  supabaseSignOut,
  supabaseGetSession,
  supabaseGetUserProfile
} from '../utils/supabase';
import { apiFetch } from '../utils/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('sentrywing_user');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    // Default logged in as demo Ranger Maya (Normal User)
    return {
      id: 'user_01',
      email: 'user@forest.gov.in',
      name: 'Ranger Maya Patil',
      role: 'user'
    };
  });

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const isSupabase = isSupabaseConfigured();

  // Supabase Auth State Synchronization
  useEffect(() => {
    if (!isSupabase || !supabase) return;

    supabaseGetSession().then(async (session) => {
      if (session?.user) {
        const profile = await supabaseGetUserProfile(session.user.id);
        const userObj = {
          id: session.user.id,
          email: session.user.email,
          name: profile?.name || session.user.user_metadata?.name || session.user.email.split('@')[0],
          role: profile?.role || session.user.user_metadata?.role || 'user'
        };
        setCurrentUser(userObj);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const profile = await supabaseGetUserProfile(session.user.id);
        const userObj = {
          id: session.user.id,
          email: session.user.email,
          name: profile?.name || session.user.user_metadata?.name || session.user.email.split('@')[0],
          role: profile?.role || session.user.user_metadata?.role || 'user'
        };
        setCurrentUser(userObj);
      } else if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [isSupabase]);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('sentrywing_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('sentrywing_user');
    }
  }, [currentUser]);

  const login = async (email, password, role) => {
    if (isSupabase && supabase) {
      try {
        const sbData = await supabaseSignIn(email, password);
        const sbUser = sbData.user;
        const profile = await supabaseGetUserProfile(sbUser.id);
        const userObj = {
          id: sbUser.id,
          email: sbUser.email,
          name: profile?.name || sbUser.user_metadata?.name || email.split('@')[0],
          role: profile?.role || sbUser.user_metadata?.role || role || 'user'
        };
        setCurrentUser(userObj);
        setIsAuthModalOpen(false);

        // Keep local backend in sync
        apiFetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, role })
        }).catch(() => {});

        return userObj;
      } catch (sbErr) {
        console.warn('Supabase sign-in failed, checking local database:', sbErr.message);
        // Fallback to local auth if Supabase user not found or offline
      }
    }

    // Local Backend Authentication
    const resp = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role })
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.detail || 'Login failed');
    }
    setCurrentUser(data.user);
    setIsAuthModalOpen(false);
    return data.user;
  };

  const register = async (name, email, password, role) => {
    let userObj = null;

    if (isSupabase && supabase) {
      try {
        const sbData = await supabaseSignUp(name, email, password, role);
        const sbUser = sbData.user;
        if (sbUser) {
          userObj = {
            id: sbUser.id,
            email: sbUser.email,
            name,
            role
          };
        }
      } catch (sbErr) {
        console.warn('Supabase sign-up exception:', sbErr.message);
      }
    }

    // Always ensure backend user record exists as well
    const resp = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role })
    });
    const data = await resp.json();
    if (!resp.ok && !userObj) {
      throw new Error(data.detail || 'Registration failed');
    }

    const finalUser = userObj || data.user;
    setCurrentUser(finalUser);
    setIsAuthModalOpen(false);
    return finalUser;
  };

  const logout = async () => {
    if (isSupabase && supabase) {
      await supabaseSignOut();
    }
    setCurrentUser(null);
    setIsAuthModalOpen(true);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        login,
        register,
        logout,
        isAuthModalOpen,
        setIsAuthModalOpen,
        isSupabase
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

