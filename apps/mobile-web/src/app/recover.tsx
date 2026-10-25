import { useEffect, useRef, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AppHeader from "@/ui/app-header";
import Button from "@/ui/button";
import Reveal, { Swap } from "@/ui/reveal";
import TextField from "@/ui/text-field";
import { ApiError, recoveryProgress, requestRecovery, type RecoveryProgress } from "@/api/api";
import { useAuth } from "@/features/auth/auth";
import { cleanUsername, MAX_PASSWORD } from "@/features/auth/validation";
import { forgetRecovery, loadRecovery, saveRecovery, type SavedRecovery } from "@/features/recovery/saved";
import { formatWhen } from "@/features/recovery/recovery";
import {
  fromBase64,
  generateOstrichId,
  newLinkKeys,
  openForRecovery,
  recoverOstrichId,
  recoveryCode,
  requestContext,
  toBase64,
} from "@/crypto/crypto";
import { useAppTheme } from "@/ui/theme";
import { KEYBOARD_BEHAVIOR } from "@/ui/keyboard";
import { useShake } from "@/ui/motion";
import { TOUCH_UI } from "@/platform/touch";
import { radius } from "@/ui/colors";

const POLL_MS = 15_000;

// Recovering an account through friends (features/recovery) on a device
// that is not logged in: asks with the username and password, shows the
// code to read to the guardians, waits (the request is kept on the device,
// so the app can be closed meanwhile) and, once a day has passed and
// enough have approved, puts the OstrichID together from their shares,
// logs in and gives the account a new one.
export default function RecoverScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [saved, setSaved] = useState<SavedRecovery | null | undefined>(undefined);

  useEffect(() => {
    loadRecovery().then(setSaved);
  }, []);

  return (
    <View style={styles.screen}>
      <AppHeader brand title="Ostrich" onBack={router.canGoBack() ? router.back : undefined} />

      <KeyboardAvoidingView style={styles.screen} behavior={KEYBOARD_BEHAVIOR}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.card, { backgroundColor: colors.panel, boxShadow: `0 10px 30px ${colors.shadow}` }]}>
            <Text style={[styles.title, { color: colors.text }]}>Recover with friends</Text>
            <Swap id={saved === undefined ? "loading" : saved ? "waiting" : "ask"} step={saved ? 1 : 0}>
              {saved === undefined ? (
                <ActivityIndicator color={colors.muted} />
              ) : saved ? (
                <Waiting
                  saved={saved}
                  onSaved={setSaved}
                  onForget={async () => {
                    await forgetRecovery();
                    setSaved(null);
                  }}
                />
              ) : (
                <Ask onAsked={setSaved} />
              )}
            </Swap>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Ask({ onAsked }: { onAsked: (saved: SavedRecovery) => void }) {
  const { colors } = useAppTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { style: shakeStyle, shake } = useShake();
  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
    const name = cleanUsername(username);

    if (!name || !password) {
      setError("Username and password are required");
      shake();
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const keys = newLinkKeys();
      const asked = await requestRecovery(name, password, keys.publicKey);
      const saved: SavedRecovery = {
        id: asked.id,
        secret: asked.secret,
        privateKey: toBase64(keys.privateKey),
        publicKey: keys.publicKey,
        username: asked.username,
        threshold: asked.threshold,
        total: asked.total,
        readyAt: asked.ready_at,
        expiresAt: asked.expires_at,
      };

      await saveRecovery(saved);
      onAsked(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      shake();
      setLoading(false);
    }
  };

  return (
    <View style={styles.stack}>
      <Text style={[styles.text, { color: colors.textSoft }]}>
        Lost your OstrichID? If you chose guardians in Settings, a few of them can give it back. Your devices that are
        still logged in are warned and can stop it for a day.
      </Text>

      <Animated.View style={[styles.fields, shakeStyle]}>
        <TextField
          label="Username"
          placeholder="@username"
          value={username}
          onChangeText={setUsername}
          maxLength={33}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          autoFocus={!TOUCH_UI}
        />
        <TextField
          ref={passwordRef}
          label="Password"
          placeholder="••••••••"
          value={password}
          onChangeText={setPassword}
          maxLength={MAX_PASSWORD}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
      </Animated.View>

      <Reveal>{error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}</Reveal>

      <Button title="Ask my guardians" icon="people-outline" loading={loading} onPress={submit} />
    </View>
  );
}

