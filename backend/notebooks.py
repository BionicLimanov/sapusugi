import os
from pathlib import Path
from typing import Any, Dict, List

import nbformat
from nbclient import NotebookClient
from fastapi import APIRouter, HTTPException

from ollama import AsyncClient

from schemas import (
    NBSaveReq,
    NBRunReq,
    NBRunCellReq,
    NBSuggestReq,
)

# -------------------------
# Config
# -------------------------

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")

NOTEBOOK_DIR = Path(os.getenv("NOTEBOOK_DIR", "./notebooks")).resolve()
NOTEBOOK_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/nb", tags=["notebooks"])


# -------------------------
# Helpers
# -------------------------

def _safe_nb_path(rel_path: str) -> Path:
    rel_path = (rel_path or "").strip().lstrip("/").replace("\\", "/")
    if not rel_path.endswith(".ipynb"):
        rel_path += ".ipynb"

    p = (NOTEBOOK_DIR / rel_path).resolve()
    if NOTEBOOK_DIR not in p.parents and p != NOTEBOOK_DIR:
        raise HTTPException(400, "Invalid notebook path")
    return p


def _read_nb(path: Path) -> nbformat.NotebookNode:
    if not path.exists():
        nb = nbformat.v4.new_notebook()
        nb.cells = [nbformat.v4.new_markdown_cell("# New notebook")]
        path.parent.mkdir(parents=True, exist_ok=True)
        nbformat.write(nb, path)
        return nb

    try:
        return nbformat.read(path, as_version=4)
    except Exception as e:
        raise HTTPException(500, f"Failed to read notebook: {str(e)}")


def _write_nb(path: Path, nb: nbformat.NotebookNode):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        nbformat.write(nb, path)
    except Exception as e:
        raise HTTPException(500, f"Failed to write notebook: {str(e)}")


def _execute(nb: nbformat.NotebookNode, timeout: int):
    try:
        client = NotebookClient(
            nb,
            kernel_name="python3",
            timeout=timeout,
            allow_errors=True,
            resources={"metadata": {"path": str(NOTEBOOK_DIR)}},
        )
        return client.execute()
    except Exception as e:
        # Even if execution fails, return the notebook with error outputs
        print(f"Execution error: {e}")
        return nb


def _outputs_to_text(outputs: List[Dict[str, Any]]) -> str:
    lines: List[str] = []

    for o in outputs:
        if o.get("output_type") == "stream":
            txt = o.get("text", "")
            if isinstance(txt, list):
                lines.append("".join(txt))
            else:
                lines.append(txt)

        elif o.get("output_type") == "error":
            en = o.get("ename", "")
            ev = o.get("evalue", "")
            tb = o.get("traceback", [])
            lines.append(f"{en}: {ev}")
            if tb:
                lines.extend(tb)

        elif "data" in o and "text/plain" in o["data"]:
            tp = o["data"]["text/plain"]
            if isinstance(tp, list):
                lines.append("".join(tp))
            else:
                lines.append(tp)

    return "\n".join(lines).strip()


# -------------------------
# Routes
# -------------------------

@router.get("/list")
async def list_notebooks():
    try:
        items = [
            str(p.relative_to(NOTEBOOK_DIR)).replace("\\", "/")
            for p in NOTEBOOK_DIR.rglob("*.ipynb")
        ]
        return {
            "dir": str(NOTEBOOK_DIR),
            "items": sorted(items),
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to list notebooks: {str(e)}")


@router.get("/get")
async def get_notebook(path: str):
    p = _safe_nb_path(path)
    nb = _read_nb(p)
    return {
        "path": path,
        "notebook": nb,
    }


@router.post("/save")
async def save_notebook(req: NBSaveReq):
    p = _safe_nb_path(req.path)
    try:
        nb = nbformat.from_dict(req.notebook)
        _write_nb(p, nb)
        return {"ok": True, "path": req.path}
    except Exception as e:
        raise HTTPException(500, f"Failed to save notebook: {str(e)}")


@router.post("/run_all")
async def run_all(req: NBRunReq):
    p = _safe_nb_path(req.path)
    nb = _read_nb(p)

    executed = _execute(nb, req.timeout)
    _write_nb(p, executed)

    return {
        "ok": True,
        "path": req.path,
        "notebook": executed,
    }


@router.post("/run_cell")
async def run_cell(req: NBRunCellReq):
    p = _safe_nb_path(req.path)
    nb = _read_nb(p)

    idx = req.cell_index
    if idx < 0 or idx >= len(nb.cells):
        raise HTTPException(400, f"Invalid cell_index: {idx} (notebook has {len(nb.cells)} cells)")

    # Create a partial notebook with cells up to and including the target cell
    partial = nbformat.v4.new_notebook(metadata=nb.metadata)
    partial.cells = nb.cells[: idx + 1]

    executed = _execute(partial, req.timeout)
    
    # Extract the executed cell
    if len(executed.cells) > idx:
        cell = executed.cells[idx]
        
        # Update the original notebook with the execution results
        nb.cells[idx].outputs = cell.get("outputs", [])
        nb.cells[idx].execution_count = cell.get("execution_count")

        _write_nb(p, nb)

        return {
            "ok": True,
            "path": req.path,
            "cell_index": idx,
            "cell": {
                "source": cell.source,
                "outputs": cell.get("outputs", []),
                "execution_count": cell.get("execution_count"),
            },
            "notebook": nb,
        }
    else:
        raise HTTPException(500, "Cell execution failed")


@router.post("/suggest")
async def suggest_fix(req: NBSuggestReq):
    p = _safe_nb_path(req.path)
    nb = _read_nb(p)

    idx = req.cell_index
    if idx < 0 or idx >= len(nb.cells):
        raise HTTPException(400, f"Invalid cell_index: {idx}")

    cell = nb.cells[idx]

    source = cell.source or ""
    outputs = cell.get("outputs", [])
    output_text = _outputs_to_text(outputs)

    # Build the prompt based on whether there's an error or not
    if output_text and ("error" in output_text.lower() or "traceback" in output_text.lower()):
        prompt = (
            "You are debugging a Jupyter notebook cell.\n\n"
            "Cell source:\n"
            "```python\n"
            f"{source}\n"
            "```\n\n"
            "Cell output / error:\n"
            "```\n"
            f"{output_text}\n"
            "```\n\n"
            "Explain the root cause and propose a corrected version of the code.\n"
            "Return strictly:\n"
            "1. Short explanation\n"
            "2. Corrected code only\n"
        )
    else:
        prompt = (
            "You are reviewing a Jupyter notebook cell.\n\n"
            "Cell source:\n"
            "```python\n"
            f"{source}\n"
            "```\n\n"
            "Suggest improvements to make this code better (performance, readability, best practices).\n"
            "Return strictly:\n"
            "1. Short explanation\n"
            "2. Improved code\n"
        )

    try:
        client = AsyncClient(host=OLLAMA_HOST)

        full = ""
        async for ev in await client.chat(
            model=OLLAMA_MODEL,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
        ):
            full += ev["message"]["content"]

        return {
            "suggestion": full.strip()
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to generate suggestion: {str(e)}")
