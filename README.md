# AI Buddy

An AI friend that joins your Minecraft world as its own player, talks with you over voice, and remembers you between sessions.

- **Talk to it out loud.** It hears you with Whisper and answers in a natural voice with Kokoro. Both run free on your PC.
- **It plays with you.** It follows you, mines, fights mobs, guards you, crafts, and gives you items.
- **It gets to know you.** It saves what it learns about you (name, likes, play style, inside jokes, what you did together) and brings it up in later sessions.
- **Its brain is Claude.** That's the only part that costs anything, and it uses your Claude API credits.

## What you need

- Windows PC (Mac and Linux work too)
- **Minecraft Java Edition**
- **Node.js 22 or newer**, from https://nodejs.org (pick "LTS")
- A **Claude API key** from https://console.anthropic.com > API Keys
- Chrome or Edge, for the voice page
- Headphones (recommended, so the buddy doesn't hear itself)

## Setup (one time)

1. Download this project. Use the green **Code** button > **Download ZIP**, then unzip it. Or run `git clone https://github.com/roboy2911/ai-buddy`.
2. Open the folder, click the address bar, type `cmd`, and press Enter. A terminal opens in that folder.
3. Install it:
   ```
   npm install
   ```
4. Make your settings file:
   ```
   copy .env.example .env
   notepad .env
   ```
   Set `ANTHROPIC_API_KEY` to your key and `PLAYER_NAME` to your Minecraft username. Save and close.
   Never share this file or upload it anywhere. It's already excluded from git.

## Playing

You need three things running: a Minecraft server, the buddy, and Minecraft itself.

**1. Start the Minecraft server** (in one terminal):
```
npm run server
```
The first time, this downloads the official Minecraft server. It uses the Java that comes with the Minecraft Launcher, so you don't need to install Java. It prints the Minecraft version to use (currently **26.1**, the newest the buddy supports).

**2. Start the buddy** (in a second terminal, same folder):
```
npm start
```
The first start downloads the voice and hearing models (about 250 MB). After that it's fast.

**3. Open the voice page.** Go to http://localhost:3000 in Chrome or Edge, click **Start voice chat**, and allow the microphone. Keep that tab open; it works in the background while you play.

**4. Join in Minecraft.** In the Minecraft Launcher, go to **Installations** > **New installation**, pick version **26.1**, and play it. Then go to **Multiplayer** > **Direct Connection** > `localhost`.

Your buddy will be in the world. Say hi.

### Things to try

- "Follow me" / "Stop" / "Come here"
- "Get me some wood" / "Mine some iron"
- "Protect me" (bodyguard mode) / "Kill that zombie"
- "Make a crafting table" / "Give me your logs"
- "My favorite mob is the axolotl, remember that"
- "What do you remember about me?"

You can also type in Minecraft chat, or in the box on the voice page.

When you're done, press **Ctrl+C** in the buddy's terminal. It saves a summary of the session to its memory before it closes.

## Settings (`.env`)

| Setting | What it does |
|---|---|
| `BOT_NAME` | The buddy's in-game name |
| `VOICE` | Voice to use: `am_michael`, `am_adam`, `af_heart`, `af_bella`, `bm_george`, `bf_emma`, and [more](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX#voicesamples) |
| `VOICE_SPEED` | Talking speed (1.0 is normal) |
| `EFFORT` | How hard the brain thinks. `low` gives the fastest replies; `medium` and `high` are smarter but slower and use more credits |
| `TTS_DEVICE` / `STT_DEVICE` | `auto` (default): hearing runs on your graphics card on Windows, and the voice runs on your graphics card inside the voice page (Chrome or Edge). Both fall back to the CPU if that fails. `cpu` forces the CPU |
| `DEBUG_TIMING` | Set to `1` to print how long hearing and speaking take |
| `WHISPER_MODEL` | Use `onnx-community/whisper-small.en` if it mishears you a lot (slower) |
| `MC_HOST` / `MC_PORT` | Where the Minecraft server is |

On the voice page, use the **Sensitivity** slider if it misses you or picks up background noise. The orange line is the "you're talking" level. Tick **I'm wearing headphones** if you want to be able to talk over the buddy.

## Memory

Everything it remembers is in `data/memory.json`. You can open it in Notepad to read or edit it, or delete it to start fresh. You can also tell the buddy to forget something.

## Other ways to connect

- **Your own singleplayer world:** "Open to LAN" worlds require a real Microsoft account for every player. Either install a mod that turns off online mode for LAN (for example "LAN World Plug-n-Play"), or use the next option.
- **A second Minecraft account:** set `BOT_AUTH=microsoft` and the buddy will ask you to log in with that account the first time.
- **A friend's server:** works if the server has `online-mode=false`, or with `BOT_AUTH=microsoft`.

## Credits and costs

The voice and hearing run on your PC and are free. Every time the buddy thinks, it uses Claude credits. Using prompt caching and `EFFORT=low` keeps that cheap, but long sessions add up, so keep an eye on your usage at https://console.anthropic.com.

## Troubleshooting

- **"Couldn't join"**: start `npm run server` first, and check that the server says "Done".
- **Version mismatch / can't connect in Minecraft**: play the exact version `npm run server` printed.
- **It doesn't hear me**: check the mic level bar moves when you talk, and raise the sensitivity.
- **It hears itself**: use headphones, or untick "I'm wearing headphones".
- **"My brain can't log in"**: check `ANTHROPIC_API_KEY` in `.env`.
