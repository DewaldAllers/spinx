import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Button } from '../../components/Button';
import { InfoCard } from '../../components/InfoCard';
import { Screen } from '../../components/Screen';
import { StatusPill } from '../../components/StatusPill';
import { TextField } from '../../components/TextField';
import { colors, spacing } from '../../theme';
import type { User } from '../../types';

function statusTone(status: User['status']) {
  if (status === 'ACTIVE') return 'good';
  if (status === 'PENDING_APPROVAL') return 'warn';
  if (status === 'SUSPENDED') return 'bad';
  return 'neutral';
}

function CreateMemberModal({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    mobile: '',
    emergencyContact: '',
    role: 'MEMBER' as 'MEMBER' | 'INSTRUCTOR',
  });
  const [loading, setLoading] = useState(false);

  function setValue(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function create() {
    setLoading(true);
    try {
      const response = await api<{ user: User; temporaryPassword?: string }>('/members', {
        method: 'POST',
        body: JSON.stringify({ ...form, status: 'ACTIVE', contractSignedOffline: true }),
      });
      Alert.alert('Member created', response.temporaryPassword ? `Temporary password: ${response.temporaryPassword}` : 'Account created.');
      onCreated();
      onClose();
    } catch (error) {
      Alert.alert('Could not create member', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen title="Create member" subtitle="Register a member manually and mark the offline contract as signed.">
        <View style={styles.roleSelector}>
          <Text style={styles.roleLabel}>Account type</Text>
          <View style={styles.roleOptions}>
            {(['MEMBER', 'INSTRUCTOR'] as const).map((role) => {
              const active = form.role === role;
              return (
                <Pressable
                  key={role}
                  onPress={() => setValue('role', role)}
                  style={[styles.roleOption, active ? styles.roleOptionActive : null]}
                >
                  <Text style={[styles.roleOptionText, active ? styles.roleOptionTextActive : null]}>
                    {role === 'MEMBER' ? 'Member' : 'Instructor'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <TextField label="First name" value={form.firstName} onChangeText={(v) => setValue('firstName', v)} />
        <TextField label="Last name" value={form.lastName} onChangeText={(v) => setValue('lastName', v)} />
        <TextField label="Email" value={form.email} onChangeText={(v) => setValue('email', v)} keyboardType="email-address" />
        <TextField label="Mobile" value={form.mobile} onChangeText={(v) => setValue('mobile', v)} keyboardType="phone-pad" />
        <TextField label="Emergency contact" value={form.emergencyContact} onChangeText={(v) => setValue('emergencyContact', v)} />
        <Button
          label={form.role === 'INSTRUCTOR' ? 'Create instructor' : 'Create active member'}
          onPress={create}
          loading={loading}
          disabled={!form.firstName || !form.lastName || !form.email || !form.mobile || !form.emergencyContact}
        />
        <Button label="Close" variant="quiet" onPress={onClose} />
      </Screen>
    </Modal>
  );
}

export function MembersScreen() {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const members = useQuery({
    queryKey: ['members', search],
    queryFn: () => api<User[]>(`/members${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  });

  async function action(path: string, method = 'POST') {
    try {
      await api(path, { method });
      await members.refetch();
    } catch (error) {
      Alert.alert('Action failed', error instanceof Error ? error.message : 'Please try again.');
    }
  }

  return (
    <Screen title="Members" subtitle="Approve registrations, manage member status, and register members manually.">
      <Button label="Create member" onPress={() => setCreateOpen(true)} />
      <CreateMemberModal visible={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => members.refetch()} />
      <TextField label="Search" value={search} onChangeText={setSearch} placeholder="Name, email, or phone" />

      {(members.data ?? []).map((member) => (
        <InfoCard key={member.id}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                {member.firstName} {member.lastName}
              </Text>
              <Text style={styles.muted}>{member.email}</Text>
              <Text style={styles.muted}>{member.mobile}</Text>
            </View>
            <StatusPill label={member.status.replace('_', ' ')} tone={statusTone(member.status)} />
          </View>

          <Text style={styles.muted}>
            No-shows: {member.noShowCount} {member.bookingBlocked ? ' | booking blocked' : ''}
          </Text>

          <View style={styles.actions}>
            {member.status === 'PENDING_APPROVAL' ? (
              <>
                <Button label="Approve" onPress={() => action(`/members/${member.id}/approve`)} />
                <Button label="Decline" variant="danger" onPress={() => action(`/members/${member.id}/decline`, 'DELETE')} />
              </>
            ) : null}
            {member.status !== 'ACTIVE' ? (
              <Button
                label="Activate"
                variant="secondary"
                onPress={() =>
                  actionWithBody(`/members/${member.id}/status`, { status: 'ACTIVE' }, members.refetch)
                }
              />
            ) : null}
            {member.status === 'ACTIVE' ? (
              <Button
                label="Deactivate"
                variant="secondary"
                onPress={() =>
                  actionWithBody(`/members/${member.id}/status`, { status: 'INACTIVE' }, members.refetch)
                }
              />
            ) : null}
            <Button
              label="Suspend"
              variant="secondary"
              onPress={() =>
                actionWithBody(`/members/${member.id}/status`, { status: 'SUSPENDED' }, members.refetch)
              }
            />
            <Button
              label={member.bookingBlocked ? 'Unblock booking' : 'Block booking'}
              variant="secondary"
              onPress={() =>
                actionWithBody(
                  `/members/${member.id}/status`,
                  { status: member.status, bookingBlocked: !member.bookingBlocked },
                  members.refetch,
                )
              }
            />
            <Button label="Reset no-shows" variant="quiet" onPress={() => action(`/members/${member.id}/reset-no-shows`)} />
          </View>
        </InfoCard>
      ))}
    </Screen>
  );
}

async function actionWithBody(path: string, body: object, onDone: () => void) {
  try {
    await api(path, { method: 'POST', body: JSON.stringify(body) });
    onDone();
  } catch (error) {
    Alert.alert('Action failed', error instanceof Error ? error.message : 'Please try again.');
  }
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  name: { color: colors.text, fontSize: 17, fontWeight: '800' },
  muted: { color: colors.muted, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  roleSelector: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.sm,
  },
  roleLabel: { color: colors.text, fontWeight: '800' },
  roleOptions: { flexDirection: 'row', gap: spacing.sm },
  roleOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  roleOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  roleOptionText: { color: colors.text, fontWeight: '800' },
  roleOptionTextActive: { color: '#fff' },
});
