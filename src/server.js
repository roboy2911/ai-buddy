// Local web page for voice: your mic goes in, the buddy's voice comes out.
import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer } from "ws";
import { config } from "./config.js";

const clients = new Set();
let handlers = { audio: async () => {}, text: () => {} };

export function startServer(h) {
  handlers = h;
  const app = express();
  app.use(express.static(path.resolve("public")));
  // Browser build of Kokoro, so the page can make the voice on your graphics card.
  app.get("/vendor/kokoro.web.js", (req, res) => res.sendFile(path.resolve("node_modules/kokoro-js/dist/kokoro.web.js")));
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    clients.add(ws);
    send(ws, { type: "hello", name: config.mc.username, voice: config.voice, speed: config.voiceSpeed });
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        // Mono 16 kHz Float32 samples from the browser.
        const buf = Buffer.from(data);
        const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
        handlers.audio(new Float32Array(samples)).catch((e) => console.error("[ears]", e.message));
      } else {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "text" && msg.text?.trim()) handlers.text(msg.text.trim());
          if (msg.type === "capabilities" && msg.browserVoice && !ws.browserVoice) {
            ws.browserVoice = true;
            console.log("[voice] The voice page is making the voice on your graphics card.");
          }
        } catch {}
      }
    });
    ws.on("close", () => clients.delete(ws));
  });

  server.listen(config.webPort, "127.0.0.1", () => {
    console.log(`\n[voice] Open http://localhost:${config.webPort} in Chrome or Edge and allow the microphone.\n`);
  });
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

export function broadcast(obj) {
  for (const ws of clients) send(ws, obj);
}

// True when an open voice page can make the voice itself.
export function hasBrowserVoice() {
  for (const ws of clients) if (ws.readyState === 1 && ws.browserVoice) return true;
  return false;
}

export function broadcastAudio(wav) {
  for (const ws of clients) if (ws.readyState === 1) ws.send(wav, { binary: true });
}
