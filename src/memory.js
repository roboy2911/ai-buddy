// Long-term memory: what the buddy has learned about you, saved between sessions.
import fs from "fs";
import path from "path";
import { config } from "./config.js";

const FILE = path.join(config.dataDir, "memory.json");
const MAX_FACTS = 300;
const MAX_SESSIONS_IN_PROMPT = 8;

let mem = { firstMet: null, sessionCount: 0, facts: [], sessions: [] };

export function loadMemory() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(FILE)) {
    try {
      mem = { ...mem, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
    } catch (e) {
      // Keep a copy of the broken file instead of overwriting it.
      fs.copyFileSync(FILE, FILE + ".broken-" + Date.now());
      console.warn("[memory] memory.json was unreadable; saved a backup and started fresh.");
    }
  }
  if (!mem.firstMet) mem.firstMet = new Date().toISOString();
  mem.sessionCount += 1;
  save();
  console.log(`[memory] Session #${mem.sessionCount}. I remember ${mem.facts.length} things about you.`);
}

function save() {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(mem, null, 2));
  fs.renameSync(tmp, FILE);
}

export function remember(text, category = "general") {
  const clean = String(text).trim();
  if (!clean) return "Nothing to remember.";
  const dupe = mem.facts.find((f) => f.text.toLowerCase() === clean.toLowerCase());
  if (dupe) return "Already knew that.";
  mem.facts.push({ text: clean, category, added: new Date().toISOString() });
  if (mem.facts.length > MAX_FACTS) mem.facts.shift();
  save();
  return "Saved to memory.";
}

export function forget(text) {
  const needle = String(text).toLowerCase();
  const before = mem.facts.length;
  mem.facts = mem.facts.filter((f) => !f.text.toLowerCase().includes(needle));
  save();
  return `Forgot ${before - mem.facts.length} thing(s).`;
}

export function addSessionSummary(summary) {
  mem.sessions.push({ date: new Date().toISOString(), summary: String(summary).trim() });
  save();
}

// Text block describing everything remembered, for the AI's instructions.
export function memoryForPrompt() {
  const lines = [];
  lines.push(`You first met the player on ${mem.firstMet.slice(0, 10)}. This is play session #${mem.sessionCount} together.`);
  if (mem.facts.length) {
    lines.push("", "Things you've learned about the player:");
    const byCat = {};
    for (const f of mem.facts) (byCat[f.category] ||= []).push(f.text);
    for (const [cat, items] of Object.entries(byCat)) {
      lines.push(`[${cat}]`, ...items.map((t) => `- ${t}`));
    }
  } else {
    lines.push("", "You don't know anything about the player yet. Get to know them naturally as you play.");
  }
  const recent = mem.sessions.slice(-MAX_SESSIONS_IN_PROMPT);
  if (recent.length) {
    lines.push("", "Recent sessions together (oldest first):");
    for (const s of recent) lines.push(`- ${s.date.slice(0, 10)}: ${s.summary}`);
  }
  return lines.join("\n");
}
