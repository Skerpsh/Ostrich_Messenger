import { useLayoutEffect, useMemo, useRef, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View } from "react-native";
// The bubble's entrance; the swipe to reply uses React Native's Animated.
import Reanimated from "react-native-reanimated";
import AttachmentView from "./attachment-view";
import LinkCard from "./link-card";
import DevBadge from "@/ui/dev-badge";
import IconButton from "@/ui/icon-button";
import MarkupText from "./markup-text";
import { OpenedNote, SealedEnvelope, type LetterState } from "./sealed-letter";
import { useAppTheme } from "@/ui/theme";
import type { Reaction } from "@/api/api";
import { formatDuration } from "./attachments";
import { callEntryText } from "@/features/calls/calls";
import { formatOstrichId, isLegacyMessage } from "@/crypto/crypto";
import type { MessageRow } from "./chat-rows";
import type { Attachment, CallEntry, LookEntry } from "./payload";
import { formatTime, previewText } from "@/ui/format";
import { enterStyle, useMotion } from "@/ui/motion";
import { messagePreview } from "@/features/chats/preview";
import { TOUCH_UI } from "@/platform/touch";
import type { Shown } from "./use-chat-crypto";
import { personaColor, personaTag } from "@/features/rooms/persona";
import { accentVariant, isAccentChoice, radius, type AccentChoice } from "@/ui/colors";

// Touch screens (platform/touch.ts): swipe left to reply, long press for the
// menu. Mouse users get a reply button on hover instead, and can select
// text by dragging.

// How far a bubble follows the finger, and how far it must go to reply.
const SWIPE_MAX = 72;
const SWIPE_REPLY_AT = 48;

