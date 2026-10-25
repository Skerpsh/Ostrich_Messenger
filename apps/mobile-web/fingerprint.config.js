// The runtime version (app.json, policy "fingerprint") of the native part
// only: the app's version changes with every release (release.yml), and
// would otherwise make every over-the-air update a new runtime. The second
// is Expo's default, kept: the build's prebuild rewrites those scripts.
/** @type {import('expo/fingerprint').Config} */
const config = {
  sourceSkips: ["ExpoConfigVersions", "PackageJsonAndroidAndIosScriptsIfNotContainRun"],
};

module.exports = config;
