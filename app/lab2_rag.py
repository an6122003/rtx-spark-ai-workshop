"""Hands-on 2 — RAG with NemoClaw: retrieval from the sandbox, answer with sources.

    question
      -> OpenClaw memory search inside the NemoClaw sandbox   (retrieval)
      -> the retrieved passages are read out of the corpus
      -> the chat model answers using ONLY those passages     (generation)

If the sandbox is unavailable, retrieval falls back to the checked-in vector
index (same corpus, same embedding model) so a live demo does not die on stage.
The answer says which route served it. The Windows edition has no sandbox and
always uses that index; with a different embedding model (the CI's small one)
setup builds a matching index into .run/rag-index.
"""

from __future__ import annotations

import json
import math
import re
import subprocess
import time
import urllib.error
import urllib.request

import common
from common import (EMBED_MODEL, NEMOCLAW_LOCK, OLLAMA, ROOT, RUN_DIR, SANDBOX,
                    SANDBOX_ON, nemoclaw_env, ollama_chat_stream)

LAB = ROOT / "hands-on-2-rag"
CORPUS = LAB / "corpus"
LOCAL_INDEX = LAB / "index" / "rag_index.json"
# Built by setup when EMBED_MODEL is not the model the checked-in index used.
BUILT_INDEX = RUN_DIR / "rag-index" / "rag_index.json"

QWEN3_QUERY_PREFIX = (
    "Instruct: Given a user query, retrieve relevant memory notes and documents\n"
    "Query:"
)

# The corpus is English, so Vietnamese questions exercise cross-lingual
# retrieval: the model must find English documents and answer in Vietnamese.
EXAMPLES: dict[str, list[dict]] = {
    "en": [
        {"group": "Ask a simple question", "items": [
            "What is the usable energy of the AX-600 battery cabinet?",
            "What coolant does the liquid-cooled cabinet use?",
            "Which port does the Comet C2 use for Modbus?",
        ]},
        {"group": "Watch it separate two similar products", "items": [
            "What torque do I use on the DC terminals?",
            "Which cabinet is liquid cooled, and what coolant does it take?",
        ]},
        {"group": "The important one — is the old safety advice still valid?", "items": [
            "How long after opening the DC disconnect must I wait before removing a module cover?",
            "Is the 5-minute DC disconnect wait still correct?",
        ]},
        {"group": "Ask something it should refuse", "items": [
            "What is Aurora Grid Systems' share price today?",
            "Who won the 2022 World Cup?",
        ]},
    ],
    "vi": [
        {"group": "Hỏi một câu đơn giản", "items": [
            "Dung lượng khả dụng của tủ pin AX-600 là bao nhiêu?",
            "Tủ được làm mát bằng chất lỏng sử dụng dung dịch gì?",
            "Bộ điều khiển Comet C2 dùng cổng nào cho Modbus?",
        ]},
        {"group": "Xem hệ thống phân biệt hai sản phẩm gần giống nhau", "items": [
            "Tôi phải siết đầu cực DC với lực bao nhiêu?",
            "Tủ nào được làm mát bằng chất lỏng, và dùng dung dịch gì?",
        ]},
        {"group": "Điểm quan trọng nhất — hướng dẫn an toàn cũ còn hiệu lực không?", "items": [
            "Sau khi ngắt cầu dao DC, phải chờ bao lâu trước khi tháo nắp module?",
            "Quy tắc chờ 5 phút khi ngắt DC còn đúng không?",
        ]},
        {"group": "Hỏi điều mà hệ thống nên từ chối trả lời", "items": [
            "Giá cổ phiếu của Aurora Grid Systems hôm nay là bao nhiêu?",
            "Đội nào vô địch World Cup 2022?",
        ]},
    ],
}

