import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { duration, escapeHtml, time, type Problem } from "./report.js";
import type { Unit } from "./stats.js";

// Why something broke, for alerts and /logs: the failed run of a service in
// the journal (at which stage, how it ended, its error lines) and a hint.
// All of it goes to Telegram, so every journal line passes redact() first.

const run = promisify(execFile);

const TIMEOUT_MS = 10_000;
const MAX_ERROR_LINES = 5;
const MAX_LINE_LENGTH = 300;
// Telegram allows 4096 characters.
const MAX_LOG_LENGTH = 3500;

export function redact(text: string) {
  return (
    text
      .replace(/\bbearer\s+\S+/gi, "Bearer [hidden]")
      .replace(/\/\/[^\s/@]+:[^\s/@]+@/g, "//[hidden]@")
      .replace(
        /\b([\w-]*(?:password|passwd|pwd|secret|token|key|authorization)[\w-]*)["']?\s*[=:]\s*["']?[^\s"',;&]+/gi,
        "$1=[hidden]",
      )
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
      .replace(/\b[A-Za-z0-9+_-]{32,}={0,2}/g, "[hidden]")
      // Loopback says where a local service is; other addresses may be users'.
      .replace(/\b(?!127\.|0\.0\.0\.0)\d{1,3}(?:\.\d{1,3}){3}\b(?![.\w])/g, "[ip]")
      .replace(/\b(?:[0-9a-f]{1,4}:){3,}[0-9a-f:]*/gi, "[ip]")
  );
}

type Entry = { at: Date; who: string; text: string };

// `journalctl -o short-unix`: "1793704279.769 host systemd[1]: text".
export function parseJournal(output: string): Entry[] {
  return output.split("\n").flatMap((line) => {
    const match = /^(\d+)(?:\.\d+)?\s+\S+\s+([^:\s]+):\s?(.*)$/.exec(line);
    return match ? [{ at: new Date(Number(match[1]) * 1000), who: match[2], text: match[3] }] : [];
  });
}

const ERROR_WORDS = /error|fail|fatal|panic|denied|refused|killed|out of memory|timed? ?out|cannot|can't|unable/i;

// JSON lines (the backend's, Caddy's) are reduced to their message: the rest
// holds requests, addresses and the like.
function logLine(text: string) {
  if (text.startsWith("{")) {
    try {
      const entry = JSON.parse(text) as { level?: unknown; msg?: unknown; error?: unknown; err?: { message?: unknown } };
      const error =
        typeof entry.level === "number" ? entry.level >= 50 : /^(error|fatal|panic)$/i.test(String(entry.level));

      return { text: String(entry.err?.message ?? entry.error ?? entry.msg ?? "(no message)"), error };
    } catch {
      // Not JSON after all.
    }
  }

  return { text, error: ERROR_WORDS.test(text) };
}

const clean = (text: string) => redact(text).slice(0, MAX_LINE_LENGTH);

export type Failure = {
  at?: Date;
  // How long the failed run lasted.
  seconds?: number;
  how?: string;
  // Of deploy/backup.sh.
  stage?: string;
  errors: string[];
  // It ran again after failing.
  recovered: boolean;
};

const FAILURE = /Main process exited, code=\w+, status=(?!0\/)|Failed with result|Failed to start|OOM killer/;
const SYSTEMD = /^systemd(\[|$)/;
const STAGE = /failed at stage: (.*?)(?: \(.*\))?$/;

function howItEnded(entries: Entry[]) {
  const lines = entries.filter((entry) => SYSTEMD.test(entry.who)).map((entry) => entry.text);

  if (lines.some((line) => /OOM killer|'oom-kill'/.test(line))) {
    return "killed: out of memory";
  }

  if (lines.some((line) => line.includes("'timeout'"))) {
    return "timed out";
  }

  if (lines.some((line) => line.includes("'start-limit-hit'"))) {
    return "restarted too often, systemd stopped trying";
  }

  const exit = lines
    .map((line) => /Main process exited, code=(\w+), status=(\d+)(?:\/(\w+))?/.exec(line))
    .filter((match) => match)
    .pop();

  if (!exit) {
    return undefined;
  }

  if (exit[1] === "exited") {
    return exit[3] && exit[3] !== "FAILURE" ? `exit code ${exit[2]} (${exit[3]})` : `exit code ${exit[2]}`;
  }

  return `killed by signal ${exit[3] ?? exit[2]}`;
}

function lastIndex(entries: Entry[], matches: (entry: Entry) => boolean) {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (matches(entries[index])) {
      return index;
    }
  }

  return -1;
}

