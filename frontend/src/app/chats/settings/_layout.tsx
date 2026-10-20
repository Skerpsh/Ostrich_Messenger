import { Stack } from "expo-router";
import { useAppTheme } from "@/context/theme";

// The settings' main screen and its sections, one screen each.
export default function SettingsLayout() {
  const { colors } = useAppTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
