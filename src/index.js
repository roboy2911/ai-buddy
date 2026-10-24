import { config } from "./config.js";
import { loadMemory } from "./memory.js";
import { startBot, events, bot } from "./bot.js";
import { initBrain, hear, gameEvent, summarizeSession } from "./brain.js";
import { startServer, broadcast, broadcastAudio } from "./server.js";
import { loadTTS, speak } from "./voice/tts.js";
import { loadSTT, transcribe } from "./voice/stt.js";

if (!config.mockBrain && !process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and put your Claude API key in it.");
  process.exit(1);
}

loadMemory();

// Speak sentences one at a time, in order.
let speechQueue = Promise.resolve();
function say(text) {
  console.log(`${config.mc.username}: ${text}`);
  // One sentence at a time, in order (parallel would slow down the first one).
  speechQueue = speechQueue.then(async () => {
    const wav = await speak(text).catch((e) => {
      console.error("[voice]", e.message);
      return null;
    });
    // The page shows the text when this clip starts playing.
    broadcast({ type: "say", text, hasAudio: !!wav });
    if (wav) broadcastAudio(wav);
  });
}

initBrain({ say, status: (s) => broadcast({ type: "status", text: s }) });

startServer({
  audio: async (samples) => {
    broadcast({ type: "status", text: "listening..." });
    const text = await transcribe(samples);
    if (!text) return broadcast({ type: "status", text: "idle" });
    console.log(`You: ${text}`);
    broadcast({ type: "log", who: "you", text });
    hear(text, "voice");
  },
  text: (text) => {
    console.log(`You (typed): ${text}`);
    broadcast({ type: "log", who: "you", text });
    hear(text, "chat");
  },
});

await Promise.all([loadTTS(), loadSTT()]);
broadcast({ type: "status", text: "idle" });

events.on("player_chat", ({ username, message }) => {
  if (config.playerName && username !== config.playerName) {
    hear(`(${username} says in chat) ${message}`, "chat");
  } else {
    hear(message, "chat");
  }
});
events.on("game_event", (text) => {
  console.log(`[event] ${text}`);
  gameEvent(text);
});

async function connect() {
  try {
    await startBot();
    gameEvent("You just joined the game. Say hi to the player.");
  } catch (err) {
    console.error(`[bot] Couldn't join: ${err.message}. Retrying in 10 seconds...`);
    setTimeout(connect, 10000);
  }
}
events.on("disconnected", () => setTimeout(connect, 10000));
connect();

let quitting = false;
process.on("SIGINT", async () => {
  if (quitting) process.exit(0);
  quitting = true;
  console.log("\nSaving memories before quitting...");
  await summarizeSession();
  bot?.quit();
  process.exit(0);
});
