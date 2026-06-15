import { useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
import { api } from '../../api/client';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { colors, spacing } from '../../theme';

const agreementText =
  'I agree to follow studio rules, book only for myself, cancel responsibly, and understand that SpinX membership is managed monthly by EFT/manual confirmation.';

export function RegisterScreen({ navigation }: any) {
  const signatureRef = useRef<SignatureViewRef>(null);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    mobile: '',
    emergencyContact: '',
    password: '',
  });
  const [accepted, setAccepted] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function setValue(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    if (!accepted || !signature) {
      Alert.alert('Agreement required', 'Please accept and sign the membership agreement.');
      return;
    }
    setLoading(true);
    try {
      const response = await api<{ verificationToken?: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          acceptedAgreementVersion: 'spinx-v1',
          signatureDataUrl: signature,
        }),
      });
      const devHint = response.verificationToken
        ? `\n\nDevelopment token: ${response.verificationToken}`
        : '';
      Alert.alert(
        'Registration submitted',
        `Verify your email, then an admin will approve your membership before bookings are enabled.${devHint}`,
        [{ text: 'OK', onPress: () => navigation.navigate('Login') }],
      );
    } catch (error) {
      Alert.alert('Registration failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen title="Create account" subtitle="Your account will remain pending until approved by the studio.">
      <TextField label="First name" value={form.firstName} onChangeText={(v) => setValue('firstName', v)} />
      <TextField label="Last name" value={form.lastName} onChangeText={(v) => setValue('lastName', v)} />
      <TextField
        label="Email"
        value={form.email}
        onChangeText={(v) => setValue('email', v)}
        keyboardType="email-address"
      />
      <TextField
        label="Mobile number"
        value={form.mobile}
        onChangeText={(v) => setValue('mobile', v)}
        keyboardType="phone-pad"
      />
      <TextField
        label="Emergency contact"
        value={form.emergencyContact}
        onChangeText={(v) => setValue('emergencyContact', v)}
      />
      <TextField
        label="Password"
        value={form.password}
        onChangeText={(v) => setValue('password', v)}
        secureTextEntry
      />

      <View style={styles.agreement}>
        <Text style={styles.agreementTitle}>Membership agreement</Text>
        <Text style={styles.agreementText}>{agreementText}</Text>
        <View style={styles.row}>
          <Text style={styles.acceptText}>I accept these terms</Text>
          <Switch value={accepted} onValueChange={setAccepted} />
        </View>
      </View>

      <View style={styles.signatureBox}>
        <Text style={styles.signatureTitle}>Finger signature</Text>
        <View style={styles.signatureCanvas}>
          <SignatureScreen
            ref={signatureRef}
            onOK={(value) => setSignature(value)}
            onEmpty={() => Alert.alert('Signature empty', 'Please sign before saving.')}
            webStyle={signatureWebStyle}
            descriptionText=""
            clearText="Clear"
            confirmText="Save"
          />
        </View>
        {signature ? <Text style={styles.saved}>Signature saved</Text> : null}
      </View>

      <Button
        label="Submit registration"
        onPress={() => signatureRef.current?.readSignature()}
        variant="secondary"
      />
      <Button
        label="Send for approval"
        onPress={submit}
        loading={loading}
        disabled={!accepted || !signature || Object.values(form).some((value) => !value)}
      />
      <Button label="Back to sign in" variant="quiet" onPress={() => navigation.navigate('Login')} />
    </Screen>
  );
}

const signatureWebStyle = `
  .m-signature-pad { box-shadow: none; border: 0; }
  .m-signature-pad--body { border: 1px solid #D8D2C8; border-radius: 8px; }
  .m-signature-pad--footer { display: flex; gap: 8px; justify-content: flex-end; }
`;

const styles = StyleSheet.create({
  agreement: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  agreementTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  agreementText: { color: colors.muted, lineHeight: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  acceptText: { color: colors.text, fontWeight: '700' },
  signatureBox: { gap: spacing.sm },
  signatureTitle: { color: colors.text, fontWeight: '800' },
  signatureCanvas: { height: 260, overflow: 'hidden', borderRadius: 8 },
  saved: { color: colors.success, fontWeight: '700' },
});
