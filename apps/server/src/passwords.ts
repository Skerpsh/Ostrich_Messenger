import argon2 from "argon2";

// Argon2 takes about 64 MB and several threads per password, from the pool
// file operations need too, and anyone can ask for it by trying to log in.
// So few run at once (per process), a few more wait, the rest are refused.
export const MAX_RUNNING = 2;
export const MAX_WAITING = 20;

let running = 0;
const waiting: (() => void)[] = [];

export async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (running < MAX_RUNNING) {
    running++;
  } else if (waiting.length < MAX_WAITING) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    // server.ts answers with its status and message.
    throw Object.assign(new Error("The server is busy, try again in a moment"), { statusCode: 429 });
  }

  try {
    return await work();
  } finally {
    // The next one takes over this one's place.
    const next = waiting.shift();

    if (next) {
      next();
    } else {
      running--;
    }
  }
}

export const hashPassword = (password: string) => limited(() => argon2.hash(password));

export const verifyPassword = (hash: string, password: string) => limited(() => argon2.verify(hash, password));
