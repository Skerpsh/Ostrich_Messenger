import { useCallback, useEffect, useState, type ReactNode } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AppHeader from "@/ui/app-header";
import Button from "@/ui/button";
import IconButton from "@/ui/icon-button";
import Reveal from "@/ui/reveal";
import ScreenEnter, { useLeaveScreen } from "@/ui/screen-enter";
import TextField from "@/ui/text-field";
import { useAuth } from "@/features/auth/auth";
import { useChats } from "@/features/chats/chats";
import { useAppTheme } from "@/ui/theme";
import { getRandomNickname, getRooms, joinRoom, type Room } from "@/api/api";
import { KEYBOARD_BEHAVIOR } from "@/ui/keyboard";
import { useEscape } from "@/ui/keys";
import { useIsWide } from "@/ui/layout";
import { USERNAME_RE, USERNAME_RULES } from "@/features/auth/validation";
import { radius } from "@/ui/colors";

// Anonymous rooms (the server's rooms.ts): public chats of up to 50
// people, entered under a name chosen at every entry. The server can read
// them, and says who is behind a name to nobody but itself.

// How often the counts are fetched again while the screen is open.
const REFRESH_MS = 15_000;

type NameChoice = "random" | "last" | "own";

export default function RoomsScreen() {
  return (
    <ScreenEnter>
      <Rooms />
    </ScreenEnter>
  );
}

