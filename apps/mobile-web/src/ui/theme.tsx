import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import { cacheGet, cacheSet } from "@/platform/cache";
import {
  DEFAULT_PREFERENCES,
  readPreferences,
  textScaleOf,
  type ListDensity,
  type Preferences,
  type TextSize,
  type Wallpaper,
} from "@/features/settings/personalization";
import { getItem, setItem } from "@/platform/storage";
import { fadeTheme, onSystemTheme } from "./theme-fade";
import {
  DEFAULT_ACCENT,
  isAccentChoice,
  themeColors,
  type AccentChoice,
  type ThemeColors,
  type ThemeMode,
} from "./colors";

// Same key as the website uses for its theme toggle.
const THEME_KEY = "ostrich-theme";
// Per device, like the theme: an accent's id or "#rrggbb".
const ACCENT_KEY = "ostrich-accent";
// The rest of personalization (features/settings/personalization.ts), as JSON.
const PREFERENCES_KEY = "ostrich-personalization";
// The device-wide wallpaper photo (a data URI), in the local cache: too big
// for the keychain.
const PHOTO_KEY = "wallpaper-photo";

// "system" follows the device's light/dark setting.
export type ThemePreference = ThemeMode | "system";

// What settings sync carries (lib/settings-sync.ts).
export type SyncedLook = {
  theme: ThemePreference;
  accent: AccentChoice;
  preferences: Omit<Preferences, "sync">;
};

type ThemeContextValue = {
  // The theme in use.
  mode: ThemeMode;
  colors: ThemeColors;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  // Switches between light and dark (leaves "system").
  toggleTheme: () => void;
  accent: AccentChoice;
  setAccent: (accent: AccentChoice) => void;
  pureBlack: boolean;
  setPureBlack: (pureBlack: boolean) => void;
  textSize: TextSize;
  // Multiplies the font sizes of messages and the chats list.
  textScale: number;
  setTextSize: (size: TextSize) => void;
  density: ListDensity;
  setDensity: (density: ListDensity) => void;
  // Behind the messages of chats without a look of their own.
  wallpaper: Wallpaper;
  setWallpaper: (wallpaper: Wallpaper) => void;
  // The photo for the "photo" wallpaper (data URI), null if none was chosen.
  wallpaperPhoto: string | null;
  setWallpaperPhoto: (photo: string | null) => void;
  animations: boolean;
  setAnimations: (animations: boolean) => void;
  sync: boolean;
  setSync: (sync: boolean) => void;
  // Bumped on every change the user makes (not on applying synced ones).
  revision: number;
  // Bumped when the accent is chosen here or by sync (the app icon follows).
  accentPicked: number;
  syncedLook: () => SyncedLook;
  applySyncedLook: (look: SyncedLook) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [accent, setAccentState] = useState<AccentChoice>(DEFAULT_ACCENT);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [wallpaperPhoto, setPhotoState] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [accentPicked, setAccentPicked] = useState(0);

  useEffect(() => {
    getItem(THEME_KEY).then((saved) => {
      if (saved === "light" || saved === "dark" || saved === "system") {
        setPreferenceState(saved);
      }
    });

    getItem(ACCENT_KEY).then((saved) => {
      if (isAccentChoice(saved)) {
        setAccentState(saved);
      }
    });

    getItem(PREFERENCES_KEY).then((saved) => {
      if (!saved) {
        return;
      }

      try {
        setPreferences(readPreferences(JSON.parse(saved)));
      } catch {}
    });

    cacheGet<string>(PHOTO_KEY).then((photo) => {
      if (photo) {
        setPhotoState(photo);
      }
    });
  }, []);

  const mode: ThemeMode =
    preference === "system"
      ? systemScheme === "light"
        ? "light"
        : "dark"
      : preference;

  const changed = () => setRevision((r) => r + 1);

  // Web: new colors flow in (lib/theme-fade).
  const fade = () => {
    if (preferences.animations) {
      fadeTheme();
    }
  };

  // The system's theme changing fades too, when the app follows it.
  const fadeSystem = useRef(false);

  useEffect(() => {
    fadeSystem.current = preferences.animations && preference === "system";
  });

  useEffect(() => onSystemTheme(() => fadeSystem.current && fadeTheme()), []);

  const savePreference = (next: ThemePreference) => {
    setPreferenceState(next);
    setItem(THEME_KEY, next);
  };

  const saveAccent = (next: AccentChoice) => {
    setAccentState(next);
    setItem(ACCENT_KEY, next);
    setAccentPicked((n) => n + 1);
  };

  const savePreferences = (change: (current: Preferences) => Preferences) =>
    setPreferences((current) => {
      const next = change(current);
      setItem(PREFERENCES_KEY, JSON.stringify(next));
      return next;
    });

  const update = (patch: Partial<Preferences>) => {
    savePreferences((current) => ({ ...current, ...patch }));
    changed();
  };

  const setPreference = (next: ThemePreference) => {
    fade();
    savePreference(next);
    changed();
  };

  return (
    <ThemeContext
      value={{
        mode,
        colors: themeColors(mode, accent, preferences.pureBlack),
        preference,
        setPreference,
        toggleTheme: () => setPreference(mode === "dark" ? "light" : "dark"),
        accent,
        setAccent: (next) => {
          fade();
          saveAccent(next);
          changed();
        },
        pureBlack: preferences.pureBlack,
        setPureBlack: (pureBlack) => {
          fade();
          update({ pureBlack });
        },
        textSize: preferences.textSize,
        textScale: textScaleOf(preferences.textSize),
        setTextSize: (textSize) => update({ textSize }),
        density: preferences.density,
        setDensity: (density) => update({ density }),
        wallpaper: preferences.wallpaper,
        setWallpaper: (wallpaper) => update({ wallpaper }),
        wallpaperPhoto,
        setWallpaperPhoto: (photo) => {
          setPhotoState(photo);
          cacheSet(PHOTO_KEY, photo);
        },
        animations: preferences.animations,
        setAnimations: (animations) => update({ animations }),
        sync: preferences.sync,
        // Not a change to sync: turning it on loads what is synced first.
        setSync: (sync) => savePreferences((current) => ({ ...current, sync })),
        revision,
        accentPicked,
        syncedLook: () => {
          const { sync: _, ...rest } = preferences;
          return { theme: preference, accent, preferences: rest };
        },
        applySyncedLook: (look) => {
          fade();
          savePreference(look.theme);
          saveAccent(look.accent);
          savePreferences((current) => ({
            ...look.preferences,
            // A photo stays on its device: keep this one's wallpaper then.
            wallpaper:
              look.preferences.wallpaper.pattern === "photo" && !wallpaperPhoto
                ? current.wallpaper
                : look.preferences.wallpaper,
            sync: current.sync,
          }));
        },
      }}
    >
      {children}
    </ThemeContext>
  );
}

export function useAppTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useAppTheme must be used inside AppThemeProvider");
  }

  return context;
}

// The theme with another accent, for one chat's screen (a chat's own look).
export function ChatAccentProvider({
  accent,
  children,
}: {
  accent: AccentChoice | null;
  children: ReactNode;
}) {
  const theme = useAppTheme();

  if (!accent || accent === theme.accent) {
    return children;
  }

  return (
    <ThemeContext value={{ ...theme, colors: themeColors(theme.mode, accent, theme.pureBlack) }}>
      {children}
    </ThemeContext>
  );
}
