import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import AnimatedPressable from "@/ui/animated-pressable";
import Button from "@/ui/button";
import TextField from "@/ui/text-field";
import { getKeys, type Chat } from "@/api/api";
import { useAuth, useCurrentUser, usePrivateKey } from "@/features/auth/auth";
import {
  formatSize,
  MAX_ATTACHMENTS,
  uploadAttachment,
  type PickedFile,
} from "@/features/chat/attachments";
import ForwardPicker from "@/features/chat/forward-picker";
import { encodePayload, type Attachment } from "@/features/chat/payload";
import { pickDocument, pickPhoto } from "@/features/chat/pick-attachment";
import { encryptForChat } from "@/features/chat/use-chat-crypto";
import { chatTitle } from "@/features/groups/groups";
import {
  deriveFromOstrichId,
  newMessageId,
  normalizeOstrichId,
  openPrivateKey,
  publicKeyOf,
} from "@/crypto/crypto";
import { useAppTheme } from "@/ui/theme";
import { useEscape } from "@/ui/keys";
import { enterStyle, leaveStyle, useLeave } from "@/ui/motion";
import { radius } from "@/ui/colors";
import { disappearApi, setDisappearStatus } from "./disappear";

// Writing a message of "If I disappear" (or changing one): to a chat or a
// group, with files, and the user's OstrichID if they choose. Encrypted
// here for that chat, like any message.
export type DisappearDraft = {
  id: string;
  chat: Chat | null;
  text: string;
  attachments: Attachment[];
  heir: boolean;
  // The OstrichID already in it (kept unless typed again).
  heirId?: string;
};

export function newDraft(): DisappearDraft {
  return {
    id: newMessageId(),
    chat: null,
    text: "",
    attachments: [],
    heir: false,
  };
}

// Not rooms either: their member is a persona, made at each entry.
const notSaved = (chat: Chat) => chat.type !== "saved" && chat.type !== "room";

