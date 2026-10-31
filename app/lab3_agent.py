"""Hands-on 3 — the agentic workflow: NemoClaw agent + Python tools.

    question ──▶ OpenClaw agent in the NemoClaw sandbox      (reasoning, tool choice)
                   │  tool_calls  (OpenAI function calling over the gateway)
                   ▼
                this app runs the tool in Python                (pandas / matplotlib / openpyxl)
                   │  tool results
                   └──▶ back to the agent ... until it writes the final insight

The agent is a dedicated OpenClaw agent ("analyst", minimal tool profile) that
setup.sh creates inside the sandbox. It is reached through the gateway's
OpenAI-compatible /v1/chat/completions endpoint, whose client-tool contract
hands every tool call back to us. That is what lets the UI show each step live.

If the sandbox gateway is not reachable, the exact same loop runs directly
against Ollama so the demo keeps working, and the UI says which route was used.
"""

from __future__ import annotations

import json
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import common
from common import (OLLAMA, ROOT, RUN_DIR, gateway_token, gateway_url,
                    setting, strip_thinking)

LAB = ROOT / "hands-on-3-agent"
AGENTS_MD = LAB / "agent" / "AGENTS.md"
DEFAULT_DATA = LAB / "data" / "aurora_sales_2024_2025.xlsx"
OUT_ROOT = RUN_DIR / "lab3"
UPLOADS = OUT_ROOT / "uploads"

AGENT_ID = setting("AGENT_ID", "analyst")
# "none" disables the model's hidden reasoning pass: measured 14.8 s -> 2.4 s
# for the same first tool call on qwen3:8b, with the same tool choice.
REASONING = setting("AGENT_REASONING", "none")
# The setup's CI test mode lowers it: a tiny model on a 4-core CPU takes over a minute a step.
MAX_STEPS = int(setting("LAB3_MAX_STEPS", "10") or 10)
LLM_TIMEOUT = 300

EXAMPLES = {
    "vi": [
        {"group": "Câu hỏi mẫu trong slide", "items": [
            "Phân tích doanh số theo vùng và cho biết khu vực nào tăng trưởng tốt nhất.",
        ]},
        {"group": "Phân tích và xuất báo cáo", "items": [
            "Sản phẩm nào bán chạy nhất năm 2025? Xuất báo cáo Excel giúp tôi.",
            "Doanh thu theo tháng có xu hướng gì? Vẽ biểu đồ đường.",
            "Kênh bán nào mang lại lợi nhuận cao nhất?",
        ]},
        {"group": "Đào sâu", "items": [
            "Tại Đà Nẵng, sản phẩm nào đóng góp nhiều nhất vào tăng trưởng?",
            "Doanh thu tủ pin AX-400 thay đổi thế nào theo từng quý?",
            "Sản phẩm nào có biên lợi nhuận gộp cao nhất?",
        ]},
    ],
    "en": [
        {"group": "The question from the slide", "items": [
            "Analyse sales by region and tell me which region grew the most.",
        ]},
        {"group": "Analyse and export a report", "items": [
            "Which product sold best in 2025? Export an Excel report.",
            "What is the monthly revenue trend? Draw a line chart.",
            "Which sales channel brings the most profit?",
        ]},
        {"group": "Dig deeper", "items": [
            "In Da Nang, which product contributed most to growth?",
            "How did AX-400 cabinet revenue change quarter by quarter?",
            "Which product has the highest gross margin?",
        ]},
    ],
}


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
_route_cache: dict = {"ok": None, "at": 0.0, "detail": ""}


def gateway_ready(max_age: float = 30) -> tuple[bool, str]:
    """Is the sandbox's OpenClaw gateway serving our analyst agent?"""
    if time.time() - _route_cache["at"] < max_age and _route_cache["ok"] is not None:
        return _route_cache["ok"], _route_cache["detail"]
    ok, detail = False, ""
    token = gateway_token()
    if not token:
        detail = "no gateway token (is the NemoClaw sandbox onboarded?)"
    else:
        try:
            req = urllib.request.Request(f"{gateway_url()}/v1/models",
                                         headers={"Authorization": f"Bearer {token}"})
            with urllib.request.urlopen(req, timeout=6) as resp:
                ids = [m.get("id") for m in json.loads(resp.read()).get("data", [])]
            ok = f"openclaw/{AGENT_ID}" in ids
            detail = "ready" if ok else f"agent '{AGENT_ID}' not configured in the sandbox"
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                gateway_token(refresh=True)
            detail = f"gateway answered HTTP {exc.code}"
        except Exception as exc:  # noqa: BLE001
            detail = f"gateway unreachable at {gateway_url()} ({exc.__class__.__name__})"
    _route_cache.update(ok=ok, at=time.time(), detail=detail)
    return ok, detail


def tools_available() -> tuple[bool, str]:
    try:
        import matplotlib  # noqa: F401
        import openpyxl  # noqa: F401
        import pandas  # noqa: F401
        return True, ""
    except ImportError as exc:
        return False, f"missing Python package: {exc.name} (run the install command again)"


