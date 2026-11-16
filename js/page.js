// Renders the studio and wires the page's own buttons to App.page.
import { App, LANGUAGES, TONES, X_LIMIT, overlap } from "./studio.js";
import { AgentGraph } from "./agent-graph.js";
import { setFirstToolPolicy } from "../runtime/runner.js";
import { NANO_KEY, NANO_MODEL, NANO_ROUTER, nanoAvailability, prepareNano } from "./nano-router.js";

/** The live agent map, shared with site.js (which attaches it to the runtime's trace). */
export const graph = typeof document !== "undefined" && document.querySelector("#agent-graph")
  ? new AgentGraph(document.querySelector("#agent-graph"))
  : null;
if (typeof window !== "undefined") window.__agentGraph = graph;

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, text = "") {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
}

function empty(panel, message) {
  panel.replaceChildren(el("p", {class: "empty"}, message));
}

function flash(id) {
  const card = document.getElementById(id);
  if (!card) return;
  card.classList.remove("flash");
  void card.offsetWidth;
  card.classList.add("flash");
}

const Render = {
  settings(studio) {
    const s = studio.settings;
    $("#topic").value = s.topic;
    $("#audience").value = s.audience;
    $("#tone").value = s.tone;
    $("#language").value = s.language;
    $("#videoMinutes").value = s.videoMinutes;
    $("#threadPosts").value = s.threadPosts;
  },

  brief(studio) {
    const box = $("#brief-body");
    const b = studio.brief;
    if (!b) return empty(box, "The Strategist agent writes the angle, hook and key points here.");
    const dl = el("dl");
    const add = (k, v) => { if (v) { dl.append(el("dt", {}, k), el("dd", {}, v)); } };
    add("Audience", b.audience);
    add("Angle", b.angle);
    if (b.hook) {
      const dd = el("dd", {}, b.hook);
      dd.append(sourceBadge(studio.hookSource(b.hook)));
      dl.append(el("dt", {}, "Hook"), dd);
    }
    add("Call to action", b.callToAction);
    const ul = el("ul");
    b.keyPoints.forEach((p) => ul.append(el("li", {}, p)));
    box.replaceChildren(dl, el("h4", {}, "Key points"), ul);
    // Hook Lab's hooks come from the partner's reply itself, not from what the model chose
    // to copy, so this section shows on every run where Hook Lab answered.
    const labHooks = studio.collab?.status === "answered" ? studio.collab.hooks || [] : [];
    if (labHooks.length) {
      const hl = el("ol", {class: "hook-ideas from-lab"});
      labHooks.forEach((p) => { const li = el("li", {}, p); li.append(sourceBadge("Hook Lab")); hl.append(li); });
      box.append(el("h4", {}, `Runner-up hooks · from Hook Lab (${labHooks.length})`), hl);
    }
    const own = (b.hookIdeas || []).filter((p) => studio.hookSource(p) !== "Hook Lab");
    if (own.length) {
      const hi = el("ul", {class: "hook-ideas"});
      own.forEach((p) => { const li = el("li", {}, p); li.append(sourceBadge("Strategist")); hi.append(li); });
      box.append(el("h4", {}, "Runner-up hooks · from the Strategist"), hi);
    }
    if (b.factsToCheck.length) {
      const fc = el("ul", {class: "facts"});
      b.factsToCheck.forEach((p) => fc.append(el("li", {}, p)));
      box.append(el("h4", {}, "Check before publishing"), fc);
    }
    flash("brief-card");
  },

  script(studio) {
    const box = $("#script-body");
    const y = studio.script;
    if (!y) return empty(box, "The Scriptwriter agent writes a timed YouTube script here.");
    box.replaceChildren(el("h3", {}, y.title));
    if (y.titleOptions?.length > 1) {
      // Number and text share one text node, so a number can never show without its title.
      const ol = el("ul", {class: "title-options"});
      y.titleOptions.forEach((t, i) => ol.append(el("li", {}, `${i + 1}. ${t}${i === 0 ? "  (main)" : ""}`)));
      box.append(el("h4", {}, `Title options (${y.titleOptions.length})`), ol);
    }
    box.append(el("p", {class: "hook"}, y.hook));
    y.sections.forEach((s) => {
      const sec = el("section", {class: "beat"});
      sec.append(el("h4", {}, `${s.number}. ${s.heading}${s.seconds ? ` · ${s.seconds}s` : ""}`), el("p", {}, s.narration));
      if (s.bRoll) sec.append(el("p", {class: "broll"}, `B-roll: ${s.bRoll}`));
      box.append(sec);
    });
    if (y.outro) box.append(el("p", {class: "hook"}, y.outro));
    if (y.description) box.append(el("h4", {}, "Video description"), el("p", {class: "desc"}, y.description));
    flash("script-card");
  },

  thread(studio) {
    const box = $("#thread-body");
    const t = studio.thread;
    if (!t) return empty(box, "The Thread writer agent drafts an X thread here, every post checked against X's limit.");
    const ol = el("ol", {class: "posts"});
    t.posts.forEach((p) => {
      const li = el("li");
      const meta = el("div", {class: "post-meta"});
      meta.append(el("span", {}, `${p.number}/${t.posts.length}`), el("span", {class: p.weightedLength > X_LIMIT - 20 ? "warn" : ""}, `${p.weightedLength}/${X_LIMIT}`));
      const btn = el("button", {type: "button", class: "ghost small", "data-post": String(p.number)}, "Open in X");
      meta.append(btn);
      li.append(el("p", {}, p.text), meta);
      ol.append(li);
    });
    box.replaceChildren(ol);
    flash("thread-card");
  },

  storyboard(studio) {
    const box = $("#storyboard-body");
    const b = studio.storyboard;
    if (!b) return empty(box, "The Storyboard artist agent turns the script into numbered shots here.");
    const grid = el("div", {class: "shots"});
    b.shots.forEach((s) => {
      const card = el("article", {class: "shot"});
      card.append(el("div", {class: "shot-no"}, `Shot ${s.number}${s.seconds ? ` · ${s.seconds}s` : ""}`));
      if (s.title) card.append(el("h4", {class: "shot-title"}, s.title));
      if (s.section) card.append(el("div", {class: "shot-sec"}, s.section));
      card.append(el("p", {class: "visual"}, s.visual));
      if (s.camera) card.append(el("p", {class: "small"}, `Camera: ${s.camera}`));
      if (s.onScreenText) card.append(el("p", {class: "small"}, `On screen: “${s.onScreenText}”`));
      if (s.audio) card.append(el("p", {class: "small"}, `Audio: ${s.audio}`));
      grid.append(card);
    });
    box.replaceChildren(el("p", {class: "small"}, `${b.shots.length} shots · about ${b.totalSeconds}s`), grid);
    flash("storyboard-card");
  },
};

