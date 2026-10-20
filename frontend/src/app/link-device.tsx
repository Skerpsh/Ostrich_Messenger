import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AppHeader from "@/components/app-header";
import Button from "@/components/button";
import QrCode from "@/components/qr-code";
import { Swap } from "@/components/reveal";
import { useAuth } from "@/context/auth";
import { useAppTheme } from "@/context/theme";
import { ApiError, createDeviceLink, deviceLinkSession } from "@/lib/api";
import { newLinkKeys, openLinkSeal, publicKeyOf } from "@/lib/crypto";
import { loginQr } from "@/lib/links";
import { radius } from "@/theme/colors";

const POLL_MS = 2000;

// Logging in without the password and OstrichID: this device shows a QR
// code, a device that is logged in scans it (Settings → Devices → Link a
// device) and sends the account's key, encrypted for this device only
// (backend routes/device-links.ts). A new code is made when one expires.
export default function LinkDeviceScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { signInLinked } = useAuth();
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped for a new code.
  const [round, setRound] = useState(0);
  // A new function on every render of the auth context; the code must not
  // change with it.
  const signIn = useRef(signInLinked);

  useEffect(() => {
    signIn.current = signInLinked;
  });

  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const keys = newLinkKeys();

    const poll = async (id: string, secret: string) => {
      try {
        const answer = await deviceLinkSession(id, secret);

        if (!current) {
          return;
        }

        if (answer.status === "approved") {
          const privateKey = openLinkSeal(keys.privateKey, answer.sealer_public_key, answer.sealed_key, id);

          // Not the account's key: not from one of its devices.
          if (publicKeyOf(privateKey) !== answer.keys.public_key) {
            throw new Error("The device that scanned the code sent a wrong key");
          }

          // The navigator moves on to the chats on its own.
          await signIn.current(answer, privateKey);
          return;
        }
      } catch (e) {
        if (!current) {
          return;
        }

        // Expired: a new code.
        if (e instanceof ApiError && e.status === 404) {
          setRound((n) => n + 1);
          return;
        }

        if (!(e instanceof ApiError && e.status === 0)) {
          setError(e instanceof Error ? e.message : "Something went wrong");
          return;
        }
        // Offline for a moment: asked again.
      }

      timer = setTimeout(() => poll(id, secret), POLL_MS);
    };

    createDeviceLink().then(
      (link) => {
        if (current) {
          setError(null);
          setQr(loginQr(link.id, keys.publicKey));
          poll(link.id, link.secret);
        }
      },
      (e) => current && setError(e instanceof Error ? e.message : "Something went wrong"),
    );

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [round]);

  return (
    <View style={styles.screen}>
      <AppHeader brand title="Ostrich" onBack={router.canGoBack() ? router.back : undefined} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <View style={[styles.card, { backgroundColor: colors.panel, boxShadow: `0 10px 30px ${colors.shadow}` }]}>
          <Text style={[styles.title, { color: colors.text }]}>Log in with a QR code</Text>

          <View style={styles.qr}>
            <Swap id={qr ?? (error ? "error" : "loading")} resize={false}>
              {qr ? <QrCode value={qr} size={220} /> : error ? null : <ActivityIndicator color={colors.muted} />}
            </Swap>
          </View>

          <Swap id={error ? "error" : "waiting"}>
            {error ? (
              <View style={styles.retry}>
                <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
                <Button title="Try again" variant="secondary" onPress={() => setRound((n) => n + 1)} />
              </View>
            ) : (
              <View style={styles.steps}>
                {[
                  "Open Ostrich on a device where you are logged in",
                  "Go to Settings → Devices → Link a device",
                  "Point its camera at this code and confirm",
                ].map((step, i) => (
                  <View key={step} style={styles.step}>
                    <View style={[styles.number, { backgroundColor: colors.accentSoft }]}>
                      <Text style={[styles.numberText, { color: colors.accent }]}>{i + 1}</Text>
                    </View>
                    <Text style={[styles.stepText, { color: colors.textSoft }]}>{step}</Text>
                  </View>
                ))}
              </View>
            )}
          </Swap>

          <Text style={[styles.note, { color: colors.muted }]}>
            Your messages’ key comes from that device, encrypted for this one only: the server never
            sees it. You won’t need your password or OstrichID here.
          </Text>
        </View>
      </ScrollView>
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

  retry: {
    gap: 18,
  },

  card: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    borderRadius: radius.card,
    padding: 24,
    gap: 18,
  },

  title: {
    fontSize: 24,
    fontWeight: "700",
  },

  qr: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 220,
  },

  steps: {
    gap: 12,
  },

  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  number: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },

  numberText: {
    fontSize: 14,
    fontWeight: "700",
  },

  stepText: {
    flex: 1,
    fontSize: 15,
  },

  error: {
    fontSize: 14,
    textAlign: "center",
  },

  note: {
    fontSize: 13,
    lineHeight: 18,
  },
});
