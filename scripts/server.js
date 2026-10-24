// Downloads and runs a local Minecraft server the buddy can join.
// Usage: npm run server            (newest version the buddy supports)
//        npm run server -- 1.21.11 (a specific version)
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import mineflayer from "mineflayer";

const version = process.argv[2] || mineflayer.latestSupportedVersion;
const dir = path.resolve("minecraft-server", version);
fs.mkdirSync(dir, { recursive: true });
const jar = path.join(dir, "server.jar");

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

if (!fs.existsSync(jar)) {
  console.log(`Downloading the official Minecraft ${version} server...`);
  const manifest = await getJson("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
  const v = manifest.versions.find((x) => x.id === version);
  if (!v) throw new Error(`Minecraft version ${version} not found.`);
  const info = await getJson(v.url);
  const r = await fetch(info.downloads.server.url);
  fs.writeFileSync(jar, Buffer.from(await r.arrayBuffer()));
  console.log("Downloaded.");
}

fs.writeFileSync(path.join(dir, "eula.txt"), "# You agree to the Minecraft EULA: https://aka.ms/MinecraftEULA\neula=true\n");
const propsFile = path.join(dir, "server.properties");
if (!fs.existsSync(propsFile)) {
  fs.writeFileSync(propsFile, [
    "online-mode=false", // lets the buddy join without its own Microsoft account
    "server-ip=127.0.0.1", // only reachable from this PC
    "motd=Me and my AI buddy",
    "spawn-protection=0",
    "difficulty=normal",
    "",
  ].join("\n"));
}

// Find Java: the copy bundled with the Minecraft Launcher works.
function findJava() {
  const exe = process.platform === "win32" ? "java.exe" : "java";
  const roots = [];
  if (process.env.JAVA_HOME) roots.push(process.env.JAVA_HOME);
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA || "";
    const local = process.env.LOCALAPPDATA || "";
    roots.push(
      path.join(appdata, ".minecraft", "runtime"),
      path.join(local, "Packages", "Microsoft.4297127D64EC6_8wekyb3d8bbwe", "LocalCache", "Local", "runtime"),
      "C:\\Program Files (x86)\\Minecraft Launcher\\runtime",
    );
  } else if (process.platform === "darwin") {
    roots.push(path.join(os.homedir(), "Library", "Application Support", "minecraft", "runtime"));
  } else {
    roots.push(path.join(os.homedir(), ".minecraft", "runtime"));
  }
  const found = [];
  const walk = (d, depth) => {
    if (depth > 6 || !fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === exe && path.basename(d) === "bin") found.push(p);
    }
  };
  roots.forEach((r) => walk(r, 0));
  if (spawnSync(exe, ["-version"]).status === 0) found.push(exe);
  // Pick the newest Java version available.
  const major = (j) => {
    const out = spawnSync(j, ["-version"], { encoding: "utf8" }).stderr || "";
    const m = out.match(/version "(\d+)/);
    return m ? Number(m[1]) : 0;
  };
  return found.map((j) => ({ j, v: major(j) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v)[0]?.j || null;
}

const java = findJava();
if (!java) {
  console.error("Couldn't find Java. Open the Minecraft Launcher and play once (it installs Java), or install Java 25 from https://adoptium.net");
  process.exit(1);
}
console.log(`Using Java: ${java}`);
console.log(`Starting Minecraft ${version} server. In Minecraft, pick version ${version}, then Multiplayer > Direct Connection > localhost`);
console.log("Type 'stop' here to shut it down.\n");
const proc = spawn(java, ["-Xmx2G", "-jar", "server.jar", "nogui"], { cwd: dir, stdio: "inherit" });
proc.on("exit", (code) => {
  if (code) console.error(`Server stopped (code ${code}). If it says the Java version is too old, install Java 25 from https://adoptium.net`);
  process.exit(code ?? 0);
});
