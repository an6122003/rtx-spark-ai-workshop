#!/usr/bin/env python3
"""DGX Spark AI Workshop — one web app for the three hands-on labs.

The same app runs on the DGX Spark (Linux) and on Windows (the RTX Spark
edition, common.EDITION == "windows", without the NemoClaw sandbox).

It serves two pages over the same API: the studio (studio.html, brand-neutral,
made for RTX Spark laptops) and the classic event page (index.html). "/" is
the studio on Windows and the classic page on the DGX Spark (WEB_UI setting);
/studio and /classic always serve one of them.

    Hands-on 1  Fine-tuning Local LLMs        (lab1_finetune.py)
    Hands-on 2  Build RAG with NemoClaw       (lab2_rag.py)
    Hands-on 3  Build an Agentic Workflow     (lab3_agent.py)
    Enterprise  Batch jobs on the box         (enterprise.py)

Standard library HTTP server. The Hands-on 3 tools need pandas, matplotlib and
openpyxl, so start it with the workshop's Python environment:

    .venv/bin/python app/server.py --open          # what ./start.sh does
    .venv/bin/python app/server.py --lan           # let other laptops connect
    .venv/Scripts/python.exe app/server.py --open  # Windows (windows/start.ps1)

Every long operation streams newline-delimited JSON, so the page shows real
progress rather than a timer.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common  # noqa: E402
import enterprise as ent  # noqa: E402
import hardware  # noqa: E402
import lab1_finetune as lab1  # noqa: E402
import lab2_rag as lab2  # noqa: E402
import lab3_agent as lab3  # noqa: E402

HERE = Path(__file__).resolve().parent
INDEX_HTML = HERE / "index.html"
STUDIO_HTML = HERE / "studio.html"
WEB_UI = common.setting("WEB_UI", "studio" if common.EDITION == "windows" else "classic")
# Logos and fonts, served from disk so the page works without internet.
STATIC = HERE / "static"
STATIC_TYPES = {".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2",
                ".png": "image/png", ".txt": "text/plain; charset=utf-8",
                ".js": "text/javascript; charset=utf-8", ".webp": "image/webp", ".jpg": "image/jpeg"}
RETRIEVAL_MODE = "auto" if common.SANDBOX_ON else "local"
MAX_UPLOAD = 25 * 1024 * 1024
EDITION_MARK = b"<!--WORKSHOP-EDITION-->"


def features() -> dict:
    """What this machine offers, so the page shows only the parts that work here."""
    return {"sandbox": common.SANDBOX_ON, "openclaw": common.SANDBOX_ON,
            "enterprise": ent.available(), "lab1_train": lab1.TRAIN_AVAILABLE,
            # Picking the chat model on the page: not with a sandbox, whose route setup fixed.
            "models": not common.SANDBOX_ON, "spark": _looks_like_spark()}


def _looks_like_spark() -> bool:
    """Show the studio's RTX Spark section unless the hardware is clearly another machine:
    a discrete GPU, a Mac, or an x64 PC without an NVIDIA GPU (the RTX Spark is Windows on Arm)."""
    hw = hardware.machine()
    other_cpu = hw["kind"] == "cpu" and hw["arch"].lower() in ("amd64", "x86_64")
    return not (hw["kind"] == "discrete" or sys.platform == "darwin" or other_cpu)


def page_config() -> bytes:
    """Edition settings inlined into the page, so its first paint already fits the machine.

    The classes on <html> hide what this edition does not have (see the
    need-sandbox / need-openclaw / need-ent rules in index.html).
    """
    cfg = {"edition": common.EDITION, "device": common.DEVICE, "features": features()}
    js = ("window.WORKSHOP=" + json.dumps(cfg) + ";(function(f,c){c.add('ed-'+window.WORKSHOP.edition);"
          "if(!f.sandbox)c.add('no-sandbox');if(!f.openclaw)c.add('no-openclaw');"
          "if(!f.enterprise)c.add('no-ent');if(!f.spark)c.add('no-spark');if(!f.models)c.add('no-models');})"
          "(window.WORKSHOP.features,document.documentElement.classList);")
    return b"<script>" + js.encode("utf-8") + b"</script>"


def _gpu_name() -> str:
    return lab1.trainer_status().get("gpu", "")


# --------------------------------------------------------------------------
# Live readout of the machine for the studio page: its chip visual follows
# the real GPU load, and its header names the hardware it runs on.
# --------------------------------------------------------------------------
_telemetry = {"at": 0.0, "value": None, "static": None}
_telemetry_lock = threading.Lock()


def _machine() -> dict:
    """What does not change while the app runs: the CPU, installed memory, the maker and
    model of the computer, and the GPU's driver, CUDA version and capabilities. Read once."""
    if _telemetry["static"] is None:
        cpu, installed, maker, model = "", common.memory_gb()["total"], "", ""
        if common.IS_WINDOWS:
            import ctypes
            import winreg
            try:
                with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as k:
                    cpu = str(winreg.QueryValueEx(k, "ProcessorNameString")[0]).strip()
            except OSError:
                pass
            try:
                with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\BIOS") as k:
                    maker = str(winreg.QueryValueEx(k, "SystemManufacturer")[0]).strip()
                    try:
                        model = str(winreg.QueryValueEx(k, "SystemFamily")[0]).strip()
                    except OSError:
                        model = str(winreg.QueryValueEx(k, "SystemProductName")[0]).strip()
            except OSError:
                pass
            kb = ctypes.c_ulonglong(0)  # memory the GPU reserved for itself included
            if ctypes.windll.kernel32.GetPhysicallyInstalledSystemMemory(ctypes.byref(kb)):
                installed = kb.value / 1024 / 1024
        else:
            try:
                for line in Path("/proc/cpuinfo").read_text(encoding="utf-8").splitlines():
                    if line.lower().startswith("model name"):
                        cpu = line.split(":", 1)[1].strip()
                        break
            except OSError:
                pass
            dmi = Path("/sys/class/dmi/id")
            try:
                maker = (dmi / "sys_vendor").read_text(encoding="utf-8").strip()
                model = (dmi / "product_name").read_text(encoding="utf-8").strip()
            except OSError:
                pass
        _telemetry["static"] = {"name": cpu, "cores": os.cpu_count() or 0, "installed_gb": round(installed),
                                "maker": maker, "model": model, **_gpu_platform()}
    return _telemetry["static"]


