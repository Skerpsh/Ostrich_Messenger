import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import AnimatedPressable from "@/components/animated-pressable";
import { useAppTheme } from "@/context/theme";
import { pressStyle, useMotion, usePressed } from "@/lib/motion";
import { radius } from "@/theme/colors";
import type { IconName } from "./icon-button";

type ButtonProps = Omit<PressableProps, "style"> & {
  title: string;
  // "primary": accent fill; "secondary": outlined; "danger": red text.
  variant?: "primary" | "secondary" | "danger";
  icon?: IconName;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function Button({
  title,
  variant = "primary",
  icon,
  loading = false,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const { colors } = useAppTheme();
  const motion = useMotion();
  const { pressed, handlers } = usePressed();
  const [hovered, setHovered] = useState(false);

  const inactive = disabled || loading;
  const textColor =
    variant === "primary"
      ? colors.onAccent
      : variant === "danger"
        ? colors.danger
        : colors.text;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive) }}
      disabled={inactive}
      {...handlers}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.button,
        variant === "primary"
          ? { backgroundColor: colors.accent, borderColor: colors.accent }
          : {
              backgroundColor:
                (pressed || hovered) && !inactive ? colors.hover : "transparent",
              borderColor: variant === "danger" ? colors.danger : colors.line,
            },
        variant === "primary" && (pressed || hovered) && !inactive && styles.primaryActive,
        inactive && styles.inactive,
        pressStyle(pressed && !inactive, motion, 0.96),
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <View style={styles.content}>
          {icon ? <Ionicons name={icon} size={18} color={textColor} /> : null}
          <Text style={[styles.text, { color: textColor }]}>{title}</Text>
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: 24,
    borderRadius: radius.input,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  primaryActive: {
    opacity: 0.88,
  },

  inactive: {
    opacity: 0.45,
  },

  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  text: {
    fontSize: 16,
    fontWeight: "600",
  },
});
