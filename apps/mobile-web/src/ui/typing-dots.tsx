import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { SPRING, useMotion } from "./motion";

const BOUNCE = {
  "0%": { transform: [{ translateY: 0 }, { scale: 1 }] },
  "30%": { transform: [{ translateY: -4 }, { scale: 1.15 }] },
  "60%": { transform: [{ translateY: 0 }, { scale: 1 }] },
  "100%": { transform: [{ translateY: 0 }, { scale: 1 }] },
};

const BLINK = {
  "0%": { opacity: 0.35 },
  "50%": { opacity: 1 },
  "100%": { opacity: 0.35 },
};

// "typing…": three dots hopping one after another (blinking with the
// system's Reduce motion, still with animations off).
export default function TypingDots({ color }: { color: string }) {
  const motion = useMotion();

  return (
    <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            { backgroundColor: color },
            motion !== "off" && {
              animationName: motion === "full" ? BOUNCE : BLINK,
              animationDuration: motion === "full" ? 900 : 1200,
              animationDelay: i * 150,
              animationIterationCount: "infinite",
              animationTimingFunction: motion === "full" ? SPRING : "ease-in-out",
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingTop: 3,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});
