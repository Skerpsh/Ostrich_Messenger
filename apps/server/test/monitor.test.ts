import assert from "node:assert/strict";
import { test } from "node:test";
import { AlertTracker } from "../src/monitor/alerts.js";
import { alertHtml, hintsFor, parseJournal, readFailure, redact, topProcesses, unitsFor } from "../src/monitor/diagnose.js";
import { bytes, dailySummary, duration, problems, report, short, type Thresholds } from "../src/monitor/report.js";
import { addSample, daysUntilFull, newDay } from "../src/monitor/state.js";
import type { BackendStats, Snapshot } from "../src/monitor/stats.js";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

const limits: Thresholds = {
  diskMinFreePercent: 10,
  diskMinFreeBytes: 2 * GB,
  diskFullAlertDays: 14,
  memoryMinFreePercent: 5,
  backupMaxAgeHours: 26,
  slowResponseMs: 3000,
  logErrorsAlert: 20,
  failedLoginsAlert: 50,
  certificateMinDays: 14,
};

const at = new Date("2026-10-08T12:00:00Z");

const backendStats: BackendStats = {
  online: 56,
  sockets: 70,
  active24h: 300,
  processes: 1,
  process: { instanceId: "p1", uptimeSeconds: 7200, rssBytes: 180 * MB },
  counters: { requests: 1000, serverErrors: 0, rateLimited: 2, failedLogins: 3 },
};

function snapshot(change: Partial<Snapshot> = {}): Snapshot {
  return {
    at,
    database: {
      ok: true,
      counts: {
        users: 1200,
        newUsers24h: 12,
        messagesRecent: 40,
        messages24h: 5000,
        groups: 30,
        sessions: 900,
        databaseBytes: 120 * MB,
        attachments: 77,
        attachmentBytes: 3 * GB,
        connections: 12,
        maxConnections: 100,
      },
    },
    backends: [{ url: "http://127.0.0.1:3000", ok: true, latencyMs: 45, stats: backendStats }],
    disks: [{ labels: ["system", "files"], path: "/", free: 20 * GB, total: 40 * GB }],
    memory: { available: 2 * GB, total: 4 * GB, swapFree: GB, swapTotal: GB },
    cpuTimes: { idle: 100, total: 200 },
    network: { received: 0, sent: 0 },
    load: [0.1, 0.2, 0.3],
    cpus: 2,
    uptimeSeconds: 3 * 86400 + 4 * 3600,
    units: [{ name: "ostrich", active: "active", sub: "running", problem: false, restarts: 0 }],
    backup: { file: "ostrich-x.dump", at: new Date(at.getTime() - 8 * 3_600_000), size: 12 * MB },
    logErrors: { count: 0 },
    ...change,
  };
}

// Telegram refuses a whole message with bad HTML: only these tags, closed
// in order, and nothing but <b> inside the quote.
function assertTelegramHtml(html: string) {
  const stack: string[] = [];

  for (const [, closing, name] of html.matchAll(/<(\/?)([a-z]+)[^>]*>/g)) {
    assert.ok(["b", "code", "blockquote"].includes(name), `tag <${name}>`);

    if (closing) {
      assert.equal(stack.pop(), name);
    } else {
      assert.ok(name === "b" || stack.length === 0, `<${name}> inside <${stack.at(-1)}>`);
      stack.push(name);
    }
  }

  assert.deepEqual(stack, []);
  assert.doesNotMatch(html.replace(/<\/?[a-z]+[^>]*>/g, ""), /[<>]/);
}

test("monitor: sizes and durations", () => {
  assert.equal(bytes(512), "512 B");
  assert.equal(bytes(1.5 * GB), "1.5 GB");
  assert.equal(bytes(-250 * MB), "−250 MB");
  assert.equal(short(1_234_567), "1.2M");
  assert.equal(short(45_600), "46K");
  assert.equal(duration(59), "0m");
  assert.equal(duration(2 * 3600 + 5 * 60), "2h 5m");
  assert.equal(duration(3 * 86400 + 4 * 3600), "3d 4h");
});

