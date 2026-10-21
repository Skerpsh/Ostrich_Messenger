import type { ReactNode } from "react";
import { useIsFocused, useRouter } from "expo-router";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AppHeader from "@/components/app-header";
import ScreenEnter, { useLeaveScreen } from "@/components/screen-enter";
import { useAppTheme } from "@/context/theme";
import { KEYBOARD_BEHAVIOR } from "@/lib/keyboard";
import { useEscape } from "@/lib/keys";
import { styles } from "./ui";

// A screen of the settings (Personalization, Privacy & security, ...):
// its header leads back to the settings' main screen.
export function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ScreenEnter>
      <Page title={title}>{children}</Page>
    </ScreenEnter>
  );
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const leaveScreen = useLeaveScreen();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();

  const back = () =>
    leaveScreen(() => (router.canGoBack() ? router.back() : router.replace("/chats/settings")));

  // Web: Esc goes back to the settings (only the screen in front: the
  // stack keeps the ones under it).
  useEscape(useIsFocused(), back);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader onBack={back} title={title} />

      <KeyboardAvoidingView style={styles.screen} behavior={KEYBOARD_BEHAVIOR}>
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
