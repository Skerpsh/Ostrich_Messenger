// Monochrome palette of the Ostrich website plus one accent color (own
// messages, primary buttons, unread badges, selection). Contrast checked
// against WCAG AA for the text drawn on each surface.

export type ThemeMode = "dark" | "light";

export type ThemeColors = {
  // Page background (chat area).
  bg: string;
  // Sidebar, headers, composer.
  surface: string;
  // Cards, other people's bubbles, inputs.
  panel: string;
  panelAlt: string;
  // Hover / pressed rows.
  hover: string;
  text: string;
  textSoft: string;
  muted: string;
  line: string;
  accent: string;
  // Text and icons drawn on the accent color.
  onAccent: string;
  // Subtle accent background, e.g. the selected chat.
  accentSoft: string;
  shadow: string;
  danger: string;
  online: string;
};

export const themes: Record<ThemeMode, ThemeColors> = {
  dark: {
    bg: "#0f0f10",
    surface: "#151517",
    panel: "#1c1c1f",
    panelAlt: "#26262a",
    hover: "#202024",
    text: "#f5f5f5",
    textSoft: "#cfcfd4",
    muted: "#8e8e93",
    line: "rgba(255, 255, 255, 0.08)",
    accent: "#ff8a3d",
    onAccent: "#1a0e04",
    accentSoft: "rgba(255, 138, 61, 0.14)",
    shadow: "rgba(0, 0, 0, 0.35)",
    danger: "#ff6b6b",
    online: "#4cd964",
  },
  light: {
    bg: "#f4f4f5",
    surface: "#ffffff",
    panel: "#ffffff",
    panelAlt: "#ececee",
    hover: "#f0f0f2",
    text: "#111113",
    textSoft: "#3a3a3f",
    muted: "#6e6e73",
    line: "rgba(0, 0, 0, 0.08)",
    accent: "#b84e08",
    onAccent: "#ffffff",
    accentSoft: "rgba(184, 78, 8, 0.1)",
    shadow: "rgba(0, 0, 0, 0.08)",
    danger: "#c62828",
    online: "#2e7d32",
  },
};

// Accent colors the user can choose (Settings → Appearance). Each has a
// bright variant for the dark theme (with dark text on it) and a deep one
// for the light theme (with white text on it); all pass WCAG AA (4.5:1)
// for the text on the accent and for the accent on the page background.
export type AccentId =
  | "orange"
  | "red"
  | "pink"
  | "purple"
  | "blue"
  | "teal"
  | "green"
  | "gold"
  | "mono";

type AccentVariant = { accent: string; onAccent: string };

export const accents: {
  id: AccentId;
  name: string;
  dark: AccentVariant;
  light: AccentVariant;
}[] = [
  {
    id: "orange",
    name: "Orange",
    dark: { accent: "#ff8a3d", onAccent: "#1a0e04" },
    light: { accent: "#b84e08", onAccent: "#ffffff" },
  },
  {
    id: "red",
    name: "Red",
    dark: { accent: "#ff7070", onAccent: "#2a0505" },
    light: { accent: "#c0262d", onAccent: "#ffffff" },
  },
  {
    id: "pink",
    name: "Pink",
    dark: { accent: "#ff7ab6", onAccent: "#2b0418" },
    light: { accent: "#b3206a", onAccent: "#ffffff" },
  },
  {
    id: "purple",
    name: "Purple",
    dark: { accent: "#b392ff", onAccent: "#170838" },
    light: { accent: "#6a3cd0", onAccent: "#ffffff" },
  },
  {
    id: "blue",
    name: "Blue",
    dark: { accent: "#5aa9ff", onAccent: "#04162b" },
    light: { accent: "#1c5fc4", onAccent: "#ffffff" },
  },
  {
    id: "teal",
    name: "Teal",
    dark: { accent: "#3ed6c5", onAccent: "#03211d" },
    light: { accent: "#0a756a", onAccent: "#ffffff" },
  },
  {
    id: "green",
    name: "Green",
    dark: { accent: "#6fdc6f", onAccent: "#062006" },
    light: { accent: "#2b7a30", onAccent: "#ffffff" },
  },
  {
    id: "gold",
    name: "Gold",
    dark: { accent: "#f5c542", onAccent: "#2a2000" },
    light: { accent: "#856400", onAccent: "#ffffff" },
  },
  {
    id: "mono",
    name: "Mono",
    dark: { accent: "#f5f5f5", onAccent: "#111113" },
    light: { accent: "#111113", onAccent: "#ffffff" },
  },
];

