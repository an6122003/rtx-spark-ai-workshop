<div align="center">

<img src="docs/images/rtx/home.jpg" alt="The studio page on an RTX Spark laptop: “Everything runs here.” next to a live drawing of the chip" width="100%">

# RTX Spark AI Workshop

**Fine-tuning, RAG, an AI agent and enterprise batch jobs, running entirely on one NVIDIA RTX Spark laptop.**<br>
One PowerShell command installs and checks everything. One bilingual web app runs the whole session, with no cloud calls.

![NVIDIA RTX Spark](https://img.shields.io/badge/NVIDIA-RTX%20Spark%20·%20N1X-76B900?logo=nvidia&logoColor=white)
![Windows 11 on Arm](https://img.shields.io/badge/Windows%2011-on%20Arm-0078D4)
![Ollama](https://img.shields.io/badge/Ollama-Nemotron%20·%20Qwen-111111)
![llama.cpp](https://img.shields.io/badge/llama.cpp-batch%20engine-1f6feb)
![Offline](https://img.shields.io/badge/works-offline%20after%20setup-2ea44f)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)

by **[An À Ha](https://annguyen.work)** · Engineer & AI Product Builder · Tech & AI Creator

</div>

---

## Highlights

- **From a new laptop to a checked demo with one command.** No administrator rights, Developer Mode or WSL. The installer sets up Ollama, Python, NVIDIA's CUDA build of PyTorch for Windows on Arm, llama.cpp and about 58 GB of models. It trains the example model once, runs every lab end to end and adds a desktop shortcut. Running it again updates the files and skips finished steps, so an update takes under a minute.
- **Three hands-on labs**, each with a live before-and-after comparison: a LoRA fine-tune on the laptop's GPU in about 40 seconds, RAG over 28 technical manuals, and an agent that turns a spreadsheet into a chart and an Excel report.
- **Enterprise batch AI, measured rather than claimed.** 2,400 customer messages, 1,000 scanned invoices and 300 recorded calls run as real background jobs. Every item has an answer key, so the page shows live accuracy, throughput, GPU energy and the cost compared with cloud APIs.
- **A page made for the machine.** The studio page shows the RTX Spark itself. NVIDIA's specifications sit next to a drawing of the chip that lights up with the GPU's real work, and next to what the laptop is doing right now. Vietnamese and English, no event branding, and no internet needed after setup.

## Quick start

On the RTX Spark, open **PowerShell** (no administrator rights needed) and paste:

```powershell
irm https://raw.githubusercontent.com/an6122003/rtx-spark-ai-workshop/main/install.ps1 | iex
```

It downloads the workshop into `~\ai-workshop`, runs `windows\setup.ps1` (install, download, train, check every lab) and opens the app at `http://127.0.0.1:8090`. Plug in the charger and keep the lid open while it installs; it keeps the laptop awake by itself. After that:

- **Start:** double-click **RTX Spark Workshop** on the desktop (or in the Start menu).
- **Update:** run the same command again. The downloaded models are kept.
- **Stop everything:** `powershell -ExecutionPolicy Bypass -File "$HOME\ai-workshop\windows\stop.ps1"`

Laptops that only run the hands-on labs can skip the batch demos (about 25 GB):

```powershell
$env:WORKSHOP_SKIP_ENTERPRISE = 1; irm https://raw.githubusercontent.com/an6122003/rtx-spark-ai-workshop/main/install.ps1 | iex
```

A non-technical operator should start with [START-HERE-WINDOWS.md](START-HERE-WINDOWS.md) (Vietnamese and English).

## The machine, up close

<img src="docs/images/rtx/machine.jpg" alt="The home page's RTX Spark section: the specifications on the left; on the right the chip zoomed onto its memory, above a live map of the models in memory" width="100%">

The home page has a section on the laptop itself. It lists NVIDIA's specifications for the RTX Spark: 6,144 CUDA cores, a 20-core Grace CPU, 128 GB of unified LPDDR5X, 1 petaflop of AI, the NPU and 45–80 W. Each one is tied to a block of the chip drawn behind the page. Pick one and the chip flies onto that block, next to what this machine reports right now: GPU load, temperature and clock, the computer's maker and model, the driver and CUDA version, power draw, and a map of memory with one square per GB showing which models are loaded. Left alone, the section tours the chip by itself. The original event page is still there at `/classic`.

## The hands-on labs

| | Lab | What the audience sees |
|---|---|---|
| 01 | **Fine-tuning local LLMs** · [hands-on-1-finetune](hands-on-1-finetune/) | LoRA on Qwen2.5-1.5B with PyTorch on the laptop's GPU (55 steps in about 40 s), a live loss curve, export to GGUF, `ollama create`, then the same question to the model before and after |
| 02 | **RAG on the laptop** · [hands-on-2-rag](hands-on-2-rag/) | 28 technical manuals of a fictional energy company, searched through a local `qwen3-embedding` index; answers cite their passages, with traps for look-alike products and withdrawn safety rules |
| 03 | **An agentic workflow** · [hands-on-3-agent](hands-on-3-agent/) | "Analyse sales by region…" → the agent (NVIDIA Nemotron 3.5 Lightning on Ollama) reads the Excel file and calls Python tools (pandas, matplotlib, openpyxl) → a chart, the insight and an Excel report in 10–15 s, every step traced live |
| 04 | **Enterprise: AI on the night shift** | three batch jobs that companies pay people or cloud APIs to do every day, [below](#enterprise-ai-on-the-night-shift) |

<table>
<tr>
<td width="50%"><img src="docs/images/rtx/lab1.jpg" alt="Lab 1: the base model guesses a torque; the fine-tuned model answers 25 Nm and names its source document"><br><sub><b>01 Fine-tuning.</b> Same question, before and after a 40-second LoRA run.</sub></td>
<td width="50%"><img src="docs/images/rtx/lab2.jpg" alt="Lab 2: without RAG the model gives the withdrawn 5-minute rule; with RAG it gives the current 12-minute rule and its source"><br><sub><b>02 RAG.</b> Without documents the model repeats a withdrawn rule. With RAG it cites the current one.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/images/rtx/lab3.jpg" alt="Lab 3: the model alone asks for data; the agent with tools names the fastest-growing region, with a chart and an Excel report"><br><sub><b>03 Agent.</b> Four tool calls on the laptop: findings, a chart and an Excel report.</sub></td>
<td width="50%"><img src="docs/images/rtx/ent.jpg" alt="The Enterprise chapter: AI on the night shift, with the batch engine and the GPU's live state"><br><sub><b>04 Enterprise.</b> Batch AI over thousands of items, with live accuracy and cost.</sub></td>
</tr>
</table>

## Enterprise: AI on the night shift

For the business session: three jobs run as real batches over invented data for the fictional retailer **Aurora Mart**. The point is the economics. The data never leaves the company, there is no per-item fee, and one laptop gets through hours of work while the room watches.

| Job | Input | What the AI does | On an RTX Spark |
|---|---|---|---|
| **Inbox triage** | 2,400 messages (email, Zalo, Messenger), with typos, no diacritics and chat shorthand | topic, urgency under the company's own policy, sentiment, red flags, order number; a draft reply for critical ones; phones and e-mails masked | 300 messages in about 4 minutes (about 80 a minute) |
| **Invoices → Excel** | 1,000 scanned VAT invoices from 24 suppliers (three templates, stamps, blur, tilt) | reads every field and line with a vision model, then checks the arithmetic and catches duplicates before they are paid twice | 100 invoices in about 10 minutes: start the batch before you talk about it |
| **Call quality** | 300 recorded calls, agent and customer on separate channels, about 4 hours of audio | Vietnamese speech-to-text with VinAI's PhoWhisper on the GPU, then the QA checklist: greeting, recording notice, identity check, empathy, outcome, closing, violations | 30 calls in about 4 minutes |

The batch engine is llama.cpp's `llama-server` with Qwen3.6-35B-A3B (a 4-bit GGUF that also reads images), working on 32 items at a time; Ollama answers one request at a time. The engine starts on demand, about 30 seconds the first time, and stops itself after 30 idle minutes to give its memory back to the labs. Any job can also run on Ollama, for a side-by-side comparison.

## What setup does

| # | Step | Notes |
|---|---|---|
| 1 | Check the computer | Windows 11 on Arm, the NVIDIA GPU and its driver, memory, disk, internet; warns about Smart App Control and running on battery, and keeps the laptop awake until it finishes |
| 2 | Python | `uv` with Python 3.13 for Arm64, in the workshop's own folder |
| 3 | Ollama | a pinned release unpacked into the workshop folder, so it cannot update itself before an event |
| 4 | Models | `nemotron-3.5-lightning:30b-a3b`, `qwen3-embedding:4b`, `qwen2.5:1.5b-instruct`; a 32,768-token context for the chat model |
| 5 | Lab 1 | NVIDIA's CUDA build of PyTorch for Windows on Arm, llama.cpp's GGUF converter, the base model cached for offline training; trains `aurora-assistant` once |
| 6 | Lab 2 | builds the document index (82 passages) with the embedding model |
| 7 | Enterprise | about 25 GB: llama.cpp with CUDA, the Qwen3.6-35B-A3B GGUF and its vision projector, Piper with a Vietnamese voice, PhoWhisper; generates the messages, invoices and recorded calls, then checks the batch engine once |
| 8 | Final check | runs every lab end to end with the real models, prints a summary and adds the desktop shortcut |

Every step checks the real state first, so running it again is safe. Everything is logged to `setup-log.txt` in the workshop folder. Options, set before the command:

| | |
|---|---|
| `$env:WORKSHOP_DIR` | install folder (default `~\ai-workshop`) |
| `$env:WORKSHOP_SKIP_ENTERPRISE = 1` | skip the batch demos |
| `$env:WORKSHOP_CHECK_ONLY = 1` | inspect the laptop, change nothing |
| `$env:WORKSHOP_YES = 1` · `$env:WORKSHOP_NO_START = 1` | no pause for the third-party software notice · do not open the app at the end |
| `$env:WORKSHOP_BRANCH` | a branch or a full commit id to install instead of `main` |

Settings such as the models and ports live in [workshop.env](workshop.env); put your own values in `workshop.local.env` next to it.

## Requirements and verified runs

- An **NVIDIA RTX Spark** PC with Windows 11 and a current NVIDIA driver; internet for setup only.
- About **70 GB** free. About 58 GB is downloaded: 40 minutes on a fast connection, up to 2 hours on a slow one.

Verified on an ASUS ProArt P16 (NVIDIA RTX Spark N1X, 128 GB, Windows 11 build 28000, driver 617.69). The first install took 38 minutes on about 350 Mbit/s with all four parts ready, and an update takes about 40 seconds. Measured during a session:

| | |
|---|---|
| Lab 1 | 55 training steps in about 40 s; the whole run, with the GGUF export, about 1.5 minutes |
| Lab 2 | answers in a few seconds |
| Lab 3 | the agent finishes in 10–15 s |
| Enterprise | 300 messages ≈ 4 min · 100 invoices ≈ 10 min · 30 calls ≈ 4 min |

Every change is also tested on GitHub's Windows-on-Arm machines (CPU only, small models) by [.github/workflows/windows.yml](.github/workflows/windows.yml): the one command, setup, every lab, and both pages in Edge.

## The DGX Spark edition

The same labs first ran on an NVIDIA DGX Spark (Linux), with a NemoClaw sandbox, an OpenClaw build challenge and a vLLM batch engine: **[an6122003/nemoclaw-rag-demo](https://github.com/an6122003/nemoclaw-rag-demo)**. This repository grew out of it. It keeps that edition's Linux files (`install.sh`, `setup.sh`, `scripts/`, [START-HERE.md](START-HERE.md)) so fixes to the shared labs can move between the two; on Windows only `install.ps1` and `windows\` run.

## Repository layout

```
install.ps1 · windows\           the installer, and setup.ps1 · start.ps1 · stop.ps1 · lib.ps1
START-HERE-WINDOWS.md            operator guide (VI/EN)
app\                             the web app: server.py, studio.html (served at /) and index.html (/classic),
                                 one module per lab, enterprise.py (batch jobs, engine, scoring)
app\static\studio\               the studio page: studio.js, die.js (the chip), studio.css, i18n.js
hands-on-1-finetune\             train_lora.py · run_finetune.py · data\
hands-on-2-rag\                  corpus\ (28 manuals) · index\ · ingestion\ · verification\
hands-on-3-agent\                tools\ · data\ (the sales workbook)
enterprise\generate\             seeded generators: inbox.py · invoices.py · calls.py
workshop.env                     settings: models, ports, the pinned Windows versions
install.sh · setup.sh · scripts\ the DGX Spark edition's files, kept in step with it
```

## Credits and licences

The workshop code is Apache-2.0 ([LICENSE](LICENSE)). It downloads, and does not include, third-party software and models, each under its own licence: Ollama, uv, Python, PyTorch, llama.cpp, NVIDIA Nemotron and Qwen models, VinAI's PhoWhisper (BSD-3-Clause), and Piper TTS (GPL-3.0, installed in its own environment) with the `vi_VN-vais1000` voice (trained on the VAIS-1000 corpus, CC BY 4.0). Bundled: Plus Jakarta Sans and JetBrains Mono (the studio page) and Be Vietnam Pro and Saira (the classic page), all under the SIL Open Font License, and GSAP (GreenSock's standard no-charge licence). All companies, people and data in the labs and demos are invented.

NVIDIA, the NVIDIA logo, RTX, Grace, Blackwell and Nemotron are trademarks and/or registered trademarks of NVIDIA Corporation in the U.S. and other countries. Windows is a trademark of the Microsoft group of companies. ASUS and ProArt are trademarks of ASUSTeK Computer Inc. Other names may be trademarks of their respective owners.

## About

Designed and built by **An À Ha** (An · @anndaynee), Engineer & AI Product Builder and Tech & AI Creator. Want to work together? Write to **[annnguyen612@gmail.com](mailto:annnguyen612@gmail.com)**.

[annguyen.work](https://annguyen.work) · [Work with me](https://annguyen.work/proposal/) · [LinkedIn](https://linkedin.com/in/an-nguyen-quoc) · [GitHub @an6122003](https://github.com/an6122003) · [YouTube @anndaynee](https://www.youtube.com/@anndaynee) · [TikTok @anndaynee](https://www.tiktok.com/@anndaynee)
