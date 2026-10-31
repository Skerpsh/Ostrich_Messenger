import { useMemo, useRef, useState, type ReactNode } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import type { IconName } from "@/ui/icon-button";
import { Swap, useSlider } from "@/ui/reveal";
import PressScale from "@/ui/press-scale";
import { ms, SPRING, useMotion } from "@/ui/motion";
import { useAppTheme } from "@/ui/theme";
import { useLatest } from "@/ui/use-latest";
import { radius } from "@/ui/colors";
import { haptic } from "@/ui/haptics";

// Building blocks of the settings screen and its styles.

// A row with an on/off switch.
export function ToggleRow({
  icon,
  label,
  hint,
  value,
  onChange,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.toggleRow}>
      <Ionicons name={icon} size={20} color={colors.muted} />
      <View style={styles.toggleText}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
        {hint ? (
          <Text style={[styles.toggleHint, { color: colors.muted }]}>{hint}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={(next) => {
          haptic("tick");
          onChange(next);
        }}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ false: colors.panelAlt, true: colors.accent }}
        thumbColor="#ffffff"
        {...({ activeThumbColor: "#ffffff" } as object)}
      />
    </View>
  );
}

export function Section({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
}) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.section}>
      {title ? (
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>
          {title}
        </Text>
      ) : null}
      <View style={[styles.sectionCard, { backgroundColor: colors.panel }]}>
        {children}
      </View>
      {footer ? (
        <Text style={[styles.sectionFooter, { color: colors.muted }]}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

// Rows with icons have the divider start after the icon.
export function Divider({ full = false }: { full?: boolean }) {
  const { colors } = useAppTheme();

  return (
    <View
      style={[
        styles.divider,
        full && styles.dividerFull,
        { backgroundColor: colors.line },
      ]}
    />
  );
}

export function Row({
  icon,
  label,
  value,
  expanded,
  opens = false,
  danger = false,
  loading = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  value?: string;
  // Rows that open a form show a chevron pointing down / up.
  expanded?: boolean;
  // Rows that open a screen show a chevron pointing right.
  opens?: boolean;
  danger?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const motion = useMotion();
  const color = danger ? colors.danger : colors.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      style={({ hovered, pressed }) => [
        styles.row,
        (hovered || pressed) && { backgroundColor: colors.hover },
      ]}
    >
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.muted} />
      <Text style={[styles.rowLabel, { color }]}>{label}</Text>
      {value ? (
        <Text numberOfLines={1} style={[styles.rowValue, { color: colors.muted }]}>
          {value}
        </Text>
      ) : null}
      <Swap id={loading ? "loading" : "idle"} resize={false}>
        {loading ? (
          <ActivityIndicator color={color} />
        ) : expanded !== undefined ? (
          // Turns over as the form opens and closes.
          <Animated.View
            style={{
              transform: [{ rotate: expanded ? "180deg" : "0deg" }],
              ...(motion === "full"
                ? { transitionProperty: "transform", transitionDuration: ms(320), transitionTimingFunction: SPRING }
                : {}),
            }}
          >
            <Ionicons name="chevron-down" size={18} color={colors.muted} />
          </Animated.View>
        ) : opens ? (
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        ) : null}
      </Swap>
    </Pressable>
  );
}

// One choice of a few, side by side (theme, text size, ...).
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: IconName }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { colors } = useAppTheme();
  const slider = useSlider(options.findIndex((option) => option.value === value));
  const raised = { backgroundColor: colors.panel, boxShadow: `0 1px 4px ${colors.shadow}` };

  return (
    <View style={[styles.segmented, { backgroundColor: colors.panelAlt }]}>
      {/* The selected one's background slides to it. */}
      {slider.style ? <Animated.View style={[styles.segmentSlider, raised, slider.style]} /> : null}
      {options.map((option, index) => {
        const selected = value === option.value;

        return (
          <PressScale
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            onLayout={slider.onLayout(index)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            scale={0.96}
            style={[styles.segment, selected && !slider.style && raised]}
          >
            {option.icon ? (
              <Ionicons name={option.icon} size={16} color={selected ? colors.accent : colors.muted} />
            ) : null}
            <Text
              numberOfLines={1}
              style={[styles.segmentText, { color: selected ? colors.text : colors.muted }]}
            >
              {option.label}
            </Text>
          </PressScale>
        );
      })}
    </View>
  );
}

