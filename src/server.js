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
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    clients.add(ws);
    send(ws, { type: "hello", name: config.mc.username });
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

export function broadcastAudio(wav) {
  for (const ws of clients) if (ws.readyState === 1) ws.send(wav, { binary: true });
}
