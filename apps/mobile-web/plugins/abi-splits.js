// An APK per processor (arm64-v8a, armeabi-v7a) beside the universal one,
// which keeps both. x86 is left out: emulators only, and prebuilt
// libraries (WebRTC, ML Kit) would bring it back into the universal APK.
const { withAppBuildGradle } = require("expo/config-plugins");

const SPLITS = `
// abi-splits (plugins/abi-splits.js)
android {
    splits {
        abi {
            enable true
            reset()
            include "armeabi-v7a", "arm64-v8a"
            universalApk true
        }
    }
    packaging {
        jniLibs {
            excludes += ["lib/x86/**", "lib/x86_64/**"]
        }
    }
}
`;

module.exports = (config) =>
  withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes("abi-splits")) {
      config.modResults.contents += SPLITS;
    }
    return config;
  });
