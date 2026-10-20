import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { AccentPicker, ChatPreview, WallpaperPicker } from "@/components/personalization";
import type { IconName } from "@/components/icon-button";
import { SettingsPage } from "@/components/settings/page";
import { Block, Divider, Section, Segmented, styles, ToggleRow } from "@/components/settings/ui";
import { useAppTheme, type ThemePreference } from "@/context/theme";
import { LIST_DENSITIES, TEXT_SIZES } from "@/lib/personalization";

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: "system", label: "System", icon: "phone-portrait-outline" },
  { value: "light", label: "Light", icon: "sunny-outline" },
  { value: "dark", label: "Dark", icon: "moon-outline" },
];

const DENSITY_HINTS = {
  comfortable: "Photos and the last message of each chat.",
  compact: "Smaller rows: more chats fit on the screen.",
  minimal: "Names only, without the last messages.",
};

export default function PersonalizationSettings() {
  const theme = useAppTheme();
  const { colors } = theme;
  const [error, setError] = useState<string | null>(null);

  return (
    <SettingsPage title="Personalization">
      <ChatPreview wallpaper={theme.wallpaper} photo={theme.wallpaperPhoto} />

      <Section title="Theme">
        <Segmented options={THEME_OPTIONS} value={theme.preference} onChange={theme.setPreference} />
        <Divider full />
        <ToggleRow
          icon="contrast-outline"
          label="Pure black"
          hint="The dark theme with a black background, for OLED screens."
          value={theme.pureBlack}
          onChange={theme.setPureBlack}
        />
      </Section>

      <Section
        title="Accent color"
        footer={
          Platform.OS === "web"
            ? "Your messages, buttons and the wallpaper's ostriches. The tab's icon follows it."
            : "Your messages, buttons and the wallpaper's ostriches. The app's icon follows it."
        }
      >
        <View style={styles.accentBlock}>
          <AccentPicker value={theme.accent} onChange={theme.setAccent} />
        </View>
      </Section>

      <Section title="Chat wallpaper" footer="A chat can have its own: open it, then ⋯ → Wallpaper & color.">
        <View style={styles.accentBlock}>
          <WallpaperPicker
            value={theme.wallpaper}
            photo={theme.wallpaperPhoto}
            onChange={(wallpaper) => {
              setError(null);
              theme.setWallpaper(wallpaper);
            }}
            onPhoto={theme.setWallpaperPhoto}
            onError={setError}
          />
          {error ? <Text style={[styles.formMessage, { color: colors.danger }]}>{error}</Text> : null}
        </View>
      </Section>

      <Section title="Text">
        <Block label="Text size of messages and chats">
          <Segmented options={TEXT_SIZES} value={theme.textSize} onChange={theme.setTextSize} />
        </Block>
      </Section>

      <Section title="Chats list" footer={DENSITY_HINTS[theme.density]}>
        <Segmented options={LIST_DENSITIES} value={theme.density} onChange={theme.setDensity} />
      </Section>

      <Section
        title="Sync"
        footer="Theme, accent, wallpapers (not photos), text size and the chats list, also each chat's own look. Encrypted on this device: the server cannot read them. Turn it on on each device that should share them."
      >
        <ToggleRow
          icon="sync-outline"
          label="Sync across devices"
          hint="Off: these settings are for this device only."
          value={theme.sync}
          onChange={theme.setSync}
        />
      </Section>
    </SettingsPage>
  );
}
