import os
import json
import uuid
import asyncio
from datetime import datetime
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from ollama import AsyncClient
import httpx
from urllib.parse import urlparse
# import crawl4ai



# Import psycopg2 for PostgreSQL
try:
    import psycopg2
    from psycopg2 import sql
    _PG_AVAILABLE = True
except ImportError:
    _PG_AVAILABLE = False


# try crawl4ai lib buat crawl and search
try:
    from crawl4ai import AsyncWebCrawler
    _CRAWL4AI_AVAILABLE = True
except Exception:
    AsyncWebCrawler = None
    _CRAWL4AI_AVAILABLE = False


# Configuration from environment
# OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
# OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:0.6b")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")
USE_CRAWL = os.getenv("USE_CRAWL", "true").lower() == "true"
USE_PG = os.getenv("USE_PG", "false").lower() == "true" and _PG_AVAILABLE
CRAWL_API_BASE = os.getenv("CRAWL_API_BASE", "http://localhost:8000").rstrip("/")


# PostgreSQL configuration
PG_CFG = {
    "host": os.getenv("PG_HOST", "localhost"),
    "port": int(os.getenv("PG_PORT", "5432")),
    "dbname": os.getenv("PG_DB", "postgres"),
    "user": os.getenv("PG_USER", "postgres"),
    "password": os.getenv("PG_PASS", ""),
    "schema": os.getenv("PG_SCHEMA", "public"),
    "table": os.getenv("PG_TABLE", ""),
    "text_col": os.getenv("PG_TEXT_COL", ""),
    "custom_sql": os.getenv("PG_SQL", ""),
    "limit": int(os.getenv("PG_LIMIT", "200")),
    "max_chars": int(os.getenv("PG_MAX_CHARS", "30000")),
}

# Data models
class NoteCreate(BaseModel):
    title: str = "Untitled"

class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None

class Note(BaseModel):
    id: str
    title: str
    content: str
    updated_at: str
    created_at: str

class ChatMessage(BaseModel):
    role: str
    content: str

class CrawlRequest(BaseModel):
    urls: List[str]
    limit_chars: int = 8000

class CrawlResponse(BaseModel):
    markdown: str
    sources: List[str]

# Initialize FastAPI
app = FastAPI(title="Notes • Chat • Jupyter API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://frontend:3000"],  # Next.js dev/prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Storage setup
MEMORY_DIR = "./memory"
NOTE_FILE = os.path.join(MEMORY_DIR, "note", "notes.json")
CHAT_FILE = os.path.join(MEMORY_DIR, "chat", "chat_history.json")
SOURCE_FILE = os.path.join(MEMORY_DIR, "source", "source_history.json")

for path in [NOTE_FILE, CHAT_FILE, SOURCE_FILE]:
    os.makedirs(os.path.dirname(path), exist_ok=True)

# Storage utilities
def _now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

def _load_json(path: str, default: Any) -> Any:
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return default

def _save_json(path: str, data: Any):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# Initialize data
notes_data = _load_json(NOTE_FILE, [])
chat_data = _load_json(CHAT_FILE, [
    {"role": "system", "content": "Be concise. Ground in provided web/DB context when present."}
])
url_history_data = _load_json(SOURCE_FILE, [])

def persist_all():
    _save_json(NOTE_FILE, notes_data)
    _save_json(CHAT_FILE, chat_data)
    _save_json(SOURCE_FILE, url_history_data)