function Waiting({
  saved,
  onSaved,
  onForget,
}: {
  saved: SavedRecovery;
  onSaved: (saved: SavedRecovery) => void;
  onForget: () => void;
}) {
  const { colors } = useAppTheme();
  const { signInRecovered } = useAuth();
  const [progress, setProgress] = useState<RecoveryProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { style: shakeStyle, shake } = useShake();

  // Asked every few seconds until it is over (ready, or not going any more).
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      let next: RecoveryProgress | null = null;

      try {
        next = await recoveryProgress(saved.id, saved.secret);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          next = {
            state: "expired",
            ready_at: saved.readyAt,
            expires_at: saved.expiresAt,
            approvals: 0,
            threshold: null,
            total: null,
          };
        } else if (current && !(e instanceof ApiError && e.status === 0)) {
          setError(e instanceof Error ? e.message : "Something went wrong");
        }
      }

      if (!current) {
        return;
      }

      if (next) {
        setProgress(next);
        setError(null);
      }

      if (!next || next.state === "waiting") {
        timer = setTimeout(poll, POLL_MS);
      }
    };

    poll();

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [saved.id, saved.secret, saved.readyAt, saved.expiresAt]);

  const state = progress?.state;

  // A try whose answer was lost may have changed the OstrichID already.
  const finished = state === "completed" && saved.newId;

  const logIn = async () => {
    if (!password) {
      setError("Enter your password");
      shake();
      return;
    }

    setError(null);
    setLoading(true);

    try {
      let recoveredId: string | null = null;

      if (!finished) {
        const shares = (progress?.shares ?? []).flatMap((share) => {
          try {
            return [
              openForRecovery(
                fromBase64(saved.privateKey),
                share.sealer_public,
                share.sealed,
                requestContext(saved.id),
              ),
            ];
          } catch {
            return [];
          }
        });

        recoveredId = recoverOstrichId(
          shares,
          progress?.threshold ?? saved.threshold,
          progress?.encrypted_private_key ?? "",
        );

        if (!recoveredId) {
          throw new Error(
            "The guardians' shares do not give your OstrichID: someone may have sent a wrong one. Ask them to approve again, or start again.",
          );
        }
      }

      // Kept before it is sent, so it is not lost if the answer is.
      const next = saved.newId ? saved : { ...saved, newId: generateOstrichId() };

      if (next !== saved) {
        await saveRecovery(next);
        onSaved(next);
      }

      await signInRecovered(saved.username, password, recoveredId, next.newId!);
      await forgetRecovery();
      // The navigator moves on to the new OstrichID.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      shake();
      setLoading(false);
    }
  };

  const threshold = progress?.threshold ?? saved.threshold;
  const readyAt = progress?.ready_at ?? saved.readyAt;

  const phase = state === "ready" || finished ? "ready" : state && state !== "waiting" ? "over" : "waiting";

  return (
    <Swap id={phase} step={phase === "ready" ? 1 : 0}>
      <View style={styles.stack}>
        {phase === "ready" ? (
          <>
            <Text style={[styles.text, { color: colors.textSoft }]}>
              Your guardians have given back your OstrichID. Enter your password to log in as @{saved.username}: you get
              a new OstrichID, and your other devices are logged out.
            </Text>
            <Animated.View style={shakeStyle}>
              <TextField
                label="Password"
                placeholder="••••••••"
                value={password}
                onChangeText={setPassword}
                maxLength={MAX_PASSWORD}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={logIn}
                autoFocus={!TOUCH_UI}
              />
            </Animated.View>
            <Reveal>{error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}</Reveal>
            <Button title="Log in" loading={loading} onPress={logIn} />
          </>
        ) : phase === "over" ? (
          <>
            <Text style={[styles.text, { color: colors.text }]}>
              {state === "cancelled"
                ? "This request was cancelled: from one of the account's devices, or by a newer request, or the guardians were changed."
                : state === "completed"
                  ? "This request was already used."
                  : "This request has expired."}
            </Text>
            <Button title="Start again" variant="secondary" onPress={onForget} />
          </>
        ) : (
          <>
            <Text style={[styles.text, { color: colors.textSoft }]}>
              Call or meet your guardians and read each of them this code. They type it in Settings → Recovery through
              friends to approve. Do not send it in a message.
            </Text>

            <View style={[styles.codeBox, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
              <Text selectable style={[styles.code, { color: colors.text }]}>
                {recoveryCode(saved.publicKey)}
              </Text>
            </View>

            <View style={styles.progress}>
              <Ionicons name="people-outline" size={18} color={colors.muted} />
              <Text style={[styles.text, styles.grow, { color: colors.text }]}>
                {progress ? `${progress.approvals} of ${threshold} guardians have approved` : "…"}
              </Text>
            </View>
            <View style={styles.progress}>
              <Ionicons name="time-outline" size={18} color={colors.muted} />
              <Text style={[styles.text, styles.grow, { color: colors.text }]}>
                {new Date(readyAt) > new Date()
                  ? `You can log in after ${formatWhen(readyAt)}`
                  : "The day of waiting is over"}
              </Text>
            </View>
            <Text style={[styles.hint, { color: colors.muted }]}>
              You can close Ostrich meanwhile: this request is kept on this device until {formatWhen(saved.expiresAt)}.
            </Text>

            <Reveal>{error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}</Reveal>

            <Button title="Stop recovering" variant="secondary" onPress={onForget} />
          </>
        )}
      </View>
    </Swap>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },

  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },

  card: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    borderRadius: radius.card,
    padding: 24,
    gap: 18,
  },

  stack: {
    gap: 18,
  },

  title: {
    fontSize: 28,
    fontWeight: "700",
  },

  text: {
    fontSize: 15,
    lineHeight: 22,
  },

  hint: {
    fontSize: 13,
    lineHeight: 18,
  },

  fields: {
    gap: 18,
  },

  error: {
    fontSize: 14,
    lineHeight: 20,
  },

  codeBox: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 18,
    alignItems: "center",
  },

  code: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: 4,
    fontFamily: "monospace",
  },

  progress: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  grow: {
    flex: 1,
  },
});
