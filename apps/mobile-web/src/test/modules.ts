/// <reference types="node" />
// For the tests of modules that import through "@/" and without extensions
// (as Metro allows): imported first, it lets node find them, and puts
// in-memory stand-ins (next to this file) in place of what needs a phone.
// The module under test is then imported with await import(), after this.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

const src = new URL("../", import.meta.url);

const STANDINS: Record<string, string> = {
  react: "./react.ts",
  "@/platform/storage": "./storage.ts",
  "@/platform/cache": "./cache.ts",
  "@/api/local-cache": "./local-cache.ts",
};

registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STANDINS) {
      return { url: new URL(STANDINS[specifier], import.meta.url).href, shortCircuit: true };
    }

    const local = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), src)
      : specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$/.test(specifier)
        ? new URL(specifier, context.parentURL)
        : null;

    if (local) {
      for (const ending of [".ts", ".tsx", "/index.ts"]) {
        const url = new URL(local.href + ending);

        if (existsSync(url)) {
          return { url: url.href, shortCircuit: true };
        }
      }
    }

    return next(specifier, context);
  },
});
