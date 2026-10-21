import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

// How screens with fields make room for the keyboard (KeyboardAvoidingView):
// with padding on both phones. Android draws edge to edge, so the window no
// longer shrinks for the keyboard by itself, and the field stayed under it.
export const KEYBOARD_BEHAVIOR = Platform.OS === "web" ? undefined : "padding";

// Whether the keyboard is up (the phones): what sits on it then needs no
// room for the home indicator or the navigation bar below.
export function useKeyboardShown() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }

    // iOS tells beforehand, Android only once it is there.
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () =>
      setShown(true),
    );
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () =>
      setShown(false),
    );

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return shown;
}
