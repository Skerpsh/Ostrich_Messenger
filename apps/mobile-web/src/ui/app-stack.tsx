import { Stack } from "expo-router";
import JsStack, { CardStyleInterpolators } from "expo-router/js-stack";
import { Easing, Platform } from "react-native";
import { useAppTheme } from "./theme";
import { ms, useMotion, useScreenAnimation } from "./motion";

// The phones' stack of screens. Android's own transitions take no duration,
// so there it is the JavaScript stack, whose slides follow the speed chosen
// in Settings → Personalization; iOS keeps its native one.
// screens: in order, the first one the stack starts with (none: the
// router's order); modal ones come up from below.
export default function AppStack({ screens = [] }: { screens?: { name: string; modal?: boolean }[] }) {
  const { colors } = useAppTheme();
  const motion = useMotion();
  const animation = useScreenAnimation();

  if (Platform.OS === "android") {
    const timing = (duration: number) => ({
      animation: "timing" as const,
      config: { duration: ms(duration), easing: Easing.bezier(0.2, 0.82, 0.25, 1) },
    });

    return (
      <JsStack
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: colors.bg },
          animation: motion === "off" ? "none" : undefined,
          cardStyleInterpolator:
            motion === "reduced"
              ? CardStyleInterpolators.forFadeFromCenter
              : CardStyleInterpolators.forHorizontalIOS,
          transitionSpec: { open: timing(motion === "reduced" ? 150 : 350), close: timing(motion === "reduced" ? 150 : 300) },
        }}
      >
        {screens.map(({ name, modal }) => (
          <JsStack.Screen
            key={name}
            name={name}
            options={
              modal
                ? {
                    presentation: "modal",
                    cardStyleInterpolator:
                      motion === "reduced"
                        ? CardStyleInterpolators.forFadeFromCenter
                        : CardStyleInterpolators.forBottomSheetAndroid,
                  }
                : undefined
            }
          />
        ))}
      </JsStack>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      {screens.map(({ name, modal }) => (
        <Stack.Screen key={name} name={name} options={modal ? { presentation: "modal" } : undefined} />
      ))}
    </Stack>
  );
}
