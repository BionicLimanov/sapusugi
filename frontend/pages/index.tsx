'use client'
import React, { useState, useEffect, useRef } from 'react'
import type { Note, ChatMessage, JupyterInfo } from '../types'
import Sidebar from '../components/Sidebar'
import Chat from '../components/Chat'
import Notes from '../components/Notes'
import Notebook from '../components/Notebook'
import { Menu, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

// ======== MARKDOWN RENDERER ========
const renderMarkdown = (text: string) => (
  <div className="prose prose-invert max-w-none text-sm md:text-base leading-relaxed">
    <ReactMarkdown
      remarkPlugins={[remarkGfm as any]}
      rehypePlugins={[rehypeHighlight as any]}
      components={{
        h1: (p) => <h1 {...p} className="text-xl font-bold mt-4 mb-2" />,
        h2: (p) => <h2 {...p} className="text-lg font-semibold mt-3 mb-1" />,
        pre: (p) => <pre {...p} className="bg-gray-800 text-gray-100 rounded-lg p-3 overflow-x-auto my-3" />,
        code: ({ inline, ...p }: any) =>
          inline ? <code {...p} className="bg-gray-800 rounded px-1 py-0.5 text-green-400" /> : <code {...p} />,
        p: (p) => <p {...p} className="mb-2" />,
        ul: (p) => <ul {...p} className="list-disc ml-6 mb-2" />,
        ol: (p) => <ol {...p} className="list-decimal ml-6 mb-2" />,
      }}
    >
      {text}
    </ReactMarkdown>
  </div>
)

// ======== CONFIG ========
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function buildWsUrl(apiBase: string) {
  const u = new URL(apiBase)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = u.pathname.replace(/\/+$/, '') + '/ws/chat'
  u.search = ''
  u.hash = ''
  return u.toString()
}

const WS_URL = buildWsUrl(API_BASE)

async function safeJson(r: Response) {
  const ct = r.headers.get('content-type') || ''
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error(`HTTP ${r.status} ${r.statusText} ${t.slice(0, 200)}`)
  }
  if (!ct.includes('application/json')) {
    const t = await r.text().catch(() => '')
    throw new Error(`Expected JSON, got ${ct} ${t.slice(0, 200)}`)
  }
  return r.json()
}