Render.collab = (studio) => {
  const box = $("#collab-card");
  const c = studio.collab;
  if (!box) return;
  if (!c) { box.hidden = true; return; }
  box.hidden = false;
  box.classList.toggle("off", c.status !== "answered" && c.status !== "waiting");
  const head = el("h3", {}, "🤝 Two agentic websites working together");
  const flow = el("div", {class: "flow"});
  const link = el("a", {class: "site partner", href: c.url, target: "_blank", rel: "noopener"}, "Hook Lab ↗");
  flow.append(el("span", {class: "site"}, "Creator Agent Studio · producer"), el("span", {class: "arrow"}, "→ asks →"), link, el("span", {class: "arrow"}, "→ ranked hooks → strategist"));
  const said = {
    waiting: "Asking Hook Lab's writer and critic agents for ranked hooks (waits at most 20 seconds)…",
    answered: `Hook Lab answered${c.seconds ? ` in ${c.seconds}s` : ""}. Its hooks are tagged "Hook Lab" in the brief.`,
    off: "Hook Lab was not asked this run (box unticked or on-device mode).",
    no_hooks: "Hook Lab replied, but without usable hooks, so the strategist wrote them. Nothing was skipped.",
  }[c.status] || "Hook Lab did not answer within 20 seconds, so the strategist wrote the hooks. Nothing was skipped.";
  box.replaceChildren(head, flow, el("p", {class: "small"}, said));
  if (c.status === "answered" && c.hooks?.length) {
    const ol = el("ol");
    c.hooks.forEach((h) => {
      const li = el("li", {}, h);
      const b = studio.brief;
      const used = b && [b.hook, ...(b.hookIdeas || [])].some((x) => overlap(h, x) >= 0.6 || overlap(x, h) >= 0.6);
      if (used) li.append(el("span", {class: "used"}, "used in brief"));
      ol.append(li);
    });
    box.append(el("p", {class: "small"}, "Hooks returned by Hook Lab:"), ol);
  }
};

