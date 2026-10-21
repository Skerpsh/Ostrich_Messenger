import type { ReactNode } from "react";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "./theme";
import { enterStyle, useMotion } from "./motion";
import IconButton from "./icon-button";
import ThemeToggle from "./theme-toggle";

type AppHeaderProps = {
  // Shows a back arrow on the left.
  onBack?: () => void;
  // Shows a close (×) button on the left instead, for panes and dialogs.
  onClose?: () => void;
  // Custom content left of the title, e.g. an avatar.
  left?: ReactNode;
  title?: string;
  // Shown right after the title, e.g. the DEV badge.
  titleBadge?: ReactNode;
  subtitle?: ReactNode;
  // After the subtitle, e.g. "typing…"'s dots.
  subtitleAccessory?: ReactNode;
  // Which subtitle it is when it is not plain text ("typing", "online"):
  // another one fades in.
  subtitleKey?: string;
  right?: ReactNode;
  // The Ostrich logo and light/dark switch, for signed-out screens.
  brand?: boolean;
};

export const HEADER_HEIGHT = 60;

export default function AppHeader({
  onBack,
  onClose,
  left,
  title,
  titleBadge,
  subtitle,
  subtitleAccessory,
  subtitleKey,
  right,
  brand = false,
}: AppHeaderProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const motion = useMotion();

  return (
    <View
      style={[
        styles.header,
        {
          paddingTop: insets.top,
          height: HEADER_HEIGHT + insets.top,
          backgroundColor: colors.surface,
          borderBottomColor: colors.line,
        },
      ]}
    >
      {onBack ? (
        <IconButton icon="chevron-back" label="Back" onPress={onBack} size={24} />
      ) : onClose ? (
        <IconButton icon="close" label="Close" onPress={onClose} size={24} />
      ) : null}

      {brand ? (
        <Image
          source={require("@/assets/images/Giuseppe.png")}
          style={styles.logo}
          contentFit="contain"
          accessibilityLabel="Ostrich"
        />
      ) : null}

      {left}

      <View style={styles.titles}>
        {title ? (
          // Another title (New chat → New group) fades in.
          <Animated.View key={title} style={[styles.titleRow, enterStyle("fade", motion)]}>
            <Text
              numberOfLines={1}
              style={[styles.title, { color: colors.text }]}
            >
              {title}
            </Text>
            {titleBadge}
          </Animated.View>
        ) : null}
        {subtitle ? (
          <Animated.View
            key={typeof subtitle === "string" ? subtitle : subtitleKey}
            style={[styles.subtitleRow, enterStyle("fade", motion)]}
          >
            <Text
              numberOfLines={1}
              style={[styles.subtitle, { color: colors.muted }]}
            >
              {subtitle}
            </Text>
            {subtitleAccessory}
          </Animated.View>
        ) : null}
      </View>

      <View style={styles.actions}>
        {right}
        {brand ? <ThemeToggle /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  logo: {
    width: 34,
    height: 34,
    marginLeft: 4,
  },

  titles: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 2,
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  title: {
    flexShrink: 1,
    fontSize: 17,
    fontWeight: "700",
  },

  subtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  subtitle: {
    flexShrink: 1,
    marginTop: 1,
    fontSize: 13,
  },

  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
});
