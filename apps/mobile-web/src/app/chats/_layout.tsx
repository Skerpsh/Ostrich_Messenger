import { Slot } from "expo-router";
import { StyleSheet, View } from "react-native";
import ChatList from "@/features/chats/chat-list";
import { DisappearWatch } from "@/features/disappear/disappear";
import { RecoveryWatch } from "@/features/recovery/recovery";
import { useAppTheme } from "@/ui/theme";
import { useIsWide, useSidebarWidth } from "@/ui/layout";
import AppStack from "@/ui/app-stack";

// Phones: the chats list, a chat, new chat and settings are separate
// screens. Wide screens: the chats list stays on the left and the rest
// opens on the right.
export default function ChatsLayout() {
  const { colors } = useAppTheme();
  const wide = useIsWide();
  const sidebarWidth = useSidebarWidth();

  if (!wide) {
    return (
      <>
        <DisappearWatch />
        <RecoveryWatch />
        <AppStack
          screens={[
            { name: "index" },
            { name: "[chatId]" },
            { name: "new", modal: true },
            { name: "rooms" },
            { name: "settings" },
          ]}
        />
      </>
    );
  }

  return (
    <View style={[styles.split, { backgroundColor: colors.bg }]}>
      <DisappearWatch />
      <RecoveryWatch />
      <View
        style={[
          styles.sidebar,
          { width: sidebarWidth, borderRightColor: colors.line },
        ]}
      >
        <ChatList />
      </View>
      <View style={styles.pane}>
        <Slot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  split: {
    flex: 1,
    flexDirection: "row",
  },

  sidebar: {
    borderRightWidth: StyleSheet.hairlineWidth,
  },

  pane: {
    flex: 1,
  },
});