def _tools():
    import sys
    tools_dir = str(LAB / "tools")
    if tools_dir not in sys.path:
        sys.path.insert(0, tools_dir)
    import sales_tools  # noqa: E402
    return sales_tools


# --------------------------------------------------------------------------
# Datasets
# --------------------------------------------------------------------------
def dataset_path(name: str | None) -> Path:
    if not name or name == DEFAULT_DATA.name:
        return DEFAULT_DATA
    safe = Path(name).name
    p = UPLOADS / safe
    return p if p.exists() else DEFAULT_DATA


def save_upload(filename: str, body: bytes) -> dict:
    safe = re.sub(r"[^\w.\- ()]+", "_", Path(filename or "upload.xlsx").name).strip() or "upload.xlsx"
    if not safe.lower().endswith((".xlsx", ".csv")):
        raise ValueError("only .xlsx or .csv files are supported")
    if len(body) > 25 * 1024 * 1024:
        raise ValueError("file is larger than 25 MB")
    UPLOADS.mkdir(parents=True, exist_ok=True)
    path = UPLOADS / safe
    path.write_bytes(body)
    try:
        return dataset_preview(path)
    except Exception as exc:
        path.unlink(missing_ok=True)
        raise ValueError(f"could not read the file: {exc}") from exc


def dataset_preview(path: Path, rows: int = 8) -> dict:
    st = _tools()
    df, meta = st.load_dataset(path)
    head = df.head(rows).copy()
    for c in head.columns:
        if str(head[c].dtype).startswith("datetime"):
            head[c] = head[c].dt.strftime("%Y-%m")
    return {
        "name": path.name,
        "sheet": meta["sheet"],
        "rows": int(len(df)),
        "columns": list(df.columns),
        "preview": head.astype(object).where(head.notna(), "").values.tolist(),
        "default": path == DEFAULT_DATA,
    }


# --------------------------------------------------------------------------
# The OpenAI-compatible chat call (same code for both routes)
# --------------------------------------------------------------------------
class LLMError(Exception):
    pass


