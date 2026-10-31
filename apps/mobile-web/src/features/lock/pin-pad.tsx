import { useState, type ReactNode } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import AnimatedPressable from "@/ui/animated-pressable";
import Reveal, { Swap } from "@/ui/reveal";
import { useKeydown } from "@/ui/keys";
import { ms, useMotion, usePressed, useShake } from "@/ui/motion";
import { useAppTheme } from "@/ui/theme";
import { PIN_LENGTH } from "./lock";

// Typing a PIN: its dots and a keypad (and the keyboard's digits on the
// web). onComplete gets the PIN once it is all typed; false back: it was
// not right, the dots shake and empty.
export default function PinPad({
  title,
  message,
  error,
  disabled = false,
  onComplete,
  children,
}: {
  title: string;
  message?: string | null;
  error?: string | null;
  disabled?: boolean;
  onComplete: (pin: string) => Promise<boolean | void> | boolean | void;
  children?: ReactNode;
}) {
  const { colors } = useAppTheme();
  const motion = useMotion();
  const { style: shakeStyle, shake } = useShake();
  const [pin, setPin] = useState("");
  const [checking, setChecking] = useState(false);
  const inactive = disabled || checking;

  const press = (digit: string) => {
    if (inactive || pin.length >= PIN_LENGTH) {
      return;
    }

    const next = pin + digit;
    setPin(next);

    if (next.length === PIN_LENGTH) {
      setChecking(true);

      Promise.resolve(onComplete(next))
        .then((ok) => {
          if (ok === false) {
            shake();
          }
        })
        .catch(() => shake())
        .finally(() => {
          setPin("");
          setChecking(false);
        });
    }
  };

  const erase = () => !inactive && setPin((current) => current.slice(0, -1));

  useKeydown((event) => {
    if (/^\d$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      press(event.key);
      return true;
    }

    if (event.key === "Backspace") {
      erase();
      return true;
    }
  });

  return (
    <View style={styles.pad}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>

      <Animated.View style={[styles.dots, shakeStyle]}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => {
          const filled = i < pin.length;

          return (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                {
                  borderColor: error ? colors.danger : colors.accent,
                  backgroundColor: filled ? colors.accent : "transparent",
                },
                motion === "full" && {
                  transform: [{ scale: filled ? 1.15 : 1 }],
                  transitionProperty: ["transform", "backgroundColor"],
                  transitionDuration: ms(160),
                },
              ]}
            />
          );
        })}
      </Animated.View>

      <View style={styles.message}>
        <Swap id={checking ? "checking" : "idle"}>
          {checking ? (
          <ActivityIndicator color={colors.muted} />
        ) : (
          <Reveal>
            {error || message ? (
              <Text style={[styles.messageText, { color: error ? colors.danger : colors.textSoft }]}>
                {error ?? message}
              </Text>
            ) : null}
          </Reveal>
        )}
        </Swap>
      </View>

      <View style={styles.keys}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "erase"].map((key, i) =>
          key === "" ? (
            <View key={i} style={styles.key} />
          ) : (
            <Key key={i} label={key} disabled={inactive} onPress={() => (key === "erase" ? erase() : press(key))} />
          ),
        )}
      </View>

      {children}
    </View>
  );
}

function Key({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  const { colors } = useAppTheme();
  const { pressed, handlers, style: pressStyle } = usePressed(0.9, !disabled);
  const erase = label === "erase";

  return (
    <AnimatedPressable
      {...handlers}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={erase ? "Erase" : label}
      style={[
        styles.key,
        !erase && { backgroundColor: pressed ? colors.hover : colors.panelAlt },
        pressStyle,
        disabled && styles.disabled,
      ]}
    >
      {erase ? (
        <Ionicons name="backspace-outline" size={26} color={colors.text} />
      ) : (
        <Text style={[styles.keyText, { color: colors.text }]}>{label}</Text>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  pad: {
    alignItems: "center",
    gap: 20,
  },

  title: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },

  dots: {
    flexDirection: "row",
    gap: 18,
  },

  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
  },

  message: {
    minHeight: 40,
    maxWidth: 300,
    justifyContent: "center",
  },

  messageText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },

  keys: {
    width: 264,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 14,
  },

  key: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
  },

  keyText: {
    fontSize: 28,
    fontWeight: "500",
  },

  disabled: {
    opacity: 0.5,
  },
});
