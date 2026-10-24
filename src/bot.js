// The buddy's body in Minecraft (Mineflayer).
import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import pvpPkg from "mineflayer-pvp";
import collectPkg from "mineflayer-collectblock";
import { EventEmitter } from "events";
import { config } from "./config.js";

const { pathfinder, Movements } = pathfinderPkg;

export const events = new EventEmitter();
export let bot = null;

const HOSTILE = new Set([
  "zombie", "husk", "drowned", "skeleton", "stray", "bogged", "creeper", "spider", "cave_spider",
  "enderman", "witch", "slime", "magma_cube", "phantom", "pillager", "vindicator", "evoker",
  "ravager", "vex", "blaze", "ghast", "wither_skeleton", "hoglin", "zoglin", "piglin_brute",
  "guardian", "elder_guardian", "silverfish", "endermite", "shulker", "warden", "breeze", "creaking",
  "zombie_villager",
]);
export const isHostile = (e) => e && HOSTILE.has(e.name);

const NOTABLE_BLOCKS = [
  "diamond_ore", "deepslate_diamond_ore", "iron_ore", "deepslate_iron_ore", "gold_ore",
  "deepslate_gold_ore", "coal_ore", "deepslate_coal_ore", "copper_ore", "redstone_ore",
  "lapis_ore", "emerald_ore", "ancient_debris", "chest", "crafting_table", "furnace", "bed",
  "lava", "water",
];

export function startBot() {
  return new Promise((resolve, reject) => {
    console.log(`[bot] Connecting to ${config.mc.host}:${config.mc.port} as ${config.mc.username}...`);
    bot = mineflayer.createBot({
      host: config.mc.host,
      port: config.mc.port,
      username: config.mc.username,
      auth: config.mc.auth,
      version: config.mc.version,
    });
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(pvpPkg.plugin);
    bot.loadPlugin(collectPkg.plugin);

    let spawned = false;
    bot.once("spawn", () => {
      spawned = true;
      const moves = new Movements(bot);
      moves.canDig = true;
      moves.allow1by1towers = true;
      bot.pathfinder.setMovements(moves);
      console.log(`[bot] Joined! Minecraft ${bot.version}.`);
      wireEvents();
      resolve(bot);
    });
    bot.on("error", (err) => {
      console.error("[bot] Error:", err.message);
      if (!spawned) reject(err);
    });
    bot.on("kicked", (reason) => {
      const text = typeof reason === "string" ? reason : JSON.stringify(reason);
      console.error("[bot] Kicked:", text);
      if (!spawned) reject(new Error("Kicked: " + text));
    });
    bot.on("end", () => {
      console.log("[bot] Disconnected.");
      events.emit("disconnected");
    });
  });
}

// Which player is "you"? The configured name, or the nearest player.
export function getPlayer() {
  const players = Object.values(bot.players).filter((p) => p.username !== bot.username);
  if (config.playerName) {
    const p = bot.players[config.playerName];
    if (p) return p;
  }
  let best = null;
  for (const p of players) {
    if (!p.entity) continue;
    if (!best || bot.entity.position.distanceTo(p.entity.position) < bot.entity.position.distanceTo(best.entity.position)) best = p;
  }
  return best || players[0] || null;
}

