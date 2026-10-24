// Picks where the voice models run. "auto" = graphics card on Windows (DirectML), else CPU.
export function pickDevice(setting) {
  const s = (setting || "auto").toLowerCase();
  if (s !== "auto") return s;
  return process.platform === "win32" ? "dml" : "cpu";
}

// Tries to load and test a model on the chosen device, falling back to CPU if it fails.
export async function loadWithFallback(label, device, load, warmup) {
  if (device !== "cpu") {
    try {
      const model = await load(device);
      await warmup(model);
      console.log(`[${label}] Running on your graphics card (${device}).`);
      return model;
    } catch (err) {
      console.warn(`[${label}] Couldn't use the graphics card (${err.message}). Using the CPU instead.`);
    }
  }
  const model = await load("cpu");
  await warmup(model);
  console.log(`[${label}] Running on the CPU.`);
  return model;
}
