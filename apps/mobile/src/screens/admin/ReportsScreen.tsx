import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getToken, reportUrl } from '../../api/client';
import { Button } from '../../components/Button';
import { InfoCard } from '../../components/InfoCard';
import { Screen } from '../../components/Screen';
import { colors, spacing } from '../../theme';

const reports = [
  ['membership', 'Membership'],
  ['payment', 'Payment'],
  ['attendance', 'Attendance'],
  ['booking', 'Booking'],
  ['waiting-list', 'Waiting list'],
  ['no-show', 'No-show'],
] as const;

const formats = ['csv', 'pdf', 'xlsx'] as const;

export function ReportsScreen() {
  const [busy, setBusy] = useState<string | null>(null);

  async function download(type: string, format: (typeof formats)[number]) {
    setBusy(`${type}-${format}`);
    try {
      const token = await getToken();
      const url = await reportUrl(type, format);
      const fileUri = `${FileSystem.documentDirectory}spinx-${type}.${format}`;
      const result = await FileSystem.downloadAsync(url, fileUri, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri);
      } else {
        Alert.alert('Report downloaded', result.uri);
      }
    } catch (error) {
      Alert.alert('Could not export report', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Reports" subtitle="Export studio reports to PDF, Excel, or CSV.">
      {reports.map(([type, label]) => (
        <InfoCard key={type}>
          <Text style={styles.title}>{label}</Text>
          <View style={styles.formats}>
            {formats.map((format) => (
              <Button
                key={format}
                label={format.toUpperCase()}
                variant="secondary"
                onPress={() => download(type, format)}
                loading={busy === `${type}-${format}`}
              />
            ))}
          </View>
        </InfoCard>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  formats: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
