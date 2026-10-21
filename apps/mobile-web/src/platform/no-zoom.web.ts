// The web app does not zoom, like the phones' apps (public/index.html stops
// double taps and Safari's zooming in on fields): no pinching on touch
// screens and touchpads, no Ctrl + wheel, no Ctrl + / Ctrl −.

let done = false;

export function preventZoom() {
  if (done || typeof document === "undefined") {
    return;
  }

  done = true;
  const stop = (event: Event) => event.preventDefault();

  // Safari's pinch (iPhone, iPad, Mac touchpads).
  document.addEventListener("gesturestart", stop, { passive: false });
  document.addEventListener("gesturechange", stop, { passive: false });

  // Two fingers on a touch screen.
  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    },
    { passive: false },
  );

  // Ctrl + wheel, which is also how other browsers report a touchpad pinch.
  document.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey) {
        event.preventDefault();
      }
    },
    { passive: false },
  );

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && ["+", "=", "-", "_", "0"].includes(event.key)) {
      event.preventDefault();
    }
  });
}
