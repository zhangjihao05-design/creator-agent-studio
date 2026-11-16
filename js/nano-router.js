// nano-router.js — a no-key, no-server model route for this site.
//
// Chrome ships Gemini Nano on the visitor's device (the Prompt API, `LanguageModel`).
// The agentic-web runtime speaks to OpenAI-compatible routers over fetch, so this module
// answers requests for NANO_ROUTER in the page itself: it turns the chat messages and the
// tool list into one Prompt API call constrained by a JSON schema (either a reply or one
// tool call), then streams the answer back as OpenAI server-sent events. Agent delegation,
// the Hook Lab partner call and the website_* tools keep working unchanged; they simply run
// on the visitor's own machine. Nothing the visitor types leaves the device.
//
// Idea credit: the in-page Gemini Nano route was first shown for this runtime by the
// "Plainly" entry (agentic-web PR #29). This file is our own implementation; no code copied.

export const NANO_ROUTER = "https://on-device.gemini-nano.invalid/v1";
export const NANO_MODEL = "gemini-nano";
export const NANO_KEY = "on-device";
const LANGS = ["en"];
const OPTS = {
  expectedInputs: [{type: "text", languages: LANGS}],
  expectedOutputs: [{type: "text", languages: LANGS}],
};

export const nanoStats = {calls: 0, toolCalls: 0, ms: 0};

/** "available", "downloadable", "downloading", "unavailable" or "unsupported". */
export async function nanoAvailability() {
  const LM = globalThis.LanguageModel;
  if (!LM?.availability) return "unsupported";
  try {
    return await LM.availability(OPTS);
  } catch {
    return "unavailable";
  }
}

/** Create one session so Chrome downloads the model. Call from a click (user activation). */
export async function prepareNano(onProgress) {
  const session = await globalThis.LanguageModel.create({
    ...OPTS,
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => onProgress?.(e.loaded));
    },
  });
  session.destroy?.();
}

