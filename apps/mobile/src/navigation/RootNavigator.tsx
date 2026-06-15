import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  FileBarChart,
  History,
  Home,
  Users,
  UserRound,
} from 'lucide-react-native';
import type { ComponentType } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { colors } from '../theme';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { AdminDashboardScreen } from '../screens/admin/AdminDashboardScreen';
import { MembersScreen } from '../screens/admin/MembersScreen';
import { PaymentsScreen } from '../screens/admin/PaymentsScreen';
import { ReportsScreen } from '../screens/admin/ReportsScreen';
import { CalendarScreen } from '../screens/classes/CalendarScreen';
import { AttendanceScreen } from '../screens/classes/AttendanceScreen';
import { BookingsScreen } from '../screens/member/BookingsScreen';
import { HistoryScreen } from '../screens/member/HistoryScreen';
import { ProfileScreen } from '../screens/shared/ProfileScreen';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surface,
    primary: colors.primary,
    text: colors.text,
    border: colors.border,
  },
};

function LoadingScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

function tabIcon(Icon: ComponentType<any>) {
  const TabIcon = Icon;
  return ({ color, size }: { color: string; size: number }) => <TabIcon color={color} size={size} />;
}

function AdminTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="Dashboard" component={AdminDashboardScreen} options={{ tabBarIcon: tabIcon(Home) }} />
      <Tabs.Screen name="Calendar" component={CalendarScreen} options={{ tabBarIcon: tabIcon(CalendarDays) }} />
      <Tabs.Screen name="Members" component={MembersScreen} options={{ tabBarIcon: tabIcon(Users) }} />
      <Tabs.Screen name="Payments" component={PaymentsScreen} options={{ tabBarIcon: tabIcon(CreditCard) }} />
      <Tabs.Screen name="Reports" component={ReportsScreen} options={{ tabBarIcon: tabIcon(FileBarChart) }} />
      <Tabs.Screen name="Profile" component={ProfileScreen} options={{ tabBarIcon: tabIcon(UserRound) }} />
    </Tabs.Navigator>
  );
}

function InstructorTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="Classes" component={CalendarScreen} options={{ tabBarIcon: tabIcon(CalendarDays) }} />
      <Tabs.Screen name="Attendance" component={AttendanceScreen} options={{ tabBarIcon: tabIcon(ClipboardCheck) }} />
      <Tabs.Screen name="Profile" component={ProfileScreen} options={{ tabBarIcon: tabIcon(UserRound) }} />
    </Tabs.Navigator>
  );
}

function MemberTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="Calendar" component={CalendarScreen} options={{ tabBarIcon: tabIcon(CalendarDays) }} />
      <Tabs.Screen name="Bookings" component={BookingsScreen} options={{ tabBarIcon: tabIcon(ClipboardCheck) }} />
      <Tabs.Screen name="History" component={HistoryScreen} options={{ tabBarIcon: tabIcon(History) }} />
      <Tabs.Screen name="Profile" component={ProfileScreen} options={{ tabBarIcon: tabIcon(UserRound) }} />
    </Tabs.Navigator>
  );
}

function AppTabs() {
  const { user } = useAuth();
  if (user?.role === 'ADMIN') {
    return <AdminTabs />;
  }
  if (user?.role === 'INSTRUCTOR') {
    return <InstructorTabs />;
  }
  return <MemberTabs />;
}

export function RootNavigator() {
  const { booting, user } = useAuth();
  if (booting) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <Stack.Screen name="App" component={AppTabs} />
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
