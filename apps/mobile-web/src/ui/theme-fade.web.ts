// The web app changing its theme or accent: the colors flow into the new
// ones instead of switching at once. For a moment every element gets a
// transition of its colors (public/index.html, html.theme-fade); it has to
// be set before the new colors are, so it is called as they are chosen.

const FADE_MS = 450;

let timer: ReturnType<typeof setTimeout> | null = null;

export function fadeTheme() {
  if (typeof document === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const root = document.documentElement;
  root.classList.add("theme-fade");

  if (timer) {
    clearTimeout(timer);
  }

  timer = setTimeout(() => {
    timer = null;
    root.classList.remove("theme-fade");
  }, FADE_MS);
}

// The system going light or dark (before the app re-renders with it).
export function onSystemTheme(listener: () => void) {
  if (typeof matchMedia === "undefined") {
    return () => {};
  }

  const query = matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
