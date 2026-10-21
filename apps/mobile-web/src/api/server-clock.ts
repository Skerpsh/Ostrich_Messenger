// The server's time, as this device estimates it from the "connected"
// event (api/realtime.ts). Device clocks can be minutes or hours off (a
// wrong time zone, Windows next to Linux on one PC); what both sides of a
// call compare must not depend on them.

// Server time minus this device's time, in ms.
let offset = 0;

export function setServerTime(time: number) {
  if (Number.isFinite(time)) {
    offset = time - Date.now();
  }
}

export function serverNow() {
  return Date.now() + offset;
}