function wireEvents() {
  // Chat from the player counts as talking to the buddy.
  bot.on("chat", (username, message) => {
    if (username === bot.username) return;
    events.emit("player_chat", { username, message });
  });

  let lastHurt = 0;
  let lastHealth = bot.health;
  bot.on("health", () => {
    const now = Date.now();
    if (bot.health < lastHealth && now - lastHurt > 15000) {
      lastHurt = now;
      events.emit("game_event", `You (the buddy) took damage. Health is now ${bot.health.toFixed(0)}/20.`);
    }
    lastHealth = bot.health;
  });

  bot.on("death", () => events.emit("game_event", "You (the buddy) just died and respawned."));

  // Server messages like "Steve was slain by Zombie" or advancements.
  bot.on("messagestr", (msg, position) => {
    if (position === "chat") return;
    const name = getPlayer()?.username;
    if (name && msg.startsWith(name + " ") && !msg.includes("<")) {
      events.emit("game_event", `Server message: "${msg}"`);
    }
  });

  // Night falling, once per day.
  let announcedNight = false;
  bot.on("time", () => {
    const t = bot.time.timeOfDay;
    if (t > 12500 && t < 13500 && !announcedNight) {
      announcedNight = true;
      events.emit("game_event", "The sun is setting. Night (and monsters) are coming.");
    }
    if (t < 1000) announcedNight = false;
  });

  // Warn about monsters close to the player, at most every 20 seconds.
  let lastDanger = 0;
  setInterval(() => {
    const p = getPlayer();
    if (!p?.entity || Date.now() - lastDanger < 20000) return;
    const threat = bot.nearestEntity((e) => isHostile(e) && e.position.distanceTo(p.entity.position) < 6);
    if (threat) {
      lastDanger = Date.now();
      events.emit("game_event", `A ${threat.name} is right next to the player (${threat.position.distanceTo(p.entity.position).toFixed(0)} blocks away).`);
    }
  }, 1000);
}

function timeOfDay(t) {
  if (t < 6000) return "morning";
  if (t < 12000) return "afternoon";
  if (t < 13000) return "sunset";
  if (t < 23000) return "night";
  return "sunrise";
}

// A short text description of what the buddy can see right now.
export function describeWorld(currentTask) {
  if (!bot?.entity) return "Not connected to the game.";
  const pos = bot.entity.position;
  const lines = [];
  lines.push(`You: health ${bot.health?.toFixed(0)}/20, food ${bot.food}/20, at ${pos.x.toFixed(0)} ${pos.y.toFixed(0)} ${pos.z.toFixed(0)} in ${bot.game.dimension}.`);
  lines.push(`Time: ${timeOfDay(bot.time.timeOfDay)}${bot.isRaining ? ", raining" : ""}.`);
  lines.push(`Current task: ${currentTask || "none"}.`);

  const p = getPlayer();
  if (p?.entity) {
    const d = pos.distanceTo(p.entity.position);
    const held = p.entity.heldItem ? `, holding ${p.entity.heldItem.name}` : "";
    lines.push(`Player ${p.username}: ${d.toFixed(0)} blocks away at ${p.entity.position.x.toFixed(0)} ${p.entity.position.y.toFixed(0)} ${p.entity.position.z.toFixed(0)}${held}.`);
  } else if (p) {
    lines.push(`Player ${p.username}: online but too far away to see.`);
  } else {
    lines.push("Player: not online.");
  }

  const nearby = Object.values(bot.entities)
    .filter((e) => e !== bot.entity && e.position.distanceTo(pos) < 20 && e.type !== "object" && e.name !== "item")
    .map((e) => ({ e, d: e.position.distanceTo(pos) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 8)
    .map(({ e, d }) => `${e.username || e.name}${isHostile(e) ? " (hostile)" : ""} ${d.toFixed(0)}m`);
  if (nearby.length) lines.push(`Nearby: ${nearby.join(", ")}.`);

  const found = {};
  for (const name of NOTABLE_BLOCKS) {
    const id = bot.registry.blocksByName[name]?.id;
    if (id === undefined) continue;
    const b = bot.findBlock({ matching: id, maxDistance: 16 });
    if (b) found[name] = b.position.distanceTo(pos).toFixed(0) + "m";
  }
  const blockList = Object.entries(found).map(([n, d]) => `${n} ${d}`);
  if (blockList.length) lines.push(`Blocks you can see: ${blockList.join(", ")}.`);

  const inv = {};
  for (const item of bot.inventory.items()) inv[item.name] = (inv[item.name] || 0) + item.count;
  const invList = Object.entries(inv).map(([n, c]) => `${n} x${c}`);
  lines.push(`Your inventory: ${invList.length ? invList.join(", ") : "empty"}.`);
  if (bot.heldItem) lines.push(`Holding: ${bot.heldItem.name}.`);
  return lines.join("\n");
}
