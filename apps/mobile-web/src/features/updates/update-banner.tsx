import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text } from "react-native";
import { useAppUpdate } from "@/platform/app-update";
import { useAppTheme } from "@/ui/theme";
import PressScale from "@/ui/press-scale";
import { Appear } from "@/ui/reveal";

// Over the chats list: a new version is ready (restart), or a new app to
// download (platform/app-update.ts).
export function UpdateBanner() {
  const { colors } = useAppTheme();
  const update = useAppUpdate();
  const [dismissed, setDismissed] = useState<string | null>(null);

  const key = update ? (update.kind === "download" ? `download:${update.version}` : "restart") : null;

  if (!update || dismissed === key) {
    return null;
  }

  return (
    <Appear kind="pop" style={[styles.banner, { backgroundColor: colors.accentSoft }]}>
      <Ionicons
        name={update.kind === "restart" ? "refresh-outline" : "download-outline"}
        size={18}
        color={colors.accent}
      />
      <PressScale scale={0.98} style={styles.text} onPress={update.apply} accessibilityRole="button">
        <Text style={[styles.label, { color: colors.text }]}>
          {update.kind === "restart"
            ? "A new version of Ostrich is ready. Tap to restart, or it starts next time."
            : `Ostrich ${update.version} needs the new app: tap to download it, then open it to install.`}
        </Text>
      </PressScale>
      <PressScale scale={0.85} onPress={() => setDismissed(key)} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
        <Ionicons name="close" size={18} color={colors.muted} />
      </PressScale>
    </Appear>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },

  text: {
    flex: 1,
  },

  label: {
    fontSize: 13,
    lineHeight: 18,
  },
});
