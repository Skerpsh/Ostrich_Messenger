import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { ActivityIndicator, Platform, StyleSheet, Text, View, type ViewStyle, type ViewInstance } from "react-native";
import { GestureDetector, useExclusiveGestures, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from "react-native-gesture-handler";
import Animated, {
  cubicBezier,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type CSSAnimationProperties,
  type CSSTransitionProperties,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Swap } from "@/ui/reveal";
import { useAuth } from "@/features/auth/auth";
import { loadAttachment } from "./attachments";
import { imageSource, saveFile } from "@/platform/files";
import { useEscape } from "@/ui/keys";
import { afterFrame, EASE_IN, EASE_OUT, LEAVE_MS, ms, useMotion } from "@/ui/motion";
import type { Attachment } from "./payload";
import PressScale from "@/ui/press-scale";
import { haptic } from "@/ui/haptics";

// Where each photo is in the chat (its thumbnail, while on the screen),
// for the viewer to open out of it and close back into it.
const places = new Map<string, { view: RefObject<ViewInstance | null>; uri: string | null }>();

export function usePhotoPlace(attachment: Attachment, uri: string | null) {
  const view = useRef<ViewInstance>(null);

  useEffect(() => {
    places.set(attachment.id, { view, uri });

    return () => {
      if (places.get(attachment.id)?.view === view) {
        places.delete(attachment.id);
      }
    };
  }, [attachment.id, uri]);

  return view;
}

type Rect = { x: number; y: number; width: number; height: number };

const measure = (view: ViewInstance | null | undefined) =>
  new Promise<Rect | null>((resolve) => {
    if (!view) {
      resolve(null);
      return;
    }

    view.measureInWindow((x, y, width, height) => resolve(width > 0 ? { x, y, width, height } : null));
  });

// The web's views are elements: measured at once, without waiting a frame.
function measureNow(view: ViewInstance | null | undefined): Rect | null {
  const rect = (view as unknown as HTMLElement | null | undefined)?.getBoundingClientRect();

  return rect && rect.width > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
}

// The transform that puts the photo, shown whole on the stage, onto its
// thumbnail (same proportions); none for a thumbnail scrolled out of sight.
function onto(stage: Rect, thumb: Rect | null, photo: Attachment) {
  const inSight =
    thumb &&
    thumb.y + thumb.height > stage.y &&
    thumb.y < stage.y + stage.height &&
    thumb.x + thumb.width > stage.x &&
    thumb.x < stage.x + stage.width;

  if (!inSight) {
    return null;
  }

  const ratio = photo.width && photo.height ? photo.width / photo.height : thumb.width / thumb.height;
  const width = ratio > stage.width / stage.height ? stage.width : stage.height * ratio;

  return [
    { translateX: thumb.x + thumb.width / 2 - (stage.x + stage.width / 2) },
    { translateY: thumb.y + thumb.height / 2 - (stage.y + stage.height / 2) },
    { scale: thumb.width / width },
  ];
}

const OPEN_MS = 320;
const CLOSE_MS = 240;
const FLY = cubicBezier(0.2, 0.9, 0.3, 1);

// A photo coming in from the side it was gone to (and the one before it
// leaving to the other).
const slide = (from: number, leaving: boolean): CSSAnimationProperties<ViewStyle> => ({
  animationName: leaving
    ? { from: { opacity: 1, transform: [{ translateX: 0 }] }, to: { opacity: 0, transform: [{ translateX: -from }] } }
    : { from: { opacity: 0, transform: [{ translateX: from }] }, to: { opacity: 1, transform: [{ translateX: 0 }] } },
  animationDuration: leaving ? LEAVE_MS.full : ms(OPEN_MS),
  animationTimingFunction: leaving ? EASE_IN : FLY,
  animationFillMode: "forwards",
});

// The chat's photos on the whole screen, one at a time: it opens out of the
// photo tapped and closes back into it; arrows (and the keyboard's) go
// through them, sliding; Save downloads the one shown.
export default function PhotoViewer({
  photos,
  start,
  onClose,
  onError,
}: {
  photos: Attachment[];
  start: number;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { withToken } = useAuth();
  const motion = useMotion();
  const [index, setIndex] = useState(start);
  const [shown, setShown] = useState<{ id: string; uri: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const photo = photos[index];
  const stageRef = useRef<ViewInstance>(null);
  // Opened (or on its way to being), and where from / back to.
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<ViewStyle["transform"] | null>(null);
  const [closing, setClosing] = useState(false);
  // Going through the photos: the one before, sliding away, and which way.
  const [previous, setPrevious] = useState<{ photo: Attachment; uri: string | null; step: number } | null>(null);

  const placeholder = places.get(photo?.id ?? "")?.uri ?? null;
  const uri = shown?.id === photo?.id ? shown.uri : placeholder;

  const go = (step: number) => {
    const next = Math.max(0, Math.min(photos.length - 1, index + step));

    if (next === index) {
      return;
    }

    if (motion === "full") {
      setPrevious({ photo, uri, step });
    }

    setIndex(next);
  };

  useEffect(() => {
    if (!previous) {
      return;
    }

    const timer = setTimeout(() => setPrevious(null), LEAVE_MS.full);
    return () => clearTimeout(timer);
  }, [previous]);

  // Opening: drawn on the thumbnail first, then grown to the screen. The
  // web measures before the first frame is drawn (no wait); the phones
  // once laid out (onStageLayout).
  useLayoutEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }

    const stage = measureNow(stageRef.current);
    const start = photos[index];

    if (motion === "full" && stage && start) {
      setFrom(onto(stage, measureNow(places.get(start.id)?.view.current), start));
    }

    return afterFrame(() => setOpen(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onStageLayout = async () => {
    if (Platform.OS === "web" || open || closing) {
      return;
    }

    if (motion === "full") {
      const stage = await measure(stageRef.current);
      const thumb = await measure(places.get(photo?.id ?? "")?.view.current);
      setFrom(stage && photo ? onto(stage, thumb, photo) : null);
    }

    afterFrame(() => setOpen(true));
  };

  // Closing: back into the thumbnail of the photo shown, if it is on the
  // screen (else shrinking a little, fading).
  const close = async () => {
    if (closing) {
      return;
    }

    if (motion === "off") {
      onClose();
      return;
    }

    if (motion === "full") {
      const stage = await measure(stageRef.current);
      const thumb = await measure(places.get(photo?.id ?? "")?.view.current);
      setFrom(stage && photo ? onto(stage, thumb, photo) : null);
    }

    setClosing(true);
    setOpen(false);
    setTimeout(onClose, ms(CLOSE_MS));
  };

  useEffect(() => {
    if (!photo) {
      return;
    }

    let current = true;
    let loaded: string | null = null;

    withToken((token) => loadAttachment(token, photo)).then(
      (bytes) => {
        if (current) {
          loaded = imageSource(bytes, photo.mime);
          setShown({ id: photo.id, uri: loaded });
        }
      },
      (e) => current && onError(e instanceof Error ? e.message : "Failed to load the photo"),
    );

    return () => {
      current = false;

      // Web: release the picture's memory (once it has slid away).
      if (loaded?.startsWith("blob:")) {
        const done = loaded;
        setTimeout(() => URL.revokeObjectURL(done), 1000);
      }
    };
  }, [photo, withToken, onError]);

  // Web: Esc closes it (ui/keys.ts), ← → go through.
  useEscape(true, close);

  useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        go(-1);
      } else if (event.key === "ArrowRight") {
        go(1);
      } else {
        return;
      }

      event.preventDefault();
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const save = async () => {
    setSaving(true);

    try {
      const bytes = await withToken((token) => loadAttachment(token, photo));
      await saveFile(bytes, photo.name, photo.mime);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save the photo");
    } finally {
      setSaving(false);
    }
  };

  // Dragging and zooming: dragged down (or up) far enough it closes, to
  // the side it goes to the next one, following the finger and springing
  // back otherwise; pinched or tapped twice it zooms, and zoomed it is
  // moved around. A tap closes it.
  const zoom = useSharedValue(1);
  const zoomFrom = useSharedValue(1);
  const shiftX = useSharedValue(0);
  const shiftY = useSharedValue(0);
  const shiftFrom = useSharedValue({ x: 0, y: 0 });
  const size = useSharedValue({ width: 0, height: 0 });
  // Two fingers on it: no closing nor going to another one then.
  const pinching = useSharedValue(false);
  const first = index === 0;
  const last = index === photos.length - 1;
  const spring = motion === "full" ? { duration: ms(400), dampingRatio: 0.86 } : { duration: ms(150), dampingRatio: 1 };
  const springBack = (value: { set: (to: number) => void }, to: number) => {
    "worklet";
    value.set(motion === "off" ? to : withSpring(to, spring));
  };
  // How far a zoomed photo can be moved: to its edges.
  const bound = (value: number, length: number) => {
    "worklet";
    const room = (length * (zoom.get() - 1)) / 2;
    return Math.max(-room, Math.min(room, value));
  };

  const pan = usePanGesture({
    minDistance: 8,
    onActivate: () => {
      "worklet";
      shiftFrom.set({ x: shiftX.get(), y: shiftY.get() });
    },
    onUpdate: (event) => {
      "worklet";
      if (pinching.get()) {
        return;
      }

      if (zoom.get() > 1) {
        shiftX.set(shiftFrom.get().x + event.translationX);
        shiftY.set(shiftFrom.get().y + event.translationY);
      } else if (Math.abs(event.translationX) > Math.abs(event.translationY)) {
        // Past the first or the last it only gives a little.
        const edge = (event.translationX > 0 && first) || (event.translationX < 0 && last);
        shiftX.set(edge ? event.translationX * 0.3 : event.translationX);
        shiftY.set(0);
      } else {
        shiftX.set(0);
        shiftY.set(event.translationY);
      }
    },
    onDeactivate: (event) => {
      "worklet";
      if (zoom.get() > 1 || pinching.get()) {
        springBack(shiftX, bound(shiftX.get(), size.get().width));
        springBack(shiftY, bound(shiftY.get(), size.get().height));
        return;
      }

      const x = shiftX.get();
      const y = shiftY.get();

      if (Math.abs(y) > 120 || (Math.abs(y) > 30 && Math.abs(event.velocityY) > 900)) {
        scheduleOnRN(close);
      } else if ((x < -80 || (x < -20 && event.velocityX < -700)) && !last) {
        springBack(shiftX, 0);
        scheduleOnRN(go, 1);
        return;
      } else if ((x > 80 || (x > 20 && event.velocityX > 700)) && !first) {
        springBack(shiftX, 0);
        scheduleOnRN(go, -1);
        return;
      }

      springBack(shiftX, 0);
      springBack(shiftY, 0);
    },
  });

  const pinch = usePinchGesture({
    onActivate: () => {
      "worklet";
      pinching.set(true);
      zoomFrom.set(zoom.get());
    },
    onUpdate: (event) => {
      "worklet";
      zoom.set(Math.max(0.8, Math.min(5, zoomFrom.get() * event.scale)));
    },
    onDeactivate: () => {
      "worklet";
      const to = Math.max(1, Math.min(4, zoom.get()));
      pinching.set(false);
      springBack(zoom, to);

      if (to === 1) {
        springBack(shiftX, 0);
        springBack(shiftY, 0);
      }
    },
  });

  // Tapped twice: zoomed in where tapped, or back out.
  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onDeactivate: (event) => {
      "worklet";
      if (event.canceled) {
        return;
      }

      const zoomed = zoom.get() > 1;
      const to = zoomed ? 1 : 2.5;
      const { width, height } = size.get();
      springBack(zoom, to);
      springBack(shiftX, zoomed ? 0 : (width / 2 - event.x) * (to - 1));
      springBack(shiftY, zoomed ? 0 : (height / 2 - event.y) * (to - 1));
      scheduleOnRN(haptic, "tick");
    },
  });

  const tap = useTapGesture({
    onDeactivate: (event) => {
      "worklet";
      if (!event.canceled) {
        scheduleOnRN(close);
      }
    },
  });

  const gestures = useSimultaneousGestures(pan, pinch, useExclusiveGestures(doubleTap, tap));

  // The photo follows the finger, shrinking a little as it is dragged
  // away; the background clears as it goes.
  const dragged = useAnimatedStyle(() => ({
    transform: [
      { translateX: shiftX.get() },
      { translateY: shiftY.get() },
      { scale: zoom.get() * (1 - Math.min(0.25, Math.abs(shiftY.get()) / 1600)) },
    ],
  }));
  const clearing = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(0.8, Math.abs(shiftY.get()) / 400),
  }));

  // Another photo is shown whole.
  useEffect(() => {
    if (zoom.get() !== 1) {
      shiftX.set(0);
    }

    zoom.set(1);
    shiftY.set(0);
  }, [index, zoom, shiftX, shiftY]);

  if (!photo) {
    return null;
  }

  const timing = (properties: (keyof ViewStyle)[]): CSSTransitionProperties<ViewStyle> =>
    motion === "off"
      ? {}
      : {
          transitionProperty: motion === "full" ? properties : "opacity",
          transitionDuration: ms(open ? OPEN_MS : CLOSE_MS),
          transitionTimingFunction: open ? FLY : EASE_OUT,
        };
  // The backdrop, the bars and the arrows fade in and out.
  const chrome = { opacity: open ? 1 : 0, ...timing(["opacity"]) };
  // The photo: from (back to) its thumbnail, or growing a little.
  const flight = {
    opacity: open || from ? 1 : 0,
    transform: open ? [] : (from ?? [{ scale: 0.9 }]),
    ...timing(["transform", "opacity"]),
  };

  const frame = (item: Attachment, source: string | null, style: CSSAnimationProperties<ViewStyle> | null) => (
    <Animated.View key={item.id} style={[StyleSheet.absoluteFill, styles.frame, style]}>
      {source ? (
        <Image source={{ uri: source }} style={styles.image} contentFit="contain" accessibilityLabel={item.name} />
      ) : (
        <ActivityIndicator color="#ffffff" />
      )}
    </Animated.View>
  );

  return (
    <View pointerEvents={closing ? "none" : "auto"} style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Animated.View style={[StyleSheet.absoluteFill, clearing]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, chrome]} />
      </Animated.View>

      <Animated.View style={[styles.bar, chrome]}>
        <Text style={styles.counter}>
          {index + 1} / {photos.length}
        </Text>
        <View style={styles.actions}>
          <PressScale scale={0.9} onPress={save} disabled={saving} accessibilityRole="button" accessibilityLabel="Save the photo" style={styles.button}>
            <Swap id={saving ? "saving" : "save"} resize={false}>
              {saving ? <ActivityIndicator color="#ffffff" /> : <Ionicons name="download-outline" size={24} color="#ffffff" />}
            </Swap>
          </PressScale>
          <PressScale scale={0.88} onPress={close} accessibilityRole="button" accessibilityLabel="Close" style={styles.button}>
            <Ionicons name="close" size={26} color="#ffffff" />
          </PressScale>
        </View>
      </Animated.View>

      <GestureDetector gesture={gestures}>
        <View
          ref={stageRef}
          onLayout={(event) => {
            size.set({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height });
            onStageLayout();
          }}
          style={styles.stage}
        >
          <Animated.View style={[StyleSheet.absoluteFill, flight]}>
            {/* No touches of its own: the gestures are the stage's (and a
                browser would start dragging the picture away). */}
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, dragged]}>
              {previous ? frame(previous.photo, previous.uri, slide(previous.step * 80, true)) : null}
              {frame(photo, uri, previous ? slide(previous.step * 80, false) : null)}
            </Animated.View>
          </Animated.View>
        </View>
      </GestureDetector>

      {/* Always there: the one with nowhere to go fades out. */}
      <PressScale scale={0.88}
        onPress={() => go(-1)}
        disabled={index === 0}
        accessibilityRole="button"
        accessibilityLabel="Previous photo"
        accessibilityElementsHidden={index === 0}
        style={[styles.arrow, styles.left, { opacity: open && index > 0 ? 1 : 0, ...timing(["opacity"]) }]}
      >
        <Ionicons name="chevron-back" size={30} color="#ffffff" />
      </PressScale>
      <PressScale scale={0.88}
        onPress={() => go(1)}
        disabled={index === photos.length - 1}
        accessibilityRole="button"
        accessibilityLabel="Next photo"
        accessibilityElementsHidden={index === photos.length - 1}
        style={[styles.arrow, styles.right, { opacity: open && index < photos.length - 1 ? 1 : 0, ...timing(["opacity"]) }]}
      >
        <Ionicons name="chevron-forward" size={30} color="#ffffff" />
      </PressScale>

      <Animated.Text numberOfLines={1} style={[styles.name, chrome]}>
        {photo.name}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 40,
    // A photo dragged away stays inside.
    overflow: "hidden",
  },

  backdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.94)",
  },

  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  counter: {
    color: "#ffffff",
    fontSize: 15,
    paddingLeft: 8,
  },

  actions: {
    flexDirection: "row",
  },

  button: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },

  stage: {
    flex: 1,
  },

  frame: {
    alignItems: "center",
    justifyContent: "center",
  },

  image: {
    width: "100%",
    height: "100%",
  },

  arrow: {
    position: "absolute",
    top: "50%",
    marginTop: -28,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },

  left: {
    left: 12,
  },

  right: {
    right: 12,
  },

  name: {
    color: "rgba(255, 255, 255, 0.75)",
    textAlign: "center",
    padding: 12,
    fontSize: 13,
  },
});
