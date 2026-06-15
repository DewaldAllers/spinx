import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

const toneMap = {
  good: { bg: '#DFEBDD', fg: colors.success },
  warn: { bg: '#F4E5CE', fg: colors.warning },
  bad: { bg: '#F4DADA', fg: colors.danger },
  neutral: { bg: colors.surfaceMuted, fg: colors.muted },
};

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: keyof typeof toneMap }) {
  const toneStyle = toneMap[tone];
  return (
    <View style={[styles.wrap, { backgroundColor: toneStyle.bg }]}>
      <Text style={[styles.text, { color: toneStyle.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  text: { fontSize: 12, fontWeight: '800' },
});
