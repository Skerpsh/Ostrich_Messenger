import { useEffect, useState, type ReactNode } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AnimatedPressable from "./animated-pressable";
import { useAppTheme } from "./theme";
import { useEscape } from "./keys";
import { useLeave } from "./motion";
import { radius } from "./colors";
import type { IconName } from "./icon-button";
import Button from "./button";
import Reveal, { useAppear } from "./reveal";

export type ActionMenuItem = {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  // Destructive actions are confirmed: the question shown after the first
  // tap, over Cancel and the action.
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
  const { leaving, leave } = useLeave();
  const fadeStyle = useAppear("fade", leaving);
  const popStyle = useAppear("pop", leaving);
  // Leaves with an animation (also on Esc, on the web).
  const close = () => leave(onClose);
  useEscape(true, close);
  const [confirming, setConfirming] = useState<string | null>(null);
  // The confirming button takes taps only after a moment, so a double tap
  // on the item does not go through.
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const armed = confirming !== null && armedFor === confirming;

  useEffect(() => {
    const timer = setTimeout(() => setArmedFor(confirming), ARM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  return (
    <AnimatedPressable
      style={[styles.backdrop, fadeStyle]}
      pointerEvents={leaving ? "none" : "auto"}
      onPress={close}
      accessibilityLabel="Close menu"
    >
      {/* Taps inside the card do not close the menu. */}
      <AnimatedPressable
        style={[styles.menu, { backgroundColor: colors.panel }, popStyle]}
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

          if (asking) {
            return (
              <View key={item.label} style={styles.asking}>
                <View style={styles.question}>
                  <Ionicons name={item.icon} size={20} color={color} />
                  <Text style={[styles.label, styles.flex, { color }]}>{item.confirmLabel}</Text>
                </View>
                {/* Below the question: where the first tap was, nothing. */}
                <Reveal kind="rise" appear>
                  <View style={styles.answers}>
                    <Button
                      title="Cancel"
                      variant="secondary"
                      style={styles.flex}
                      onPress={() => {
                        setConfirming(null);
                        setArmedFor(null);
                      }}
                    />
                    <Button
                      // The verb (Delete, Leave, Clear, ...): the question says the rest.
                      title={item.label.split(" ")[0]}
                      variant="danger"
                      style={styles.flex}
                      disabled={!armed}
                      onPress={item.onPress}
                    />
                  </View>
                </Reveal>
              </View>
            );
          }

          return (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              onPress={() => {
                if (item.confirmLabel) {
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
              <Text style={[styles.label, styles.flex, { color }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </AnimatedPressable>
    </AnimatedPressable>
  );
}

const ARM_MS = 500;

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },

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

  asking: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },

  question: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 32,
  },

  answers: {
    flexDirection: "row",
    gap: 10,
  },
});
