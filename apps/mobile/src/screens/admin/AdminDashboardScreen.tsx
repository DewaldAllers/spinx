import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { InfoCard } from '../../components/InfoCard';
import { Screen } from '../../components/Screen';
import { colors, spacing } from '../../theme';
import type { DashboardData } from '../../types';
import { readableDateTime } from '../../utils/date';

export function AdminDashboardScreen() {
  const dashboard = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => api<DashboardData>('/admin/dashboard'),
  });
  const totals = dashboard.data?.totals;

  return (
    <Screen title="Dashboard" subtitle="Studio health, membership status, bookings, attendance, and no-show signals.">
      <View style={styles.grid}>
        <InfoCard title="Total members" value={String(totals?.totalMembers ?? 0)} />
        <InfoCard title="Active" value={String(totals?.activeMembers ?? 0)} />
        <InfoCard title="Pending approval" value={String(totals?.pendingApprovalMembers ?? 0)} />
        <InfoCard title="Unpaid" value={String(totals?.unpaidMembers ?? 0)} />
        <InfoCard title="Weekly attendance" value={String(totals?.weeklyAttendance ?? 0)} />
        <InfoCard title="No-shows this month" value={String(totals?.noShowCount ?? 0)} />
      </View>

      <InfoCard title="Upcoming occupancy">
        {(dashboard.data?.upcomingClasses ?? []).map((session) => (
          <View key={session.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.classTitle}>{session.title}</Text>
              <Text style={styles.muted}>{readableDateTime(session.startsAt)}</Text>
              <Text style={styles.muted}>{session.instructor}</Text>
            </View>
            <Text style={styles.occupancy}>
              {session.occupancy}/{session.capacity}
            </Text>
          </View>
        ))}
        {dashboard.data?.upcomingClasses.length === 0 ? <Text style={styles.muted}>No upcoming classes.</Text> : null}
      </InfoCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  classTitle: { color: colors.text, fontWeight: '800' },
  muted: { color: colors.muted },
  occupancy: { color: colors.primary, fontSize: 18, fontWeight: '900' },
});