# PostgreSQL context function
def build_pg_context(query_text: str) -> str:
    if not USE_PG or not PG_CFG["table"]:
        return ""
    
    try:
        conn = psycopg2.connect(
            host=PG_CFG["host"],
            port=PG_CFG["port"],
            dbname=PG_CFG["dbname"],
            user=PG_CFG["user"],
            password=PG_CFG["password"],
            connect_timeout=5
        )
        
        with conn:
            cur = conn.cursor()
            
            if PG_CFG["custom_sql"]:
                base_sql = PG_CFG["custom_sql"].strip().rstrip(";")
                sql_to_run = base_sql if " limit " in base_sql.lower() else f"{base_sql} LIMIT {PG_CFG['limit']}"
                cur.execute(sql_to_run)
            else:
                like_text = f"%{(query_text or '').strip()[:120]}%"
                query = sql.SQL("""
                    SELECT {text_col} FROM {schema}.{table} 
                    WHERE {text_col} ILIKE %s 
                    ORDER BY 1 DESC 
                    LIMIT %s
                """).format(
                    text_col=sql.Identifier(PG_CFG["text_col"]),
                    schema=sql.Identifier(PG_CFG["schema"]),
                    table=sql.Identifier(PG_CFG["table"])
                )
                cur.execute(query, (like_text, PG_CFG["limit"]))
            
            rows = cur.fetchall()
            return "\n\n---\n\n".join(str(row[0]) for row in rows)[:PG_CFG["max_chars"]]
    
    except Exception as e:
        print(f"PostgreSQL error: {e}")
        return ""
    finally:
        if 'conn' in locals():
            conn.close()

# Crawl function
async def crawl_urls(urls: List[str], limit_chars: int = 8000) -> CrawlResponse:
    # Use Crawl4AI locally (no external crawl service)
    if not USE_CRAWL or not urls:
        return CrawlResponse(markdown="", sources=[])

    if not _CRAWL4AI_AVAILABLE:
        return CrawlResponse(
            markdown="(Crawl error: crawl4ai not installed. pip install crawl4ai)",
            sources=[],
        )

    # sanitize urls
    clean = []
    for u in urls:
        u = (u or "").strip()
        if not u:
            continue
        p = urlparse(u)
        if p.scheme in ("http", "https") and p.netloc:
            clean.append(u)

    if not clean:
        return CrawlResponse(markdown="", sources=[])

    parts = []
    try:
        async with AsyncWebCrawler() as crawler:
            for u in clean:
                try:
                    r = await crawler.arun(u)
                    md = getattr(r, "markdown", None) or ""
                    if not md:
                        md = "(Empty result)"
                    parts.append(f"# Source: {u}\n\n{md}")
                except Exception as e:
                    parts.append(f"# Source: {u}\n\n(Crawl error: {type(e).__name__}: {e})")

        blob = "\n\n---\n\n".join(parts)
        return CrawlResponse(markdown=blob[:limit_chars], sources=clean)
    except Exception as e:
        return CrawlResponse(
            markdown=f"(Crawl error: {type(e).__name__}: {e})",
            sources=clean,
        )

def _ollama_host_ok(url: str) -> bool:
    try:
        p = urlparse(url or "")
        return bool(p.scheme in ("http", "https") and p.hostname)
    except Exception:
        return False


# Routes
@app.get("/")
async def root():
    return {"message": "Notes • Chat • Jupyter API"}

@app.get("/crawl/health")
async def crawl_health():
    return {
        "ok": bool(USE_CRAWL and _CRAWL4AI_AVAILABLE),
        "enabled": bool(USE_CRAWL),
        "crawl4ai_installed": bool(_CRAWL4AI_AVAILABLE),
    }

@app.post("/crawl")
async def crawl_debug(req: CrawlRequest):
    res = await crawl_urls(req.urls, req.limit_chars)
    return res.dict()

# Notes endpoints
@app.get("/notes", response_model=List[Note])
async def get_notes():
    return notes_data

@app.get("/notes/{note_id}")
async def get_note(note_id: str):
    for note in notes_data:
        if note["id"] == note_id:
            return note
    raise HTTPException(status_code=404, detail="Note not found")

@app.post("/notes", response_model=Note)
async def create_note(note_create: NoteCreate):
    note_id = str(uuid.uuid4())
    now = _now()
    
    new_note = {
        "id": note_id,
        "title": note_create.title,
        "content": "",
        "created_at": now,
        "updated_at": now
    }
    
    notes_data.insert(0, new_note)
    persist_all()
    return new_note

@app.put("/notes/{note_id}", response_model=Note)
async def update_note(note_id: str, note_update: NoteUpdate):
    for note in notes_data:
        if note["id"] == note_id:
            if note_update.title is not None:
                note["title"] = note_update.title
            if note_update.content is not None:
                note["content"] = note_update.content
            note["updated_at"] = _now()
            persist_all()
            return note
    
    raise HTTPException(status_code=404, detail="Note not found")