export const DEFAULT_ACCENT: AccentId = "orange";

// The accent as chosen: one of the accents, or "#rrggbb" of the user's own
// color (Settings → Personalization), from which both variants are made.
export type AccentChoice = AccentId | `#${string}`;

export const isCustomAccent = (choice: string): choice is `#${string}` => /^#[0-9a-f]{6}$/i.test(choice);

export function isAccentChoice(value: unknown): value is AccentChoice {
  return typeof value === "string" && (isCustomAccent(value) || accents.some((a) => a.id === value));
}

// Dark theme with a pure black page (OLED screens).
const pureBlack: Partial<ThemeColors> = {
  bg: "#000000",
  surface: "#000000",
  panel: "#141416",
  panelAlt: "#1e1e21",
  hover: "#141416",
  line: "rgba(255, 255, 255, 0.1)",
};

// "#rrggbb" → "rgba(r, g, b, alpha)".
export function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// --- the user's own accent ---

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hex2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");

function hexOf([r, g, b]: [number, number, number]): `#${string}` {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

// WCAG relative luminance and contrast ratio.
function luminance(hex: string) {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function hslOf(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;

  return [h, s, l];
}

export function hslToHex(h: number, s: number, l: number): `#${string}` {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return hexOf([f(0) * 255, f(8) * 255, f(4) * 255]);
}

// Both variants of the user's color: for the dark theme it is lightened
// until it stands out from the page with dark text on it, for the light
// theme darkened until white text reads on it, both to WCAG AA (4.5:1).
export function customAccentVariants(hex: string): Record<ThemeMode, AccentVariant> {
  const [h, s, ownL] = hslOf(hex);

  let dark = hex;
  for (let l = Math.max(0.55, ownL); l <= 1; l += 0.02) {
    dark = hslToHex(h, s, l);
    if (contrast(dark, themes.dark.bg) >= 4.5 && contrast(dark, "#111113") >= 4.5) {
      break;
    }
  }

  let light = hex;
  for (let l = Math.min(0.5, ownL); l >= 0; l -= 0.02) {
    light = hslToHex(h, s, l);
    if (contrast(light, themes.light.bg) >= 4.5 && contrast(light, "#ffffff") >= 4.5) {
      break;
    }
  }

  return {
    dark: { accent: dark, onAccent: hslToHex(h, Math.min(s, 0.8), 0.07) },
    light: { accent: light, onAccent: "#ffffff" },
  };
}

// The accent's variant for the theme.
export function accentVariant(choice: AccentChoice, mode: ThemeMode): AccentVariant {
  if (isCustomAccent(choice)) {
    return customAccentVariants(choice)[mode];
  }

  return (accents.find((a) => a.id === choice) ?? accents[0])[mode];
}

// The preset nearest to a color (the app icons exist for the presets only).
export function nearestAccent(choice: AccentChoice): AccentId {
  if (!isCustomAccent(choice)) {
    return choice;
  }

  const [h, s] = hslOf(choice);

  if (s < 0.15) {
    return "mono";
  }

  let best: AccentId = "orange";
  let bestDistance = Infinity;

  for (const accent of accents) {
    if (accent.id === "mono") {
      continue;
    }

    const [ah] = hslOf(accent.dark.accent);
    const distance = Math.min(Math.abs(ah - h), 360 - Math.abs(ah - h));

    if (distance < bestDistance) {
      bestDistance = distance;
      best = accent.id;
    }
  }

  return best;
}

// The theme's colors with the chosen accent.
export function themeColors(
  mode: ThemeMode,
  choice: AccentChoice,
  black = false,
): ThemeColors {
  const variant = accentVariant(choice, mode);

  return {
    ...themes[mode],
    ...(mode === "dark" && black ? pureBlack : {}),
    accent: variant.accent,
    onAccent: variant.onAccent,
    accentSoft: withAlpha(variant.accent, mode === "dark" ? 0.14 : 0.1),
  };
}

export const radius = {
  card: 18,
  bubble: 18,
  // The joined corner of consecutive bubbles.
  bubbleJoined: 6,
  input: 14,
  pill: 999,
};

// Width at which the chats list and the open chat are shown side by side
// (tablets, desktop browsers, Mac).
export const WIDE_LAYOUT_MIN_WIDTH = 768;
