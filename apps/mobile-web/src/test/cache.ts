// Stands in for platform/cache.ts in the tests: remembers what was cleared.
export const cleared: string[] = [];

export async function cacheClear(prefix: string): Promise<void> {
  cleared.push(prefix);
}
