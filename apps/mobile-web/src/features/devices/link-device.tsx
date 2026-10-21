import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Button from "@/ui/button";
import QrScanner from "./qr-scanner";
import Reveal, { Swap } from "@/ui/reveal";
import { useAuth, usePrivateKey } from "@/features/auth/auth";
import { useAppTheme } from "@/ui/theme";
import { approveDeviceLink, getDeviceLink } from "@/api/api";
import { sealForLink } from "@/crypto/crypto";
import { parseLink } from "@/api/links";
import { radius } from "@/ui/colors";
import { Row } from "@/features/settings/ui";

type Scanned = { id: string; publicKey: string; client: string };

// Logging in another device: scan the QR code it shows (app/link-device.tsx),
// check what it is, approve. The account's private key goes to it encrypted
// for the key in the QR code (crypto.ts, sealForLink).
export function LinkDeviceRow({
  clientName,
  onLinked,
}: {
  clientName: (client: string) => string;
  onLinked: () => void;
}) {
  const { colors } = useAppTheme();
  const { withToken } = useAuth();
  const privateKey = usePrivateKey();
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<Scanned | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const close = () => {
    setScanned(null);
    setError(null);
    setDone(false);
  };

  const onScan = (text: string) => {
    const link = parseLink(text);

    if (link?.kind !== "login") {
      return false;
    }

    setScanning(false);
    setError(null);
    setDone(false);
    setBusy(true);
    withToken((token) => getDeviceLink(token, link.id))
      .then(
        (info) => setScanned({ id: link.id, publicKey: link.publicKey, client: info.client }),
        (e) => {
          setScanned({ id: link.id, publicKey: link.publicKey, client: "" });
          setError(e instanceof Error ? e.message : "Something went wrong");
        },
      )
      .finally(() => setBusy(false));

    return true;
  };

  const approve = async () => {
    if (!scanned || !privateKey) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const sealed = sealForLink(privateKey, scanned.publicKey, scanned.id);
      await withToken((token) => approveDeviceLink(token, scanned.id, sealed));
      setDone(true);
      // Its session appears in the list once it has picked it up.
      setTimeout(onLinked, 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to link the device");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Row icon="qr-code-outline" label="Link a device" onPress={() => setScanning(true)} />

      <Modal visible={scanning} transparent animationType="fade" onRequestClose={() => setScanning(false)}>
        <QrScanner title="Scan the QR code on the new device" onScan={onScan} onClose={() => setScanning(false)} />
      </Modal>

      <Modal visible={scanned !== null} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={busy ? undefined : close} accessibilityLabel="Close">
          <Pressable style={[styles.card, { backgroundColor: colors.panel }]} onPress={() => {}}>
            <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
              <Ionicons
                name={done ? "checkmark-circle-outline" : "log-in-outline"}
                size={26}
                color={colors.accent}
              />
            </View>
            <Swap id={done ? "done" : scanned?.client ? "confirm" : "scan"} step={1}>
              {done ? (
                <>
                  <Text style={[styles.title, { color: colors.text }]}>Device linked</Text>
                  <Text style={[styles.text, { color: colors.muted }]}>
                    It is logged in to your account now. You can log it out in Devices at any time.
                  </Text>
                  <Button title="Done" onPress={close} />
                </>
              ) : scanned?.client ? (
                <>
                  <Text style={[styles.title, { color: colors.text }]}>
                    Log in on {clientName(scanned.client)}?
                  </Text>
                  <Text style={[styles.text, { color: colors.muted }]}>
                    It gets full access to your account and messages, as this device has.
                  </Text>
                  <Text style={[styles.warning, { color: colors.danger }]}>
                    Only scan codes shown on your own devices. Nobody from Ostrich will ever ask you to scan one.
                  </Text>
                  <Reveal>
                    {error ? <Text style={[styles.text, { color: colors.danger }]}>{error}</Text> : null}
                  </Reveal>
                  <View style={styles.buttons}>
                    <Button title="Cancel" variant="secondary" onPress={close} disabled={busy} />
                    <Button title="Log in" onPress={approve} loading={busy} />
                  </View>
                </>
              ) : (
                <>
                  <Text style={[styles.title, { color: colors.text }]}>Can’t link the device</Text>
                  <Text style={[styles.text, { color: colors.danger }]}>{error ?? "Something went wrong"}</Text>
                  <Button title="Close" variant="secondary" onPress={close} />
                </>
              )}
            </Swap>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },

  card: {
    width: "100%",
    maxWidth: 380,
    alignItems: "center",
    gap: 12,
    padding: 24,
    borderRadius: radius.card,
  },

  icon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },

  title: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },

  text: {
    fontSize: 14,
    textAlign: "center",
  },

  warning: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },

  buttons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
});
