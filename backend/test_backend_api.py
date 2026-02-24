#!/usr/bin/env python3
"""
Test script for "Notes • Chat • Jupyter API"
- Probes root
- CRUD cycle for /notes
- /chat/history and /chat/clear
- /sources add/list/clear
- /jupyter/info
- Optional websocket streaming to /ws/chat (skipped if --skip-ws)

Usage:
  python test_backend_api.py --base http://localhost:8000
  python test_backend_api.py --base http://localhost:8000 --skip-ws
"""

import asyncio
import json
import sys
import argparse
from urllib.parse import urlparse, urlunparse

import httpx

try:
    import websockets
except Exception:
    websockets = None  # handled via --skip-ws

def http_to_ws(url: str) -> str:
    p = urlparse(url)
    scheme = "wss" if p.scheme == "https" else "ws"
    return urlunparse((scheme, p.netloc, p.path, p.params, p.query, p.fragment))

async def probe_root(client: httpx.AsyncClient) -> None:
    r = await client.get("/")
    r.raise_for_status()
    print("[OK] GET / ->", r.json())

async def notes_crud(client: httpx.AsyncClient) -> None:
    # list
    r = await client.get("/notes")
    r.raise_for_status()
    before = r.json()
    print(f"[OK] GET /notes -> {len(before)} notes")

    # create
    r = await client.post("/notes", json={"title": "Test Note"})
    r.raise_for_status()
    note = r.json()
    nid = note["id"]
    print("[OK] POST /notes ->", note)

    # update
    r = await client.put(f"/notes/{nid}", json={"title": "Updated Title", "content": "Hello from tester"})
    r.raise_for_status()
    updated = r.json()
    assert updated["title"] == "Updated Title"
    assert updated["content"] == "Hello from tester"
    print("[OK] PUT /notes/{id} ->", updated)

    # get single
    r = await client.get(f"/notes/{nid}")
    r.raise_for_status()
    got = r.json()
    print("[OK] GET /notes/{id} ->", got)

    # delete
    r = await client.delete(f"/notes/{nid}")
    r.raise_for_status()
    print("[OK] DELETE /notes/{id} ->", r.json())

async def chat_history_flow(client: httpx.AsyncClient) -> None:
    r = await client.get("/chat/history")
    r.raise_for_status()
    hist = r.json()
    roles = [m.get('role') for m in hist[:3]]
    print(f"[OK] GET /chat/history -> {len(hist)} messages (first roles: {roles})")

    r = await client.post("/chat/clear")
    r.raise_for_status()
    print("[OK] POST /chat/clear ->", r.json())

async def sources_flow(client: httpx.AsyncClient) -> None:
    # initial list
    r = await client.get("/sources")
    r.raise_for_status()
    initial = r.json()
    print(f"[OK] GET /sources -> {len(initial)} urls")

    # add
    sample = ["https://example.com", "https://www.python.org"]
    r = await client.post("/sources", json=sample)
    r.raise_for_status()
    print("[OK] POST /sources ->", r.json())

    # list again
    r = await client.get("/sources")
    r.raise_for_status()
    after = r.json()
    print(f"[OK] GET /sources (after add) -> {len(after)} urls")

    # clear
    r = await client.delete("/sources")
    r.raise_for_status()
    print("[OK] DELETE /sources ->", r.json())

async def jupyter_info(client: httpx.AsyncClient) -> None:
    r = await client.get("/jupyter/info")
    r.raise_for_status()
    print("[OK] GET /jupyter/info ->", r.json())

async def ws_chat(base: str, message: str = "Hello from test script", timeout: float = 20.0) -> None:
    if websockets is None:
        print("[SKIP] websockets not installed. Install with: pip install websockets   (or pass --skip-ws)")
        return

    # Ensure no double slash
    base = base.rstrip("/")
    ws_url = http_to_ws(base) + "/ws/chat"
    print(f"[INFO] Connecting WS -> {ws_url}")
    try:
        async with websockets.connect(ws_url, ping_interval=None, close_timeout=5) as ws:
            payload = {
                "type": "chat_message",
                "message": message,
                "use_crawl": False,
                "use_pg": False,
            }
            await ws.send(json.dumps(payload))

            full = []
            try:
                while True:
                    msg = await asyncio.wait_for(ws.recv(), timeout=timeout)
                    data = json.loads(msg)
                    if data.get("type") == "chunk":
                        frag = data.get("content", "")
                        full.append(frag)
                        if frag:
                            print(f"[WS] chunk: {frag[:60].replace('\\n',' ')}{'...' if len(frag)>60 else ''}")
                    elif data.get("type") == "complete":
                        print("[WS] complete")
                        break
                    elif data.get("type") == "error":
                        print("[WS] error:", data.get("message"))
                        break
            except asyncio.TimeoutError:
                print("[WARN] WS timed out waiting for completion; partial length:", sum(len(x) for x in full))

            combined = "".join(full)
            print(f"[OK] WS combined length = {len(combined)}")
    except Exception as e:
        print(f"[WARN] WebSocket connection failed: {e} (Ollama or server may be unavailable)")

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000", help="API base URL (default: http://localhost:8000)")
    ap.add_argument("--skip-ws", action="store_true", help="Skip websocket chat test")
    ap.add_argument("--timeout", type=float, default=20.0, help="Websocket receive timeout seconds")
    args = ap.parse_args()

    async with httpx.AsyncClient(base_url=args.base, timeout=30.0) as client:
        await probe_root(client)
        await notes_crud(client)
        await chat_history_flow(client)
        await sources_flow(client)
        await jupyter_info(client)

    if not args.skip_ws:
        await ws_chat(args.base, timeout=args.timeout)

    print("\nAll checks done.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(130)



# nge test backend
# python test_backend_api.py --base http://localhost:8000 --skip-ws