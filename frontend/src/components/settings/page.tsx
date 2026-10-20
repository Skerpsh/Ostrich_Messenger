import type { ReactNode } from "react";
import { useRouter } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AppHeader from "@/components/app-header";
import ScreenEnter from "@/components/screen-enter";
import { useAppTheme } from "@/context/theme";
import { styles } from "./ui";

// A screen of the settings (Personalization, Privacy & security, ...):
// its header leads back to the settings' main screen.
export function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();

  const back = () => (router.canGoBack() ? router.back() : router.replace("/chats/settings"));

  return (
    <ScreenEnter>
      <View style={[styles.screen, { backgroundColor: colors.bg }]}>
        <AppHeader onBack={back} title={title} />

        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </ScreenEnter>
  );
}
