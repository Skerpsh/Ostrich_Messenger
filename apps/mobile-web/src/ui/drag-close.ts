import { usePanGesture } from "react-native-gesture-handler";
import { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { ms, useMotion } from "./motion";

// A card dragged down far enough (or flicked) closes; let go before, it
// springs back. Up it only gives a little. gesture: for a GestureDetector
// around the card; style: for an Animated.View there.
export function useDragClose(close: () => void) {
  const motion = useMotion();
  const offset = useSharedValue(0);
  const spring = { duration: ms(400), dampingRatio: 0.8 };

  const gesture = usePanGesture({
    activeOffsetY: [-12, 12],
    failOffsetX: [-24, 24],
    onUpdate: (event) => {
      "worklet";
      offset.set(event.translationY > 0 ? event.translationY : event.translationY * 0.2);
    },
    onDeactivate: (event) => {
      "worklet";
      if (offset.get() > 100 || (offset.get() > 20 && event.velocityY > 800)) {
        scheduleOnRN(close);
        return;
      }

      offset.set(motion === "off" ? 0 : withSpring(0, spring));
    },
  });

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));

  return { gesture, style };
}