// ======== MAIN COMPONENT ========
export default function Home() {
  const [notes, setNotes] = useState<Note[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sources, setSources] = useState<string[]>([])
  const [jupyterInfo, setJupyterInfo] = useState<JupyterInfo | null>(null)

  const [ws, setWs] = useState<WebSocket | null>(null)
  const [wsReady, setWsReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [streamingText, setStreamingText] = useState('')

  // Sidebar states
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activePanel, setActivePanel] = useState<'notes' | 'chat'>('notes')

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const streamRef = useRef<string>('')

  // ======== INITIAL FETCH ========
  useEffect(() => {
    ;(async () => {
      try {
        const [n, m, s, j] = await Promise.all([
          fetch(`${API_BASE}/notes`).then(safeJson),
          fetch(`${API_BASE}/chat/history`).then(safeJson),
          fetch(`${API_BASE}/sources`).then(safeJson),
          fetch(`${API_BASE}/jupyter/info`).then(safeJson),
        ])
        setNotes(n)
        setMessages(m)
        setSources(s)
        setJupyterInfo(j)
      } catch (e) {
        console.error('Init fetch failed:', e)
      }
    })()
  }, [])

  // ======== CHAT ========
  const handleNewMessage = (message: string, useCrawl: boolean, usePg: boolean) => {
    if (!ws || !wsReady) {
      console.error('WebSocket not ready')
      return
    }

    setMessages((prev) => [...prev, { role: 'user', content: message }])

    streamRef.current = ''
    setStreamingText('')
    setLoading(true)

    ws.send(
      JSON.stringify({
        type: 'chat_message',
        message,
        use_crawl: useCrawl,
        use_pg: usePg,
        urls: sources,
      }),
    )
  }

  const handleClearChat = async () => {
    try {
      await fetch(`${API_BASE}/chat/clear`, { method: 'POST' }).then(safeJson)
      const hist = await fetch(`${API_BASE}/chat/history`).then(safeJson)
      setMessages(hist)
      streamRef.current = ''
      setStreamingText('')
      setLoading(false)
    } catch (e) {
      console.error('Clear chat failed:', e)
    }
  }

  // ======== WEBSOCKET STREAMING ========
  useEffect(() => {
    console.log('Connecting WebSocket to', WS_URL)
    const socket = new WebSocket(WS_URL)
    let closed = false

    socket.onopen = () => {
      console.log('WebSocket connected')
      setWs(socket)
      setWsReady(true)
    }

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'chunk') {
          if (data.content) {
            setStreamingText((prev) => {
              const next = prev + data.content
              streamRef.current = next
              return next
            })
          }
          return
        }

        if (data.type === 'complete') {
          const finalText = (streamRef.current || '').trim()
          if (finalText) {
            setMessages((prev) => [
              ...prev,
              {
                role: 'assistant',
                content: finalText,
                render: renderMarkdown(finalText),
              },
            ])
          }
          streamRef.current = ''
          setStreamingText('')
          setLoading(false)
          return
        }

        if (data.type === 'error') {
          const msg = `[error] ${data.message || 'unknown error'}`
          streamRef.current = msg
          setStreamingText(msg)
          setLoading(false)
          return
        }
      } catch {
        console.error('Bad WS payload:', event.data)
      }
    }

    socket.onerror = (err) => {
      console.error('WebSocket error:', err)
      setLoading(false)
    }

    socket.onclose = () => {
      console.warn('WebSocket disconnected')
      setWs(null)
      setWsReady(false)

      if (!closed && (streamRef.current || streamingText)) {
        const finalText = (streamRef.current || streamingText).trim()
        if (finalText) {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: finalText, render: renderMarkdown(finalText) },
          ])
        }
      }

      streamRef.current = ''
      setStreamingText('')
      setLoading(false)
    }

    return () => {
      closed = true
      try {
        socket.close()
      } catch {}
    }
  }, [])

  // ======== AUTO-SCROLL ========
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streamingText])

  // ======== NOTES ========
  const handleNoteCreate = async () => {
    try {
      const res = await fetch(`${API_BASE}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled' }),
      }).then(safeJson)
      setNotes((prev) => [res, ...prev])
    } catch (e) {
      console.error('Create note failed:', e)
    }
  }

  const handleNoteUpdate = async (id: string, updates: Partial<Note>) => {
    try {
      const res = await fetch(`${API_BASE}/notes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      }).then(safeJson)
      setNotes((prev) => prev.map((n) => (n.id === id ? res : n)))
    } catch (e) {
      console.error('Update note failed:', e)
    }
  }

  const handleNoteDelete = async (id: string) => {
    try {
      await fetch(`${API_BASE}/notes/${id}`, { method: 'DELETE' }).then(safeJson)
      setNotes((prev) => prev.filter((n) => n.id !== id))
    } catch (e) {
      console.error('Delete note failed:', e)
    }
  }

  const handleNoteDuplicate = async (note: Note) => {
    try {
      const created = await fetch(`${API_BASE}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `${note.title} (copy)` }),
      }).then(safeJson)
      await handleNoteUpdate(created.id, { content: (note as any).content })
      setNotes((prev) => [created, ...prev])
    } catch (e) {
      console.error('Duplicate note failed:', e)
    }
  }

  // ======== SOURCES ========
  const handleSourcesUpdate = async (newSources: string[]) => {
    try {
      const data = await fetch(`${API_BASE}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSources),
      }).then(safeJson)
      setSources(data.sources)
    } catch (e) {
      console.error('Update sources failed:', e)
    }
  }

  // ======== RENDER ========
  return (
    <div className="min-h-screen bg-gray-950 text-white flex overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        activePanel={activePanel}
        onPanelChange={setActivePanel}
        onClose={() => setSidebarOpen(false)}
      >
        {activePanel === 'notes' ? (
          <Notes
            notes={notes}
            onNoteCreate={handleNoteCreate}
            onNoteUpdate={handleNoteUpdate}
            onNoteDelete={handleNoteDelete}
            onNoteDuplicate={handleNoteDuplicate}
          />
        ) : (
          <Chat
            messages={messages}
            onNewMessage={handleNewMessage}
            onClearChat={handleClearChat}
            sources={sources}
            onSourcesUpdate={handleSourcesUpdate}
            streamingText={streamingText}
            loading={loading}
            scrollRef={scrollRef}
            wsReady={wsReady}
          />
        )}
      </Sidebar>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
              aria-label="Toggle sidebar"
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <h1 className="text-xl font-bold tracking-tight">sapusugi</h1>
            <span className="text-xs text-gray-500 font-mono">prototype</span>
          </div>
        </header>

        {/* Notebook - Full height */}
        <div className="flex-1 overflow-hidden p-4">
          <Notebook />
        </div>
      </div>
    </div>
  )
}
