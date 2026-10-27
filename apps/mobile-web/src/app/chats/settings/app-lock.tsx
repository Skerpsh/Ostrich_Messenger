import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { Chat } from "@/api/api";
import Avatar from "@/ui/avatar";
import Button from "@/ui/button";
import { Swap } from "@/ui/reveal";
import TextField from "@/ui/text-field";
import { MOD_KEY } from "@/ui/keys";
import { useAppTheme } from "@/ui/theme";
import { useChats } from "@/features/chats/chats";
import { chatTitle } from "@/features/groups/groups";
import { SettingsPage } from "@/features/settings/page";
import { Divider, Row, Section, ToggleRow, styles as settingsStyles } from "@/features/settings/ui";
import {
  changePin,
  isPin,
  lockNow,
  setBackgroundLock,
  setDuressPin,
  setWipeAfterTries,
  setWipePin,
  turnOffLock,
  turnOnLock,
  useLock,
  WIPE_AFTER,
} from "@/features/lock/lock";
import {
  changeFake,
  forgetDuress,
  makeFakeData,
  saveDuressConfig,
  setLockSeemsOff,
  useDuressConfig,
  useFake,
  useLockSeemsOff,
} from "@/features/lock/duress";
import PinPad from "@/features/lock/pin-pad";

const BACKGROUND: { minutes: number | null; label: string }[] = [
  { minutes: null, label: "Never" },
  { minutes: 0, label: "At once" },
  { minutes: 1, label: "1 min" },
  { minutes: 5, label: "5 min" },
  { minutes: 60, label: "1 hour" },
];

// A change asked for with PINs: the current one first where it matters,
// a new one twice.
type Flow = {
  id: string;
  steps: ("current" | "new" | "repeat")[];
  newTitle?: string;
  done: (pin: string) => Promise<void>;
};

