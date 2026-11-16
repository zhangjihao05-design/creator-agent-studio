// Creator Agent Studio: page state and operations.
// The page's own buttons and the agents (through site-actions.js) call the same methods
// on App.page, so both follow one set of rules. Operations refuse bad input by returning
// {ok: false, reason, field} and change nothing; they throw only on unexpected failures.

export const LANGUAGES = ["English", "Simplified Chinese"];
export const TONES = ["Friendly", "Expert", "Energetic", "Calm", "Funny"];
export const X_LIMIT = 280;

// A draft's timing must land within 10% of the requested video length (0 means "not timed").
export const TIMING_TOLERANCE = 0.1;
function checkLength(totalSeconds, minutes, tolerance = TIMING_TOLERANCE) {
  if (!totalSeconds || !minutes) return "";
  const target = minutes * 60, lo = Math.round(target * (1 - tolerance)), hi = Math.round(target * (1 + tolerance));
  return totalSeconds < lo || totalSeconds > hi ? `The video should run ${lo} to ${hi} seconds (target ${target}s). Adjust the seconds and trim or add content, then save again.` : "";
}

// A length written in the topic ("3分钟纪录片", "a 3-minute video", "90 seconds") is this
// run's target and wins over the Video minutes setting. Half-minute steps, 1 to 20 minutes.
const CN_DIGITS = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9};
const EN_NUMBERS = {one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, a: 1, an: 1};
function cnNumber(t) {
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "十") return 10;
  const m = t.match(/^([一二两兩三四五六七八九]?)十([一二三四五六七八九]?)$/);
  if (m) return (m[1] ? CN_DIGITS[m[1]] : 1) * 10 + (m[2] ? CN_DIGITS[m[2]] : 0);
  if (t.length === 1 && t in CN_DIGITS) return CN_DIGITS[t];
  return NaN;
}
export function durationFromText(text) {
  const t = String(text || "");
  const NUM_CN = "(\\d+(?:\\.\\d+)?|[零〇一二两兩三四五六七八九十]{1,3})";
  let secs = NaN, m;
  if ((m = t.match(new RegExp(NUM_CN + "\\s*个?\\s*(?:分钟|分鐘|分)(半|\\s*" + NUM_CN + "\\s*秒)?(?!镜|鏡|钟镜)")))) {
    secs = cnNumber(m[1]) * 60;
    if (m[2] === "半") secs += 30;
    else if (m[3]) secs += cnNumber(m[3]);
  } else if ((m = t.match(new RegExp("(半)\\s*分钟")))) {
    secs = 30;
  } else if ((m = t.match(new RegExp(NUM_CN + "\\s*秒(?:钟|鐘)?")))) {
    secs = cnNumber(m[1]);
  } else if ((m = t.match(/\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|an?)(?:\s+and\s+a\s+(half))?[\s-]*(?:minutes?|mins?|min)\b(?:\s+and\s+(\d+)\s*(?:seconds?|secs?))?/i))) {
    const n = /^\d/.test(m[1]) ? Number(m[1]) : EN_NUMBERS[m[1].toLowerCase()];
    secs = n * 60 + (m[2] ? 30 : 0) + (m[3] ? Number(m[3]) : 0);
  } else if ((m = t.match(/\bhalf\s+(?:a\s+)?minute\b/i))) {
    secs = 30;
  } else if ((m = t.match(/\b(\d+|thirty|forty|fifty|sixty|ninety)[\s-]*(?:seconds?|secs?)\b/i))) {
    secs = /^\d/.test(m[1]) ? Number(m[1]) : EN_NUMBERS[m[1].toLowerCase()];
  }
  if (!Number.isFinite(secs) || secs <= 0) return null;
  const minutes = Math.round(secs / 30) / 2;
  return minutes >= 1 && minutes <= 20 ? minutes : null;
}

/** Spoken words (English) or characters (Chinese) per minute used for the word budget. */
export function speechRate(language) {
  return language === "Simplified Chinese" ? {perMinute: 250, unit: "Chinese characters"} : {perMinute: 150, unit: "words"};
}

