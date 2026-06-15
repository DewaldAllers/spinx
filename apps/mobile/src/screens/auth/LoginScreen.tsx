import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../auth/AuthProvider';
import { colors, spacing } from '../../theme';

export function LoginScreen({ navigation }: NativeStackScreenProps<any>) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (error) {
      Alert.alert('Login failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen title="SpinX" subtitle="Book classes, manage attendance, and keep membership admin simple.">
      <View style={styles.brandMark}>
        <Text style={styles.brandText}>SX</Text>
      </View>
      <TextField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <Button label="Sign in" onPress={submit} loading={loading} disabled={!email || !password} />
      <Button label="Create member account" variant="secondary" onPress={() => navigation.navigate('Register')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandMark: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  brandText: { color: '#fff', fontSize: 26, fontWeight: '900' },
});
