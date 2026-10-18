import { RTCView } from "react-native-webrtc";
import type { StyleProp, ViewStyle } from "react-native";
import type { StreamLike } from "@/lib/call-connection";

// A call's video in the apps (react-native-webrtc); the web's is
// call-video.web.tsx.
export default function CallVideo({
  stream,
  mirror = false,
  fit = "cover",
  onTop = false,
  style,
}: {
  stream: StreamLike;
  mirror?: boolean;
  fit?: "cover" | "contain";
  // Over another video (Android draws them in layers).
  onTop?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const url = stream.toURL?.();

  if (!url) {
    return null;
  }

  return <RTCView streamURL={url} mirror={mirror} objectFit={fit} zOrder={onTop ? 1 : 0} style={style} />;
}
