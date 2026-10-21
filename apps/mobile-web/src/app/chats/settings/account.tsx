import { useState } from "react";
import { DeleteAccountForm, PasswordForm, UsernameForm } from "@/features/settings/account-forms";
import { SettingsPage } from "@/features/settings/page";
import { Divider, Row, Section } from "@/features/settings/ui";
import { useCurrentUser } from "@/features/auth/auth";

type Form = "username" | "password" | "delete";

export default function AccountSettings() {
  const user = useCurrentUser();
  const [open, setOpen] = useState<Form | null>(null);

  if (!user) {
    return null;
  }

  const toggle = (form: Form) => setOpen((current) => (current === form ? null : form));

  return (
    <SettingsPage title="Account">
      <Section>
        <Row
          icon="at"
          label="Username"
          value={`@${user.username}`}
          expanded={open === "username"}
          onPress={() => toggle("username")}
        />
        {open === "username" ? <UsernameForm /> : null}
        <Divider />
        <Row
          icon="key-outline"
          label="Password"
          expanded={open === "password"}
          onPress={() => toggle("password")}
        />
        {open === "password" ? <PasswordForm /> : null}
      </Section>

      <Section title="Danger zone">
        <Row
          icon="trash-outline"
          label="Delete account"
          danger
          expanded={open === "delete"}
          onPress={() => toggle("delete")}
        />
        {open === "delete" ? <DeleteAccountForm /> : null}
      </Section>
    </SettingsPage>
  );
}
