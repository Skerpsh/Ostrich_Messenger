import { useEffect, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Avatar from "@/ui/avatar";
import Button from "@/ui/button";
import DevBadge from "@/ui/dev-badge";
import Reveal, { Swap } from "@/ui/reveal";
import TextField from "@/ui/text-field";
import { cancelRecoveryRequest, getGuarding, removeRecovery, type Guarding, type RecoveryPerson } from "@/api/api";
import { useAuth, useCurrentUser, usePrivateKey } from "@/features/auth/auth";
import { useChats } from "@/features/chats/chats";
import { SettingsPage } from "@/features/settings/page";
import { Divider, Row, Section, styles as settingsStyles } from "@/features/settings/ui";
import {
  approve,
  chooseGuardians,
  defaultThreshold,
  formatWhen,
  loadRecovery,
  MAX_GUARDIANS,
  MIN_GUARDIANS,
  setGuarding,
  setRecoveryStatus,
  useGuarding,
  useRecoveryStatus,
} from "@/features/recovery/recovery";
import { useAppTheme } from "@/ui/theme";
import { changeFake, fakeRecovery } from "@/features/lock/duress";
import { inDuress } from "@/features/lock/lock";

// Settings → Recovery through friends: the user's guardians and any
// request to recover the account, and the friends the user guards.
export default function RecoverySettings() {
  const { withToken } = useAuth();
  const status = useRecoveryStatus();
  const guarding = useGuarding();
  const [editing, setEditing] = useState(false);

  // A friend asking for help comes first.
  const asked = Boolean(guarding?.some((friend) => friend.request));
  const guardian = (
    <Reveal>
      {guarding && guarding.length > 0 ? (
        <Section
          title="You are a guardian for"
          footer="Approve only after you have heard the code from your friend themselves, by voice or face to face, never from a text message: someone with their password could be pretending."
        >
          {guarding.map((friend, index) => (
            <View key={friend.setup_id}>
              {index > 0 ? <Divider full /> : null}
              <GuardedFriend friend={friend} />
            </View>
          ))}
        </Section>
      ) : null}
    </Reveal>
  );

  useEffect(() => loadRecovery(withToken), [withToken]);

  return (
    <SettingsPage title="Recovery through friends">
      <Section footer="If you lose your OstrichID, friends you trust can give it back to you. It is split here into shares, one for each of them, encrypted so that only they can open theirs; the server and any one friend learn nothing. To get back in, you ask from a new device with your username and password, a few of them check a code with you by voice, and after a day (in which your devices can stop it) you log in and get a new OstrichID.">
        <View style={[settingsStyles.form, styles.top]}>
          <OwnerSummary />
        </View>
      </Section>

      <Reveal>
        {status?.requests.length ? (
          <View style={styles.sections}>
            {status.requests.map((request) => (
              <RequestCard key={request.id} request={request} />
            ))}
          </View>
        ) : null}
      </Reveal>

      {asked ? guardian : null}

      <Reveal>
        {status ? (
          <Swap id={editing || !status.setup ? "form" : "list"}>
            <View style={styles.sections}>
              {editing || !status.setup ? (
                <GuardiansForm onDone={() => setEditing(false)} canCancel={Boolean(status.setup)} />
              ) : (
                <GuardiansList
                  guardians={status.setup.guardians}
                  threshold={status.setup.threshold}
                  onChange={() => setEditing(true)}
                />
              )}
            </View>
          </Swap>
        ) : null}
      </Reveal>

      {asked ? null : guardian}
    </SettingsPage>
  );
}

function OwnerSummary() {
  const { colors } = useAppTheme();
  const status = useRecoveryStatus();

  if (!status) {
    return <Text style={[settingsStyles.formText, { color: colors.muted }]}>…</Text>;
  }

  return status.setup ? (
    <Text style={[settingsStyles.formText, { color: colors.text }]}>
      On: any {status.setup.threshold} of your {status.setup.guardians.length} guardians can help you back in.
    </Text>
  ) : (
    <Text style={[settingsStyles.formText, { color: colors.textSoft }]}>
      Off: without your OstrichID, only a device that is logged in can let you in again.
    </Text>
  );
}

function RequestCard({ request }: { request: NonNullable<ReturnType<typeof useRecoveryStatus>>["requests"][number] }) {
  const { colors } = useAppTheme();
  const { withToken } = useAuth();
  const status = useRecoveryStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = async () => {
    setBusy(true);
    setError(null);

    try {
      setRecoveryStatus(await withToken((token) => cancelRecoveryRequest(token, request.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  };

  return (
    <Section title="Someone is recovering your account">
      <View style={[settingsStyles.form, styles.top]}>
        <View style={styles.warning}>
          <Ionicons name="warning-outline" size={22} color={colors.danger} />
          <Text style={[settingsStyles.formText, styles.grow, { color: colors.text }]}>
            Asked on {formatWhen(request.created_at)} from {request.client === "cli" ? "the CLI" : request.client}, with
            your password. {request.approvals} of {status?.setup?.threshold ?? "?"} guardians have approved; they can
            get in after {formatWhen(request.ready_at)}. If it is not you, cancel it and change your password.
          </Text>
        </View>
        <Reveal>
          {error ? <Text style={[settingsStyles.formMessage, { color: colors.danger }]}>{error}</Text> : null}
        </Reveal>
        <Button
          title="It's not me: cancel it"
          icon="close-circle-outline"
          variant="danger"
          loading={busy}
          onPress={cancel}
        />
      </View>
    </Section>
  );
}

function Person({ person, detail }: { person: RecoveryPerson; detail?: string }) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.person}>
      <Avatar name={person.username} avatarId={person.avatar_id} size={36} />
      <View style={styles.grow}>
        <View style={styles.nameRow}>
          <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
            @{person.username}
          </Text>
          {person.is_developer ? <DevBadge /> : null}
        </View>
        {detail ? <Text style={[styles.detail, { color: colors.muted }]}>{detail}</Text> : null}
      </View>
    </View>
  );
}

function GuardiansList({
  guardians,
  threshold,
  onChange,
}: {
  guardians: RecoveryPerson[];
  threshold: number;
  onChange: () => void;
}) {
  const { withToken } = useAuth();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }

    setBusy(true);

    try {
      if (inDuress()) {
        // Opened with the duress PIN: only the made-up guardians go.
        await changeFake((fake) => ({ ...fake, recovery: null }));
        setRecoveryStatus(fakeRecovery());
      } else {
        setRecoveryStatus(await withToken(removeRecovery));
      }
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  return (
    <Section title="Your guardians" footer={`Any ${threshold} of them together can help you back in; fewer cannot.`}>
      {guardians.map((guardian, index) => (
        <View key={guardian.id}>
          {index > 0 ? <Divider /> : null}
          <Person person={guardian} />
        </View>
      ))}
      <Divider full />
      <Row icon="people-outline" label="Change guardians" onPress={onChange} />
      <Divider />
      <Row
        icon="trash-outline"
        label={confirmRemove ? "Tap again: remove all guardians" : "Remove guardians"}
        danger
        loading={busy}
        onPress={remove}
      />
    </Section>
  );
}

function GuardiansForm({ onDone, canCancel }: { onDone: () => void; canCancel: boolean }) {
  const { colors } = useAppTheme();
  const { withToken } = useAuth();
  const user = useCurrentUser();
  const status = useRecoveryStatus();
  const { chats } = useChats();

  // People with a direct chat who can receive encrypted messages.
  const friends = (chats ?? [])
    .filter((chat) => chat.type === "direct" && chat.user_id && chat.public_key && chat.user_id !== user?.id)
    .map((chat) => ({
      id: chat.user_id!,
      username: chat.username ?? "",
      avatar_id: chat.avatar_id,
      is_developer: chat.is_developer,
      public_key: chat.public_key!,
      blocked: chat.blocked,
    }))
    .sort((a, b) => a.username.localeCompare(b.username));

  const [picked, setPicked] = useState<string[]>(() => (status?.setup?.guardians ?? []).map((guardian) => guardian.id));
  const [chosenThreshold, setThreshold] = useState<number | null>(status?.setup?.threshold ?? null);
  const [ostrichId, setOstrichId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = friends.filter((friend) => picked.includes(friend.id));
  const threshold = Math.min(chosenThreshold ?? defaultThreshold(chosen.length), chosen.length);

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id)
        ? current.filter((other) => other !== id)
        : current.length < MAX_GUARDIANS
          ? [...current, id]
          : current,
    );

  const save = async () => {
    setError(null);
    setBusy(true);

    try {
      setRecoveryStatus(
        await withToken((token) => chooseGuardians(token, ostrichId, chosen, Math.max(MIN_GUARDIANS, threshold))),
      );
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section
        title={`Choose ${MIN_GUARDIANS} to ${MAX_GUARDIANS} guardians`}
        footer="People you have a chat with. Choose friends who know your voice and will not all lose their phones at once; they are told they were chosen."
      >
        {friends.length === 0 ? (
          <View style={settingsStyles.form}>
            <Text style={[settingsStyles.formText, styles.top, { color: colors.muted }]}>
              Start chats with a few friends first.
            </Text>
          </View>
        ) : (
          friends.map((friend, index) => {
            const on = picked.includes(friend.id);

            return (
              <View key={friend.id}>
                {index > 0 ? <Divider /> : null}
                <Pressable
                  onPress={() => toggle(friend.id)}
                  disabled={friend.blocked}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: friend.blocked }}
                  style={({ hovered, pressed }) => [
                    styles.pick,
                    (hovered || pressed) && { backgroundColor: colors.hover },
                    friend.blocked && styles.disabled,
                  ]}
                >
                  <View style={styles.grow}>
                    <Person person={friend} detail={friend.blocked ? "Blocked" : undefined} />
                  </View>
                  <Ionicons
                    name={on ? "checkmark-circle" : "ellipse-outline"}
                    size={24}
                    color={on ? colors.accent : colors.muted}
                  />
                </Pressable>
              </View>
            );
          })
        )}
      </Section>

      <Reveal>
        {chosen.length >= MIN_GUARDIANS ? (
          <Section
            title="How many are needed"
            footer="More are safer against friends who team up; fewer still work if some lose their phones or cannot be reached."
          >
            <View style={[settingsStyles.form, styles.top]}>
              <View style={styles.chips}>
                {Array.from({ length: chosen.length - 1 }, (_, i) => i + MIN_GUARDIANS).map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setThreshold(n)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: n === threshold }}
                    style={({ hovered, pressed }) => [
                      styles.chip,
                      {
                        backgroundColor:
                          n === threshold ? colors.accentSoft : hovered || pressed ? colors.hover : colors.panelAlt,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: n === threshold ? colors.accent : colors.text }]}>
                      {n} of {chosen.length}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </Section>
        ) : null}
      </Reveal>

      <Section footer="Your OstrichID is not kept on this device, so it is needed to split it. Only the shares, encrypted, leave the device.">
        <View style={[settingsStyles.form, styles.top]}>
          <TextField
            label="Your OstrichID"
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
            value={ostrichId}
            onChangeText={setOstrichId}
            maxLength={40}
            autoCapitalize="characters"
            autoComplete="off"
            returnKeyType="go"
            onSubmitEditing={save}
          />
          <Reveal>
            {error ? <Text style={[settingsStyles.formMessage, { color: colors.danger }]}>{error}</Text> : null}
          </Reveal>
          <Button
            title={canCancel ? "Save the guardians" : "Turn on"}
            icon="shield-checkmark-outline"
            loading={busy}
            disabled={chosen.length < MIN_GUARDIANS || !ostrichId.trim()}
            onPress={save}
          />
          {canCancel ? <Button title="Cancel" variant="secondary" disabled={busy} onPress={onDone} /> : null}
        </View>
      </Section>
    </>
  );
}

