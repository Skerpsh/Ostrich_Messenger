import { useEffect, useMemo, useRef, useState } from "react";
import { DisappearBanner } from "@/features/disappear/disappear";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { usePathname, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Reanimated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AppHeader from "@/ui/app-header";
import ActionMenu from "@/ui/action-menu";
import Avatar from "@/ui/avatar";
import ChatAvatar from "./chat-avatar";
import DevBadge from "@/ui/dev-badge";
import IconButton from "@/ui/icon-button";
import Reveal, { Swap } from "@/ui/reveal";
import TypingDots from "@/ui/typing-dots";
import Welcome from "./welcome";
import { noWebOutline } from "@/ui/text-field";
import { useAuth, useCurrentUser, usePrivateKey } from "@/features/auth/auth";
import { useChats } from "./chats";
import { useRealtime } from "@/api/realtime-context";
import { useAppTheme } from "@/ui/theme";
import { openSavedChat, type Chat } from "@/api/api";
import { formatChatDate, previewText } from "@/ui/format";
import { takePendingLink } from "@/api/links";
import { searchMessages, snippet, type MessageMatch } from "./search";
import { chatTitle } from "@/features/groups/groups";
import { messagePreview } from "./preview";
import { hasMod, useEscape, useKeydown } from "@/ui/keys";
import { useIsWide } from "@/ui/layout";
import { enterStyle, LIST_LAYOUT, useMotion } from "@/ui/motion";
import { useChatCrypto } from "@/features/chat/use-chat-crypto";
import { useMinuteTick } from "@/ui/use-minute-tick";
import { useStartChat } from "./use-start-chat";
import { cleanUsername, USERNAME_RE } from "@/features/auth/validation";
import { radius } from "@/ui/colors";

// Focuses the search of the chats list on screen (the welcome screen on the
// right of a wide screen asks for it).
let focusSearch: (() => void) | null = null;

export const focusChatSearch = () => focusSearch?.();

// The chats list: a screen on phones, the left column on wide screens.
export default function ChatList() {
  const router = useRouter();
  const pathname = usePathname();
  const { colors } = useAppTheme();
  const motion = useMotion();
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  const user = useCurrentUser();
  const { withToken } = useAuth();
  const privateKey = usePrivateKey();
  const { chats, error, reload, typing, updateChatSettings, removeChat, leaveGroup, drafts } =
    useChats();
  const startChatWith = useStartChat();
  // The chat whose actions are shown (long press / right click).
  const [menuFor, setMenuFor] = useState<Chat | null>(null);
  // A failed pin, mute or delete from that menu.
  const [actionError, setActionError] = useState<string | null>(null);
  const { status, presence } = useRealtime();
  useMinuteTick();

  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Messages matching the search, in all chats (as saved on this device).
  const [matches, setMatches] = useState<MessageMatch[]>([]);
  const messageQuery = query.trim();
  const userId = user?.id;

  useEffect(() => {
    if (!userId || !chats || messageQuery.length < 2) {
      return;
    }

    let current = true;
    const timer = setTimeout(() => {
      searchMessages(userId, chats, privateKey, messageQuery).then(
        (found) => current && setMatches(found),
        () => {},
      );
    }, 250);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [userId, chats, privateKey, messageQuery]);

  const shownMatches = messageQuery.length < 2 ? [] : matches;

  const openMatch = (match: MessageMatch) => {
    setQuery("");
    go({ pathname: "/chats/[chatId]", params: { chatId: match.chat.id, message: match.message.id } });
  };

  // A link opened before logging in.
  useEffect(() => {
    takePendingLink().then((path) => {
      if (path) {
        router.navigate(path as never);
      }
    });
  }, [router]);

  // The chat open on the right (wide screens).
  const selectedId = pathname.match(/^\/chats\/([0-9a-f-]{36})$/)?.[1];

  // "@alice" and "alice" both work.
  const search = cleanUsername(query).toLowerCase();

  const shown = useMemo(
    () =>
      (chats ?? []).filter((chat) =>
        chatTitle(chat).toLowerCase().includes(search),
      ),
    [chats, search],
  );

  // Offer to start a chat when the search is a username not in the list.
  const canStart =
    USERNAME_RE.test(search) &&
    search !== user?.username.toLowerCase() &&
    !(chats ?? []).some((chat) => chat.username?.toLowerCase() === search);

  const go = (path: Parameters<typeof router.push>[0]) =>
    wide ? router.replace(path) : router.push(path);

  const openChat = (chat: Chat) => {
    setQuery("");
    go({ pathname: "/chats/[chatId]", params: { chatId: chat.id } });
  };

  const searchRef = useRef<TextInput>(null);

  useEffect(() => {
    focusSearch = () => searchRef.current?.focus();
    return () => {
      focusSearch = null;
    };
  }, []);

  // Web: Esc clears the search and leaves it.
  useEscape(searchFocused, () => {
    setQuery("");
    searchRef.current?.blur();
  });

  // Web: Ctrl/⌘ K goes to the search, Alt ↑ / ↓ to the chat above or below.
  useKeydown((event) => {
    if (menuFor) {
      return false;
    }

    if (hasMod(event) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
      searchRef.current?.focus();
      return true;
    }

    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && shown.length > 0) {
      const index = shown.findIndex((chat) => chat.id === selectedId);
      const next =
        index < 0
          ? event.key === "ArrowDown" ? 0 : shown.length - 1
          : Math.max(0, Math.min(shown.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));

      if (shown[next].id !== selectedId) {
        openChat(shown[next]);
      }

      return true;
    }
  });

  const startChat = async () => {
    setStarting(true);
    setStartError(null);

    try {
      openChat(await startChatWith(search));
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Failed to start chat");
    } finally {
      setStarting(false);
    }
  };

  // Runs an action from the chat menu, showing its error in the list.
  const runAction = async (action: () => Promise<void>) => {
    setMenuFor(null);
    setActionError(null);

    try {
      await action();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  // Saved messages: made on first use.
  const openSaved = () =>
    runAction(async () => {
      const chatId = await withToken(openSavedChat);
      await reload();
      setQuery("");
      go({ pathname: "/chats/[chatId]", params: { chatId } });
    });

  const deleteChat = (chatId: string, scope: "everyone" | "me") =>
    runAction(async () => {
      await removeChat(chatId, scope);

      if (selectedId === chatId) {
        router.replace("/chats");
      }
    });

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const copyUsername = async () => {
    if (!user) {
      return;
    }

    await Clipboard.setStringAsync(`@${user.username}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!user) {
    return null;
  }

  const settingsOpen = pathname.startsWith("/chats/settings");
  const statusText =
    status === "online" ? "online" : status === "connecting" ? "Connecting…" : "Waiting for network…";

  const profileButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      onPress={() => go("/chats/settings")}
      style={({ hovered, pressed }) => [
        styles.profile,
        (hovered || pressed || (wide && settingsOpen)) && { backgroundColor: colors.hover },
      ]}
    >
      <Avatar name={user.username} avatarId={user.avatar_id} size={36} />
    </Pressable>
  );

  const settingsButton = (
    <IconButton icon="settings-outline" label="Settings" onPress={() => go("/chats/settings")} />
  );
  const savedButton = <IconButton icon="bookmark-outline" label="Saved messages" onPress={openSaved} />;
  const newChatButton = (
    <IconButton icon="create-outline" label="New chat or group" onPress={() => go("/chats/new")} />
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface }]}>
      {/* Wide screens: the profile is at the bottom, under the list. */}
      {wide ? null : (
        <AppHeader
          left={profileButton}
          title="Chats"
          subtitle={status === "online" ? `@${user.username}` : statusText}
          right={
            <>
              {savedButton}
              {settingsButton}
            </>
          }
        />
      )}

      <DisappearBanner />

      <View style={[styles.searchWrap, wide && styles.searchRow]}>
        <View style={[styles.search, wide && styles.searchWide, { backgroundColor: colors.panelAlt }]}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            ref={searchRef}
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setStartError(null);
            }}
            placeholder="Search or @username"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => (canStart ? startChat() : undefined)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            style={[styles.searchInput, { color: colors.text }, noWebOutline]}
          />
          <Reveal collapse={false} kind="pop">
            {query ? (
              <IconButton
                icon="close-circle"
                label="Clear search"
                size={18}
                color={colors.muted}
                onPress={() => setQuery("")}
              />
            ) : null}
          </Reveal>
        </View>
        {wide ? newChatButton : null}
      </View>

      <Reanimated.FlatList
        data={shown}
        keyExtractor={(chat) => chat.id}
        itemLayoutAnimation={motion === "full" ? LIST_LAYOUT : undefined}
        contentContainerStyle={[
          styles.list,
          // Phones: room for the "new chat" button over the last chat.
          { paddingBottom: insets.bottom + (wide ? 16 : 92) },
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          Platform.OS === "web" ? undefined : (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.text}
            />
          )
        }
        ListFooterComponent={
          <Reveal>
            {shownMatches.length > 0 ? (
              <View>
                <Text style={[styles.sectionTitle, { color: colors.muted }]}>Messages</Text>
                {shownMatches.map((match) => (
                  <Pressable
                    key={match.message.id}
                    onPress={() => openMatch(match)}
                    accessibilityRole="button"
                    style={({ hovered, pressed }) => [styles.row, (hovered || pressed) && { backgroundColor: colors.hover }]}
                  >
                    <ChatAvatar chat={match.chat} size={40} />
                    <View style={styles.rowText}>
                      <View style={styles.rowLine}>
                        <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
                          {chatTitle(match.chat)}
                        </Text>
                        <Text style={[styles.time, { color: colors.muted }]}>
                          {formatChatDate(match.message.created_at)}
                        </Text>
                      </View>
                      <Text numberOfLines={2} style={[styles.preview, { color: colors.muted }]}>
                        {match.message.sender_id === user?.id
                          ? "You: "
                          : match.chat.type === "group"
                            ? `@${match.message.sender_username}: `
                            : ""}
                        {snippet(match.text, messageQuery)}
                      </Text>
                    </View>
                  </Pressable>
                ))}
                <Text style={[styles.notice, { color: colors.muted }]}>
                  Searched the messages saved on this device: messages are encrypted, the server
                  cannot search them.
                </Text>
              </View>
            ) : null}
          </Reveal>
        }
        ListHeaderComponent={
          <>
            <Reveal>
              {canStart ? (
                <Pressable
                  onPress={startChat}
                  disabled={starting}
                  style={({ hovered, pressed }) => [
                    styles.row,
                    (hovered || pressed) && { backgroundColor: colors.hover },
                  ]}
                >
                  <View
                    style={[styles.startIcon, { backgroundColor: colors.accentSoft }]}
                  >
                    <Swap id={starting ? "starting" : "icon"} resize={false}>
                      {starting ? (
                        <ActivityIndicator color={colors.accent} />
                      ) : (
                        <Ionicons name="chatbubble-ellipses" size={22} color={colors.accent} />
                      )}
                    </Swap>
                  </View>
                  <View style={styles.rowText}>
                    <Text style={[styles.name, { color: colors.text }]}>
                      Start a chat with @{search}
                    </Text>
                    <Text style={[styles.preview, { color: startError ? colors.danger : colors.muted }]}>
                      {startError ?? "Find this user by their exact username"}
                    </Text>
                  </View>
                </Pressable>
              ) : null}
            </Reveal>
            <Reveal>
              {error || actionError ? (
                <Pressable
                  onPress={() => setActionError(null)}
                  disabled={!actionError}
                  accessibilityRole={actionError ? "button" : undefined}
                >
                  <Text style={[styles.notice, { color: colors.danger }]}>
                    {actionError ?? error}
                  </Text>
                </Pressable>
              ) : null}
            </Reveal>
          </>
        }
        ListEmptyComponent={
          // Loading, no matches, no chats: one fades into the other.
          <Swap id={chats === null ? "loading" : search ? "search" : "empty"}>
            {chats === null ? (
              <ActivityIndicator color={colors.muted} style={styles.loading} />
            ) : search ? (
              canStart || shownMatches.length > 0 ? null : (
                <Text style={[styles.notice, { color: colors.muted }]}>
                  No chats match “{query.trim()}”.
                </Text>
              )
            ) : !wide ? (
              <Welcome onFindFriend={() => searchRef.current?.focus()} />
            ) : (
              // The welcome screen is on the right.
              <View style={styles.empty}>
                <Ionicons name="chatbubbles-outline" size={44} color={colors.muted} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  No chats yet
                </Text>
                <Text style={[styles.emptyText, { color: colors.muted }]}>
                  Search for a friend by their @username above, or share yours:
                </Text>
                <Pressable
                  onPress={copyUsername}
                  accessibilityRole="button"
                  style={[styles.chip, { backgroundColor: colors.accentSoft }]}
                >
                  <Swap id={copied ? "copied" : "name"} resize={false}>
                    <View style={styles.chipContent}>
                      <Text style={[styles.chipText, { color: colors.accent }]}>
                        {copied ? "Copied!" : `@${user.username}`}
                      </Text>
                      {copied ? null : (
                        <Ionicons name="copy-outline" size={15} color={colors.accent} />
                      )}
                    </View>
                  </Swap>
                </Pressable>
              </View>
            )}
          </Swap>
        }
        renderItem={({ item }) => (
          <ChatRow
            chat={item}
            ownId={user.id}
            online={
              status === "online" && item.user_id !== null && Boolean(presence[item.user_id]?.online)
            }
            typing={typing.has(item.id)}
            // Not for the chat on screen: its draft is in the input.
            draft={item.id === selectedId ? undefined : drafts[item.id]}
            selected={wide && item.id === selectedId}
            onPress={() => openChat(item)}
            onMenu={() => setMenuFor(item)}
          />
        )}
      />

      {wide ? (
        <View style={[styles.profileBar, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
          {profileButton}
          <View style={styles.profileText}>
            <Text numberOfLines={1} style={[styles.profileName, { color: colors.text }]}>
              @{user.username}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.profileStatus, { color: status === "online" ? colors.online : colors.muted }]}
            >
              {statusText}
            </Text>
          </View>
          {savedButton}
          {settingsButton}
        </View>
      ) : (
        // Phones: "new chat" within reach of the thumb.
        <Pressable
          onPress={() => go("/chats/new")}
          accessibilityRole="button"
          accessibilityLabel="New chat or group"
          style={[styles.fab, { backgroundColor: colors.accent, bottom: insets.bottom + 20, boxShadow: `0 4px 12px ${colors.shadow}` }]}
        >
          <Ionicons name="create-outline" size={24} color={colors.onAccent} />
        </Pressable>
      )}

      <Modal
        visible={menuFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuFor(null)}
      >
        {menuFor ? (
          <ActionMenu
            title={chatTitle(menuFor)}
            onClose={() => setMenuFor(null)}
            items={[
              {
                icon: menuFor.pinned ? "pin" : "pin-outline",
                label: menuFor.pinned ? "Unpin" : "Pin to top",
                onPress: () => runAction(() =>
                  updateChatSettings(menuFor.id, { pinned: !menuFor.pinned }),
                ),
              },
              {
                icon: menuFor.muted ? "notifications-outline" : "notifications-off-outline",
                label: menuFor.muted ? "Unmute" : "Mute",
                onPress: () => runAction(() =>
                  updateChatSettings(menuFor.id, { muted: !menuFor.muted }),
                ),
              },
              ...(menuFor.type === "saved" ? [] : [{
                icon: "eye-off-outline" as const,
                label: "Clear history for me",
                confirmLabel:
                  menuFor.type === "group"
                    ? "Clear? The others keep the messages"
                    : `Clear? @${menuFor.username} keeps the messages`,
                danger: true,
                onPress: () => deleteChat(menuFor.id, "me"),
              }]),
              ...(menuFor.type === "saved"
                ? [
                    {
                      icon: "trash-outline" as const,
                      label: "Delete Saved messages",
                      confirmLabel: "Delete all saved messages?",
                      danger: true,
                      onPress: () => deleteChat(menuFor.id, "everyone"),
                    },
                  ]
                : menuFor.type === "group"
                ? [
                    {
                      icon: "exit-outline" as const,
                      label: "Leave group",
                      confirmLabel: "Leave the group?",
                      danger: true,
                      onPress: () =>
                        runAction(async () => {
                          await leaveGroup(menuFor.id);

                          if (selectedId === menuFor.id) {
                            router.replace("/chats");
                          }
                        }),
                    },
                    ...(menuFor.role === "owner"
                      ? [
                          {
                            icon: "trash-outline" as const,
                            label: "Delete group",
                            confirmLabel: "Delete the group for everyone?",
                            danger: true,
                            onPress: () => deleteChat(menuFor.id, "everyone"),
                          },
                        ]
                      : []),
                  ]
                : [
                    {
                      icon: "trash-outline" as const,
                      label: "Delete for both",
                      confirmLabel: "Delete the chat for both of you?",
                      danger: true,
                      onPress: () => deleteChat(menuFor.id, "everyone"),
                    },
                  ]),
            ]}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function ChatRow({
  chat,
  ownId,
  online,
  typing,
  draft,
  selected,
  onPress,
  onMenu,
}: {
  chat: Chat;
  ownId: string;
  online: boolean;
  typing: boolean;
  // Unsent text of the chat.
  draft?: string;
  selected: boolean;
  onPress: () => void;
  // Long press / right click: pin, mute, delete.
  onMenu: () => void;
}) {
  const { colors, density, textScale } = useAppTheme();
  const motion = useMotion();
  const { decrypt } = useChatCrypto(chat);
  const last = chat.last_message;
  // Settings → Personalization → Chats list.
  const minimal = density === "minimal";
  const own = last?.sender_id === ownId;
  const group = chat.type === "group";
  const title = chatTitle(chat);
  const shownLast = last ? decrypt(last) : null;
  const read =
    own &&
    chat.peer_last_read_at !== null &&
    new Date(chat.peer_last_read_at) >= new Date(last!.created_at);

  const badges = (
    <>
      {chat.pinned && chat.unread_count === 0 ? (
        <Ionicons name="pin" size={14} color={colors.muted} accessibilityLabel="pinned" />
      ) : null}
      {chat.unread_mentions ? (
        <View
          accessibilityLabel="you were mentioned"
          style={[styles.badge, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.badgeText, { color: colors.onAccent }]}>@</Text>
        </View>
      ) : null}
      {chat.join_requests ? (
        <View
          accessibilityLabel={`${chat.join_requests} asking to join`}
          style={[styles.badge, { backgroundColor: colors.accentSoft }]}
        >
          <Ionicons name="person-add" size={11} color={colors.accent} />
          <Text style={[styles.badgeText, { color: colors.accent }]}>{chat.join_requests}</Text>
        </View>
      ) : null}
      {chat.unread_count > 0 ? (
        <Reanimated.View
          // A new count pops in.
          key={chat.unread_count}
          style={[
            enterStyle("badge", motion),
            styles.badge,
            // Muted chats count quietly.
            { backgroundColor: chat.muted ? colors.muted : colors.accent },
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              { color: chat.muted ? colors.bg : colors.onAccent },
            ]}
          >
            {chat.unread_count > 99 ? "99+" : chat.unread_count}
          </Text>
        </Reanimated.View>
      ) : null}
    </>
  );

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onMenu}
      // Web: right click opens the menu instead of the browser's.
      {...({
        onContextMenu: (event: { preventDefault: () => void }) => {
          event.preventDefault();
          onMenu();
        },
      } as object)}
      accessibilityRole="button"
      accessibilityLabel={`${chat.type === "direct" ? `Chat with ${chat.username}` : title}${chat.unread_count ? `, ${chat.unread_count} unread` : ""}`}
      style={({ hovered, pressed }) => [
        styles.row,
        density !== "comfortable" && styles.rowDense,
        selected
          ? { backgroundColor: colors.accentSoft }
          : (hovered || pressed) && { backgroundColor: colors.hover },
      ]}
    >
      <ChatAvatar
        chat={chat}
        online={online}
        size={AVATAR_SIZES[density]}
        ringColor={selected ? colors.surface : undefined}
      />
      <View style={[styles.rowText, density !== "comfortable" && styles.rowTextDense]}>
        <View style={styles.rowLine}>
          <View style={styles.nameWrap}>
            <Text numberOfLines={1} style={[styles.name, { color: colors.text, fontSize: 16 * textScale }]}>
              {chat.type === "direct" ? chat.username : title}
            </Text>
            {chat.is_developer ? <DevBadge /> : null}
            {chat.muted ? (
              <Ionicons
                name="notifications-off"
                size={14}
                color={colors.muted}
                accessibilityLabel="muted"
              />
            ) : null}
          </View>
          <View style={styles.meta}>
            {own && chat.type !== "saved" ? (
              <Ionicons
                name={read ? "checkmark-done" : "checkmark"}
                size={16}
                color={read ? colors.accent : colors.muted}
              />
            ) : null}
            <Text style={[styles.time, { color: chat.unread_count ? colors.accent : colors.muted }]}>
              {formatChatDate(last?.created_at ?? chat.created_at)}
            </Text>
            {minimal ? badges : null}
          </View>
        </View>
        {minimal ? null : (
          <View style={styles.rowLine}>
            {/* "typing", a draft or a new last message fades in. */}
            <Swap id={typing ? "typing" : draft ? "draft" : (last?.id ?? "none")} resize={false} style={styles.flex}>
              {typing ? (
                <View style={styles.typing}>
                  <Text style={[styles.preview, styles.typingText, { color: colors.accent, fontSize: 14 * textScale }]}>
                    typing
                  </Text>
                  <TypingDots color={colors.accent} />
                </View>
              ) : (
                <Text numberOfLines={1} style={[styles.preview, { color: colors.muted, fontSize: 14 * textScale }]}>
                  {draft ? (
                    <>
                      <Text style={{ color: colors.danger }}>Draft: </Text>
                      {previewText(draft)}
                    </>
                  ) : last && shownLast ? (
                    <>
                      {shownLast.status === "system" || chat.type === "saved" ? null : own ? (
                        <Text style={{ color: colors.textSoft }}>You: </Text>
                      ) : group ? (
                        <Text style={{ color: colors.textSoft }}>@{last.sender_username}: </Text>
                      ) : null}
                      {previewText(messagePreview(shownLast))}
                    </>
                  ) : (
                    <Text style={styles.italic}>No messages yet</Text>
                  )}
                </Text>
              )}
            </Swap>
            {badges}
          </View>
        )}
      </View>
    </Pressable>
  );
}

// Avatars per density of the list.
const AVATAR_SIZES = { comfortable: 48, compact: 40, minimal: 32 };

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },

  profile: {
    borderRadius: radius.pill,
    padding: 2,
    marginLeft: 2,
  },

  // Wide screens: "new chat" next to the search.
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  searchWide: {
    flex: 1,
  },

  // Wide screens: the user, their status, saved messages and settings,
  // under the list.
  profileBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 60,
    paddingHorizontal: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },

  profileText: {
    flex: 1,
    paddingHorizontal: 2,
  },

  profileName: {
    fontSize: 15,
    fontWeight: "700",
  },

  profileStatus: {
    fontSize: 12,
    marginTop: 1,
  },

  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },

  searchWrap: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },

  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 42,
    borderRadius: radius.input,
    paddingLeft: 12,
    paddingRight: 4,
  },

  searchInput: {
    flex: 1,
    height: "100%",
    fontSize: 15,
  },

  list: {
    paddingHorizontal: 6,
    paddingTop: 4,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 14,
  },

  startIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },

  rowText: {
    flex: 1,
    gap: 3,
  },

  rowDense: {
    paddingVertical: 5,
  },

  rowTextDense: {
    gap: 1,
  },

  flex: {
    flex: 1,
  },

  rowLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  nameWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  name: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "600",
  },

  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },

  time: {
    fontSize: 12,
  },

  preview: {
    flex: 1,
    fontSize: 14,
  },

  typing: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  typingText: {
    flex: 0,
  },

  italic: {
    fontStyle: "italic",
  },

  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },

  badge: {
    flexDirection: "row",
    gap: 2,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },

  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },

  notice: {
    textAlign: "center",
    fontSize: 14,
    padding: 16,
  },

  loading: {
    marginTop: 40,
  },

  empty: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 32,
    paddingTop: 56,
  },

  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
  },

  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    marginTop: 4,
  },

  chipContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  chipText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
