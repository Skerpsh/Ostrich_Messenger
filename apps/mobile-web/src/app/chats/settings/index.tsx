import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useIsFocused, useRouter, type Href } from "expo-router";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AppHeader from "@/ui/app-header";
import ScreenEnter, { useLeaveScreen } from "@/ui/screen-enter";
import DevBadge from "@/ui/dev-badge";
import QrCode from "@/ui/qr-code";
import type { IconName } from "@/ui/icon-button";
import { ProfilePhoto } from "@/features/settings/profile-photo";
import { Divider, Row, Section, styles } from "@/features/settings/ui";
import { useAuth, useCurrentUser } from "@/features/auth/auth";
import { useAppTheme } from "@/ui/theme";
import { useEscape } from "@/ui/keys";
import { useIsWide } from "@/ui/layout";
import { profileLink } from "@/api/links";
import { notificationsSupported } from "@/platform/notifications";
import { installApp, useCanInstall } from "@/platform/pwa";

// The settings' sections, each on a screen of its own.
const SECTIONS: { path: Href; label: string; icon: IconName; shown?: () => boolean }[] = [
  { path: "/chats/settings/personalization", label: "Personalization", icon: "color-palette-outline" },
  {
    path: "/chats/settings/notifications",
    label: "Notifications",
    icon: "notifications-outline",
    shown: notificationsSupported,
  },
  { path: "/chats/settings/privacy", label: "Privacy & security", icon: "lock-closed-outline" },
  { path: "/chats/settings/devices", label: "Devices", icon: "laptop-outline" },
  { path: "/chats/settings/account", label: "Account", icon: "person-circle-outline" },
  {
    path: "/chats/settings/shortcuts",
    label: "Keyboard shortcuts",
    icon: "keypad-outline",
    shown: () => Platform.OS === "web",
  },
  { path: "/chats/settings/help", label: "Help", icon: "help-circle-outline" },
];

export default function SettingsScreen() {
  return (
    <ScreenEnter>
      <Settings />
    </ScreenEnter>
  );
}

function Settings() {
  const router = useRouter();
  const leaveScreen = useLeaveScreen();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  const { signOut } = useAuth();
  const user = useCurrentUser();
  const canInstall = useCanInstall();

  const [copied, setCopied] = useState(false);
  // The profile's QR code (scanned, it opens a chat with the user).
  const [showQr, setShowQr] = useState(false);

  const close = () =>
    leaveScreen(() => (wide || !router.canGoBack() ? router.replace("/chats") : router.back()));

  // Web: Esc closes the settings (only the screen in front: the stack
  // keeps the ones under it).
  useEscape(useIsFocused(), close);

  if (!user) {
    return null;
  }


  const copyUsername = async () => {
    await Clipboard.setStringAsync(`@${user.username}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader
        onBack={wide ? undefined : close}
        onClose={wide ? close : undefined}
        title="Settings"
      />

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.profile, { backgroundColor: colors.panel }]}>
          <ProfilePhoto />
          <View style={styles.usernameRow}>
            <Text style={[styles.username, { color: colors.text }]}>
              @{user.username}
            </Text>
            {user.is_developer ? <DevBadge size="lg" /> : null}
          </View>
          <Pressable
            onPress={copyUsername}
            accessibilityRole="button"
            accessibilityLabel="Copy your username"
            style={({ hovered }) => [
              styles.chip,
              { backgroundColor: colors.accentSoft },
              hovered && styles.hovered,
            ]}
          >
            <Ionicons
              name={copied ? "checkmark" : "copy-outline"}
              size={15}
              color={colors.accent}
            />
            <Text style={[styles.chipText, { color: colors.accent }]}>
              {copied ? "Copied" : "Copy username"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setShowQr((shown) => !shown)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showQr }}
            style={({ hovered }) => [
              styles.chip,
              { backgroundColor: colors.accentSoft },
              hovered && styles.hovered,
            ]}
          >
            <Ionicons name="qr-code-outline" size={15} color={colors.accent} />
            <Text style={[styles.chipText, { color: colors.accent }]}>
              {showQr ? "Hide QR code" : "My QR code"}
            </Text>
          </Pressable>
          {showQr ? (
            <>
              <QrCode value={profileLink(user.username)} />
              <Text selectable style={[styles.hint, { color: colors.muted }]}>
                {profileLink(user.username)}
              </Text>
            </>
          ) : null}
          <Text style={[styles.hint, { color: colors.muted }]}>
            Friends start chats with you by your username, or by scanning
            your QR code.
          </Text>
        </View>

        <Section>
          {SECTIONS.filter((section) => section.shown?.() ?? true).map((section, index) => (
            <View key={section.label}>
              {index > 0 ? <Divider /> : null}
              <Row icon={section.icon} label={section.label} opens onPress={() => router.push(section.path)} />
            </View>
          ))}
        </Section>

        {canInstall ? (
          <Section>
            <Row icon="download-outline" label="Install Ostrich as an app" onPress={() => installApp()} />
          </Section>
        ) : null}

        <Section>
          <Row icon="log-out-outline" label="Log out" onPress={signOut} />
        </Section>
      </ScrollView>
    </View>
  );
}
