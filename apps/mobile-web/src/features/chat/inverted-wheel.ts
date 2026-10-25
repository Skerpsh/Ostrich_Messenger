import { useEffect, type RefObject } from "react";
import { Platform, type ViewInstance } from "react-native";

// Web: scrolling an inverted list (the chat's messages) with a mouse wheel
// or a touchpad. The list is drawn upside down, so react-native-web turns
// every wheel event around itself, but it takes "lines" (Firefox's mouse
// wheels) for pixels, so a notch moves the list 3 pixels, and it moves the
// list on every event, several per frame with touchpads. This handler runs
// first and replaces it: it converts lines and pages to pixels and moves
// the list once per frame.

const LINE = 40;

type Scrollable = { getScrollableNode?: () => HTMLElement | null };

// `shown`: whether the list is on the screen (its wrapper rendered).
export function useInvertedWheel(
  wrapper: RefObject<ViewInstance | null>,
  list: RefObject<Scrollable | null>,
  shown: boolean,
) {
  useEffect(() => {
    if (Platform.OS !== "web" || !shown) {
      return;
    }

    const element = wrapper.current as unknown as HTMLElement | null;

    if (!element) {
      return;
    }

    let pending = 0;
    let frame: number | null = null;

    const onWheel = (event: WheelEvent) => {
      const node = list.current?.getScrollableNode?.();

      // Zooming (pinch, ctrl + wheel) and sideways scrolling stay the browser's.
      if (!node || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }

      // Not react-native-web's handler (on the list, below this one).
      event.stopPropagation();
      event.preventDefault();

      const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? node.clientHeight : 1;
      // Upside down: down on the screen is up in the list.
      pending -= event.deltaY * unit;

      frame ??= requestAnimationFrame(() => {
        node.scrollTop += pending;
        pending = 0;
        frame = null;
      });
    };

    element.addEventListener("wheel", onWheel, { capture: true, passive: false });

    return () => {
      element.removeEventListener("wheel", onWheel, { capture: true });

      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [wrapper, list, shown]);
}
