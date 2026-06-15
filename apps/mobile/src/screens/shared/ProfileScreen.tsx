import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../../components/Button';
import { InfoCard } from '../../components/InfoCard';
import { Screen } from '../../components/Screen';
import { StatusPill } from '../../components/StatusPill';
import { colors, spacing } from '../../theme';
import type { NotificationItem, Payment } from '../../types';

export function ProfileScreen() {
  const { user, bookingRights, logout, refreshMe } = useAuth();
  const payments = useQuery({
    queryKey: ['payments-me'],
    enabled: user?.role === 'MEMBER',
    queryFn: () => api<{ current: Payment; payments: Payment[]; bookingRights: boolean }>('/payments/me'),
  });
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationItem[]>('/notifications'),
  });

  if (!user) {
    return null;
  }

  async function markRead(id: string) {
    try {
      await api(`/notifications/${id}/read`, { method: 'POST' });
      await notifications.refetch();
    } catch (error) {
      Alert.alert('Could not update notification', error instanceof Error ? error.message : 'Please try again.');
    }
  }

  return (
    <Screen title="Profile" subtitle="Your account, membership status, payment state, and notifications.">
      <InfoCard>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user.firstName[0]}
              {user.lastName[0]}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {user.firstName} {user.lastName}
            </Text>
            <Text style={styles.muted}>{user.email}</Text>
            <Text style={styles.muted}>{user.mobile}</Text>
          </View>
        </View>
        <View style={styles.pills}>
          <StatusPill label={user.role} tone="neutral" />
          <StatusPill label={user.status.replace('_', ' ')} tone={user.status === 'ACTIVE' ? 'good' : 'warn'} />
          {user.role === 'MEMBER' ? (
            <StatusPill label={bookingRights ? 'Booking enabled' : 'Booking disabled'} tone={bookingRights ? 'good' : 'bad'} />
          ) : null}
        </View>
      </InfoCard>

      {user.role === 'MEMBER' ? (
        <InfoCard title="Current payment" value={payments.data?.current?.status ?? 'Pending'}>
          <Text style={styles.muted}>Month: {payments.data?.current?.month ?? '-'}</Text>
          <Button label="Refresh payment status" variant="secondary" onPress={() => refreshMe()} />
        </InfoCard>
      ) : null}

      <InfoCard title="Emergency contact">
        <Text style={styles.muted}>{user.emergencyContact}</Text>
      </InfoCard>

      <InfoCard title="Notifications">
        {(notifications.data ?? []).slice(0, 8).map((item) => (
          <View key={item.id} style={styles.notification}>
            <View style={{ flex: 1 }}>
              <Text style={styles.notificationTitle}>{item.title}</Text>
              <Text style={styles.muted}>{item.body}</Text>
            </View>
            {!item.readAt ? <Button label="Read" variant="quiet" onPress={() => markRead(item.id)} /> : null}
          </View>
        ))}
        {notifications.data?.length === 0 ? <Text style={styles.muted}>No notifications.</Text> : null}
      </InfoCard>

      <Button label="Sign out" variant="secondary" onPress={logout} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '900', fontSize: 18 },
  name: { color: colors.text, fontSize: 18, fontWeight: '800' },
  muted: { color: colors.muted, lineHeight: 20 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  notification: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
  },
  notificationTitle: { color: colors.text, fontWeight: '800' },
});