function GuardedFriend({ friend }: { friend: Guarding }) {
  const { colors } = useAppTheme();
  const { withToken } = useAuth();
  const user = useCurrentUser();
  const privateKey = usePrivateKey();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = friend.request;

  const submit = async () => {
    if (!user || !privateKey) {
      return;
    }

    setError(null);
    setBusy(true);

    try {
      await withToken((token) => approve(token, privateKey, user.id, friend, code));
      setGuarding(await withToken(getGuarding));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <View style={styles.guarded}>
        <Person person={friend.owner} detail={`One of ${friend.total} guardians; ${friend.threshold} are needed`} />
      </View>
      <Reveal>
        {request ? (
          <Swap id={request.approved ? "approved" : "asking"}>
            <View style={settingsStyles.form}>
              {request.approved ? (
                <Text style={[settingsStyles.formText, { color: colors.accent }]}>
                  You approved their request of {formatWhen(request.created_at)}. They can get in after{" "}
                  {formatWhen(request.ready_at)}, once enough guardians have approved.
                </Text>
              ) : (
                <>
                  <Text style={[settingsStyles.formText, { color: colors.text }]}>
                    Asked on {formatWhen(request.created_at)} to recover their account. Call or meet @
                    {friend.owner.username} and ask them to read you the 6-digit code on their new device.
                  </Text>
                  <TextField
                    label="The code they read you"
                    placeholder="123 456"
                    value={code}
                    onChangeText={(value) => setCode(value.replace(/[^\d ]/g, ""))}
                    inputMode="numeric"
                    maxLength={7}
                    returnKeyType="go"
                    onSubmitEditing={submit}
                  />
                  <Reveal>
                    {error ? <Text style={[settingsStyles.formMessage, { color: colors.danger }]}>{error}</Text> : null}
                  </Reveal>
                  <Button
                    title="Approve"
                    icon="checkmark"
                    loading={busy}
                    disabled={code.replace(/\D/g, "").length !== 6 || !privateKey}
                    onPress={submit}
                  />
                </>
              )}
            </View>
          </Swap>
        ) : null}
      </Reveal>
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    paddingTop: 14,
  },

  sections: {
    gap: 22,
  },

  grow: {
    flex: 1,
  },

  warning: {
    flexDirection: "row",
    gap: 12,
  },

  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },

  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  name: {
    flexShrink: 1,
    fontSize: 15,
  },

  detail: {
    fontSize: 13,
  },

  pick: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 16,
  },

  disabled: {
    opacity: 0.5,
  },

  guarded: {
    paddingVertical: 4,
  },

  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  chip: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },

  chipText: {
    fontSize: 14,
  },
});