function sourceBadge(source) {
  return el("span", {class: `src ${source === "Hook Lab" ? "hooklab" : "strategist"}`, title: source === "Hook Lab" ? "Written by the partner site Hook Lab" : "Written by the Content Strategist"}, source === "Hook Lab" ? "from Hook Lab" : "Strategist");
}

const PANEL_OF = {brief: "brief", script: "youtubeScript", thread: "xThread", storyboard: "storyboard"};

/** Show "Retry this agent" only on panels that are still empty after a package stopped. */
function markFailed(keys) {
  Object.entries(PANEL_OF).forEach(([key, panel]) => {
    const btn = document.querySelector(`button[data-retry="${panel}"]`);
    const card = btn?.closest(".card");
    const failed = keys.includes(key) && !App.page[key];
    if (btn) btn.hidden = !failed;
    card?.classList.toggle("failed", failed);
  });
}

function render(panel, studio) {
  if (panel === "settings") return Render.settings(studio);
  Render[panel]?.(studio);
  if (PANEL_OF[panel] && studio[panel]) markFailed([]);
  if (panel === "brief") Render.collab(studio);
  if (panel === "collab" && studio.brief) Render.brief(studio);
}

function fillSelect(id, values) {
  const select = $(id);
  values.forEach((v) => select.append(el("option", {value: v}, v)));
}

function readForm() {
  return {
    topic: $("#topic").value,
    audience: $("#audience").value,
    tone: $("#tone").value,
    language: $("#language").value,
    videoMinutes: Number($("#videoMinutes").value),
    threadPosts: Number($("#threadPosts").value),
  };
}

/** Send a request into the assistant's chat, as if the visitor typed it. */
function askAgents(text) {
  const input = document.querySelector("#ns-input");
  const send = document.querySelector("#ns-send");
  if (!input || !send) {
    $("#form-status").textContent = "The agents are not loaded yet. Add your AI key in AI model settings below.";
    return;
  }
  input.value = text;
  input.dispatchEvent(new Event("input", {bubbles: true}));
  send.click();
  document.querySelector("#assistant").scrollIntoView({behavior: "smooth", block: "start"});
}

// One click on "Generate" must end with all four drafts. When a run ends with a draft
// missing (a specialist ran out of time or the model stopped early), the page asks the
// producer once or twice more for exactly what is missing, with no visitor action.
const FULL_PACKAGE = "Create the full content package (brief, YouTube script, X thread and storyboard) for the topic in the studio settings.";
const OWNERS = [
  ["brief", "the brief (content_strategist)"],
  ["script", "the YouTube script (youtube_scriptwriter)"],
  ["thread", "the X thread (x_thread_writer)"],
  ["storyboard", "the storyboard (storyboard_artist)"],
];
let packageRun = null;

const HOOK_LAB_HOST = "creator-hook-lab.pages.dev";
let engineRef = null;
/** site.js hands over the runtime engine once it boots. */
export function setEngine(engine) { engineRef = engine; }

function wantsHookLab() {
  if (!$("#use-hooklab")?.checked) return false;
  // On-device Nano is too small and slow to also run the partner's agents.
  return !(engineRef && engineRef.byokKey === NANO_KEY);
}

// The one-click package always asks Hook Lab first: the producer's first model step is
// forced to call the hook_lab tool, so the partner call never depends on the model's mood.
setFirstToolPolicy(({userText}) => (packageRun?.hookLab && String(userText || "").includes(FULL_PACKAGE) ? "hook_lab" : null));

/** The ticked Hook Lab box plus the Generate click is the visitor's OK for this one run. */
export function preapprovedPartner(info) {
  return Boolean(packageRun?.hookLab && String(info?.peerOrigin || "").includes(HOOK_LAB_HOST));
}