/** How much a narration text takes to say: English words, or CJK characters. */
export function spokenUnits(text, language) {
  const t = String(text || "");
  if (language === "Simplified Chinese") return (t.match(/[\u3400-\u9fff]/g) || []).length + (t.match(/[A-Za-z0-9]+/g) || []).length;
  return (t.match(/[A-Za-z0-9\u00C0-\u024F'’-]+/g) || []).length;
}

/** The numbers every timed draft must hit, derived from the settings. */
export function draftTargets(settings) {
  const minutes = settings.videoMinutes || 0;
  const totalSeconds = minutes * 60;
  const rate = speechRate(settings.language);
  return {
    totalSeconds,
    allowedSeconds: `${Math.round(totalSeconds * (1 - TIMING_TOLERANCE))} to ${Math.round(totalSeconds * (1 + TIMING_TOLERANCE))}`,
    narrationBudget: Math.round(minutes * rate.perMinute),
    narrationUnit: rate.unit,
    minShots: Math.max(3, Math.ceil(totalSeconds / 30)),
    minShotSeconds: 15,
    maxShotSeconds: 35,
    storyboardRule: "Every shot lasts 15 to 35 whole seconds, and the shot seconds add up exactly to the saved script's total seconds.",
  };
}

/**
 * Count a post the way X does: most CJK and full-width characters weigh 2, the rest 1,
 * and every link weighs 23.
 *
 * :param text: The post text.
 * :return: The weighted length.
 */
export function xLength(text) {
  const withoutLinks = String(text).replace(/https?:\/\/\S+/g, "");
  const links = (String(text).match(/https?:\/\/\S+/g) || []).length;
  let weight = links * 23;
  for (const ch of withoutLinks) {
    const code = ch.codePointAt(0);
    const light = (code <= 0x10ff) || (code >= 0x2000 && code <= 0x200d)
      || (code >= 0x2010 && code <= 0x201f) || (code >= 0x2032 && code <= 0x2037);
    weight += light ? 1 : 2;
  }
  return weight;
}

/**
 * Format today's date for the model, which has no clock.
 *
 * :return: {iso, label}
 */
function today() {
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const label = now.toLocaleDateString("en-US", {weekday: "short", year: "numeric", month: "short", day: "numeric"});
  return {iso, label};
}

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

/** Lowercase words of 3+ letters (or CJK characters), for loose text matching. */
function words(text) {
  const t = String(text || "").toLowerCase();
  if (/[\u3400-\u9fff]/.test(t)) return [...t.replace(/[^\u3400-\u9fff]/g, "")];
  return t.replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3);
}

/** Share of a's words that also appear in b (0 to 1). */
export function overlap(a, b) {
  const wa = words(a), wb = new Set(words(b));
  if (!wa.length) return 0;
  return wa.filter((w) => wb.has(w)).length / wa.length;
}

/** A thread's closing post must ask the reader to do something. */
const CTA_WORDS = /\b(follow|subscribe|watch|reply|comment|share|repost|retweet|save|bookmark|join|try|download|read|click|check out|sign up|tell me|let me know|dm|link|grab|start)\b|关注|订阅|评论|转发|收藏|点击|观看|试试|链接|留言|私信|分享|告诉我|加入|下载/i;
export function hasCallToAction(text) {
  return CTA_WORDS.test(String(text || ""));
}

/** The studio: settings plus four drafts (brief, YouTube script, X thread, storyboard). */
export class Studio {
  constructor(renderer = null) {
    this.renderer = renderer;
    this.version = 0;
    this.settings = {
      topic: "",
      audience: "",
      tone: "Friendly",
      language: "English",
      videoMinutes: 5,
      threadPosts: 6,
    };
    this.brief = null;
    this.script = null;
    this.thread = null;
    this.storyboard = null;
    // The partner site's part in the latest run: {site, url, status, seconds, hooks[]}.
    this.collab = null;
    // When and on which model the latest package was made: {model, generatedAt}.
    this.runMeta = null;
  }

  setCollab(collab) {
    this.collab = collab ? {...collab, hooks: (collab.hooks || []).slice(0, 5)} : null;
    this.changed("collab");
  }

  setRunMeta(meta) {
    this.runMeta = meta ? {...this.runMeta, ...meta} : null;
  }

  /** "Hook Lab" when a line is (mostly) one of the hooks Hook Lab returned this run. */
  hookSource(text) {
    const hooks = this.collab?.status === "answered" ? this.collab.hooks || [] : [];
    return hooks.some((h) => overlap(text, h) >= 0.6 || overlap(h, text) >= 0.6) ? "Hook Lab" : "Strategist";
  }

  changed(panel) {
    this.version += 1;
    if (this.renderer) {
      this.renderer(panel, this);
    }
  }

  /** Plain JSON copy of everything the page shows. */
  getState() {
    const date = today();
    return JSON.parse(JSON.stringify({
      today: date.iso,
      todayLabel: date.label,
      version: this.version,
      settings: this.settings,
      targets: draftTargets(this.settings),
      limits: {
        languages: LANGUAGES,
        tones: TONES,
        videoMinutes: "1 to 20",
        threadPosts: "3 to 12",
        xWeightedCharacterLimit: X_LIMIT,
        xWeightNote: "On X, CJK characters count as 2 and links as 23.",
      },
      links: {
        hookLab: "https://creator-hook-lab.pages.dev/",
      },
      partner: this.collab,
      drafts: {
        brief: this.brief,
        youtubeScript: this.script,
        xThread: this.thread,
        storyboard: this.storyboard,
      },
    }));
  }

  /** Check settings without changing anything. */
  checkSettings(input) {
    const next = {...this.settings, ...input};
    next.topic = clean(next.topic, 300);
    next.audience = clean(next.audience, 200);
    if (!next.topic) {
      return {ok: false, reason: "Enter a topic first.", field: "topic"};
    }
    if (!TONES.includes(next.tone)) {
      return {ok: false, reason: `Tone must be one of: ${TONES.join(", ")}.`, field: "tone"};
    }
    if (!LANGUAGES.includes(next.language)) {
      return {ok: false, reason: `Language must be one of: ${LANGUAGES.join(", ")}.`, field: "language"};
    }
    const fromTopic = durationFromText(next.topic);
    next.videoMinutes = fromTopic || Number(next.videoMinutes);
    next.minutesFromTopic = Boolean(fromTopic);
    if (!Number.isInteger(next.videoMinutes * 2) || next.videoMinutes < 1 || next.videoMinutes > 20) {
      return {ok: false, reason: "Video length must be 1 to 20 minutes, in half-minute steps.", field: "videoMinutes"};
    }
    next.threadPosts = Number(next.threadPosts);
    if (!Number.isInteger(next.threadPosts) || next.threadPosts < 3 || next.threadPosts > 12) {
      return {ok: false, reason: "An X thread here has 3 to 12 posts.", field: "threadPosts"};
    }
    return {ok: true, settings: next};
  }

  setSettings(input) {
    const check = this.checkSettings(input);
    if (!check.ok) {
      return check;
    }
    this.settings = check.settings;
    this.changed("settings");
    return {ok: true, version: this.version, settings: this.settings};
  }

  saveBrief(brief) {
    const keyPoints = (brief.keyPoints || []).map((p) => clean(p, 300)).filter(Boolean);
    if (!clean(brief.angle, 400) || !clean(brief.hook, 400)) {
      return {ok: false, reason: "A brief needs an angle and a hook.", field: "angle"};
    }
    if (keyPoints.length < 2) {
      return {ok: false, reason: "A brief needs at least 2 key points.", field: "keyPoints"};
    }
    this.brief = {
      topic: this.settings.topic,
      audience: clean(brief.audience, 300) || this.settings.audience,
      angle: clean(brief.angle, 400),
      hook: clean(brief.hook, 400),
      keyPoints,
      callToAction: clean(brief.callToAction, 300),
      factsToCheck: (brief.factsToCheck || []).map((p) => clean(p, 300)).filter(Boolean),
      hookIdeas: (brief.hookIdeas || []).map((p) => clean(p, 300)).filter(Boolean).slice(0, 3),
    };
    this.changed("brief");
    return {ok: true, version: this.version, saved: "brief"};
  }

  saveYoutubeScript(script, opts = {}) {
    const sections = (script.sections || []).map((s, i) => ({
      number: i + 1,
      heading: clean(s.heading, 120),
      narration: clean(s.narration, 4000),
      bRoll: clean(s.bRoll, 600),
      seconds: Number.isInteger(s.seconds) ? s.seconds : null,
    }));
    if (!clean(script.title, 120)) {
      return {ok: false, reason: "The script needs a title (100 characters or less on YouTube).", field: "title"};
    }
    if (clean(script.title, 200).length > 100) {
      return {ok: false, reason: "YouTube titles are limited to 100 characters. Shorten the title.", field: "title"};
    }
    if (sections.length < 2 || sections.some((s) => !s.heading || !s.narration)) {
      return {ok: false, reason: "The script needs at least 2 sections, each with a heading and narration.", field: "sections"};
    }
    const scriptSecs = sections.reduce((sum, s) => sum + (s.seconds || 0), 0);
    const tolerance = opts.recorded ? 0.2 : TIMING_TOLERANCE;
    const lenIssue = checkLength(scriptSecs, this.settings.videoMinutes, tolerance);
    if (lenIssue) return {ok: false, reason: `Section seconds add up to ${scriptSecs}s. ${lenIssue}`, field: "sections"};
    if (!opts.recorded && this.settings.videoMinutes) {
      // The declared seconds must match what the narration takes to say.
      const t = draftTargets(this.settings);
      const said = [script.hook, ...sections.map((s) => s.narration), script.outro].reduce((n, x) => n + spokenUnits(x, this.settings.language), 0);
      const lo = Math.round(t.narrationBudget * 0.75), hi = Math.round(t.narrationBudget * 1.25);
      if (said < lo || said > hi) {
        return {ok: false, reason: `The hook, narration and outro hold ${said} ${t.narrationUnit}, but ${this.settings.videoMinutes} minutes of speech is about ${t.narrationBudget} (allowed ${lo} to ${hi}). ${said < lo ? "Add" : "Cut"} about ${Math.abs(t.narrationBudget - said)} ${t.narrationUnit}, keep the section seconds, and save again.`, field: "sections"};
      }
    }
    const titles = [];
    [script.title, ...(Array.isArray(script.titleOptions) ? script.titleOptions : [])].forEach((t) => {
      // Titles arrive with stray numbering, markdown, quotes or invisible characters.
      const c = clean(String(t ?? "").replace(/[\u200b-\u200f\u2060\ufeff]/g, "").replace(/\*\*|__|`/g, "").replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").replace(/^["“]+|["”]+$/g, ""), 200);
      if (!/[A-Za-z0-9\u3400-\u9fff]{2}/.test(c)) return;
      if (c && !titles.some((x) => x.toLowerCase() === c.toLowerCase())) titles.push(c);
    });
    if (!opts.recorded) {
      if (titles.length < 3) {
        return {ok: false, reason: `Give at least 3 different title options in titleOptions (you gave ${titles.length}), each 100 characters or less. Save again.`, field: "titleOptions"};
      }
      const longT = titles.filter((t) => t.length > 100);
      if (longT.length) return {ok: false, reason: `Titles are limited to 100 characters: shorten "${longT[0].slice(0, 40)}…". Save again.`, field: "titleOptions"};
    }
    this.script = {
      title: clean(script.title, 100),
      titleOptions: titles.filter((t) => t.length <= 100).slice(0, 5),
      hook: clean(script.hook, 1000),
      sections,
      outro: clean(script.outro, 1000),
      description: clean(script.description, 2000),
      targetMinutes: this.settings.videoMinutes,
    };
    this.changed("script");
    return {ok: true, version: this.version, saved: "youtubeScript", sections: sections.length};
  }

  saveXThread(thread, opts = {}) {
    const posts = (thread.posts || []).map((p) => String(p ?? "").trim());
    if (posts.length < 3 || posts.length > 12) {
      return {ok: false, reason: "A thread needs 3 to 12 posts.", field: "posts"};
    }
    const tooLong = [];
    posts.forEach((p, i) => {
      const weight = xLength(p);
      if (!p || weight > X_LIMIT) {
        tooLong.push(`post ${i + 1} weighs ${weight}`);
      }
    });
    if (tooLong.length) {
      return {ok: false, reason: `Each post must be 1 to ${X_LIMIT} weighted characters (CJK counts 2). Too long or empty: ${tooLong.join("; ")}. Shorten them and save again.`, field: "posts"};
    }
    if (!opts.recorded && !hasCallToAction(posts[posts.length - 1])) {
      return {ok: false, reason: "The last post must end with a clear call to action (for example: follow for part 2, watch the full video, reply with your answer). Rewrite the last post and save again.", field: "posts"};
    }
    this.thread = {posts: posts.map((text, i) => ({number: i + 1, text, weightedLength: xLength(text)}))};
    this.changed("thread");
    return {ok: true, version: this.version, saved: "xThread", posts: posts.length};
  }

  saveStoryboard(board, opts = {}) {
    const shots = (board.shots || []).map((s, i) => ({
      number: i + 1,
      title: clean(s.title, 80),
      section: clean(s.section, 120),
      seconds: Number(s.seconds) || 0,
      visual: clean(s.visual, 600),
      camera: clean(s.camera, 200),
      onScreenText: clean(s.onScreenText, 200),
      audio: clean(s.audio, 600),
    }));
    if (shots.length < 3 || shots.some((s) => !s.visual)) {
      return {ok: false, reason: "A storyboard needs at least 3 shots, each with a visual.", field: "shots"};
    }
    if (!opts.recorded) {
      const t = draftTargets(this.settings);
      if (shots.length < t.minShots) {
        return {ok: false, reason: `A ${this.settings.videoMinutes}-minute video needs at least ${t.minShots} shots; you sent ${shots.length}. Split long shots so each lasts ${t.maxShotSeconds}s or less, and save again.`, field: "shots"};
      }
      const bad = shots.filter((s) => !Number.isInteger(s.seconds) || s.seconds < t.minShotSeconds || s.seconds > t.maxShotSeconds).map((s) => `shot ${s.number} (${s.seconds}s)`);
      if (bad.length) {
        return {ok: false, reason: `Every shot lasts ${t.minShotSeconds} to ${t.maxShotSeconds} whole seconds. Fix: ${bad.join(", ")} (merge very short shots, split long ones). Save again.`, field: "shots"};
      }
      // The storyboard must run exactly as long as the saved script.
      const scriptSecs = this.script ? this.script.sections.reduce((n, s) => n + (s.seconds || 0), 0) : 0;
      const want = scriptSecs || t.totalSeconds;
      const have = shots.reduce((n, s) => n + s.seconds, 0);
      if (have !== want) {
        const fit = shots.length * t.minShotSeconds <= want && want <= shots.length * t.maxShotSeconds;
        return {ok: false, reason: `Shot seconds add up to ${have}s but the ${scriptSecs ? "saved script" : "target"} runs ${want}s. ${have > want ? "Remove" : "Add"} exactly ${Math.abs(have - want)}s across the shots (each stays ${t.minShotSeconds} to ${t.maxShotSeconds}s${fit ? "" : `; with ${shots.length} shots that is impossible, so use ${Math.ceil(want / t.maxShotSeconds)} to ${Math.floor(want / t.minShotSeconds)} shots`}). Save again.`, field: "shots"};
      }
      const titles = shots.map((s) => s.title.toLowerCase());
      const dupes = shots.filter((s, i) => !s.title || titles.indexOf(titles[i]) !== i || s.title.toLowerCase() === s.section.toLowerCase()).map((s) => s.number);
      if (dupes.length) {
        return {ok: false, reason: `Every shot needs its own short title describing that shot, different from the other shots and from the section name. Fix shots ${dupes.join(", ")} and save again.`, field: "shots"};
      }
    }
    const boardSecs = shots.reduce((sum, s) => sum + s.seconds, 0);
    const boardIssue = checkLength(boardSecs, this.settings.videoMinutes, opts.recorded ? 0.2 : TIMING_TOLERANCE);
    if (boardIssue) return {ok: false, reason: `Shot seconds add up to ${boardSecs}s. ${boardIssue}`, field: "shots"};
    this.storyboard = {
      shots,
      totalSeconds: shots.reduce((sum, s) => sum + s.seconds, 0),
    };
    this.changed("storyboard");
    const scriptTotal = this.script ? this.script.sections.reduce((n, s) => n + (s.seconds || 0), 0) : null;
    return {ok: true, version: this.version, saved: "storyboard", shots: shots.length, totalSeconds: this.storyboard.totalSeconds, scriptSeconds: scriptTotal, matchesScript: scriptTotal === this.storyboard.totalSeconds};
  }

  clearDraft(panel) {
    const map = {brief: "brief", youtubeScript: "script", xThread: "thread", storyboard: "storyboard"};
    if (!map[panel]) {
      return {ok: false, reason: "Unknown panel.", field: "panel"};
    }
    this[map[panel]] = null;
    this.changed(map[panel]);
    return {ok: true, version: this.version, cleared: panel};
  }

  /** Read-only check for opening X's composer with one post. */
  checkXCompose(postNumber) {
    if (!this.thread) {
      return {ok: false, reason: "There is no saved X thread yet.", field: "postNumber"};
    }
    const post = this.thread.posts.find((p) => p.number === postNumber);
    if (!post) {
      return {ok: false, reason: `The thread has posts 1 to ${this.thread.posts.length}.`, field: "postNumber"};
    }
    return {ok: true, post, url: `https://x.com/intent/post?text=${encodeURIComponent(post.text)}`};
  }

  /**
   * Open X's own composer in a new tab with one post filled in. Nothing is posted until
   * the visitor presses Post on X.
   */
  openXCompose(postNumber, opener = null) {
    const check = this.checkXCompose(postNumber);
    if (!check.ok) {
      return check;
    }
    const open = opener || (typeof window !== "undefined" ? window.open.bind(window) : null);
    if (!open) {
      return {ok: false, reason: "No browser window to open X in."};
    }
    const win = open(check.url, "_blank", "noopener");
    return {ok: true, opened: check.url, postNumber, note: "X's composer opened in a new tab. Nothing is posted until the visitor presses Post there.", blockedByBrowser: win === null};
  }

  /** The whole package as Markdown, for copy or download. */
  toMarkdown() {
    const s = this.settings;
    const m = this.runMeta || {};
    const when = m.generatedAt ? new Date(m.generatedAt) : new Date();
    const out = [`# ${s.topic || "Untitled topic"}`, "",
      `> **Topic:** ${s.topic || "-"}  `,
      `> **Generated:** ${when.toISOString().replace("T", " ").slice(0, 16)} UTC  `,
      `> **Model:** ${m.model || "not recorded"}  `,
      `> **Settings:** ${s.audience || "general audience"} · ${s.tone} · ${s.language} · ${s.videoMinutes}-minute video · ${s.threadPosts}-post thread  `,
      `> **Made with:** Creator Agent Studio (https://creator-agent-studio.pages.dev)${this.collab?.status === "answered" ? ` + partner site Hook Lab (${this.collab.url})${Number.isFinite(this.collab.seconds) ? `, which answered in ${this.collab.seconds}s` : ""}` : ""}`,
      ""];
    if (this.brief) {
      const b = this.brief;
      out.push("## Creative brief", `- Audience: ${b.audience}`, `- Angle: ${b.angle}`, `- Hook: ${b.hook}${this.hookSource(b.hook) === "Hook Lab" ? " _(from Hook Lab)_" : ""}`);
      b.keyPoints.forEach((p) => out.push(`- Key point: ${p}`));
      if (b.callToAction) out.push(`- Call to action: ${b.callToAction}`);
      b.factsToCheck.forEach((p) => out.push(`- Fact to check: ${p}`));
      const lab = this.collab?.status === "answered" ? this.collab.hooks || [] : [];
      lab.forEach((p) => out.push(`- Hook idea (Hook Lab): ${p}`));
      (b.hookIdeas || []).filter((p) => this.hookSource(p) !== "Hook Lab").forEach((p) => out.push(`- Hook idea (Strategist): ${p}`));
      out.push("");
    }
    if (this.script) {
      const y = this.script;
      out.push(`## YouTube script: ${y.title}`, "");
      if (y.titleOptions?.length > 1) { out.push("**Title options:**"); y.titleOptions.forEach((t, i) => out.push(`${i + 1}. ${t}`)); out.push(""); }
      out.push(`**Hook:** ${y.hook}`, "");
      y.sections.forEach((sec) => out.push(`### ${sec.number}. ${sec.heading}${sec.seconds ? ` (${sec.seconds}s)` : ""}`, sec.narration, sec.bRoll ? `_B-roll: ${sec.bRoll}_` : "", ""));
      if (y.outro) out.push(`**Outro:** ${y.outro}`, "");
      if (y.description) out.push("**Description:**", y.description, "");
    }
    if (this.thread) {
      out.push("## X thread", "");
      this.thread.posts.forEach((p) => out.push(`${p.number}/ ${p.text}`, ""));
    }
    if (this.storyboard) {
      out.push("## Storyboard", "", "| # | Shot | Section | Sec | Visual | Camera | On-screen text | Audio |", "|---|---|---|---|---|---|---|---|");
      this.storyboard.shots.forEach((sh) => out.push(`| ${sh.number} | ${sh.title} | ${sh.section} | ${sh.seconds} | ${sh.visual} | ${sh.camera} | ${sh.onScreenText} | ${sh.audio} |`.replace(/\n/g, " ")));
      out.push("");
    }
    return out.join("\n");
  }

  /**
   * The script's narration as an .srt subtitle file, timed by the saved section seconds.
   * The hook opens section 1 and the outro closes the last section when the narration
   * does not already contain them. Long sentences are split so a cue stays readable.
   */
  toSrt() {
    const y = this.script;
    if (!y) return "";
    const cues = [];
    let clock = 0;
    const secs = y.sections.map((s) => s.seconds || 0);
    const fallback = secs.some((n) => n > 0) ? 0 : Math.round((this.settings.videoMinutes * 60) / y.sections.length);
    y.sections.forEach((sec, i) => {
      let words = sec.narration || "";
      if (i === 0 && y.hook && !words.includes(y.hook)) words = `${y.hook} ${words}`;
      if (i === y.sections.length - 1 && y.outro && !words.includes(y.outro)) words = `${words} ${y.outro}`;
      const pieces = splitCues(words);
      const span = (secs[i] || fallback) * 1000;
      const total = pieces.reduce((n, p) => n + p.length, 0) || 1;
      let t = clock;
      pieces.forEach((p) => {
        const d = (span * p.length) / total;
        cues.push({start: t, end: t + d, text: p});
        t += d;
      });
      clock += span;
    });
    return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
  }

  /** The thread as plain text, one numbered post per paragraph. */
  toThreadText() {
    if (!this.thread) return "";
    const n = this.thread.posts.length;
    return this.thread.posts.map((p) => `${p.number}/${n}\n${p.text}`).join("\n\n") + "\n";
  }

  /** The storyboard as CSV (UTF-8 with BOM, so Excel opens Chinese text correctly). */
  toStoryboardCsv() {
    if (!this.storyboard) return "";
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["Shot", "Title", "Section", "Seconds", "Start", "Visual", "Camera", "On-screen text", "Audio"]];
    let t = 0;
    this.storyboard.shots.forEach((s) => {
      rows.push([s.number, s.title || "", s.section, s.seconds, srtTime(t * 1000).slice(3, 8), s.visual, s.camera, s.onScreenText, s.audio]);
      t += s.seconds;
    });
    return "\uFEFF" + rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
  }
}

/** HH:MM:SS,mmm */
export function srtTime(ms) {
  const v = Math.max(0, Math.round(ms));
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(v / 3600000))}:${pad(Math.floor(v / 60000) % 60)}:${pad(Math.floor(v / 1000) % 60)},${pad(v % 1000, 3)}`;
}

/** Sentences of at most ~84 characters (about two subtitle lines); CJK-aware. */
export function splitCues(text, max = 84) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const cjk = /[\u3400-\u9fff]/.test(clean);
  const limit = cjk ? 32 : max;
  const sentences = clean.match(/[^.!?。！？]+[.!?。！？]*["”’)]*\s*/g) || [clean];
  const out = [];
  for (let s of sentences) {
    s = s.trim();
    // Split a long sentence into even pieces, so no cue is a one-word leftover.
    let parts = Math.ceil(s.length / limit);
    while (parts > 1) {
      const target = Math.ceil(s.length / parts);
      let cut;
      if (cjk) {
        const window = s.slice(0, Math.min(limit, target + 8));
        cut = window.search(/[，、；：,;:][^，、；：,;:]*$/) + 1;
        if (cut < target / 2) cut = target;
      } else {
        const before = s.lastIndexOf(" ", target), after = s.indexOf(" ", target);
        cut = after > 0 && after - target < target - before && after <= limit ? after : before;
        if (cut <= 0) cut = Math.min(limit, s.length);
      }
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
      parts -= 1;
    }
    if (s) out.push(s);
  }
  return out;
}

/** Holds the one page object the page, site.js and site-actions.js share. */
export class App {
  static page = new Studio();
}
