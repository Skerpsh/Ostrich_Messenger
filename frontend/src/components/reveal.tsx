import { useEffect, useRef, useState, type ReactNode } from "react";
import { type StyleProp, type View, type ViewStyle } from "react-native";
import Animated, { type CSSTransitionProperties } from "react-native-reanimated";
import { afterFrame, EASE_IN, EASE_OUT, LEAVE_MS, SPRING, useMotion, type Motion } from "@/lib/motion";

// How a revealed thing looks while hidden.
const HIDDEN = {
  // Bars and panels: rising a little (from the composer, under the header).
  rise: [{ translateY: 10 }],
  // Things at the top: coming down a little.
  drop: [{ translateY: -10 }],
  // Buttons, cards: growing.
  pop: [{ scale: 0.85 }],
  fade: [],
} satisfies Record<string, ViewStyle["transform"]>;

export type RevealKind = keyof typeof HIDDEN;

const ENTER_MS = { full: 300, reduced: 150, off: 0 } satisfies Record<Motion, number>;

function transition(
  motion: Motion,
  open: boolean,
  properties: (keyof ViewStyle)[],
): CSSTransitionProperties<ViewStyle> {
  if (motion === "off") {
    return {};
  }

  return {
    // Reduced motion: no growing or moving, only the fade.
    transitionProperty: motion === "reduced" ? "opacity" : properties,
    transitionDuration: open ? ENTER_MS[motion] : LEAVE_MS[motion],
    transitionTimingFunction: open ? EASE_OUT : EASE_IN,
  };
}

// Shows its child as it appears and keeps it, animating out, for a moment
// after it is gone: {error ? <Text>…</Text> : null} inside a Reveal comes
// and goes smoothly. collapse: it also grows from no height and shrinks
// back to none, moving what is around it smoothly (bars, panels, errors);
// without, it takes no part in the layout change (style places it).
// appear: animates in when it is there from the start too.
export default function Reveal({
  children,
  kind = "rise",
  collapse = true,
  appear = false,
  style,
}: {
  children: ReactNode;
  kind?: RevealKind;
  collapse?: boolean;
  appear?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const motion = useMotion();
  const shown = Boolean(children);
  // What is drawn: the child, or the last one while it goes.
  const [kept, setKept] = useState(children);
  const [mounted, setMounted] = useState(shown);
  const [open, setOpen] = useState(shown && (!appear || motion === "off"));
  const [height, setHeight] = useState<number | null>(null);
  const measured = height !== null;

  // Following the child as it is rendered (React's way to adjust state to
  // new props; only this component renders again).
  if (shown && kept !== children) {
    setKept(children);
  }

  if (shown && !mounted) {
    setMounted(true);
  }

  if (!shown && open) {
    setOpen(false);
  }

  if (motion === "off" && shown && !open) {
    setOpen(true);
  }

  if (motion === "off" && !shown && mounted) {
    setMounted(false);
  }

  useEffect(() => {
    if (motion === "off") {
      return;
    }

    if (!shown) {
      const timer = setTimeout(() => setMounted(false), LEAVE_MS[motion]);
      return () => clearTimeout(timer);
    }

    // Opens after a frame, from the hidden look it was drawn with (a
    // collapsing one once it knows its height, see onLayout).
    if (!open && (!collapse || measured)) {
      return afterFrame(() => setOpen(true));
    }
  }, [shown, open, measured, motion, collapse]);

  if (!mounted) {
    return null;
  }

  const content = {
    opacity: open ? 1 : 0,
    transform: open ? [] : HIDDEN[kind],
    ...transition(motion, open, ["opacity", "transform"]),
  };

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
      style={[
        style,
        { overflow: "hidden", justifyContent: "flex-end" },
        // Not known yet: its own height (it is open, there from the start).
        height === null ? (open ? null : { height: 0 }) : { height: open ? height : 0 },
        transition(motion, open, ["height"]),
      ]}
    >
      <Animated.View
        onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
        style={[{ flexShrink: 0 }, content]}
      >
        {shown ? children : kept}
      </Animated.View>
    </Animated.View>
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
  const ref = useRef<View>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [shut, setShut] = useState(false);

  const closed = useRef(onClosed);

  useEffect(() => {
    closed.current = onClosed;
  });

  useEffect(() => {
    if (!closing) {
      return;
    }

    if (motion === "off") {
      closed.current();
      return;
    }

    let cancel = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Measuring takes a moment on the web: the time counts from the start
    // of the animation.
    ref.current?.measure((_x, _y, _width, measured) => {
      setHeight(measured);
      cancel = afterFrame(() => {
        setShut(true);
        timer = setTimeout(() => closed.current(), LEAVE_MS[motion]);
      });
    });

    return () => {
      cancel();
      clearTimeout(timer);
    };
  }, [closing, motion]);

  return (
    <Animated.View
      ref={ref}
      pointerEvents={closing ? "none" : "auto"}
      style={
        closing && height !== null
          ? {
              overflow: "hidden",
              height: shut ? 0 : height,
              opacity: shut ? 0 : 1,
              transform: [{ scale: shut && motion === "full" ? 0.9 : 1 }],
              ...transition(motion, false, ["height", "opacity", "transform"]),
            }
          : null
      }
    >
      {children}
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
  const style:
    | (CSSTransitionProperties<ViewStyle> & Pick<ViewStyle, "position" | "left" | "top" | "width" | "height">)
    | null = place
    ? {
        position: "absolute",
        left: place.x,
        top: place.y,
        width: place.width,
        height: place.height,
        ...(motion === "full"
          ? {
              transitionProperty: ["left", "top", "width"],
              transitionDuration: 380,
              transitionTimingFunction: SPRING,
            }
          : {}),
      }
    : null;

  return {
    onLayout: (index: number) => (event: { nativeEvent: { layout: { x: number; y: number; width: number; height: number } } }) => {
      const { x, y, width, height } = event.nativeEvent.layout;
      setPlaces((current) => ({ ...current, [index]: { x, y, width, height } }));
    },
    // The highlight's style (an Animated.View, position absolute), or none
    // while the place is not known yet.
    style,
  };
}
