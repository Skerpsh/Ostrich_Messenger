import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type ViewInstance } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "./theme";
import { useEscape } from "./keys";
import { useLeave } from "./motion";
import { radius } from "./colors";
import { useAppear } from "./reveal";

// Short explanations in a bubble next to what they explain (the DEV
// badge): shown while the mouse is over it, or on a tap until the next
// tap anywhere, Esc or a scroll. One bubble for the whole app, drawn over
// everything, so that lists and cards do not cut it off.

type Tip = { title: string; text: string };
type Rect = { x: number; y: number; width: number; height: number };
type Shown = Tip & { anchor: Rect; pinned: boolean; key: number };

type TooltipValue = {
  show: (anchor: ViewInstance | null, tip: Tip, pinned: boolean) => void;
  // Hides it; a tapped (pinned) one stays unless pinned is true too.
  hide: (pinned?: boolean) => void;
};

const TooltipContext = createContext<TooltipValue | null>(null);

const MAX_WIDTH = 260;
const MARGIN = 8;
const GAP = 8;

export function TooltipProvider({ children }: { children: ReactNode }) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { leaving, leave, stay } = useLeave();
  const [shown, setShown] = useState<Shown | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [screen, setScreen] = useState<{ width: number; height: number } | null>(null);
  const count = useRef(0);
  // What is shown, for the badges' handlers (which may hold an older render).
  const current = useRef(shown);

  useEffect(() => {
    current.current = shown;
  });

  const close = () => leave(() => setShown(null));

  const value: TooltipValue = {
    show: (anchor, tip, pinned) =>
      anchor?.measureInWindow((x, y, width, height) => {
        // A second tap on the same badge closes it.
        const open = current.current;

        if (pinned && open?.pinned && open.title === tip.title && open.anchor.x === x && open.anchor.y === y) {
          close();
          return;
        }

        count.current += 1;
        stay();
        setSize(null);
        setShown({ ...tip, anchor: { x, y, width, height }, pinned, key: count.current });
      }),
    hide: (pinned = false) => {
      const open = current.current;

      if (open && (pinned || !open.pinned)) {
        close();
      }
    },
  };

  // Esc, and on the web a scroll (the badge moves away from it).
  useEscape(Boolean(shown), close);

  useEffect(() => {
    if (!shown || Platform.OS !== "web") {
      return;
    }

    const onScroll = () => setShown(null);
    window.addEventListener("wheel", onScroll, { capture: true, passive: true });
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });

    return () => {
      window.removeEventListener("wheel", onScroll, { capture: true });
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [shown]);

  // Above the badge, or below it when there is no room; within the screen.
  let place: { left: number; top: number; below: boolean; arrow: number } | null = null;

  if (shown && size && screen) {
    const { anchor } = shown;
    const center = anchor.x + anchor.width / 2;
    const left = Math.max(MARGIN, Math.min(screen.width - size.width - MARGIN, center - size.width / 2));
    const below = anchor.y - GAP - size.height < insets.top + MARGIN;

    place = {
      left,
      top: below ? anchor.y + anchor.height + GAP : anchor.y - GAP - size.height,
      below,
      arrow: Math.max(12, Math.min(size.width - 12, center - left)),
    };
  }

  // Each one grows out of its badge once it is placed.
  const popStyle = useAppear("pop", leaving, undefined, place ? shown?.key : null);

  return (
    <TooltipContext value={value}>
      <View style={styles.fill} onLayout={(event) => setScreen(event.nativeEvent.layout)}>
        {children}

        {shown?.pinned ? (
          // A tap anywhere else closes a tapped one.
          <Pressable style={styles.catcher} onPress={close} accessibilityLabel="Close the explanation" />
        ) : null}

        {shown ? (
          <Animated.View
            key={shown.key}
            pointerEvents="none"
            onLayout={(event) => setSize(event.nativeEvent.layout)}
            style={[
              styles.bubble,
              {
                backgroundColor: colors.panel,
                borderColor: colors.line,
                boxShadow: `0 6px 20px ${colors.shadow}`,
              },
              place
                ? {
                    left: place.left,
                    top: place.top,
                    // Grows out of the badge.
                    transformOrigin: `${place.arrow}px ${place.below ? "0%" : "100%"}`,
                  }
                : styles.measuring,
              place && popStyle,
            ]}
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
          >
            {place ? (
              <View
                style={[
                  styles.arrow,
                  { backgroundColor: colors.panel, borderColor: colors.line, left: place.arrow - 5 },
                  place.below ? styles.arrowUp : styles.arrowDown,
                ]}
              />
            ) : null}
            <Text style={[styles.title, { color: colors.text }]}>{shown.title}</Text>
            <Text style={[styles.text, { color: colors.textSoft }]}>{shown.text}</Text>
          </Animated.View>
        ) : null}
      </View>
    </TooltipContext>
  );
}

export function useTooltip() {
  const context = useContext(TooltipContext);

  if (!context) {
    throw new Error("useTooltip must be used inside TooltipProvider");
  }

  return context;
}

// What explains itself: the mouse over it shows the bubble (after a
// moment, so that passing over does not), a tap shows it until the next.
export function WithTooltip({ title, text, children }: Tip & { children: ReactNode }) {
  const { show, hide } = useTooltip();
  const ref = useRef<ViewInstance>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => cancel, []);

  return (
    <Pressable
      ref={ref}
      onHoverIn={() => {
        cancel();
        timer.current = setTimeout(() => show(ref.current, { title, text }, false), 250);
      }}
      onHoverOut={() => {
        cancel();
        hide();
      }}
      onPress={() => {
        cancel();
        show(ref.current, { title, text }, true);
      }}
      hitSlop={6}
      // Not a <button> on the web: it is inside rows that are buttons.
      accessibilityRole={Platform.OS === "web" ? undefined : "button"}
      accessibilityLabel={title}
      accessibilityHint="Shows what it means"
      style={styles.anchor}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },

  catcher: {
    ...StyleSheet.absoluteFill,
    zIndex: 99,
  },

  bubble: {
    position: "absolute",
    zIndex: 100,
    maxWidth: MAX_WIDTH,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },

  // Drawn out of sight once, to know its size.
  measuring: {
    left: 0,
    top: -1000,
    opacity: 0,
  },

  arrow: {
    position: "absolute",
    width: 10,
    height: 10,
    transform: [{ rotate: "45deg" }],
  },

  arrowDown: {
    bottom: -5,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  arrowUp: {
    top: -5,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
  },

  title: {
    fontSize: 14,
    fontWeight: "700",
  },

  text: {
    fontSize: 13,
    lineHeight: 18,
  },

  anchor: {
    alignSelf: "center",
    flexShrink: 0,
  },
});
