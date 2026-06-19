# Cireeo.ai Video Script — QVAC-Pear Miner Node

## Project
**Repo:** https://github.com/TerexitariusStomp/localchimera  
**Tone:** Technical but accessible, futuristic, builder-focused  
**Target Length:** ~2 minutes  
**Style:** Codebase walkthrough / architecture explainer

---

## Scene 1: Hook (0:00–0:15)

**Visual:** Dark terminal screen. `npm start` executes. Logs stream in: `Node started successfully`, `Node ID: 02b835...`, `Dashboard API available at http://localhost:3000`.

**Narration:**
> "What if your AI inference node could earn rewards while it sleeps? Meet the QVAC-Pear Miner Node — a distributed system that serves AI requests by day, and automatically switches to multi-protocol mining by night."

**On-screen text:**
- "QVAC-Pear Miner Node"
- "Inference by Day. Mining by Night."

---

## Scene 2: The Big Idea (0:15–0:35)

**Visual:** Split-screen diagram. Left: "Inference Mode" with chat bubbles and LLM icons. Right: "Mining Mode" with blockchain logos. A central gear labeled "NodeManager" switches between them.

**Narration:**
> "Most nodes do one thing. This one does two. It runs QVAC local inference — Llama models, speech-to-text, translation — and when your machine goes idle, it seamlessly rotates across five different mining networks: Cortensor, Chutes, Fortytwo, Earnidle, and Routstr."

**On-screen text:**
- Dual Mode Operation
- 5 Mining Protocols
- Zero idle time

---

## Scene 3: Architecture Deep Dive (0:35–1:05)

**Visual:** Animated architecture diagram showing layered components. Highlight each layer as narrated.

**Narration:**
> "At the core is the NodeManager — the orchestrator. It initializes an authentication layer, a Hypercore distributed data store, and a Pear P2P network for zero-infrastructure app distribution."

> "For inference, it loads the QVAC SDK with a local LLM router. All inference requests flow through a centralized router, so every miner shares the same AI backend."

> "For mining, the MinerManager runs all five protocols in parallel monitoring mode. When a task arrives, the TaskMonitor instantly notifies every miner to free up resources."

> "And for scheduling, a TimeScheduler automatically switches between day mode — inference earning — and night mode — where the AI Writer goes idle and your machine maximizes mining across all five protocols."

**Code citation:** `src/core/NodeManager.js:34-95`

**On-screen text:**
- NodeManager
- Hypercore + Pear P2P
- QVAC Inference Layer
- MinerManager (5 protocols)
- TimeScheduler

---

## Scene 4: The Money Layer — Protocol Multisigs (1:05–1:25)

**Visual:** Flowchart. Weekly sweep arrow into EVM multisig. Monthly sweep arrow splitting 70% to "Machine Owner" and 30% to "App Developer".

**Narration:**
> "Rewards are handled by protocol-level multisigs — not per-app, but shared across the entire network. Nostr uses Cashu NIP-60. Bittensor uses Substrate. EVM chains deposit directly."

> "Funds are collected weekly into an EVM multisig, then distributed monthly — seventy percent to the machine owner, thirty percent to the app developer — with a forty-eight hour denial window for transparency."

**Code citation:** `config.json:85-124`

**On-screen text:**
- Weekly Collection → EVM Multisig
- Monthly Distribution: 70% You / 30% Dev
- 48-hour denial window

---

## Scene 5: Installation & Deployment (1:25–1:45)

**Visual:** Quick cuts — Docker terminal, a web dashboard with EVM address input, a phone PWA install prompt.

**Narration:**
> "Getting started is designed to be frictionless. Docker Compose is the recommended path — one command and you're live."

> "For end users, there's a web installer that auto-detects your OS and downloads start and stop scripts. For mobile, it's a Progressive Web App — no app store, no APK. Just visit the URL, add to home screen, and start earning."

> "For app developers, embedding is one line of HTML with an auto-install script."

**Code citation:**
- `README.md:22-32` (embed script)
- `docker-compose.yml`

**On-screen text:**
- `docker-compose up -d`
- One-line HTML embed
- PWA — no install friction

---

## Scene 6: Closing / Call to Action (1:45–2:00)

**Visual:** GitHub repo homepage. Star count animates up. Terminal shows `git clone` command.

**Narration:**
> "The QVAC-Pear Miner Node is open source under the MIT license. If you're building decentralized AI infrastructure, or you want your idle compute to actually pay for itself — this is the stack."

> "Clone it, run it, and turn your machine into a dual-purpose AI miner."

**On-screen text:**
- github.com/TerexitariusStomp/qvac-pear-miner-node
- MIT License
- Star the repo

---

## Technical Reference Sheet (for Cireeo visuals)

| Component | File Path | Purpose |
|-----------|-----------|---------|
| Entry point | `src/index.js` | Boots NodeManager, loads config |
| Orchestrator | `src/core/NodeManager.js` | Initializes all layers |
| Inference | `src/inference/QVACInferenceLayer.js` | QVAC SDK integration |
| Router | `src/inference/InferenceRouter.js` | Centralized inference for all miners |
| Storage | `src/storage/HypercoreStore.js` | Distributed append-only logs |
| P2P | `src/p2p/PearP2P.js` | Pear runtime + Hyperswarm |
| Miners | `src/miners/MinerManager.js` | 5-protocol orchestration |
| Scheduler | `src/scheduler/TimeScheduler.js` | Day/night mode switching |
| Frontend | `frontend/src/pages/AIWriter.jsx` | Mobile PWA + AI writing UI |
| Config | `config.json` | Protocol multisigs, miner wallets, splits |

## Keywords for Cireeo AI

Use these to guide auto-generated visuals:
- "peer-to-peer network mesh"
- "dark terminal with green logs"
- "blockchain flowchart, glowing nodes"
- "split screen day and night cycle"
- "AI writing interface, glowing text cursor, dark terminal"
- "Docker containers stacking"
- "abstract AI neural network visualization"
- "cryptographic key shards forming a lock"

## Voiceover Notes

- Pace: Medium-fast. This is a builder audience.
- Emphasize: "dual mode", "five protocols", "one-line embed", "seventy percent to you"
- No buzzwords like "web3 revolution" — keep it concrete.