def _gpu_platform() -> dict:
    """Driver, CUDA version, compute capability, top GPU clock, and whether there is an NPU."""
    out = {"driver": "", "cuda": "", "compute_cap": "", "max_clock_mhz": None, "npu": False}
    try:
        p = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version,compute_cap,clocks.max.sm",
                            "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5)
        for line in (p.stdout or "").splitlines():
            parts = [x.strip() for x in line.split(",")]
            if len(parts) < 4:
                continue
            if "NPU" in parts[0].upper():
                out["npu"] = True
            elif not out["driver"]:
                out["driver"] = parts[1]
                out["compute_cap"] = parts[2] if parts[2][:1].isdigit() else ""
                out["max_clock_mhz"] = float(parts[3]) if parts[3].replace(".", "", 1).isdigit() else None
        m = re.search(r"CUDA (?:UMD )?Version:\s*([\d.]+)",
                      subprocess.run(["nvidia-smi"], capture_output=True, text=True, timeout=5).stdout or "")
        out["cuda"] = m.group(1) if m else ""
    except Exception:
        pass
    return out


def _gpu_readout() -> dict:
    fields = "name,utilization.gpu,memory.used,memory.total,power.draw,temperature.gpu"
    try:
        p = subprocess.run(["nvidia-smi", f"--query-gpu={fields}", "--format=csv,noheader,nounits"],
                           capture_output=True, text=True, timeout=4)
    except Exception:
        return {}

    def number(s: str) -> float | None:
        try:
            return float(s)
        except ValueError:
            return None

    for line in (p.stdout or "").splitlines():
        parts = [x.strip() for x in line.split(",")]
        if len(parts) == 6 and number(parts[3]) is not None:  # the GPU, not an NPU row without memory figures
            return {"name": parts[0], "util": number(parts[1]), "mem_used_mb": number(parts[2]),
                    "mem_total_mb": number(parts[3]), "power_w": number(parts[4]), "temp_c": number(parts[5])}
    return {}