@app.delete("/notes/{note_id}")
async def delete_note(note_id: str):
    global notes_data
    notes_data = [note for note in notes_data if note["id"] != note_id]
    persist_all()
    return {"message": "Note deleted"}

# Chat endpoints
@app.get("/chat/history", response_model=List[ChatMessage])
async def get_chat_history():
    return chat_data

@app.post("/chat/clear")
async def clear_chat_history():
    global chat_data
    chat_data = [
        {"role": "system", "content": "Be concise. Ground in provided web/DB context when present."}
    ]
    persist_all()
    return {"message": "Chat history cleared"}


# WebSocket for real-time chat
@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket connected")

    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") != "chat_message":
                continue

            user_message = data.get("message", "").strip()
            use_crawl = bool(data.get("use_crawl", data.get("useCrawl", False)))
            use_pg = bool(data.get("use_pg", data.get("usePg", False)))
            if not user_message:
                continue

            # Add user message to chat history
            chat_data.append({"role": "user", "content": user_message})

            # Optional contexts
            context_messages = []



            # Accept urls from chat payload OR stored history
            payload_urls = data.get("urls", [])
            crawl_urls_input = list(set(url_history_data + payload_urls))

            if payload_urls:
                url_history_data[:] = list(set(url_history_data + payload_urls))
                persist_all()

            if use_crawl and crawl_urls_input:
                crawl_result = await crawl_urls(crawl_urls_input)
                if crawl_result.markdown:
                    context_messages.append({
                        "role": "system",
                        "content": f"Web context:\n\n{crawl_result.markdown}"
                    })
            if use_pg:
                pg_context = build_pg_context(user_message)
                if pg_context:
                    context_messages.append({
                        "role": "system",
                        "content": f"Database context:\n\n{pg_context}"
                    })

            # Combine system + last 8 messages
            llm_messages = context_messages + chat_data[-8:]

            if not _ollama_host_ok(OLLAMA_HOST):
                await websocket.send_json({
                    "type": "error",
                    "message": f"Ollama host invalid: {OLLAMA_HOST!r}. Set OLLAMA_HOST (e.g. http://localhost:11434)."
                })
                continue

            try:
                client = AsyncClient(host=OLLAMA_HOST)
                full_response = ""
                await websocket.send_json({"type": "status", "stage": "generating"})

                # Correct async stream consumption
                async for event in await client.chat(
                    model=OLLAMA_MODEL,
                    messages=llm_messages,
                    stream=True
                ):
                    msg = event.get("message", {})
                    content = msg.get("content", "")
                    if content:
                        full_response += content
                        # Send partial text immediately to frontend
                        await websocket.send_json({
                            "type": "chunk",
                            "content": content
                        })
                        # Tiny yield keeps loop responsive
                        await asyncio.sleep(0.001)

                # Finalize and persist
                chat_data.append({"role": "assistant", "content": full_response})
                persist_all()
                await websocket.send_json({"type": "complete"})
                print("Response streamed successfully")

            except Exception as e:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Ollama stream failed: {e}"
                })
                await websocket.send_json({"type": "complete"})
                continue

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass

# Source URLs endpoints
@app.get("/sources", response_model=List[str])
async def get_sources():
    return url_history_data

@app.post("/sources")
async def add_sources(urls: List[str]):
    global url_history_data
    # Add new URLs, remove duplicates
    url_history_data = list(set(url_history_data + urls))
    persist_all()
    return {"sources": url_history_data}

@app.delete("/sources")
async def clear_sources():
    global url_history_data
    url_history_data = []
    persist_all()
    return {"message": "Sources cleared"}

@app.get("/ollama/health")
async def ollama_health():
    if not _ollama_host_ok(OLLAMA_HOST):
        raise HTTPException(400, f"Invalid OLLAMA_HOST={OLLAMA_HOST!r}")
    try:
        async with httpx.AsyncClient(timeout=5.0) as hc:
            r = await hc.get(f"{OLLAMA_HOST}/api/tags")
            r.raise_for_status()
        return {"ok": True, "host": OLLAMA_HOST, "model": OLLAMA_MODEL}
    except Exception as e:
        raise HTTPException(502, f"Ollama unreachable: {e}")
    







