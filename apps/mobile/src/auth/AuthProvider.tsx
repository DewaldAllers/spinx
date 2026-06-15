import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { api } from '../api/client';
import { supabase } from '../api/supabase';
import type { User } from '../types';

interface AuthState {
  booting: boolean;
  user: User | null;
  bookingRights: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

async function registerPushToken() {
  if (!Device.isDevice) {
    return;
  }
  const current = await Notifications.getPermissionsAsync();
  const finalStatus =
    current.status === 'granted' ? current : await Notifications.requestPermissionsAsync();
  if (finalStatus.status !== 'granted') {
    return;
  }
  const token = (await Notifications.getExpoPushTokenAsync()).data;
  await api('/push-tokens', {
    method: 'POST',
    body: JSON.stringify({ token, platform: Platform.OS }),
  });
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [bookingRights, setBookingRights] = useState(false);

  async function refreshMe() {
    const data = await api<{ user: User; bookingRights: boolean }>('/auth/me');
    setUser(data.user);
    setBookingRights(data.bookingRights);
  }

  async function login(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      throw new Error(error.message);
    }
    await refreshMe();
    registerPushToken().catch(() => undefined);
  }

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
    setBookingRights(false);
  }

  useEffect(() => {
    async function boot() {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        try {
          await refreshMe();
          registerPushToken().catch(() => undefined);
        } catch {
          await supabase.auth.signOut();
          setUser(null);
          setBookingRights(false);
        }
      }
      setBooting(false);
    }
    boot();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setUser(null);
        setBookingRights(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const value = useMemo(
    () => ({ booting, user, bookingRights, login, logout, refreshMe }),
    [booting, user, bookingRights],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