// One of a few values in a row, dragged or tapped to (animation speed).
export function StepSlider<T>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  // For screen readers.
  label: string;
}) {
  const { colors } = useAppTheme();
  const motion = useMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const last = options.length - 1;
  const step = last > 0 ? width / last : 0;

  // The pan responder is made once: it reads these as they are now.
  const latest = useLatest({ step, index, options, onChange });
  const start = useRef(0);

  const pick = (x: number) => {
    const { step, index, options, onChange } = latest.current;
    const next = step > 0 ? Math.min(options.length - 1, Math.max(0, Math.round(x / step))) : index;

    if (next !== index) {
      haptic("tick");
      onChange(options[next].value);
    }
  };

  const pan = useMemo(
    () =>
      // Its handlers run on touches, not while rendering.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Dragging along does not hand the touch over to the page's scroll.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          start.current = event.nativeEvent.locationX - THUMB / 2;
          pick(start.current);
        },
        onPanResponderMove: (_, gesture) => pick(start.current + gesture.dx),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pick reads latest
    [],
  );

  const move = (by: number) => {
    const next = index + by;

    if (next >= 0 && next <= last) {
      onChange(options[next].value);
    }
  };

  return (
    <View style={styles.stepSlider}>
      <View
        {...pan.panHandlers}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width - THUMB)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: options[index].label }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => move(event.nativeEvent.actionName === "increment" ? 1 : -1)}
        style={styles.stepTrackArea}
      >
        <View pointerEvents="none" style={[styles.stepTrack, { backgroundColor: colors.panelAlt }]}>
          {options.map((option, i) => (
            <View
              key={String(option.value)}
              style={[styles.stepDot, { left: i * step, backgroundColor: i <= index ? colors.accent : colors.line }]}
            />
          ))}
        </View>
        {width > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.stepThumb,
              {
                backgroundColor: colors.accent,
                boxShadow: `0 1px 4px ${colors.shadow}`,
                transform: [{ translateX: index * step }],
              },
              motion === "full"
                ? { transitionProperty: "transform", transitionDuration: ms(240), transitionTimingFunction: SPRING }
                : null,
            ]}
          />
        ) : null}
      </View>
      <View style={styles.stepLabels}>
        {options.map((option, i) => (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={[styles.stepLabel, { left: i * step, width: THUMB }]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.stepLabelText,
                { color: i === index ? colors.text : colors.muted, fontWeight: i === index ? "700" : "400" },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const THUMB = 24;

// A labelled block inside a section (accent colors, wallpapers, ...).
export function Block({ label, children }: { label: string; children: ReactNode }) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.accentBlock}>
      <Text style={[styles.accentLabel, { color: colors.textSoft }]}>{label}</Text>
      {children}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },

  body: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    padding: 16,
    gap: 22,
  },

  profile: {
    alignItems: "center",
    gap: 10,
    borderRadius: radius.card,
    paddingVertical: 24,
    paddingHorizontal: 16,
  },

  usernameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  username: {
    flexShrink: 1,
    fontSize: 22,
    fontWeight: "700",
  },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },

  chipText: {
    fontSize: 14,
    fontWeight: "600",
  },

  hovered: {
    opacity: 0.85,
  },

  hint: {
    fontSize: 13,
    textAlign: "center",
  },

  section: {
    gap: 8,
  },

  photo: {
    alignItems: "center",
    gap: 8,
  },

  photoBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },

  photoAction: {
    fontSize: 13,
    fontWeight: "600",
  },

  photoError: {
    fontSize: 13,
    textAlign: "center",
  },

  accentBlock: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 12,
  },

  accentLabel: {
    fontSize: 15,
  },

  swatches: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },

  swatchRing: {
    padding: 3,
    borderRadius: 22,
    borderWidth: 2,
  },

  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 14,
  },

  sectionCard: {
    borderRadius: radius.card,
    overflow: "hidden",
  },

  sectionFooter: {
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 14,
  },

  segmented: {
    flexDirection: "row",
    margin: 10,
    padding: 3,
    borderRadius: 12,
  },

  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
  },

  segmentSlider: {
    borderRadius: 10,
  },

  stepSlider: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },

  stepTrackArea: {
    height: 36,
    justifyContent: "center",
  },

  stepTrack: {
    height: 4,
    borderRadius: 2,
    marginHorizontal: THUMB / 2,
  },

  stepDot: {
    position: "absolute",
    top: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: -4,
  },

  stepThumb: {
    position: "absolute",
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
  },

  stepLabels: {
    height: 24,
  },

  stepLabel: {
    position: "absolute",
    top: 0,
    alignItems: "center",
    overflow: "visible",
  },

  stepLabelText: {
    fontSize: 12,
    width: 48,
    textAlign: "center",
  },

  segmentText: {
    fontSize: 14,
    fontWeight: "600",
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 52,
    paddingHorizontal: 16,
  },

  rowLabel: {
    flex: 1,
    fontSize: 16,
  },

  rowValue: {
    fontSize: 15,
    maxWidth: "50%",
  },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },

  toggleText: {
    flex: 1,
    gap: 2,
  },

  toggleHint: {
    fontSize: 13,
    lineHeight: 18,
  },

  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },

  deviceButton: {
    minHeight: 36,
    paddingHorizontal: 14,
  },

  loadingRow: {
    padding: 16,
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 50,
  },

  dividerFull: {
    marginLeft: 0,
  },

  form: {
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 18,
  },

  formText: {
    fontSize: 14,
    lineHeight: 20,
  },

  formMessage: {
    fontSize: 14,
  },

  inset: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
});
