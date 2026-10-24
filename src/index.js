import { config } from "./config.js";
import { loadMemory } from "./memory.js";
import { startBot, events, bot } from "./bot.js";
import { initBrain, hear, gameEvent, summarizeSession } from "./brain.js";
import { startServer, broadcast, broadcastAudio, hasBrowserVoice } from "./server.js";
import { loadTTS, speak } from "./voice/tts.js";
import { loadSTT, transcribe } from "./voice/stt.js";

if (!config.mockBrain && !process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and put your Claude API key in it.");
  process.exit(1);
}

loadMemory();

// Speak sentences one at a time, in order.
let speechQueue = Promise.resolve();
let speechGen = 0; // bumps when you talk, so old queued sentences get skipped

function interrupt() {
  speechGen++;
  broadcast({ type: "stop" });
}

function say(text) {
  const gen = speechGen;
  console.log(`${config.mc.username}: ${text}`);
  // Fastest: the voice page makes the voice on your graphics card.
  if (hasBrowserVoice()) {
    speechQueue = speechQueue.then(() => { if (gen === speechGen) broadcast({ type: "speak", text }); });
    return;
  }
  // Otherwise make it here on the CPU, one sentence at a time, in order.
  speechQueue = speechQueue.then(async () => {
    if (gen !== speechGen) return;
    const wav = await speak(text).catch((e) => {
      console.error("[voice]", e.message);
      return null;
    });
    // The page shows the text when this clip starts playing.
    broadcast({ type: "say", text, hasAudio: !!wav });
    if (wav) broadcastAudio(wav);
  });
}

initBrain({ say, interrupt, status: (s) => broadcast({ type: "status", text: s }) });

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

// Only ever one connection attempt (or one scheduled retry) at a time.
let connecting = false;
let retryTimer = null;
function scheduleConnect(ms) {
  if (connecting || retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; connect(); }, ms);
}
async function connect() {
  if (connecting) return;
  connecting = true;
  try {
    await startBot();
    connecting = false;
    gameEvent("You just joined the game. Say hi to the player.", { force: true });
  } catch (err) {
    connecting = false;
    console.error(`[bot] Couldn't join (${err.message}). Is the Minecraft server running? Retrying in 10 seconds...`);
    scheduleConnect(10000);
  }
}
events.on("disconnected", () => scheduleConnect(10000));
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
