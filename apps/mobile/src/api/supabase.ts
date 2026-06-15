import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';

const extra = Constants.expoConfig?.extra as
  | {
      supabaseUrl?: string;
      supabasePublishableKey?: string;
    }
  | undefined;

export const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  extra?.supabaseUrl ??
  'https://sqeqtogelbkijxvthvhj.supabase.co';

export const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  extra?.supabasePublishableKey ??
  '';

if (!supabasePublishableKey) {
  console.warn('Missing EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Supabase requests will fail until it is configured.');
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
