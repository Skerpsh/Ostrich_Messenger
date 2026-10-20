import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import PatternLayer from "@/components/pattern-layer";
import { useAppTheme } from "@/context/theme";
import type { Wallpaper } from "@/lib/personalization";

// Behind the messages of a chat: ostriches in the accent color, or a photo
// dimmed toward the page's color so messages stay readable.
//
// The patterns are seamless square tiles (white lines on transparent, drawn
// at 3x), repeated over the whole area in the accent color (PatternLayer).

const PATTERNS = {
  running: { source: require("@/assets/images/wallpapers/running.png"), tile: 600 },
  large: { source: require("@/assets/images/wallpapers/running.png"), tile: 900 },
  heads: { source: require("@/assets/images/wallpapers/heads.png"), tile: 600 },
};

// Per brightness (1–3): the pattern's opacity, and how much of the photo
// shows through the page's color.
const PATTERN_OPACITY = { dark: [0.2, 0.34, 0.5], light: [0.13, 0.22, 0.32] };
const PHOTO_OPACITY = { dark: [0.35, 0.55, 0.75], light: [0.4, 0.6, 0.8] };

export default function ChatWallpaper({
  wallpaper,
  photo,
  scale = 1,
}: {
  wallpaper: Wallpaper;
  photo: string | null;
  // Smaller ostriches, for previews.
  scale?: number;
}) {
  const { colors, mode } = useAppTheme();
  const level = wallpaper.brightness - 1;

  if (wallpaper.pattern === "none") {
    return null;
  }

  if (wallpaper.pattern === "photo") {
    return photo ? (
      <View pointerEvents="none" style={styles.wallpaper}>
        <Image
          source={{ uri: photo }}
          contentFit="cover"
          style={[styles.photo, { opacity: PHOTO_OPACITY[mode][level] }]}
        />
      </View>
    ) : null;
  }

  const { source, tile } = PATTERNS[wallpaper.pattern];

  return (
    <View pointerEvents="none" style={[styles.wallpaper, { opacity: PATTERN_OPACITY[mode][level] }]}>
      <PatternLayer source={source} tile={tile * scale} color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  wallpaper: {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
  },
  photo: {
    width: "100%",
    height: "100%",
  },
});
