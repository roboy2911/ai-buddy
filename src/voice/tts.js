// Text-to-speech with Kokoro. Runs locally on your PC, free.
import { KokoroTTS } from "kokoro-js";
import { config } from "../config.js";

let tts = null;

async function load(device) {
  // fp32 is about 2x faster than the smaller q8 model on most CPUs.
  return KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device });
}

export async function loadTTS() {
  console.log("[voice] Loading Kokoro voice (first run downloads ~330 MB)...");
  try {
    tts = await load(config.ttsDevice);
  } catch (err) {
    if (config.ttsDevice === "cpu") throw err;
    console.warn(`[voice] Couldn't use TTS_DEVICE=${config.ttsDevice} (${err.message}). Falling back to cpu.`);
    tts = await load("cpu");
  }
  // Warm up so the first real sentence isn't slow.
  await tts.generate("Hi.", { voice: config.voice });
  console.log("[voice] Kokoro ready.");
}

// Returns a WAV file (Buffer) of the spoken text.
export async function speak(text) {
  if (!tts) throw new Error("TTS not loaded");
  const t = Date.now();
  const audio = await tts.generate(text, { voice: config.voice, speed: config.voiceSpeed });
  if (config.debugTiming) console.log(`[voice] ${Date.now() - t} ms for ${(audio.audio.length / audio.sampling_rate).toFixed(1)} s of speech`);
  return Buffer.from(audio.toWav());
}
