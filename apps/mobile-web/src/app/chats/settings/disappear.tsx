import { useEffect, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Button from "@/ui/button";
import TextField from "@/ui/text-field";
import { type DisappearStatus } from "@/api/api";
import { useAuth, useCurrentUser, usePrivateKey } from "@/features/auth/auth";
import { useChats } from "@/features/chats/chats";
import { messagePreview } from "@/features/chats/preview";
import { showMessage } from "@/features/chat/use-chat-crypto";
import { chatTitle, useAllGroupKeys } from "@/features/groups/groups";
import { SettingsPage } from "@/features/settings/page";
import {
  Divider,
  Row,
  Section,
  styles as settingsStyles,
} from "@/features/settings/ui";
import DisappearEditor, {
  newDraft,
  type DisappearDraft,
} from "@/features/disappear/disappear-editor";
import {
  disappearApi,
  setDisappearStatus,
  useDisappearStatus,
} from "@/features/disappear/disappear";
import { formatDate } from "@/ui/format";
import { useAppTheme } from "@/ui/theme";
import Reveal, { Overlay } from "@/ui/reveal";
import PressScale from "@/ui/press-scale";

const PRESETS = [7, 30, 90, 180, 365];
const MIN_DAYS = 2;
const MAX_DAYS = 3650;

export default function DisappearSettings() {
  const { colors } = useAppTheme();
  const { withToken } = useAuth();
  const user = useCurrentUser();
  const privateKey = usePrivateKey();
  const status = useDisappearStatus();
  const { chats } = useChats();
  useAllGroupKeys(chats);

  const on = Boolean(status?.switch && !status.switch.triggered_at);
  // Typed, or the switch's.
  const [typedDays, setDays] = useState<string | null>(null);
  const days = typedDays ?? (status?.switch ? String(status.switch.days) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [editing, setEditing] = useState<DisappearDraft | null>(null);

  useEffect(() => {
    withToken(disappearApi.get).then(setDisappearStatus, () => {});
  }, [withToken]);

  const run = async (change: (token: string) => Promise<DisappearStatus>) => {
    setError(null);
    setBusy(true);

    try {
      setDisappearStatus(await withToken(change));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const chosenDays = Number(days);
  const daysProblem =
    !Number.isInteger(chosenDays) ||
    chosenDays < MIN_DAYS ||
    chosenDays > MAX_DAYS
      ? `From ${MIN_DAYS} to ${MAX_DAYS} days`
      : null;

  const chatOf = (id: string) => chats?.find((chat) => chat.id === id) ?? null;

  // A saved message as the editor's draft (decrypted here).
  const draftOf = (
    message: DisappearStatus["messages"][number],
  ): DisappearDraft | null => {
    const chat = chatOf(message.chat_id);

    if (!chat || !user) {
      return null;
    }

    const shown = showMessage(
      { id: message.id, sender_id: user.id, content: message.content },
      privateKey,
      chat,
      user.id,
    );

    return shown.status === "ok"
      ? {
          id: message.id,
          chat,
          text: shown.text,
          attachments: shown.attachments ?? [],
          heir: Boolean(shown.heir),
          heirId: shown.heir,
        }
      : { ...newDraft(), id: message.id, chat };
  };

  // The editor is over the whole screen, not inside the page's scrolling.
  return (
    <View style={styles.screen}>
      <SettingsPage title="If I disappear">
        <Section
          footer={`If you do not open Ostrich for the days you choose, on any device, the messages below are sent for you, marked as sent automatically. A week, a day and an hour before, your phones are notified; opening Ostrich starts the days again. The messages are encrypted here like any other: the server keeps them as ciphertext and only knows whom they go to and when.`}
        >
          <View style={settingsStyles.form}>
            {status?.switch?.triggered_at ? (
              <Text
                style={[settingsStyles.formMessage, { color: colors.accent }]}
              >
                It went off on {formatDate(status.switch.triggered_at)}: your
                messages were sent. Turn it on again to write new ones.
              </Text>
            ) : on && status?.switch?.due_at ? (
              <Text style={[settingsStyles.formText, { color: colors.text }]}>
                On. You last opened Ostrich on{" "}
                {formatDate(status.switch.last_active_at)}; without you, it goes
                off on {formatDate(status.switch.due_at)}.
              </Text>
            ) : (
              <Text
                style={[settingsStyles.formText, { color: colors.textSoft }]}
              >
                Off.
              </Text>
            )}

            <View style={styles.presets}>
              {PRESETS.map((preset) => (
                <Pressable
                  key={preset}
                  onPress={() => setDays(String(preset))}
                  accessibilityRole="button"
                  style={({ hovered, pressed }) => [
                    styles.preset,
                    {
                      backgroundColor:
                        String(preset) === days
                          ? colors.accentSoft
                          : hovered || pressed
                            ? colors.hover
                            : colors.panelAlt,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.presetText,
                      {
                        color:
                          String(preset) === days ? colors.accent : colors.text,
                      },
                    ]}
                  >
                    {preset === 365 ? "A year" : `${preset} days`}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextField
              label="Days without Ostrich"
              value={days}
              onChangeText={(value) => setDays(value.replace(/\D/g, ""))}
              inputMode="numeric"
              maxLength={4}
              placeholder="30"
              hint={days && daysProblem ? daysProblem : undefined}
            />

            <Reveal>
              {error ? (
              <Text
                style={[settingsStyles.formMessage, { color: colors.danger }]}
              >
                {error}
              </Text>
            ) : null}
            </Reveal>

            <Button
              title={on ? "Save the days" : "Turn on"}
              icon={on ? "checkmark" : "timer-outline"}
              loading={busy}
              disabled={
                daysProblem !== null ||
                (on && chosenDays === status?.switch?.days)
              }
              onPress={() => run((token) => disappearApi.set(token, chosenDays))}
            />
            <Reveal>
              {on || status?.switch?.triggered_at ? (
              <Button
                title={
                  confirmOff
                    ? "Tap again: turn it off and delete the messages"
                    : "Turn off"
                }
                variant="danger"
                onPress={() => {
                  if (!confirmOff) {
                    setConfirmOff(true);
                    return;
                  }

                  setConfirmOff(false);
                  run(disappearApi.turnOff);
                }}
              />
            ) : null}
            </Reveal>
          </View>
        </Section>

        <Reveal>
          {on ? (
          <Section
            title="Messages"
            footer="Each goes to one chat or group. A group's message must be written again when its key changes (someone left)."
          >
            {(status?.messages ?? []).map((message, index) => {
              const chat = chatOf(message.chat_id);
              const draft = draftOf(message);
              const shown =
                chat && user
                  ? showMessage(
                      {
                        id: message.id,
                        sender_id: user.id,
                        content: message.content,
                      },
                      privateKey,
                      chat,
                      user.id,
                    )
                  : null;

              return (
                <View key={message.id}>
                  {index > 0 ? <Divider /> : null}
                  <Pressable
                    onPress={() => draft && setEditing(draft)}
                    accessibilityRole="button"
                    style={({ hovered, pressed }) => [
                      styles.message,
                      (hovered || pressed) && { backgroundColor: colors.hover },
                    ]}
                  >
                    <Ionicons
                      name={
                        message.stale
                          ? "warning-outline"
                          : chat?.type === "group"
                            ? "people-outline"
                            : "person-outline"
                      }
                      size={20}
                      color={message.stale ? colors.danger : colors.muted}
                    />
                    <View style={styles.messageText}>
                      <Text
                        numberOfLines={1}
                        style={[styles.messageTo, { color: colors.text }]}
                      >
                        {chat ? chatTitle(chat) : "A chat you left"}
                      </Text>
                      <Text
                        numberOfLines={2}
                        style={[
                          styles.messagePreview,
                          {
                            color: message.stale ? colors.danger : colors.muted,
                          },
                        ]}
                      >
                        {message.stale
                          ? "Not sendable as it is: write it again"
                          : shown && shown.status === "ok"
                            ? `${shown.heir ? "🔑 OstrichID · " : ""}${messagePreview(shown) || "…"}`
                            : "…"}
                      </Text>
                    </View>
                    <PressScale scale={0.88}
                      onPress={() =>
                        run((token) =>
                          disappearApi.deleteMessage(token, message.id),
                        )
                      }
                      accessibilityRole="button"
                      accessibilityLabel="Delete the message"
                      hitSlop={8}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={18}
                        color={colors.muted}
                      />
                    </PressScale>
                  </Pressable>
                </View>
              );
            })}
            {status?.messages.length ? <Divider /> : null}
            <Row
              icon="add-circle-outline"
              label="Add a message"
              onPress={() => setEditing(newDraft())}
            />
          </Section>
        ) : null}
        </Reveal>
      </SettingsPage>
      <Overlay>
        {editing ? (
        <DisappearEditor draft={editing} onClose={() => setEditing(null)} />
      ) : null}
      </Overlay>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },

  presets: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  preset: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },

  presetText: {
    fontSize: 14,
  },

  message: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },

  messageText: {
    flex: 1,
    gap: 2,
  },

  messageTo: {
    fontSize: 15,
  },

  messagePreview: {
    fontSize: 13,
  },
});