SYSTEM = {
    "en": """You are a helpful assistant for Aurora Grid Systems field engineers.

Answer the user's question using ONLY the numbered context passages provided.
The documents are in English and you must reply in ENGLISH.
Rules:
- Never use outside knowledge. If the context does not contain the answer, say plainly that the documents do not cover it.
- Be concise: two or three sentences, or a short list. No preamble.
- Name the document you used, e.g. "(AX-600 Battery Cabinet Datasheet)".
- If the context contains a SUPERSEDED or withdrawn instruction alongside a newer one, always give the CURRENT instruction and say the older one is out of date.
- NEVER state that no wait, no action or no requirement applies unless the context says so in those words. If a superseding document is present but its replacement value is not, say the value is not in the passages you were given.
- If two similar products could be confused, state which product your answer applies to.""",
    "vi": """Bạn là trợ lý hữu ích cho các kỹ sư hiện trường của Aurora Grid Systems.

Chỉ trả lời câu hỏi của người dùng dựa trên các đoạn ngữ cảnh được đánh số bên dưới.
Tài liệu bằng tiếng Anh nhưng bạn PHẢI trả lời bằng TIẾNG VIỆT.
Quy tắc:
- Không dùng kiến thức bên ngoài. Nếu ngữ cảnh không chứa câu trả lời, hãy nói rõ rằng tài liệu không đề cập đến vấn đề này.
- Trả lời ngắn gọn: hai hoặc ba câu, hoặc một danh sách ngắn. Không mở bài dài dòng.
- Nêu tên tài liệu đã dùng, ví dụ "(Bảng thông số tủ pin AX-600)".
- Nếu ngữ cảnh có một hướng dẫn đã BỊ THAY THẾ hoặc thu hồi bên cạnh hướng dẫn mới hơn, luôn đưa ra hướng dẫn HIỆN HÀNH và nói rõ hướng dẫn cũ đã hết hiệu lực.
- TUYỆT ĐỐI không được nói rằng không cần chờ, không cần làm gì, trừ khi ngữ cảnh ghi rõ như vậy. Nếu có tài liệu thay thế nhưng không nêu giá trị mới, hãy nói rằng giá trị đó không có trong các đoạn tài liệu được cung cấp.
- Nếu hai sản phẩm tương tự có thể bị nhầm lẫn, hãy nêu rõ câu trả lời áp dụng cho sản phẩm nào.
- Giữ nguyên các số liệu, đơn vị và mã linh kiện bằng tiếng Anh (ví dụ: 558 kWh, 35 N·m, AGS-FILT-6603).""",
}


def human_title(filename: str) -> str:
    stem = re.sub(r"^ags-doc-\d+-", "", filename.removesuffix(".md"))
    return stem.replace("-", " ").title()


# --------------------------------------------------------------------------
# Retrieval
# --------------------------------------------------------------------------
SANDBOX_STATUS: dict = {"checked": False, "ok": False}
SANDBOX_COOLDOWN_UNTIL = 0.0
SANDBOX_TIMEOUT_SECONDS = 20
SANDBOX_COOLDOWN_SECONDS = 120


