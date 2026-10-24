// The buddy's brain: Claude decides what to say and do.
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { tools, runTool, currentTask } from "./actions.js";
import { describeWorld } from "./bot.js";
import { memoryForPrompt, addSessionSummary } from "./memory.js";

const BETAS = ["server-side-fallback-2026-07-01", "compact-2026-01-12"];
const SILENT = "(silent)";

let client = null;
let system = "";
const history = []; // append-only conversation with Claude
const transcript = []; // plain-text log of this session, for the end-of-session summary
let onSay = () => {};
let onStatus = () => {};
let onInterrupt = () => {};
let lastPlayerAt = 0;
const MAX_SENTENCES = 3; // per reply, so it doesn't ramble

function buildSystemPrompt() {
  return `You are ${config.mc.username}, the player's AI best friend who plays Minecraft with them. You're in their world as your own character, and you talk with them over voice chat.

Personality: chill, funny, a little cheeky, loyal. You talk like a real friend on voice chat, not an assistant. React to what happens. Tease them a bit when they mess up, hype them up when they do something cool. Have your own opinions about builds, strategies and what to do next.

How you talk (everything you write is spoken aloud by a text-to-speech voice):
- Keep it SHORT. Usually one sentence, at most two. Long replies make you lag behind the game.
- Talk once per reply. If you use tools, say one quick line either before or after them, not both.
- Don't fill silence. Friends don't comment on everything.
- Plain spoken words only. No markdown, lists, emojis, asterisks or stage directions.
- Say numbers and coordinates the way a person would say them.
- Don't narrate your tool calls ("I will now call follow_player"). Just say it naturally ("Yeah, I'm right behind you").

What you can do: use your tools to act in the game. When the player asks you to do something, do it with a tool and confirm briefly. Long jobs (following, mining, guarding) keep running in the background; you'll get a "Task finished" or "Task failed" event later.

Each message includes [Game state] showing what you can currently see. Messages that start with [Game event] are things that just happened, not the player talking. For a game event, only speak if it really matters (real danger, someone died, something big). Most of the time reply with exactly ${SILENT} and nothing else.

Getting to know the player: you want to become a real friend who knows them well. Over time, naturally learn about them: their name, what they like to build, how they play, what they're into outside the game, their goals. Ask about them sometimes, but don't interrogate. Whenever you learn something worth knowing next time (a fact about them, a preference, something memorable you did together, an inside joke), save it with the remember tool. Bring up past memories naturally when they fit, like a friend would.

${memoryForPrompt()}`;
}

export function initBrain({ say, status, interrupt }) {
  onSay = say;
  onInterrupt = interrupt || (() => {});
  onStatus = status || (() => {});
  system = buildSystemPrompt();
  if (!config.mockBrain) client = new Anthropic();
}

// ---- Input queue: player speech, chat, and game events ----
const inbox = [];
let busy = false;
let lastEventAt = 0;

export function hear(text, source = "voice") {
  // You talking cuts off whatever the buddy was still going to say.
  onInterrupt();
  lastPlayerAt = Date.now();
  inbox.push({ kind: "player", text, source });
  transcript.push(`Player: ${text}`);
  pump();
}

export function gameEvent(text, { force = false } = {}) {
  // Don't let events flood the conversation (or your credits):
  // skip them while it's busy, right after you talked, or if it commented recently.
  const now = Date.now();
  if (!force && (busy || inbox.length || now - lastPlayerAt < 20000 || now - lastEventAt < 45000)) return;
  lastEventAt = now;
  inbox.push({ kind: "event", text });
  pump();
}

async function pump() {
  if (busy || inbox.length === 0) return;
  busy = true;
  // Merge everything waiting into one turn.
  const items = inbox.splice(0);
  const said = items.filter((i) => i.kind === "player").map((i) => `[Player said${i.source === "chat" ? " in chat" : ""}]: ${i.text}`);
  const evts = items.filter((i) => i.kind === "event").map((i) => `[Game event] ${i.text}`);
  const text = `[Game state]\n${describeWorld(currentTask())}\n\n${[...evts, ...said].join("\n")}`;
  try {
    onStatus("thinking");
    await think(text);
  } catch (err) {
    console.error("[brain] Error:", err.message);
    if (err instanceof Anthropic.AuthenticationError) onSay("My brain can't log in. Check the Claude API key in the dot env file.");
    else if (err instanceof Anthropic.RateLimitError) onSay("Hang on, my brain's rate limited. Give me a sec.");
    else if (err instanceof Anthropic.APIError && err.status === 400 && /credit/i.test(err.message)) onSay("I'm out of Claude credits, so my brain's switched off.");
    else onSay("Sorry, my brain glitched for a sec.");
  } finally {
    onStatus("idle");
    busy = false;
    if (inbox.length) pump();
  }
}

