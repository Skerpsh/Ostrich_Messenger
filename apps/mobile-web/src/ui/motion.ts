import { useRef, useState } from "react";
import { Platform, type ViewStyle } from "react-native";
import {
  cubicBezier,
  Easing,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type CSSAnimationProperties,
} from "react-native-reanimated";
import { useAppTheme } from "./theme";
import { haptic } from "./haptics";

// The app's animations: real springs (they overshoot a little and settle,
// and turn back smoothly when interrupted), Reanimated's, so they run the
// same on iOS, Android and the web. With the system's "Reduce motion" they are short fades; turned off
// in Settings → Personalization there are none.

export type Motion = "full" | "reduced" | "off";

// Settings → Personalization's speed (ui/theme.tsx sets it before the app
// renders with it): every duration here goes through ms().
let speed = 1;

export function setMotionSpeed(value: number) {
  speed = value;
}

export const ms = (duration: number) => Math.round(duration / speed);

// A table of durations by Motion, scaled as it is read.
export function scaled(table: Record<Motion, number>): Record<Motion, number> {
  return {
    get full() {
      return ms(table.full);
    },
    get reduced() {
      return ms(table.reduced);
    },
    off: 0,
  };
}

export function useMotion(): Motion {
  const { animations } = useAppTheme();
  const reduced = useReducedMotion();

  return !animations ? "off" : reduced ? "reduced" : "full";
}

// Overshoots and settles, like a spring (for CSS transitions and loops).
export const SPRING = cubicBezier(0.34, 1.56, 0.64, 1);
// Fast at first, slowing down to stop.
export const EASE_OUT = cubicBezier(0.2, 0, 0, 1);
// Speeding up as it goes, for things leaving.
export const EASE_IN = cubicBezier(0.4, 0, 1, 1);

// Real springs (Reanimated's withSpring), by what they move: a spring
// picks up from wherever the thing is, so one interrupted halfway (a menu
// closed while it opens) turns back smoothly instead of jumping. Durations
// are perceptual, at 1× (a spring takes about half as long again to rest).
const SPRINGS = {
  // Coming in: overshoots a little and settles.
  enter: { duration: 440, dampingRatio: 0.7 },
  // Moving or resizing in place: hardly any overshoot.
  move: { duration: 400, dampingRatio: 0.86 },
  // Springing back from a press: bouncier.
  press: { duration: 340, dampingRatio: 0.5 },
};

export type Spring = keyof typeof SPRINGS;

// How long a spring takes to rest, for what waits for it.
export const settleMs = (spring: Spring, motion: Motion) =>
  motion === "off" ? 0 : motion === "reduced" ? ms(150) : ms(SPRINGS[spring].duration * 1.5);

// The animation that takes a shared value to `to`: a spring, a short fade
// with Reduce motion, at once with animations off (value.value = toward(…)).
export function toward(to: number, motion: Motion, spring: Spring = "enter") {
  if (motion === "off") {
    return to;
  }

  if (motion === "reduced") {
    return withTiming(to, { duration: ms(150), easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.Never });
  }

  return withSpring(to, {
    duration: ms(SPRINGS[spring].duration),
    dampingRatio: SPRINGS[spring].dampingRatio,
    reduceMotion: ReduceMotion.Never,
  });
}

// How long leaving takes, before the view is gone.
export const LEAVE_MS = scaled({ full: 200, reduced: 120, off: 0 });

// Leaving: no spring, it speeds up and is gone in LEAVE_MS.
export function away(to: number, motion: Motion) {
  return motion === "off"
    ? to
    : withTiming(to, { duration: LEAVE_MS[motion], easing: Easing.in(Easing.cubic), reduceMotion: ReduceMotion.Never });
}

// How each kind of thing looks hidden (progress 0); shown (1) it is as
// laid out. Between, it moves, grows and turns proportionally, so a
// spring's overshoot goes a little past its place and back.
const LOOKS = {
  // Dimmed backgrounds, things in place.
  fade: {},
  // Menus, dialogs, cards.
  pop: { scale: 0.85 },
  // A new message: rises from below, growing from its corner.
  bubble: { y: 24, scale: 0.8 },
  // Counters: grow from nothing.
  badge: { scale: 0 },
  // The composer's button changing (record, send, save).
  grow: { scale: 0, rotate: -90 },
  // A screen or bar sliding in from the right.
  push: { x: 48 },
  // A whole-screen sheet coming up from below (the call).
  rise: { y: 64 },
  // The call folding into its bar at the top, or coming back out of it.
  fold: { scale: 0.2 },
  // A bar coming down from the top (the minimized call).
  drop: { y: -24 },
  // Bars, panels and errors appearing in place (Reveal).
  lift: { y: 10 },
  lower: { y: -10 },
} satisfies Record<string, { x?: number; y?: number; scale?: number; rotate?: number }>;

