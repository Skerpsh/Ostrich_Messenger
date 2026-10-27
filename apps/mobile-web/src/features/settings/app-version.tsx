import { Platform, StyleSheet, Text, View } from "react-native";
import Reveal, { Swap } from "@/ui/reveal";
import { desktop, useDesktopUpdate, type DesktopUpdateState } from "@/platform/desktop";
import { APP_VERSION } from "@/platform/version";
import { useAppTheme } from "@/ui/theme";

// At the bottom of Settings, small: this client's version, and in the
// desktop app how its updates go, with what can be done about them.
export function AppVersion() {
  const { colors } = useAppTheme();
  const update = useDesktopUpdate();

  const client = desktop
    ? "desktop app"
    : Platform.OS === "web"
      ? "web"
      : Platform.OS === "android"
        ? "Android"
        : "iOS";

  const action = update ? updateAction(update) : null;

  return (
    <View style={styles.box}>
      <Text selectable style={[styles.text, { color: colors.muted }]}>
        Ostrich {update?.current ?? APP_VERSION} · {client}
      </Text>
      <Reveal>
        {update ? (
        // The state changes in place: the old line goes as the new comes.
        <Swap id={update.state}>
          <Text style={[styles.text, { color: update.state === "error" ? colors.danger : colors.muted }]}>
            {updateText(update)}
            {action ? (
              <>
                {" · "}
                <Text onPress={action.run} accessibilityRole="button" style={[styles.action, { color: colors.accent }]}>
                  {action.label}
                </Text>
              </>
            ) : null}
          </Text>
        </Swap>
      ) : null}
      </Reveal>
    </View>
  );
}

function updateText(update: DesktopUpdateState) {
  switch (update.state) {
    case "unsupported":
      return "Updated by your package manager";
    case "checking":
      return "Looking for updates…";
    case "latest":
      return "Up to date";
    case "downloading":
      return `Downloading ${update.version ?? "the update"}… ${update.percent ?? 0}%`;
    case "ready":
      return update.silent ? `${update.version} is ready: installed when you quit` : `${update.version} is ready`;
    case "error":
      return `Could not update: ${update.message ?? "unknown error"}`;
    default:
      return "Updates are looked for every few hours";
  }
}

function updateAction(update: DesktopUpdateState) {
  if (update.state === "ready") {
    return { label: "Restart to update", run: () => desktop?.installUpdate() };
  }

  if (["idle", "latest", "error"].includes(update.state)) {
    return { label: "Check now", run: () => desktop?.checkForUpdates() };
  }

  return null;
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    gap: 4,
    paddingTop: 4,
  },

  text: {
    fontSize: 12,
    textAlign: "center",
  },

  action: {
    fontWeight: "600",
  },
});
