import { Stack } from "expo-router";
import { useAppTheme } from "@/ui/theme";
import { useScreenAnimation } from "@/ui/motion";

// The settings' main screen and its sections, one screen each.
export default function SettingsLayout() {
  const { colors } = useAppTheme();
  const animation = useScreenAnimation();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
