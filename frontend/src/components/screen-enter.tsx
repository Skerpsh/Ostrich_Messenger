import type { ReactNode } from "react";
import { Platform, StyleSheet } from "react-native";
import Animated from "react-native-reanimated";
import { enterStyle, useMotion } from "@/lib/motion";

// A screen sliding in as it opens, on the web (the phones' navigation
// animates its screens itself, see useScreenAnimation).
export default function ScreenEnter({ children }: { children: ReactNode }) {
  const motion = useMotion();

  if (Platform.OS !== "web") {
    return children;
  }

  return <Animated.View style={[styles.screen, enterStyle("push", motion)]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});
