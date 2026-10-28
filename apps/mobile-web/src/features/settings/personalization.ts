import { isAccentChoice, type AccentChoice } from "@/ui/colors";

// Personalization (Settings → Personalization): what each setting can be,
// and reading saved or synced values, which may come from an older or a
// newer app.

// Messages' and the chats list's text.
export type TextSize = "s" | "m" | "l" | "xl";

export const TEXT_SIZES: { value: TextSize; label: string; scale: number }[] = [
  { value: "s", label: "Small", scale: 0.9 },
  { value: "m", label: "Default", scale: 1 },
  { value: "l", label: "Large", scale: 1.15 },
  { value: "xl", label: "Largest", scale: 1.3 },
];

export const textScaleOf = (size: TextSize) => TEXT_SIZES.find((t) => t.value === size)?.scale ?? 1;

// How fast animations play (ui/motion.ts): 1 is as designed.
export const ANIMATION_SPEEDS = [0.5, 0.75, 1, 1.5, 2];

// The chats list: as it was, smaller rows, or no message previews.
export type ListDensity = "comfortable" | "compact" | "minimal";

export const LIST_DENSITIES: { value: ListDensity; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
  { value: "minimal", label: "Minimal" },
];

// Chat wallpapers: a pattern of ostriches in the accent color, a photo, or
// nothing; brightness 1–3.
export type WallpaperPattern = "none" | "running" | "large" | "heads" | "photo";

export type Wallpaper = { pattern: WallpaperPattern; brightness: 1 | 2 | 3 };

export const DEFAULT_WALLPAPER: Wallpaper = { pattern: "running", brightness: 2 };

export const WALLPAPER_PATTERNS: { value: WallpaperPattern; label: string }[] = [
  { value: "running", label: "Running" },
  { value: "large", label: "Large" },
  { value: "heads", label: "Heads" },
  { value: "photo", label: "Photo" },
  { value: "none", label: "None" },
];

const PATTERNS = new Set<string>(["none", "running", "large", "heads", "photo"]);

export function readWallpaper(value: unknown): Wallpaper | null {
  const w = value as Partial<Wallpaper> | null;

  if (!w || typeof w.pattern !== "string" || !PATTERNS.has(w.pattern)) {
    return null;
  }

  return {
    pattern: w.pattern,
    brightness: w.brightness === 1 || w.brightness === 3 ? w.brightness : 2,
  };
}

// The device-wide choices other than the theme and the accent (those have
// keys of their own, shared with the website).
export type Preferences = {
  pureBlack: boolean;
  textSize: TextSize;
  density: ListDensity;
  wallpaper: Wallpaper;
  // Animations (ui/motion.ts); the system's "Reduce motion" also tones them down.
  animations: boolean;
  animationSpeed: number;
  // Sync personalization with the account's other devices.
  sync: boolean;
};

export const DEFAULT_PREFERENCES: Preferences = {
  pureBlack: false,
  textSize: "m",
  density: "comfortable",
  wallpaper: DEFAULT_WALLPAPER,
  animations: true,
  animationSpeed: 1,
  sync: false,
};

const SIZES = new Set<string>(["s", "m", "l", "xl"]);
const DENSITIES = new Set<string>(["comfortable", "compact", "minimal"]);

export function readPreferences(value: unknown): Preferences {
  const p = (value ?? {}) as Partial<Preferences>;

  return {
    pureBlack: p.pureBlack === true,
    textSize: typeof p.textSize === "string" && SIZES.has(p.textSize) ? p.textSize : "m",
    density: typeof p.density === "string" && DENSITIES.has(p.density) ? p.density : "comfortable",
    wallpaper: readWallpaper(p.wallpaper) ?? DEFAULT_WALLPAPER,
    animations: p.animations !== false,
    animationSpeed: ANIMATION_SPEEDS.includes(p.animationSpeed as number) ? (p.animationSpeed as number) : 1,
    sync: p.sync === true,
  };
}

// A chat's own look: its accent and wallpaper instead of the device-wide
// ones. Set by the user for themselves, or by a member for everyone
// (a message, features/chat/payload.ts); the user's own one comes first.
export type ChatLook = {
  accent?: AccentChoice;
  wallpaper?: Wallpaper;
};

export function readChatLook(value: unknown): ChatLook | null {
  const l = value as Partial<ChatLook> | null;

  if (!l || typeof l !== "object") {
    return null;
  }

  const wallpaper = readWallpaper(l.wallpaper);
  const look: ChatLook = {
    ...(isAccentChoice(l.accent) ? { accent: l.accent } : {}),
    ...(wallpaper ? { wallpaper } : {}),
  };

  return look.accent || look.wallpaper ? look : null;
}
