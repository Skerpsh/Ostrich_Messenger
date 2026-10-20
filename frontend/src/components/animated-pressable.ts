import { Pressable } from "react-native";
import Animated from "react-native-reanimated";

// A Pressable that takes animation styles (lib/motion.ts).
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default AnimatedPressable;
