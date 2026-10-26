import Constants from "expo-constants";
import { Platform } from "react-native";

// This client's version, shown in Settings. The web build gets it from its
// build (EXPO_PUBLIC_APP_VERSION: deploy/deploy.sh for the site, the
// desktop app's own version for it); the phones from the running code's
// config, which release.yml sets.
export const APP_VERSION =
  (Platform.OS === "web" ? process.env.EXPO_PUBLIC_APP_VERSION : Constants.expoConfig?.version) || "dev";
