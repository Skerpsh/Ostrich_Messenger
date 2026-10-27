import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, TextInput, View } from "react-native";
import ChatWallpaper from "@/features/chat/chat-wallpaper";
import { Segmented, styles as settingsStyles } from "./ui";
import { noWebOutline } from "@/ui/text-field";
import { useAppTheme } from "@/ui/theme";
import { WALLPAPER_PATTERNS, type Wallpaper, type WallpaperPattern } from "./personalization";
import { pickWallpaperPhoto } from "./wallpaper-photo";
import {
  accents,
  accentVariant,
  hslOf,
  hslToHex,
  isCustomAccent,
  radius,
  type AccentChoice,
} from "@/ui/colors";
import Reveal from "@/ui/reveal";
import PressScale from "@/ui/press-scale";

// The pickers of Settings → Personalization, also used by a chat's
// "Wallpaper & color" screen.

// The accents, and a color of one's own: a hue strip and "#rrggbb".
export function AccentPicker({
  value,
  onChange,
}: {
  value: AccentChoice | null;
  onChange: (accent: AccentChoice) => void;
}) {
  const { colors, mode } = useAppTheme();
  const custom = value !== null && isCustomAccent(value);
  const [showCustom, setShowCustom] = useState(custom);

  return (
    <View style={styles.accentPicker}>
      <View style={settingsStyles.swatches}>
        {accents.map((accent) => {
          const selected = accent.id === value;
          const variant = accent[mode];

          return (
            <PressScale scale={0.88}
              key={accent.id}
              onPress={() => {
                setShowCustom(false);
                onChange(accent.id);
              }}
              accessibilityRole="radio"
              accessibilityLabel={accent.name}
              accessibilityState={{ checked: selected }}
              {...({ title: accent.name } as object)}
              style={[settingsStyles.swatchRing, { borderColor: selected ? variant.accent : "transparent" }]}
            >
              <View style={[settingsStyles.swatch, { backgroundColor: variant.accent }]}>
                <Reveal kind="pop" collapse={false}>
                  {selected ? <Ionicons name="checkmark" size={18} color={variant.onAccent} /> : null}
                </Reveal>
              </View>
            </PressScale>
          );
        })}
        <PressScale scale={0.88}
          onPress={() => setShowCustom((shown) => !shown)}
          accessibilityRole="radio"
          accessibilityLabel="Your own color"
          accessibilityState={{ checked: custom }}
          {...({ title: "Your own color" } as object)}
          style={[
            settingsStyles.swatchRing,
            { borderColor: custom ? accentVariant(value, mode).accent : "transparent" },
          ]}
        >
          <LinearGradient
            colors={["#ff5f5f", "#f5c542", "#6fdc6f", "#3ed6c5", "#5aa9ff", "#b392ff", "#ff7ab6"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={settingsStyles.swatch}
          >
            <Ionicons name={custom ? "checkmark" : "add"} size={18} color="#111113" />
          </LinearGradient>
        </PressScale>
      </View>
      <Reveal>
        {showCustom ? (
        <CustomColor value={custom ? value : null} onChange={onChange} colors={colors} />
      ) : null}
      </Reveal>
    </View>
  );
}

const HUES = ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"] as const;

function CustomColor({
  value,
  onChange,
  colors,
}: {
  value: `#${string}` | null;
  onChange: (accent: AccentChoice) => void;
  colors: ReturnType<typeof useAppTheme>["colors"];
}) {
  const [width, setWidth] = useState(1);
  const [hex, setHex] = useState(value ?? "");
  const hue = value ? hslOf(value)[0] : null;

  const pickAt = (x: number) => {
    const next = hslToHex(Math.max(0, Math.min(359, (x / width) * 360)), 0.85, 0.6);
    setHex(next);
    onChange(next);
  };

  return (
    <View style={styles.custom}>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width || 1)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => pickAt(event.nativeEvent.locationX)}
        onResponderMove={(event) => pickAt(event.nativeEvent.locationX)}
        accessibilityLabel="Hue"
        style={styles.hueStrip}
      >
        <LinearGradient
          colors={HUES}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[StyleSheet.absoluteFill, styles.hueGradient]}
          pointerEvents="none"
        />
        {hue !== null ? (
          <View
            pointerEvents="none"
            style={[styles.hueThumb, { left: (hue / 360) * width - 8, backgroundColor: value ?? undefined }]}
          />
        ) : null}
      </View>
      <View style={styles.hexRow}>
        <Text style={[styles.hexLabel, { color: colors.muted }]}>Hex</Text>
        <TextInput
          value={hex}
          onChangeText={(text) => {
            const next = (text.startsWith("#") ? text : `#${text}`).slice(0, 7).toLowerCase();
            setHex(next);

            if (isCustomAccent(next)) {
              onChange(next);
            }
          }}
          placeholder="#ff8a3d"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={7}
          accessibilityLabel="Color, as #rrggbb"
          style={[styles.hexInput, noWebOutline, { color: colors.text, backgroundColor: colors.panelAlt }]}
        />
      </View>
      <Text style={[settingsStyles.toggleHint, { color: colors.muted }]}>
        Made lighter or darker where needed, so text stays readable in both themes.
      </Text>
    </View>
  );
}

