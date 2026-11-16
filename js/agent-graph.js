// agent-graph.js — a live map of the agent network as it works.
//
// It listens to the runtime's trace bus (the same events the execution log shows) and
// lights up each agent while it runs, counts its model calls, draws the hand-off along the
// edge, and shows the hop to the partner site Hook Lab, whose network is fetched and run
// in this tab. The recorded replay drives the same map, so a visitor with no key sees it too.

const NS = "http://www.w3.org/2000/svg";

export const NODES = {
  studio_producer: {x: 340, y: 78, label: "Producer", role: "plans the job", site: "studio"},
  content_strategist: {x: 88, y: 204, label: "Strategist", role: "brief", site: "studio"},
  youtube_scriptwriter: {x: 248, y: 204, label: "Scriptwriter", role: "video script", site: "studio"},
  x_thread_writer: {x: 408, y: 204, label: "Thread writer", role: "X thread", site: "studio"},
  storyboard_artist: {x: 568, y: 204, label: "Storyboard", role: "shot list", site: "studio"},
  hook_editor: {x: 860, y: 78, label: "Hook editor", role: "Hook Lab", site: "hooklab"},
  hook_writer: {x: 780, y: 204, label: "Hook writer", role: "6 hooks", site: "hooklab"},
  hook_critic: {x: 935, y: 204, label: "Hook critic", role: "scores", site: "hooklab"},
};

export const EDGES = [
  ["studio_producer", "content_strategist"],
  ["studio_producer", "youtube_scriptwriter"],
  ["studio_producer", "x_thread_writer"],
  ["studio_producer", "storyboard_artist"],
  ["studio_producer", "hook_editor", "cross"],
  ["hook_editor", "hook_writer"],
  ["hook_editor", "hook_critic"],
];

function svg(tag, attrs = {}, text = "") {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text) n.textContent = text;
  return n;
}

export class AgentGraph {
  constructor(root) {
    this.root = root;
    this.nodes = {};
    this.edges = {};
    this.calls = {};
    this.spans = new Map();
    this.started = null;
    this.draw();
  }

  draw() {
    const s = svg("svg", {viewBox: "0 0 1020 262", role: "img", "aria-label": "Live map of the agents: the producer, four specialists and the partner site Hook Lab"});
    s.append(svg("rect", {x: 8, y: 8, width: 652, height: 246, rx: 16, class: "g-site"}));
    s.append(svg("text", {x: 22, y: 30, class: "g-sitelabel"}, "creator-agent-studio.pages.dev"));
    s.append(svg("rect", {x: 692, y: 8, width: 320, height: 246, rx: 16, class: "g-site partner"}));
    s.append(svg("text", {x: 852, y: 247, class: "g-footnote", "text-anchor": "middle"}, "Called from Studio, the editor answers alone for speed"));
    s.append(svg("text", {x: 706, y: 30, class: "g-sitelabel"}, "creator-hook-lab.pages.dev ↗"));
    for (const [a, b, kind] of EDGES) {
      const A = NODES[a];
      const B = NODES[b];
      const path = kind === "cross"
        ? `M${A.x + 70},${A.y} C${A.x + 220},${A.y + 40} ${B.x - 220},${B.y + 40} ${B.x - 70},${B.y}`
        : `M${A.x},${A.y + 24} C${A.x},${A.y + 80} ${B.x},${B.y - 80} ${B.x},${B.y - 24}`;
      const e = svg("path", {d: path, class: `g-edge ${kind || ""}`});
      this.edges[`${a}>${b}`] = e;
      s.append(e);
    }
    const cross = svg("text", {x: 600, y: 128, class: "g-crosslabel", "text-anchor": "middle"}, "");
    this.crossLabel = cross;
    s.append(cross);
    for (const [name, n] of Object.entries(NODES)) {
      const g = svg("g", {class: `g-node ${n.site}`, transform: `translate(${n.x - 70},${n.y - 24})`, tabindex: "0"});
      g.append(svg("rect", {width: 140, height: 48, rx: 12}));
      g.append(svg("text", {x: 12, y: 21, class: "g-label"}, n.label));
      g.append(svg("text", {x: 12, y: 38, class: "g-role"}, n.role));
      const badge = svg("text", {x: 128, y: 38, class: "g-badge", "text-anchor": "end"}, "");
      g.append(badge);
      g.append(svg("title", {}, `${n.label} (${name})`));
      this.nodes[name] = {g, badge};
      s.append(g);
    }
    const status = document.createElement("p");
    status.className = "g-status";
    status.setAttribute("aria-live", "polite");
    status.textContent = "Idle. Start a run or a replay to watch the agents hand work to each other.";
    this.status = status;
    this.root.replaceChildren(s, status);
  }

