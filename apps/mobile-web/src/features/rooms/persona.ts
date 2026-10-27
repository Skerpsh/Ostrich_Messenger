// In anonymous rooms people are personas (see the server's rooms.ts): a
// name of their choice, no avatar. Its tag ("a3f") and color come from
// its id, which is new at every entry, so whoever takes a name someone
// had before can still be told apart.

// Readable on the light and the dark bubbles alike.
const COLORS = ["#e5534b", "#d4762a", "#b8901c", "#4f9f52", "#2f9ea8", "#4a8fe0", "#8a6ce0", "#d55fa6"];

export const personaTag = (id: string) => id.slice(0, 3);

export const personaColor = (id: string) => COLORS[parseInt(id.slice(9, 13), 16) % COLORS.length] ?? COLORS[0];
