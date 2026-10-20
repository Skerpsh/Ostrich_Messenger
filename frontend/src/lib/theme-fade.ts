// The phones' apps switch colors at once; the web version is in
// theme-fade.web.ts.
export function fadeTheme() {}

export function onSystemTheme(_listener: () => void) {
  return () => {};
}