function Rooms() {
  const router = useRouter();
  const leaveScreen = useLeaveScreen();
  const { colors } = useAppTheme();
  const wide = useIsWide();
  const { withToken } = useAuth();
  const { reload } = useChats();

  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);
  const [randomName, setRandomName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The room being entered, and under which name.
  const [entering, setEntering] = useState<Room | null>(null);
  const [choice, setChoice] = useState<NameChoice>("random");
  const [ownName, setOwnName] = useState("");
  const [joining, setJoining] = useState(false);

  const close = () =>
    leaveScreen(() => (wide || !router.canGoBack() ? router.replace("/chats") : router.back()));

  useEscape(true, () => (entering ? setEntering(null) : close()));

  const load = useCallback(
    (first = false) =>
      withToken((token) => getRooms(token)).then(
        (result) => {
          setRooms(result.rooms);
          setLastName(result.last_nickname);

          if (first) {
            setRandomName(result.random_nickname);
          }
        },
        (e) => setError(e instanceof Error ? e.message : "Failed to load the rooms"),
      ),
    [withToken],
  );

  useEffect(() => {
    load(true);
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const open = (chatId: string) => router.replace({ pathname: "/chats/[chatId]", params: { chatId } });

  const choose = (room: Room) => {
    setError(null);

    if (room.joined) {
      open(room.id);
      return;
    }

    setEntering(room);
    setChoice(lastName ? "last" : "random");
  };

  const reroll = () =>
    withToken((token) => getRandomNickname(token)).then(setRandomName, () => {});

  const enter = async () => {
    if (!entering) {
      return;
    }

    const name = choice === "random" ? randomName : choice === "last" ? (lastName ?? "") : ownName.trim();

    if (!USERNAME_RE.test(name)) {
      setError(USERNAME_RULES);
      return;
    }

    setError(null);
    setJoining(true);

    try {
      await withToken((token) => joinRoom(token, entering.id, name));
      // The chat screen finds the room in the chats list.
      await reload();
      open(entering.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enter the room");
      setJoining(false);
      load();
    }
  };

  const option = (value: NameChoice, label: string, extra?: ReactNode) => (
    <Pressable
      key={value}
      onPress={() => {
        setChoice(value);
        setError(null);
      }}
      accessibilityRole="radio"
      accessibilityState={{ checked: choice === value }}
      style={[styles.option, { backgroundColor: choice === value ? colors.accentSoft : colors.panelAlt }]}
    >
      <Ionicons
        name={choice === value ? "radio-button-on" : "radio-button-off"}
        size={20}
        color={choice === value ? colors.accent : colors.muted}
      />
      <Text numberOfLines={1} style={[styles.optionText, { color: colors.text }]}>
        {label}
      </Text>
      {extra}
    </Pressable>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader
        onBack={wide ? undefined : entering ? () => setEntering(null) : close}
        onClose={wide ? close : undefined}
        title="Anonymous rooms"
      />

      <KeyboardAvoidingView style={styles.screen} behavior={KEYBOARD_BEHAVIOR}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={[styles.card, { backgroundColor: colors.panel }]}>
            <View style={styles.noticeRow}>
              <Ionicons name="glasses-outline" size={22} color={colors.accent} />
              <Text style={[styles.text, styles.flex, { color: colors.textSoft }]}>
                Public rooms of up to 50 people. Nobody in a room knows who you are, and you choose a
                new name every time you enter.
              </Text>
            </View>
            <Text style={[styles.text, { color: colors.danger }]}>
              Rooms are not end-to-end encrypted: the server can read them and knows which account
              is behind each name.
            </Text>
          </View>

          {entering ? (
            <View style={[styles.card, { backgroundColor: colors.panel }]}>
              <Text style={[styles.title, { color: colors.text }]}>What should we call you in {entering.name}?</Text>

              <View style={styles.options}>
                {option(
                  "random",
                  randomName || "…",
                  <IconButton icon="dice-outline" label="Another random name" size={20} onPress={reroll} />,
                )}
                {lastName ? option("last", `As last time: ${lastName}`) : null}
                {option("own", "My own name")}
              </View>

              <Reveal>
                {choice === "own" ? (
                  <TextField
                    value={ownName}
                    onChangeText={(text) => {
                      setOwnName(text);
                      setError(null);
                    }}
                    placeholder="A name for this room"
                    hint={USERNAME_RULES}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    maxLength={32}
                    returnKeyType="go"
                    onSubmitEditing={enter}
                  />
                ) : null}
              </Reveal>

              {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

              <Button title={`Enter ${entering.name}`} loading={joining} onPress={enter} />
              <Button title="Back to the rooms" variant="secondary" onPress={() => setEntering(null)} />
            </View>
          ) : (
            <View style={[styles.card, styles.list, { backgroundColor: colors.panel }]}>
              {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
              {rooms === null ? (
                <ActivityIndicator color={colors.accent} style={styles.loading} />
              ) : (
                rooms.map((room) => {
                  const full = room.member_count >= room.capacity && !room.joined;

                  return (
                    <Pressable
                      key={room.id}
                      onPress={() => choose(room)}
                      disabled={full}
                      accessibilityRole="button"
                      accessibilityLabel={`${room.name}, ${room.member_count} of ${room.capacity}${room.joined ? ", you are in it" : full ? ", full" : ""}`}
                      style={({ hovered, pressed }) => [
                        styles.room,
                        (hovered || pressed) && !full && { backgroundColor: colors.hover },
                        full && styles.full,
                      ]}
                    >
                      <View style={styles.flex}>
                        <View style={styles.roomTop}>
                          <Text style={[styles.roomName, { color: colors.text }]}>{room.name}</Text>
                          {room.joined ? (
                            <Text style={[styles.badge, { color: colors.accent }]}>you are here</Text>
                          ) : full ? (
                            <Text style={[styles.badge, { color: colors.muted }]}>full</Text>
                          ) : null}
                          <Text style={[styles.count, { color: colors.muted }]}>
                            {room.member_count}/{room.capacity}
                          </Text>
                        </View>
                        <View style={[styles.bar, { backgroundColor: colors.panelAlt }]}>
                          <View
                            style={[
                              styles.barFill,
                              {
                                backgroundColor: room.joined ? colors.accent : colors.muted,
                                width: `${Math.min(100, (room.member_count / room.capacity) * 100)}%`,
                              },
                            ]}
                          />
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                    </Pressable>
                  );
                })
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },

  body: {
    padding: 20,
    gap: 12,
  },

  card: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    borderRadius: radius.card,
    padding: 20,
    gap: 14,
  },

  list: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 2,
  },

  noticeRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },

  flex: {
    flex: 1,
  },

  text: {
    fontSize: 15,
    lineHeight: 22,
  },

  title: {
    fontSize: 17,
    fontWeight: "600",
  },

  options: {
    gap: 8,
  },

  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.card,
    paddingHorizontal: 12,
    minHeight: 48,
  },

  optionText: {
    flex: 1,
    fontSize: 15,
  },

  room: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: radius.card,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },

  full: {
    opacity: 0.5,
  },

  roomTop: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 8,
  },

  roomName: {
    fontSize: 16,
    fontWeight: "600",
  },

  badge: {
    fontSize: 13,
  },

  count: {
    marginLeft: "auto",
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },

  bar: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },

  barFill: {
    height: 4,
    borderRadius: 2,
  },

  error: {
    fontSize: 14,
  },

  loading: {
    marginVertical: 24,
  },
});