export type Look = keyof typeof LOOKS;

// The style of a `kind` at `progress` (in useAnimatedStyle). Reduce
// motion: only the fade.
export function lookAt(kind: Look, progress: number, reduced: boolean) {
  "worklet";
  const hidden: { x?: number; y?: number; scale?: number; rotate?: number } = LOOKS[kind];
  // Most things are opaque well before they are in place.
  const opacity = Math.min(1, Math.max(0, kind === "fade" || reduced ? progress : progress * 2.5));

  if (reduced) {
    return { opacity };
  }

  const rest = 1 - progress;

  return {
    opacity,
    transform: [
      { translateX: (hidden.x ?? 0) * rest },
      { translateY: (hidden.y ?? 0) * rest },
      { scale: Math.max(0, 1 - (1 - (hidden.scale ?? 1)) * rest) },
      { rotate: `${(hidden.rotate ?? 0) * rest}deg` },
    ],
  };
}

// Pictures fade in as they load (expo-image's transition).
export const IMAGE_FADE_MS = scaled({ full: 200, reduced: 150, off: 0 });

// Leaving with an animation: leave(then) shows it, then calls then (the
// navigation, onClose). leaving: whether it is on its way out; stay()
// brings back what stays around to be shown again (the tooltip).
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

  const stay = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    setLeaving(false);
  };

  return { motion, leaving, leave, stay };
}

// Runs after the next frame is drawn, so that what changes then animates
// from how it was drawn (one frame is not enough on the web: the new look
// would be set before the old one was ever styled). Returns the cancel.
export function afterFrame(then: () => void) {
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(then);
  });

  return () => cancelAnimationFrame(frame);
}

// Pressing something: it shrinks a little at once and springs back when
// let go. pressed: for colors; style: the scale (an animated component's);
// handlers: onPressIn and onPressOut. active: false while it takes no
// presses.
export function usePressed(scale = 0.94, active = true) {
  const motion = useMotion();
  const [pressed, setPressed] = useState(false);
  const size = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: size.value }] }));

  return {
    pressed,
    style: motion === "full" ? style : null,
    handlers: {
      onPressIn: () => {
        setPressed(true);

        if (active && motion === "full") {
          size.set(withTiming(scale, { duration: ms(90), easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.Never }));
        }
      },
      onPressOut: () => {
        setPressed(false);
        size.set(toward(1, motion, "press"));
      },
    },
  };
}

// Rows of a list moving to their new places (a chat going to the top).
export const LIST_LAYOUT = LinearTransition.springify().dampingRatio(0.8).duration(420);

// How the phones' stacks move screens in.
export function useScreenAnimation() {
  const motion = useMotion();

  return motion === "off" ? "none" : motion === "reduced" ? "fade" : Platform.OS === "ios" ? "default" : "slide_from_right";
}

// A wrong password, ID or code: the field shakes its head. Two of them
// (to the left first, to the right first), taken in turn, so that each new
// error starts the animation over (the same one again would not).
const SHAKES = [1, -1].map((side) => ({
  animationName: {
    from: { transform: [{ translateX: 0 }] },
    "15%": { transform: [{ translateX: -10 * side }] },
    "30%": { transform: [{ translateX: 9 * side }] },
    "45%": { transform: [{ translateX: -7 * side }] },
    "60%": { transform: [{ translateX: 5 * side }] },
    "75%": { transform: [{ translateX: -3 * side }] },
    to: { transform: [{ translateX: 0 }] },
  },
  animationDuration: 460,
  animationTimingFunction: EASE_OUT,
})) satisfies CSSAnimationProperties<ViewStyle>[];

// Shaking: shake() starts it (on a failed try), style is for the
// Animated.View that shakes.
export function useShake() {
  const motion = useMotion();
  const [count, setCount] = useState(0);

  return {
    style:
      motion === "full" && count > 0
        ? { ...SHAKES[count % 2], animationDuration: ms(SHAKES[count % 2].animationDuration) }
        : null,
    shake: () => {
      haptic("wrong");
      setCount((current) => current + 1);
    },
  };
}
