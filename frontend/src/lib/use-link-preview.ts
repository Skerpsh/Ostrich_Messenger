import { useEffect, useState } from "react";
import { firstLink, type PageMeta } from "./link-meta";
import { fetchLinkPreview, MAKES_LINK_PREVIEWS } from "./link-preview";

const DELAY_MS = 600;

// The preview of the first link of a message being written (phones only,
// see link-preview.ts), loaded once typing pauses. dismiss() drops it
// for that link.
export function useLinkPreview(text: string, enabled: boolean) {
  const [loaded, setLoaded] = useState<{ url: string; meta: PageMeta } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const url = enabled && MAKES_LINK_PREVIEWS ? firstLink(text) : null;
  const wanted = url && !dismissed.includes(url) ? url : null;

  useEffect(() => {
    if (!wanted) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchLinkPreview(wanted, controller.signal).then(
        (meta) => setLoaded(meta ? { url: wanted, meta } : null),
        () => {},
      );
    }, DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [wanted]);

  return {
    preview: loaded && loaded.url === wanted ? loaded : null,
    dismiss: () => wanted && setDismissed((current) => [...current, wanted]),
  };
}
