import { useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar } from 'react-native-calendars';
import { Plus } from 'lucide-react-native';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { BikeGrid } from '../../components/BikeGrid';
import { Button } from '../../components/Button';
import { InfoCard } from '../../components/InfoCard';
import { Screen } from '../../components/Screen';
import { StatusPill } from '../../components/StatusPill';
import { TextField } from '../../components/TextField';
import { colors, spacing } from '../../theme';
import type { Booking, ClassSession } from '../../types';
import { isoDate, monthBounds, readableTime } from '../../utils/date';

const AddIcon = Plus as ComponentType<any>;

interface ClassCardProps {
  session: ClassSession;
  canManage: boolean;
  canBook: boolean;
  onRefresh: () => void;
}

function ClassCard({ session, canManage, canBook, onRefresh }: ClassCardProps) {
  const [selectedBike, setSelectedBike] = useState<number | null>(session.availableBikes[0] ?? null);
  const [busy, setBusy] = useState(false);

  async function book() {
    setBusy(true);
    try {
      await api<Booking>(`/classes/${session.id}/bookings`, {
        method: 'POST',
        body: JSON.stringify({ bikeNumber: session.availableBikes.length > 0 ? selectedBike : undefined }),
      });
      Alert.alert('Booking updated', session.availableBikes.length > 0 ? 'Your bike is booked.' : 'You joined the waiting list.');
      onRefresh();
    } catch (error) {
      Alert.alert('Could not book', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelClass() {
    Alert.alert('Cancel class', 'Cancel this class and all active bookings?', [
      { text: 'Keep class', style: 'cancel' },
      {
        text: 'Cancel class',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/classes/${session.id}/cancel`, { method: 'POST' });
            onRefresh();
          } catch (error) {
            Alert.alert('Could not cancel class', error instanceof Error ? error.message : 'Please try again.');
          }
        },
      },
    ]);
  }

  const myStatus = session.myBooking?.status;
  const full = session.availableBikes.length === 0;

  return (
    <InfoCard>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.classTitle}>{session.title}</Text>
          <Text style={styles.classMeta}>
            {readableTime(session.startsAt)} to {readableTime(session.endsAt)}
          </Text>
        </View>
        <StatusPill
          label={session.status === 'CANCELLED' ? 'Cancelled' : `${session.bookedCount}/${session.capacity}`}
          tone={session.status === 'CANCELLED' ? 'bad' : full ? 'warn' : 'good'}
        />
      </View>

      {session.description ? <Text style={styles.description}>{session.description}</Text> : null}

      {session.status === 'SCHEDULED' && !session.myBooking && canBook ? (
        <>
          {full ? (
            <Text style={styles.description}>All bikes are booked. Join the waiting list for the next opening.</Text>
          ) : (
            <BikeGrid
              availableBikes={session.availableBikes}
              selectedBike={selectedBike}
              onSelect={setSelectedBike}
            />
          )}
          <Button
            label={full ? 'Join waiting list' : 'Book selected bike'}
            onPress={book}
            loading={busy}
            disabled={!full && !selectedBike}
          />
        </>
      ) : null}

      {myStatus ? (
        <StatusPill
          label={myStatus === 'WAITLISTED' ? `Waiting list #${session.myBooking?.waitlistRank}` : `Booked Bike ${session.myBooking?.bikeNumber}`}
          tone={myStatus === 'WAITLISTED' ? 'warn' : 'good'}
        />
      ) : null}

      {!canBook && !canManage ? (
        <Text style={styles.description}>Bookings are disabled until account approval and payment are current.</Text>
      ) : null}

      {canManage ? (
        <View style={styles.actions}>
          <Button label="Cancel class" variant="danger" onPress={cancelClass} />
        </View>
      ) : null}
    </InfoCard>
  );
}

function CreateClassModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(isoDate());
  const [start, setStart] = useState('06:00');
  const [duration, setDuration] = useState('45');
  const [recurring, setRecurring] = useState(false);

  const createClass = useMutation({
    mutationFn: async () => {
      const startsAt = new Date(`${date}T${start}:00`);
      const endsAt = new Date(startsAt.getTime() + Number(duration) * 60_000);
      if (recurring) {
        await api('/classes/recurring', {
          method: 'POST',
          body: JSON.stringify({
            title,
            dayOfWeek: startsAt.getDay(),
            startTime: start,
            durationMinutes: Number(duration),
            effectiveFrom: startsAt.toISOString(),
          }),
        });
        return;
      }
      await api('/classes', {
        method: 'POST',
        body: JSON.stringify({
          title,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          capacity: 9,
        }),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['classes'] });
      onClose();
      setTitle('');
    },
    onError: (error) => Alert.alert('Could not create class', error instanceof Error ? error.message : 'Please try again.'),
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen title="New class" subtitle="Create a one-off class or repeat it weekly for the next 90 days.">
        <TextField label="Class title" value={title} onChangeText={setTitle} />
        <TextField label="Date" value={date} onChangeText={setDate} />
        <TextField label="Start time" value={start} onChangeText={setStart} />
        <TextField label="Duration minutes" value={duration} onChangeText={setDuration} keyboardType="number-pad" />
        <View style={styles.recurringRow}>
          <Text style={styles.recurringText}>Repeat weekly</Text>
          <Switch value={recurring} onValueChange={setRecurring} />
        </View>
        <Button label="Create class" onPress={() => createClass.mutate()} loading={createClass.isPending} disabled={!title} />
        <Button label="Close" variant="quiet" onPress={onClose} />
      </Screen>
    </Modal>
  );
}

export function CalendarScreen() {
  const { user, bookingRights } = useAuth();
  const [selectedDate, setSelectedDate] = useState(isoDate());
  const [createOpen, setCreateOpen] = useState(false);
  const selectedMonth = useMemo(() => monthBounds(new Date(selectedDate)), [selectedDate]);

  const classes = useQuery({
    queryKey: ['classes', selectedMonth.from, selectedMonth.to],
    queryFn: () =>
      api<ClassSession[]>(`/classes?from=${encodeURIComponent(selectedMonth.from)}&to=${encodeURIComponent(selectedMonth.to)}`),
  });

  const classesByDate = useMemo(() => {
    const map = new Map<string, ClassSession[]>();
    for (const session of classes.data ?? []) {
      const key = session.startsAt.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), session]);
    }
    return map;
  }, [classes.data]);

  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};
    for (const [date, sessions] of classesByDate.entries()) {
      marks[date] = {
        marked: true,
        dotColor: sessions.some((item) => item.status === 'CANCELLED') ? colors.danger : colors.primary,
      };
    }
    marks[selectedDate] = {
      ...(marks[selectedDate] ?? {}),
      selected: true,
      selectedColor: colors.primary,
    };
    return marks;
  }, [classesByDate, selectedDate]);

  const dayClasses = classesByDate.get(selectedDate) ?? [];
  const canManage = user?.role === 'ADMIN' || user?.role === 'INSTRUCTOR';

  return (
    <Screen
      title="Calendar"
      subtitle={user?.role === 'MEMBER' ? 'Choose a date, pick a class, and select your bike.' : 'View and manage studio classes.'}
    >
      <Calendar
        current={selectedDate}
        onDayPress={(day) => setSelectedDate(day.dateString)}
        markedDates={markedDates}
        theme={{
          calendarBackground: colors.surface,
          selectedDayBackgroundColor: colors.primary,
          todayTextColor: colors.accent,
          arrowColor: colors.primary,
          textDayFontWeight: '600',
          textMonthFontWeight: '800',
        }}
        style={styles.calendar}
      />

      {canManage ? (
        <>
          <Pressable style={styles.addButton} onPress={() => setCreateOpen(true)}>
            <AddIcon color="#fff" size={18} />
            <Text style={styles.addButtonText}>Add class</Text>
          </Pressable>
          <CreateClassModal visible={createOpen} onClose={() => setCreateOpen(false)} />
        </>
      ) : null}

      <View style={styles.dayHeader}>
        <Text style={styles.dayTitle}>{selectedDate}</Text>
        {classes.isFetching ? <Text style={styles.description}>Refreshing...</Text> : null}
      </View>

      {dayClasses.length === 0 ? (
        <InfoCard>
          <Text style={styles.description}>No classes scheduled for this date.</Text>
        </InfoCard>
      ) : (
        dayClasses.map((session) => (
          <ClassCard
            key={session.id}
            session={session}
            canManage={canManage}
            canBook={Boolean(bookingRights && user?.role === 'MEMBER')}
            onRefresh={() => classes.refetch()}
          />
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  calendar: { borderRadius: 8, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  dayHeader: { gap: 4 },
  dayTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  description: { color: colors.muted, lineHeight: 20 },
  cardHeader: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  classTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  classMeta: { color: colors.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  addButton: {
    minHeight: 44,
    backgroundColor: colors.primary,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: { color: '#fff', fontWeight: '800' },
  recurringRow: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recurringText: { color: colors.text, fontWeight: '800' },
});
