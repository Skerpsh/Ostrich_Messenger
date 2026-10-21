import { useState, type ReactNode } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text } from "react-native";
import AnimatedPressable from "./animated-pressable";
import { useAppTheme } from "./theme";
import { useEscape } from "./keys";
import { enterStyle, leaveStyle, useLeave } from "./motion";
import { radius } from "./colors";
import type { IconName } from "./icon-button";

export type ActionMenuItem = {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  // Destructive actions take a second tap: the label shown after the first.
  confirmLabel?: string;
};

// A card of actions (message or chat menu) over a dimmed background. The
// caller places it: a full-screen layer, or inside a Modal.
export default function ActionMenu({
  title,
  header,
  items,
  onClose,
}: {
  title?: string;
  // E.g. the reactions row.
  header?: ReactNode;
  items: ActionMenuItem[];
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  const { motion, leaving, leave } = useLeave();
  // Leaves with an animation (also on Esc, on the web).
  const close = () => leave(onClose);
  useEscape(true, close);
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <AnimatedPressable
      style={[styles.backdrop, leaving ? leaveStyle("fade", motion) : enterStyle("fade", motion)]}
      pointerEvents={leaving ? "none" : "auto"}
      onPress={close}
      accessibilityLabel="Close menu"
    >
      {/* Taps inside the card do not close the menu. */}
      <AnimatedPressable
        style={[styles.menu, { backgroundColor: colors.panel }, leaving ? leaveStyle("pop", motion) : enterStyle("pop", motion)]}
        onPress={() => {}}
      >
        {title ? (
          <Text numberOfLines={2} style={[styles.title, { color: colors.muted }]}>
            {title}
          </Text>
        ) : null}
        {header}
        {items.map((item) => {
          const asking = confirming === item.label;
          const color = item.danger ? colors.danger : colors.text;

          return (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              onPress={() => {
                if (item.confirmLabel && !asking) {
                  setConfirming(item.label);
                  return;
                }

                item.onPress();
              }}
              style={({ hovered, pressed }) => [
                styles.item,
                (hovered || pressed) && { backgroundColor: colors.hover },
              ]}
            >
              <Ionicons name={item.icon} size={20} color={color} />
              <Text style={[styles.label, { color }]}>
                {asking ? item.confirmLabel : item.label}
              </Text>
            </Pressable>
          );
        })}
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

  menu: {
    width: "100%",
    maxWidth: 320,
    borderRadius: radius.card,
    paddingVertical: 6,
    overflow: "hidden",
  },

  title: {
    fontSize: 13,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },

  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 48,
    paddingHorizontal: 16,
  },

  label: {
    fontSize: 16,
  },
});
