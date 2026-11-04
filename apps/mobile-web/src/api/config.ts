// Backend address. Override with EXPO_PUBLIC_API_URL, e.g. in .env.local:
// EXPO_PUBLIC_API_URL=http://192.168.1.10:3000
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL || "https://api.ostrich-messenger.online"
).replace(/\/+$/, "");

// https -> wss, http -> ws
export const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";
