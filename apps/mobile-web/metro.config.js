const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// tlock-js falls back to Node's crypto when window.crypto is missing; the
// apps always have it (crypto-polyfill.ts), so Node's module is never needed.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "crypto") return { type: "empty" };
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
