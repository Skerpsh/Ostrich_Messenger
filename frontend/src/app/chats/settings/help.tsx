import { Linking } from "react-native";
import { SettingsPage } from "@/components/settings/page";
import { Row, Section } from "@/components/settings/ui";
import { SUPPORT_EMAIL } from "@/lib/links";

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