// The last failed run in a unit's journal.
export function readFailure(entries: Entry[]): Failure {
  const failedAt = lastIndex(entries, (entry) => SYSTEMD.test(entry.who) && FAILURE.test(entry.text));
  const startedAt = lastIndex(
    entries.slice(0, failedAt < 0 ? undefined : failedAt),
    (entry) => SYSTEMD.test(entry.who) && /^(Starting|Started) /.test(entry.text),
  );
  const runEntries = failedAt < 0 ? entries : entries.slice(Math.max(startedAt, 0), failedAt + 1);
  const output = runEntries.filter((entry) => !SYSTEMD.test(entry.who));

  const stage = output
    .map((entry) => STAGE.exec(entry.text)?.[1])
    .filter(Boolean)
    .pop();
  const errors = output
    .filter((entry) => !/failed at stage: .*\(line \d+, exit \d+\)$/.test(entry.text))
    .map((entry) => logLine(entry.text))
    .filter((line) => line.error)
    .map((line) => clean(line.text));

  return {
    at: failedAt < 0 ? undefined : entries[failedAt].at,
    seconds:
      failedAt < 0 || startedAt < 0 ? undefined : (entries[failedAt].at.getTime() - entries[startedAt].at.getTime()) / 1000,
    how: failedAt < 0 ? undefined : howItEnded(runEntries),
    stage,
    errors: [...new Set(errors)].slice(-MAX_ERROR_LINES),
    recovered:
      failedAt >= 0 &&
      entries
        .slice(failedAt + 1)
        .some((entry) => SYSTEMD.test(entry.who) && /^Started |^Finished |Deactivated successfully/.test(entry.text)),
  };
}

function journal(unit: string, lines: number) {
  return run("journalctl", ["-u", unit, "-n", String(lines), "-o", "short-unix", "--no-pager", "-q"], {
    timeout: TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
}

export type UnitFailure = { unit: string; failure: Failure };

// null: the journal cannot be read; the alert goes out without the details.
export async function unitFailure(unit: string): Promise<UnitFailure | null> {
  try {
    const { stdout } = await journal(unit, 1000);
    return { unit, failure: readFailure(parseJournal(stdout)) };
  } catch {
    return null;
  }
}

// The services that can explain a problem.
export function unitsFor(problem: Problem, units: Unit[] | null) {
  const names = (units ?? []).map((unit) => unit.name);
  const { key } = problem;

  if (key.startsWith("unit ")) {
    return [key.slice("unit ".length)];
  }

  if (key.startsWith("backend ")) {
    return names.filter((name) => /^ostrich(@.+)?$/.test(name));
  }

  if (key === "database") {
    return names.filter((name) => name.startsWith("postgresql"));
  }

  if (key === "backup") {
    return ["ostrich-backup"];
  }

  if (key.startsWith("tls ")) {
    return ["caddy"];
  }

  return [];
}

// The processes using the most memory, e.g. "node 99 MB, postgres 40 MB".
export function topProcesses(ps: string, count = 3) {
  const memory = new Map<string, number>();

  for (const line of ps.split("\n")) {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);

    if (match) {
      memory.set(match[2], (memory.get(match[2]) ?? 0) + Number(match[1]));
    }
  }

  return [...memory]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([name, kb]) => `${name} ${Math.round(kb / 1024)} MB`)
    .join(", ");
}

// Worth knowing when memory is low or the backend slow.
export async function memoryUsers(problem: Problem) {
  if (problem.key !== "memory" && !problem.key.startsWith("slow ")) {
    return undefined;
  }

  try {
    const { stdout } = await run("ps", ["-eo", "rss=,comm="], { timeout: TIMEOUT_MS });
    return topProcesses(stdout);
  } catch {
    return undefined;
  }
}

