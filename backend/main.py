import os
import json
import uuid
import asyncio
from datetime import datetime
from typing import List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
from urllib.parse import urlparse
from ollama import AsyncClient

from schemas import (
    Note, NoteCreate, NoteUpdate,
    ChatMessage, CrawlRequest, CrawlResponse,
    SourcesUpdate
)
from notebooks import router as notebook_router

# ---------------- config ----------------

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")

MEMORY_DIR = "./memory"
NOTE_FILE = f"{MEMORY_DIR}/note/notes.json"
CHAT_FILE = f"{MEMORY_DIR}/chat/chat_history.json"
SOURCE_FILE = f"{MEMORY_DIR}/source/source_history.json"

for f in [NOTE_FILE, CHAT_FILE, SOURCE_FILE]:
    os.makedirs(os.path.dirname(f), exist_ok=True)


# ---------------- helpers ----------------

def _now():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

def _load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default

def _save(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


notes = _load(NOTE_FILE, [])
chat = _load(CHAT_FILE, [{"role": "system", "content": "Be concise."}])
sources = _load(SOURCE_FILE, [])


# ---------------- app ----------------

app = FastAPI(title="Notes • Chat • Jupyter API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(notebook_router)


# ---------------- notes ----------------

@app.get("/notes", response_model=List[Note])
async def get_notes():
    return notes


@app.post("/notes", response_model=Note)
async def create_note(req: NoteCreate):
    n = {
        "id": str(uuid.uuid4()),
        "title": req.title,
        "content": "",
        "created_at": _now(),
        "updated_at": _now(),
    }
    notes.insert(0, n)
    _save(NOTE_FILE, notes)
    return n


@app.put("/notes/{note_id}", response_model=Note)
async def update_note(note_id: str, req: NoteUpdate):
    for n in notes:
        if n["id"] == note_id:
            if req.title is not None:
                n["title"] = req.title
            if req.content is not None:
                n["content"] = req.content
            n["updated_at"] = _now()
            _save(NOTE_FILE, notes)
            return n
    raise HTTPException(404, "Note not found")


@app.delete("/notes/{note_id}")
async def delete_note(note_id: str):
    global notes
    original_len = len(notes)
    notes = [n for n in notes if n["id"] != note_id]
    
    if len(notes) == original_len:
        raise HTTPException(404, "Note not found")
    
    _save(NOTE_FILE, notes)
    return {"ok": True, "deleted": note_id}


# ---------------- chat ----------------

@app.get("/chat/history", response_model=List[ChatMessage])
async def chat_history():
    return chat


@app.post("/chat/clear")
async def clear_chat():
    global chat
    chat = [{"role": "system", "content": "Be concise."}]
    _save(CHAT_FILE, chat)
    return {"ok": True}


@app.websocket("/ws/chat")
async def ws_chat(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type", "")
            
            # Handle chat messages
            if msg_type == "chat_message":
                msg = data.get("message", "").strip()
                if not msg:
                    await ws.send_json({"type": "error", "message": "Empty message"})
                    continue

                use_crawl = data.get("use_crawl", False)
                use_pg = data.get("use_pg", False)
                urls = data.get("urls", [])

                # Add user message to chat history
                chat.append({"role": "user", "content": msg})

                # Prepare context (you can extend this with crawl/pg logic)
                context_prefix = ""
                if use_crawl and urls:
                    context_prefix = f"[Using web search with sources: {', '.join(urls[:3])}]\n\n"
                if use_pg:
                    context_prefix += "[Using database context]\n\n"

                # Stream response from Ollama
                client = AsyncClient(host=OLLAMA_HOST)
                full = ""

                try:
                    async for ev in await client.chat(
                        model=OLLAMA_MODEL,
                        messages=chat[-8:],  # Keep last 8 messages for context
                        stream=True,
                    ):
                        part = ev["message"]["content"]
                        full += part
                        await ws.send_json({"type": "chunk", "content": part})

                    # Save assistant response
                    chat.append({"role": "assistant", "content": full})
                    _save(CHAT_FILE, chat)
                    await ws.send_json({"type": "complete"})
                    
                except Exception as e:
                    error_msg = f"Error during chat: {str(e)}"
                    await ws.send_json({"type": "error", "message": error_msg})
            
            else:
                await ws.send_json({"type": "error", "message": f"Unknown message type: {msg_type}"})
                
    except WebSocketDisconnect:
        print("WebSocket disconnected")
    except Exception as e:
        print(f"WebSocket error: {e}")
        try:
            await ws.send_json({"type": "error", "message": str(e)})
        except:
            pass


# ---------------- sources ----------------

@app.get("/sources")
async def get_sources():
    return sources


@app.post("/sources")
async def update_sources(new_sources: List[str]):
    global sources
    sources = new_sources
    _save(SOURCE_FILE, sources)
    return {"sources": sources}


# ---------------- jupyter ----------------

@app.get("/jupyter/info")
async def jupyter_info():
    return {
        "iframe_url": "http://localhost:8888/lab",
        "reachable": True,
    }


# ---------------- health check ----------------

@app.get("/")
async def root():
    return {
        "status": "running",
        "endpoints": {
            "notes": "/notes",
            "chat": "/chat/history",
            "websocket": "/ws/chat",
            "sources": "/sources",
            "notebooks": "/nb",
            "jupyter": "/jupyter/info"
        }
    }
