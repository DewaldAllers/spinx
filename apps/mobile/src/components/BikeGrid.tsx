import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BIKE_COUNT } from '@spinx/shared';
import { colors } from '../theme';

interface Props {
  availableBikes: number[];
  selectedBike?: number | null;
  disabled?: boolean;
  onSelect: (bike: number) => void;
}

export function BikeGrid({ availableBikes, selectedBike, disabled, onSelect }: Props) {
  return (
    <View style={styles.grid}>
      {Array.from({ length: BIKE_COUNT }, (_, index) => index + 1).map((bike) => {
        const available = availableBikes.includes(bike);
        const selected = selectedBike === bike;
        return (
          <Pressable
            key={bike}
            disabled={disabled || !available}
            onPress={() => onSelect(bike)}
            style={[
              styles.bike,
              !available ? styles.taken : null,
              selected ? styles.selected : null,
              disabled ? styles.disabled : null,
            ]}
          >
            <Text style={[styles.label, selected ? styles.selectedText : null]}>Bike {bike}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bike: {
    width: '31%',
    minHeight: 50,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taken: { borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  selected: { backgroundColor: colors.primary },
  disabled: { opacity: 0.7 },
  label: { color: colors.text, fontWeight: '800' },
  selectedText: { color: '#fff' },
});
