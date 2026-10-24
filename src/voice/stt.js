// Speech-to-text with Whisper. Runs locally on your PC, free.
import { pipeline } from "@huggingface/transformers";
import { config } from "../config.js";

let asr = null;

export async function loadSTT() {
  console.log(`[ears] Loading Whisper (${config.whisperModel})...`);
  asr = await pipeline("automatic-speech-recognition", config.whisperModel, {
    dtype: "q8",
    device: "cpu",
  });
  console.log("[ears] Whisper ready.");
}

// Whisper often "hears" these on silence or noise. Ignore them.
const JUNK = /^(\s*(thank you|thanks for watching|you|bye|\.|\[.*\]|\(.*\))[.!]?\s*)+$/i;

// samples: Float32Array of mono audio at 16 kHz.
export async function transcribe(samples) {
  if (!asr) throw new Error("STT not loaded");
  const result = await asr(samples);
  const text = (result.text || "").trim();
  if (!text || JUNK.test(text)) return "";
  return text;
}
