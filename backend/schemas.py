from typing import List, Optional, Dict, Any
from pydantic import BaseModel

# ---- Notes ----
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


# ---- Chat ----
class ChatMessage(BaseModel):
    role: str
    content: str
    render: Optional[Any] = None  # Frontend uses this for React components


# ---- Sources ----
class SourcesUpdate(BaseModel):
    sources: List[str] = []


# ---- Crawl ----
class CrawlRequest(BaseModel):
    urls: List[str]
    limit_chars: int = 8000

class CrawlResponse(BaseModel):
    markdown: str
    sources: List[str]


# ---- Notebook ----
class NBSaveReq(BaseModel):
    path: str
    notebook: Dict[str, Any]

class NBRunReq(BaseModel):
    path: str
    timeout: int = 120

class NBRunCellReq(BaseModel):
    path: str
    cell_index: int
    timeout: int = 120


# ---- model suggestions ----
class NBSuggestReq(BaseModel):
    path: str
    cell_index: int
