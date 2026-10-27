import { useState } from "react";
import { DeleteAccountForm, PasswordForm, UsernameForm } from "@/features/settings/account-forms";
import { SettingsPage } from "@/features/settings/page";
import { Divider, Row, Section } from "@/features/settings/ui";
import { useCurrentUser } from "@/features/auth/auth";
import Reveal from "@/ui/reveal";

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
        <Reveal>{open === "username" ? <UsernameForm /> : null}</Reveal>
        <Divider />
        <Row
          icon="key-outline"
          label="Password"
          expanded={open === "password"}
          onPress={() => toggle("password")}
        />
        <Reveal>{open === "password" ? <PasswordForm /> : null}</Reveal>
      </Section>

      <Section title="Danger zone">
        <Row
          icon="trash-outline"
          label="Delete account"
          danger
          expanded={open === "delete"}
          onPress={() => toggle("delete")}
        />
        <Reveal>{open === "delete" ? <DeleteAccountForm /> : null}</Reveal>
      </Section>
    </SettingsPage>
  );
}