# ======== NOTEBOOK (Option B: no iframe) ========
import nbformat
from nbclient import NotebookClient
from nbclient.exceptions import CellExecutionError
from pathlib import Path

NOTEBOOK_DIR = Path(os.getenv("NOTEBOOK_DIR", "./notebooks")).resolve()
NOTEBOOK_DIR.mkdir(parents=True, exist_ok=True)

def _safe_nb_path(rel_path: str) -> Path:
    rel_path = (rel_path or "").strip().lstrip("/").replace("\\", "/")
    if not rel_path.endswith(".ipynb"):
        rel_path += ".ipynb"
    p = (NOTEBOOK_DIR / rel_path).resolve()
    if NOTEBOOK_DIR not in p.parents and p != NOTEBOOK_DIR:
        raise HTTPException(status_code=400, detail="Invalid notebook path")
    return p

def _new_notebook() -> nbformat.NotebookNode:
    nb = nbformat.v4.new_notebook()
    nb["metadata"] = {
        "kernelspec": {"name": "python3", "language": "python", "display_name": "Python 3"},
        "language_info": {"name": "python"},
    }
    nb["cells"] = [nbformat.v4.new_markdown_cell("# New notebook")]
    return nb

def _read_nb(path: Path) -> nbformat.NotebookNode:
    if not path.exists():
        nb = _new_notebook()
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            nbformat.write(nb, f)
        return nb
    with open(path, "r", encoding="utf-8") as f:
        return nbformat.read(f, as_version=4)

def _write_nb(path: Path, nb: nbformat.NotebookNode):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        nbformat.write(nb, f)

class NBSaveReq(BaseModel):
    path: str
    notebook: Dict[str, Any]  # raw ipynb json

class NBRunReq(BaseModel):
    path: str
    timeout: int = 120

class NBRunCellReq(BaseModel):
    path: str
    cell_index: int
    timeout: int = 120

@app.get("/nb/list")
async def nb_list():
    items = []
    for p in NOTEBOOK_DIR.rglob("*.ipynb"):
        rel = str(p.relative_to(NOTEBOOK_DIR)).replace("\\", "/")
        items.append(rel)
    items.sort()
    return {"dir": str(NOTEBOOK_DIR), "items": items}

@app.get("/nb/get")
async def nb_get(path: str):
    p = _safe_nb_path(path)
    nb = _read_nb(p)
    return {"path": str(p.relative_to(NOTEBOOK_DIR)).replace("\\", "/"), "notebook": nb}

# tiap save trus run pathnya ada disini, buat jupyter notebook
@app.post("/nb/save")
async def nb_save(req: NBSaveReq):
    p = _safe_nb_path(req.path)
    nb = nbformat.from_dict(req.notebook)
    _write_nb(p, nb)
    return {"ok": True, "path": str(p.relative_to(NOTEBOOK_DIR)).replace("\\", "/")}

def _execute_notebook(nb: nbformat.NotebookNode, timeout: int) -> nbformat.NotebookNode:
    # Stateless execution (fresh kernel each run)
    client = NotebookClient(
        nb,
        kernel_name="python3",
        timeout=timeout,
        allow_errors=True,
        resources={"metadata": {"path": str(NOTEBOOK_DIR)}},
    )
    return client.execute()

# buat save notebook output
def _save_all_notebook_output():
    # Get all outputs from cells executed within the notebook
    outputs = []
    for p in NOTEBOOK_DIR.rglob("*.ipynb"):
        rel_path = str(p.relative_to(NOTEBOOK_DIR)).replace("\\", "/")
        with open(p, "r") as f:
            notebooks = json.load(f)

        output_data = []
        for notebook in notebooks:
            cell_index = int(notebook.get("cells", {}).get("cells", []).index(notebook["cell_id"]))
            try:
                executed_cell = _execute_notebook(notebook["cells"][cell_index], 5)  # 5 seconds timeout
                output_data.append(executed_cell.get("outputs", []))

            except Exception as e:
                print(f"Error executing cell {notebook['cell_id']}: {e}")

        outputs.extend(output_data)

    # Write the output to JSON file
    p = Path(NOTEBOOK_DIR / rel_path).resolve()
    with open(p, "w") as f:
        json.dump(outputs, f)


