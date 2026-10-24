// Things the buddy can do in the game. Each one becomes a tool the AI can call.
import { z } from "zod";
import pathfinderPkg from "mineflayer-pathfinder";
import { bot, getPlayer, isHostile, events } from "./bot.js";
import { remember, forget } from "./memory.js";

const { goals } = pathfinderPkg;

// Long-running jobs (following, mining...) run in the background.
let task = null; // { name, cancel }
export const currentTask = () => task?.name || null;

function stopEverything() {
  if (task?.cancel) task.cancel();
  task = null;
  bot.pathfinder.setGoal(null);
  bot.pvp.stop();
  bot.collectBlock?.cancelTask?.().catch?.(() => {});
}

function startTask(name, run, cancel) {
  stopEverything();
  const me = { name, cancel };
  task = me;
  Promise.resolve()
    .then(run)
    .then((result) => {
      if (task !== me) return; // replaced by another task
      task = null;
      if (result) events.emit("game_event", `Task finished: ${name}. ${result}`);
    })
    .catch((err) => {
      if (task !== me) return;
      task = null;
      events.emit("game_event", `Task failed: ${name}. Reason: ${err.message}`);
    });
}

function playerEntity(name) {
  const p = name ? bot.players[name] : getPlayer();
  if (!p) throw new Error(name ? `${name} isn't online.` : "The player isn't online.");
  if (!p.entity) throw new Error(`${p.username} is too far away to see. Ask them to come closer or share coordinates.`);
  return p.entity;
}

function findItem(name) {
  const n = name.toLowerCase().replace(/ /g, "_");
  return bot.inventory.items().find((i) => i.name === n) || bot.inventory.items().find((i) => i.name.includes(n));
}