test("monitor: report of a healthy server", () => {
  assert.deepEqual(problems(snapshot(), limits), []);

  const text = report(snapshot(), limits, 15, {
    previous: { users: 1197, online: 52, messagesRecent: 48 },
    peak: { online: 80, at },
    cpuPercent: 12,
    traffic: { requests: 500, serverErrors: 1, rateLimited: 0, failedLogins: 2 },
  });

  assertTelegramHtml(text);
  const [summary, details] = text.split("<blockquote expandable>");
  assert.match(summary, /all good/);
  assert.match(summary, /1,200 users \+3 · 56 online ▲4/);
  assert.match(summary, /disk 50% · ram 50% · cpu 12%/);
  assert.match(details, /Messages: 40 \/ 15 min ▼8/);
  assert.match(details, /peak 80 at/);
  assert.match(details, /Requests: 500 \/ 15 min · 5xx: 1/);
  assert.match(details, /█████░░░░░ 50%/);
});

test("monitor: report when things are wrong", () => {
  const text = report(
    snapshot({
      backends: [{ url: "http://127.0.0.1:3000", ok: true, latencyMs: 20, statsError: "HTTP 404" }],
      logErrors: { count: 3, top: "a <weird> error & more" },
      units: [{ name: "caddy", active: "failed", sub: "failed", problem: true, restarts: 4 }],
    }),
    limits,
    15,
  );

  assertTelegramHtml(text);
  assert.match(text, /1 problem/);
  assert.match(text, /Online: — \(HTTP 404\)/);
  assert.match(text, /a &lt;weird&gt; error &amp; more/);
  assert.match(text, /❌ caddy \(4 restarts\)/);
});

test("monitor: problems", () => {
  const found = problems(
    snapshot({
      backends: [
        { url: "http://127.0.0.1:3001", ok: false, error: "fetch failed" },
        { url: "http://127.0.0.1:3002", ok: true, latencyMs: 5000 },
      ],
      database: { ok: false, error: "connection refused" },
      units: [{ name: "caddy", active: "failed", sub: "failed", problem: true, restarts: 0 }],
      disks: [
        { labels: ["system"], path: "/", free: 1 * GB, total: 100 * GB },
        { labels: ["files"], path: "/data", free: 50 * GB, total: 100 * GB },
      ],
      memory: { available: 100 * MB, total: 4 * GB, swapFree: 0, swapTotal: 0 },
      backup: { file: "ostrich-x.dump", at: new Date(at.getTime() - 30 * 3_600_000), size: 1 },
    }),
    limits,
    {
      recentLogErrors: { count: 25, top: "boom" },
      recentFailedLogins: 60,
      diskFullInDays: new Map([["/data", 5]]),
      certificates: [
        { host: "api.example.com", expiresAt: new Date(at.getTime() + 3 * 86_400_000) },
        { host: "ok.example.com", expiresAt: new Date(at.getTime() + 60 * 86_400_000) },
      ],
    },
  );

  assert.deepEqual(
    found.map((problem) => problem.key),
    [
      "backend http://127.0.0.1:3001",
      "slow http://127.0.0.1:3002",
      "database",
      "unit caddy",
      "disk /",
      "disk forecast /data",
      "memory",
      "backup",
      "log errors",
      "failed logins",
      "tls api.example.com",
    ],
  );
});

test("monitor: daily summary", () => {
  const text = dailySummary({
    date: at,
    newUsers: 12,
    newUsersBefore: 10,
    messages: 5000,
    messagesBefore: 5000,
    peak: { online: 80, at },
    active: 300,
    totalUsers: 1200,
    traffic: { requests: 1_234_567, serverErrors: 3, rateLimited: 1, failedLogins: 40, callsStarted: 25, callsAnswered: 19 },
    logErrors: { count: 14, top: "boom" },
    crashes: 0,
    databaseBytes: 120 * MB,
    databaseChange: 3 * MB,
    attachmentBytes: 3 * GB,
    attachmentChange: 120 * MB,
    disks: [{ label: "system", free: 20 * GB, change: -200 * MB, fullInDays: 29 }],
    updates: { pending: 12, security: 3, rebootRequired: true },
    backup: { at, size: 12 * MB },
  });

  assertTelegramHtml(text);
  assert.match(text, /New users: 12 \(▲20% vs the day before\)/);
  assert.match(text, /Messages: 5,000 \(same as the day before\)/);
  assert.match(text, /Requests: 1.2M/);
  assert.match(text, /Calls: 25 · answered: 19/);
  assert.match(text, /Database: 120 MB \(\+3 MB\)/);
  assert.match(text, /20 GB free \(\+200 MB used\) · full in ~29d/);
  assert.match(text, /12 updates \(3 security\) · reboot required/);
});