def chat_stream(route: str, messages: list[dict], tool_specs: list[dict], on_text) -> dict:
    """One model turn. Streams text through on_text; returns content + tool calls."""
    if route == "nemoclaw":
        url = f"{gateway_url()}/v1/chat/completions"
        token = gateway_token() or ""
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        payload = {"model": f"openclaw/{AGENT_ID}", "messages": messages,
                   "tools": tool_specs, "stream": True}
    else:
        url = f"{OLLAMA}/v1/chat/completions"
        headers = {"Content-Type": "application/json"}
        payload = {"model": common.CHAT_MODEL, "messages": messages, "tools": tool_specs,
                   "stream": True, "temperature": 0.2}
        if REASONING and REASONING != "default":
            payload["reasoning_effort"] = REASONING

    for attempt in range(3):
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers)
        try:
            resp = urllib.request.urlopen(req, timeout=LLM_TIMEOUT)
            break
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")[:400]
            if route == "direct" and exc.code == 400 and "reasoning" in body and "reasoning_effort" in payload:
                payload.pop("reasoning_effort")  # model without a reasoning switch
            elif exc.code >= 500 and attempt < 2:
                # Ollama restarts a model runner that crashed while loading
                # (seen on the Spark under memory pressure): try again.
                time.sleep(3 * (attempt + 1))
            else:
                raise LLMError(f"HTTP {exc.code}: {body}") from exc
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            raise LLMError(str(exc)) from exc

    content, calls, finish, usage = [], {}, None, None
    in_think = False
    with resp:
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            if chunk.get("error"):
                raise LLMError(str(chunk["error"]))
            usage = chunk.get("usage") or usage
            for choice in chunk.get("choices") or []:
                delta = choice.get("delta") or {}
                piece = delta.get("content") or ""
                if piece:
                    if "<think>" in piece:
                        in_think, piece = True, piece.split("<think>", 1)[0]
                    if in_think:
                        if "</think>" in piece:
                            in_think, piece = False, piece.split("</think>", 1)[1]
                        else:
                            piece = ""
                    if piece:
                        content.append(piece)
                        on_text(piece)
                for tc in delta.get("tool_calls") or []:
                    slot = calls.setdefault(tc.get("index", len(calls)),
                                            {"id": "", "name": "", "arguments": ""})
                    slot["id"] = tc.get("id") or slot["id"]
                    fn = tc.get("function") or {}
                    slot["name"] = fn.get("name") or slot["name"]
                    args = fn.get("arguments")
                    if isinstance(args, dict):  # some servers send an object
                        slot["arguments"] = json.dumps(args, ensure_ascii=False)
                    elif args:
                        slot["arguments"] += args
                finish = choice.get("finish_reason") or finish
    tool_calls = []
    for i in sorted(calls):
        c = calls[i]
        if not c["name"]:
            continue
        tool_calls.append({"id": c["id"] or f"call_{uuid.uuid4().hex[:8]}",
                           "type": "function",
                           "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}})
    return {"content": strip_thinking("".join(content)), "tool_calls": tool_calls,
            "finish": finish, "usage": usage}


# --------------------------------------------------------------------------
# The agent loop
# --------------------------------------------------------------------------
LANGUAGE_RULE = {
    "vi": ("LANGUAGE: reply in Vietnamese (tiếng Việt). Write the chart title, the "
           "report title and the insights in Vietnamese too."),
    "en": ("LANGUAGE: reply in English, even though the workbook is in Vietnamese. "
           "Write the chart title, the report title and the insights in English. Keep "
           "region and product names exactly as they appear in the data."),
}


def instructions(lang: str, data: Path, rows: int | None) -> str:
    """AGENTS.md plus this conversation's facts, with the language rule stated twice.

    Stating it once at the end was not enough: with a Vietnamese workbook and
    Vietnamese examples in AGENTS.md, qwen3:8b answered an English question in
    Vietnamese.
    """
    base = AGENTS_MD.read_text(encoding="utf-8") if AGENTS_MD.exists() else ""
    rule = LANGUAGE_RULE.get(lang, LANGUAGE_RULE["en"])
    ctx = [
        rule,
        "",
        base.strip(),
        "",
        "## This conversation",
        f"- Active data file: {data.name}" + (f" ({rows} rows)" if rows else ""),
        f"- Today is {time.strftime('%Y-%m-%d')}.",
        f"- {rule}",
        "- Keep numbers exactly as the tools formatted them.",
    ]
    return "\n".join(ctx)


_NO_REPLY = re.compile(r"\bNO_REPLY\b")
_PENDING = re.compile(r"\bpending\b|\bawait|\bwaiting\b|external approval|\bclient\b|"
                      r"not (?:yet )?received|haven't received|"
                      r"chờ kết quả|đợi kết quả|đợi xử lý|đang chờ|chưa nhận được", re.I)
_YEAR = re.compile(r"\b(?:19|20)\d\d\b")
_FILE = r"[*_`]*(?:chart-C\d+\.png|[\w.-]+-R\d+\.xlsx)[*_`]*"  # what the tools name their outputs
THOUGHT_CHARS = 400


def _strip_files(text: str) -> str:
    """Drop chart/report file names: the page already shows both (AGENTS.md
    asks for none, yet "Biểu đồ (chart-C2.png) và báo cáo (…-R3.xlsx)" happens)."""
    text = re.sub(rf"\s*\(\s*{_FILE}\s*\)", "", text)
    text = re.sub(_FILE, "", text)
    return re.sub(r"[ \t]{2,}", " ", re.sub(r"[ \t]+([.,;:])", r"\1", text))


# Grounding. The agent must never state a number it did not get from a tool.
# Numbers are compared as bare digit strings, so "64,5%", "+64.5%" and "64,5"
# all match; years and small counts (≤ 12: months, quarters, "top 5") are
# ignored. A text is flagged when at least two of its figures, and at least a
# quarter of them, appear in no tool result of this run.
_NUM = re.compile(r"(?<!\w)\d+(?:[.,]\d+)*")  # not part of a name such as C2 or cv_134


def _figures(text: str) -> dict[str, str]:
    """{digits: as written} for every figure in text."""
    out = {}
    for m in _NUM.finditer(_YEAR.sub(" ", text or "")):
        raw = m.group()
        digits = re.sub(r"\D", "", raw)
        if raw.isdigit() and int(raw) <= 12:
            continue
        out.setdefault(digits, raw)
    return out


def _unsupported(text: str, evidence: set[str]) -> list[str]:
    """Figures in text that no tool returned, when there are enough to matter."""
    figs = _figures(text)
    bad = [raw for digits, raw in figs.items() if digits not in evidence]
    return bad if len(bad) >= 2 and len(bad) * 4 >= len(figs) else []


# Qwen sometimes slips Chinese words into Vietnamese or English ("là唯一的").
_CJK = re.compile(r"[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]+")
# OpenClaw internals the model sometimes narrates to the caller.
_INTERNAL = re.compile(r"\bthe user'?s\b|previous turn|chat messages|\bthe assistant\b|no further|"
                       r"tool[_ ]search|tool ids?\b|workflow directive|approval", re.I)
# Talk about the process rather than the data: dropped from answers when the
# sentence carries no figure.
_META = re.compile(
    r"\b(?:charts?|reports?|excel|visuali[sz]ations?|biểu đồ|báo cáo|file|tệp)\b.{0,80}?"
    r"\b(?:created|ready|generated|exported|finali[sz]ed|attached|saved|available|complete[d]?|"
    r"đã (?:được )?(?:tạo|xuất|lưu|gửi)|sẵn sàng|hoàn tất|đính kèm)|"
    r"\bhere'?s\b|\bhere (?:is|are) (?:the|a|my)\b|\b(?:thanks|thank you|sorry|xin lỗi|cảm ơn)\b|"
    r"\b(?:download|attachment|attached|workspace|canvas|embed)\b|\bnow complete\b|"
    r"\b(?:is|are) (?:now )?(?:complete|ready|done)\b|\bsẵn sàng\b|"
    r"^[-*•\s]*[*_]*(?:biểu đồ|báo cáo(?: excel)?|chart|(?:excel )?report)[*_]*\s*:|"
    r"\blet me\b|\bi(?:'ll| will| need to| should)\b|\bnow i\b|^(?:great|perfect|ok(?:ay)?|done|alright)\b|"
    r"\bdưới đây là\b|\btôi sẽ\b|\btiếp tục\b|\btoàn bộ quy trình\b|"
    r"\b(?:phân tích|quy trình)\b.{0,40}?\bhoàn tất\b|\btin (?:nhắn )?trước\b|"
    r"\b(?:get_dataset_info|analyze_sales|create_chart|export_excel_report)\b", re.I)


def _tidy(text: str) -> str:
    """Markup the page must not show: NO_REPLY, MEDIA lines, embed tags, sandbox
    paths, output file names, Chinese words; and glued sentences repaired."""
    text = _CJK.sub("", _NO_REPLY.sub("", text or ""))
    text = re.sub(r"\[embed\b[^\]]*\]", "", text)
    text = "\n".join(l for l in text.splitlines()
                     if not l.strip(" *_`>-").startswith("MEDIA:") and "/sandbox/" not in l)
    text = _strip_files(text)
    return re.sub(r"([.!?])([*_`]*)(\w)", lambda m: m.group(1) + (" " if m.group(3).isupper() else "")
                  + m.group(2) + m.group(3), text)


def _clean_answer(text: str) -> str:
    """The answer for the audience: process talk without figures removed."""
    paras = []
    for para in re.split(r"\n\s*\n", _tidy(text)):
        lines = []
        for line in para.split("\n"):
            kept = [s for s in re.split(r"(?<=[.!?])\s+", line.strip()) if s and (
                _figures(s) or not (_META.search(s) or _INTERNAL.search(s)
                                    or (_PENDING.search(s) and len(s) < 200)))]
            if kept:
                lines.append(" ".join(kept))
        para = "\n".join(lines).strip()
        if para.strip("-* ").strip():
            paras.append(para)
    while paras and re.sub(r"[*_`\s]+$", "", paras[-1].split("\n")[-1]).endswith(":"):
        last = paras[-1].split("\n")[:-1]  # a label whose content was removed
        paras[-1:] = ["\n".join(last)] if last else []
    return "\n\n".join(paras).strip()


def _grounded(text: str, evidence: set[str]) -> int:
    """How many distinct figures in text a tool returned."""
    return sum(1 for d in _figures(text) if d in evidence)


def _cut_runaway(text: str, evidence: set[str]) -> str:
    """End the answer at the last sentence backed by the tools' figures, when
    an unbacked figure follows. Seen once on the Spark: after a correct answer
    the model kept going into an unrelated reply (automating e-mail from an
    ERP system) with numbers of its own.
    """
    if not _unsupported(text, evidence):
        return text
    # "TP. Hồ Chí Minh": the abbreviation's dot does not end a sentence. The
    # stand-in has the same length, so positions still match the text.
    shielded = re.sub(r"\b(TP|Tp)\.", "\\1\u2024", text)
    sentences = list(re.finditer(r"[^.!?\n]+(?:[.!?]+|\n|$)", shielded))
    backed = [m for m in sentences if any(d in evidence for d in _figures(m.group()))]
    if not backed:
        return text
    tail = text[backed[-1].end():]
    if any(d not in evidence for d in _figures(tail)):
        return text[: backed[-1].end()].rstrip()
    return text


def _visible_thought(text: str, evidence: set[str]) -> str:
    """Commentary worth showing on screen, minus OpenClaw's internal chatter.

    Inside the gateway the model sees client tool calls as pending and often
    says so ("The tool result is pending... NO_REPLY", "Chờ kết quả phân tích.
    Đợi xử lý từ client..."). True, but noise for an audience: those sentences
    are dropped. The gateway also joins the model's text segments without a
    space ("...structure.The tool"), which is repaired.

    While its calls are pending the model has also been seen writing whole
    made-up tables. The caller only shows thoughts once an analysis result has
    come back, and a sentence with a figure no tool returned is dropped. The
    answer card shows the full answer, so a thought is kept short.
    """
    text = _tidy(text)
    paras, size = [], 0
    for para in re.split(r"\n\s*\n", text):
        lines = []
        for line in para.split("\n"):
            kept = [s for s in re.split(r"(?<=[.!?])\s+", line.strip())
                    if s and not (_PENDING.search(s) and len(s) < 200) and not _INTERNAL.search(s)
                    and all(d in evidence for d in _figures(s))]
            if kept:
                lines.append(" ".join(kept))
        while lines and lines[-1].endswith(":"):  # an intro whose list was dropped
            lines.pop()
        para = "\n".join(lines).strip()
        if para.strip("-").strip():
            paras.append(para)
            size += len(para)
            if size >= THOUGHT_CHARS:
                break
    return "\n\n".join(paras)


# The agent may not stop yet when (AGENTS.md):
#   * it describes a tool call instead of making it ("Let me proceed: call
#     `analyze_sales`..."), seen on qwen3.6:35b through the gateway;
#   * its answer has figures no tool returned (it once answered about regions
#     the workbook does not have, without any analysis);
#   * it analysed but has not made the chart and the report (steps 3-4).
# The loop then tells the agent what is left, at most MAX_NUDGES times, and the
# agent makes the calls itself.
AFTER_ANALYSIS = ("create_chart", "export_excel_report")
MAX_NUDGES = 3
_TOOL_NAME = re.compile(r"\b(?:get_dataset_info|analyze_sales|create_chart|export_excel_report)\b")


def _not_finished(text: str, done: set[str], evidence: set[str],
                  rows: dict[str, set[str]] | None = None, lang: str = "vi",
                  names: list[str] | None = None) -> tuple[str, list[str]] | None:
    """Why the agent should continue instead of answering, or None."""
    analysed = "analyze_sales" in done
    if not analysed and _TOOL_NAME.search(text or ""):
        return ("described", [])
    bad = _unsupported(text, evidence)
    if bad:
        return ("figures" if analysed else "no_analysis", bad)
    if analysed:
        missing = [n for n in AFTER_ANALYSIS if n not in done]
        if missing:
            return ("missing", missing)
    answer = _fix_names(_clean_answer(text), names or [])
    wrong = _misattributed(answer, rows or {})
    if wrong:
        return ("mismatch", wrong)
    if analysed and _wrong_language(answer, lang, names or []):
        return ("language", [])
    return None


def _nudge_text(reason: str, items: list[str], lang: str) -> str:
    if reason == "missing":
        todo = {
            "create_chart": "call create_chart for the same group_by and metric as your analysis",
            "export_excel_report": "call export_excel_report with a clear title and 3-5 insights",
        }
        msg = (f"Not finished yet: {'; then '.join(todo[n] for n in items)}. "
               "Only after that, write the answer.")
    elif reason == "described":
        msg = ("You described the next tool call but did not make it. Make the call now, "
               "one tool at a time, then continue the workflow.")
    elif reason == "mismatch":
        msg = (f"Check your answer against the analysis table: {'; '.join(items[:4])}. "
               "Write the answer again, giving each region or product its own figures.")
    elif reason == "language":
        msg = "Write the whole answer again in the required language; keep names as in the data."
    elif reason == "no_analysis":
        msg = (f"Your answer contains figures no tool returned ({', '.join(items[:6])}). Every "
               "number must come from a tool: call analyze_sales first, then continue the workflow.")
    else:
        msg = (f"These figures in your answer appear in no tool result: {', '.join(items[:6])}. "
               "Quote the tool results exactly; never calculate or estimate. Write the answer again.")
    return f"{msg} {LANGUAGE_RULE.get(lang, LANGUAGE_RULE['en'])}"


# --------------------------------------------------------------------------
# Names and languages. nemotron-3.5-lightning, through the gateway, misspelt
# place names ("Đà Năng", "Đà Nỗng"), once headlined the wrong region ("TP. Hồ
# Chí Minh … +64,5%", Đà Nẵng's figure) and answered English questions in
# Vietnamese. These checks use the workbook itself as the reference.
# --------------------------------------------------------------------------
_NAMES: dict[str, list[str]] = {}


def _known_names(st, data: Path) -> list[str]:
    """The workbook's category values (regions, products, channels), longest first."""
    key = f"{data}:{data.stat().st_mtime if data.exists() else 0}"
    if key not in _NAMES:
        names: set[str] = set()
        try:
            df = st.load_dataset(data)[0]
            for col in df.columns:
                vals = list(df[col].dropna().unique())
                # Text columns: object in pandas 2, "str" in pandas 3, so look at the values.
                if 1 < len(vals) <= 60 and all(isinstance(v, str) for v in vals):
                    names.update(v.strip() for v in vals
                                 if 2 <= len(v.strip()) <= 60 and re.search(r"[^\W\d_]", v))
        except Exception:  # noqa: BLE001 - names are a nicety, never a failure
            pass
        _NAMES[key] = sorted(names, key=len, reverse=True)
    return _NAMES[key]


def _fold(text: str) -> str:
    """Lower case without accents: "Đà Nẵng" -> "da nang"."""
    t = unicodedata.normalize("NFD", text.replace("đ", "d").replace("Đ", "D"))
    return "".join(c for c in t if unicodedata.category(c) != "Mn").lower()


def _one_edit(a: str, b: str) -> bool:
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) <= 1
    if len(a) > len(b):
        a, b = b, a
    i = 0
    while i < len(a) and a[i] == b[i]:
        i += 1
    return a[i:] == b[i + 1:]


def _fix_names(text: str, names: list[str]) -> str:
    """Put the workbook's spelling back on near-miss names ("Đà Năng" -> "Đà Nẵng").

    A run of words is replaced only when it equals a name once accents are
    ignored, or, for names without digits, is one letter away from one and
    from no other name: "AX-400" is never turned into "AX-600".
    """
    if not text or not names:
        return text
    words = list(re.finditer(r"\w+", text))
    table = [(n, _fold(n), len(re.findall(r"\w+", n))) for n in names]
    folded = {f for _, f, _ in table}
    out, pos, i = [], 0, 0
    while i < len(words):
        step = 1
        for name, fname, k in table:
            if i + k > len(words):
                continue
            start, end = words[i].start(), words[i + k - 1].end()
            cand = text[start:end]
            if cand == name:
                step = k
                break
            fc = _fold(cand)
            if fc == fname or (not re.search(r"\d", name) and len(fname) >= 6
                                and fc not in folded and _one_edit(fc, fname)):
                out.append(text[pos:start])
                out.append(name)
                pos, step = end, k
                break
        i += step
    out.append(text[pos:])
    return "".join(out)


def _table_figures(model_out: dict) -> dict[str, set[str]]:
    """{row name: figures in its row} from an analyze_sales result."""
    rows: dict[str, set[str]] = {}
    for row in model_out.get("table") or []:
        if isinstance(row, dict) and row:
            name = str(next(iter(row.values())))
            rows.setdefault(name, set()).update(_figures(" ".join(map(str, list(row.values())[1:]))))
    return rows


def _misattributed(text: str, rows: dict[str, set[str]]) -> list[str]:
    """Sentences that name one row but quote another row's figure."""
    if not rows:
        return []
    shielded = re.sub(r"\b(TP|Tp)\.", "\\1\u2024", text)
    problems = []
    for m in re.finditer(r"[^.!?\n]+(?:[.!?]+|\n|$)", shielded):
        sentence = text[m.start():m.end()]
        named = [n for n in rows if n in sentence]
        if len(named) != 1:
            continue
        own = rows[named[0]]
        for digits, raw in _figures(sentence.replace(named[0], " ")).items():
            other = next((n for n, figs in rows.items() if n != named[0] and digits in figs), None)
            if other and digits not in own:
                problems.append(f"{raw} belongs to {other}, not {named[0]}")
    return problems


_VI_LETTERS = set("ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ")


def _wrong_language(text: str, lang: str, names: list[str]) -> bool:
    """An answer mostly in the other language (names from the data excluded)."""
    for n in names:
        text = text.replace(n, " ")
    letters = [c for c in text.lower() if c.isalpha()]
    if len(letters) < 80:
        return False
    share = sum(c in _VI_LETTERS for c in letters) / len(letters)
    return share > 0.06 if lang == "en" else share < 0.04


def _next_step(done: set[str]) -> str:
    """The workflow's next step, for an agent that keeps repeating a call."""
    for name in ("analyze_sales", "create_chart", "export_excel_report"):
        if name not in done:
            return f"Next: call {name}."
    return "Next: write the answer."


def _highlights_answer(highlights: list[str], lang: str) -> str:
    """An answer made of the analysis's own highlights (computed by pandas), for
    a run where the model gave no usable answer: it looped to the step limit,
    kept repeating calls, or kept giving one region another region's figure."""
    head = ("Kết quả phân tích (pandas tính trên toàn bộ dữ liệu):" if lang == "vi"
            else "Analysis results (computed by pandas over the whole workbook):")
    return head + "\n" + "\n".join(f"- {h}" for h in highlights)


def _semantic_key(st, ctx, name: str, args: dict) -> str | None:
    """What a call means (grouping, metric, filters), so that a repeat in other
    words is recognised: through the gateway the model re-drew the same chart
    and re-exported the same report up to four times."""
    if name not in ("analyze_sales", "create_chart", "export_excel_report"):
        return None
    try:
        a = st._coerce_args(dict(args))
        if name != "analyze_sales":
            st._default_to_last_analysis(a, ctx)
    except Exception:  # noqa: BLE001 - bad arguments: let the tool report them
        return None
    parts = {"g": str(a.get("group_by") or ""), "m": str(a.get("metric") or ""),
             "f": a.get("filters") or None}
    if not parts["g"] or not parts["m"]:
        return None
    if name == "create_chart":
        parts["t"] = str(a.get("chart_type") or "bar")
    return name + json.dumps(parts, sort_keys=True, ensure_ascii=False, default=str)


def _check_report(args: dict, analysed_before: bool, evidence: set[str]) -> dict | None:
    """The report's insights are the model's own words: they come after it has
    read an analysis, and their figures must be ones a tool returned."""
    if not analysed_before:
        return {"error": "Call analyze_sales first and read its result: the report's insights "
                         "must quote its numbers. Then call export_excel_report."}
    insights = args.get("insights")
    text = " ".join(map(str, insights)) if isinstance(insights, list) else str(insights or "")
    bad = _unsupported(text, evidence)
    if bad:
        return {"error": "These figures in insights appear in no tool result: " + ", ".join(bad[:6])
                         + ". Quote the analysis numbers exactly.", "unsupported": bad[:6]}
    return None


def _short(obj, limit: int = 7000) -> str:
    s = json.dumps(obj, ensure_ascii=False, default=str)
    return s if len(s) <= limit else s[:limit] + ' …"(truncated)"'


RUN_LOCK = threading.Lock()  # one agent run at a time: the GPU serves one presenter


def run_agent(question: str, lang: str, data_name: str | None, route_pref: str, emit) -> None:
    ok, why = tools_available()
    if not ok:
        emit({"event": "error", "message": why})
        return
    if not RUN_LOCK.acquire(blocking=False):
        emit({"event": "error", "message": "busy"})
        return
    try:
        _run(question, lang, data_name, route_pref, emit)
    finally:
        RUN_LOCK.release()


def _run(question: str, lang: str, data_name: str | None, route_pref: str, emit) -> None:
    st = _tools()
    data = dataset_path(data_name)
    run_id = time.strftime("%H%M%S-") + uuid.uuid4().hex[:4]
    out_dir = OUT_ROOT / run_id
    ctx = st.ToolContext(data_path=data, out_dir=out_dir, lang=lang)
    try:
        rows = len(st.load_dataset(data)[0])
    except Exception:
        rows = None

    route = "direct"
    route_note = ""
    if route_pref in ("auto", "nemoclaw"):
        ready, route_note = gateway_ready()
        if ready:
            route = "nemoclaw"
        elif route_pref == "nemoclaw":
            emit({"event": "error", "message": f"NemoClaw route unavailable: {route_note}"})
            return

    messages: list[dict] = [
        {"role": "system", "content": instructions(lang, data, rows)},
        {"role": "user", "content": question},
    ]
    transcript = {"question": question, "lang": lang, "data": data.name, "route": route,
                  "events": []}

    def send(ev: dict) -> None:
        ev.setdefault("t", round(time.time() - t0, 2))
        transcript["events"].append(ev)
        emit(ev)

    t0 = time.time()
    send({"event": "start", "run": run_id, "route": route, "note": route_note,
          "agent": f"openclaw/{AGENT_ID}" if route == "nemoclaw" else common.CHAT_MODEL,
          "model": common.CHAT_MODEL, "data": data.name})

    seen: dict[str, dict] = {}
    seen_meaning: dict[str, dict] = {}
    names = _known_names(st, data)  # the workbook's regions, products, channels
    rows: dict[str, set[str]] = {}  # analysis table: row name -> its figures
    done: set[str] = set()  # tools that succeeded at least once
    evidence = set(_figures(question))  # figures the agent has been given
    analysed_before = False  # an analysis result came back in an earlier turn
    drafts: list[str] = []
    nudges = 0
    repeats = 0  # calls answered from an earlier result
    highlights: list[str] = []
    final = ""
    for step in range(1, MAX_STEPS + 1):
        send({"event": "llm", "step": step})
        t_llm = time.time()
        try:
            reply = chat_stream(route, messages, st.TOOL_SPECS,
                                lambda piece: emit({"event": "delta", "step": step, "text": piece}))
        except LLMError as exc:
            if route == "nemoclaw" and route_pref == "auto" and step == 1:
                # The sandbox path failed on the first call: fall back and say so.
                route = "direct"
                transcript["route"] = route
                send({"event": "fallback", "route": route, "reason": str(exc)[:300]})
                try:
                    reply = chat_stream(route, messages, st.TOOL_SPECS,
                                        lambda piece: emit({"event": "delta", "step": step, "text": piece}))
                except LLMError as exc2:
                    send({"event": "error", "message": f"model unreachable: {exc2}"})
                    return
            else:
                send({"event": "error", "message": f"model call failed: {exc}"})
                return
        why = (None if reply["tool_calls"] or nudges >= MAX_NUDGES
               else _not_finished(reply["content"], done, evidence, rows, lang, names))
        send({"event": "llm_done", "step": step, "seconds": round(time.time() - t_llm, 1),
              "tool_calls": len(reply["tool_calls"]), "usage": reply.get("usage"),
              **({"nudge": why[0]} if why else {})})

        if not reply["tool_calls"]:
            if why:
                nudges += 1
                messages.append({"role": "assistant", "content": reply["content"] or ""})
                messages.append({"role": "user", "content": _nudge_text(why[0], why[1], lang)})
                send({"event": "nudge", "step": step, "reason": why[0], "missing": why[1]})
                continue
            final = reply["content"]
            break

        messages.append({"role": "assistant", "content": reply["content"] or "",
                         "tool_calls": reply["tool_calls"]})
        if analysed_before and reply["content"]:
            drafts.append(reply["content"])  # often the real answer, written beside the last calls
        thought = _fix_names(_visible_thought(reply["content"], evidence), names) if analysed_before else ""
        if thought:
            send({"event": "thought", "step": step, "text": thought})
        analysed_now = False
        for call in reply["tool_calls"]:
            name = call["function"]["name"]
            raw_args = call["function"]["arguments"]
            try:
                args = json.loads(raw_args) if raw_args else {}
            except json.JSONDecodeError:
                args = {"_raw": raw_args}
            if name == "export_excel_report":  # the report carries the model's words
                for k in ("title", "insights"):
                    if isinstance(args.get(k), str):
                        args[k] = _fix_names(args[k], names)
                    elif isinstance(args.get(k), list):
                        args[k] = [_fix_names(str(x), names) for x in args[k]]
            send({"event": "tool_call", "id": call["id"], "name": name, "args": args})
            key = name + json.dumps(args, sort_keys=True, ensure_ascii=False)
            meaning = _semantic_key(st, ctx, name, args)
            t_tool = time.time()
            refused = (_check_report(args, analysed_before, evidence)
                       if name == "export_excel_report" else None)
            if refused:
                model_out, ui_out, ok = refused, refused, False
            elif meaning and meaning in seen_meaning:
                prev = seen_meaning[meaning]
                model_out, ui_out, ok = prev["model"], prev["ui"], True
                repeats += 1
                model_out = {**model_out, "note": f"Already done in this conversation; do not repeat it. "
                                                  f"{_next_step(done)}"}
            elif key in seen and name != "export_excel_report":
                # Replay an identical call, keeping whether it succeeded: a
                # repeated failure must stay a failure (it once crashed here).
                prev = seen[key]
                model_out, ui_out, ok = prev["model"], prev["ui"], prev["ok"]
                repeats += 1
                note = (f"You already have this result. Do not call it again. {_next_step(done)}" if ok else
                        "This exact call already failed. Change the arguments as the error says.")
                model_out = {**model_out, "note": note}
            else:
                model_out, ui_out, ok = st.run_tool(name, args, ctx)
                seen[key] = {"model": model_out, "ui": ui_out, "ok": ok}
            if ok:
                done.add(name)
                evidence |= set(_figures(json.dumps(model_out, ensure_ascii=False)))
                analysed_now = analysed_now or name == "analyze_sales"
                if meaning:
                    seen_meaning.setdefault(meaning, {"model": model_out, "ui": ui_out})
                if name == "analyze_sales":
                    rows.update(_table_figures(model_out))
                    highlights = list(model_out.get("highlights") or highlights)
            ev = {"event": "tool_result", "id": call["id"], "name": name, "ok": ok,
                  "seconds": round(time.time() - t_tool, 2), "ui": ui_out}
            if ok and name == "create_chart" and ui_out.get("image"):
                ev["image_url"] = f"/api/lab3/file/{run_id}/{ui_out['image']}"
            if ok and name == "export_excel_report" and ui_out.get("file"):
                ev["file_url"] = f"/api/lab3/file/{run_id}/{ui_out['file']}"
            send(ev)
            # Exactly the message shape verified against the OpenClaw gateway.
            messages.append({"role": "tool", "tool_call_id": call["id"],
                             "content": _short(model_out)})
        analysed_before = analysed_before or analysed_now
        if repeats >= 3:  # going round in circles: answer from what is there
            break

    # Through the gateway the model often writes its answer beside its last tool
    # calls; once the results are back it believes it already replied and
    # sends only "The report has been exported" or worse. The answer shown is
    # the final message unless a draft carries more of the figures the tools
    # returned.
    answer = _cut_runaway(_clean_answer(final), evidence)
    if _grounded(answer, evidence) < 2 and drafts:
        best = max((_clean_answer(d) for d in drafts), key=lambda d: _grounded(d, evidence))
        if _grounded(best, evidence) > _grounded(answer, evidence):
            answer = best
    answer = _fix_names(answer or _tidy(final).strip(), names)
    if highlights and (_grounded(answer, evidence) < 2 or _misattributed(answer, rows)):
        answer = _highlights_answer(highlights, lang)
    final = answer or ("Đã đạt giới hạn số bước." if lang == "vi" else "Step limit reached.")
    files = [{"kind": f["kind"], "name": f["name"],
              "url": f"/api/lab3/file/{run_id}/{f['name']}"} for f in ctx.files]
    unverified = _unsupported(final, evidence)
    send({"event": "answer", "text": final, "seconds": round(time.time() - t0, 1),
          "route": route, "files": files, **({"unverified": unverified} if unverified else {})})
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        transcript["messages"] = messages
        (out_dir / "transcript.json").write_text(
            json.dumps(transcript, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    except OSError:
        pass


def output_file(run_id: str, name: str) -> Path | None:
    """Resolve a generated chart/report without allowing path traversal."""
    if not re.fullmatch(r"[\w\-]+", run_id or "") or "/" in name or "\\" in name or name.startswith("."):
        return None
    p = OUT_ROOT / run_id / name
    return p if p.is_file() else None
