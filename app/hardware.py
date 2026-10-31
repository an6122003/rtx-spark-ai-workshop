#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""What this computer can run: its hardware, and the chat models that fit it.

The workshop no longer assumes a 128 GB RTX Spark. It reads the machine (the
NVIDIA GPU and its memory, or memory shared with the CPU, the RAM and the free
disk), works out how much memory a model may use, and marks each model of the
catalog below:

    fits     runs entirely on the GPU (or in unified memory): recommended range
    slow     runs, but part of it on the CPU (a discrete GPU too small for it,
             or no NVIDIA GPU at all): allowed, with a warning
    too_big  more than this machine can hold: cannot be downloaded or used
    no_disk  would fit in memory, but not on the disk

The setup (windows/setup.ps1) asks this module which model to install, and the
studio page (Models section) lets the presenter download and switch models,
never beyond what the machine can hold.

    python app/hardware.py            # what this machine is, and the plan, readable
    python app/hardware.py --json     # the same as JSON (setup.ps1 reads it)
    python app/hardware.py --context qwen3:8b   # the context window that model gets here

Standard library only.
"""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common  # noqa: E402

GB = 1024 ** 3

# --------------------------------------------------------------------------
# The catalog. Chat models in order of preference: the best one that fits is
# the recommendation. Every one calls tools (Hands-on 3) and answers
# Vietnamese. size_gb: the download (Ollama's 4-bit build); kv_gb: the memory
# its context cache takes at 32,768 tokens (half that at 16,384).
# --------------------------------------------------------------------------
CHAT_CATALOG = [
    {"id": "nemotron-3.5-lightning:30b-a3b", "name": "Nemotron 3.5 Lightning", "maker": "NVIDIA",
     "params": "30B · MoE 3B active", "size_gb": 25.0, "kv_gb": 1.0, "nvidia": True},
    {"id": "qwen3.6:35b", "name": "Qwen 3.6 35B", "maker": "Alibaba Qwen",
     "params": "35B · MoE 3B active", "size_gb": 24.0, "kv_gb": 1.5},
    {"id": "qwen3:30b", "name": "Qwen3 30B", "maker": "Alibaba Qwen",
     "params": "30B · MoE 3B active", "size_gb": 19.0, "kv_gb": 3.2},
    {"id": "qwen3:14b", "name": "Qwen3 14B", "maker": "Alibaba Qwen",
     "params": "14B", "size_gb": 9.3, "kv_gb": 5.4},
    {"id": "qwen3:8b", "name": "Qwen3 8B", "maker": "Alibaba Qwen",
     "params": "8B", "size_gb": 5.2, "kv_gb": 4.8},
    {"id": "qwen3:4b", "name": "Qwen3 4B", "maker": "Alibaba Qwen",
     "params": "4B", "size_gb": 2.5, "kv_gb": 4.8},
    {"id": "qwen3:1.7b", "name": "Qwen3 1.7B", "maker": "Alibaba Qwen",
     "params": "1.7B", "size_gb": 1.4, "kv_gb": 3.8},
]
# The embedding model of Hands-on 2. The checked-in index was built with the
# 4B model; the 0.6B one is for machines with little memory (setup rebuilds
# the index for it).
EMBED_CATALOG = [
    {"id": "qwen3-embedding:4b", "size_gb": 2.5, "min_ram_gb": 16},
    {"id": "qwen3-embedding:0.6b", "size_gb": 0.64, "min_ram_gb": 0},
]
CONTEXTS = (32768, 16384)  # the context a chat model gets: the larger one when it fits
RUNTIME_GB = 0.8           # Ollama's runner and compute buffers, per model
DISK_MARGIN_GB = 5         # never fill the disk to the last gigabyte
# The enterprise batch engine (llama.cpp with Qwen 3.6 35B and its vision
# part, 32 slots): about 32 GB of memory while it runs, about 25 GB of disk.
ENTERPRISE_MEM_GB = 32
ENTERPRISE_DISK_GB = 25
# GPUs that share the system's memory (the whole RAM is theirs to use).
UNIFIED_GPU = re.compile(r"spark|gb10|gb20|n1x|grace|thor|jetson|apple", re.I)


def _run(cmd: list[str], timeout: float = 6) -> str:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.stdout or ""
    except Exception:
        return ""


def _number(s: str) -> float | None:
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _ram_gb() -> float:
    """Installed memory in GB (on Windows including what the GPU reserved for itself)."""
    if common.IS_WINDOWS:
        import ctypes
        kb = ctypes.c_ulonglong(0)
        if ctypes.windll.kernel32.GetPhysicallyInstalledSystemMemory(ctypes.byref(kb)):
            return kb.value / 1024 / 1024
    if sys.platform == "darwin":
        n = _number(_run(["sysctl", "-n", "hw.memsize"]).strip())
        return n / GB if n else 0.0
    return common.memory_gb()["total"]


def _cpu_name() -> str:
    if common.IS_WINDOWS:
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as k:
                return str(winreg.QueryValueEx(k, "ProcessorNameString")[0]).strip()
        except OSError:
            return ""
    if sys.platform == "darwin":
        return _run(["sysctl", "-n", "machdep.cpu.brand_string"]).strip()
    try:
        for line in Path("/proc/cpuinfo").read_text(encoding="utf-8").splitlines():
            if line.lower().startswith("model name"):
                return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return ""


def _nvidia_gpu() -> dict:
    """The first NVIDIA GPU nvidia-smi reports (not an NPU row): name and memory in GB."""
    out = _run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
    for line in out.splitlines():
        parts = [x.strip() for x in line.split(",")]
        if len(parts) < 2 or "NPU" in parts[0].upper():
            continue
        mb = _number(parts[1])  # "[N/A]" on GPUs that share the system's memory (GB10)
        return {"name": parts[0], "vram_gb": round(mb / 1024, 1) if mb else None}
    return {}


def models_dir() -> Path:
    """Where Ollama keeps its models (the disk the downloads land on)."""
    d = os.environ.get("OLLAMA_MODELS") or common.setting("OLLAMA_MODELS", "")
    return Path(d) if d else Path.home() / ".ollama" / "models"


def _disk_free_gb() -> float:
    d = models_dir()
    while not d.exists() and d.parent != d:
        d = d.parent
    try:
        return shutil.disk_usage(d).free / GB
    except OSError:
        return 0.0


def detect() -> dict:
    """The machine, and how much memory a model may use on it."""
    ram = _ram_gb()
    gpu = _nvidia_gpu()
    cpu = _cpu_name()
    apple = sys.platform == "darwin" and platform.machine() == "arm64"
    name = gpu.get("name") or (cpu if apple else "")
    vram = gpu.get("vram_gb")
    if apple:
        kind = "unified"
    elif gpu:
        # Unified when the GPU says so by name, has no memory figure of its own, or
        # reports (nearly) the whole RAM as its own.
        shared = UNIFIED_GPU.search(name) or not vram or (ram and vram >= 0.75 * ram)
        kind = "unified" if shared else "discrete"
    else:
        kind = "cpu"

    if kind == "unified":
        # Windows (or Linux, or macOS) and the apps keep a share; the rest is the model's.
        fast = max(0.0, ram - max(6.0, 0.2 * ram))
        limit = fast
    elif kind == "discrete":
        fast = max(0.0, vram * 0.92 - 0.4)  # the display keeps a little of the GPU's memory
        limit = fast + max(0.0, 0.5 * ram - 4)  # layers that spill over run on the CPU
    else:
        fast = 0.0
        limit = max(0.0, 0.6 * ram - 2)
    return {
        "os": f"{platform.system()} {platform.release()}".strip(),
        "arch": platform.machine(),
        "cpu": cpu, "cores": os.cpu_count() or 0,
        "gpu": name, "kind": kind,
        "vram_gb": vram if kind == "discrete" else None,
        "ram_gb": round(ram, 1),
        "disk_free_gb": round(_disk_free_gb(), 1),
        "fast_gb": round(fast, 1),     # a model this size runs entirely on the GPU
        "limit_gb": round(limit, 1),   # nothing larger than this can run at all
        "models_dir": str(models_dir()),
    }


# --------------------------------------------------------------------------
# Which models fit
# --------------------------------------------------------------------------
def need_gb(m: dict, context: int = CONTEXTS[-1]) -> float:
    """Memory a chat model takes while it answers, with this much context."""
    return round(m["size_gb"] * 1.05 + m["kv_gb"] * context / 32768 + RUNTIME_GB, 1)


def embed_model_for(hw: dict) -> dict:
    return next(e for e in EMBED_CATALOG if hw["ram_gb"] >= e["min_ram_gb"])


def budgets(hw: dict) -> dict:
    """Memory left for the chat model: at full speed, and at all.

    The embedding model of Hands-on 2 stays loaded next to it (a question uses
    both), from the same memory unless a discrete GPU leaves it in the RAM.
    """
    keep = embed_model_for(hw)["size_gb"] + RUNTIME_GB
    fast = hw["fast_gb"] - (keep if hw["kind"] == "unified" else 0.0)
    limit = hw["limit_gb"] - (keep if hw["kind"] != "discrete" else 0.0)
    return {"fast_gb": round(max(0.0, fast), 1), "limit_gb": round(max(0.0, limit), 1)}


def judge(m: dict, hw: dict, installed: bool = False) -> dict:
    """One chat model on this machine: status, memory it needs, the context it gets."""
    b = budgets(hw)
    small, large = need_gb(m, CONTEXTS[-1]), need_gb(m, CONTEXTS[0])
    if small <= b["fast_gb"]:
        status = "fits"
    elif small <= b["limit_gb"]:
        status = "slow"
    else:
        status = "too_big"
    room = b["fast_gb"] if status == "fits" else b["limit_gb"]
    context = CONTEXTS[0] if large <= room else CONTEXTS[-1]
    if status != "too_big" and not installed and m["size_gb"] + DISK_MARGIN_GB > hw["disk_free_gb"]:
        status = "no_disk"
    return {"status": status, "need_gb": need_gb(m, context), "context": context}


def allowed(status: str) -> bool:
    return status in ("fits", "slow")


def recommend(rows: list[dict]) -> str:
    """The best model that runs entirely on the GPU; else the smallest that runs at all."""
    for r in rows:
        if r["status"] == "fits":
            return r["id"]
    usable = [r for r in rows if allowed(r["status"])]
    return usable[-1]["id"] if usable else ""


def enterprise_fit(hw: dict) -> dict:
    """Can the batch demos run here? (A discrete GPU would need 32 GB of its own.)"""
    if hw["kind"] == "cpu":
        return {"fits": False, "reason": "no_gpu"}
    if hw["fast_gb"] < ENTERPRISE_MEM_GB + (8 if hw["kind"] == "unified" else 0):
        return {"fits": False, "reason": "memory", "need_gb": ENTERPRISE_MEM_GB}
    if hw["disk_free_gb"] < ENTERPRISE_DISK_GB + DISK_MARGIN_GB:
        return {"fits": False, "reason": "disk", "need_gb": ENTERPRISE_DISK_GB}
    return {"fits": True, "reason": "", "need_gb": ENTERPRISE_MEM_GB}


_hw_cache: dict = {"at": 0.0, "value": None}


def machine(max_age: float = 30) -> dict:
    """detect(), cached briefly: the disk changes as models arrive, the rest does not."""
    if _hw_cache["value"] is None or time.time() - _hw_cache["at"] > max_age:
        _hw_cache.update(value=detect(), at=time.time())
    return _hw_cache["value"]


def plan(installed: set[str] | None = None, active: str = "") -> dict:
    """The machine, every catalog model judged against it, and the recommendation."""
    hw = machine()
    installed = installed if installed is not None else set()
    rows = []
    for m in CHAT_CATALOG:
        have = m["id"] in installed
        rows.append({**m, **judge(m, hw, have), "installed": have, "active": m["id"] == active})
    return {"hardware": hw, "budget": budgets(hw), "models": rows, "recommended": recommend(rows),
            "embed_model": embed_model_for(hw)["id"], "enterprise": enterprise_fit(hw)}


def catalog_entry(tag: str) -> dict | None:
    return next((m for m in CHAT_CATALOG if m["id"] == tag), None)


def context_for(tag: str) -> int:
    """The context window to give a chat model here: what fits, never above WIN_CHAT_CONTEXT."""
    most = int(common.setting("WIN_CHAT_CONTEXT", str(CONTEXTS[0])) or CONTEXTS[0])
    entry = catalog_entry(tag)
    return min(most, judge(entry, machine(), installed=True)["context"]) if entry else most


# --------------------------------------------------------------------------
# The true download size, from Ollama's registry (the catalog's is a guide)
# --------------------------------------------------------------------------
_sizes: dict[str, float] = {}


def registry_size_gb(tag: str) -> float | None:
    if tag in _sizes:
        return _sizes[tag]
    name, _, ver = tag.partition(":")
    path = name if "/" in name else f"library/{name}"
    req = urllib.request.Request(f"https://registry.ollama.ai/v2/{path}/manifests/{ver or 'latest'}",
                                 headers={"Accept": "application/vnd.docker.distribution.manifest.v2+json"})
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            man = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    total = sum(int(x.get("size") or 0) for x in man.get("layers", []))
    total += int((man.get("config") or {}).get("size") or 0)
    if total <= 0:
        return None
    _sizes[tag] = round(total / 1e9, 2)
    return _sizes[tag]


# --------------------------------------------------------------------------
# Downloading a model, in the background (one at a time)
# --------------------------------------------------------------------------
class Pull:
    """Ollama's /api/pull in a thread, with its progress, so a reload of the page loses nothing.

    A download that stalls is cancelled and started again: Ollama resumes from the
    bytes already on disk (scripts/pull-model.py does the same for the setup).
    """

    STALL_SECONDS = 90
    ATTEMPTS = 12

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.state: dict = {"model": "", "running": False}

    def snapshot(self) -> dict:
        with self.lock:
            return dict(self.state)

    def start(self, model: str, on_done=None) -> tuple[bool, str]:
        with self.lock:
            if self.state.get("running"):
                return False, "busy"
            self.state = {"model": model, "running": True, "status": "starting", "completed": 0, "total": 0,
                          "error": "", "done": False, "started": time.time()}
        threading.Thread(target=self._run, args=(model, on_done), daemon=True).start()
        return True, "started"

    def _set(self, **kw) -> None:
        with self.lock:
            self.state.update(kw)

    def _attempt(self, model: str) -> str:
        body = json.dumps({"model": model, "stream": True}).encode()
        req = urllib.request.Request(f"{common.OLLAMA}/api/pull", data=body,
                                     headers={"Content-Type": "application/json"})
        layers: dict[str, tuple[int, int]] = {}
        with urllib.request.urlopen(req, timeout=self.STALL_SECONDS) as resp:
            for raw in resp:
                line = raw.strip()
                if not line:
                    continue
                ev = json.loads(line)
                if ev.get("error"):
                    raise RuntimeError(ev["error"])
                if ev.get("status") == "success":
                    return "done"
                if ev.get("digest") and ev.get("total"):
                    layers[ev["digest"]] = (int(ev.get("completed") or 0), int(ev["total"]))
                    self._set(status="downloading", completed=sum(c for c, _ in layers.values()),
                              total=sum(t for _, t in layers.values()))
                else:
                    self._set(status=str(ev.get("status") or ""))
        return "stalled"

    def _run(self, model: str, on_done) -> None:
        error = ""
        for n in range(self.ATTEMPTS):
            try:
                if self._attempt(model) == "done":
                    error = ""
                    break
                error = "the download stopped"
            except RuntimeError as exc:  # Ollama refused (unknown model, disk full): no point retrying
                error = str(exc)[:300]
                break
            except Exception as exc:  # noqa: BLE001 - a stalled or dropped connection: resume
                error = f"{exc.__class__.__name__}: {exc}"[:300]
            self._set(status="retrying", attempt=n + 2)
            time.sleep(min(10, 2 + n))
        common.forget_models_cache()
        ok = not error and common.has_model(model)
        self._set(running=False, done=ok, status="success" if ok else "error",
                  error="" if ok else (error or "the model did not arrive"))
        _hw_cache["value"] = None  # the disk has less room now
        if ok and on_done:
            try:
                on_done(model)
            except Exception:
                pass


PULL = Pull()


# --------------------------------------------------------------------------
# Command line: for people, and for windows/setup.ps1
# --------------------------------------------------------------------------
def _installed_now() -> set[str]:
    return common.ollama_models(max_age=0) if common.ollama_up(timeout=2) else set()


def main() -> int:
    if "--context" in sys.argv[1:-1]:
        print(context_for(sys.argv[sys.argv.index("--context") + 1]))
        return 0
    p = plan(_installed_now(), common.CHAT_MODEL)
    if "--json" in sys.argv:
        print(json.dumps(p, ensure_ascii=False))
        return 0
    hw = p["hardware"]
    kind = {"unified": "unified memory (GPU and CPU share it)", "discrete": f"{hw['vram_gb']} GB on the GPU",
            "cpu": "no NVIDIA GPU: models run on the CPU"}[hw["kind"]]
    print(f"  {hw['gpu'] or 'no GPU'} · {kind}")
    print(f"  {hw['ram_gb']:.0f} GB RAM · {hw['disk_free_gb']:.0f} GB free disk · "
          f"a model may use {hw['fast_gb']:.0f} GB at full speed")
    for r in p["models"]:
        mark = {"fits": "ok  ", "slow": "slow", "too_big": "--  ", "no_disk": "disk"}[r["status"]]
        star = " *" if r["id"] == p["recommended"] else ""
        print(f"  [{mark}] {r['id']:<34} {r['size_gb']:>5.1f} GB download, needs {r['need_gb']:>5.1f} GB{star}")
    ent = p["enterprise"]
    print(f"  enterprise batch demos: {'yes' if ent['fits'] else 'no (' + ent['reason'] + ')'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
