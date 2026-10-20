import { NotificationsSection } from "@/components/settings/notifications";
import { SettingsPage } from "@/components/settings/page";

export default function NotificationsSettings() {
  return (
    <SettingsPage title="Notifications">
      <NotificationsSection />
    </SettingsPage>
  );
}
