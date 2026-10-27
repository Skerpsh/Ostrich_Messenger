import { useState } from "react";
import { Text } from "react-native";
import { SettingsPage } from "@/features/settings/page";
import { PrivacySection } from "@/features/settings/privacy";
import { Row, Section, styles } from "@/features/settings/ui";
import { useAuth } from "@/features/auth/auth";
import { useAppTheme } from "@/ui/theme";
import Reveal from "@/ui/reveal";

export default function PrivacySettings() {
  const { colors } = useAppTheme();
  const { signOutEverywhere } = useAuth();

  // Logging out everywhere takes a second tap, so it is not done by accident.
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const signOutAll = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }

    setError(null);
    setSigningOut(true);

    try {
      await signOutEverywhere();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log out");
      setSigningOut(false);
      setConfirming(false);
    }
  };

  return (
    <SettingsPage title="Privacy & security">
      <PrivacySection />

      <Section
        title="Security"
        footer="Log out everywhere if you think someone else has access to your account. You will need your username, password and OstrichID to log in again."
      >
        <Row
          icon="phone-portrait-outline"
          label={confirming ? "Tap again to log out on all devices" : "Log out of all devices"}
          danger
          loading={signingOut}
          onPress={signOutAll}
        />
        <Reveal>
          {error ? (
          <Text style={[styles.formMessage, styles.inset, { color: colors.danger }]}>{error}</Text>
        ) : null}
        </Reveal>
      </Section>
    </SettingsPage>
  );
}
