import { useState, type ComponentPropsWithRef } from "react";
import type { GestureResponderEvent, PressableProps } from "react-native";
import AnimatedPressable from "./animated-pressable";
import { usePressed } from "./motion";

// Something to tap that is not a Button or IconButton (a color, a photo, a
// reaction, a tab): it shrinks a little while pressed and springs back, as
// they do. highlight: its background while hovered or pressed.
export default function PressScale({
  scale = 0.94,
  highlight,
  style,
  disabled,
  onPressIn,
  onPressOut,
  ...props
}: Omit<ComponentPropsWithRef<typeof AnimatedPressable>, "onPressIn" | "onPressOut"> &
  Pick<PressableProps, "onPressIn" | "onPressOut"> & {
    scale?: number;
    highlight?: string;
  }) {
  const active = !disabled;
  const { pressed, handlers, style: pressStyle } = usePressed(scale, active);
  const [hovered, setHovered] = useState(false);

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPressIn={(event: GestureResponderEvent) => {
        handlers.onPressIn();
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        handlers.onPressOut();
        onPressOut?.(event);
      }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        style,
        highlight && active && (pressed || hovered) ? { backgroundColor: highlight } : null,
        pressStyle,
      ]}
    />
  );
}