const defs = [
  {
    name: "follow_player",
    description: "Keep following the player around (or another player by name). Runs until you do something else or stop.",
    schema: z.object({
      player: z.string().optional().describe("Username to follow. Leave empty for your main player."),
      distance: z.number().min(1).max(10).optional().describe("How close to stay, in blocks. Default 3."),
    }),
    run: ({ player, distance = 3 }) => {
      const target = playerEntity(player);
      startTask(`following ${target.username}`, () => new Promise(() => {}), () => {});
      bot.pathfinder.setGoal(new goals.GoalFollow(target, distance), true);
      return `Now following ${target.username}.`;
    },
  },
  {
    name: "come_to_player",
    description: "Walk over to the player once, then stop.",
    schema: z.object({ player: z.string().optional() }),
    run: ({ player }) => {
      const target = playerEntity(player);
      const p = target.position;
      startTask(`walking to ${target.username}`, async () => {
        await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2));
        return "Arrived next to the player.";
      });
      return `On my way to ${target.username}.`;
    },
  },
  {
    name: "go_to",
    description: "Walk to specific coordinates.",
    schema: z.object({ x: z.number(), y: z.number().optional(), z: z.number() }),
    run: ({ x, y, z: zz }) => {
      startTask(`walking to ${x} ${y ?? "?"} ${zz}`, async () => {
        const goal = y === undefined ? new goals.GoalXZ(x, zz) : new goals.GoalNear(x, y, zz, 1);
        await bot.pathfinder.goto(goal);
        return "Arrived.";
      });
      return "Heading there.";
    },
  },
  {
    name: "stop",
    description: "Stop whatever you're doing (following, mining, fighting) and stand still.",
    schema: z.object({}),
    run: () => {
      stopEverything();
      return "Stopped.";
    },
  },
  {
    name: "mine_blocks",
    description: "Find and mine/collect blocks of a type nearby, e.g. oak_log, stone, iron_ore, coal_ore, dirt. Uses Minecraft block IDs.",
    schema: z.object({
      block: z.string().describe("Minecraft block id, e.g. oak_log, cobblestone, iron_ore"),
      count: z.number().int().min(1).max(64).optional().describe("How many. Default 8."),
    }),
    run: ({ block, count = 8 }) => {
      const name = block.toLowerCase().replace(/ /g, "_");
      const type = bot.registry.blocksByName[name];
      if (!type) throw new Error(`"${block}" isn't a block id I know.`);
      // Logs: accept any wood type if asked for "log".
      const ids = name === "log" || name.endsWith("_log")
        ? Object.values(bot.registry.blocksByName).filter((b) => b.name.endsWith("_log")).map((b) => b.id)
        : [type.id];
      const blocks = bot.findBlocks({ matching: ids, maxDistance: 48, count });
      if (!blocks.length) throw new Error(`No ${name} within 48 blocks.`);
      let cancelled = false;
      startTask(`mining ${count} ${name}`, async () => {
        let got = 0;
        for (const pos of blocks) {
          if (cancelled) return null;
          const b = bot.blockAt(pos);
          if (!b || !ids.includes(b.type)) continue;
          try {
            await bot.collectBlock.collect(b);
            got++;
          } catch (e) {
            if (cancelled) return null;
          }
        }
        return `Collected ${got} ${name}.`;
      }, () => { cancelled = true; });
      return `Going to mine ${Math.min(count, blocks.length)} ${name} (found ${blocks.length} nearby).`;
    },
  },
  {
    name: "attack",
    description: "Fight a mob or the nearest hostile monster.",
    schema: z.object({
      target: z.string().optional().describe("Mob name like zombie, or leave empty for the nearest hostile mob."),
    }),
    run: ({ target }) => {
      const t = target?.toLowerCase().replace(/ /g, "_");
      const enemy = bot.nearestEntity((e) =>
        e !== bot.entity && e.position.distanceTo(bot.entity.position) < 24 &&
        (t ? e.name === t || e.username === target : isHostile(e)));
      if (!enemy) throw new Error(`No ${target || "hostile mob"} nearby.`);
      equipBestWeapon();
      startTask(`fighting ${enemy.name}`, () => new Promise((resolve) => {
        bot.pvp.attack(enemy);
        const done = () => { bot.removeListener("stoppedAttacking", done); resolve(`The ${enemy.name} is dealt with.`); };
        bot.on("stoppedAttacking", done);
      }), () => bot.pvp.stop());
      return `Attacking the ${enemy.name}!`;
    },
  },
  {
    name: "guard_player",
    description: "Bodyguard mode: follow the player and automatically fight any hostile mob that gets close to them.",
    schema: z.object({}),
    run: () => {
      const target = playerEntity();
      let timer;
      startTask(`guarding ${target.username}`, () => new Promise(() => {
        timer = setInterval(() => {
          if (bot.pvp.target) return;
          const enemy = bot.nearestEntity((e) => isHostile(e) && e.position.distanceTo(target.position) < 10);
          if (enemy) {
            equipBestWeapon();
            bot.pvp.attack(enemy);
          } else if (!bot.pathfinder.goal) {
            bot.pathfinder.setGoal(new goals.GoalFollow(target, 3), true);
          }
        }, 500);
        bot.pathfinder.setGoal(new goals.GoalFollow(target, 3), true);
      }), () => clearInterval(timer));
      return "Guard mode on.";
    },
  },
  {
    name: "give_item",
    description: "Walk to the player and toss them items from your inventory.",
    schema: z.object({
      item: z.string().describe("Item id, e.g. oak_log, bread"),
      count: z.number().int().min(1).optional().describe("How many. Default: all of them."),
    }),
    run: ({ item, count }) => {
      const it = findItem(item);
      if (!it) throw new Error(`I don't have any ${item}.`);
      const target = playerEntity();
      startTask(`giving ${it.name}`, async () => {
        const tp = target.position;
        await bot.pathfinder.goto(new goals.GoalNear(tp.x, tp.y, tp.z, 2));
        await bot.lookAt(target.position.offset(0, 1.6, 0));
        const total = bot.inventory.items().filter((i) => i.type === it.type).reduce((s, i) => s + i.count, 0);
        await bot.toss(it.type, null, Math.min(count ?? total, total));
        return `Gave ${it.name} to the player.`;
      });
      return `Bringing you ${it.name}.`;
    },
  },
  {
    name: "craft",
    description: "Craft an item, e.g. oak_planks, stick, crafting_table, wooden_pickaxe, torch. Uses a crafting table if one is nearby.",
    schema: z.object({
      item: z.string(),
      count: z.number().int().min(1).max(64).optional().describe("How many times to craft the recipe. Default 1."),
    }),
    run: async ({ item, count = 1 }) => {
      const name = item.toLowerCase().replace(/ /g, "_");
      const type = bot.registry.itemsByName[name];
      if (!type) throw new Error(`"${item}" isn't an item id I know.`);
      const tableId = bot.registry.blocksByName.crafting_table.id;
      const table = bot.findBlock({ matching: tableId, maxDistance: 32 });
      const recipe = bot.recipesFor(type.id, null, 1, table)[0];
      if (!recipe) {
        const needsTable = bot.recipesAll(type.id, null, true).length > 0 && !table;
        throw new Error(needsTable ? "Need a crafting table nearby for that." : `Missing materials for ${name}.`);
      }
      if (table) await bot.pathfinder.goto(new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2));
      await bot.craft(recipe, count, table);
      return `Crafted ${name}.`;
    },
  },
  {
    name: "equip",
    description: "Hold or wear an item from your inventory (tools, weapons, armor).",
    schema: z.object({ item: z.string() }),
    run: async ({ item }) => {
      const it = findItem(item);
      if (!it) throw new Error(`I don't have ${item}.`);
      const slot = /helmet/.test(it.name) ? "head" : /chestplate|elytra/.test(it.name) ? "torso"
        : /leggings/.test(it.name) ? "legs" : /boots/.test(it.name) ? "feet" : "hand";
      await bot.equip(it, slot);
      return `Equipped ${it.name}.`;
    },
  },
  {
    name: "eat",
    description: "Eat some food from your inventory.",
    schema: z.object({}),
    run: async () => {
      const foods = bot.registry.foodsByName || {};
      const food = bot.inventory.items().filter((i) => foods[i.name]).sort((a, b) => foods[b.name].foodPoints - foods[a.name].foodPoints)[0];
      if (!food) throw new Error("No food in my inventory.");
      await bot.equip(food, "hand");
      await bot.consume();
      return `Ate ${food.name}.`;
    },
  },
  {
    name: "look_at_player",
    description: "Turn to face the player.",
    schema: z.object({}),
    run: async () => {
      const t = playerEntity();
      await bot.lookAt(t.position.offset(0, 1.6, 0));
      return "Looking at the player.";
    },
  },
  {
    name: "send_chat",
    description: "Type a message in the in-game chat (other players can see it). Only for when typing in chat makes sense, e.g. talking to other players. Your normal replies are already spoken out loud.",
    schema: z.object({ message: z.string().max(250) }),
    run: ({ message }) => {
      bot.chat(message);
      return "Sent.";
    },
  },
  {
    name: "remember",
    description: "Save something you learned about the player to long-term memory, so you still know it in future sessions. Use for personal facts, preferences, play style, goals, inside jokes, notable things you did together. Keep each fact short.",
    schema: z.object({
      fact: z.string().describe("e.g. 'Their real name is Sam', 'Hates creepers after losing a diamond pickaxe to one'"),
      category: z.enum(["about them", "likes", "dislikes", "play style", "goals", "our history", "inside jokes", "general"]).optional(),
    }),
    run: ({ fact, category }) => remember(fact, category),
  },
  {
    name: "forget",
    description: "Delete memories containing some text, when the player asks you to forget something or a memory is wrong.",
    schema: z.object({ text: z.string() }),
    run: ({ text }) => forget(text),
  },
];

function equipBestWeapon() {
  const order = ["netherite_sword", "diamond_sword", "iron_sword", "netherite_axe", "diamond_axe", "stone_sword", "iron_axe", "golden_sword", "wooden_sword", "stone_axe"];
  for (const name of order) {
    const it = findItem(name);
    if (it && it.name === name) return bot.equip(it, "hand").catch(() => {});
  }
}

// Tool definitions for the Claude API.
export const tools = defs.map((d) => {
  const { $schema, ...input_schema } = z.toJSONSchema(d.schema);
  return { name: d.name, description: d.description, input_schema, eager_input_streaming: true };
});

// Run a tool by name. Returns { ok, text }.
export async function runTool(name, input) {
  const def = defs.find((d) => d.name === name);
  if (!def) return { ok: false, text: `Unknown tool ${name}` };
  const parsed = def.schema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, text: JSON.stringify({ INVALID_JSON: JSON.stringify(input) }) };
  if (!bot?.entity && !["remember", "forget"].includes(name)) return { ok: false, text: "Not connected to the game right now." };
  try {
    return { ok: true, text: String(await def.run(parsed.data)) };
  } catch (err) {
    return { ok: false, text: err.message };
  }
}
