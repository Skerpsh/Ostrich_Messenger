import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";
import QrCode from "@/ui/qr-code";
import type { IconName } from "@/ui/icon-button";
import Reveal from "@/ui/reveal";
import { useAuth, useCurrentUser } from "@/features/auth/auth";
import { useChats } from "./chats";
import { useAppTheme } from "@/ui/theme";
import { openSavedChat } from "@/api/api";
import { useIsWide } from "@/ui/layout";
import { profileLink } from "@/api/links";
import { radius } from "@/ui/colors";

// The first thing a new account sees instead of an empty list: how to find
// someone, how to be found, and what else there is to start with.
export default function Welcome({ onFindFriend }: { onFindFriend: () => void }) {
  const router = useRouter();
  const { colors } = useAppTheme();
  const wide = useIsWide();
  const user = useCurrentUser();
  const { withToken } = useAuth();
  const { reload } = useChats();
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return null;
  }

  const link = profileLink(user.username);

  const go = (path: Parameters<typeof router.push>[0]) =>
    wide ? router.replace(path) : router.push(path);

  const share = async () => {
    const shareable = Platform.OS !== "web" || (typeof navigator !== "undefined" && "share" in navigator);

    if (shareable) {
      try {
        await Share.share(Platform.OS === "ios" ? { url: link } : { message: link });
        return;
      } catch {
        // Closed, or not allowed here: copy it instead.
      }
    }

    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const openSaved = async () => {
    setError(null);

    try {
      const chatId = await withToken(openSavedChat);
      await reload();
      go({ pathname: "/chats/[chatId]", params: { chatId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={[styles.title, { color: colors.text }]}>Welcome, @{user.username}!</Text>
      <Text style={[styles.subtitle, { color: colors.muted }]}>
        Everything you send is end-to-end encrypted. Here is how to start:
      </Text>

      <View style={[styles.card, { backgroundColor: colors.panel }]}>
        <Step
          icon="search"
          title="Find a friend"
          text="Type their exact @username in the search"
          onPress={onFindFriend}
        />
        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <Step
          icon="qr-code-outline"
          title="Share your profile"
          text="A friend scans the code or opens the link to message you"
          expanded={showQr}
          onPress={() => setShowQr((open) => !open)}
        />
        <Reveal>
          {showQr ? (
            <View style={styles.qr}>
              <QrCode value={link} size={180} />
              <Pressable
                onPress={share}
                accessibilityRole="button"
                style={({ hovered, pressed }) => [
                  styles.chip,
                  { backgroundColor: colors.accentSoft },
                  (hovered || pressed) && styles.chipHover,
                ]}
              >
                <Ionicons
                  name={copied ? "checkmark" : Platform.OS === "web" ? "link-outline" : "share-outline"}
                  size={16}
                  color={colors.accent}
                />
                <Text style={[styles.chipText, { color: colors.accent }]}>
                  {copied ? "Link copied" : Platform.OS === "web" ? "Copy the link" : "Share the link"}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </Reveal>
        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <Step
          icon="bookmark-outline"
          title="Saved messages"
          text="Notes, links and files for yourself, on all your devices"
          onPress={openSaved}
        />
        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <Step
          icon="people-outline"
          title="Create a group"
          text="Up to 50 people, invite them with a link"
          onPress={() => go("/chats/new")}
        />
      </View>

      <Reveal>
        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
      </Reveal>
    </View>
  );
}

function Step({
  icon,
  title,
  text,
  expanded,
  onPress,
}: {
  icon: IconName;
  title: string;
  text: string;
  expanded?: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      style={({ hovered, pressed }) => [styles.step, (hovered || pressed) && { backgroundColor: colors.hover }]}
    >
      <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
        <Ionicons name={icon} size={20} color={colors.accent} />
      </View>
      <View style={styles.stepText}>
        <Text style={[styles.stepTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.stepHint, { color: colors.muted }]}>{text}</Text>
      </View>
      <Ionicons
        name={expanded === undefined ? "chevron-forward" : expanded ? "chevron-up" : "chevron-down"}
        size={18}
        color={colors.muted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 8,
  },

  title: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },

  subtitle: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 12,
  },

  card: {
    borderRadius: radius.card,
    overflow: "hidden",
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 68,
  },

  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },

  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },

  stepText: {
    flex: 1,
    gap: 2,
  },

  stepTitle: {
    fontSize: 16,
    fontWeight: "600",
  },

  stepHint: {
    fontSize: 13,
  },

  qr: {
    alignItems: "center",
    gap: 14,
    paddingBottom: 16,
  },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },

  chipHover: {
    opacity: 0.85,
  },

  chipText: {
    fontSize: 15,
    fontWeight: "600",
  },

  error: {
    fontSize: 14,
    textAlign: "center",
  },
});
