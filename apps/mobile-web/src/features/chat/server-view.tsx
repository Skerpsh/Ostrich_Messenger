import { useEffect, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import AnimatedPressable from "@/ui/animated-pressable";
import Button from "@/ui/button";
import { useAuth } from "@/features/auth/auth";
import { formatSize, isVoice } from "@/features/chat/attachments";
import type { Shown } from "@/features/chat/use-chat-crypto";
import {
  getChatServerView,
  getMessageServerView,
  type ChatServerView,
  type MessageServerView,
} from "@/api/api";
import { useAppTheme } from "@/ui/theme";
import { useEscape } from "@/ui/keys";
import { enterStyle, leaveStyle, useLeave } from "@/ui/motion";
import { radius } from "@/ui/colors";
import Reveal from "@/ui/reveal";
import PressScale from "@/ui/press-scale";

// "What the server sees" of a message or a chat: the rows the server keeps,
// fetched when opened (not made up from what the app knows), next to what
// stays inside the encryption. Placed like SafetyCode.
export type ServerViewTarget =
  | { kind: "message"; chatId: string; messageId: string; shown: Shown }
  | { kind: "chat"; chatId: string };

type Row = { label: string; value: string; mono?: boolean; readable?: boolean };

// The start of a long ciphertext; all of it when `full`.
const CIPHERTEXT_PREVIEW = 96;

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function messageRows(view: MessageServerView, full: boolean): Row[] {
  const { message } = view;
  const content =
    full || message.content.length <= CIPHERTEXT_PREVIEW
      ? message.content
      : `${message.content.slice(0, CIPHERTEXT_PREVIEW)}…`;

  return [
    { label: "Sender", value: `@${message.sender_username}` },
    { label: "Sent", value: when(message.created_at) },
    ...(message.edited_at ? [{ label: "Edited", value: when(message.edited_at) }] : []),
    ...(message.deliver_at ? [{ label: "Kept from the others until (a surprise)", value: when(message.deliver_at) }] : []),
    {
      label: message.kind === "system" ? "Content (written by the server)" : `Content, encrypted (${message.content_length} characters)`,
      value: content,
      mono: true,
      readable: message.kind === "system",
    },
    ...(message.reply_to_id ? [{ label: "Replies to the message", value: message.reply_to_id, mono: true }] : []),
    ...(view.attachments.length
      ? [{
          label: view.attachments.length > 1 ? `${view.attachments.length} encrypted files` : "An encrypted file",
          value: view.attachments.map((file) => formatSize(file.size)).join(", "),
        }]
      : []),
    ...view.reactions.map((reaction) => ({
      label: "Reaction",
      value: `${reaction.emoji}  ${reaction.user_id}`,
      readable: true,
    })),
    ...(view.mentions.length
      ? [{ label: "Mentions", value: view.mentions.join("\n"), mono: true }]
      : []),
    { label: "Message id", value: message.id, mono: true },
  ];
}

// What the message carries inside its encryption.
function hiddenOfMessage(shown: Shown, view: MessageServerView): string[] {
  if (view.message.kind === "system") {
    return [];
  }

  if (shown.status === "error") {
    return ["Everything inside: not even this device can decrypt it"];
  }

  const files = shown.attachments ?? [];
  const voice = files.filter(isVoice).length;

  return [
    ...(shown.text ? ["The text"] : []),
    ...(files.length > voice ? ["The files' names, types, contents and pictures' sizes"] : []),
    ...(voice ? ["The voice recording and its waveform"] : []),
    ...(shown.link ? ["The link and its preview"] : []),
    ...(shown.forwardedFrom ? ["Who it was forwarded from"] : []),
    ...(view.message.reply_to_id ? ["The text it quotes"] : []),
    ...(shown.call ? ["How the call went and how long it lasted"] : []),
    ...(shown.look ? ["The chat's new wallpaper and color"] : []),
  ];
}

function chatRows(view: ChatServerView): Row[] {
  const { chat, me, stats } = view;
  const group = chat.type === "group";

  return [
    {
      label: "Kind",
      value: group
        ? "Group"
        : chat.type === "saved"
          ? "Saved messages"
          : chat.type === "room"
            ? "Anonymous room"
            : "Direct chat",
    },
    { label: "Created", value: when(chat.created_at) },
    { label: "Last activity", value: when(chat.updated_at) },
    {
      label: group ? `${view.members.length} members` : "Members",
      value: view.members
        .map((member) => (group ? `@${member.username} · ${member.role} · since ${when(member.joined_at)}` : `@${member.username}`))
        .join("\n"),
    },
    {
      label: "Stored",
      value: `${stats.messages} messages · ${stats.files} files (${formatSize(stats.file_bytes)})`,
    },
    ...(group && chat.encrypted_info
      ? [{ label: "Name and photo, encrypted", value: chat.encrypted_info.slice(0, CIPHERTEXT_PREVIEW) + (chat.encrypted_info.length > CIPHERTEXT_PREVIEW ? "…" : ""), mono: true }]
      : []),
    ...(group
      ? [
          { label: "Group key", value: `version ${chat.key_epoch} · ${stats.group_keys} encrypted copies, one per member and version` },
          { label: "Invite link", value: stats.invite_link ? `on · ${stats.join_requests} join requests` : "off" },
        ]
      : []),
    ...(chat.pinned_message_id ? [{ label: "Pinned message", value: chat.pinned_message_id, mono: true }] : []),
    {
      label: "Your settings here",
      value: [
        `read up to ${when(me.last_read_at)}`,
        me.pinned_at ? "pinned to top" : null,
        me.muted ? "muted" : null,
        me.cleared_at ? `history cleared ${when(me.cleared_at)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
    { label: "Chat id", value: chat.id, mono: true },
  ];
}

function hiddenOfChat(view: ChatServerView): string[] {
  return [
    "Every message's text, files, voice messages and link previews",
    ...(view.chat.type === "group" ? ["The group's name and photo"] : []),
    "The chat's wallpaper and color",
    "Call audio and video",
    "The keys: they are made and kept on your devices",
  ];
}

export default function ServerView({
  target,
  room = false,
  onClose,
}: {
  target: ServerViewTarget;
  // An anonymous room: the server has its key, so nothing is hidden.
  room?: boolean;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  const { withToken } = useAuth();
  const { motion, leaving, leave } = useLeave();
  // Leaves with an animation (also on Esc, on the web).
  const close = () => leave(onClose);
  useEscape(true, close);

  const [view, setView] = useState<MessageServerView | ChatServerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The whole ciphertext, or its start.
  const [full, setFull] = useState(false);
  // The rows as the server sent them, as JSON.
  const [raw, setRaw] = useState(false);

  const { chatId } = target;
  const messageId = target.kind === "message" ? target.messageId : null;

  useEffect(() => {
    let cancelled = false;

    withToken<MessageServerView | ChatServerView>((token) =>
      messageId ? getMessageServerView(token, chatId, messageId) : getChatServerView(token, chatId),
    ).then(
      (result) => !cancelled && setView(result),
      (e) => !cancelled && setError(e instanceof Error ? e.message : "Something went wrong"),
    );

    return () => {
      cancelled = true;
    };
  }, [chatId, messageId, withToken]);

  const rows = !view
    ? []
    : "message" in view
      ? messageRows(view, full)
      : chatRows(view);
  const hidden = !view || room
    ? []
    : "message" in view
      ? target.kind === "message" ? hiddenOfMessage(target.shown, view) : []
      : hiddenOfChat(view);
  const readable = rows.some((row) => row.readable);

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
        <ScrollView contentContainerStyle={styles.body} persistentScrollbar>
          <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name="server-outline" size={24} color={colors.accent} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>What the server sees</Text>
          <Text style={[styles.text, { color: colors.textSoft }]}>
            {target.kind === "message"
              ? "This message exactly as the server stores it, fetched from it just now."
              : "This chat exactly as the server stores it, fetched from it just now."}
          </Text>

          {error ? (
            <Text style={[styles.text, { color: colors.danger }]}>{error}</Text>
          ) : !view ? (
            <ActivityIndicator color={colors.accent} style={styles.loading} />
          ) : raw ? (
            <Text selectable style={[styles.mono, styles.rawJson, { color: colors.text, backgroundColor: colors.panelAlt }]}>
              {JSON.stringify(view, null, 2)}
            </Text>
          ) : (
            <>
              <Text style={[styles.section, { color: colors.muted }]}>THE SERVER KNOWS</Text>
              <View style={[styles.rows, { backgroundColor: colors.panelAlt }]}>
                {rows.map((row, i) => (
                  <View key={`${row.label}-${i}`} style={[styles.row, i > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
                    <Text style={[styles.label, { color: row.readable ? colors.danger : colors.muted }]}>
                      {row.label}
                      {row.readable ? " · readable" : ""}
                    </Text>
                    <Text selectable style={[row.mono ? styles.mono : styles.value, { color: colors.text }]}>
                      {row.value}
                    </Text>
                  </View>
                ))}
              </View>

              {target.kind === "message" && "message" in view && view.message.content.length > CIPHERTEXT_PREVIEW ? (
                <PressScale scale={0.96} onPress={() => setFull((shown) => !shown)} accessibilityRole="button">
                  <Text style={[styles.link, { color: colors.accent }]}>
                    {full ? "Show less of the ciphertext" : "Show the whole ciphertext"}
                  </Text>
                </PressScale>
              ) : null}

              {hidden.length ? (
                <>
                  <Text style={[styles.section, { color: colors.muted }]}>ONLY THE CHAT CAN READ</Text>
                  <View style={styles.hidden}>
                    {hidden.map((item) => (
                      <View key={item} style={styles.hiddenItem}>
                        <Ionicons name="lock-closed" size={14} color={colors.online} style={styles.lock} />
                        <Text style={[styles.value, styles.flex, { color: colors.text }]}>{item}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              {room ? (
                <Text style={[styles.text, { color: colors.danger }]}>
                  Anonymous rooms are not end-to-end encrypted: the server keeps the room&apos;s key and
                  can read everything in it. It also knows which account is behind each name; the
                  others in the room do not.
                </Text>
              ) : null}

              {readable ? (
                <Text style={[styles.text, { color: colors.textSoft }]}>
                  Reactions are not encrypted: the server keeps the emoji and who chose it.
                </Text>
              ) : null}

              <Text style={[styles.text, { color: colors.textSoft }]}>
                While you are connected the server also sees your IP address, and its request logs
                record it. It does not see your OstrichID, your private key or anything in the
                encrypted parts above.
              </Text>
            </>
          )}

          <View style={styles.buttons}>
            <Reveal kind="fade" collapse={false}>
              {view ? (
              <Button
                title={raw ? "Show as a list" : "Show as JSON"}
                icon="code-slash-outline"
                variant="secondary"
                style={styles.flex}
                onPress={() => setRaw((shown) => !shown)}
              />
            ) : null}
            </Reveal>
            <Button title="Close" variant="secondary" style={styles.flex} onPress={close} />
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
    padding: 24,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },

  card: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "90%",
    borderRadius: radius.card,
    overflow: "hidden",
  },

  body: {
    padding: 22,
    gap: 12,
  },

  icon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },

  title: {
    fontSize: 18,
    fontWeight: "700",
  },

  text: {
    fontSize: 14,
    lineHeight: 20,
  },

  loading: {
    paddingVertical: 24,
  },

  section: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginTop: 4,
  },

  rows: {
    borderRadius: 12,
    paddingHorizontal: 12,
  },

  row: {
    paddingVertical: 9,
    gap: 2,
  },

  label: {
    fontSize: 12,
  },

  value: {
    fontSize: 14,
    lineHeight: 19,
  },

  mono: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "monospace",
  },

  rawJson: {
    borderRadius: 12,
    padding: 12,
  },

  link: {
    fontSize: 14,
    fontWeight: "600",
  },

  hidden: {
    gap: 6,
  },

  hiddenItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },

  lock: {
    marginTop: 3,
  },

  buttons: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },

  flex: {
    flex: 1,
  },
});