function startPackage() {
  const hookLab = wantsHookLab();
  const st = App.page.settings || {};
  // The producer's first (forced) step is the Hook Lab call, before it reads any state,
  // so the request itself carries the topic.
  const facts = `Topic: ${st.topic}. Audience: ${st.audience || "general"}. Language: ${st.language || "English"}.`;
  const request = hookLab ? `${FULL_PACKAGE} ${facts}` : `${FULL_PACKAGE} ${facts} Do not call hook_lab this time.`;
  packageRun = {attempts: 0, hookLab, request, partner: hookLab ? "pending" : "off"};
  markFailed([]);
  App.page.setRunMeta(null);
  App.page.setRunMeta({generatedAt: new Date().toISOString()});
  App.page.setCollab({site: "Hook Lab", url: `https://${HOOK_LAB_HOST}/`, status: hookLab ? "waiting" : "off", hooks: []});
  askAgents(request);
}

/** Pull up to 3 hook lines out of Hook Lab's answer (numbered or bulleted lines). */
export function hookLinesFrom(raw, max = 3) {
  const out = [];
  const lines = partnerText(raw).split(/\n/);
  const isJunk = (x) => /[{}]|"cruse"|"presentation"|website_\w+|^\s*\[|^\s*\|/.test(x);
  const tidy = (x) => x.replace(/\*\*|__|`/g, "").trim()
    .replace(/^(?:[-*•>]|\d+[.)])\s*/, "")
    .replace(/^(?:the\s+)?.{0,60}?\bhook\b[^:：]{0,25}[:：]\s*/i, "")
    .replace(/^(?:question|bold claim|claim|story|number|contrast|myth[- ]?bust(?:er)?)\s*[:：]\s*/i, "")
    .replace(/^(?:hook|title)\s*\d*\s*[:：]\s*/i, "")
    .replace(/\s*[(\[]?\s*(?:score|total|rank)\b[^)\]]*[)\]]?\s*$/i, "")
    .replace(/\s*[—–-]\s*\d{1,2}\s*\/\s*30\s*$/, "")
    .replace(/^["“'‘]+|["”'’]+$/g, "").trim();
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const m = lines[i].match(/^\s*(?:#+\s*)?(?:\d+[.)]|[-*•])\s+(.*)$/);
    if (!m || isJunk(lines[i])) continue;
    let body = m[1].replace(/\*\*/g, "").trim();
    // A label line ("The Speed Hook (Rank 1)") carries its hook on the next non-empty,
    // non-numbered line; with nothing usable there, the label is skipped (never shown empty).
    if (/hook\b[^:"“]*$/i.test(body) && body.length < 80) {
      const next = lines.slice(i + 1).find((x) => x.trim());
      if (!next || /^\s*(?:#+\s*)?(?:\d+[.)])\s/.test(next) || isJunk(next)) continue;
      body = next;
    }
    const line = tidy(body);
    if (line.length >= 20 && /[A-Za-z\u3400-\u9fff]{3}/.test(line) && !/^(?:rank|score|title)/i.test(line) && !out.includes(line)) out.push(line);
  }
  return out;
}

/** The plain text of a partner reply, whether it came as JSON ({"cruse":1,"text":…}), as a
 * truncated JSON preview, or as text. */
export function partnerText(raw) {
  let t = String(raw || "");
  try { const o = JSON.parse(t); if (o && typeof o.text === "string") return o.text; } catch {}
  const m = /"text"\s*:\s*"((?:\\.|[^"\\])*)/.exec(t);
  if (m) {
    t = m[1];
    try { return JSON.parse(`"${t.replace(/\\$/, "")}"`); } catch {}
  }
  return t.replace(/\\n/g, "\n").replace(/\\"/g, '"');
}

/** If the producer forgot to hand Hook Lab's hooks to the strategist, attach them to the brief. */
function attachHookLabIdeas() {
  const brief = App.page.brief;
  if (!brief || (brief.hookIdeas && brief.hookIdeas.length) || !packageRun?.hookLabText) return;
  const ideas = hookLinesFrom(packageRun.hookLabText);
  if (ideas.length) App.page.saveBrief({...brief, hookIdeas: ideas});
}

function partnerLine() {
  const p = packageRun?.partner;
  if (p === "answered") return " Hook Lab answered.";
  if (p === "no_hooks") return " Hook Lab replied without usable hooks, so the agents wrote their own.";
  if (p === "timeout" || p === "failed" || p === "unreachable") return " Hook Lab did not answer in time, so the agents wrote their own hooks.";
  return "";
}

function missingDrafts() {
  return OWNERS.filter(([key]) => !App.page[key]).map(([, label]) => label);
}

async function continuePackage() {
  if (!packageRun) return;
  const status = $("#form-status");
  attachHookLabIdeas();
  const missing = missingDrafts();
  if (!missing.length) {
    markFailed([]);
    status.classList.remove("error");
    status.textContent = `All four drafts are ready.${partnerLine()}`;
    window.__lastPackage = {...packageRun, done: true};
    packageRun = null;
    return;
  }
  const limited = isRateLimit(packageRun.lastError);
  if (limited) packageRun.rateRetries = (packageRun.rateRetries || 0) + 1;
  // Ordinary failures get 2 follow-up runs; rate limits get 3 more, each after a longer
  // wait (60s, 120s, 180s) on top of the per-call backoff inside the model client.
  const outOfTries = limited ? packageRun.rateRetries > RATE_WAITS_S.length : packageRun.attempts >= 2;
  if (outOfTries) {
    const keys = OWNERS.filter(([key]) => !App.page[key]).map(([key]) => key);
    markFailed(keys);
    status.classList.add("error");
    const badge = document.querySelector(".ns-llmbadge");
    if (badge && limited) { badge.className = "ns-llmbadge error"; badge.textContent = "LLM ERROR — quota used up"; }
    status.textContent = limited
      ? `The model's free quota is used up for now (we waited and retried automatically for several minutes). Finished panels are kept. Missing: ${missing.join(", ")}. Press "Retry this agent" later, or pick another model in settings.`
      : `Finished panels are kept. Still missing: ${missing.join(", ")}. Press "Retry this agent" on that panel to rerun only that agent.`;
    window.__lastPackage = {...packageRun, done: false};
    packageRun = null;
    return;
  }
  if (!limited) packageRun.attempts += 1;
  status.classList.remove("error");
  status.textContent = `Finishing ${missing.join(", ")}…`;
  const send = document.querySelector("#ns-send");
  for (let i = 0; i < 40 && send?.disabled; i++) await new Promise((r) => setTimeout(r, 250));
  if (limited) {
    const run = packageRun;
    for (let left = RATE_WAITS_S[run.rateRetries - 1]; left > 0; left--) {
      if (packageRun !== run) return;
      status.textContent = `The model's rate limit was hit. Waiting ${left}s, then finishing ${missing.join(", ")} automatically (try ${run.rateRetries} of ${RATE_WAITS_S.length}). Finished panels are kept.`;
      await new Promise((r) => setTimeout(r, 1000 * (window.__nsRetryScale ?? 1)));
    }
    if (packageRun !== run) return;
  } else if (packageRun.lastError) await new Promise((r) => setTimeout(r, 5000));
  askAgents(`Finish the content package. Missing: ${missing.join("; ")}. Call only the specialists that own the missing drafts, in order (the storyboard needs the saved script). Do not call hook_lab and do not redo drafts that are already saved.`);
}

const RATE_WAITS_S = [60, 120, 180];
function isRateLimit(err) {
  return /\b429\b|rate.?limit|quota|RESOURCE_EXHAUSTED|\b503\b|overloaded/i.test(String(err || ""));
}

/** Rerun only the agent that owns one empty panel; finished panels stay. */
function retryAgent(panel) {
  const key = Object.keys(PANEL_OF).find((k) => PANEL_OF[k] === panel);
  const label = OWNERS.find(([k]) => k === key)?.[1];
  if (!label) return;
  packageRun = {attempts: 1, hookLab: false, request: "", partner: App.page.collab?.status || "off"};
  markFailed([]);
  $("#form-status").classList.remove("error");
  $("#form-status").textContent = `Retrying only ${label}. Your other panels stay as they are.`;
  askAgents(`Finish the content package. Missing: ${label}. Call only that specialist. Do not call hook_lab and do not redo drafts that are already saved.`);
}

/** Follow the runtime's trace for rate-limit waits and for the end of each run. */
export function followRuns(trace) {
  trace.addEventListener("event", (e) => {
    const ev = e.detail;
    if (ev.kind === "llm_retry" && ev.phase === "note") {
      const status = $("#form-status");
      status.classList.remove("error");
      status.textContent = ev.status === "network" ? `Connection dropped; retrying automatically in ${ev.waitSeconds}s. Finished panels are kept.` : `The model asked us to slow down; continuing automatically in ${ev.waitSeconds}s.`;
    }
    if (ev.kind === "partner_call" && packageRun) {
      $("#form-status").textContent = "Asking Hook Lab for hooks (up to 20 seconds)…";
    }
    if (ev.kind === "partner_result" && packageRun) {
      // An answer with no hook lines in it (for example a stray tool name) did not help.
      const lines = ev.status === "answered" ? hookLinesFrom(ev.preview, 5) : [];
      packageRun.partner = ev.status === "answered" && lines.length < 3 ? "no_hooks" : ev.status;
      packageRun.partnerSeconds = ev.seconds;
      if (ev.error) packageRun.partnerError = ev.error;
      if (ev.preview) packageRun.hookLabText = ev.preview;
      App.page.setCollab({site: "Hook Lab", url: `https://${HOOK_LAB_HOST}/`, status: packageRun.partner, seconds: ev.seconds, hooks: packageRun.partner === "answered" ? lines : []});
      $("#form-status").textContent = packageRun.partner === "answered"
        ? `Hook Lab answered in ${ev.seconds}s. The four agents are writing now.`
        : "Hook Lab did not answer in time. The agents continue with their own hooks.";
    }
    if (ev.kind === "model_call" && ev.phase === "start" && ev.model && packageRun) {
      App.page.setRunMeta({model: ev.model});
    }
    if (ev.kind === "model_call" && ev.phase === "end" && ev.status === "error" && packageRun && isRateLimit(ev.error)) {
      packageRun.sawRateLimit = true;
    }
    if (ev.kind === "run" && ev.phase === "end" && packageRun) {
      // A failed run (rate limit, network) keeps every saved panel; only what is missing
      // is asked for again. A rate limit inside a specialist counts too, even when the
      // producer itself finished.
      packageRun.lastError = ev.status === "error" ? (ev.error || "error") : packageRun.sawRateLimit ? "429 rate limit" : null;
      packageRun.sawRateLimit = false;
      setTimeout(continuePackage, 800);
    }
  });
}

function download(name, text, type = "text/markdown") {
  const blob = new Blob([text], {type: `${type};charset=utf-8`});
  const a = el("a", {href: URL.createObjectURL(blob), download: name});
  document.body.append(a);
  a.click();
  a.remove();
}

/** Replays a recorded real run (demo/sample-run.json) through the same save rules, with no AI key. */
async function replayDemo(studio) {
  const status = $("#replay-log");
  const btn = $("#replay");
  btn.disabled = true;
  status.replaceChildren();
  const line = (who, what) => status.append(el("li", {}, `${who}: ${what}`));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const run = await (await fetch("demo/sample-run.json")).json();
    const s = run.state;
    studio.setSettings(s.settings);
    ["topic", "audience", "tone", "language", "videoMinutes", "threadPosts"].forEach((k) => { const f = $(`#${k}`); if (f) f.value = s.settings[k]; });
    ["brief", "youtubeScript", "xThread", "storyboard"].forEach((k) => studio.clearDraft(k));
    const g = graph;
    g?.reset();
    document.querySelector("#agent-graph")?.scrollIntoView({behavior: "smooth", block: "center"});
    const step = async (name, from, calls) => {
      g?.activate(name, from);
      // The recording keeps totals only, so the replay shows who worked, not per-agent call counts.
      await wait(220 * Math.max(calls, 1));
    };
    line("Studio Producer", "asks the partner site Hook Lab for ranked hooks (you approve a card first)");
    await step("studio_producer", null, 1);
    await step("hook_editor", "studio_producer", 1);
    line("Hook Lab (creator-hook-lab.pages.dev)", `its editor drafts and scores hooks and returns the winner`);
    await step("hook_editor", null, 1);
    g?.finish("hook_editor", "studio_producer");
    studio.setCollab({site: "Hook Lab", url: `https://${HOOK_LAB_HOST}/`, status: "answered", seconds: null, hooks: (s.drafts.brief.hookIdeas || []).concat(s.drafts.brief.hook ? [s.drafts.brief.hook] : [])});
    studio.setRunMeta(null);
    studio.setRunMeta({model: `${run.model} (recorded run)`, generatedAt: run.recorded && !isNaN(Date.parse(run.recorded)) ? new Date(run.recorded).toISOString() : undefined});
    line("Content Strategist", "writes the brief from the winning hook");
    await step("content_strategist", "studio_producer", 2);
    studio.saveBrief(s.drafts.brief);
    g?.finish("content_strategist", "studio_producer");
    line("YouTube Scriptwriter + X Thread Writer", "work in parallel");
    g?.activate("youtube_scriptwriter", "studio_producer");
    await step("x_thread_writer", "studio_producer", 0);
    await wait(780);
    studio.saveYoutubeScript(s.drafts.youtubeScript, {recorded: true});
    studio.saveXThread({posts: s.drafts.xThread.posts.map((p) => p.text)}, {recorded: true});
    g?.finish("youtube_scriptwriter", "studio_producer");
    g?.finish("x_thread_writer", "studio_producer");
    line("Storyboard Artist", "times shots against the saved script");
    await step("storyboard_artist", "studio_producer", 3);
    studio.saveStoryboard(s.drafts.storyboard, {recorded: true});
    g?.finish("storyboard_artist", "studio_producer");
    g?.finish("studio_producer");
    g?.complete(`Replay done. The real run took ${run.seconds}s and ${run.modelCalls} model calls across two sites.`);
    line("Done", `recorded ${run.recorded} with ${run.model}: ${run.modelCalls} model calls in ${run.seconds}s, every draft checked by the page's rules`);
    document.querySelector("#results")?.scrollIntoView({behavior: "smooth", block: "start"});
  } catch (e) {
    line("Replay", "could not load the recording.");
  } finally {
    btn.disabled = false;
  }
}

