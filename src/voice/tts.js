// Text-to-speech with Kokoro. Runs locally on your PC, free.
import { KokoroTTS } from "kokoro-js";
import { config } from "../config.js";

let tts = null;

export async function loadTTS() {
  console.log("[voice] Loading Kokoro voice (first run downloads ~90 MB)...");
  tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: "q8",
    device: "cpu",
  });
  console.log("[voice] Kokoro ready.");
}

// Returns a WAV file (Buffer) of the spoken text.
export async function speak(text) {
  if (!tts) throw new Error("TTS not loaded");
  const audio = await tts.generate(text, { voice: config.voice, speed: config.voiceSpeed });
  return Buffer.from(audio.toWav());
}
