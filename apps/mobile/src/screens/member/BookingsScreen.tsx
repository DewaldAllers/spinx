import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Button } from '../../components/Button';
import { InfoCard } from '../../components/InfoCard';
import { Screen } from '../../components/Screen';
import { StatusPill } from '../../components/StatusPill';
import { colors, spacing } from '../../theme';
import type { Booking } from '../../types';
import { readableDateTime } from '../../utils/date';

export function BookingsScreen() {
  const bookings = useQuery({
    queryKey: ['my-bookings'],
    queryFn: () => api<Booking[]>('/bookings/me'),
  });

  const future = (bookings.data ?? []).filter(
    (booking) =>
      booking.classSession &&
      new Date(booking.classSession.startsAt).getTime() >= Date.now() &&
      ['BOOKED', 'PROMOTED', 'WAITLISTED'].includes(booking.status),
  );

  async function cancel(id: string) {
    Alert.alert('Cancel booking', 'Cancel this booking?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel booking',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/bookings/${id}`, { method: 'DELETE' });
            await bookings.refetch();
          } catch (error) {
            Alert.alert('Could not cancel', error instanceof Error ? error.message : 'Please try again.');
          }
        },
      },
    ]);
  }

  return (
    <Screen title="Bookings" subtitle="View and cancel your future bookings.">
      {future.length === 0 ? (
        <InfoCard>
          <Text style={styles.muted}>No upcoming bookings.</Text>
        </InfoCard>
      ) : (
        future.map((booking) => (
          <InfoCard key={booking.id}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{booking.classSession?.title}</Text>
                <Text style={styles.muted}>{booking.classSession ? readableDateTime(booking.classSession.startsAt) : ''}</Text>
              </View>
              <StatusPill
                label={booking.status === 'WAITLISTED' ? `Wait #${booking.waitlistRank}` : `Bike ${booking.bikeNumber}`}
                tone={booking.status === 'WAITLISTED' ? 'warn' : 'good'}
              />
            </View>
            <Button label="Cancel booking" variant="secondary" onPress={() => cancel(booking.id)} />
          </InfoCard>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  muted: { color: colors.muted, lineHeight: 20 },
});
