import { createContext, useContext, type ReactNode } from "react";
import { Platform, StyleSheet } from "react-native";
import Animated from "react-native-reanimated";
import { useLeave } from "./motion";
import { useAppear } from "./reveal";

type Leave = (then: () => void) => void;

const LeaveContext = createContext<Leave | null>(null);

// A screen sliding in as it opens and out as it closes, on the web (the
// phones' navigation animates its screens itself, see useScreenAnimation).
export default function ScreenEnter({ children }: { children: ReactNode }) {
  const { leaving, leave } = useLeave();
  const pushStyle = useAppear("push", leaving);

  if (Platform.OS !== "web") {
    return children;
  }

  return (
    <LeaveContext value={leave}>
      <Animated.View
        pointerEvents={leaving ? "none" : "auto"}
        style={[styles.screen, pushStyle]}
      >
        {children}
      </Animated.View>
    </LeaveContext>
  );
}

// Closing the screen: leave(navigate) slides it out first, then navigates.
export function useLeaveScreen(): Leave {
  const leave = useContext(LeaveContext);

  return (then) => (leave ? leave(then) : then());
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});