const BRIGHTNESS = [
  { value: 1 as const, label: "Subtle" },
  { value: 2 as const, label: "Medium" },
  { value: 3 as const, label: "Bright" },
];

// The patterns (with small previews), a photo, none; and how bright.
// `photo`: the photo for "photo" now; choosing one calls onPhoto.
export function WallpaperPicker({
  value,
  photo,
  onChange,
  onPhoto,
  onError,
}: {
  value: Wallpaper;
  photo: string | null;
  onChange: (wallpaper: Wallpaper) => void;
  onPhoto: (photo: string) => void;
  onError?: (message: string) => void;
}) {
  const { colors } = useAppTheme();

  const choose = async (pattern: WallpaperPattern) => {
    if (pattern === "photo") {
      try {
        const picked = await pickWallpaperPhoto();

        if (!picked) {
          return;
        }

        onPhoto(picked.uri);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Could not open the photo");
        return;
      }
    }

    onChange({ ...value, pattern });
  };

  return (
    <View style={styles.wallpaperPicker}>
      <View style={styles.patterns}>
        {WALLPAPER_PATTERNS.map((option) => {
          const selected = value.pattern === option.value;

          return (
            <PressScale scale={0.92}
              key={option.value}
              onPress={() => choose(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={option.value === "photo" ? "Photo: choose one" : option.label}
              accessibilityState={{ checked: selected }}
              style={styles.patternOption}
            >
              <View
                style={[
                  styles.patternThumb,
                  { backgroundColor: colors.bg, borderColor: selected ? colors.accent : colors.line },
                ]}
              >
                {option.value === "photo" && !photo ? (
                  <Ionicons name="image-outline" size={22} color={colors.muted} style={styles.thumbIcon} />
                ) : option.value === "none" ? (
                  <Ionicons name="ban-outline" size={22} color={colors.muted} style={styles.thumbIcon} />
                ) : (
                  <ChatWallpaper
                    wallpaper={{ pattern: option.value, brightness: 3 }}
                    photo={photo}
                    scale={0.25}
                  />
                )}
              </View>
              <Text style={[styles.patternLabel, { color: selected ? colors.text : colors.muted }]}>
                {option.label}
              </Text>
            </PressScale>
          );
        })}
      </View>
      <Reveal>
        {value.pattern !== "none" ? (
        <Segmented
          options={BRIGHTNESS}
          value={value.brightness}
          onChange={(brightness) => onChange({ ...value, brightness })}
        />
      ) : null}
      </Reveal>
    </View>
  );
}

// A few messages over the wallpaper, to see the choices together.
export function ChatPreview({ wallpaper, photo }: { wallpaper: Wallpaper; photo: string | null }) {
  const { colors, textScale } = useAppTheme();
  const text = { fontSize: 16 * textScale, lineHeight: 22 * textScale };

  return (
    <View style={[styles.preview, { backgroundColor: colors.bg, borderColor: colors.line }]}>
      <ChatWallpaper wallpaper={wallpaper} photo={photo} scale={0.6} />
      <View style={[styles.bubble, styles.bubbleOther, { backgroundColor: colors.panel }]}>
        <Text style={[text, { color: colors.text }]}>Have you seen the new wallpapers? 🐦</Text>
      </View>
      <View style={[styles.bubble, styles.bubbleOwn, { backgroundColor: colors.accent }]}>
        <Text style={[text, { color: colors.onAccent }]}>Yes, the ostriches match the accent!</Text>
      </View>
      <View style={[styles.bubble, styles.bubbleOther, { backgroundColor: colors.panel }]}>
        <Text style={[text, { color: colors.text }]}>Nice 👍</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  accentPicker: {
    gap: 14,
  },

  custom: {
    gap: 10,
  },

  hueStrip: {
    height: 28,
    justifyContent: "center",
  },

  hueGradient: {
    borderRadius: 14,
  },

  hueThumb: {
    position: "absolute",
    width: 16,
    height: 32,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: "#ffffff",
    boxShadow: "0 1px 4px rgba(0, 0, 0, 0.4)",
  },

  hexRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  hexLabel: {
    fontSize: 14,
  },

  hexInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: "monospace",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.input,
  },

  wallpaperPicker: {
    gap: 4,
  },

  patterns: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  patternOption: {
    alignItems: "center",
    gap: 6,
  },

  patternThumb: {
    width: 54,
    height: 84,
    borderRadius: 12,
    borderWidth: 2,
    overflow: "hidden",
  },

  thumbIcon: {
    margin: "auto",
  },

  patternLabel: {
    fontSize: 12,
    fontWeight: "600",
  },

  preview: {
    height: 210,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    justifyContent: "flex-end",
    padding: 12,
    gap: 6,
  },

  bubble: {
    maxWidth: "80%",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.bubble,
  },

  bubbleOther: {
    alignSelf: "flex-start",
  },

  bubbleOwn: {
    alignSelf: "flex-end",
  },
});