test("monitor: disk forecast", () => {
  const state = newDay(at);
  const day = 86_400_000;

  // Filling up 1 GB a day.
  for (let hour = 0; hour <= 48; hour += 6) {
    addSample(state, new Date(at.getTime() + hour * 3_600_000), { "/": 10 * GB + (hour / 24) * GB });
  }

  assert.equal(Math.round(daysUntilFull(state, "/", 20 * GB)!), 20);
  assert.equal(daysUntilFull(state, "/data", 20 * GB), undefined);

  // Not filling up: no forecast.
  const flat = newDay(at);

  for (let i = 0; i < 5; i++) {
    addSample(flat, new Date(at.getTime() + i * day), { "/": 10 * GB });
  }

  assert.equal(daysUntilFull(flat, "/", 20 * GB), undefined);
});

test("monitor: alerts after repeated checks, cleared once gone", () => {
  const tracker = new AlertTracker(2);
  const down = { key: "backend", text: "down" };

  assert.deepEqual(tracker.update([down]), { raised: [], cleared: [] });
  assert.deepEqual(tracker.update([down]), { raised: [down], cleared: [] });
  // Raised once only.
  assert.deepEqual(tracker.update([{ key: "backend", text: "still down" }]), { raised: [], cleared: [] });
  assert.deepEqual(tracker.update([]), { raised: [], cleared: [{ key: "backend", text: "still down" }] });

  // Seen once (a restart): no alert, nothing to clear.
  assert.deepEqual(tracker.update([down]), { raised: [], cleared: [] });
  assert.deepEqual(tracker.update([]), { raised: [], cleared: [] });
});

// The real failure of 2026-11-03, with its stage line added.
const FAILED_BACKUP = [
  '1793678434.1 host systemd[1]: Starting ostrich-backup.service - Ostrich database backup...',
  '1793678434.2 host backup.sh[1]: NOTICE: Config file "/root/.config/rclone/rclone.conf" not found - using defaults',
  '1793678435.1 host backup.sh[1]: ERROR : ostrich-20261103-040034.dump.age: Post request rcat error: no tomes available (503 service_unavailable)',
  '1793678435.2 host backup.sh[1]: backup: failed at stage: off-site: uploading the dump (line 130, exit 1)',
  '1793678435.3 host systemd[1]: ostrich-backup.service: Main process exited, code=exited, status=1/FAILURE',
  "1793678435.4 host systemd[1]: ostrich-backup.service: Failed with result 'exit-code'.",
  '1793678435.5 host systemd[1]: Failed to start ostrich-backup.service - Ostrich database backup.',
].join("\n");

test("monitor: a failed run: stage, how it ended, its errors", () => {
  const failure = readFailure(parseJournal(FAILED_BACKUP));

  assert.equal(failure.stage, "off-site: uploading the dump");
  assert.equal(failure.how, "exit code 1");
  assert.equal(failure.seconds, 1);
  assert.equal(failure.recovered, false);
  assert.deepEqual(failure.errors, [
    "ERROR : ostrich-20261103-040034.dump.age: Post request rcat error: no tomes available (503 service_unavailable)",
  ]);
});

test("monitor: an earlier failure is told apart from the last run, and a crash's signal", () => {
  const later = `${FAILED_BACKUP}\n1793700000.1 host systemd[1]: Starting ostrich-backup.service...\n1793700001.1 host backup.sh[2]: backup: copied to b2:x\n1793700002.1 host systemd[1]: ostrich-backup.service: Deactivated successfully.`;
  assert.equal(readFailure(parseJournal(later)).recovered, true);

  const crash = readFailure(
    parseJournal(
      [
        "1000.0 host systemd[1]: Started ostrich.service - Backend.",
        '1100.0 host node[3]: {"level":30,"msg":"request completed","req":{"remoteAddress":"8.8.8.8"}}',
        '1200.0 host node[3]: {"level":50,"msg":"x","err":{"message":"boom at 8.8.8.8"}}',
        "1300.0 host systemd[1]: ostrich.service: Main process exited, code=killed, status=11/SEGV",
        "1310.0 host systemd[1]: Started ostrich.service - Backend.",
      ].join("\n"),
    ),
  );

  assert.equal(crash.how, "killed by signal SEGV");
  assert.equal(crash.seconds, 300);
  // Only the message of a JSON line, and not its request.
  assert.deepEqual(crash.errors, ["boom at [ip]"]);

  const oom = "1.0 host systemd[1]: Started a.\n2.0 host systemd[1]: a.service: A process of this unit has been killed by the OOM killer.";
  assert.equal(readFailure(parseJournal(oom)).how, "killed: out of memory");

  // Nothing failed: no time, and only error lines are taken.
  const quiet = readFailure(parseJournal("1.0 host node[3]: listening\n2.0 host node[3]: cannot open x"));
  assert.equal(quiet.at, undefined);
  assert.deepEqual(quiet.errors, ["cannot open x"]);
});

