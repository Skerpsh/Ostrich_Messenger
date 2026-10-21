// First: crypto.getRandomValues for the apps.
import "@/crypto/crypto-polyfill";
import { useEffect } from "react";
import {
  DarkTheme,
  DefaultTheme,
  SplashScreen,
  Stack,
  ThemeProvider,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { Platform } from "react-native";
import { AuthProvider, useAuth } from "@/features/auth/auth";
import { CallsProvider } from "@/features/calls/calls-context";
import { ChatsProvider } from "@/features/chats/chats";
import { OutboxProvider } from "@/features/chat/outbox";
import { RealtimeProvider } from "@/api/realtime-context";
import { ChatLooksProvider } from "@/features/chat/chat-looks";
import { AppThemeProvider, useAppTheme } from "@/ui/theme";
import { TooltipProvider } from "@/ui/tooltip";
import { restoreAppIcon, setAppIcon } from "@/platform/app-icon";
import { rememberLink } from "@/api/links";
import { preventZoom } from "@/platform/no-zoom";
import { registerServiceWorker } from "@/platform/pwa";
import SettingsSync from "@/features/settings/settings-sync";
import { nearestAccent } from "@/ui/colors";

// Keep the splash screen until the saved session has been checked.
SplashScreen.preventAutoHideAsync();
registerServiceWorker();
preventZoom();

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <TooltipProvider>
        <AuthProvider>
          <RealtimeProvider>
            <ChatsProvider>
              <OutboxProvider>
                <CallsProvider>
                  <ChatLooksProvider>
                    <SettingsSync />
                    <RootNavigator />
                  </ChatLooksProvider>
                </CallsProvider>
              </OutboxProvider>
            </ChatsProvider>
          </RealtimeProvider>
        </AuthProvider>
      </TooltipProvider>
    </AppThemeProvider>
  );
}

function RootNavigator() {
  const { state } = useAuth();
  const { mode, colors, accent, accentPicked } = useAppTheme();

  useEffect(() => {
    if (state.status !== "loading") {
      SplashScreen.hideAsync();
    }
  }, [state.status]);

  // Paint the page behind the app so Safari's toolbars and overscroll areas
  // follow the theme instead of showing a white body.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg);

    if (Platform.OS === "web") {
      document.documentElement.style.backgroundColor = colors.bg;
      document.documentElement.style.colorScheme = mode;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", colors.surface);
    }
  }, [mode, colors.bg, colors.surface]);

  // The app's icon follows the accent the user chose (platform/app-icon.ts).
  useEffect(() => {
    if (accentPicked > 0) {
      setAppIcon(nearestAccent(accent));
    } else {
      restoreAppIcon();
    }
  }, [accent, accentPicked]);

  // Web: an invite or profile link opened while logged out is opened
  // after logging in (features/chats/chat-list.tsx).
  useEffect(() => {
    if (
      Platform.OS === "web" &&
      state.status === "signedOut" &&
      /^\/chats\/(join|u)\/[^/]+$/.test(location.pathname)
    ) {
      rememberLink(location.pathname);
    }
  }, [state.status]);

  if (state.status === "loading") {
    return null;
  }

  const signedIn = state.status === "signedIn";
  // A new OstrichID must be saved before anything else.
  const mustSaveOstrichId = signedIn && state.pendingOstrichId !== null;
  // A device without the account's keys must unlock them first.
  const mustUnlock = signedIn && !mustSaveOstrichId && state.privateKey === null;
  const baseTheme = mode === "dark" ? DarkTheme : DefaultTheme;

  return (
    <ThemeProvider
      value={{
        ...baseTheme,
        colors: {
          ...baseTheme.colors,
          background: colors.bg,
          card: colors.surface,
          text: colors.text,
          border: colors.line,
          primary: colors.accent,
        },
      }}
    >
      <StatusBar style={mode === "dark" ? "light" : "dark"} />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="link-device" />
        </Stack.Protected>

        <Stack.Protected guard={mustSaveOstrichId}>
          <Stack.Screen name="ostrich-id" />
        </Stack.Protected>

        <Stack.Protected guard={mustUnlock}>
          <Stack.Screen name="unlock" />
        </Stack.Protected>

        <Stack.Protected guard={signedIn && !mustSaveOstrichId && !mustUnlock}>
          <Stack.Screen name="chats" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
