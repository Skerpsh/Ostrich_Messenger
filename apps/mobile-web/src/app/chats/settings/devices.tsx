import { DevicesSection } from "@/features/devices/devices";
import { SettingsPage } from "@/features/settings/page";

export default function DevicesSettings() {
  return (
    <SettingsPage title="Devices">
      <DevicesSection />
    </SettingsPage>
  );
}
