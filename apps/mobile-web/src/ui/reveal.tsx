import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { away, LEAVE_MS, lookAt, settleMs, toward, useMotion, type Look } from "./motion";
import { useLatest } from "./use-latest";

// A view that comes in as it mounts, springing from the `kind`'s hidden
// look, and goes back to it while `leaving` (useLeave's), turning back
// smoothly if that changes halfway. leave: another look to go with (the
// call folding into its bar).
export function Appear({
  kind,
  leave,
  leaving = false,
  style,
  ...props
}: ComponentProps<typeof Animated.View> & { kind: Look; leave?: Look; leaving?: boolean }) {
  const animated = useAppear(kind, leaving, leave);

  return <Animated.View {...props} pointerEvents={leaving ? "none" : props.pointerEvents} style={[style, animated]} />;
}

// The same as a style, for an animated component of another kind (a
// pressable) that is there as long as the one calling this. again: comes
// in anew each time this changes (another tooltip in the same place).
export function useAppear(kind: Look, leaving = false, leave?: Look, again?: unknown) {
  const motion = useMotion();
  const progress = useSharedValue(motion === "off" ? 1 : 0);
  const look = leaving ? (leave ?? kind) : kind;
  const reduced = motion !== "full";

  useEffect(() => {
    if (leaving) {
      progress.set(away(0, motion));
      return;
    }

    if (again !== undefined && motion !== "off") {
      progress.set(0);
    }

    progress.set(toward(1, motion));
  }, [leaving, motion, progress, again]);

  return useAnimatedStyle(() => lookAt(look, progress.value, reduced));
}

// How a revealed thing looks while hidden: bars and panels rise a little
// (from the composer, under the header), things at the top come down,
// buttons and cards grow.
const REVEAL_LOOKS = { rise: "lift", drop: "lower", pop: "pop", fade: "fade" } satisfies Record<string, Look>;

export type RevealKind = keyof typeof REVEAL_LOOKS;

// Shows its child as it appears and keeps it, animating out, for a moment
// after it is gone: {error ? <Text>…</Text> : null} inside a Reveal comes
// and goes smoothly. collapse: it also grows from no height and shrinks
// back to none, moving what is around it smoothly (bars, panels, errors);
// without, it takes no part in the layout change (style places it).
// appear: animates in when it is there from the start too. enter: false
// for what animates itself in (only going is animated here).
export default function Reveal({
  children,
  kind = "rise",
  collapse = true,
  appear = false,
  enter = true,
  style,
}: {
  children: ReactNode;
  kind?: RevealKind;
  collapse?: boolean;
  appear?: boolean;
  enter?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const motion = useMotion();
  const shown = Boolean(children);
  // What is drawn: the child, or the last one while it goes.
  const [kept, setKept] = useState(children);
  const [mounted, setMounted] = useState(shown);
  const [was, setWas] = useState(shown);
  // 0 hidden, 1 shown (a little more as it overshoots).
  const progress = useSharedValue(shown && (!appear || !enter || motion === "off") ? 1 : 0);
  // The content's height, and whether the box follows it (while it grows
  // or shrinks; otherwise it takes the content's height as laid out).
  const height = useSharedValue(0);
  const [measured, setMeasured] = useState(false);
  const [moving, setMoving] = useState(collapse && shown && appear && enter && motion !== "off");
  const reduced = motion !== "full";
  const look = REVEAL_LOOKS[kind];

  // Following the child as it is rendered (React's way to adjust state to
  // new props; only this component renders again).
  if (shown && kept !== children) {
    setKept(children);
  }

  if (shown && !mounted) {
    setMounted(true);
  }

  if (shown !== was) {
    setWas(shown);

    if (collapse && motion !== "off" && (enter || !shown)) {
      setMoving(true);
    }
  }

  useEffect(() => {
    if (!shown) {
      progress.set(away(0, motion));
      const timer = setTimeout(() => setMounted(false), LEAVE_MS[motion]);
      return () => clearTimeout(timer);
    }

    if (!enter || motion === "off") {
      progress.set(1);
      return;
    }

    // A growing one waits to know how high it will be.
    if (collapse && !measured) {
      return;
    }

    progress.set(toward(1, motion));

    if (collapse) {
      const timer = setTimeout(() => setMoving(false), settleMs("enter", motion));
      return () => clearTimeout(timer);
    }
  }, [shown, motion, enter, collapse, measured, progress]);

  const content = useAnimatedStyle(() => lookAt(look, progress.value, reduced));
  const box = useAnimatedStyle(() => ({
    height: height.value * Math.min(1, Math.max(0, progress.value)),
  }));

  if (!mounted) {
    return null;
  }

  // On its way out it takes no presses.
  const pointerEvents = shown ? "box-none" : "none";

  if (!collapse) {
    return (
      <Animated.View pointerEvents={pointerEvents} style={[style, content]}>
        {shown ? children : kept}
      </Animated.View>
    );
  }

  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[style, moving && [styles.clip, styles.end, box]]}
    >
      <Animated.View
        onLayout={(event: LayoutChangeEvent) => {
          height.set(event.nativeEvent.layout.height);
          setMeasured(true);
        }}
        style={[styles.content, content]}
      >
        {shown ? children : kept}
      </Animated.View>
    </Animated.View>
  );
}

