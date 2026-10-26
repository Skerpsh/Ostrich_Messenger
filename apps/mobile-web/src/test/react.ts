// Stands in for react in the tests, so the stores' hooks (useLock,
// useDuress...) can be called as plain functions: they read the value now.
export const useSyncExternalStore = <T>(_subscribe: unknown, get: () => T) => get();

export const useMemo = <T>(make: () => T) => make();
