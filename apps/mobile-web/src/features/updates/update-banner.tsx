import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text } from "react-native";
import Animated from "react-native-reanimated";
import { useAppUpdate } from "@/platform/app-update";
import { useAppTheme } from "@/ui/theme";
import { enterStyle, useMotion } from "@/ui/motion";

// Over the chats list: a new version is ready (restart), or a new app to
// download (platform/app-update.ts).
export function UpdateBanner() {
  const { colors } = useAppTheme();
  const motion = useMotion();
  const update = useAppUpdate();
  const [dismissed, setDismissed] = useState<string | null>(null);

  const key = update ? (update.kind === "download" ? `download:${update.version}` : "restart") : null;

  if (!update || dismissed === key) {
    return null;
  }

  return (
    <Animated.View style={[styles.banner, { backgroundColor: colors.accentSoft }, enterStyle("pop", motion)]}>
      <Ionicons
        name={update.kind === "restart" ? "refresh-outline" : "download-outline"}
        size={18}
        color={colors.accent}
      />
      <Pressable style={styles.text} onPress={update.apply} accessibilityRole="button">
        <Text style={[styles.label, { color: colors.text }]}>
          {update.kind === "restart"
            ? "A new version of Ostrich is ready. Tap to restart, or it starts next time."
            : `Ostrich ${update.version} needs the new app: tap to download it, then open it to install.`}
        </Text>
      </Pressable>
      <Pressable onPress={() => setDismissed(key)} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
        <Ionicons name="close" size={18} color={colors.muted} />
      </Pressable>
    </Animated.View>
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
