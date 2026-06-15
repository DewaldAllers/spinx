import { StyleSheet, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { InfoCard } from '../../components/InfoCard';
import { Screen } from '../../components/Screen';
import { StatusPill } from '../../components/StatusPill';
import { colors } from '../../theme';
import type { Booking } from '../../types';
import { readableDateTime } from '../../utils/date';

export function HistoryScreen() {
  const bookings = useQuery({
    queryKey: ['booking-history'],
    queryFn: () => api<Booking[]>('/bookings/me'),
  });
  const rows = bookings.data ?? [];
  const present = rows.filter((booking) => booking.attendance?.status === 'PRESENT').length;
  const missed = rows.filter((booking) => booking.attendance?.status === 'ABSENT').length;
  const attendedTotal = present + missed;
  const rate = attendedTotal ? Math.round((present / attendedTotal) * 100) : 0;

  return (
    <Screen title="History" subtitle="Review bookings, attendance, missed classes, and attendance rate.">
      <InfoCard title="Attendance rate" value={`${rate}%`}>
        <Text style={styles.muted}>
          {present} present, {missed} missed
        </Text>
      </InfoCard>

      {rows.map((booking) => (
        <InfoCard key={booking.id}>
          <Text style={styles.title}>{booking.classSession?.title ?? 'Class'}</Text>
          <Text style={styles.muted}>{booking.classSession ? readableDateTime(booking.classSession.startsAt) : ''}</Text>
          <StatusPill
            label={booking.attendance?.status ?? booking.status}
            tone={booking.attendance?.status === 'ABSENT' ? 'bad' : booking.attendance?.status === 'PRESENT' ? 'good' : 'neutral'}
          />
        </InfoCard>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontWeight: '800', fontSize: 16 },
  muted: { color: colors.muted, lineHeight: 20 },
});