const NANO_HELP = "Free on-device mode needs desktop Chrome with built-in AI (Gemini Nano), English output and a capable computer. Otherwise use the replay, or add any AI key in AI model settings.";

export async function showNanoState() {
  const note = $("#nano-note");
  if (window.__nsweb?.engine?.byokKey === NANO_KEY) {
    note.hidden = false;
    note.textContent = "Running on Gemini Nano in this browser: no key, nothing leaves your device. Small on-device model, so expect a few minutes and simpler drafts. Output language is English.";
    $("#run-nano").textContent = "Running free on this device";
    $("#run-nano").disabled = true;
    return;
  }
  const state = await nanoAvailability();
  if (state === "unsupported" || state === "unavailable") $("#run-nano").title = NANO_HELP;
}

/** Switch this tab to Gemini Nano on the device, downloading the model first if needed. */
async function useNano() {
  const note = $("#nano-note");
  note.hidden = false;
  const state = await nanoAvailability();
  if (state === "unsupported" || state === "unavailable") {
    note.textContent = NANO_HELP;
    return;
  }
  try {
    if (state !== "available") {
      note.textContent = "Chrome is downloading Gemini Nano (one time)…";
      // Tell the visitor when the download stops moving, so nobody waits blind.
      let last = -1, lastAt = Date.now(), base = note.textContent;
      const stall = setInterval(() => {
        const idle = Math.round((Date.now() - lastAt) / 1000);
        if (idle < 30) return;
        note.classList.add("warn");
        note.textContent = `${base} No progress for ${idle}s. Chrome may still be unpacking the model, which can take several minutes. You don't have to wait: watch the recorded run at the top, or add a free Google AI Studio key in AI model settings.`;
      }, 5000);
      try {
        await prepareNano((p) => {
          if (p !== last) { last = p; lastAt = Date.now(); note.classList.remove("warn"); }
          base = p >= 0.9
            ? `Chrome is downloading Gemini Nano (one time)… ${Math.round(p * 100)}%. The last step unpacks the model and can sit here for a few minutes; keep this tab open.`
            : `Chrome is downloading Gemini Nano (one time)… ${Math.round(p * 100)}%`;
          note.textContent = base;
        });
      } finally {
        clearInterval(stall);
        note.classList.remove("warn");
      }
    }
    // Same tab setup the runtime's AI model settings write: a key, a router and a model.
    const {saveTabByokSetup} = await import("../runtime/byok.js");
    saveTabByokSetup({key: NANO_KEY, router: NANO_ROUTER, model: NANO_MODEL});
    sessionStorage.setItem("studio:pending-form", JSON.stringify({...readForm(), language: "English"}));
    note.textContent = "Switching to on-device mode…";
    location.reload();
  } catch (e) {
    note.textContent = `Could not start Gemini Nano: ${e?.message || e}. ${NANO_HELP}`;
  }
}