const text = (c) => (c == null ? "" : typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (typeof p === "string" ? p : p?.text || "")).join("") : String(c));
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)} …` : s);
const fnOf = (t) => t?.function || t;

/** Arguments as a short signature, e.g. "posts: string[], title?: string". */
function signature(params) {
  const props = params?.properties || {};
  const req = new Set(params?.required || []);
  const typeOf = (p) => (p?.type === "array" ? `${p.items?.type === "object" ? `{${Object.keys(p.items.properties || {}).join(",")}}` : p.items?.type || "any"}[]` : p?.type || "any");
  return Object.entries(props).map(([k, v]) => `${k}${req.has(k) ? "" : "?"}: ${typeOf(v)}`).join(", ");
}

/**
 * One prompt for the device: instructions, tools and the newest turns, each cut to a level.
 * level 0 is the fullest; higher levels drop detail so it fits a small on-device context.
 */
export function toPrompt(messages = [], tools = [], level = 0) {
  const L = [
    {system: 9000, desc: 240, history: 9000, result: 2500, old: 200, args: 120},
    {system: 4500, desc: 120, history: 4500, result: 1200, old: 140, args: 90},
    {system: 2200, desc: 70, history: 3000, result: 600, old: 100, args: 70},
    {system: 900, desc: 0, history: 2400, result: 300, old: 60, args: 50},
  ][Math.min(level, 3)];
  const system = messages.filter((m) => m.role === "system").map((m) => text(m.content)).join("\n\n").replace(/\n{3,}/g, "\n\n");
  const toolLines = (tools || []).map((t) => {
    const f = fnOf(t);
    const desc = L.desc ? `: ${cut((f.description || "").replace(/\s+/g, " "), L.desc)}` : "";
    return `- ${f.name}(${signature(f.parameters)})${desc}`;
  });
  const rules = toolLines.length
    ? `\n\nReply only with JSON. To use a tool: {"type":"tool_call","tool":"<name>","arguments":{...}}. To reply: {"type":"answer","content":"..."}. One tool at a time; keep going until the request is done, then answer. Never invent a tool result.\nTools:\n${toolLines.join("\n")}`
    : `\n\nReply only with JSON: {"type":"answer","content":"..."}.`;
  // Keep every step so the agent sees what it already did; only the newest tool result keeps
  // its detail, older ones shrink to a line. Drop the oldest turns only if that still overflows.
  const rest = messages.filter((m) => m.role !== "system");
  const lastTool = rest.map((m) => m.role).lastIndexOf("tool");
  const lines = rest.map((m, i) => {
    if (m.role === "tool") return `TOOL RESULT ${m.name || ""}: ${cut(text(m.content).replace(/\s+/g, " "), i === lastTool ? L.result : L.old)}`;
    if (m.role === "assistant") {
      const calls = (m.tool_calls || []).map((c) => `${c.function?.name}(${cut(c.function?.arguments || "", L.args)})`).join("; ");
      return `ASSISTANT: ${cut(text(m.content), L.old * 2)}${calls ? ` [called ${calls}]` : ""}`;
    }
    return `${String(m.role).toUpperCase()}: ${cut(text(m.content), L.history)}`;
  });
  let used = lines.reduce((n, l) => n + l.length + 2, 0);
  while (lines.length > 2 && used > L.history) used -= lines.splice(1, 1)[0].length + 2; // keep the first request
  return {system: cut(system, L.system) + rules, transcript: lines.join("\n\n")};
}

/**
 * Schema for the reply. Full: one branch per tool with that tool's own argument schema.
 * Compact (for small contexts): the tool name from a list, arguments as any object; the
 * runtime still checks the arguments against the real tool schema.
 */
export function replySchema(tools = [], compact = false) {
  const answer = {type: "object", properties: {type: {type: "string", enum: ["answer"]}, content: {type: "string"}}, required: ["type", "content"]};
  if (!tools?.length) return answer;
  if (compact) {
    return {anyOf: [
      {type: "object", properties: {type: {type: "string", enum: ["tool_call"]}, tool: {type: "string", enum: tools.map((t) => fnOf(t).name)}, arguments: {type: "object"}}, required: ["type", "tool", "arguments"]},
      answer,
    ]};
  }
  return {
    anyOf: [
      ...tools.map((t) => {
        const f = fnOf(t);
        const params = f.parameters?.type === "object" ? f.parameters : {type: "object", properties: {}};
        return {type: "object", properties: {type: {type: "string", enum: ["tool_call"]}, tool: {type: "string", enum: [f.name]}, arguments: params}, required: ["type", "tool", "arguments"]};
      }),
      answer,
    ],
  };
}

/** Read the model's JSON. Unparseable output is reported as "invalid" when the agent
 * has tools to call, so the caller can retry instead of mistaking it for a final answer. */
export function readReply(raw, tools = []) {
  let obj;
  try {
    obj = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
  } catch {
    if (tools?.length) return {type: "invalid", raw: String(raw || "")};
    return {type: "answer", content: String(raw || "").trim() || "Sorry, I could not work that out."};
  }
  const tool = (tools || []).map(fnOf).find((f) => f.name === obj?.tool);
  if (obj?.type === "tool_call" && tool) {
    const args = obj.arguments && typeof obj.arguments === "object" ? obj.arguments : {};
    for (const k of tool.parameters?.required || []) {
      if (args[k] == null && tool.parameters.properties?.[k]?.type === "string") args[k] = "";
    }
    return {type: "tool_call", tool: tool.name, arguments: args};
  }
  if (obj?.type === "answer") return {type: "answer", content: String(obj?.content ?? "").trim() || "Done."};
  if (tools?.length) return {type: "invalid", raw: String(raw || "")};
  return {type: "answer", content: String(obj?.content ?? "").trim() || "Done."};
}

function stream(chunks) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(body, {status: 200, headers: {"Content-Type": "text/event-stream"}});
}

const chunk = (id, delta, finish = null) => ({id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: NANO_MODEL, choices: [{index: 0, delta, finish_reason: finish}]});

const tooLarge = (e) => e?.name === "QuotaExceededError" || /too large|quota|exceed/i.test(String(e?.message || e));

// Each try: a prompt level. On-device always uses the compact reply schema: the full
// per-tool grammar is far too large for Gemini Nano and degrades its output; the runtime
// still validates the arguments against the real tool schema afterwards.
const PLAN = [[0, true], [1, true], [2, true], [3, true]];

// Appended on retries after an unreadable reply: small models follow a concrete example
// at the very end of the prompt far better than an abstract instruction.
const RETRY_NOTE = `\n\nIMPORTANT: your previous reply was not valid JSON. Reply with exactly one JSON object and no other text. Example: {"type":"tool_call","tool":"<tool name>","arguments":{...}} or {"type":"answer","content":"..."}.`;

// Signs that Nano handed back its own input instead of generating: Chrome's prompt
// template header ("CPU backend", "TopK: 64, Temp: 1", "User:") or our section labels.
const ECHO = /CPU backend|GPU backend|Fastest inference|Highest quality|TopK:\s*\d|Temp:\s*\d|^\s*User:|INSTRUCTIONS\s|CONVERSATION\s/i;
const BANNER = /^\s*(CPU backend|GPU backend)|Fastest inference\s*TopK:|TopK:\s*\d+,\s*Temp:/i;
export const looksLikeEcho = (raw) => ECHO.test(String(raw || "").slice(0, 400));

// Set once this tab has proved Nano only echoes, so later steps fail at once.
let nanoBroken = "";

const BROKEN_MSG = (sample) => `The on-device model in your browser is not really working: it sent back its own input instead of an answer ("${cut(sample.replace(/\s+/g, " "), 70)}"), which usually means Chrome did not finish installing Gemini Nano. This is not a fault of this website. To continue, open AI model settings and add a free Google AI Studio key, or use "Replay a recorded run".`;

// Also say it on the page, next to the free-mode button, so nobody thinks the site is broken.
function showBrokenOnPage() {
  try {
    const note = globalThis.document?.querySelector("#nano-note");
    if (note) {
      note.textContent = "Your browser's on-device model (Gemini Nano) is not really working on this computer, likely an incomplete install by Chrome. The website is fine: add a free Google AI Studio key in AI model settings, or use the replay.";
      note.classList.add("error");
    }
  } catch {}
}

/** A tiny health check: can this device's Nano answer "OK" at all? */
async function nanoCanAnswer(LM, signal) {
  const s = await LM.create({...OPTS, signal});
  try {
    const out = await s.prompt("Reply with the single word OK.", {signal});
    return {ok: !looksLikeEcho(out) && /\bok\b/i.test(out), out: String(out || "")};
  } finally {
    s.destroy?.();
  }
}

/** One chat completion on Gemini Nano, returned as an OpenAI SSE Response. */
export async function completeOnDevice(req, signal) {
  const LM = globalThis.LanguageModel;
  if (!LM) throw new Error("Gemini Nano is not available in this browser.");
  if (nanoBroken) throw new Error(BROKEN_MSG(nanoBroken));
  const started = performance.now();
  let raw, lastErr, quota = 0, reply = null, invalidRaw = "", echoes = 0;
  // Each try: a fresh session (no clone) with the instructions as the system role
  // (initialPrompts), and only the conversation in the prompt body. Sampling knobs are
  // not set: on web pages Chrome ignores temperature/topK.
  for (const [level, compact] of PLAN) {
    const {system, transcript} = toPrompt(req.messages, req.tools, level);
    const input = `${transcript}\n\nReply now with one JSON object only.${reply?.type === "invalid" ? RETRY_NOTE : ""}`;
    const options = {responseConstraint: replySchema(req.tools, compact), signal};
    let session;
    try {
      session = await LM.create({...OPTS, initialPrompts: [{role: "system", content: system}], signal});
    } catch (e) {
      if (!tooLarge(e)) throw e;
      lastErr = e;
      continue;
    }
    try {
      quota = session.inputQuota || quota;
      if (session.inputQuota && session.measureInputUsage) {
        try {
          const need = await session.measureInputUsage(input, options);
          if (need > session.inputQuota - (session.inputUsage || 0) - 64) { lastErr = new Error(`needs ${need} of ${session.inputQuota} tokens`); continue; }
        } catch (e) {
          if (!tooLarge(e)) throw e;
          lastErr = e;
          continue;
        }
      }
      try {
        raw = await session.prompt(input, options);
      } catch (e) {
        if (!tooLarge(e)) throw e;
        lastErr = e;
        raw = null;
        continue;
      }
    } finally {
      session.destroy?.();
    }
    reply = readReply(raw, req.tools);
    if (reply.type !== "invalid") { lastErr = null; break; }
    invalidRaw = reply.raw || "";
    lastErr = new Error("model reply was not valid JSON");
    // An echo instead of an answer: check once whether Nano can answer anything at all.
    if (BANNER.test(invalidRaw.slice(0, 200))) {
      nanoBroken = invalidRaw;
      showBrokenOnPage();
      throw new Error(BROKEN_MSG(nanoBroken));
    }
    if (looksLikeEcho(invalidRaw) && ++echoes === 1) {
      const health = await nanoCanAnswer(LM, signal).catch((e) => ({ok: false, out: String(e?.message || e)}));
      if (!health.ok) {
        nanoBroken = health.out || invalidRaw;
        showBrokenOnPage();
        throw new Error(BROKEN_MSG(nanoBroken));
      }
    }
  }
  if (raw == null) {
    throw new Error(`this step does not fit Gemini Nano's context on this device (${quota || "unknown"} tokens; ${lastErr?.message || "too large"}). Use "Replay a recorded run" or add a free Gemini key in AI model settings`);
  }
  if (!reply || reply.type === "invalid") {
    throw new Error(`Gemini Nano did not answer with valid JSON after ${PLAN.length} tries, so this run stopped instead of finishing empty. Its last reply began: "${cut(invalidRaw.replace(/\s+/g, " "), 120)}". Try again, or add a free Gemini key in AI model settings.`);
  }
  const id = `nano-${Date.now().toString(36)}`;
  nanoStats.calls += 1;
  nanoStats.ms += performance.now() - started;
  nanoStats.quota = quota;
  if (reply.type === "tool_call") {
    nanoStats.toolCalls += 1;
    return stream([
      chunk(id, {role: "assistant", content: null, tool_calls: [{index: 0, id: `call_${id}`, type: "function", function: {name: reply.tool, arguments: JSON.stringify(reply.arguments)}}]}),
      chunk(id, {}, "tool_calls"),
    ]);
  }
  const words = reply.content.split(/(\s+)/);
  const parts = [];
  for (let i = 0; i < words.length; i += 10) parts.push(words.slice(i, i + 10).join(""));
  return stream([chunk(id, {role: "assistant"}), ...parts.map((p) => chunk(id, {content: p})), chunk(id, {}, "stop")]);
}

/** Answer fetches to NANO_ROUTER on the device; pass every other fetch through. */
export function installNanoRouter() {
  if (globalThis.__nanoRouter) return;
  globalThis.__nanoRouter = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    if (!url || !url.startsWith(new URL(NANO_ROUTER).origin)) return realFetch(input, init);
    // The runtime asks a router's origin whether it is a published mock; this one is not.
    if (!url.startsWith(NANO_ROUTER)) return new Response("", {status: 404});
    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({object: "list", data: [{id: NANO_MODEL, object: "model", owned_by: "chrome-built-in-ai"}]}), {headers: {"Content-Type": "application/json"}});
    }
    const body = init.body ?? (input instanceof Request ? await input.clone().text() : "{}");
    try {
      return await completeOnDevice(typeof body === "string" ? JSON.parse(body) : body, init.signal);
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      return new Response(JSON.stringify({error: {message: `On-device model error: ${e?.message || e}`}}), {status: 400, headers: {"Content-Type": "application/json"}});
    }
  };
}
