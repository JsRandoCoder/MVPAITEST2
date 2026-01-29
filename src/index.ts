// src/index.ts
/**
* Cloudflare Worker: ARA (free-tier friendly)
*
* - Single Worker serves UI + API.
* - Durable task state + events in D1.
* - Durable Object ("Scheduler") provides retries + DLQ ("dead") via alarms.
*
* Bindings required (Dashboard → Workers & Pages → Your Worker → Settings → Bindings):
* - D1 Database binding name: DB
* - Durable Object binding name: SCHEDULER (class Scheduler)
*/

export interface Env {
DB: D1Database;
SCHEDULER: DurableObjectNamespace;
// Optional: OpenAI (paid) - leave unset to use heuristic agent.
OPENAI_API_KEY?: string;
OPENAI_MODEL?: string; // e.g. gpt-4o-mini
}

type TaskStatus = "queued" | "running" | "retry" | "completed" | "dead" | "canceled";

type CreateTaskRequest = {
prompt: string;
python_code?: string; // kept for compatibility with earlier scaffold; no Python tool in Worker by default.
};

type TaskRow = {
id: string;
status: TaskStatus;
prompt: string;
result: string | null;
error: string | null;
attempts: number;
max_attempts: number;
retry_at: string | null; // ISO
created_at: string;
updated_at: string;
};

type EventRow = {
id: number;
task_id: string;
type: string;
data: string | null;
created_at: string;
};

