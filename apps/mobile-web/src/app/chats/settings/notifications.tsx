import { NotificationsSection } from "@/features/settings/notifications";
import { SettingsPage } from "@/features/settings/page";

export default function NotificationsSettings() {
  return (
    <SettingsPage title="Notifications">
      <NotificationsSection />
    </SettingsPage>
  );
}