test("monitor: secrets and addresses do not reach Telegram", () => {
  const hidden = [
    "RCLONE_CONFIG_B2_KEY=K0012345",
    "password: hunter2",
    'token="abc"',
    "Authorization: Bearer abc.def",
    "postgres://ostrich:hunter2@db/x",
    "login from 8.8.8.8 and 2001:db8:1:2::5 by me@example.com",
    "a".repeat(40),
  ].map(redact);

  for (const secret of ["K0012345", "hunter2", "abc", "8.8.8.8", "2001:db8", "me@example.com", "aaaa"]) {
    assert.ok(!hidden.join("\n").includes(secret), secret);
  }

  // What the alerts need stays.
  for (const kept of [
    "/var/backups/ostrich/ostrich-20261103-040034.dump",
    "connect ECONNREFUSED 127.0.0.1:5432",
    "password authentication failed for user",
    "04:00:34 62.238.111.55.nip.io",
  ]) {
    assert.equal(redact(kept), kept);
  }
});

test("monitor: an alert says what, how and at which stage, escaped", () => {
  const html = alertHtml(
    "🚨 <b>Service ostrich-backup is failed (failed)</b>",
    { text: "Service ostrich-backup is failed (failed)" },
    [{ unit: "ostrich-backup", failure: readFailure(parseJournal(FAILED_BACKUP)) }],
  );

  assert.match(html, /<b>Stage:<\/b> off-site: uploading the dump/);
  assert.match(html, /<b>How:<\/b> exit code 1 after 1 s at /);
  assert.match(html, /<pre>ERROR : .*no tomes available/);
  assert.match(html, /local dump was made/);
  assert.match(html, /temporary failure/);
  assert.match(html, /<code>systemctl restart ostrich-backup<\/code>/);
  assert.match(html, /<code>journalctl -u ostrich-backup -n 50 --no-pager<\/code>/);

  const tags = alertHtml("t", { text: "x", details: ["2× <b>&"] }, [
    { unit: "a", failure: { errors: ["</pre><i>"], recovered: false } },
  ]);
  assert.match(tags, /&lt;\/pre&gt;&lt;i&gt;/);
  assert.match(tags, /2× &lt;b&gt;&amp;/);
});

test("monitor: hints and the services behind a problem", () => {
  assert.equal(hintsFor("all quiet").length, 0);
  assert.match(hintsFor("write failed: No space left on device")[0], /du -xh/);
  assert.match(hintsFor("connect ECONNREFUSED 127.0.0.1:5432")[0], /Nothing is listening/);
  assert.match(hintsFor("exit code 203 (EXEC)")[0], /could not start the program/);

  const units = ["ostrich", "ostrich@3001", "ostrich-monitor", "postgresql@18-main", "caddy"].map((name) => ({
    name,
    active: "active",
    sub: "running",
    problem: false,
    restarts: 0,
  }));
  const of = (key: string) => unitsFor({ key, text: "" }, units);

  assert.deepEqual(of("unit caddy"), ["caddy"]);
  assert.deepEqual(of("backend http://127.0.0.1:3000"), ["ostrich", "ostrich@3001"]);
  assert.deepEqual(of("database"), ["postgresql@18-main"]);
  assert.deepEqual(of("backup"), ["ostrich-backup"]);
  assert.deepEqual(of("memory"), []);
});

test("monitor: the processes using the most memory, summed by name", () => {
  assert.equal(topProcesses(" 2048 node\n 1024 postgres\n 1024 postgres\n 512 sshd\n 10 bash\n"), "node 2 MB, postgres 2 MB, sshd 1 MB");
});

test("monitor: open alerts survive a new day", () => {
  const state = newDay(at);
  state.alerts = { backup: { text: "x", since: 1, remindedAt: 1 } };
  assert.deepEqual(newDay(at, state).alerts, state.alerts);
});

test("monitor: the most frequent log errors go into the alert", () => {
  const [problem] = problems(snapshot(), limits, {
    recentLogErrors: { count: 25, top: "boom", tops: [{ message: "boom", count: 20 }, { message: "bang", count: 5 }] },
  });

  assert.deepEqual(problem.details, ["20× boom", "5× bang"]);
});
