import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { api, getToken, setToken } from '../api/client';
import type { User } from '../types';

interface AuthState {
  booting: boolean;
  token: string | null;
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
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [bookingRights, setBookingRights] = useState(false);

  async function refreshMe() {
    const data = await api<{ user: User; bookingRights: boolean }>('/auth/me');
    setUser(data.user);
    setBookingRights(data.bookingRights);
  }

  async function login(email: string, password: string) {
    const data = await api<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    await setToken(data.token);
    setTokenState(data.token);
    setUser(data.user);
    await refreshMe();
    registerPushToken().catch(() => undefined);
  }

  async function logout() {
    await setToken(null);
    setTokenState(null);
    setUser(null);
    setBookingRights(false);
  }

  useEffect(() => {
    async function boot() {
      const existingToken = await getToken();
      setTokenState(existingToken);
      if (existingToken) {
        try {
          await refreshMe();
          registerPushToken().catch(() => undefined);
        } catch {
          await setToken(null);
          setTokenState(null);
        }
      }
      setBooting(false);
    }
    boot();
  }, []);

  const value = useMemo(
    () => ({ booting, token, user, bookingRights, login, logout, refreshMe }),
    [booting, token, user, bookingRights],
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
