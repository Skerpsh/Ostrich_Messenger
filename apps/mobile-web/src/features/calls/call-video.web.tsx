import { useEffect, useRef } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import type { StreamLike } from "./call-connection";

// A call's video in the browser. Muted: the call's audio plays on its own
// (features/calls/webrtc.web.ts).
export default function CallVideo({
  stream,
  mirror = false,
  fit = "cover",
  style,
}: {
  stream: StreamLike;
  mirror?: boolean;
  fit?: "cover" | "contain";
  onTop?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;

    if (video && video.srcObject !== (stream as unknown as MediaStream)) {
      video.srcObject = stream as unknown as MediaStream;
      video.play().catch(() => {});
    }
  }, [stream]);

  return (
    <View style={style}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        disablePictureInPicture
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          objectFit: fit,
          transform: mirror ? "scaleX(-1)" : undefined,
        }}
      />
    </View>
  );
}
