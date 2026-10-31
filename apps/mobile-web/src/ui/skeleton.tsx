import { useEffect } from "react";
import { StyleSheet, View, type DimensionValue } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { radius } from "./colors";
import { useMotion } from "./motion";
import { useAppTheme } from "./theme";

// What is loading, drawn as grey shapes where it will be, breathing
// slowly (standing still with animations off), in place of a spinner.
function useBreathing() {
  const motion = useMotion();
  const level = useSharedValue(1);

  useEffect(() => {
    if (motion === "off") {
      level.set(1);
      return;
    }

    level.set(1);
    level.set(
      withRepeat(
        withTiming(0.45, { duration: 900, easing: Easing.inOut(Easing.quad), reduceMotion: ReduceMotion.Never }),
        -1,
        true,
      ),
    );
  }, [motion, level]);

  return useAnimatedStyle(() => ({ opacity: level.value }));
}

function Block({ width, height, round, color }: { width: DimensionValue; height: number; round?: number; color?: string }) {
  const { colors } = useAppTheme();

  return <View style={{ width, height, borderRadius: round ?? height / 2, backgroundColor: color ?? colors.panelAlt }} />;
}

// The chats list: rows of an avatar and two lines.
export function ChatsSkeleton({ avatar = 48 }: { avatar?: number }) {
  const breathing = useBreathing();

  return (
    <Animated.View style={breathing} accessibilityLabel="Loading chats">
      {[0.62, 0.48, 0.7, 0.55, 0.4].map((width, i) => (
        <View key={i} style={styles.row}>
          <Block width={avatar} height={avatar} />
          <View style={styles.lines}>
            <Block width={`${width * 60}%`} height={12} />
            <Block width={`${width * 100}%`} height={10} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

// A chat's messages: bubbles from both sides, the newest at the bottom.
export function MessagesSkeleton() {
  const { colors } = useAppTheme();
  const breathing = useBreathing();

  return (
    <Animated.View style={[styles.messages, breathing]} accessibilityLabel="Loading messages">
      {[
        [false, 180, 40],
        [false, 120, 40],
        [true, 210, 58],
        [false, 150, 40],
        [true, 110, 40],
        [true, 190, 40],
      ].map(([own, width, height], i) => (
        <View key={i} style={own ? styles.own : styles.other}>
          {/* In the bubbles' colors, to show over the wallpaper. */}
          <Block
            width={width as number}
            height={height as number}
            round={radius.bubble}
            color={own ? colors.accentSoft : colors.panel}
          />
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },

  lines: {
    flex: 1,
    gap: 8,
  },

  messages: {
    flex: 1,
    justifyContent: "flex-end",
    gap: 8,
    padding: 12,
  },

  own: {
    alignItems: "flex-end",
  },

  other: {
    alignItems: "flex-start",
  },
});