// Commands in `backticks` show as code. At most two match one problem.
const HINTS: [RegExp, string][] = [
  [/stage: off-site/, "The local dump was made; only the copy off the server is missing."],
  [/no tomes available|\b503\b|service.unavailable/i, "A temporary failure on the other service's side; it usually passes. Run it again."],
  [/no space left|not enough disk|low disk|will be full/i, "See what grew: `du -xh --max-depth=2 / 2>/dev/null | sort -h | tail -15`"],
  [/out of memory|low memory|status=9\/KILL|signal KILL/i, "Not enough memory: see who uses it with `ps -eo rss,comm --sort=-rss | head`"],
  [/too many clients|connections:/i, "Postgres is out of connections: see them in `SELECT state, count(*) FROM pg_stat_activity GROUP BY 1`"],
  [/permission denied|operation not permitted|EACCES|EPERM/i, "A permission problem: the backend and the bot run as `ostrich` in a sandbox and write only to apps/server/data."],
  [/\b401\b|\b403\b|unauthorized|bad_auth|authentication failed/i, "The credentials were rejected: check the key or password in the settings."],
  [/ENOTFOUND|EAI_AGAIN|could not resolve|name resolution|no such host/i, "The name does not resolve: DNS or the network is down."],
  [/ECONNREFUSED|connection refused/i, "Nothing is listening there: the service is down or restarting."],
  [/ETIMEDOUT|timed? ?out|no answer in|is slow/i, "No answer in time: overloaded, hung, or the network."],
  [/\((EXEC|USER|CHDIR|NAMESPACE)\)/, "systemd could not start the program: check the paths and the user in the unit (`systemctl cat`)."],
  [/Cannot find module|SyntaxError/i, "A broken build: deploy again."],
  [/Last backup was/, "Is the timer on? `systemctl list-timers ostrich-backup`"],
  [/SSL certificate/, "Caddy renews certificates: see `journalctl -u caddy -n 50 --no-pager`"],
];

export function hintsFor(text: string) {
  return HINTS.filter(([pattern]) => pattern.test(text))
    .slice(0, 2)
    .map(([, hint]) => hint);
}

function formatHint(hint: string) {
  return escapeHtml(hint).replace(/`([^`]+)`/g, "<code>$1</code>");
}

const span = (seconds: number) => (seconds < 60 ? `${Math.round(seconds)} s` : duration(seconds));

function failureLines({ unit, failure }: UnitFailure, named: boolean, crashed: boolean) {
  const lines: string[] = [];
  const name = named ? ` (${escapeHtml(unit)})` : "";

  if (failure.stage) {
    lines.push(`<b>Stage${name}:</b> ${escapeHtml(failure.stage)}`);
  }

  if (failure.at) {
    const how = [
      failure.how ?? "failed",
      failure.seconds === undefined ? null : `after ${span(failure.seconds)}`,
      `at ${time(failure.at)}`,
      failure.recovered && !crashed ? "(it started again after that)" : null,
    ].filter(Boolean);

    lines.push(`<b>How${name}:</b> ${escapeHtml(how.join(" "))}`);
  }

  if (failure.errors.length > 0) {
    lines.push(`<b>Errors${name}:</b>`, `<pre>${escapeHtml(failure.errors.join("\n"))}</pre>`);
  }

  return lines;
}

// `title` is HTML; the rest is escaped here.
export function alertHtml(
  title: string,
  problem: Pick<Problem, "text" | "details">,
  failures: UnitFailure[],
  options: { memory?: string; crashed?: boolean } = {},
) {
  const useful = failures.filter(({ failure }) => failure.at || failure.errors.length > 0);
  const lines = [title, ...useful.flatMap((item) => failureLines(item, useful.length > 1, options.crashed ?? false))];

  if (problem.details?.length) {
    lines.push(`<pre>${escapeHtml(problem.details.map(clean).join("\n"))}</pre>`);
  }

  if (options.memory) {
    lines.push(`<b>Using the most memory:</b> ${escapeHtml(options.memory)}`);
  }

  const evidence = [
    problem.text,
    ...useful.flatMap(({ failure }) => [failure.stage && `stage: ${failure.stage}`, failure.how, ...failure.errors]),
    ...(problem.details ?? []),
  ].join("\n");

  lines.push(...hintsFor(evidence).map((hint) => `💡 ${formatHint(hint)}`));

  if (/ is failed /.test(problem.text) && failures.length === 1) {
    lines.push(`<code>systemctl restart ${escapeHtml(failures[0].unit)}</code>`);
  }

  for (const { unit } of useful) {
    lines.push(`<code>journalctl -u ${escapeHtml(unit)} -n 50 --no-pager</code>`);
  }

  return lines.join("\n");
}

// The journal's tail for /logs. `unit` must be one the bot watches.
export async function unitLog(unit: string, lines = 30) {
  let entries: Entry[];

  try {
    entries = parseJournal((await journal(unit, lines)).stdout);
  } catch {
    return `Cannot read the log of <b>${escapeHtml(unit)}</b>`;
  }

  if (entries.length === 0) {
    return `<b>${escapeHtml(unit)}</b>: the log is empty`;
  }

  const text = entries.map((entry) => `${time(entry.at)} ${clean(logLine(entry.text).text)}`).join("\n");

  return `<b>${escapeHtml(unit)}</b>\n<pre>${escapeHtml(text.slice(-MAX_LOG_LENGTH))}</pre>`;
}
