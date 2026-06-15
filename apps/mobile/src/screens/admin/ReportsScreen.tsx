import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { exportReportRows } from '../../api/client';
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

const formats = ['csv', 'pdf', 'excel'] as const;

function flattenRow(row: unknown) {
  const source = (row ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''),
    ]),
  );
}

function toCsv(rows: Array<Record<string, string>>) {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header] ?? '')).join(','))].join('\n');
}

function toHtml(title: string, rows: Array<Record<string, string>>) {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const cell = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #17201D; }
          h1 { font-size: 22px; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          th, td { border: 1px solid #D8D2C8; padding: 6px; text-align: left; vertical-align: top; }
          th { background: #F7F4EF; }
        </style>
      </head>
      <body>
        <h1>SpinX ${cell(title)} report</h1>
        <table>
          <thead><tr>${headers.map((header) => `<th>${cell(header)}</th>`).join('')}</tr></thead>
          <tbody>${rows
            .map((row) => `<tr>${headers.map((header) => `<td>${cell(row[header] ?? '')}</td>`).join('')}</tr>`)
            .join('')}</tbody>
        </table>
      </body>
    </html>
  `;
}

export function ReportsScreen() {
  const [busy, setBusy] = useState<string | null>(null);

  async function download(type: string, format: (typeof formats)[number]) {
    setBusy(`${type}-${format}`);
    try {
      const rows = (await exportReportRows(type)).map(flattenRow);
      if (rows.length === 0) {
        Alert.alert('No report rows', 'There is no data for this report yet.');
        return;
      }

      let uri: string;
      if (format === 'pdf') {
        const result = await Print.printToFileAsync({ html: toHtml(type, rows) });
        uri = result.uri;
      } else {
        const fileUri = `${FileSystem.documentDirectory}spinx-${type}.csv`;
        await FileSystem.writeAsStringAsync(fileUri, toCsv(rows));
        uri = fileUri;
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert('Report created', uri);
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
                label={format === 'excel' ? 'EXCEL CSV' : format.toUpperCase()}
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