export default function MessageBubble({
  row,
  read,
  ownId,
  senderName,
  persona = false,
  text,
  quoteText,
  sending,
  highlighted,
  onReply,
  onMenu,
  onQuotePress,
  onReact,
  onError,
  onOpenPhoto,
  onCall,
  onLook,
  animateIn = false,
  selected,
  onToggle,
  letter,
}: {
  row: MessageRow;
  read: boolean;
  ownId: string | undefined;
  // Groups: who wrote it, over the first of their bubbles in a row.
  senderName?: string;
  // Rooms: the sender is a persona, shown by its own color and tag.
  persona?: boolean;
  // The decrypted message and the message it replies to.
  text: Shown;
  quoteText: Shown | null;
  // Own message still on its way, or refused by the server.
  sending?: "sending" | "failed";
  highlighted: boolean;
  onReply: () => void;
  // Long press / right click: the message's actions.
  onMenu: () => void;
  onQuotePress: (messageId: string) => void;
  // Tapping a reaction under the message toggles yours.
  onReact: (emoji: string) => void;
  // A file could not be loaded or saved.
  onError: (message: string) => void;
  // A photo of the message was tapped.
  onOpenPhoto?: (attachment: Attachment) => void;
  // A call entry was tapped: call back.
  // Calls back (video: as a video call).
  onCall?: (video: boolean) => void;
  // A chat look entry was tapped: open the chat's "Wallpaper & color".
  onLook?: () => void;
  // Arrived while the chat is open: comes in animated.
  animateIn?: boolean;
  // Choosing messages: whether this one is chosen (undefined: not
  // choosing); a tap chooses it or not.
  selected?: boolean;
  onToggle?: () => void;
  // A sealed letter's opening (sealed-letter.tsx).
  letter?: LetterState;
}) {
  const selecting = selected !== undefined;
  const { colors, textScale } = useAppTheme();
  const motion = useMotion();
  // Settings → Personalization → Text size.
  const contentSize = { fontSize: 16 * textScale, lineHeight: 22 * textScale };
  const [hovered, setHovered] = useState(false);
  const { message, own, joinedAbove, joinedBelow } = row;
  const swipe = useSwipeToReply(onReply);
  const quote = message.reply_to;

  // The corners next to the bubble's neighbours in its group are smaller.
  const side = own ? "Right" : "Left";
  const corners = {
    [`borderTop${side}Radius`]: joinedAbove ? radius.bubbleJoined : radius.bubble,
    [`borderBottom${side}Radius`]: joinedBelow ? radius.bubbleJoined : radius.bubble,
  };

  const textColor = own ? colors.onAccent : colors.text;
  const metaColor = own ? colors.onAccent : colors.muted;

  // Mouse: a reply button next to the hovered bubble.
  const replyButton =
    !TOUCH_UI && hovered ? (
      <IconButton
        icon="arrow-undo-outline"
        label="Reply"
        size={18}
        color={colors.muted}
        onPress={onReply}
        style={styles.hoverReply}
      />
    ) : null;

  return (
    <Reanimated.View
      // pointerenter/leave are not fired when the pointer moves onto the
      // reply button inside the row, so the button stays while used.
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      {...swipe.handlers}
      style={[
        animateIn && enterStyle("bubble", motion),
        { transformOrigin: own ? "right bottom" : "left bottom" },
        styles.row,
        own ? styles.rowOwn : styles.rowOther,
        { marginTop: joinedAbove ? 2 : 10 },
        (highlighted || selected) && { backgroundColor: colors.accentSoft },
        styles.rowHighlightable,
        TOUCH_UI && styles.rowTouch,
      ]}
    >
      {selecting ? (
        <Pressable
          onPress={onToggle}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel="Choose the message"
          style={styles.check}
        >
          <Ionicons
            name={selected ? "checkmark-circle" : "ellipse-outline"}
            size={22}
            color={selected ? colors.accent : colors.muted}
          />
        </Pressable>
      ) : null}

      {own && !selecting ? replyButton : null}

      <Animated.View
        style={[styles.bubbleWrap, { transform: [{ translateX: swipe.offset }] }]}
      >
        <Pressable
          onPress={selecting ? onToggle : undefined}
          onLongPress={selecting ? onToggle : onMenu}
          delayLongPress={350}
          // Web: right click opens the message menu instead of the browser's.
          {...({
            onContextMenu: (event: { preventDefault: () => void }) => {
              event.preventDefault();
              (selecting ? onToggle : onMenu)?.();
            },
          } as object)}
          style={[
            styles.bubble,
            corners,
            { backgroundColor: own ? colors.accent : colors.panel },
          ]}
        >
          {senderName && !own && !joinedAbove ? (
            persona ? (
              <Text numberOfLines={1} style={[styles.sender, { color: personaColor(message.sender_id) }]}>
                {senderName} <Text style={{ color: colors.muted, fontWeight: "400" }}>#{personaTag(message.sender_id)}</Text>
              </Text>
            ) : (
              <Text numberOfLines={1} style={[styles.sender, { color: colors.accent }]}>
                @{senderName}
              </Text>
            )
          ) : null}
          {quote && quoteText ? (
            <Pressable
              onPress={() => onQuotePress(quote.id)}
              accessibilityRole="button"
              accessibilityLabel={`Reply to ${quote.sender_username}: ${quoteText.text}`}
              style={[
                styles.quote,
                {
                  borderLeftColor: own ? colors.onAccent : colors.accent,
                  backgroundColor: own ? "rgba(0, 0, 0, 0.12)" : colors.accentSoft,
                },
              ]}
            >
              <View style={styles.quoteNameRow}>
                <Text
                  numberOfLines={1}
                  style={[styles.quoteName, { color: own ? colors.onAccent : colors.accent }]}
                >
                  {quote.sender_id === ownId ? "You" : quote.sender_username}
                </Text>
                {quote.sender_is_developer ? <DevBadge /> : null}
              </View>
              <Text
                numberOfLines={2}
                style={[
                  styles.quoteText,
                  { fontSize: 13 * textScale, lineHeight: 18 * textScale },
                  { color: own ? colors.onAccent : colors.textSoft },
                  quoteText.status === "error" && styles.unreadable,
                ]}
              >
                {previewText(messagePreview(quoteText))}
              </Text>
            </Pressable>
          ) : null}

          {message.sent_after_days ? (
            <View style={styles.automatic}>
              <Ionicons name="hourglass-outline" size={12} color={own ? colors.onAccent : colors.accent} />
              <Text style={[styles.forwarded, styles.automaticText, { color: own ? colors.onAccent : colors.accent }]}>
                Sent automatically: @{message.sender_username} had not opened Ostrich for {message.sent_after_days} days
              </Text>
            </View>
          ) : null}
          {text.status === "ok" && text.sealed?.opened ? <OpenedNote letter={text.sealed} own={own} /> : null}
          {text.forwardedFrom ? (
            <Text style={[styles.forwarded, { color: own ? colors.onAccent : colors.accent }]}>
              Forwarded from @{text.forwardedFrom}
            </Text>
          ) : null}
          {text.attachments?.length ? (
            <AttachmentView attachments={text.attachments} own={own} onError={onError} onOpenPhoto={onOpenPhoto} />
          ) : null}
          {text.status === "ok" && text.sealed && !text.sealed.opened ? (
            <SealedEnvelope letter={text.sealed} state={letter} own={own} deliverAt={message.deliver_at} />
          ) : text.status === "ok" && text.call ? (
            <CallEntryView entry={text.call} own={own} onCall={selecting ? undefined : onCall} />
          ) : text.status === "ok" && text.look ? (
            <LookEntryView entry={text.look} label={text.text} own={own} onPress={selecting ? undefined : onLook} />
          ) : text.status === "ok" && !text.text && text.attachments?.length ? null : text.status === "ok" ? (
            <MarkupText
              text={text.text}
              // Touch screens copy through the long-press menu; selecting
              // text there would take over the long press.
              selectable={!TOUCH_UI}
              style={[styles.content, contentSize, { color: textColor }]}
              codeBackground={own ? "rgba(0, 0, 0, 0.16)" : colors.panelAlt}
              linkColor={own ? colors.onAccent : colors.accent}
            />
          ) : (
            <Text
              selectable={!TOUCH_UI}
              style={[styles.content, contentSize, { color: textColor }, text.status === "error" && styles.unreadable]}
            >
              {text.text}
            </Text>
          )}
          {text.status === "ok" && text.link ? <LinkCard link={text.link} own={own} /> : null}
          {text.status === "ok" && text.heir ? (
            <View style={[styles.heir, { backgroundColor: own ? "rgba(0, 0, 0, 0.14)" : colors.panelAlt }]}>
              <Text style={[styles.heirTitle, { color: textColor }]}>
                🔑 {own ? "Your OstrichID" : `@${message.sender_username} left you their OstrichID`}
              </Text>
              <Text selectable style={[styles.heirId, { color: textColor }]}>
                {formatOstrichId(text.heir)}
              </Text>
              <Text style={[styles.heirText, { color: own ? colors.onAccent : colors.muted }]}>
                With their username and password it opens their account and all their messages. Keep it
                somewhere safe.
              </Text>
            </View>
          ) : null}
          {message.reactions.length > 0 ? (
            <View style={styles.reactions}>
              {groupReactions(message.reactions, ownId).map(({ emoji, count, mine }) => (
                <Pressable
                  key={emoji}
                  onPress={() => onReact(emoji)}
                  accessibilityRole="button"
                  accessibilityLabel={`${emoji} ${count}${mine ? ", yours" : ""}`}
                  style={[
                    styles.reactionChip,
                    {
                      backgroundColor: own
                        ? "rgba(0, 0, 0, 0.14)"
                        : mine
                          ? colors.accentSoft
                          : colors.panelAlt,
                      borderColor: mine ? (own ? colors.onAccent : colors.accent) : "transparent",
                    },
                  ]}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                  {count > 1 ? (
                    <Text style={[styles.reactionCount, { color: textColor }]}>{count}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.bubbleMeta}>
            {text.status === "plain" ? (
              // Not end-to-end encrypted: from before encryption, or not
              // from the other member at all (only the server could have
              // put it there).
              <View
                style={styles.plain}
                accessibilityLabel="not end-to-end encrypted"
                {...({ title: "Not end-to-end encrypted" } as object)}
              >
                <Ionicons name="lock-open-outline" size={11} color={metaColor} />
                <Text style={[styles.time, { color: metaColor }]}>not encrypted</Text>
              </View>
            ) : null}
            {text.status === "ok" && isLegacyMessage(message.content) ? (
              // Older clients' format, bound to the chat only: the server
              // could have moved it to another sender or sent it again.
              <View
                style={styles.plain}
                accessibilityLabel="old format, sender not verified"
                {...({ title: "Old message format: the sender is not verified" } as object)}
              >
                <Ionicons name="alert-circle-outline" size={11} color={metaColor} />
                <Text style={[styles.time, { color: metaColor }]}>old format</Text>
              </View>
            ) : null}
            {message.edited_at ? (
              <Text style={[styles.time, { color: metaColor }]}>edited</Text>
            ) : null}
            <Text style={[styles.time, { color: metaColor }]}>
              {formatTime(message.created_at)}
            </Text>
            {sending === "failed" ? (
              <Text style={[styles.time, styles.failed, { color: metaColor }]}>⚠ Not sent</Text>
            ) : sending ? (
              <Ionicons name="time-outline" size={13} color={metaColor} accessibilityLabel="sending" />
            ) : own ? (
              <Ionicons
                name={read ? "checkmark-done" : "checkmark"}
                size={14}
                color={metaColor}
                accessibilityLabel={read ? "read" : "sent"}
              />
            ) : null}
          </View>
        </Pressable>
      </Animated.View>

      {own || selecting ? null : replyButton}

      {TOUCH_UI ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.swipeIcon,
            { backgroundColor: colors.panelAlt, opacity: swipe.progress, transform: [{ scale: swipe.progress }] },
          ]}
        >
          <Ionicons name="arrow-undo" size={18} color={colors.accent} />
        </Animated.View>
      ) : null}
    </Reanimated.View>
  );
}

// Reactions as chips: emoji, how many, whether one is yours.
// "Outgoing call · 4:12", "Missed call": tapping it calls back.
function CallEntryView({ entry, own, onCall }: { entry: CallEntry; own: boolean; onCall?: (video: boolean) => void }) {
  const { colors } = useAppTheme();
  const missed = entry.outcome !== "answered";
  const color = own ? colors.onAccent : missed ? colors.danger : colors.text;
  const label = callEntryText(entry, own);
  const detail =
    entry.outcome === "answered" && entry.duration ? formatDuration(entry.duration) : onCall ? "Tap to call back" : "";

  return (
    <Pressable
      onPress={() => onCall?.(entry.video === true)}
      disabled={!onCall}
      accessibilityRole={onCall ? "button" : undefined}
      accessibilityLabel={onCall ? `${label}. Call back` : label}
      style={styles.callEntry}
    >
      <View
        style={[
          styles.callIcon,
          { backgroundColor: own ? "rgba(0, 0, 0, 0.14)" : missed ? "rgba(255, 107, 107, 0.14)" : colors.panelAlt },
        ]}
      >
        <Ionicons
          name={entry.video ? (missed ? "videocam-outline" : "videocam") : missed ? "call-outline" : "call"}
          size={18}
          color={color}
        />
      </View>
      <View>
        <Text style={[styles.callLabel, { color }]}>{label}</Text>
        {detail ? (
          <Text style={[styles.callDetail, { color: own ? colors.onAccent : colors.muted }]}>{detail}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// "🎨 Set a new wallpaper for the chat": a small preview of the colors.
function LookEntryView({
  entry,
  label,
  own,
  onPress,
}: {
  entry: LookEntry;
  label: string;
  own: boolean;
  onPress?: () => void;
}) {
  const { colors, mode } = useAppTheme();
  const accent = isAccentChoice(entry.accent) ? accentVariant(entry.accent, mode).accent : null;
  const color = own ? colors.onAccent : colors.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      style={styles.callEntry}
    >
      <View style={[styles.callIcon, { backgroundColor: accent ?? (own ? "rgba(0, 0, 0, 0.14)" : colors.panelAlt) }]}>
        <Ionicons
          name={entry.wallpaper?.pattern === "photo" ? "image" : "color-palette"}
          size={18}
          color={accent ? accentVariant(entry.accent as AccentChoice, mode).onAccent : color}
        />
      </View>
      <View style={styles.lookText}>
        <Text style={[styles.callLabel, { color }]}>{label.replace(/^🎨\s*/, "")}</Text>
        {onPress ? (
          <Text style={[styles.callDetail, { color: own ? colors.onAccent : colors.muted }]}>
            Tap to change yours
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function groupReactions(reactions: Reaction[], ownId: string | undefined) {
  const groups = new Map<string, { emoji: string; count: number; mine: boolean }>();

  for (const r of reactions) {
    const group = groups.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    group.count++;
    group.mine ||= r.user_id === ownId;
    groups.set(r.emoji, group);
  }

  return [...groups.values()];
}

// Swipe a bubble to the left to reply: it follows the finger up to
// SWIPE_MAX, an arrow fades in on the right, and letting go past
// SWIPE_REPLY_AT replies. Only clearly horizontal moves to the left are
// taken, so scrolling the chat keeps working.
function useSwipeToReply(onReply: () => void) {
  const [offset] = useState(() => new Animated.Value(0));
  const onReplyRef = useRef(onReply);

  useLayoutEffect(() => {
    onReplyRef.current = onReply;
  });

  const handlers = useMemo(() => {
    if (!TOUCH_UI) {
      return {};
    }

    const settle = () =>
      Animated.spring(offset, {
        toValue: 0,
        useNativeDriver: Platform.OS !== "web",
        speed: 20,
        bounciness: 6,
      }).start();

    const isSwipe = (dx: number, dy: number) =>
      dx < -10 && Math.abs(dx) > Math.abs(dy) * 1.5;

    // The ref is read in the gesture handlers, not while rendering.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      // Capture: take the gesture from the bubble's long press once the
      // finger clearly moves left.
      onMoveShouldSetPanResponderCapture: (_, g) => isSwipe(g.dx, g.dy),
      onMoveShouldSetPanResponder: (_, g) => isSwipe(g.dx, g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) =>
        offset.setValue(Math.max(-SWIPE_MAX, Math.min(0, g.dx))),
      onPanResponderRelease: (_, g) => {
        if (g.dx <= -SWIPE_REPLY_AT) {
          onReplyRef.current();
        }

        settle();
      },
      onPanResponderTerminate: settle,
    }).panHandlers;
  }, [offset]);

  // 0 at rest, 1 once the swipe would reply.
  const progress = useMemo(
    () =>
      offset.interpolate({
        inputRange: [-SWIPE_REPLY_AT, 0],
        outputRange: [1, 0],
        extrapolate: "clamp",
      }),
    [offset],
  );

  return { offset, progress, handlers };
}

const styles = StyleSheet.create({
  callEntry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 2,
    paddingRight: 6,
  },

  callIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  callLabel: {
    fontSize: 15,
    fontWeight: "600",
  },

  lookText: {
    flexShrink: 1,
  },

  callDetail: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },

  check: {
    alignSelf: "center",
    paddingHorizontal: 6,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  rowHighlightable: {
    borderRadius: radius.bubble,
  },

  // Browsers keep vertical scrolling and leave horizontal moves to the
  // swipe.
  rowTouch: Platform.OS === "web" ? ({ touchAction: "pan-y" } as object) : {},

  rowOwn: {
    justifyContent: "flex-end",
    paddingLeft: 48,
  },

  rowOther: {
    justifyContent: "flex-start",
    paddingRight: 48,
  },

  bubbleWrap: {
    flexShrink: 1,
    maxWidth: 560,
  },

  bubble: {
    // Wrap long text inside the row instead of overflowing it.
    flexShrink: 1,
    maxWidth: 560,
    borderRadius: radius.bubble,
    paddingHorizontal: 12,
    paddingTop: 7,
    paddingBottom: 5,
  },

  swipeIcon: {
    position: "absolute",
    right: 4,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  hoverReply: {
    opacity: 0.9,
  },

  quote: {
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 5,
    marginTop: 2,
  },

  quoteNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },

  quoteName: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "700",
  },

  quoteText: {
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.9,
  },

  content: {
    fontSize: 16,
    lineHeight: 22,
  },

  sender: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 2,
  },

  forwarded: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 2,
  },

  automatic: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  automaticText: {
    flexShrink: 1,
  },

  heir: {
    borderRadius: 10,
    padding: 10,
    gap: 4,
    marginTop: 6,
  },

  heirTitle: {
    fontSize: 14,
    fontWeight: "600",
  },

  heirId: {
    fontSize: 16,
    fontFamily: "monospace",
    letterSpacing: 1,
  },

  heirText: {
    fontSize: 12,
    lineHeight: 16,
  },

  failed: {
    opacity: 1,
    fontWeight: "700",
  },

  unreadable: {
    fontStyle: "italic",
    opacity: 0.8,
  },

  reactions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },

  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },

  reactionEmoji: {
    fontSize: 14,
  },

  reactionCount: {
    fontSize: 12,
    fontWeight: "600",
  },

  bubbleMeta: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 3,
    marginTop: 1,
  },

  plain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginRight: 2,
  },

  time: {
    fontSize: 11,
    opacity: 0.75,
  },
});
