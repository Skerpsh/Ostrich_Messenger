import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useRouter, type Href } from "expo-router";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AppHeader from "@/components/app-header";
import ScreenEnter from "@/components/screen-enter";
import DevBadge from "@/components/dev-badge";
import QrCode from "@/components/qr-code";
import type { IconName } from "@/components/icon-button";
import { ProfilePhoto } from "@/components/settings/profile-photo";
import { Divider, Row, Section, styles } from "@/components/settings/ui";
import { useAuth, useCurrentUser } from "@/context/auth";
import { useAppTheme } from "@/context/theme";
import { useIsWide } from "@/lib/layout";
import { profileLink } from "@/lib/links";
import { notificationsSupported } from "@/lib/notifications";
import { installApp, useCanInstall } from "@/lib/pwa";

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
  const router = useRouter();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  const { signOut } = useAuth();
  const user = useCurrentUser();
  const canInstall = useCanInstall();

  const [copied, setCopied] = useState(false);
  // The profile's QR code (scanned, it opens a chat with the user).
  const [showQr, setShowQr] = useState(false);

  if (!user) {
    return null;
  }

  const close = () =>
    wide || !router.canGoBack() ? router.replace("/chats") : router.back();

  const copyUsername = async () => {
    await Clipboard.setStringAsync(`@${user.username}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <ScreenEnter>
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
    </ScreenEnter>
  );
}