// An overlay (menu, sheet, viewer: {open ? <ActionMenu … /> : null}): it
// animates itself in as before, and goes on fading for a moment once it is gone, so
// that closing it from outside (an item chosen, which closes it at once)
// is not abrupt either. Covers the screen like the overlays do.
export function Overlay({ children }: { children: ReactNode }) {
  return (
    <Reveal kind="fade" collapse={false} enter={false} style={styles.overlay}>
      {children}
    </Reveal>
  );
}

// A message being deleted: it shrinks to nothing, fading (closing), and
// the ones around it close up; onClosed once it has.
export function Collapse({
  closing,
  onClosed,
  children,
}: {
  closing: boolean;
  onClosed: () => void;
  children: ReactNode;
}) {
  const motion = useMotion();
  const progress = useSharedValue(1);
  const height = useSharedValue(0);
  const closed = useLatest(onClosed);
  const reduced = motion !== "full";

  useEffect(() => {
    if (!closing) {
      return;
    }

    progress.set(away(0, motion));
    const timer = setTimeout(() => closed.current(), LEAVE_MS[motion]);
    return () => clearTimeout(timer);
  }, [closing, motion, progress, closed]);

  const content = useAnimatedStyle(() => lookAt("pop", progress.value, reduced));
  const box = useAnimatedStyle(() => ({ height: height.value * progress.value }));

  return (
    <Animated.View pointerEvents={closing ? "none" : "auto"} style={closing && [styles.clip, styles.end, box]}>
      <Animated.View
        onLayout={(event: LayoutChangeEvent) => {
          height.set(event.nativeEvent.layout.height);
        }}
        style={[styles.content, closing && content]}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}

// The selected one of a row of options: a highlight sliding to it.
// Each option reports where it is with onLayout(index); the highlight is
// drawn under them, at the selected one's place.
export function useSlider(selected: number) {
  const motion = useMotion();
  const [places, setPlaces] = useState<Record<number, { x: number; y: number; width: number; height: number }>>({});
  const place = places[selected];
  const x = useSharedValue<number | null>(null);
  const y = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({
    width: width.value,
    height: height.value,
    transform: [{ translateX: x.value ?? 0 }, { translateY: y.value }],
  }));

  useEffect(() => {
    if (!place) {
      return;
    }

    // The first place it is put at once, the next ones it slides to.
    const first = x.get() === null;
    x.set(first ? place.x : toward(place.x, motion, "move"));
    y.set(first ? place.y : toward(place.y, motion, "move"));
    width.set(first ? place.width : toward(place.width, motion, "move"));
    height.set(first ? place.height : toward(place.height, motion, "move"));
  }, [place, motion, x, y, width, height]);

  return {
    onLayout: (index: number) => (event: { nativeEvent: { layout: { x: number; y: number; width: number; height: number } } }) => {
      const { x, y, width, height } = event.nativeEvent.layout;
      setPlaces((current) => {
        const known = current[index];
        return known && known.x === x && known.y === y && known.width === width && known.height === height
          ? current
          : { ...current, [index]: { x, y, width, height } };
      });
    },
    // The highlight's style (an Animated.View, position absolute), or none
    // while the place is not known yet.
    style: place ? [styles.slider, animated] : null,
  };
}