// Splits streamed text into sentences so the voice can start talking early.
function sentenceSplitter(emit) {
  let buf = "";
  return {
    push(delta) {
      buf += delta;
      let m;
      while ((m = buf.match(/^(.+?[.!?]+)(\s+|$)(?=\S|$)/s)) && m[0].length < buf.length) {
        emit(m[1].trim());
        buf = buf.slice(m[0].length);
      }
    },
    flush() {
      if (buf.trim()) emit(buf.trim());
      buf = "";
    },
  };
}

async function think(userText) {
  if (config.mockBrain) return mockThink(userText);
  history.push({ role: "user", content: userText });

  let sentences = 0; // across the whole reply, including after tool calls
  for (let step = 0; step < 6; step++) {
    let spoken = "";
    let silent = false;
    const splitter = sentenceSplitter((s) => {
      if (s.startsWith(SILENT) || s === "(silent") { silent = true; return; }
      if (silent || sentences >= MAX_SENTENCES) return;
      sentences++;
      spoken += s + " ";
      onSay(s);
    });

    let message;
    let jsonRetries = 0;
    while (true) {
      try {
        const stream = client.beta.messages.stream({
          model: config.model,
          max_tokens: 16000,
          betas: BETAS,
          fallbacks: "default",
          context_management: { edits: [{ type: "compact_20260112" }] },
          output_config: { effort: config.effort },
          cache_control: { type: "ephemeral" },
          system,
          tools,
          messages: history,
        });
        stream.on("text", (d) => splitter.push(d));
        message = await stream.finalMessage();
        break;
      } catch (err) {
        // Only retry unparseable tool input; real API errors go up.
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        console.warn("[brain] Tool input wasn't valid JSON, retrying.");
      }
    }
    splitter.flush();
    if (spoken) transcript.push(`${config.mc.username}: ${spoken.trim()}`);

    if (message.stop_reason === "refusal") {
      onSay("Nah, I'm not gonna do that one.");
      // Don't keep the refused turn; keep history valid by noting it as the player turn's answer.
      history.push({ role: "assistant", content: "(declined)" });
      return;
    }

    history.push({ role: "assistant", content: message.content });

    const toolUses = message.content.filter((b) => b.type === "tool_use");
    if (message.stop_reason === "pause_turn") continue;
    if (message.stop_reason !== "tool_use" || toolUses.length === 0) return;

    const results = [];
    for (const t of toolUses) {
      if (message.stop_reason === "max_tokens") {
        results.push({ type: "tool_result", tool_use_id: t.id, is_error: true, content: "Input was cut off." });
        continue;
      }
      onStatus(`doing: ${t.name}`);
      const r = await runTool(t.name, t.input);
      console.log(`[action] ${t.name}(${JSON.stringify(t.input)}) -> ${r.text}`);
      results.push({ type: "tool_result", tool_use_id: t.id, content: r.text, is_error: !r.ok });
    }
    history.push({ role: "user", content: results });
  }
}

// Ask Claude to boil this session down to a short memory.
export async function summarizeSession() {
  if (transcript.length < 2) return;
  if (config.mockBrain) {
    addSessionSummary(`Test session with ${transcript.length} lines of conversation.`);
    return;
  }
  try {
    const res = await client.beta.messages.create({
      model: config.model,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      messages: [{
        role: "user",
        content: `Here's the transcript of a Minecraft session between a player and their AI buddy ${config.mc.username}. Write a 1-3 sentence summary from the buddy's point of view of what happened and anything memorable, to remember next time. Plain text only.\n\n${transcript.slice(-300).join("\n")}`,
      }],
    });
    if (res.stop_reason === "refusal") return;
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    if (text) addSessionSummary(text);
    console.log("[memory] Saved session summary:", text);
  } catch (err) {
    console.error("[memory] Couldn't summarize session:", err.message);
  }
}

// Test brain with no Claude key: simple keyword commands.
async function mockThink(text) {
  const said = (text.match(/\[Player said[^\]]*\]: (.*)/g) || []).map((l) => l.replace(/^[^:]+: /, "")).join(" ").toLowerCase();
  if (!said) return;
  const cmds = [
    [/follow/, "follow_player", {}, "Right behind you."],
    [/stop/, "stop", {}, "Okay, stopping."],
    [/come|here/, "come_to_player", {}, "Coming!"],
    [/wood|log/, "mine_blocks", { block: "oak_log", count: 3 }, "Getting some wood."],
    [/guard|protect/, "guard_player", {}, "I've got your back."],
    [/remember (.*)/, "remember", null, "Got it, I'll remember that."],
  ];
  for (const [re, tool, input, reply] of cmds) {
    const m = said.match(re);
    if (m) {
      const r = await runTool(tool, input ?? { fact: m[1] });
      console.log(`[action] ${tool} -> ${r.text}`);
      onSay(r.ok ? reply : r.text);
      transcript.push(`${config.mc.username}: ${reply}`);
      return;
    }
  }
  onSay(`You said: ${said}`);
}
