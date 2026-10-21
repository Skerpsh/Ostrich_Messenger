import { Asset } from "expo-asset";

// Web: the pattern as the mask of one layer filled with the color, which
// browsers draw on the GPU (tinting every tile with an SVG filter is slow
// to draw, in Safari especially). See pattern-layer.tsx.
export default function PatternLayer({
  source,
  tile,
  color,
}: {
  source: number;
  tile: number;
  color: string;
}) {
  const mask = `url("${Asset.fromModule(source).uri}")`;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: color,
        maskImage: mask,
        WebkitMaskImage: mask,
        maskSize: `${tile}px ${tile}px`,
        WebkitMaskSize: `${tile}px ${tile}px`,
        maskRepeat: "repeat",
        WebkitMaskRepeat: "repeat",
      }}
    />
  );
}
