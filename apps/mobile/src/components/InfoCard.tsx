import { PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, shadow } from '../theme';

export function InfoCard({ title, value, children }: PropsWithChildren<{ title?: string; value?: string }>) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow,
  },
  title: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  value: { color: colors.text, fontSize: 24, fontWeight: '800' },
});
