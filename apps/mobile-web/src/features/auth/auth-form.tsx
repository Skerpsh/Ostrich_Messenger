import { useCallback, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInputInstance,
} from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/ui/app-header";
import Button from "@/ui/button";
import Reveal from "@/ui/reveal";
import TextField from "@/ui/text-field";
import { useAuth } from "./auth";
import { loadRecovery } from "@/features/recovery/saved";
import { useAppTheme } from "@/ui/theme";
import {
  cleanUsername,
  MAX_PASSWORD,
  MIN_PASSWORD,
  USERNAME_RE,
  USERNAME_RULES,
} from "./validation";
import { KEYBOARD_BEHAVIOR } from "@/ui/keyboard";
import { useShake } from "@/ui/motion";
import { TOUCH_UI } from "@/platform/touch";
import { radius } from "@/ui/colors";

type AuthFormProps = {
  mode: "login" | "register";
};

export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { signIn, signUp, notice } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ostrichId, setOstrichId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // A failed try: the fields shake and the error shows.
  const { style: shakeStyle, shake } = useShake();

  const fail = (message: string) => {
    setError(message);
    shake();
  };

  const passwordRef = useRef<TextInputInstance>(null);
  const confirmRef = useRef<TextInputInstance>(null);
  const ostrichIdRef = useRef<TextInputInstance>(null);

  const isRegister = mode === "register";

  // A recovery through friends going on this device (app/recover.tsx).
  const [recovering, setRecovering] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadRecovery().then((saved) => setRecovering(saved !== null));
    }, []),
  );

  const submit = async () => {
    // "@alice" works too.
    const name = cleanUsername(username);

    if (!name || !password) {
      fail("Username and password are required");
      return;
    }

    if (!isRegister && !ostrichId.trim()) {
      fail("Enter your OstrichID");
      return;
    }

    if (isRegister) {
      if (!USERNAME_RE.test(name)) {
        fail(USERNAME_RULES);
        return;
      }

      if (password.length < MIN_PASSWORD) {
        fail(`Password must be at least ${MIN_PASSWORD} characters`);
        return;
      }

      if (password !== confirmPassword) {
        fail("Passwords do not match");
        return;
      }
    }

    setError(null);
    setLoading(true);

    try {
      await (isRegister
        ? signUp(name, password)
        : signIn(name, password, ostrichId.trim()));
      // The navigator switches to the chats screen on its own.
    } catch (e) {
      fail(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  };

  const shownError = error ?? (isRegister ? null : notice);

  return (
    <View style={styles.screen}>
      <AppHeader
        brand
        title="Ostrich"
        onBack={router.canGoBack() ? router.back : undefined}
      />

      <KeyboardAvoidingView
        style={styles.screen}
        behavior={KEYBOARD_BEHAVIOR}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.panel,
                boxShadow: `0 10px 30px ${colors.shadow}`,
              },
            ]}
          >
            <Text style={[styles.eyebrow, { color: colors.muted }]}>
              {isRegister ? "New account" : "Welcome back"}
            </Text>
            <Text style={[styles.title, { color: colors.text }]}>
              {isRegister ? "Create account" : "Log in"}
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
                autoComplete={isRegister ? "new-password" : "current-password"}
                textContentType={isRegister ? "newPassword" : "password"}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() =>
                  (isRegister ? confirmRef : ostrichIdRef).current?.focus()
                }
              />

              <Reveal>
                {isRegister ? null : (
                <View style={styles.idField}>
                  <TextField
                    ref={ostrichIdRef}
                    label="OstrichID"
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                    value={ostrichId}
                    onChangeText={setOstrichId}
                    maxLength={40}
                    autoCapitalize="characters"
                    autoComplete="off"
                    returnKeyType="go"
                    onSubmitEditing={submit}
                  />

                </View>
              )}
              </Reveal>

              <Reveal>
                {isRegister ? (
                <TextField
                  ref={confirmRef}
                  label="Confirm password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  maxLength={MAX_PASSWORD}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                />
              ) : null}
              </Reveal>
            </Animated.View>

            <Reveal>
              {isRegister ? (
              <Text style={[styles.note, { color: colors.textSoft }]}>
                After you create the account, you get an OstrichID. You need it
                to log in, and it is the key to your end-to-end encrypted
                messages: it is shown only once and never sent to the server.
              </Text>
            ) : null}
            </Reveal>

            <Reveal>
              {shownError ? (
                <Text style={[styles.error, { color: colors.danger }]}>
                  {shownError}
                </Text>
              ) : null}
            </Reveal>

            <Button
              title={isRegister ? "Create account" : "Log in"}
              loading={loading}
              onPress={submit}
              style={styles.submit}
            />

            <Reveal>
              {isRegister ? null : (
              <>
                <Button
                  title="Log in with a QR code"
                  variant="secondary"
                  disabled={loading}
                  onPress={() => router.push("/link-device")}
                  style={styles.qrLogin}
                />
                <Button
                  title={recovering ? "Continue recovering with friends" : "Lost your OstrichID? Recover with friends"}
                  variant="secondary"
                  disabled={loading}
                  onPress={() => router.push("/recover")}
                  style={styles.qrLogin}
                />
              </>
            )}
            </Reveal>

            <Button
              title={isRegister ? "I have an account" : "Create account"}
              variant="secondary"
              disabled={loading}
              onPress={() =>
                router.replace(isRegister ? "/login" : "/register")
              }
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
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
  },

  eyebrow: {
    fontSize: 14,
    marginBottom: 4,
  },

  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 22,
  },

  fields: {
    gap: 18,
  },

  idField: {
    gap: 8,
  },

  note: {
    marginTop: 18,
    fontSize: 14,
    lineHeight: 20,
  },

  error: {
    marginTop: 16,
    fontSize: 14,
    lineHeight: 20,
  },

  submit: {
    marginTop: 24,
    marginBottom: 12,
  },

  qrLogin: {
    marginBottom: 12,
  },
});