@app.post("/nb/run_all")
async def nb_run_all(req: NBRunReq):
    p = _safe_nb_path(req.path)
    nb = _read_nb(p)

    try:
        executed = _execute_notebook(nb, req.timeout)
        _write_nb(p, executed)
        return {"ok": True, "path": str(p.relative_to(NOTEBOOK_DIR)).replace("\\", "/"), "notebook": executed}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Notebook execution failed: {type(e).__name__}: {e}")

# ini API buat run specific cell trs return output
@app.post("/nb/run_cell")
async def nb_run_cell(req: NBRunCellReq):
    p = _safe_nb_path(req.path)
    nb = _read_nb(p)

    idx = int(req.cell_index)
    if idx < 0 or idx >= len(nb.cells):
        raise HTTPException(status_code=400, detail="Invalid cell_index")

    # Execute from start up to idx to preserve "state" (still stateless kernel per request)
    partial = nbformat.v4.new_notebook(metadata=nb.metadata)
    partial.cells = [nb.cells[i] for i in range(0, idx + 1)]

    try:
        executed_partial = _execute_notebook(partial, req.timeout)
        executed_cell = executed_partial.cells[-1]

        # Merge outputs back into original notebook for that cell index
        nb.cells[idx]["outputs"] = executed_cell.get("outputs", [])
        nb.cells[idx]["execution_count"] = executed_cell.get("execution_count", None)

        _write_nb(p, nb)

        return {
            "ok": True,
            "path": str(p.relative_to(NOTEBOOK_DIR)).replace("\\", "/"),
            "cell_index": idx,
            "cell": executed_cell,
            "notebook": nb,  # return updated notebook so UI can refresh cleanly
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cell execution failed: {type(e).__name__}: {e}")











# Jupyter info endpoint
# endpoint should look like this http://localhost:8888/?token=tokentolkien
# http://localhost:3000/lab?token=tokentolkien
# @app.get("/jupyter/info")
# async def get_jupyter_info():
#     return {
#         "url": "http://localhost:8888",  # This is the actual Jupyter URL
#         "token": "tokentolkien"
#     }

# --- Jupyter info endpoint (fixed) ---
# Returns a single iframe-ready URL. Frontend should iframe this exact string.

JUPYTER_HOST = os.getenv("JUPYTER_HOST", "http://localhost")
JUPYTER_PORT = int(os.getenv("JUPYTER_PORT", "8888"))
JUPYTER_TOKEN = os.getenv("JUPYTER_TOKEN", "tokentolkien")  # set empty if none
JUPYTER_PATH = os.getenv("JUPYTER_PATH", "/")               # "/", "/lab", "/tree", etc.

def _build_jupyter_iframe_url() -> str:
    base = f"{JUPYTER_HOST.rstrip('/')}:{JUPYTER_PORT}"
    path = "/" + (JUPYTER_PATH or "").lstrip("/")
    # allow "/" or "/lab" etc
    token_qs = f"?token={JUPYTER_TOKEN}" if JUPYTER_TOKEN else ""
    return f"{base}{path}{token_qs}"

@app.get("/jupyter/info")
async def get_jupyter_info():
    iframe_url = _build_jupyter_iframe_url()

    # optional reachability probe (keeps endpoint fast)
    reachable = False
    try:
        async with httpx.AsyncClient(timeout=2.5) as hc:
            r = await hc.get(iframe_url.split("?")[0])
            reachable = r.status_code < 500
    except Exception:
        reachable = False

    return {
        "iframe_url": iframe_url,     # ✅ frontend should iframe this
        "reachable": reachable,
        "host": JUPYTER_HOST,
        "port": JUPYTER_PORT,
        "path": JUPYTER_PATH,
        "token_set": bool(JUPYTER_TOKEN),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)