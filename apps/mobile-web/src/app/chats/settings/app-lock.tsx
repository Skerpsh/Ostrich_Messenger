import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Button from "@/ui/button";
import { Swap } from "@/ui/reveal";
import { MOD_KEY } from "@/ui/keys";
import { useAppTheme } from "@/ui/theme";
import { SettingsPage } from "@/features/settings/page";
import { Divider, Row, Section, ToggleRow, styles as settingsStyles } from "@/features/settings/ui";
import {
  changePin,
  isPin,
  lockNow,
  setBackgroundLock,
  setWipeAfterTries,
  setWipePin,
  turnOffLock,
  turnOnLock,
  useLock,
  WIPE_AFTER,
} from "@/features/lock/lock";
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
  id: "on" | "change" | "off" | "wipe-on" | "wipe-off";
  steps: ("current" | "new" | "repeat")[];
  newTitle?: string;
  done: (pin: string) => Promise<void>;
};

const FLOWS: Record<Flow["id"], Flow> = {
  on: { id: "on", steps: ["new", "repeat"], done: turnOnLock },
  change: { id: "change", steps: ["current", "new", "repeat"], done: changePin },
  off: { id: "off", steps: ["current"], done: () => turnOffLock() },
  "wipe-on": {
    id: "wipe-on",
    steps: ["current", "new", "repeat"],
    newTitle: "Choose a wipe PIN",
    done: (pin) => setWipePin(pin),
  },
  "wipe-off": { id: "wipe-off", steps: ["current"], done: () => setWipePin(null) },
};

// Settings → App lock (features/lock/lock.ts).
export default function AppLockSettings() {
  const { colors } = useAppTheme();
  const { config } = useLock();
  const [flow, setFlow] = useState<Flow | null>(null);

  return (
    <SettingsPage title="App lock">
      <Swap id={flow?.id ?? (config ? "on" : "off")}>
        {flow ? (
          <PinFlow flow={flow} onDone={() => setFlow(null)} />
        ) : config ? (
          <View style={styles.sections}>
            <Section footer="Asked every time Ostrich starts, and after it was in the background for the time chosen. Only on this device: the PIN never leaves it.">
              <Row icon="keypad-outline" label="Change PIN" onPress={() => setFlow(FLOWS.change)} />
              <Divider />
              <Row
                icon="lock-closed-outline"
                label="Lock now"
                value={Platform.OS === "web" ? `${MOD_KEY} L` : undefined}
                onPress={lockNow}
              />
            </Section>

            <Section title="Lock in the background">
              <View style={[settingsStyles.form, styles.top]}>
                <View style={styles.chips}>
                  {BACKGROUND.map((option) => {
                    const selected = option.minutes === config.background;

                    return (
                      <Pressable
                        key={option.label}
                        onPress={() => setBackgroundLock(option.minutes)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        style={({ hovered, pressed }) => [
                          styles.chip,
                          {
                            backgroundColor: selected
                              ? colors.accentSoft
                              : hovered || pressed
                                ? colors.hover
                                : colors.panelAlt,
                          },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: selected ? colors.accent : colors.text }]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[settingsStyles.formText, { color: colors.muted }]}>
                  {config.background === null
                    ? "Only when Ostrich starts."
                    : config.background === 0
                      ? "As soon as you leave Ostrich."
                      : `After ${config.background === 60 ? "an hour" : `${config.background} min`} away from Ostrich.`}
                </Text>
              </View>
            </Section>

            <Section
              title="Wiping this device"
              footer={`Wiping removes everything Ostrich keeps on this device and logs it out; it then looks freshly installed. Your account and messages stay: log in again with your username, password and OstrichID. The wipe PIN wipes at once, as if it were a wrong PIN.`}
            >
              <Row
                icon="flame-outline"
                label="Wipe PIN"
                value={config.wipe ? "On" : "Off"}
                onPress={() => setFlow(config.wipe ? FLOWS["wipe-off"] : FLOWS["wipe-on"])}
              />
              <Divider />
              <ToggleRow
                icon="alert-circle-outline"
                label={`Wipe after ${WIPE_AFTER} wrong PINs`}
                hint="In a row. From the 5th, each wrong PIN also makes the next one wait longer."
                value={config.wipeAfterTries}
                onChange={(on) => setWipeAfterTries(on)}
              />
            </Section>

            <Section>
              <Row icon="lock-open-outline" label="Turn off app lock" danger onPress={() => setFlow(FLOWS.off)} />
            </Section>
          </View>
        ) : (
          <Section footer="A 4-digit PIN asked when Ostrich starts and after it was in the background. Only on this device: the PIN never leaves it and is not synced. It locks the screens; it does not encrypt your messages.">
            <View style={[settingsStyles.form, styles.top]}>
              <Text style={[settingsStyles.formText, { color: colors.textSoft }]}>Off.</Text>
              <Button title="Turn on app lock" icon="lock-closed-outline" onPress={() => setFlow(FLOWS.on)} />
            </View>
          </Section>
        )}
      </Swap>
    </SettingsPage>
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
