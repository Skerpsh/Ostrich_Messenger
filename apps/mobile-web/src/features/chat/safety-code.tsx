import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";
import AnimatedPressable from "@/ui/animated-pressable";
import Button from "@/ui/button";
import QrCode from "@/ui/qr-code";
import QrScanner from "@/features/devices/qr-scanner";
import { Swap } from "@/ui/reveal";
import { parseLink, safetyQr } from "@/api/links";
import { useAppTheme } from "@/ui/theme";
import { useEscape } from "@/ui/keys";
import { enterStyle, leaveStyle, useLeave } from "@/ui/motion";
import { radius } from "@/ui/colors";

// The chat's safety code over a dimmed background (placed like
// ActionMenu). `keyChanged`: the other member's key is not the one this
// device saw before; confirming accepts the new key. The code can also be
// compared by scanning the other's QR code of it.
export default function SafetyCode({
  username,
  code,
  keyChanged,
  onConfirm,
  onClose,
}: {
  username: string;
  code: string[];
  keyChanged: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  const { motion, leaving, leave } = useLeave();
  // Leaves with an animation (also on Esc, on the web).
  const close = () => leave(onClose);
  useEscape(true, close);
  const [showQr, setShowQr] = useState(false);
  const [scanning, setScanning] = useState(false);
  // The scanned code: the same, or not.
  const [scanned, setScanned] = useState<"same" | "different" | null>(null);

  const onScan = (text: string) => {
    const link = parseLink(text);

    if (link?.kind !== "safety") {
      return false;
    }

    setScanning(false);
    setScanned(link.code === code.join("") ? "same" : "different");

    return true;
  };

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
        <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
          <Ionicons
            name={keyChanged ? "warning-outline" : "shield-checkmark-outline"}
            size={24}
            color={keyChanged ? colors.danger : colors.accent}
          />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>
          Safety code with @{username}
        </Text>

        <Swap id={showQr ? "qr" : "code"} step={showQr ? 1 : -1}>
          {showQr ? (
            <View style={styles.qr}>
              <QrCode value={safetyQr(code)} size={200} />
            </View>
          ) : (
            <View style={[styles.code, { backgroundColor: colors.panelAlt }]}>
              {[code.slice(0, 4), code.slice(4)].map((line, i) => (
                <Text key={i} selectable style={[styles.codeLine, { color: colors.text }]}>
                  {line.join("  ")}
                </Text>
              ))}
            </View>
          )}
        </Swap>

        <View style={styles.buttons}>
          <Button
            title={showQr ? "Show digits" : "Show QR"}
            icon="qr-code-outline"
            variant="secondary"
            style={styles.flex}
            onPress={() => setShowQr((shown) => !shown)}
          />
          <Button
            title="Scan theirs"
            icon="scan-outline"
            variant="secondary"
            style={styles.flex}
            onPress={() => {
              setScanned(null);
              setScanning(true);
            }}
          />
        </View>

        {scanned === "same" ? (
          <Text style={[styles.text, { color: colors.online }]}>
            ✓ The codes are the same: the keys were not swapped.
          </Text>
        ) : scanned === "different" ? (
          <Text style={[styles.text, { color: colors.danger }]}>
            ✕ The codes differ. Make sure you scanned @{username}&apos;s code for this chat; if it is,
            someone may be reading along.
          </Text>
        ) : null}

        <Text style={[styles.text, { color: colors.textSoft }]}>
          Compare it with the code @{username} sees for this chat, in person
          or over another app, or scan each other&apos;s QR code of it. If
          both are the same, your messages are readable only by the two of
          you.
        </Text>

        {keyChanged ? (
          <Text style={[styles.text, { color: colors.danger }]}>
            The security key of @{username} has changed. That happens when they
            set up encryption again, but it can also mean someone is trying to
            read the chat. Write only after you have compared the codes.
          </Text>
        ) : null}

        {keyChanged && scanned !== "different" ? (
          <Button title="The codes are the same" onPress={onConfirm} />
        ) : null}
        <Button title="Close" variant="secondary" onPress={close} />
      </AnimatedPressable>

      {scanning ? (
        <QrScanner title={`Scan @${username}'s safety code`} onScan={onScan} onClose={() => setScanning(false)} />
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
    maxWidth: 380,
    borderRadius: radius.card,
    padding: 22,
    gap: 14,
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

  code: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    gap: 4,
  },

  codeLine: {
    fontSize: 18,
    fontFamily: "monospace",
    fontVariant: ["tabular-nums"],
    letterSpacing: 1,
  },

  text: {
    fontSize: 14,
    lineHeight: 20,
  },

  qr: {
    alignItems: "center",
  },

  buttons: {
    flexDirection: "row",
    gap: 8,
  },

  flex: {
    flex: 1,
    paddingHorizontal: 8,
  },
});