export default function DisappearEditor({
  draft,
  onClose,
}: {
  draft: DisappearDraft;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  const { withToken } = useAuth();
  const user = useCurrentUser();
  const privateKey = usePrivateKey();
  const { motion, leaving, leave } = useLeave();
  const close = () => leave(onClose);
  useEscape(true, close);

  const [chat, setChat] = useState(draft.chat);
  const [picking, setPicking] = useState(false);
  const [text, setText] = useState(draft.text);
  const [kept, setKept] = useState(draft.attachments);
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [heir, setHeir] = useState(draft.heir);
  const [ostrichId, setOstrichId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const files = kept.length + picked.length;

  const pick = async (kind: "photo" | "file") => {
    try {
      const file = kind === "photo" ? await pickPhoto() : await pickDocument();

      if (file) {
        setPicked((current) =>
          [...current, file].slice(0, MAX_ATTACHMENTS - kept.length),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add the file");
    }
  };

  // The OstrichID typed, if it is this account's: it must open the
  // account's private key.
  const checkedOstrichId = async () => {
    const id = normalizeOstrichId(ostrichId);

    if (!id || !privateKey) {
      throw new Error("Type your OstrichID, 20 characters");
    }

    const keys = await withToken(getKeys);

    try {
      if (
        publicKeyOf(
          openPrivateKey(deriveFromOstrichId(id), keys.encrypted_private_key),
        ) === publicKeyOf(privateKey)
      ) {
        return id;
      }
    } catch {
      // Not this account's.
    }

    throw new Error("This is not your OstrichID");
  };

  const save = async () => {
    if (!user || !privateKey) {
      return;
    }

    if (!chat) {
      setError("Choose whom it goes to");
      return;
    }

    if (!text.trim() && files === 0 && !heir) {
      setError("Write the message");
      return;
    }

    setError(null);
    setSaving(true);

    try {
      // A kept OstrichID is not typed again (it is in the draft's message).
      const heirId = heir
        ? draft.heir && !ostrichId
          ? draft.heirId
          : await checkedOstrichId()
        : undefined;
      const uploaded: Attachment[] = [];

      for (const file of picked) {
        uploaded.push(
          await withToken((token) => uploadAttachment(token, file)),
        );
      }

      const attachments = [...kept, ...uploaded];
      const content = encryptForChat(
        chat,
        encodePayload({
          text: text.trim(),
          attachments,
          ...(heirId ? { heir: heirId } : {}),
        }),
        { id: draft.id, sender_id: user.id },
        privateKey,
      );
      const status = await withToken((token) =>
        disappearApi.saveMessage(token, {
          id: draft.id,
          chatId: chat.id,
          content,
          attachments: attachments.map((a) => a.id),
        }),
      );

      setDisappearStatus(status);
      leave(onClose);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save the message");
      setSaving(false);
    }
  };

  return (
    <AnimatedPressable
      style={[
        styles.backdrop,
        leaving ? leaveStyle("fade", motion) : enterStyle("fade", motion),
      ]}
      pointerEvents={leaving ? "none" : "auto"}
      onPress={close}
      accessibilityLabel="Close"
    >
      <AnimatedPressable
        style={[
          styles.card,
          { backgroundColor: colors.panel },
          leaving ? leaveStyle("pop", motion) : enterStyle("pop", motion),
        ]}
        onPress={() => {}}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.title, { color: colors.text }]}>
            A message if you disappear
          </Text>

          <Pressable
            onPress={() => setPicking(true)}
            accessibilityRole="button"
            style={({ hovered, pressed }) => [
              styles.to,
              {
                backgroundColor:
                  hovered || pressed ? colors.hover : colors.panelAlt,
              },
            ]}
          >
            <Ionicons
              name={
                chat?.type === "group" ? "people-outline" : "person-outline"
              }
              size={18}
              color={colors.muted}
            />
            <Text
              style={[
                styles.toText,
                { color: chat ? colors.text : colors.muted },
              ]}
              numberOfLines={1}
            >
              {chat ? `To ${chatTitle(chat)}` : "Choose whom it goes to"}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.muted} />
          </Pressable>

          <TextField
            label="Message"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={4096}
            placeholder="What they should know…"
            style={styles.message}
          />

          {[
            ...kept.map((a) => ({ name: a.name, size: a.size })),
            ...picked.map((f) => ({ name: f.name, size: f.bytes.length })),
          ].map((file, i) => (
            <View
              key={i}
              style={[styles.file, { backgroundColor: colors.panelAlt }]}
            >
              <Ionicons
                name="document-outline"
                size={18}
                color={colors.muted}
              />
              <Text
                numberOfLines={1}
                style={[styles.fileName, { color: colors.text }]}
              >
                {file.name}
              </Text>
              <Text style={[styles.fileSize, { color: colors.muted }]}>
                {formatSize(file.size)}
              </Text>
              <Pressable
                onPress={() =>
                  i < kept.length
                    ? setKept((current) => current.filter((_, j) => j !== i))
                    : setPicked((current) =>
                        current.filter((_, j) => j !== i - kept.length),
                      )
                }
                accessibilityRole="button"
                accessibilityLabel={`Remove ${file.name}`}
                hitSlop={8}
              >
                <Ionicons name="close" size={16} color={colors.muted} />
              </Pressable>
            </View>
          ))}

          {files < MAX_ATTACHMENTS ? (
            <View style={styles.row}>
              <Button
                title="Photo"
                icon="image-outline"
                variant="secondary"
                style={styles.flex}
                onPress={() => pick("photo")}
              />
              <Button
                title="File"
                icon="document-outline"
                variant="secondary"
                style={styles.flex}
                onPress={() => pick("file")}
              />
            </View>
          ) : null}

          <View style={styles.heirRow}>
            <View style={styles.flex}>
              <Text style={[styles.heirTitle, { color: colors.text }]}>
                Leave my OstrichID
              </Text>
              <Text style={[styles.text, { color: colors.muted }]}>
                Off unless you turn it on.
              </Text>
            </View>
            <Switch value={heir} onValueChange={setHeir} />
          </View>

          {heir ? (
            <>
              <Text style={[styles.text, { color: colors.danger }]}>
                Whoever reads this message gets your OstrichID. With your
                password too, they can log in as you and read all your messages,
                and an OstrichID cannot be changed. If it goes off by mistake,
                they keep it. To log in they also need your password: write it
                in the message only if you mean it.
              </Text>
              <TextField
                label={
                  draft.heir
                    ? "Your OstrichID (kept; type it to change)"
                    : "Your OstrichID"
                }
                value={ostrichId}
                onChangeText={setOstrichId}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                autoCapitalize="characters"
                maxLength={29}
              />
            </>
          ) : null}

          {error ? (
            <Text style={[styles.text, { color: colors.danger }]}>{error}</Text>
          ) : null}

          <View style={styles.row}>
            <Button
              title="Cancel"
              variant="secondary"
              style={styles.flex}
              onPress={close}
            />
            <Button
              title="Save"
              icon="checkmark"
              style={styles.flex}
              loading={saving}
              onPress={save}
            />
          </View>
        </ScrollView>
      </AnimatedPressable>

      {picking ? (
        <ForwardPicker
          title="Send it to…"
          allow={notSaved}
          onPick={(target) => {
            setChat(target);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
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
    maxHeight: "92%",
    borderRadius: radius.card,
    overflow: "hidden",
  },

  body: {
    padding: 22,
    gap: 14,
  },

  title: {
    fontSize: 18,
    fontWeight: "700",
  },

  text: {
    fontSize: 13,
    lineHeight: 18,
  },

  to: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },

  toText: {
    flex: 1,
    fontSize: 15,
  },

  message: {
    minHeight: 120,
    textAlignVertical: "top",
  },

  file: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  fileName: {
    flex: 1,
    fontSize: 14,
  },

  fileSize: {
    fontSize: 12,
  },

  heirRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  heirTitle: {
    fontSize: 15,
    fontWeight: "600",
  },

  row: {
    flexDirection: "row",
    gap: 8,
  },

  flex: {
    flex: 1,
  },
});
