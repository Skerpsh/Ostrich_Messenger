import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useAuth, useCurrentUser, usePrivateKey } from "@/features/auth/auth";
import { useChatLooks } from "@/features/chat/chat-looks";
import { useRealtime } from "@/api/realtime-context";
import { useAppTheme, type SyncedLook } from "@/ui/theme";
import { isAccentChoice } from "@/ui/colors";
import { getSettings, saveSettings } from "@/api/api";
import { decryptSettings, encryptSettings } from "@/crypto/crypto";
import { readPreferences, type ChatLook } from "./personalization";
import { useLatest } from "@/ui/use-latest";

// Settings sync (Settings → Personalization → Sync): while it is on, the
// personalization and the chats' own looks are saved on the server
// encrypted with the account's key (crypto/crypto.ts) after every change,
// and loaded when another device saves them. Turning it on loads what is
// there first; if nothing is, this device's settings are saved.

type Synced = { v: 1; look: SyncedLook; chats: Record<string, ChatLook> };

// What another app version wrote: unknown values are left out.
function readSynced(json: string): Synced | null {
  try {
    const data = JSON.parse(json) as Partial<Synced>;
    const look = data.look as Partial<SyncedLook> | undefined;

    if (!look || !isAccentChoice(look.accent)) {
      return null;
    }

    const theme = look.theme === "light" || look.theme === "dark" ? look.theme : "system";
    const { sync: _, ...preferences } = readPreferences(look.preferences);

    return {
      v: 1,
      look: { theme, accent: look.accent, preferences },
      chats: data.chats && typeof data.chats === "object" ? data.chats : {},
    };
  } catch {
    return null;
  }
}

const SAVE_AFTER_MS = 1200;

export default function SettingsSync() {
  const theme = useAppTheme();
  const looks = useChatLooks();
  const { withToken } = useAuth();
  const userId = useCurrentUser()?.id ?? null;
  const privateKey = usePrivateKey();
  const { subscribeEvents, status } = useRealtime();

  const enabled = theme.sync && Boolean(userId && privateKey);
  // The version on the server this device has (saved or loaded).
  const known = useRef<string | null>(null);
  // A save on its way: its own event may come before its answer.
  const saving = useRef(false);
  // Changes made before sync was on are not saved by themselves.
  const seen = useRef({ theme: theme.revision, looks: looks.revision });

  // The latest functions for the effects below.
  const work = useLatest({
    // True if something was loaded.
    load: async () => {
      if (!userId || !privateKey) {
        return false;
      }

      const settings = await withToken(getSettings);

      if (!settings) {
        return false;
      }

      if (settings.updated_at === known.current) {
        return true;
      }

      const synced = readSynced(decryptSettings(settings.data, privateKey, userId));

      if (synced) {
        theme.applySyncedLook(synced.look);
        looks.applySyncedLooks(synced.chats);
      }

      known.current = settings.updated_at;
      return true;
    },
    save: async () => {
      if (!userId || !privateKey) {
        return;
      }

      const synced: Synced = { v: 1, look: theme.syncedLook(), chats: looks.syncedLooks() };
      const data = encryptSettings(JSON.stringify(synced), privateKey, userId);
      saving.current = true;

      try {
        const { updated_at } = await withToken((token) => saveSettings(token, data));
        known.current = updated_at;
      } finally {
        saving.current = false;
      }
    },
  });

  // Turned on (or signed in with it on): load, or save if there is nothing.
  useEffect(() => {
    if (!enabled) {
      known.current = null;
      return;
    }

    work.current
      .load()
      .then((loaded) => (loaded ? undefined : work.current.save()))
      .catch(() => {});
  }, [enabled, userId, work]);

  // The user changed something: save it a moment later.
  useEffect(() => {
    const changed = seen.current.theme !== theme.revision || seen.current.looks !== looks.revision;
    seen.current = { theme: theme.revision, looks: looks.revision };

    if (!enabled || !changed) {
      return;
    }

    const timer = setTimeout(() => work.current.save().catch(() => {}), SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [enabled, theme.revision, looks.revision, work]);

  // Another device saved: load.
  useEffect(() => {
    if (!enabled) {
      return;
    }

    return subscribeEvents({
      onEvent: (event) => {
        if (event.type === "settings_changed" && event.updatedAt !== known.current && !saving.current) {
          work.current.load().catch(() => {});
        }
      },
    });
  }, [enabled, subscribeEvents, work]);

  // Events missed while offline or in the background: load again on
  // reconnecting and on coming back to the app.
  useEffect(() => {
    if (enabled && status === "online") {
      work.current.load().catch(() => {});
    }
  }, [enabled, status, work]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        work.current.load().catch(() => {});
      }
    });

    return () => subscription.remove();
  }, [enabled, work]);

  return null;
}