function init() {
  fillSelect("#tone", TONES);
  fillSelect("#language", LANGUAGES);
  const studio = App.page;
  studio.renderer = render;
  ["settings", "brief", "script", "thread", "storyboard"].forEach((p) => render(p, studio));
  try {
    const pending = JSON.parse(sessionStorage.getItem("studio:pending-form") || "null");
    sessionStorage.removeItem("studio:pending-form");
    if (pending) {
      studio.setSettings(pending);
      render("settings", studio);
    }
  } catch {}

  $("#studio-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const result = studio.setSettings(readForm());
    const status = $("#form-status");
    status.classList.toggle("error", !result.ok);
    if (!result.ok) {
      status.textContent = `Not sent: ${result.reason}`;
      $(`#${result.field}`)?.focus();
      return;
    }
    status.textContent = studio.settings.minutesFromTopic
      ? `Sent to the producer agent. Target length taken from your topic: ${studio.settings.videoMinutes} minutes (${studio.settings.videoMinutes * 60}s).`
      : "Sent to the producer agent. Watch the agents work in the chat.";
    startPackage();
  });

  $("#replay").addEventListener("click", () => replayDemo(studio));
  $("#run-nano").addEventListener("click", () => useNano());
  showNanoState();

  $("#copy-md").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(studio.toMarkdown());
      $("#export-status").textContent = "Copied the whole package (Markdown with topic, time and model).";
    } catch {
      $("#export-status").textContent = "Copy failed. Use Download instead.";
    }
  });
  const slug = () => (studio.settings.topic || "content").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "content";
  $("#download-md").addEventListener("click", () => download(`${slug()}-package.md`, studio.toMarkdown()));

  const exp = (id, make, ext, type, what) => $(id).addEventListener("click", () => {
    const text = make();
    if (!text) { $("#export-status").textContent = `No ${what} yet.`; return; }
    download(`${slug()}${ext}`, text, type);
    $("#export-status").textContent = `Downloaded ${what}.`;
  });
  exp("#download-srt", () => studio.toSrt(), "-subtitles.srt", "application/x-subrip", "subtitles");
  exp("#download-thread", () => studio.toThreadText(), "-x-thread.txt", "text/plain", "thread");
  exp("#download-csv", () => studio.toStoryboardCsv(), "-shot-list.csv", "text/csv", "shot list");

  $("#thread-body").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-post]");
    if (!btn) return;
    studio.openXCompose(Number(btn.dataset.post));
  });

  document.querySelectorAll("button[data-clear]").forEach((btn) => {
    btn.addEventListener("click", () => studio.clearDraft(btn.dataset.clear));
  });

  const fillExample = (btn) => {
    $("#topic").value = btn.dataset.example;
    if (btn.dataset.audience) $("#audience").value = btn.dataset.audience;
    if (btn.dataset.tone) $("#tone").value = btn.dataset.tone;
    $("#videoMinutes").value = $("#videoMinutes").value || 5;
  };
  document.querySelectorAll("[data-example]").forEach((btn) => {
    btn.addEventListener("click", () => { fillExample(btn); $("#topic").focus(); });
  });
  $("#run-example")?.addEventListener("click", () => {
    const chips = [...document.querySelectorAll("[data-example]")];
    fillExample(chips[Math.floor(Math.random() * chips.length)]);
    if (!document.querySelector("#ns-input")) {
      $("#form-status").textContent = "Example filled. Add your AI key in AI model settings below (or watch the recorded run at the top), then press Generate.";
      return;
    }
    $("#studio-form").requestSubmit();
  });
  document.querySelectorAll("button[data-retry]").forEach((btn) => {
    btn.addEventListener("click", () => retryAgent(btn.dataset.retry));
  });
}

if (typeof document !== "undefined") {
  init();
}
