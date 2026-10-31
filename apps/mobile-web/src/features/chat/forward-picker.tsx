import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import ChatAvatar from "@/features/chats/chat-avatar";
import DevBadge from "@/ui/dev-badge";
import { noWebOutline } from "@/ui/text-field";
import { useChats } from "@/features/chats/chats";
import { useAppTheme } from "@/ui/theme";
import { useEscape } from "@/ui/keys";
import { useLeave } from "@/ui/motion";
import type { Chat } from "@/api/api";
import { chatTitle, groupKeyOf } from "@/features/groups/groups";
import { TOUCH_UI } from "@/platform/touch";
import { radius } from "@/ui/colors";
import { useAppear } from "@/ui/reveal";

// "Forward to…": a chat to forward a message to, over a dimmed background
// (placed like ActionMenu).
export default function ForwardPicker({
  onPick,
  onClose,
  title = "Forward to…",
  allow = () => true,
}: {
  onPick: (chat: Chat) => void;
  onClose: () => void;
  // Picking for something else (e.g. "If I disappear").
  title?: string;
  allow?: (chat: Chat) => boolean;
}) {
  const { colors } = useAppTheme();
  const { leaving, leave } = useLeave();
  const fadeStyle = useAppear("fade", leaving);
  const popStyle = useAppear("pop", leaving);
  // Leaves with an animation (also on Esc, on the web).
  const close = () => leave(onClose);
  useEscape(true, close);
  const { chats } = useChats();
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const needle = query.trim().replace(/^@/, "").toLowerCase();

    // Chats that can be written to from here: not blocked, with the other
    // member's key (or the group's).
    return (chats ?? []).filter(
      (chat) =>
        !chat.blocked &&
        allow(chat) &&
        (chat.type === "group" || chat.type === "room" ? groupKeyOf(chat.id, chat.key_epoch) : chat.public_key) &&
        chatTitle(chat).toLowerCase().includes(needle),
    );
  }, [chats, query, allow]);

  return (
    <Animated.View
      style={[styles.backdrop, fadeStyle]}
      pointerEvents={leaving ? "none" : "auto"}
    >
      {/* Taps around the card close it. The card is no pressable, so on
          Android its scroll keeps the touch. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
      <Animated.View
        style={[styles.card, { backgroundColor: colors.panel }, popStyle]}
      >
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        <View style={[styles.search, { backgroundColor: colors.panelAlt }]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search chats"
            placeholderTextColor={colors.muted}
            autoFocus={!TOUCH_UI}
            style={[styles.searchInput, { color: colors.text }, noWebOutline]}
          />
        </View>
        <FlatList
          data={shown}
          keyExtractor={(chat) => chat.id}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.muted }]}>No chats to forward to</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onPick(item)}
              accessibilityRole="button"
              accessibilityLabel={`${title.replace("…", "")} ${chatTitle(item)}`}
              style={({ hovered, pressed }) => [
                styles.row,
                (hovered || pressed) && { backgroundColor: colors.hover },
              ]}
            >
              <ChatAvatar chat={item} size={34} />
              <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
                {item.type === "group" || item.type === "room" ? chatTitle(item) : item.username}
              </Text>
              {item.is_developer ? <DevBadge /> : null}
            </Pressable>
          )}
        />
      </Animated.View>
    </Animated.View>
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
    padding: 24,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },

  card: {
    width: "100%",
    maxWidth: 360,
    maxHeight: "80%",
    borderRadius: radius.card,
    paddingVertical: 14,
    gap: 10,
  },

  title: {
    fontSize: 17,
    fontWeight: "700",
    paddingHorizontal: 16,
  },

  search: {
    marginHorizontal: 12,
    height: 38,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    justifyContent: "center",
  },

  searchInput: {
    fontSize: 15,
  },

  list: {
    flexGrow: 0,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },

  name: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "600",
  },

  empty: {
    textAlign: "center",
    padding: 16,
  },
});