// Settings → App lock (features/lock/lock.ts) and "Head in the sand"
// (duress.ts). Opened with the duress PIN, it shows a plain app lock: the
// PIN it was opened with, made-up wipe settings, nothing of this.
export default function AppLockSettings() {
  const { config, duress } = useLock();
  const fake = useFake();
  const seemsOff = useLockSeemsOff();
  const [flow, setFlow] = useState<Flow | null>(null);
  // "Head in the sand" being set up: the duress PIN chosen, the chats next.
  const [settingUp, setSettingUp] = useState<string | null>(null);

  const [editing, setEditing] = useState<"chats" | "alert" | null>(null);

  const on = config !== null && !seemsOff;

  const flows = {
    on: {
      id: "on",
      steps: ["new", "repeat"],
      // Opened with the duress PIN, "turning it on again" changes that PIN.
      done: async (pin: string) => (duress ? (await changePin(pin), setLockSeemsOff(false)) : turnOnLock(pin)),
    },
    change: { id: "change", steps: ["current", "new", "repeat"], done: changePin },
    off: {
      id: "off",
      steps: ["current"],
      done: async () => (duress ? setLockSeemsOff(true) : turnOffLock()),
    },
    wipeOn: {
      id: "wipe-on",
      steps: ["current", "new", "repeat"],
      newTitle: "Choose a wipe PIN",
      done: (pin: string) =>
        duress ? changeFake((f) => ({ ...f, lock: { ...f.lock, wipe: true } })) : setWipePin(pin),
    },
    wipeOff: {
      id: "wipe-off",
      steps: ["current"],
      done: () => (duress ? changeFake((f) => ({ ...f, lock: { ...f.lock, wipe: false } })) : setWipePin(null)),
    },
    duressOn: {
      id: "duress-on",
      steps: ["current", "new", "repeat"],
      newTitle: "Choose the duress PIN",
      // Saved at once (it must differ from the others); the chats next.
      done: async (pin: string) => {
        await setDuressPin(pin);
        setSettingUp(pin);
      },
    },
    duressChange: {
      id: "duress-change",
      steps: ["current", "new", "repeat"],
      newTitle: "Choose the duress PIN",
      done: (pin: string) => setDuressPin(pin),
    },
    duressOff: {
      id: "duress-off",
      steps: ["current"],
      done: async () => {
        await setDuressPin(null);
        await forgetDuress();
      },
    },
  } satisfies Record<string, Flow>;

  const wipe = duress ? (fake?.lock.wipe ?? false) : Boolean(config?.wipe);
  const wipeAfterTries = duress ? (fake?.lock.wipeAfterTries ?? false) : Boolean(config?.wipeAfterTries);

  const view = flow ? "flow" : settingUp !== null ? "setup" : editing ? editing : on ? "on" : "off";

  return (
    <SettingsPage title="App lock">
      <Swap id={view}>
        {flow ? (
          <PinFlow flow={flow} onDone={() => setFlow(null)} />
        ) : settingUp !== null ? (
          <SafeChatsPicker
            title="Which chats show with the duress PIN?"
            onCancel={async () => {
              await setDuressPin(null);
              setSettingUp(null);
            }}
            onSave={async (safe, chats) => {
              await saveDuressConfig({ safe, alert: null });
              await makeFakeData(chats.filter((chat) => safe.includes(chat.id)));
              setSettingUp(null);
            }}
          />
        ) : editing === "chats" ? (
          <SafeChatsPicker title="Safe chats" onCancel={() => setEditing(null)} onSave={() => setEditing(null)} />
        ) : editing === "alert" ? (
          <AlertEditor onDone={() => setEditing(null)} />
        ) : on && config ? (
          <View style={styles.sections}>
            <Section footer="Asked every time Ostrich starts, and after it was in the background for the time chosen. Only on this device: the PIN never leaves it.">
              <Row icon="keypad-outline" label="Change PIN" onPress={() => setFlow(flows.change)} />
              <Divider />
              <Row
                icon="lock-closed-outline"
                label="Lock now"
                value={Platform.OS === "web" ? `${MOD_KEY} L` : undefined}
                onPress={lockNow}
              />
            </Section>

            <BackgroundChoice minutes={config.background} />

            <Section
              title="Wiping this device"
              footer="Wiping removes everything Ostrich keeps on this device and logs it out; it then looks freshly installed. Your account and messages stay: log in again with your username, password and OstrichID. The wipe PIN wipes at once, as if it were a wrong PIN."
            >
              <Row
                icon="flame-outline"
                label="Wipe PIN"
                value={wipe ? "On" : "Off"}
                onPress={() => setFlow(wipe ? flows.wipeOff : flows.wipeOn)}
              />
              <Divider />
              <ToggleRow
                icon="alert-circle-outline"
                label={`Wipe after ${WIPE_AFTER} wrong PINs`}
                hint="In a row. From the 5th, each wrong PIN also makes the next one wait longer."
                value={wipeAfterTries}
                onChange={(value) =>
                  duress
                    ? changeFake((f) => ({ ...f, lock: { ...f.lock, wipeAfterTries: value } }))
                    : setWipeAfterTries(value)
                }
              />
            </Section>

            {duress ? null : (
              <HeadInTheSand
                on={Boolean(config.duress)}
                onSetUp={() => setFlow(flows.duressOn)}
                onChangePin={() => setFlow(flows.duressChange)}
                onChats={() => setEditing("chats")}
                onAlert={() => setEditing("alert")}
                onTurnOff={() => setFlow(flows.duressOff)}
              />
            )}

            <Section>
              <Row icon="lock-open-outline" label="Turn off app lock" danger onPress={() => setFlow(flows.off)} />
            </Section>
          </View>
        ) : (
          <OffView onTurnOn={() => setFlow(flows.on)} />
        )}
      </Swap>
    </SettingsPage>
  );
}

function OffView({ onTurnOn }: { onTurnOn: () => void }) {
  const { colors } = useAppTheme();

  return (
    <Section footer="A 4-digit PIN asked when Ostrich starts and after it was in the background. Only on this device: the PIN never leaves it and is not synced. It locks the screens; it does not encrypt your messages.">
      <View style={[settingsStyles.form, styles.top]}>
        <Text style={[settingsStyles.formText, { color: colors.textSoft }]}>Off.</Text>
        <Button title="Turn on app lock" icon="lock-closed-outline" onPress={onTurnOn} />
      </View>
    </Section>
  );
}

