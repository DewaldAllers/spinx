import { useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react-native';
import type { AttendanceStatus } from '@spinx/shared';
import { api } from '../../api/client';
import { Button } from '../../components/Button';
import { InfoCard } from '../../components/InfoCard';
import { Screen } from '../../components/Screen';
import { StatusPill } from '../../components/StatusPill';
import { colors, spacing } from '../../theme';
import type { ClassSession } from '../../types';
import { monthBounds, readableDateTime } from '../../utils/date';

const AttendanceIcon = ClipboardCheck as ComponentType<any>;

interface AttendanceEntry {
  bookingId: string;
  memberName: string;
  bikeNumber: number;
  status: AttendanceStatus | null;
}

export function AttendanceScreen() {
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  const range = useMemo(() => monthBounds(new Date()), []);

  const classes = useQuery({
    queryKey: ['attendance-classes'],
    queryFn: () =>
      api<ClassSession[]>(`/classes?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
  });

  const selectedClass = classes.data?.find((session) => session.id === selectedClassId) ?? classes.data?.[0];
  const attendance = useQuery({
    queryKey: ['attendance', selectedClass?.id],
    enabled: Boolean(selectedClass?.id),
    queryFn: () =>
      api<{ bookedCount: number; capacity: number; entries: AttendanceEntry[] }>(
        `/classes/${selectedClass?.id}/attendance`,
      ),
  });

  const saveAttendance = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(draft).map(([bookingId, status]) => ({ bookingId, status }));
      if (entries.length === 0) {
        return;
      }
      await api(`/classes/${selectedClass?.id}/attendance`, {
        method: 'POST',
        body: JSON.stringify({ entries }),
      });
    },
    onSuccess: async () => {
      setDraft({});
      await attendance.refetch();
      Alert.alert('Attendance saved', 'Class attendance was updated.');
    },
    onError: (error) => Alert.alert('Could not save attendance', error instanceof Error ? error.message : 'Please try again.'),
  });

  function statusFor(entry: AttendanceEntry) {
    return draft[entry.bookingId] ?? entry.status;
  }

  return (
    <Screen title="Attendance" subtitle="Open a class and mark each booked member present or absent.">
      <InfoCard>
        <View style={styles.headerRow}>
          <AttendanceIcon color={colors.primary} />
          <Text style={styles.heading}>Class list</Text>
        </View>
        {(classes.data ?? []).map((session) => (
          <Pressable
            key={session.id}
            onPress={() => {
              setSelectedClassId(session.id);
              setDraft({});
            }}
            style={[styles.classRow, selectedClass?.id === session.id ? styles.classRowSelected : null]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.classTitle}>{session.title}</Text>
              <Text style={styles.muted}>{readableDateTime(session.startsAt)}</Text>
            </View>
            <StatusPill label={`${session.bookedCount}/${session.capacity}`} tone="neutral" />
          </Pressable>
        ))}
      </InfoCard>

      {selectedClass ? (
        <InfoCard title="Booked bikes" value={`${attendance.data?.bookedCount ?? 0}/9`}>
          {(attendance.data?.entries ?? []).map((entry) => {
            const current = statusFor(entry);
            return (
              <View key={entry.bookingId} style={styles.attendanceRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.member}>{entry.memberName}</Text>
                  <Text style={styles.muted}>Bike {entry.bikeNumber}</Text>
                </View>
                <View style={styles.statusButtons}>
                  <Pressable
                    onPress={() => setDraft((value) => ({ ...value, [entry.bookingId]: 'PRESENT' }))}
                    style={[styles.smallButton, current === 'PRESENT' ? styles.present : null]}
                  >
                    <Text style={[styles.smallButtonText, current === 'PRESENT' ? styles.white : null]}>Present</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setDraft((value) => ({ ...value, [entry.bookingId]: 'ABSENT' }))}
                    style={[styles.smallButton, current === 'ABSENT' ? styles.absent : null]}
                  >
                    <Text style={[styles.smallButtonText, current === 'ABSENT' ? styles.white : null]}>Absent</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          {attendance.data?.entries.length === 0 ? <Text style={styles.muted}>No active bookings yet.</Text> : null}
          <Button
            label="Save attendance"
            onPress={() => saveAttendance.mutate()}
            disabled={Object.keys(draft).length === 0}
            loading={saveAttendance.isPending}
          />
        </InfoCard>
      ) : (
        <InfoCard>
          <Text style={styles.muted}>No classes available this month.</Text>
        </InfoCard>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  heading: { color: colors.text, fontSize: 16, fontWeight: '800' },
  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.md,
  },
  classRowSelected: { backgroundColor: colors.primarySoft, marginHorizontal: -spacing.md, paddingHorizontal: spacing.md },
  classTitle: { color: colors.text, fontWeight: '800' },
  muted: { color: colors.muted },
  attendanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  member: { color: colors.text, fontWeight: '800' },
  statusButtons: { flexDirection: 'row', gap: spacing.sm },
  smallButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  smallButtonText: { color: colors.text, fontWeight: '800', fontSize: 12 },
  present: { backgroundColor: colors.success, borderColor: colors.success },
  absent: { backgroundColor: colors.danger, borderColor: colors.danger },
  white: { color: '#fff' },
});
