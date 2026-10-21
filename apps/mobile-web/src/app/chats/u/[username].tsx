import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import AppHeader from "@/ui/app-header";
import Button from "@/ui/button";
import { Swap } from "@/ui/reveal";
import { useAuth, useCurrentUser } from "@/features/auth/auth";
import { useAppTheme } from "@/ui/theme";
import { openSavedChat } from "@/api/api";
import { useIsWide } from "@/ui/layout";
import { useStartChat } from "@/features/chats/use-start-chat";

// A profile link (or its QR code): opens the chat with that user; one's
// own opens Saved messages.
export default function ProfileLinkScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const wide = useIsWide();
  const user = useCurrentUser();
  const { withToken } = useAuth();
  const startChat = useStartChat();
  const [error, setError] = useState<string | null>(null);
  const own = username.toLowerCase() === user?.username.toLowerCase();

  useEffect(() => {
    let current = true;

    (own ? withToken(openSavedChat) : startChat(username).then((chat) => chat.id)).then(
      (chatId) => current && router.replace({ pathname: "/chats/[chatId]", params: { chatId } }),
      (e) => current && setError(e instanceof Error ? e.message : "Failed to open the chat"),
    );

    return () => {
      current = false;
    };
  }, [username, own, startChat, withToken, router]);

  const close = () => (wide || !router.canGoBack() ? router.replace("/chats") : router.back());

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader onBack={wide ? undefined : close} onClose={wide ? close : undefined} title={`@${username}`} />
      <View style={styles.center}>
        <Swap id={error ? "error" : "loading"}>
          {error ? (
            <View style={styles.failed}>
              <Text style={[styles.text, { color: colors.danger }]}>{error}</Text>
              <Button title="Back to chats" variant="secondary" onPress={() => router.replace("/chats")} />
            </View>
          ) : (
            <ActivityIndicator color={colors.muted} />
          )}
        </Swap>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
  },

  failed: {
    alignItems: "center",
    gap: 16,
  },

  text: {
    fontSize: 15,
    textAlign: "center",
  },
});
