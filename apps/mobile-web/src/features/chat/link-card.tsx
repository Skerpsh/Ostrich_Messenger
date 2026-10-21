import { useEffect, useState } from "react";
import { Image } from "expo-image";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/features/auth/auth";
import { useAppTheme } from "@/ui/theme";
import { loadAttachment } from "./attachments";
import { imageSource } from "@/platform/files";
import { IMAGE_FADE_MS, useMotion } from "@/ui/motion";
import type { LinkPreview } from "./payload";

// The preview of a message's link (made by the sender's phone): the site,
// title, description and picture; tapping it opens the link.
export default function LinkCard({ link, own }: { link: LinkPreview; own: boolean }) {
  const { colors } = useAppTheme();
  const motion = useMotion();
  const { withToken } = useAuth();
  const [uri, setUri] = useState<string | null>(null);
  const image = link.image;

  useEffect(() => {
    if (!image) {
      return;
    }

    let current = true;
    let shown: string | null = null;

    withToken((token) => loadAttachment(token, image)).then(
      (bytes) => {
        if (current) {
          shown = imageSource(bytes, image.mime);
          setUri(shown);
        }
      },
      () => {},
    );

    return () => {
      current = false;

      if (shown?.startsWith("blob:")) {
        URL.revokeObjectURL(shown);
      }
    };
  }, [image, withToken]);

  // The address's own host, not the name the sender's app put in: that
  // is what the card opens.
  const host = hostOf(link.url);
  const fg = own ? colors.onAccent : colors.text;
  const accent = own ? colors.onAccent : colors.accent;
  const ratio = image?.width && image.height ? image.width / image.height : 1.91;

  return (
    <Pressable
      onPress={() => Linking.openURL(link.url)}
      accessibilityRole="link"
      accessibilityLabel={`${link.title}, ${host}`}
      style={({ hovered, pressed }) => [
        styles.card,
        { borderLeftColor: accent, backgroundColor: own ? "rgba(0, 0, 0, 0.12)" : colors.panelAlt },
        (hovered || pressed) && styles.pressed,
      ]}
    >
      <Text numberOfLines={1} style={[styles.site, { color: accent }]}>
        {link.site && link.site.toLowerCase() !== host ? `${link.site} · ${host}` : host}
      </Text>
      <Text numberOfLines={2} style={[styles.title, { color: fg }]}>
        {link.title}
      </Text>
      {link.description ? (
        <Text numberOfLines={3} style={[styles.description, { color: fg }]}>
          {link.description}
        </Text>
      ) : null}
      {image ? (
        <View style={[styles.image, { aspectRatio: Math.min(2.5, Math.max(0.8, ratio)) }]}>
          {uri ? (
            <Image
              source={{ uri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={IMAGE_FADE_MS[motion]}
              accessibilityIgnoresInvertColors
            />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const styles = StyleSheet.create({
  card: {
    marginTop: 6,
    marginBottom: 2,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderLeftWidth: 3,
    borderRadius: 8,
    gap: 2,
    maxWidth: 360,
  },

  pressed: {
    opacity: 0.85,
  },

  site: {
    fontSize: 13,
    fontWeight: "700",
  },

  title: {
    fontSize: 14,
    fontWeight: "600",
  },

  description: {
    fontSize: 13,
    opacity: 0.85,
  },

  image: {
    width: "100%",
    marginTop: 6,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "rgba(127, 127, 127, 0.15)",
  },
});
