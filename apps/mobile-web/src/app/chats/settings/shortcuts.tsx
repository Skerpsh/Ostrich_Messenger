import { SettingsPage } from "@/features/settings/page";
import { ShortcutsSection } from "@/features/settings/shortcuts";

export default function ShortcutsSettings() {
  return (
    <SettingsPage title="Keyboard shortcuts">
      <ShortcutsSection />
    </SettingsPage>
  );
}