  reset() {
    for (const n of Object.values(this.nodes)) {
      n.g.classList.remove("active", "done");
      n.badge.textContent = "";
    }
    for (const e of Object.values(this.edges)) e.classList.remove("live", "used");
    this.crossLabel.textContent = "";
    this.calls = {};
    this.started = performance.now();
  }

  say(text) {
    this.status.textContent = text;
  }

  activate(name, from) {
    const n = this.nodes[name];
    if (!n) return;
    if (!this.started) this.reset();
    n.g.classList.remove("done");
    n.g.classList.add("active");
    const edge = from && this.edges[`${from}>${name}`];
    if (edge) edge.classList.add("live", "used");
    if (from === "studio_producer" && name === "hook_editor") this.crossLabel.textContent = "fetch-and-run-locally · you approved";
    this.say(`${NODES[name].label} is working${from ? `, asked by ${NODES[from]?.label || from}` : ""}.`);
  }

  finish(name, from) {
    const n = this.nodes[name];
    if (!n) return;
    n.g.classList.remove("active");
    n.g.classList.add("done");
    const edge = from && this.edges[`${from}>${name}`];
    if (edge) edge.classList.remove("live");
  }

  modelCall(name) {
    const n = this.nodes[name];
    if (!n) return;
    this.calls[name] = (this.calls[name] || 0) + 1;
    n.badge.textContent = `${this.calls[name]} call${this.calls[name] > 1 ? "s" : ""}`;
  }

  complete(summary) {
    const total = Object.values(this.calls).reduce((a, b) => a + b, 0);
    const secs = this.started ? Math.round((performance.now() - this.started) / 1000) : 0;
    const sites = Object.keys(this.calls).some((n) => NODES[n]?.site === "hooklab") ? "across two sites" : "on this site";
    this.say(summary || `Done: ${total} model calls in ${secs}s ${sites}.`);
    this.started = null;
  }

  /** Follow the runtime's trace bus. */
  attach(trace) {
    trace.addEventListener("event", (ev) => this.onEvent(ev.detail));
  }

  agentOf(spanId) {
    let id = spanId;
    for (let i = 0; id && i < 20; i += 1) {
      const s = this.spans.get(id);
      if (!s) return null;
      if (s.agent) return s.agent;
      id = s.parent;
    }
    return null;
  }

  onEvent(ev) {
    if (ev.phase === "start") this.spans.set(ev.id, {parent: ev.parent, agent: ev.kind === "agent" ? ev.agent : null});
    if (ev.kind === "agent" && ev.agent in NODES) {
      const caller = this.agentOf(ev.parent);
      if (ev.phase === "start") {
        if (ev.isTopFrontMan && !this.started) this.reset();
        this.activate(ev.agent, caller && caller !== ev.agent ? caller : null);
      } else if (ev.phase === "end") {
        this.finish(ev.agent, caller);
        if (ev.isTopFrontMan) this.complete();
      }
    } else if (ev.kind === "model_call" && ev.phase === "start") {
      this.modelCall(this.agentOf(ev.parent));
    } else if (ev.kind === "remote_call" && ev.phase === "start") {
      this.crossLabel.textContent = "fetch-and-run-locally · you approved";
    }
  }
}
