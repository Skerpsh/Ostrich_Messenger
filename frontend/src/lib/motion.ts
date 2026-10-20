import { useRef, useState } from "react";
import { Platform, type ViewStyle } from "react-native";
import {
  cubicBezier,
  LinearTransition,
  useReducedMotion,
  type CSSAnimationProperties,
  type CSSTransitionProperties,
} from "react-native-reanimated";
import { useAppTheme } from "@/context/theme";

// The app's animations: springy (they overshoot a little and settle), as
// Reanimated CSS animations, so they run the same on iOS, Android and the
// web. With the system's "Reduce motion" they are short fades; turned off
// in Settings → Personalization there are none.

export type Motion = "full" | "reduced" | "off";

export function useMotion(): Motion {
  const { animations } = useAppTheme();
  const reduced = useReducedMotion();

  return !animations ? "off" : reduced ? "reduced" : "full";
}

// Overshoots and settles, like a spring.
export const SPRING = cubicBezier(0.34, 1.56, 0.64, 1);
// Fast at first, slowing down to stop.
export const EASE_OUT = cubicBezier(0.2, 0, 0, 1);
// A screen sliding in: a slight overshoot only.
const SLIDE = cubicBezier(0.2, 0.9, 0.25, 1.05);

type Animation = CSSAnimationProperties<ViewStyle>;

const FADE: Animation = {
  animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
  animationDuration: 150,
  animationTimingFunction: EASE_OUT,
};

const ANIMATIONS = {
  // A new message: rises from below, growing from its corner.
  bubble: {
    animationName: {
      from: { opacity: 0, transform: [{ translateY: 24 }, { scale: 0.8 }] },
      "40%": { opacity: 1 },
      to: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
    },
    animationDuration: 420,
    animationTimingFunction: SPRING,
  },
  // Menus, dialogs, badges.
  pop: {
    animationName: {
      from: { opacity: 0, transform: [{ scale: 0.85 }] },
      "40%": { opacity: 1 },
      to: { opacity: 1, transform: [{ scale: 1 }] },
    },
    animationDuration: 360,
    animationTimingFunction: SPRING,
  },
  // Counters: grow from nothing, a little too far, and settle.
  badge: {
    animationName: {
      from: { transform: [{ scale: 0 }] },
      to: { transform: [{ scale: 1 }] },
    },
    animationDuration: 360,
    animationTimingFunction: SPRING,
  },
  // The composer's button changing (record, send, save).
  grow: {
    animationName: {
      from: { transform: [{ scale: 0 }, { rotate: "-90deg" }] },
      to: { transform: [{ scale: 1 }, { rotate: "0deg" }] },
    },
    animationDuration: 380,
    animationTimingFunction: SPRING,
  },
  // A screen opening (where the navigation does not animate it itself).
  push: {
    animationName: {
      from: { opacity: 0, transform: [{ translateX: 48 }] },
      "50%": { opacity: 1 },
      to: { opacity: 1, transform: [{ translateX: 0 }] },
    },
    animationDuration: 380,
    animationTimingFunction: SLIDE,
  },
  // Dimmed backgrounds.
  fade: { ...FADE, animationDuration: 200 },
} satisfies Record<string, Animation>;

export type Enter = keyof typeof ANIMATIONS;

// Speeding up as it goes, for things leaving.
const EASE_IN = cubicBezier(0.4, 0, 1, 1);

// How long leaving takes, before the view is gone.
export const LEAVE_MS = { full: 200, reduced: 120, off: 0 } satisfies Record<Motion, number>;

const LEAVING = {
  // A screen closing: back to the right, fading.
  push: {
    animationName: {
      from: { opacity: 1, transform: [{ translateX: 0 }] },
      to: { opacity: 0, transform: [{ translateX: 48 }] },
    },
  },
  // Menus and dialogs: shrinking a little, fading.
  pop: {
    animationName: {
      from: { opacity: 1, transform: [{ scale: 1 }] },
      to: { opacity: 0, transform: [{ scale: 0.92 }] },
    },
  },
  fade: { animationName: { from: { opacity: 1 }, to: { opacity: 0 } } },
} satisfies Record<string, Animation>;

// The style that animates a view out before it goes (see useLeave).
export function leaveStyle(kind: keyof typeof LEAVING, motion: Motion): Animation | null {
  if (motion === "off") {
    return null;
  }

  return {
    ...(motion === "reduced" ? LEAVING.fade : LEAVING[kind]),
    animationDuration: LEAVE_MS[motion],
    animationTimingFunction: EASE_IN,
    animationFillMode: "forwards",
  };
}

// Leaving with an animation: leave(then) shows it, then calls then (the
// navigation, onClose). leaving: whether it is on its way out.
export function useLeave() {
  const motion = useMotion();
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const leave = (then: () => void) => {
    if (motion === "off") {
      then();
      return;
    }

    if (timer.current) {
      return;
    }

    setLeaving(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      then();
    }, LEAVE_MS[motion]);
  };

  return { motion, leaving, leave };
}

// The style that animates a view in as it appears (Animated.View).
export function enterStyle(kind: Enter, motion: Motion): Animation | null {
  if (motion === "off") {
    return null;
  }

  return motion === "reduced" ? FADE : ANIMATIONS[kind];
}

// Pressing a button: it shrinks a little and springs back.
export function pressStyle(
  pressed: boolean,
  motion: Motion,
  scale = 0.94,
): CSSTransitionProperties<ViewStyle> & Pick<ViewStyle, "transform"> {
  if (motion !== "full") {
    return {};
  }

  return {
    transform: [{ scale: pressed ? scale : 1 }],
    transitionProperty: "transform",
    transitionDuration: pressed ? 90 : 320,
    transitionTimingFunction: pressed ? EASE_OUT : SPRING,
  };
}

// Pressed state for pressStyle (Pressable's own is only given to its style
// function, which animated components do not take).
export function usePressed() {
  const [pressed, setPressed] = useState(false);

  return {
    pressed,
    handlers: {
      onPressIn: () => setPressed(true),
      onPressOut: () => setPressed(false),
    },
  };
}

// Rows of a list moving to their new places (a chat going to the top).
export const LIST_LAYOUT = LinearTransition.springify().damping(18).stiffness(200);

// How the phones' stacks move screens in.
export function useScreenAnimation() {
  const motion = useMotion();

  return motion === "off" ? "none" : motion === "reduced" ? "fade" : Platform.OS === "ios" ? "default" : "slide_from_right";
}