const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>ARA (Cloudflare Worker)</title>
<style>
body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; max-width: 980px; }
textarea { width: 100%; min-height: 120px; padding: 12px; font-size: 14px; }
button { padding: 10px 14px; font-size: 14px; cursor: pointer; }
.row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.card { border: 1px solid #ddd; border-radius: 12px; padding: 14px; margin-top: 14px; }
.muted { color:#666; font-size: 13px; }
pre { white-space: pre-wrap; word-break: break-word; }
.log { max-height: 340px; overflow: auto; background: #fafafa; border-radius: 10px; padding: 10px; border: 1px solid #eee; }
input[type="text"] { padding: 10px; border: 1px solid #ddd; border-radius: 10px; width: min(520px, 100%); }
.pill { display:inline-block; padding: 2px 8px; border: 1px solid #ddd; border-radius: 999px; font-size: 12px; }
.ok { border-color: #a7f3d0; background: #ecfdf5; }
.bad { border-color: #fecaca; background: #fef2f2; }
a { color: inherit; }
</style>
</head>
<body>
<h1>ARA <span id="status" class="pill bad">idle</span></h1>
<p class="muted">
This is a single Cloudflare Worker: UI + API + background processing via Durable Objects.
</p>

<div class="card">
<div class="row">
<button id="create">Create Task</button>
<button id="cancel">Cancel</button>
<input id="taskId" type="text" placeholder="task id (auto)" />
<a class="muted" href="/api/health" target="_blank">/api/health</a>
</div>
<h3>Prompt</h3>
<textarea id="prompt" placeholder="What should the agent do?"></textarea>
<p class="muted">
Tip: If you include a URL, the agent will attempt to fetch it. “Latest/current” answers are best-effort without a paid model.
</p>
</div>

<div class="card">
<h3>Output</h3>
<pre id="output"></pre>
</div>

<div class="card">
<h3>Events</h3>
<pre id="log" class="log"></pre>
</div>

<script>
(() => {
const statusEl = document.getElementById("status");
const promptEl = document.getElementById("prompt");
const taskIdEl = document.getElementById("taskId");
const outEl = document.getElementById("output");
const logEl = document.getElementById("log");
const createBtn = document.getElementById("create");
const cancelBtn = document.getElementById("cancel");

const setStatus = (ok, text) => {
statusEl.textContent = text;
statusEl.className = "pill " + (ok ? "ok" : "bad");
};

const log = (msg) => {
logEl.textContent += "[" + new Date().toLocaleTimeString() + "] " + msg + "\\n";
logEl.scrollTop = logEl.scrollHeight;
};

async function api(path, opts) {
const res = await fetch(path, { ...opts, headers: { "content-type": "application/json", ...(opts && opts.headers || {}) } });
if (!res.ok) throw new Error("HTTP " + res.status + " " + (await res.text()));
return res.headers.get("content-type")?.includes("application/json") ? res.json() : res.text();
}

let eventSource = null;

function startEvents(taskId) {
stopEvents();
const url = "/api/tasks/" + encodeURIComponent(taskId) + "/events";
eventSource = new EventSource(url);
eventSource.onmessage = (ev) => log(ev.data);
eventSource.onerror = () => {
stopEvents();
setTimeout(() => startEvents(taskId), 1500);
};
}

function stopEvents() {
if (eventSource) {
eventSource.close();
eventSource = null;
}
}

async function poll(taskId) {
for (;;) {
const t = await api("/api/tasks/" + encodeURIComponent(taskId), { method: "GET" });
setStatus(t.status === "completed", t.status);
if (t.result) outEl.textContent = t.result;
if (t.error) outEl.textContent = "ERROR:\\n" + t.error + "\\n\\n" + (t.result || "");
if (["completed","dead","canceled"].includes(t.status)) break;
await new Promise(r => setTimeout(r, 1200));
}
}

createBtn.onclick = async () => {
outEl.textContent = "";
logEl.textContent = "";
setStatus(false, "creating");
const prompt = (promptEl.value || "").trim();
if (!prompt) return alert("Enter a prompt.");
const created = await api("/api/tasks", { method: "POST", body: JSON.stringify({ prompt }) });
taskIdEl.value = created.id;
log("created task " + created.id);
setStatus(false, "queued");
startEvents(created.id);
poll(created.id).catch(e => log("poll error: " + e.message));
};

cancelBtn.onclick = async () => {
const id = (taskIdEl.value || "").trim();
if (!id) return alert("No task id.");
await api("/api/tasks/" + encodeURIComponent(id) + "/cancel", { method: "POST", body: "{}" });
log("cancel requested");
};
})();
</script>
</body>
</html>`;

function json(data: unknown, init?: ResponseInit): Response {
return new Response(JSON.stringify(data, null, 2), {
...init,
headers: {
"content-type": "application/json; charset=utf-8",
...(init?.headers || {})
}
});
}

function text(data: string, init?: ResponseInit): Response {
return new Response(data, {
...init,
headers: {
"content-type": "text/plain; charset=utf-8",
...(init?.headers || {})
}
});
}

function withCors(res: Response, origin = "*"): Response {
const h = new Headers(res.headers);
h.set("Access-Control-Allow-Origin", origin);
h.set("Access-Control-Allow-Headers", "*");
h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
h.set("Access-Control-Expose-Headers", "content-type");
return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

function nowIso(): string {
return new Date().toISOString();
}

function parseUrlPath(pathname: string): string[] {
return pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
}

async function dbExec(db: D1Database, sql: string, params: unknown[] = []): Promise<void> {
await db.prepare(sql).bind(...params).run();
}

async function dbFirst<T>(db: D1Database, sql: string, params: unknown[] = []): Promise<T | null> {
const res = await db.prepare(sql).bind(...params).first<T>();
return res ?? null;
}

async function dbAll<T>(db: D1Database, sql: string, params: unknown[] = []): Promise<T[]> {
const res = await db.prepare(sql).bind(...params).all<T>();
return (res.results ?? []) as T[];
}

async function emitEvent(db: D1Database, taskId: string, type: string, data?: unknown): Promise<void> {
const payload = data === undefined ? null : JSON.stringify(data);
await dbExec(db, `INSERT INTO ara_task_events (task_id, type, data, created_at) VALUES (?, ?, ?, ?)`, [
taskId,
type,
payload,
nowIso()
]);
}

async function createTask(db: D1Database, prompt: string): Promise<TaskRow> {
const id = crypto.randomUUID();
const ts = nowIso();
const maxAttempts = 5;

await dbExec(
db,
`INSERT INTO ara_tasks (id, status, prompt, result, error, attempts, max_attempts, retry_at, created_at, updated_at)
VALUES (?, 'queued', ?, NULL, NULL, 0, ?, NULL, ?, ?)`,
[id, prompt, maxAttempts, ts, ts]
);

await emitEvent(db, id, "queued", { prompt });
return (await getTask(db, id))!;
}

async function getTask(db: D1Database, id: string): Promise<TaskRow | null> {
return dbFirst<TaskRow>(
db,
`SELECT id, status, prompt, result, error, attempts, max_attempts, retry_at, created_at, updated_at
FROM ara_tasks WHERE id = ?`,
[id]
);
}

async function cancelTask(db: D1Database, id: string): Promise<void> {
const t = await getTask(db, id);
if (!t) return;
if (["completed", "dead", "canceled"].includes(t.status)) return;

await dbExec(db, `UPDATE ara_tasks SET status='canceled', updated_at=? WHERE id=?`, [nowIso(), id]);
await emitEvent(db, id, "canceled");
}

async function openaiAnswer(env: Env, prompt: string): Promise<string> {
const model = env.OPENAI_MODEL || "gpt-4o-mini";
const res = await fetch("https://api.openai.com/v1/chat/completions", {
method: "POST",
headers: {
"content-type": "application/json",
authorization: `Bearer ${env.OPENAI_API_KEY}`
},
body: JSON.stringify({
model,
messages: [
{ role: "system", content: "You are a helpful agent. Answer concisely and correctly." },
{ role: "user", content: prompt }
],
temperature: 0.2
})
});
if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
const data: any = await res.json();
return data?.choices?.[0]?.message?.content ?? "";
}

function heuristicPlan(prompt: string): string[] {
const steps: string[] = [];
if (/\bhttps?:\/\/\S+/i.test(prompt)) steps.push("Fetch referenced URL(s).");
if (/\b(latest|today|current|news)\b/i.test(prompt)) steps.push("Search (best-effort) and summarize.");
steps.push("Draft answer.");
return steps;
}

async function ddgSearchHtml(query: string): Promise<string> {
const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ARA/1.0)" } });
return await res.text();
}

async function fetchText(url: string): Promise<string> {
const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ARA/1.0)" } });
const ct = res.headers.get("content-type") || "";
if (!res.ok) return `Fetch failed ${res.status} ${res.statusText}`;
if (ct.includes("application/json")) return JSON.stringify(await res.json(), null, 2);
return await res.text();
}

async function runGraph(env: Env, prompt: string): Promise<{ result: string; trace: any }> {
const plan = heuristicPlan(prompt);

let evidence = "";
const urls = Array.from(prompt.matchAll(/\bhttps?:\/\/\S+/gi)).map((m) => m[0].replace(/[)\],.]+$/g, ""));
for (const u of urls.slice(0, 2)) {
const t = await fetchText(u);
evidence += `\n[fetch:${u}]\n${t.slice(0, 4000)}\n`;
}

if (/\b(latest|today|current|news)\b/i.test(prompt)) {
const html = await ddgSearchHtml(prompt);
evidence += `\n[search:duckduckgo_html]\n${html.slice(0, 4000)}\n`;
}

let draft =
`Plan:\n${plan.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n` +
`Evidence (best-effort):\n${evidence || "(none)"}\n\nAnswer:\n`;

if (env.OPENAI_API_KEY) {
const llm = await openaiAnswer(env, `${prompt}\n\nUse this evidence if helpful:\n${evidence}`);
draft += llm.trim();
} else {
draft += `I can answer using best-effort web fetch/search. For higher quality, set OPENAI_API_KEY as a Worker secret.`;
}

const issues: string[] = [];
if (draft.length < 80) issues.push("Answer is too short.");
if (/\b(latest|today|current)\b/i.test(prompt) && !env.OPENAI_API_KEY) issues.push("Without a paid model, ‘latest’ may be incomplete.");

const refined = issues.length ? `${draft}\n\nCritic notes:\n${issues.map((x) => `- ${x}`).join("\n")}\n` : draft;
return { result: refined, trace: { plan, issues, urls } };
}

async function schedulerWake(env: Env): Promise<void> {
const id = env.SCHEDULER.idFromName("singleton");
const stub = env.SCHEDULER.get(id);
await stub.fetch("https://scheduler/enqueue", { method: "POST", body: "{}" });
}

export default {
async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
const url = new URL(request.url);
const path = url.pathname;

if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

if (path === "/" && request.method === "GET") {
return new Response(UI_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
}

if (path === "/api/health" && request.method === "GET") {
return withCors(json({ ok: true, ts: nowIso() }));
}

const parts = parseUrlPath(path);

if (parts.length === 2 && parts[0] === "api" && parts[1] === "tasks" && request.method === "POST") {
const body = (await request.json().catch(() => ({}))) as Partial<CreateTaskRequest>;
const prompt = (body.prompt || "").trim();
if (!prompt) return withCors(json({ error: "prompt is required" }, { status: 400 }));

const task = await createTask(env.DB, prompt);
ctx.waitUntil(schedulerWake(env));
return withCors(json({ id: task.id, status: task.status }));
}

if (parts.length === 3 && parts[0] === "api" && parts[1] === "tasks" && request.method === "GET") {
const task = await getTask(env.DB, parts[2]);
if (!task) return withCors(json({ error: "not found" }, { status: 404 }));
return withCors(json(task));
}

if (parts.length === 4 && parts[0] === "api" && parts[1] === "tasks" && parts[3] === "cancel" && request.method === "POST") {
await cancelTask(env.DB, parts[2]);
ctx.waitUntil(schedulerWake(env));
return withCors(json({ ok: true }));
}

if (parts.length === 4 && parts[0] === "api" && parts[1] === "tasks" && parts[3] === "events" && request.method === "GET") {
const taskId = parts[2];
const task = await getTask(env.DB, taskId);
if (!task) return withCors(json({ error: "not found" }, { status: 404 }));

const encoder = new TextEncoder();
const since = Number(url.searchParams.get("since") || "0");

const stream = new ReadableStream<Uint8Array>({
async start(controller) {
const started = Date.now();
let lastId = since;

const send = (s: string) => controller.enqueue(encoder.encode(s));
const sendEvent = (id: number, data: string) => {
send(`id: ${id}\n`);
send(`event: message\n`);
send(`data: ${data.replace(/\n/g, "\\n")}\n\n`);
};

send(`retry: 1500\n\n`);

while (Date.now() - started < 25_000) {
const rows = await dbAll<EventRow>(
env.DB,
`SELECT id, task_id, type, data, created_at
FROM ara_task_events WHERE task_id=? AND id>? ORDER BY id ASC LIMIT 50`,
[taskId, lastId]
);

if (rows.length) {
for (const r of rows) {
lastId = r.id;
sendEvent(
r.id,
JSON.stringify({ type: r.type, data: r.data ? JSON.parse(r.data) : null, at: r.created_at })
);
}
} else {
send(`event: message\ndata: ${JSON.stringify({ type: "heartbeat", at: nowIso() })}\n\n`);
}

await new Promise((r) => setTimeout(r, 1000));
}

controller.close();
}
});

return withCors(
new Response(stream, {
headers: {
"content-type": "text/event-stream; charset=utf-8",
"cache-control": "no-cache",
connection: "keep-alive"
}
})
);
}

return withCors(text("Not found", { status: 404 }));
}
};

export class Scheduler implements DurableObject {
private state: DurableObjectState;
private env: Env;

constructor(state: DurableObjectState, env: Env) {
this.state = state;
this.env = env;
}

async fetch(request: Request): Promise<Response> {
const url = new URL(request.url);
if (request.method === "POST" && url.pathname === "/enqueue") {
await this.state.storage.put("last_wake", nowIso());
await this.state.setAlarm(Date.now() + 1);
return new Response("ok");
}
return new Response("not found", { status: 404 });
}

async alarm(): Promise<void> {
await this.processDueTasks();
const next = await this.nextRetryAt();
if (next) {
const ms = Math.max(1000, next.getTime() - Date.now());
await this.state.setAlarm(Date.now() + ms);
}
}

private async nextRetryAt(): Promise<Date | null> {
const row = await dbFirst<{ retry_at: string }>(
this.env.DB,
`SELECT retry_at FROM ara_tasks
WHERE status IN ('queued','retry') AND retry_at IS NOT NULL
ORDER BY retry_at ASC LIMIT 1`
);
if (!row?.retry_at) return null;
const d = new Date(row.retry_at);
return isNaN(d.getTime()) ? null : d;
}

private backoffMs(attempt: number): number {
const base = 5000;
const cap = 5 * 60_000;
const exp = Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));
const jitter = Math.floor(Math.random() * 750);
return Math.min(cap, exp + jitter);
}

private async claimBatch(limit = 3): Promise<TaskRow[]> {
const now = nowIso();
const tasks = await dbAll<TaskRow>(
this.env.DB,
`SELECT id, status, prompt, result, error, attempts, max_attempts, retry_at, created_at, updated_at
FROM ara_tasks
WHERE status IN ('queued','retry')
AND (retry_at IS NULL OR retry_at <= ?)
ORDER BY created_at ASC
LIMIT ?`,
[now, limit]
);

for (const t of tasks) {
await dbExec(
this.env.DB,
`UPDATE ara_tasks SET status='running', attempts=attempts+1, updated_at=? WHERE id=? AND status IN ('queued','retry')`,
[nowIso(), t.id]
);
await emitEvent(this.env.DB, t.id, "running", { attempt: t.attempts + 1 });
}

const claimed: TaskRow[] = [];
for (const t of tasks) {
const r = await getTask(this.env.DB, t.id);
if (r && r.status === "running") claimed.push(r);
}
return claimed;
}

private async processDueTasks(): Promise<void> {
const batch = await this.claimBatch(3);

for (const task of batch) {
try {
const { result, trace } = await runGraph(this.env, task.prompt);

await dbExec(
this.env.DB,
`UPDATE ara_tasks SET status='completed', result=?, error=NULL, retry_at=NULL, updated_at=? WHERE id=?`,
[result, nowIso(), task.id]
);
await emitEvent(this.env.DB, task.id, "completed", { trace });
} catch (err: any) {
const msg = err?.message || String(err);
const latest = await getTask(this.env.DB, task.id);
const attempts = latest?.attempts ?? task.attempts;
const maxAttempts = latest?.max_attempts ?? task.max_attempts;

if (attempts >= maxAttempts) {
await dbExec(this.env.DB, `UPDATE ara_tasks SET status='dead', error=?, updated_at=? WHERE id=?`, [
msg,
nowIso(),
task.id
]);
await emitEvent(this.env.DB, task.id, "dead", { error: msg });
} else {
const retryAt = new Date(Date.now() + this.backoffMs(attempts)).toISOString();
await dbExec(
this.env.DB,
`UPDATE ara_tasks SET status='retry', error=?, retry_at=?, updated_at=? WHERE id=?`,
[msg, retryAt, nowIso(), task.id]
);
await emitEvent(this.env.DB, task.id, "retry_scheduled", { error: msg, retry_at: retryAt, attempt: attempts });
}
}
}
}
}
