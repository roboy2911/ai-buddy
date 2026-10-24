// Speech-to-text with Whisper. Runs locally on your PC, free.
import { pipeline } from "@huggingface/transformers";
import { config } from "../config.js";
import { pickDevice, loadWithFallback } from "./device.js";

let asr = null;

export async function loadSTT() {
  console.log(`[ears] Loading Whisper (${config.whisperModel})...`);
  asr = await loadWithFallback(
    "ears",
    pickDevice(config.sttDevice),
    (device) => pipeline("automatic-speech-recognition", config.whisperModel, {
      dtype: device === "cpu" ? "q8" : "fp32",
      device,
    }),
    (model) => model(new Float32Array(16000)),
  );
}

// Whisper often "hears" these on silence or noise. Ignore them.
const JUNK = /^(\s*(thank you|thanks for watching|you|bye|\.|\[.*\]|\(.*\))[.!]?\s*)+$/i;

// samples: Float32Array of mono audio at 16 kHz.
export async function transcribe(samples) {
  if (!asr) throw new Error("STT not loaded");
  const t = Date.now();
  const result = await asr(samples);
  if (config.debugTiming) console.log(`[ears] ${Date.now() - t} ms to understand ${(samples.length / 16000).toFixed(1)} s of audio`);
  const text = (result.text || "").trim();
  if (!text || JUNK.test(text)) return "";
  return text;
}
