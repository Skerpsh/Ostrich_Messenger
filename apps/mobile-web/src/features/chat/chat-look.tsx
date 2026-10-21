import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import AnimatedPressable from "@/ui/animated-pressable";
import Button from "@/ui/button";
import { AccentPicker, ChatPreview, WallpaperPicker } from "@/features/settings/pickers";
import { Segmented } from "@/features/settings/ui";
import { useChatLooks } from "./chat-looks";
import { ChatAccentProvider, useAppTheme } from "@/ui/theme";
import { useEscape } from "@/ui/keys";
import { enterStyle, leaveStyle, useLeave } from "@/ui/motion";
import type { ChatLook, Wallpaper } from "@/features/settings/personalization";
import { radius, type AccentChoice } from "@/ui/colors";

type Audience = "me" | "everyone";

// A chat's "Wallpaper & color" (over the chat, placed like ActionMenu):
// the accent and the wallpaper of this chat, for the user only or, where
// `share` is given, for everyone in it (a message, features/chat/payload.ts).
export default function ChatLookSheet({
  chatId,
  // "both" in direct chats, "everyone" in groups (admins).
  everyoneLabel,
  share,
  onClose,
}: {
  chatId: string;
  everyoneLabel: string;
  share?: (look: ChatLook | null, photo: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const { colors, wallpaper: deviceWallpaper, wallpaperPhoto } = useAppTheme();
  const { motion, leaving, leave } = useLeave();
  // Leaves with an animation (also on Esc, on the web).
  const close = () => leave(onClose);
  useEscape(true, close);
  const looks = useChatLooks();
  const [audience, setAudience] = useState<Audience>("me");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const initial = (of: Audience) => ({
    look: (of === "me" ? looks.mineOf(chatId) : looks.sharedOf(chatId)) ?? {},
    photo: looks.photoOf(chatId, of === "me" ? "mine" : "shared"),
  });

  const [draft, setDraft] = useState<{ look: ChatLook; photo: string | null }>(() => initial("me"));

  const switchTo = (next: Audience) => {
    setAudience(next);
    setDraft(initial(next));
    setError(null);
  };

  const wallpaper: Wallpaper = draft.look.wallpaper ?? deviceWallpaper;
  const shownPhoto = draft.look.wallpaper ? draft.photo : wallpaperPhoto;
  const empty = !draft.look.accent && !draft.look.wallpaper;

  const apply = async (look: ChatLook | null) => {
    if (audience === "me") {
      looks.setMine(chatId, look, look?.wallpaper?.pattern === "photo" ? draft.photo : null);
      close();
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await share?.(look, look?.wallpaper?.pattern === "photo" ? draft.photo : null);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the wallpaper");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatedPressable
      style={[styles.backdrop, leaving ? leaveStyle("fade", motion) : enterStyle("fade", motion)]}
      pointerEvents={leaving ? "none" : "auto"}
      onPress={close}
      accessibilityLabel="Close"
    >
      <AnimatedPressable
        style={[styles.card, { backgroundColor: colors.panel }, leaving ? leaveStyle("pop", motion) : enterStyle("pop", motion)]}
        onPress={() => {}}
      >
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[styles.title, { color: colors.text }]}>Wallpaper & color</Text>

          {share ? (
            <Segmented
              options={[
                { value: "me" as const, label: "For me", icon: "person-outline" },
                { value: "everyone" as const, label: everyoneLabel, icon: "people-outline" },
              ]}
              value={audience}
              onChange={switchTo}
            />
          ) : null}
          <Text style={[styles.hint, { color: colors.muted }]}>
            {audience === "me"
              ? "Only you see it, on this chat. It comes before what others set."
              : "Everyone in the chat gets it, end-to-end encrypted, unless they set their own."}
          </Text>

          <ChatAccentProvider accent={draft.look.accent ?? null}>
            <ChatPreview wallpaper={wallpaper} photo={shownPhoto} />
          </ChatAccentProvider>

          <Text style={[styles.label, { color: colors.textSoft }]}>Accent color</Text>
          <AccentPicker
            value={draft.look.accent ?? null}
            onChange={(accent: AccentChoice) => setDraft((d) => ({ ...d, look: { ...d.look, accent } }))}
          />

          <Text style={[styles.label, { color: colors.textSoft }]}>Wallpaper</Text>
          <WallpaperPicker
            value={wallpaper}
            photo={shownPhoto}
            onChange={(next) => setDraft((d) => ({ ...d, look: { ...d.look, wallpaper: next } }))}
            onPhoto={(photo) => setDraft((d) => ({ ...d, photo }))}
            onError={setError}
          />

          {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

          <View style={styles.buttons}>
            <Button
              title="Reset"
              variant="secondary"
              onPress={() => apply(null)}
              disabled={busy}
              style={styles.button}
            />
            <Button
              title={audience === "me" ? "Apply" : "Send"}
              onPress={() => apply(empty ? null : draft.look)}
              loading={busy}
              style={styles.button}
            />
          </View>
        </ScrollView>
      </AnimatedPressable>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },

  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "100%",
    borderRadius: radius.card,
    overflow: "hidden",
  },

  body: {
    padding: 20,
    gap: 12,
  },

  title: {
    fontSize: 18,
    fontWeight: "700",
  },

  hint: {
    fontSize: 13,
    lineHeight: 18,
  },

  label: {
    fontSize: 15,
    marginTop: 4,
  },

  error: {
    fontSize: 14,
  },

  buttons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },

  button: {
    flex: 1,
  },
});