function BackgroundChoice({ minutes }: { minutes: number | null }) {
  const { colors } = useAppTheme();

  return (
    <Section title="Lock in the background">
      <View style={[settingsStyles.form, styles.top]}>
        <View style={styles.chips}>
          {BACKGROUND.map((option) => {
            const selected = option.minutes === minutes;

            return (
              <Pressable
                key={option.label}
                onPress={() => setBackgroundLock(option.minutes)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                style={({ hovered, pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: selected ? colors.accentSoft : hovered || pressed ? colors.hover : colors.panelAlt,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: selected ? colors.accent : colors.text }]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[settingsStyles.formText, { color: colors.muted }]}>
          {minutes === null
            ? "Only when Ostrich starts."
            : minutes === 0
              ? "As soon as you leave Ostrich."
              : `After ${minutes === 60 ? "an hour" : `${minutes} min`} away from Ostrich.`}
        </Text>
      </View>
    </Section>
  );
}

function HeadInTheSand({
  on,
  onSetUp,
  onChangePin,
  onChats,
  onAlert,
  onTurnOff,
}: {
  on: boolean;
  onSetUp: () => void;
  onChangePin: () => void;
  onChats: () => void;
  onAlert: () => void;
  onTurnOff: () => void;
}) {
  const config = useDuressConfig();

  return (
    <Section
      title="Head in the sand"
      footer="If someone makes you open Ostrich, type the duress PIN instead of yours: Ostrich opens as usual, showing only the chats you chose; the others, Saved messages and new chats are not there, and Settings shows made-up values for recovery, If I disappear, devices and this lock. It stays so until Ostrich is locked and opened with your PIN. Only on this device."
    >
      <Swap id={on ? "on" : "off"}>
        {on ? (
          <View>
            <Row icon="keypad-outline" label="Duress PIN" value="On" onPress={onChangePin} />
            <Divider />
            <Row
              icon="chatbubbles-outline"
              label="Safe chats"
              value={String(config?.safe.length ?? 0)}
              opens
              onPress={onChats}
            />
            <Divider />
            <Row
              icon="paper-plane-outline"
              label="Silent alert"
              value={config?.alert ? "On" : "Off"}
              opens
              onPress={onAlert}
            />
            <Divider />
            <Row icon="close-circle-outline" label="Turn off Head in the sand" danger onPress={onTurnOff} />
          </View>
        ) : (
          <Row icon="eye-off-outline" label="Set up Head in the sand" opens onPress={onSetUp} />
        )}
      </Swap>
    </Section>
  );
}

const nameOf = (chat: Chat) => (chat.type === "saved" ? "Saved messages" : chatTitle(chat));

// Choosing the safe chats (when setting it up, then any time).
function SafeChatsPicker({
  title,
  onCancel,
  onSave,
}: {
  title: string;
  onCancel: () => void;
  onSave: (safe: string[], chats: Chat[]) => Promise<void> | void;
}) {
  const { colors } = useAppTheme();
  const { chats } = useChats();
  const config = useDuressConfig();
  const [picked, setPicked] = useState<string[]>(config?.safe ?? []);
  const [busy, setBusy] = useState(false);

  const all = chats ?? [];

  const save = async () => {
    setBusy(true);

    try {
      if (config) {
        await saveDuressConfig({
          ...config,
          safe: picked,
          // The silent alert's chat must stay hidden.
          alert: config.alert && !picked.includes(config.alert.chatId) ? config.alert : null,
        });
      }

      await onSave(picked, all);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.sections}>
      <Section
        title={title}
        footer="With the duress PIN only these show; the others, and chats that start later with other people, do not. Choose ones you would not mind showing."
      >
        {all.map((chat, index) => {
          const on = picked.includes(chat.id);

          return (
            <View key={chat.id}>
              {index > 0 ? <Divider /> : null}
              <Pressable
                onPress={() =>
                  setPicked((current) => (on ? current.filter((id) => id !== chat.id) : [...current, chat.id]))
                }
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={({ hovered, pressed }) => [
                  styles.pick,
                  (hovered || pressed) && { backgroundColor: colors.hover },
                ]}
              >
                <Avatar
                  name={nameOf(chat)}
                  avatarId={chat.avatar_id}
                  icon={chat.type === "group" ? "people" : chat.type === "saved" ? "bookmark" : chat.type === "room" ? "glasses" : undefined}
                  size={36}
                />
                <Text numberOfLines={1} style={[styles.pickName, { color: colors.text }]}>
                  {nameOf(chat)}
                </Text>
                <Ionicons
                  name={on ? "checkmark-circle" : "ellipse-outline"}
                  size={24}
                  color={on ? colors.accent : colors.muted}
                />
              </Pressable>
            </View>
          );
        })}
      </Section>
      <View style={styles.buttons}>
        <Button title="Save" icon="checkmark" loading={busy} onPress={save} />
        <Button title="Cancel" variant="secondary" disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}

// The silent alert: a chat that is not shown, and what goes to it.
function AlertEditor({ onDone }: { onDone: () => void }) {
  const { colors } = useAppTheme();
  const { chats } = useChats();
  const config = useDuressConfig();
  const [chatId, setChatId] = useState<string | null>(config?.alert?.chatId ?? null);
  const [text, setText] = useState(
    config?.alert?.text ?? "I had to open Ostrich with my duress PIN. If you can, check on me.",
  );
  const [busy, setBusy] = useState(false);

  const hidden = (chats ?? []).filter((chat) => chat.type !== "saved" && !config?.safe.includes(chat.id));

  const save = async (alert: { chatId: string; text: string } | null) => {
    if (!config) {
      return;
    }

    setBusy(true);
    await saveDuressConfig({ ...config, alert });
    setBusy(false);
    onDone();
  };

  return (
    <View style={styles.sections}>
      <Section
        title="Silent alert: to whom"
        footer="When the duress PIN opens Ostrich, this message is sent for you to the chat chosen, end-to-end encrypted like any message. It is not shown on this device; the chat must not be a safe one."
      >
        {hidden.map((chat, index) => {
          const on = chat.id === chatId;

          return (
            <View key={chat.id}>
              {index > 0 ? <Divider /> : null}
              <Pressable
                onPress={() => setChatId(chat.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                style={({ hovered, pressed }) => [
                  styles.pick,
                  (hovered || pressed) && { backgroundColor: colors.hover },
                ]}
              >
                <Avatar
                  name={nameOf(chat)}
                  avatarId={chat.avatar_id}
                  icon={chat.type === "group" ? "people" : chat.type === "room" ? "glasses" : undefined}
                  size={36}
                />
                <Text numberOfLines={1} style={[styles.pickName, { color: colors.text }]}>
                  {nameOf(chat)}
                </Text>
                <Ionicons
                  name={on ? "radio-button-on" : "radio-button-off"}
                  size={22}
                  color={on ? colors.accent : colors.muted}
                />
              </Pressable>
            </View>
          );
        })}
      </Section>

      <Section title="The message">
        <View style={[settingsStyles.form, styles.top]}>
          <TextField value={text} onChangeText={setText} maxLength={1000} multiline placeholder="The message" />
        </View>
      </Section>

      <View style={styles.buttons}>
        <Button
          title="Save"
          icon="checkmark"
          loading={busy}
          disabled={!chatId || !text.trim()}
          onPress={() => save({ chatId: chatId!, text: text.trim() })}
        />
        {config?.alert ? (
          <Button title="Turn off the silent alert" variant="danger" disabled={busy} onPress={() => save(null)} />
        ) : null}
        <Button title="Cancel" variant="secondary" disabled={busy} onPress={onDone} />
      </View>
    </View>
  );
}

function PinFlow({ flow, onDone }: { flow: Flow; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const kind = flow.steps[step];
  const title =
    kind === "current"
      ? "Enter your current PIN"
      : kind === "new"
        ? (flow.newTitle ?? "Choose a new PIN")
        : "Enter it again";

  const next = async (pin: string) => {
    setError(null);

    if (kind === "current" && !(await isPin(pin))) {
      setError("Wrong PIN");
      return false;
    }

    if (kind === "new") {
      setChosen(pin);
    }

    if (kind === "repeat" && pin !== chosen) {
      setError("The PINs do not match: choose it again");
      setChosen(null);
      setStep(flow.steps.indexOf("new"));
      return false;
    }

    if (step < flow.steps.length - 1) {
      setStep(step + 1);
      return true;
    }

    try {
      await flow.done(kind === "current" ? pin : chosen!);
      onDone();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setChosen(null);
      setStep(flow.steps.indexOf("new"));
      return false;
    }
  };

  return (
    <Section>
      <View style={styles.flow}>
        <Swap id={step} step={1}>
          <PinPad title={title} error={error} onComplete={next} />
        </Swap>
        <Button title="Cancel" variant="secondary" onPress={onDone} style={styles.cancel} />
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  sections: {
    gap: 22,
  },

  top: {
    paddingTop: 14,
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

  pick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },

  pickName: {
    flex: 1,
    fontSize: 15,
  },

  buttons: {
    gap: 10,
  },

  flow: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 20,
  },

  cancel: {
    alignSelf: "center",
    minWidth: 160,
  },
});
