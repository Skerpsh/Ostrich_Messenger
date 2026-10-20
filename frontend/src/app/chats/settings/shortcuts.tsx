import { SettingsPage } from "@/components/settings/page";
import { ShortcutsSection } from "@/components/settings/shortcuts";

export default function ShortcutsSettings() {
  return (
    <SettingsPage title="Keyboard shortcuts">
      <ShortcutsSection />
    </SettingsPage>
  );
}
