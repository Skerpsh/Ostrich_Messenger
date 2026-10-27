import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AnimatedPressable from "@/ui/animated-pressable";
import Button from "@/ui/button";
import TextField from "@/ui/text-field";
import { Segmented } from "@/features/settings/ui";
import { serverNow } from "@/api/server-clock";
import { useAppTheme } from "@/ui/theme";
import { useEscape } from "@/ui/keys";
import { enterStyle, leaveStyle, useLeave } from "@/ui/motion";
import { radius } from "@/ui/colors";
import { MAX_SEAL_YEARS, MIN_SEAL_MS } from "./sealed";
import Reveal from "@/ui/reveal";

// How the next message is sealed: until when (ms), and whether the server
// keeps it from the others until then.
export type Sealing = { opensAt: number; surprise: boolean };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function inYears(years: number, from: number) {
  const date = new Date(from);
  date.setFullYear(date.getFullYear() + years);
  return date.getTime();
}

// Tomorrow at 9:00 on this device.
function tomorrowMorning(from: number) {
  const date = new Date(from + DAY);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}

const PRESETS: { label: string; at: (now: number) => number }[] = [
  { label: "In an hour", at: (now) => now + HOUR },
  { label: "Tomorrow, 9:00", at: tomorrowMorning },
  { label: "In a week", at: (now) => now + 7 * DAY },
  { label: "In a month", at: (now) => now + 30 * DAY },
  { label: "In a year", at: (now) => inYears(1, now) },
  { label: "In 5 years", at: (now) => inYears(5, now) },
  { label: "In 10 years", at: (now) => inYears(MAX_SEAL_YEARS, now) - HOUR },
];

const pad = (n: number) => String(n).padStart(2, "0");

const dateText = (time: number) => {
  const d = new Date(time);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};

const timeText = (time: number) => {
  const d = new Date(time);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// "31.12.2030" and "18:00" on this device, or null.
function parseWhen(date: string, time: string): number | null {
  const d = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/.exec(date);
  const t = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(time);

  if (!d || !t) {
    return null;
  }

  const [day, month, year, hours, minutes] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  const when = new Date(year, month - 1, day, hours, minutes);

  return when.getDate() === day && when.getMonth() === month - 1 && hours < 24 && minutes < 60
    ? when.getTime()
    : null;
}

// Choosing when the message being written opens (placed like SafetyCode).
export default function SealSheet({
  initial,
  onSeal,
  onClose,
}: {
  initial: Sealing | null;
  onSeal: (sealing: Sealing) => void;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  const { motion, leaving, leave } = useLeave();
  const close = () => leave(onClose);
  useEscape(true, close);

  const start = initial?.opensAt ?? tomorrowMorning(serverNow());
  const [date, setDate] = useState(dateText(start));
  const [time, setTime] = useState(timeText(start));
  const [surprise, setSurprise] = useState(initial?.surprise ?? false);

  const choose = (at: number) => {
    setDate(dateText(at));
    setTime(timeText(at));
  };

  const when = parseWhen(date, time);
  const now = serverNow();
  const problem =
    when === null
      ? "Write the date as 31.12.2030 and the time as 18:00"
      : when < now + MIN_SEAL_MS
        ? "Choose a time at least a minute from now"
        : when > inYears(MAX_SEAL_YEARS, now)
          ? `A letter can be sealed for up to ${MAX_SEAL_YEARS} years`
          : null;

  return (
    <AnimatedPressable
      style={[styles.backdrop, leaving ? leaveStyle("fade", motion) : enterStyle("fade", motion)]}
      pointerEvents={leaving ? "none" : "auto"}
      onPress={close}
      accessibilityLabel="Close"
    >
      <AnimatedPressable
        style={[styles.card, { backgroundColor: colors.panel }, leaving ? leaveStyle("pop", motion) : enterStyle("pop", motion)]}
        onPress={() => {}}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name="mail-outline" size={24} color={colors.accent} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>A letter to the future</Text>
          <Text style={[styles.text, { color: colors.textSoft }]}>
            The message you are writing, with its files, is sealed until the time you choose.
            Nobody can open it before then: not the chat, not you, not the server.
          </Text>

          <View style={styles.presets}>
            {PRESETS.map((preset) => (
              <Pressable
                key={preset.label}
                onPress={() => choose(preset.at(serverNow()))}
                accessibilityRole="button"
                style={({ hovered, pressed }) => [
                  styles.preset,
                  { backgroundColor: hovered || pressed ? colors.hover : colors.panelAlt },
                ]}
              >
                <Text style={[styles.presetText, { color: colors.text }]}>{preset.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.fields}>
            <View style={styles.field}>
              <TextField
                label="Date"
                value={date}
                onChangeText={setDate}
                placeholder="31.12.2030"
                inputMode="numeric"
                maxLength={10}
              />
            </View>
            <View style={styles.field}>
              <TextField
                label="Time"
                value={time}
                onChangeText={setTime}
                placeholder="18:00"
                inputMode="numeric"
                maxLength={5}
              />
            </View>
          </View>

          <Segmented
            options={[
              { value: "envelope", label: "Envelope", icon: "mail-outline" },
              { value: "surprise", label: "Surprise", icon: "gift-outline" },
            ]}
            value={surprise ? "surprise" : "envelope"}
            onChange={(value) => setSurprise(value === "surprise")}
          />
          <Text style={[styles.text, { color: colors.textSoft }]}>
            {surprise
              ? "It arrives on the day, as a surprise. Until then the server keeps it, so the server knows when it opens."
              : "It arrives now as a sealed envelope that shows when it opens, and opens by itself then."}
          </Text>

          <Reveal>
            {problem ? <Text style={[styles.text, { color: colors.danger }]}>{problem}</Text> : null}
          </Reveal>

          <View style={styles.buttons}>
            <Button title="Cancel" variant="secondary" style={styles.flex} onPress={close} />
            <Button
              title="Seal"
              icon="lock-closed"
              style={styles.flex}
              disabled={problem !== null}
              onPress={() => when !== null && leave(() => onSeal({ opensAt: when, surprise }))}
            />
          </View>
        </ScrollView>
      </AnimatedPressable>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },

  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "90%",
    borderRadius: radius.card,
    overflow: "hidden",
  },

  body: {
    padding: 22,
    gap: 14,
  },

  icon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },

  title: {
    fontSize: 18,
    fontWeight: "700",
  },

  text: {
    fontSize: 14,
    lineHeight: 20,
  },

  presets: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  preset: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },

  presetText: {
    fontSize: 14,
  },

  fields: {
    flexDirection: "row",
    gap: 10,
  },

  field: {
    flex: 1,
  },

  buttons: {
    flexDirection: "row",
    gap: 8,
  },

  flex: {
    flex: 1,
  },
});