// One of a Swap's things: it comes in from its side as it mounts (when it
// replaces another), and goes out to the other while going.
function SwapPane({
  going,
  shift,
  appear,
  fill,
  onLayout,
  children,
}: {
  going: boolean;
  shift: number;
  appear: boolean;
  fill: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  children: ReactNode;
}) {
  const motion = useMotion();
  const progress = useSharedValue(appear && motion !== "off" ? 0 : 1);
  const reduced = motion !== "full";
  const animated = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, progress.value)),
    transform: reduced ? [] : [{ translateX: (going ? -shift : shift) * (1 - progress.value) }],
  }));

  useEffect(() => {
    progress.set(going ? away(0, motion) : toward(1, motion, "move"));
  }, [going, motion, progress]);

  return (
    <Animated.View
      pointerEvents={going ? "none" : "auto"}
      onLayout={onLayout}
      style={[fill && styles.fill, going && [styles.going, fill && styles.bottom], animated]}
    >
      {children}
    </Animated.View>
  );
}

// Another thing in the same place (a tab, what loaded in place of the
// spinner): the one before goes as the new one comes, and the height
// follows. id: which one is shown; step: the way it went (-1 back to the
// left, 1 on to the right, 0 in place, fading). resize: the height
// animates (off for things of a fixed size); fill: it takes all the room
// (flex: 1), for what fills a screen.
export function Swap({
  id,
  step = 0,
  resize = true,
  fill = false,
  style,
  children,
}: {
  id: string | number;
  step?: number;
  resize?: boolean;
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const motion = useMotion();
  const [current, setCurrent] = useState({ id, children, step: 0 });
  const [previous, setPrevious] = useState<{
    id: string | number;
    children: ReactNode;
    height: number | null;
  } | null>(null);
  // The shown one's height as laid out.
  const [last, setLast] = useState<number | null>(null);
  const height = useSharedValue<number | null>(null);
  const sizing = resize && !fill && previous !== null && previous.height !== null && last !== null;
  const box = useAnimatedStyle(() => (height.value === null ? {} : { height: height.value }));

  // Following what it is given, as it renders (only this component renders
  // again).
  if (id !== current.id) {
    if (motion !== "off") {
      setPrevious({ id: current.id, children: current.children, height: last });
    }

    setCurrent({ id, children, step });
  } else if (children !== current.children) {
    setCurrent({ ...current, children });
  }

  // While swapping, the box springs from the old one's height to the new.
  useEffect(() => {
    if (!sizing || !previous || last === null) {
      height.set(null);
      return;
    }

    if (height.get() === null) {
      height.set(previous.height);
    }

    height.set(toward(last, motion, "move"));
  }, [sizing, previous, last, motion, height]);

  // The one going is kept until the height has settled too.
  useEffect(() => {
    if (!previous) {
      return;
    }

    const timer = setTimeout(
      () => setPrevious(null),
      Math.max(LEAVE_MS[motion], resize && !fill ? settleMs("move", motion) : 0),
    );
    return () => clearTimeout(timer);
  }, [previous, motion, resize, fill]);

  const shift = motion === "full" ? 40 * current.step : 0;

  return (
    <Animated.View style={[fill && styles.fill, style, sizing && [styles.clip, box]]}>
      {/* Same keys as before: the one going is the very view it was. */}
      {previous ? (
        <SwapPane key={previous.id} going shift={shift} appear={false} fill={fill}>
          {previous.children}
        </SwapPane>
      ) : null}
      <SwapPane
        key={current.id}
        going={false}
        shift={shift}
        appear={previous !== null}
        fill={fill}
        onLayout={resize && !fill ? (event) => setLast(event.nativeEvent.layout.height) : undefined}
      >
        {current.children}
      </SwapPane>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 10,
  },

  clip: {
    overflow: "hidden",
  },

  end: {
    justifyContent: "flex-end",
  },

  content: {
    flexShrink: 0,
  },

  slider: {
    position: "absolute",
    left: 0,
    top: 0,
  },

  fill: {
    flex: 1,
  },

  bottom: {
    bottom: 0,
  },

  going: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
});
