import { useState } from "react";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

// A wallpaper pattern (a seamless square tile of white lines) repeated over
// the whole area in one color: a grid of tinted images. The web draws it
// as one masked layer instead (pattern-layer.web.tsx).
export default function PatternLayer({
  source,
  tile,
  color,
}: {
  source: number;
  tile: number;
  color: string;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const columns = Math.ceil(size.width / tile);
  const rows = Math.ceil(size.height / tile);
  const tiles = [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      tiles.push(
        <Image
          key={`${row}-${column}`}
          source={source}
          tintColor={color}
          style={[styles.tile, { left: column * tile, top: row * tile, width: tile, height: tile }]}
        />,
      );
    }
  }

  return (
    <View
      style={styles.layer}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize({ width, height });
      }}
    >
      {tiles}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
  },
  tile: {
    position: "absolute",
  },
});
