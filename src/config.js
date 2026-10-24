import "dotenv/config";

const env = process.env;

export const config = {
  playerName: env.PLAYER_NAME || "",
  mc: {
    host: env.MC_HOST || "localhost",
    port: Number(env.MC_PORT || 25565),
    version: env.MC_VERSION || undefined,
    username: env.BOT_NAME || "Buddy",
    auth: env.BOT_AUTH || "offline",
  },
  model: env.MODEL || "claude-opus-5-5",
  effort: env.EFFORT || "low",
  voice: env.VOICE || "am_michael",
  voiceSpeed: Number(env.VOICE_SPEED || 1.1),
  ttsDevice: env.TTS_DEVICE || "cpu",
  debugTiming: env.DEBUG_TIMING === "1",
  whisperModel: env.WHISPER_MODEL || "onnx-community/whisper-base.en",
  webPort: Number(env.WEB_PORT || 3000),
  dataDir: env.DATA_DIR || "./data",
  // For testing without a Claude key: the brain echoes instead of thinking.
  mockBrain: env.MOCK_BRAIN === "1",
};
