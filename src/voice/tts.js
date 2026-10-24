// Text-to-speech with Kokoro. Runs locally on your PC, free.
import { KokoroTTS } from "kokoro-js";
import { config } from "../config.js";
import { pickDevice, loadWithFallback } from "./device.js";

let tts = null;

export async function loadTTS() {
  console.log("[voice] Loading Kokoro voice (first run downloads ~330 MB)...");
  tts = await loadWithFallback(
    "voice",
    pickDevice(config.ttsDevice),
    // fp32 is the fastest choice on both CPU and graphics cards.
    (device) => KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device }),
    (model) => model.generate("Hi there.", { voice: config.voice }),
  );
}

// Returns a WAV file (Buffer) of the spoken text.
export async function speak(text) {
  if (!tts) throw new Error("TTS not loaded");
  const t = Date.now();
  const audio = await tts.generate(text, { voice: config.voice, speed: config.voiceSpeed });
  if (config.debugTiming) console.log(`[voice] ${Date.now() - t} ms for ${(audio.audio.length / audio.sampling_rate).toFixed(1)} s of speech`);
  return Buffer.from(audio.toWav());
}
