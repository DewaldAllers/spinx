import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Button } from '../../components/Button';
import { InfoCard } from '../../components/InfoCard';
import { Screen } from '../../components/Screen';
import { StatusPill } from '../../components/StatusPill';
import { TextField } from '../../components/TextField';
import { colors, spacing } from '../../theme';

interface PaymentRow {
  id: string;
  month: string;
  dueDate: string;
  paidAt?: string | null;
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'WAIVED';
  user: { firstName: string; lastName: string; email: string };
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function PaymentsScreen() {
  const [month, setMonth] = useState(currentMonth());
  const payments = useQuery({
    queryKey: ['payments', month],
    queryFn: () => api<PaymentRow[]>(`/payments?month=${month}`),
  });

  async function generate() {
    try {
      await api('/payments/generate-monthly', { method: 'POST', body: JSON.stringify({ month }) });
      await payments.refetch();
    } catch (error) {
      Alert.alert('Could not generate payments', error instanceof Error ? error.message : 'Please try again.');
    }
  }

  async function confirm(id: string) {
    try {
      await api(`/payments/${id}/confirm`, { method: 'POST', body: JSON.stringify({}) });
      await payments.refetch();
    } catch (error) {
      Alert.alert('Could not confirm payment', error instanceof Error ? error.message : 'Please try again.');
    }
  }

  async function waive(id: string) {
    try {
      await api(`/payments/${id}/waive`, { method: 'POST', body: JSON.stringify({ notes: 'Admin override' }) });
      await payments.refetch();
    } catch (error) {
      Alert.alert('Could not waive payment', error instanceof Error ? error.message : 'Please try again.');
    }
  }

  return (
    <Screen title="Payments" subtitle="Version 1 uses EFT/manual payment confirmation.">
      <TextField label="Month" value={month} onChangeText={setMonth} placeholder="YYYY-MM" />
      <Button label="Generate monthly payment rows" onPress={generate} />

      {(payments.data ?? []).map((payment) => (
        <InfoCard key={payment.id}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                {payment.user.firstName} {payment.user.lastName}
              </Text>
              <Text style={styles.muted}>{payment.user.email}</Text>
              <Text style={styles.muted}>{payment.month}</Text>
            </View>
            <StatusPill
              label={payment.status}
              tone={payment.status === 'PAID' || payment.status === 'WAIVED' ? 'good' : payment.status === 'OVERDUE' ? 'bad' : 'warn'}
            />
          </View>
          <View style={styles.actions}>
            <Button label="Confirm paid" onPress={() => confirm(payment.id)} disabled={payment.status === 'PAID'} />
            <Button label="Waive" variant="secondary" onPress={() => waive(payment.id)} />
          </View>
        </InfoCard>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  name: { color: colors.text, fontWeight: '800', fontSize: 16 },
  muted: { color: colors.muted },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
