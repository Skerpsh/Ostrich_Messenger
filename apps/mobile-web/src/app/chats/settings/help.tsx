import { Linking } from "react-native";
import { SettingsPage } from "@/features/settings/page";
import { Row, Section } from "@/features/settings/ui";
import { SUPPORT_EMAIL } from "@/api/links";

export default function HelpSettings() {
  return (
    <SettingsPage title="Help">
      <Section>
        <Row
          icon="mail-outline"
          label="Contact support"
          value={SUPPORT_EMAIL}
          onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
        />
      </Section>
    </SettingsPage>
  );
}