def run_sandbox_search(question: str, k: int) -> list[dict] | None:
    """Ask the sandbox's own memory search. None means 'could not'.

    Bounded by a short timeout and a cooldown: a wedged sandbox must not add
    tens of seconds to every question on stage.
    """
    global SANDBOX_COOLDOWN_UNTIL
    if not SANDBOX_ON or time.time() < SANDBOX_COOLDOWN_UNTIL:
        return None
    cmd = [
        "nemoclaw", SANDBOX, "exec", "--",
        # TMPDIR must be set: SQLite derives its temp directory from it and
        # memory operations otherwise fail with a misleading database error.
        "env", "TMPDIR=/tmp",
        "openclaw", "memory", "search",
        "--query", question, "--max-results", str(k), "--json",
        # OpenClaw's default floor (0.35) drops every hit for a Vietnamese
        # question over the English manuals (best cosine about 0.3); the local
        # index has no floor at all. The model decides what is relevant.
        "--min-score", "0.2",
    ]
    try:
        with NEMOCLAW_LOCK:
            p = subprocess.run(cmd, capture_output=True, text=True,
                               timeout=SANDBOX_TIMEOUT_SECONDS, env=nemoclaw_env())
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        SANDBOX_COOLDOWN_UNTIL = time.time() + SANDBOX_COOLDOWN_SECONDS
        SANDBOX_STATUS.update(checked=True, ok=False)
        return None
    out = p.stdout or ""
    start = out.find("{")
    if p.returncode != 0 or start < 0:
        SANDBOX_COOLDOWN_UNTIL = time.time() + SANDBOX_COOLDOWN_SECONDS
        SANDBOX_STATUS.update(checked=True, ok=False)
        return None
    SANDBOX_STATUS.update(checked=True, ok=True)
    try:
        data = json.loads(out[start:])
    except json.JSONDecodeError:
        return None
    hits = [{"path": r.get("path", ""), "start": int(r.get("startLine") or 0),
             "end": int(r.get("endLine") or 0), "score": float(r.get("score") or 0.0)}
            for r in data.get("results", []) or []]
    return hits or None


def embed(text: str) -> list[float]:
    payload = json.dumps({"model": EMBED_MODEL, "input": [text]}).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/embed", data=payload,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        vec = json.loads(resp.read().decode())["embeddings"][0]
    n = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / n for x in vec]


_local_cache: dict | None = None


def load_index() -> dict | None:
    """The vector index built with the embedding model in use (vectors from another model are noise)."""
    for f in (LOCAL_INDEX, BUILT_INDEX):
        if f.exists():
            data = json.loads(f.read_text(encoding="utf-8"))
            if data.get("model") == EMBED_MODEL:
                return data
    return None


def local_search(question: str, k: int) -> list[dict] | None:
    """Cosine search over the local index. Used when the sandbox is down or absent."""
    global _local_cache
    if _local_cache is None:
        _local_cache = load_index()
        if _local_cache is None:
            return None
    chunks = _local_cache["chunks"]
    try:
        qv = embed(QWEN3_QUERY_PREFIX + question)
    except (urllib.error.URLError, OSError, TimeoutError, KeyError, json.JSONDecodeError):
        return None
    scored = sorted(((sum(a * b for a, b in zip(qv, c["vector"])), i) for i, c in enumerate(chunks)),
                    key=lambda t: t[0], reverse=True)
    hits, per_doc = [], {}
    for score, i in scored:
        doc = chunks[i]["doc"]
        if per_doc.get(doc, 0) >= 2:
            continue
        per_doc[doc] = per_doc.get(doc, 0) + 1
        # Carry the chunk text itself: returning only the document name made the
        # caller fall back to the document head, which dropped the answer
        # whenever it appeared later in the file.
        hits.append({"path": f"memory/{doc}", "start": 0, "end": 0, "score": score,
                     "text": chunks[i].get("text", ""),
                     "title": chunks[i].get("doc_title") or human_title(doc)})
        if len(hits) == k:
            break
    return hits or None


_corpus_lines: dict[str, list[str]] = {}


def corpus_lines(name: str) -> list[str]:
    if name not in _corpus_lines:
        f = CORPUS / name
        _corpus_lines[name] = f.read_text(encoding="utf-8").splitlines() if f.exists() else []
    return _corpus_lines[name]


def clean_markdown(text: str) -> str:
    text = re.sub(r"^\s*\|.*\|\s*$", "", text, flags=re.M)  # bare table rows
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.M)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def passage_for(hit: dict) -> dict:
    name = hit["path"].split("/")[-1]
    lo, hi = hit["start"], hit["end"]
    if hit.get("text"):
        body = hit["text"]
    else:
        lines = corpus_lines(name)
        body = "\n".join(lines if not lo or not hi else lines[max(0, lo - 1): hi])
    return {"doc": name, "title": hit.get("title") or human_title(name),
            "score": round(hit["score"], 3), "passage": clean_markdown(body)[:2200],
            "lines": f"{lo}-{hi}" if lo and hi else ""}