def telemetry() -> dict:
    with _telemetry_lock:
        if _telemetry["value"] and time.time() - _telemetry["at"] < 1.5:
            return _telemetry["value"]
        try:
            loaded = [{"name": m.get("name"), "vram_gb": round((m.get("size_vram") or 0) / 1e9, 1)}
                      for m in common.http_json(f"{common.OLLAMA}/api/ps", timeout=2).get("models", [])]
        except Exception:
            loaded = []
        machine, mem = _machine(), common.memory_gb()
        value = {"gpu": _gpu_readout(), "cpu": {"name": machine["name"], "cores": machine["cores"]},
                 "memory": {"installed_gb": machine["installed_gb"], "available_gb": round(mem["available"], 1)},
                 "platform": {k: machine[k] for k in ("maker", "model", "driver", "cuda", "compute_cap", "max_clock_mhz", "npu")},
                 "loaded": loaded, "batch_engine": ent.available() and ent.engine_ready(timeout=0.3)}
        _telemetry.update(at=time.time(), value=value)
        return value


# --------------------------------------------------------------------------
# The chat model: what fits this machine (hardware.py), downloading one, and
# switching Labs 2 and 3 to it while the app runs.
# --------------------------------------------------------------------------
SWITCH = {"model": "", "busy": False}


def models_state(local: bool) -> dict:
    up = common.ollama_up(timeout=2)
    installed = common.ollama_models() if up else set()
    p = hardware.plan(installed, common.CHAT_MODEL)
    if not hardware.catalog_entry(common.CHAT_MODEL):  # set by hand in workshop.local.env: show it as it is
        p["models"].insert(0, {"id": common.CHAT_MODEL, "name": common.CHAT_MODEL, "maker": "", "params": "",
                               "size_gb": None, "status": "custom", "installed": common.has_model(common.CHAT_MODEL),
                               "active": True})
    p.update(ollama=up, active=common.CHAT_MODEL, active_ready=up and common.has_model(common.CHAT_MODEL),
             pull=hardware.PULL.snapshot(), switching=dict(SWITCH), can_change=local and not common.SANDBOX_ON)
    return p


def select_model(tag: str) -> tuple[bool, str]:
    """Make an installed model that fits this machine the chat model of Labs 2 and 3."""
    entry = hardware.catalog_entry(tag)
    if common.SANDBOX_ON:
        return False, "sandbox_edition"
    if not entry:
        return False, "not_in_catalog"
    common.forget_models_cache()
    if not common.has_model(tag):
        return False, "not_installed"
    fit = hardware.judge(entry, hardware.machine(), installed=True)
    if not hardware.allowed(fit["status"]):
        return False, fit["status"]
    before = common.CHAT_MODEL
    common.CHAT_MODEL = tag
    try:
        common.save_local_setting("CHAT_MODEL", tag)  # setup and start.ps1 keep it
    except OSError:
        pass

    def prepare() -> None:
        SWITCH.update(model=tag, busy=True)
        try:
            if before != tag:  # give the previous model's memory back first
                try:
                    common.http_json(f"{common.OLLAMA}/api/generate", {"model": before, "keep_alive": 0}, timeout=30)
                except Exception:
                    pass
            # Room for Hands-on 3's tool list and data preview, as setup gives it (nothing downloaded).
            subprocess.run([sys.executable, str(common.ROOT / "scripts" / "ollama-context.py"), tag, str(hardware.context_for(tag))],
                           capture_output=True, timeout=600)
            common.ollama_warm(tag)
        except Exception:
            pass
        finally:
            SWITCH.update(busy=False)

    threading.Thread(target=prepare, daemon=True).start()
    return True, "selected"


