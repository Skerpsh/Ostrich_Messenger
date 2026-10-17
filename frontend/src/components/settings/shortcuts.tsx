import { Fragment } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "@/context/theme";
import { SHORTCUTS } from "@/lib/keys";
import { Divider, Section } from "./ui";

// The web app's keyboard shortcuts (lib/keys.ts).
export function ShortcutsSection() {
  const { colors } = useAppTheme();

  if (Platform.OS !== "web") {
    return null;
  }

  return (
    <Section title="Keyboard shortcuts">
      {SHORTCUTS.map((shortcut, index) => (
        <Fragment key={shortcut.keys}>
          {index > 0 ? <Divider full /> : null}
          <View style={local.row}>
            <Text style={[local.action, { color: colors.text }]}>{shortcut.action}</Text>
            <Text style={[local.keys, { color: colors.textSoft, backgroundColor: colors.panelAlt }]}>
              {shortcut.keys}
            </Text>
          </View>
        </Fragment>
      ))}
    </Section>
  );
}

const local = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 46,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },

  action: {
    flex: 1,
    fontSize: 15,
  },

  keys: {
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
  },
});