def retrieve(question: str, k: int, mode: str) -> tuple[list[dict], str]:
    if mode != "local":
        hits = run_sandbox_search(question, k)
        if hits:
            return [passage_for(h) for h in hits], "sandbox"
    hits = local_search(question, k)
    if hits:
        return [passage_for(h) for h in hits], "local-index"
    raise RuntimeError("retrieval unavailable")


def probe_sandbox() -> None:
    """Check the sandbox once, in the background, at startup."""
    try:
        with NEMOCLAW_LOCK:
            r = subprocess.run(["nemoclaw", SANDBOX, "status"], capture_output=True, text=True,
                               timeout=40, env=nemoclaw_env())
        # `status` also succeeds for a sandbox in "Phase: Error".
        SANDBOX_STATUS.update(checked=True, ok=(r.returncode == 0 and "Phase: Ready" in r.stdout))
    except Exception:
        SANDBOX_STATUS.update(checked=True, ok=False)


# --------------------------------------------------------------------------
# Generation + the streamed pipeline
# --------------------------------------------------------------------------
# Repeated after the question: with English passages, Nemotron sometimes
# answered a Vietnamese question in English despite the system prompt.
ANSWER_IN = {"en": "Answer in English.", "vi": "Trả lời bằng tiếng Việt."}


def messages_for(question: str, passages: list[dict], lang: str) -> list[dict]:
    context = "\n\n".join(f"[{i}] {p['title']}\n{p['passage']}" for i, p in enumerate(passages, 1))
    return [{"role": "system", "content": SYSTEM.get(lang, SYSTEM["en"])},
            {"role": "user", "content": f"Context passages:\n\n{context}\n\nQuestion: {question}\n\n"
                                        f"{ANSWER_IN.get(lang, ANSWER_IN['en'])}"}]


def ask_stream(question: str, lang: str, k: int, mode: str, emit) -> None:
    t0 = time.time()
    emit({"event": "step", "id": "search"})
    try:
        passages, source = retrieve(question, k, mode)
    except Exception as exc:  # noqa: BLE001
        emit({"event": "error", "message": str(exc)})
        return
    t_retrieval = time.time()
    emit({"event": "retrieved", "count": len(passages), "sources": passages, "source": source,
          "seconds": round(t_retrieval - t0, 1)})
    emit({"event": "step", "id": "generate"})
    parts, err = [], ""
    try:
        for piece in ollama_chat_stream(common.CHAT_MODEL, messages_for(question, passages, lang),
                                        {"temperature": 0.1, "num_predict": 500}):
            parts.append(piece)
            emit({"event": "delta", "text": piece})
    except Exception as exc:  # noqa: BLE001
        err = str(exc)
    t_end = time.time()
    emit({"event": "answer", "answer": "".join(parts).strip(), "sources": passages,
          "source": source, "error": err, "seconds": round(t_end - t0, 1),
          "retrieval_seconds": round(t_retrieval - t0, 1),
          "generation_seconds": round(t_end - t_retrieval, 1)})


def corpus_list() -> list[dict]:
    docs = []
    for f in sorted(CORPUS.glob("*.md")):
        text = f.read_text(encoding="utf-8")
        docs.append({"doc": f.name, "title": human_title(f.name),
                     "preview": clean_markdown(text)[:280], "words": len(text.split())})
    return docs


def corpus_doc(name: str) -> dict | None:
    if not name or "/" in name or "\\" in name or not name.endswith(".md"):
        return None
    f = CORPUS / name
    if not f.exists():
        return None
    return {"doc": name, "title": human_title(name), "text": f.read_text(encoding="utf-8")}