def start_pull(tag: str) -> tuple[bool, str]:
    """Download a catalog model, only if this machine can hold it; it becomes the chat model."""
    entry = hardware.catalog_entry(tag)
    if common.SANDBOX_ON:
        return False, "sandbox_edition"
    if not entry:
        return False, "not_in_catalog"
    if not common.ollama_up(timeout=3):
        return False, "ollama_off"
    common.forget_models_cache()
    if common.has_model(tag):
        return select_model(tag)
    hw = hardware.machine(max_age=0)
    real = hardware.registry_size_gb(tag)  # the registry's figure, when it answers, over the catalog's
    fit = hardware.judge({**entry, "size_gb": real or entry["size_gb"]}, hw)
    if not hardware.allowed(fit["status"]):
        return False, fit["status"]
    return hardware.PULL.start(tag, on_done=select_model)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "DGXWorkshop/1.0"

    def log_message(self, fmt, *args):  # keep the terminal readable on stage
        path = self.path or ""
        if any(p in path for p in ("/api/lab1/train", "/api/lab2/ask", "/api/lab3/run")):
            sys.stderr.write(f"  {self.command} {path.split('?')[0]}\n")

    # -- responses ----------------------------------------------------------
    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _local(self) -> bool:
        """A browser on this machine (the gateway token is only handed to those)."""
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def _json(self, code: int, obj) -> None:
        self._send(code, json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _stream_start(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

    def _chunk(self, obj: dict) -> None:
        payload = (json.dumps(obj, ensure_ascii=False, default=str) + "\n").encode("utf-8")
        self.wfile.write(b"%x\r\n%s\r\n" % (len(payload), payload))
        self.wfile.flush()

    def _stream_end(self) -> None:
        try:
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except Exception:
            pass

    def _stream(self, producer) -> None:
        """Run producer(emit) and stream every event it emits."""
        self._stream_start()
        lock = threading.Lock()
        alive = {"ok": True}

        def emit(ev: dict) -> None:
            if not alive["ok"]:
                return
            with lock:
                try:
                    self._chunk(ev)
                except (BrokenPipeError, ConnectionResetError, OSError):
                    alive["ok"] = False  # the browser went away; let the work finish quietly

        try:
            producer(emit)
        except Exception as exc:  # noqa: BLE001 - never 500 in the middle of a demo
            emit({"event": "error", "message": f"{exc.__class__.__name__}: {exc}"})
        finally:
            if alive["ok"]:
                self._stream_end()

    def _body(self, limit: int = 1_000_000) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length > limit:
            raise ValueError("request too large")
        return self.rfile.read(length) if length else b""

    def _json_body(self) -> dict:
        raw = self._body()
        return json.loads(raw.decode("utf-8") or "{}") if raw else {}

    # -- GET ------------------------------------------------------------------
    def do_GET(self):  # noqa: N802
        url = urlparse(self.path)
        path, qs = url.path, parse_qs(url.query)

        if path in ("/", "/index.html", "/studio", "/classic"):
            studio = path == "/studio" or (path != "/classic" and WEB_UI == "studio")
            page_file = STUDIO_HTML if studio else INDEX_HTML
            if not page_file.exists():
                return self._json(500, {"error": f"{page_file.name} missing"})
            page = page_file.read_bytes().replace(EDITION_MARK, page_config(), 1)
            return self._send(200, page, "text/html; charset=utf-8")

        if path.startswith("/static/"):
            f = (STATIC / unquote(path[len("/static/"):])).resolve()
            if STATIC.resolve() in f.parents and f.is_file() and f.suffix in STATIC_TYPES:
                return self._send(200, f.read_bytes(), STATIC_TYPES[f.suffix])
            return self._json(404, {"error": "not found"})

        if path == "/api/health":
            return self._json(200, health(include_token=self._local()))
        if path == "/api/telemetry":
            return self._json(200, telemetry())
        if path == "/api/models":
            return self._json(200, models_state(self._local()))

        if path == "/openclaw":  # short address for OpenClaw's own UI (the challenge)
            if not common.SANDBOX_ON:
                return self._json(404, {"error": "OpenClaw is not part of this edition"})
            if not self._local():
                return self._send(403, "Open this address on the DGX Spark itself.\n".encode(),
                                  "text/plain; charset=utf-8")
            return self._send(302, b"", "text/plain; charset=utf-8",
                              {"Location": control_ui_url(include_token=True)})

        # ---- Hands-on 1
        if path == "/api/lab1/info":
            return self._json(200, lab1.info())
        if path == "/api/lab1/prepare":
            return self._json(200, lab1.PREP.status())
        if path == "/api/lab1/stream":
            start = int((qs.get("from") or ["0"])[0] or 0)
            self._stream_start()
            try:
                for ev in lab1.JOB.follow(start):
                    self._chunk(ev)
            except (BrokenPipeError, ConnectionResetError, OSError):
                return
            return self._stream_end()

        # ---- Hands-on 2
        if path == "/api/lab2/examples":
            return self._json(200, {"examples": lab2.EXAMPLES})
        if path == "/api/lab2/corpus":
            return self._json(200, {"documents": lab2.corpus_list()})
        if path == "/api/lab2/doc":
            doc = lab2.corpus_doc((qs.get("name") or [""])[0])
            return self._json(200, doc) if doc else self._json(404, {"error": "not found"})

        # ---- Hands-on 3
        if path == "/api/lab3/info":
            return self._json(200, lab3_info((qs.get("dataset") or [""])[0]))
        m = re.fullmatch(r"/api/lab3/file/([\w\-]+)/([^/]+)", path)
        if m:
            f = lab3.output_file(m.group(1), unquote(m.group(2)))
            if not f:
                return self._json(404, {"error": "not found"})
            return self._file(f)
        if path == "/api/lab3/dataset":
            f = lab3.dataset_path((qs.get("name") or [""])[0])
            return self._file(f)

        # ---- Enterprise batch demos
        demo = (qs.get("demo") or [""])[0]
        if path == "/api/ent/summary":
            if (qs.get("active") or [""])[0] == "1":
                ent.touch_engine()  # the page is open: keep the engine up
            return self._json(200, ent.summaries())
        if path == "/api/ent/feed" and demo in ent.DEMOS:
            only = (qs.get("only") or ["all"])[0]
            limit = int(_clamp((qs.get("limit") or ["40"])[0], 1, 200, 40, int))
            return self._json(200, {"rows": ent.feed(demo, limit, only)})
        if path == "/api/ent/samples" and demo in ent.DEMOS:
            return self._json(200, {"rows": ent.sample_items(demo)})
        m = re.fullmatch(r"/api/ent/invoice/([\w.\-]+)", path)
        if m:
            f = ent.invoice_image(m.group(1))
            return self._file(f) if f else self._json(404, {"error": "not found"})
        m = re.fullmatch(r"/api/ent/call/([\w.\-]+)", path)
        if m:
            f = ent.call_audio(m.group(1))
            return self._ranged(f, "audio/wav") if f else self._json(404, {"error": "not found"})
        if path == "/api/ent/item" and demo in ent.DEMOS:
            d = ent.item_detail(demo, (qs.get("id") or [""])[0])
            return self._json(200, d) if d else self._json(404, {"error": "not found"})
        if path == "/api/ent/export" and demo in ent.DEMOS:
            if not ent.results(demo):
                return self._json(409, {"error": "nothing processed yet"})
            return self._file(ent.export_xlsx(demo))

        return self._json(404, {"error": "not found"})

    def _file(self, f: Path) -> None:
        ctype = {
            ".png": "image/png",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".csv": "text/csv; charset=utf-8",
            ".json": "application/json",
            ".jpg": "image/jpeg",
        }.get(f.suffix.lower(), "application/octet-stream")
        extra = {}
        if f.suffix.lower() in (".xlsx", ".csv"):
            # RFC 5987 so Vietnamese file names survive the download.
            from urllib.parse import quote
            extra["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(f.name)}"
        return self._send(200, f.read_bytes(), ctype, extra)

    def _ranged(self, f: Path, ctype: str) -> None:
        """Serve a media file with HTTP ranges, so the audio player can seek (Safari needs it)."""
        size = f.stat().st_size
        rng = re.fullmatch(r"bytes=(\d*)-(\d*)", (self.headers.get("Range") or "").strip())
        if not rng or (not rng.group(1) and not rng.group(2)):
            return self._send(200, f.read_bytes(), ctype, {"Accept-Ranges": "bytes"})
        if rng.group(1):
            start = int(rng.group(1))
            end = min(int(rng.group(2)) if rng.group(2) else size - 1, size - 1)
        else:  # the last N bytes
            start, end = max(0, size - int(rng.group(2))), size - 1
        if start > end or start >= size:
            return self._send(416, b"", ctype, {"Content-Range": f"bytes */{size}"})
        with f.open("rb") as fh:
            fh.seek(start)
            body = fh.read(end - start + 1)
        return self._send(206, body, ctype, {"Accept-Ranges": "bytes", "Content-Range": f"bytes {start}-{end}/{size}"})

    # -- POST -----------------------------------------------------------------
    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        try:
            if path == "/api/lab3/upload":
                name = unquote(self.headers.get("X-Filename") or "upload.xlsx")
                body = self._body(MAX_UPLOAD)
                try:
                    return self._json(200, lab3.save_upload(name, body))
                except ValueError as exc:
                    return self._json(400, {"error": str(exc)})
            req = self._json_body()
        except (ValueError, json.JSONDecodeError) as exc:
            return self._json(400, {"error": f"bad request: {exc}"})

        lang = req.get("lang") if req.get("lang") in ("en", "vi") else "vi"

        # ---- The chat model (only from a browser on this machine: it downloads and changes the labs)
        if path in ("/api/models/pull", "/api/models/select"):
            if not self._local():
                return self._json(403, {"ok": False, "detail": "local_only"})
            tag = str(req.get("model") or "")
            ok, why = start_pull(tag) if path.endswith("/pull") else select_model(tag)
            return self._json(200 if ok else 409, {"ok": ok, "detail": why})

        # ---- Hands-on 1
        if path == "/api/lab1/train":
            epochs = _clamp(req.get("epochs"), 1, 10, 5, float)
            lr = _clamp(req.get("lr"), 1e-5, 1e-3, 2e-4, float)
            rank = int(_clamp(req.get("rank"), 4, 64, 16, int))
            if not lab1.trainer_status()["ready"]:
                return self._json(409, {"error": "trainer_not_ready",
                                        "reason": lab1.trainer_status()["reason"]})
            ok, detail = lab1.JOB.start(epochs, lr, rank)
            return self._json(200 if ok else 409, {"ok": ok, "job": detail})
        if path == "/api/lab1/cancel":
            return self._json(200, {"ok": lab1.JOB.cancel()})
        if path == "/api/lab1/prepare":  # build the training container when setup could not
            ok, why = lab1.PREP.start()
            return self._json(200 if ok else 409, {"ok": ok, "detail": why})
        if path == "/api/plain/stream":  # the "without RAG / without tools" side of a comparison
            q = (req.get("question") or "").strip()
            if not q:
                return self._json(400, {"error": "empty question"})
            lang = "en" if req.get("lang") == "en" else "vi"
            return self._stream(lambda emit: plain_answer(q, lang, emit))

        if path == "/api/lab1/compare":
            q = (req.get("question") or "").strip()
            if not q:
                return self._json(400, {"error": "empty question"})
            return self._stream(lambda emit: lab1.compare(q, emit))

        # ---- Hands-on 2
        if path == "/api/lab2/ask/stream":
            q = (req.get("question") or "").strip()
            if not q:
                return self._json(400, {"error": "empty question"})
            k = int(_clamp(req.get("k"), 1, 10, 5, int))
            return self._stream(lambda emit: lab2.ask_stream(q, lang, k, RETRIEVAL_MODE, emit))

        # ---- Hands-on 3
        if path == "/api/lab3/run":
            q = (req.get("question") or "").strip()
            if not q:
                return self._json(400, {"error": "empty question"})
            route = req.get("route") if req.get("route") in ("auto", "nemoclaw", "direct") else "auto"
            data = req.get("dataset") or None
            return self._stream(lambda emit: lab3.run_agent(q, lang, data, route, emit))

        # ---- Enterprise batch demos
        if path.startswith("/api/ent/"):
            demo = req.get("demo")
            if path == "/api/ent/start" and demo in ent.DEMOS:
                limit = int(_clamp(req.get("limit"), 1, 100000, 200, int))
                engine = "ollama" if req.get("engine") == "ollama" else "vllm"
                ok, why = ent.start_job(demo, limit, engine)
                return self._json(200 if ok else 409, {"ok": ok, "detail": why})
            if path == "/api/ent/stop" and demo in ent.DEMOS:
                return self._json(200, {"ok": ent.stop_job(demo)})
            if path == "/api/ent/reset" and demo in ent.DEMOS:
                ok, why = ent.reset_job(demo)
                return self._json(200 if ok else 409, {"ok": ok, "detail": why})
            if path == "/api/ent/engine":
                if req.get("action") == "stop":
                    if ent.any_running():
                        return self._json(409, {"ok": False, "detail": "job_running"})
                    return self._json(200, {"ok": ent.engine_stop()})
                ok, why = ent.engine_start()
                ent.touch_engine()
                return self._json(200 if ok else 409, {"ok": ok, "detail": why})
            if path == "/api/ent/prepare":
                return self._json(200, {"ok": ent.prepare(log=lambda m: None)})

        return self._json(404, {"error": "not found"})


def _clamp(value, lo, hi, default, cast):
    try:
        v = cast(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def lab3_info(dataset: str) -> dict:
    tools_ok, tools_why = lab3.tools_available()
    ready, detail = lab3.gateway_ready()
    preview = None
    if tools_ok:
        try:
            preview = lab3.dataset_preview(lab3.dataset_path(dataset or None))
        except Exception as exc:  # noqa: BLE001
            preview = {"error": str(exc)}
    return {
        "examples": lab3.EXAMPLES,
        "tools_ok": tools_ok,
        "tools_reason": tools_why,
        "nemoclaw": {"ready": ready, "detail": detail, "agent": f"openclaw/{lab3.AGENT_ID}",
                     "gateway": common.gateway_url()},
        "chat_model": common.CHAT_MODEL,
        "dataset": preview,
        "tools": [t["function"]["name"] for t in lab3._tools().TOOL_SPECS] if tools_ok else [],
    }


PLAIN_SYSTEM = {
    "en": "You are a helpful assistant. Answer the user's question directly and briefly.",
    "vi": "Bạn là một trợ lý hữu ích. Hãy trả lời câu hỏi của người dùng trực tiếp, ngắn gọn, bằng tiếng Việt.",
}


def plain_answer(question: str, lang: str, emit) -> None:
    """The same chat model with no documents and no tools: what Labs 2 and 3 compare against."""
    t0 = time.time()
    msgs = [{"role": "system", "content": PLAIN_SYSTEM[lang]}, {"role": "user", "content": question}]
    try:
        for piece in common.ollama_chat_stream(common.CHAT_MODEL, msgs, {"temperature": 0.2, "num_predict": 400},
                                               timeout=240):
            emit({"text": piece})
    except Exception as exc:  # noqa: BLE001
        emit({"error": str(exc)[:300]})
        return
    emit({"done": True, "seconds": round(time.time() - t0, 1), "model": common.CHAT_MODEL})


def health(include_token: bool = False) -> dict:
    ollama = common.ollama_up()
    if not common.SANDBOX_ON:
        sandbox = {"name": "", "checked": True, "ok": False, "off": True}
        gateway = {"url": "", "ready": False}
    else:
        sandbox = {"name": common.SANDBOX, "checked": lab2.SANDBOX_STATUS["checked"],
                   "ok": lab2.SANDBOX_STATUS["ok"]}
        gateway = {"url": common.gateway_url(), "ready": lab3.gateway_ready()[0]}
    return {
        "edition": common.EDITION,
        "device": common.DEVICE,
        "features": features(),
        "ollama": ollama,
        "gpu": _gpu_name(),
        "chat_model": {"name": common.CHAT_MODEL, "ready": ollama and common.has_model(common.CHAT_MODEL)},
        "embed_model": {"name": common.EMBED_MODEL, "ready": ollama and common.has_model(common.EMBED_MODEL)},
        "extra_model": ({"name": common.EXTRA_CHAT_MODEL,
                         "ready": ollama and common.has_model(common.EXTRA_CHAT_MODEL)}
                        if common.EXTRA_CHAT_MODEL else None),
        "context": common.CHAT_CONTEXT,
        "sandbox": sandbox,
        "gateway": gateway,
        "control_ui": control_ui_url(include_token) if common.SANDBOX_ON else "",
        "local": include_token,
        "nemoclaw_port": common.detect_gateway_port() if common.SANDBOX_ON else "",
        "doc_count": len(list(lab2.CORPUS.glob("*.md"))),
    }


def control_ui_url(include_token: bool) -> str:
    """OpenClaw's own web UI for the sandbox agent.

    The gateway token (full operator access to the agent) goes into the link
    only for a browser on this machine; the gateway itself listens on
    loopback, so a LAN visitor could not use the link anyway.
    """
    base = common.gateway_url()
    token = common.gateway_token() if include_token else None
    return f"{base}/#token={token}" if token else base


def main() -> int:
    global RETRIEVAL_MODE
    ap = argparse.ArgumentParser(description="DGX Spark AI Workshop app")
    ap.add_argument("--port", type=int, default=int(common.setting("HUB_PORT", "8090")))
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--lan", action="store_true", help="listen on all interfaces")
    ap.add_argument("--retrieval", choices=["auto", "sandbox", "local"], default=RETRIEVAL_MODE)
    ap.add_argument("--open", action="store_true", help="open a browser")
    ap.add_argument("--no-warmup", action="store_true")
    args = ap.parse_args()
    RETRIEVAL_MODE = args.retrieval
    host = "0.0.0.0" if args.lan else args.host

    if not args.no_warmup:
        # Load the models in the background so the first question on stage is fast.
        def warm() -> None:
            for model in (common.CHAT_MODEL, common.EMBED_MODEL, lab1.BASE_OLLAMA, lab1.TUNED):
                if common.has_model(model):
                    common.ollama_warm(model)
        threading.Thread(target=warm, daemon=True).start()
    if args.retrieval != "local" and common.SANDBOX_ON:
        threading.Thread(target=lab2.probe_sandbox, daemon=True).start()

    def reap() -> None:  # the batch engine gives its memory back to the labs when idle
        while ent.available():
            time.sleep(60)
            try:
                ent.reap_idle_engine(float(common.setting("BATCH_IDLE_MINUTES", "30") or 30))
            except Exception:
                pass
    threading.Thread(target=reap, daemon=True).start()

    srv = ThreadingHTTPServer((host, args.port), Handler)
    srv.daemon_threads = True
    pid_file = common.RUN_DIR / "hub.pid"
    try:
        common.RUN_DIR.mkdir(exist_ok=True)
        pid_file.write_text(f"{os.getpid()}\n", encoding="utf-8")
    except OSError:
        pass
    url = f"http://127.0.0.1:{args.port}/"
    name = common.DEVICE.replace("NVIDIA ", "")
    print(f"\n  {name} AI Workshop — running at {url}")
    if args.lan:
        print(f"  (listening on all interfaces, port {args.port})")
    where = f"sandbox {common.SANDBOX}" if common.SANDBOX_ON else "no sandbox: labs run directly on this PC"
    print(f"  chat model {common.CHAT_MODEL} · embeddings {common.EMBED_MODEL} · {where}")
    print("  close this window or press Ctrl-C to stop\n" if common.IS_WINDOWS else "  press Ctrl-C to stop\n")
    sys.stdout.flush()
    if args.open:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    def _terminate(*_):  # ./stop.sh sends SIGTERM: leave the same way as Ctrl-C
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, _terminate)
    if hasattr(signal, "SIGBREAK"):  # Ctrl-Break, and windows/stop.ps1, on Windows
        signal.signal(signal.SIGBREAK, _terminate)
    common.keep_awake(True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped")
    finally:
        common.keep_awake(False)
        pid_file.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
