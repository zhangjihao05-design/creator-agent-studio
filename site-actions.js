// Registers Creator Agent Studio's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
// js/studio.js is imported by the same URL the page uses, so there is one page state.
import { App, LANGUAGES, TONES } from "./js/studio.js";

const text = (description, maxLength) => ({type: "string", minLength: 1, maxLength, description});

// Every text field tells the model its length limit up front, so a draft is written to
// fit instead of being refused and retried.
function withLimits(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(withLimits);
  const out = {};
  for (const [k, v] of Object.entries(schema)) out[k] = typeof v === "object" ? withLimits(v) : v;
  if (out.type === "string" && out.maxLength && !/characters/.test(out.description || "")) {
    out.description = `${out.description || ""} At most ${out.maxLength} characters.`.trim();
  }
  return out;
}

class SiteActions {
  static registerActions(target) {
    const actions = {register: (def) => target.register(withLimits(def))};
    actions.register(SiteActions.readState());
    actions.register(SiteActions.setSettings());
    actions.register(SiteActions.saveBrief());
    actions.register(SiteActions.saveScript());
    actions.register(SiteActions.saveThread());
    actions.register(SiteActions.saveStoryboard());
    actions.register(SiteActions.openXCompose());
  }

  static readState() {
    return {
      name: "get_studio_state",
      description: "Read the studio settings (topic, audience, tone, output language, video minutes, thread posts), today's date, the limits, the link to the partner site Hook Lab, and every saved draft (brief, YouTube script, X thread, storyboard).",
      effect: "read",
      inputSchema: {type: "object", properties: {}, additionalProperties: false},
      execute: () => App.page.getState(),
    };
  }

  static setSettings() {
    return {
      name: "set_studio_settings",
      description: "Change the studio settings shown on the page. Give only the fields the visitor asked to change. Returns the new settings, or ok false with a reason.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          topic: text("The content topic, in the visitor's words.", 300),
          audience: {type: "string", maxLength: 200, description: "Who the content is for."},
          tone: {type: "string", enum: TONES, description: "Tone of voice."},
          language: {type: "string", enum: LANGUAGES, description: "Language of every draft."},
          videoMinutes: {type: "number", minimum: 1, maximum: 20, description: "Target video length in minutes, in half-minute steps. A length written in the topic overrides this."},
          threadPosts: {type: "integer", minimum: 3, maximum: 12, description: "Number of posts in the X thread."},
        },
      },
      execute: (args) => App.page.setSettings(args),
    };
  }

  static saveBrief() {
    return {
      name: "save_brief",
      description: "Save the creative brief to the Brief panel, replacing the previous one. Returns ok, or ok false with a reason.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["angle", "hook", "keyPoints"],
        properties: {
          audience: {type: "string", maxLength: 300, description: "Who it is for and what they want."},
          angle: text("The one fresh angle on the topic.", 400),
          hook: text("The opening line that stops the scroll.", 400),
          keyPoints: {type: "array", minItems: 2, maxItems: 7, items: text("One key point.", 300), description: "The points every format will cover, in order."},
          callToAction: {type: "string", maxLength: 300, description: "What the viewer should do next."},
          hookIdeas: {type: "array", maxItems: 3, items: text("An alternative hook.", 300), description: "Up to 3 runner-up hooks, such as the ones Hook Lab ranked."},
          factsToCheck: {type: "array", maxItems: 8, items: text("A claim to verify.", 300), description: "Numbers, dates or claims the creator must verify before publishing."},
        },
      },
      execute: (args) => App.page.saveBrief(args),
    };
  }

  static saveScript() {
    return {
      name: "save_youtube_script",
      description: "Save the YouTube script to its panel, replacing the previous one. Title max 100 characters. Returns ok, or ok false with a reason.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["title", "titleOptions", "hook", "sections"],
        properties: {
          title: text("Video title, 100 characters or less.", 200),
          titleOptions: {type: "array", minItems: 3, maxItems: 5, items: text("A different title the creator could use instead, 100 characters or less.", 200), description: "At least 3 alternative titles, each a different angle (curiosity, benefit, number)."},
          hook: text("First 15 seconds, spoken.", 1000),
          sections: {
            type: "array",
            minItems: 2,
            maxItems: 12,
            description: "The body, in order.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["heading", "narration"],
              properties: {
                heading: text("Section title.", 120),
                narration: text("What the creator says.", 4000),
                bRoll: {type: "string", maxLength: 600, description: "Footage or graphics to show."},
                seconds: {type: "integer", minimum: 5, maximum: 600, description: "Estimated length."},
              },
            },
          },
          outro: {type: "string", maxLength: 1000, description: "Closing lines with the call to action."},
          description: {type: "string", maxLength: 2000, description: "YouTube description text."},
        },
      },
      execute: (args) => App.page.saveYoutubeScript(args),
    };
  }

  static saveThread() {
    return {
      name: "save_x_thread",
      description: "Save the X thread to its panel, replacing the previous one. Each post at most 280 weighted characters (CJK counts 2, links 23). The last post must carry a clear call to action (follow, watch, reply...). The site refuses a thread that breaks a rule and says why.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["posts"],
        properties: {
          posts: {type: "array", minItems: 3, maxItems: 12, items: text("One post, no numbering prefix.", 600), description: "The posts in order."},
        },
      },
      execute: (args) => App.page.saveXThread(args),
    };
  }

  static saveStoryboard() {
    return {
      name: "save_storyboard",
      description: "Save the storyboard to its panel, replacing the previous one. Returns ok with the shot count and total seconds, or ok false with a reason.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["shots"],
        properties: {
          shots: {
            type: "array",
            minItems: 3,
            maxItems: 60,
            description: "Shots in order: at least targets.minShots from website_get_studio_state.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "visual", "seconds"],
              properties: {
                title: {type: "string", maxLength: 80, description: "Short title of this shot, unique in the storyboard and different from the section name."},
                section: {type: "string", maxLength: 120, description: "Script section heading this shot belongs to."},
                seconds: {type: "integer", minimum: 15, maximum: 35, description: "Shot length in whole seconds, 15 to 35. All shots together must equal the script's total seconds."},
                visual: text("What we see.", 600),
                camera: {type: "string", maxLength: 200, description: "Framing and movement."},
                onScreenText: {type: "string", maxLength: 200, description: "Caption or title card."},
                audio: {type: "string", maxLength: 600, description: "This shot's own voiceover line, music or sound (aim for under 400 characters; never paste a whole script section)."},
              },
            },
          },
        },
      },
      execute: (args) => App.page.saveStoryboard(args),
    };
  }

  static openXCompose() {
    return {
      name: "open_x_compose",
      description: "Open X's own composer in a new tab with one saved thread post filled in. The browser asks the visitor first. Nothing is posted until the visitor presses Post on X.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["postNumber"],
        properties: {
          postNumber: {type: "integer", minimum: 1, maximum: 12, description: "Post number from the saved thread."},
        },
      },
      execute: (args) => App.page.openXCompose(args.postNumber),
    };
  }
}

export const registerActions = SiteActions.registerActions;
