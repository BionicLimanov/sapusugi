'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'

/* =========================
   Types
   ========================= */
type NotebookCell = {
  cell_type: 'code' | 'markdown'
  source: string | string[]
  outputs?: any[]
  execution_count?: number | null
  metadata?: Record<string, any>
}

type NotebookDoc = {
  cells: NotebookCell[]
  metadata?: Record<string, any>
  nbformat?: number
  nbformat_minor?: number
}

/* =========================
   API base
   ========================= */
const API_BASE = (() => {
  const v = process.env.NEXT_PUBLIC_API_URL
  if (!v) return 'http://localhost:8000'
  return v.replace(/\/$/, '')
})()

/* =========================
   Safe fetch
   ========================= */
async function safeJSON<T>(
  url: string,
  opts?: RequestInit,
  timeoutMs = 8000
): Promise<T> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      credentials: 'omit',
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || `${res.status} ${res.statusText}`)
    }

    return (await res.json()) as T
  } finally {
    clearTimeout(id)
  }
}

/* =========================
   Output Renderer
   ========================= */
function OutputView({ outputs }: { outputs: any[] }) {
  if (!Array.isArray(outputs) || outputs.length === 0) return null

  return (
    <div className="mt-2 space-y-2">
      {outputs.map((o, i) => {
        if (o?.output_type === 'stream') {
          return (
            <pre key={i} className="bg-black/50 border border-gray-800 rounded-lg p-3 text-xs overflow-x-auto text-green-400 font-mono">
              {Array.isArray(o.text) ? o.text.join('') : o.text}
            </pre>
          )
        }

        if (o?.output_type === 'error') {
          return (
            <pre key={i} className="bg-red-950/50 border border-red-800/50 rounded-lg p-3 text-xs text-red-300 overflow-x-auto font-mono">
              {(o.traceback && o.traceback.join('\n')) || `${o.ename}: ${o.evalue}`}
            </pre>
          )
        }

        const d = o?.data || {}

        if (d['text/plain']) {
          return (
            <pre key={i} className="bg-black/50 border border-gray-800 rounded-lg p-3 text-xs overflow-x-auto text-gray-300 font-mono">
              {Array.isArray(d['text/plain']) ? d['text/plain'].join('') : d['text/plain']}
            </pre>
          )
        }

        if (d['image/png']) {
          return (
            <img
              key={i}
              src={`data:image/png;base64,${d['image/png']}`}
              className="max-w-full rounded-lg border border-gray-800 shadow-lg"
              alt="output"
            />
          )
        }

        return (
          <pre key={i} className="bg-black/50 border border-gray-800 rounded-lg p-3 text-xs overflow-x-auto text-gray-400 font-mono">
            {JSON.stringify(o, null, 2)}
          </pre>
        )
      })}
    </div>
  )
}

/* =========================
   Notebook Component
   ========================= */
export default function Notebook() {
  const mounted = useRef(false)

  const [files, setFiles] = useState<string[]>([])
  const [path, setPath] = useState('main.ipynb')
  const [nb, setNb] = useState<NotebookDoc | null>(null)

  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState<number | null>(null)
  const [err, setErr] = useState<string>('')

  const cells = useMemo(
    () => (Array.isArray(nb?.cells) ? nb!.cells : []),
    [nb]
  )

  /* =========================
     API calls
     ========================= */
  async function loadList() {
    const data = await safeJSON<any>(`${API_BASE}/nb/list`)
    setFiles(data.items || [])
  }

  async function loadNotebook(p: string) {
    const data = await safeJSON<any>(`${API_BASE}/nb/get?path=${encodeURIComponent(p)}`)
    setPath(data.path)
    setNb(data.notebook)
  }

  async function saveNotebook(doc?: NotebookDoc) {
    if (!nb && !doc) return
    setSaving(true)
    try {
      await safeJSON(`${API_BASE}/nb/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, notebook: doc || nb }),
      })
      await loadList()
    } finally {
      setSaving(false)
    }
  }

  async function runCell(i: number) {
    if (!nb) return
    setRunning(i)
    try {
      await saveNotebook()
      const data = await safeJSON<any>(`${API_BASE}/nb/run_cell`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, cell_index: i, timeout: 120 }),
      })
      setNb(data.notebook)
    } finally {
      setRunning(null)
    }
  }

  async function runAll() {
    if (!nb) return
    setRunning(-1)
    try {
      await saveNotebook()
      const data = await safeJSON<any>(`${API_BASE}/nb/run_all`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, timeout: 300 }),
      })
      setNb(data.notebook)
    } finally {
      setRunning(null)
    }
  }

  /* =========================
     Sugisuggest (LLM hook)
     ========================= */
  async function sugisuggest(cellIndex: number) {
    const r = await safeJSON<{ suggestion: string }>(`${API_BASE}/nb/suggest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path,
        cell_index: cellIndex,
      }),
    })

    alert(r.suggestion)
  }

  /* =========================
     Cell ops
     ========================= */
  function updateCellSource(i: number, src: string) {
    if (!nb) return
    const next = structuredClone(nb)
    next.cells[i].source = src
    setNb(next)
  }

  function addCell(kind: 'code' | 'markdown') {
    if (!nb) return
    const next = structuredClone(nb)
    next.cells.push({
      cell_type: kind,
      source: '',
      metadata: {},
      outputs: kind === 'code' ? [] : undefined,
      execution_count: kind === 'code' ? null : undefined,
    })
    setNb(next)
  }

  function deleteCell(i: number) {
    if (!nb || nb.cells.length <= 1) return
    const next = structuredClone(nb)
    next.cells.splice(i, 1)
    setNb(next)
  }

  /* =========================
     Init
     ========================= */
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    ;(async () => {
      await loadList()
      await loadNotebook(path)
    })()
  }, [])

  /* =========================
     Render
     ========================= */
  return (
    <div className="h-full flex flex-col bg-gray-900 rounded-xl border border-gray-800 overflow-hidden shadow-2xl">
      {/* Toolbar */}
      <div className="bg-gradient-to-r from-gray-900 to-gray-800 border-b border-gray-700 px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-white">Notebook</div>
          <select
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-600 transition-all"
            value={path}
            onChange={(e) => loadNotebook(e.target.value)}
          >
            {[path, ...files.filter((f) => f !== path)].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <button 
            onClick={() => addCell('code')} 
            className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-1.5 rounded-lg text-sm border border-gray-700 transition-all hover:border-gray-600"
          >
            + Code
          </button>

          <button 
            onClick={() => addCell('markdown')} 
            className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-1.5 rounded-lg text-sm border border-gray-700 transition-all hover:border-gray-600"
          >
            + Markdown
          </button>

          <button 
            onClick={runAll} 
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-all shadow-lg shadow-green-600/30"
            disabled={running !== null}
          >
            {running === -1 ? 'Running...' : 'Run All'}
          </button>

          <button 
            onClick={() => saveNotebook()} 
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-all shadow-lg shadow-blue-600/30"
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {err && (
        <div className="px-4 py-2 text-xs bg-red-950/50 border-b border-red-900/50 text-red-300">
          {err}
        </div>
      )}

      {/* Cells */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {cells.map((c, i) => (
          <div 
            key={i} 
            className="group rounded-xl border border-gray-800 bg-gradient-to-br from-gray-950 to-gray-900 p-4 hover:border-gray-700 transition-all"
          >
            {/* Cell Header */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-gray-500 font-mono">
                [{c.cell_type === 'code' ? (c.execution_count || ' ') : 'md'}]
              </span>
              
              <div className="flex-1" />

              {c.cell_type === 'code' && (
                <>
                  <button 
                    onClick={() => runCell(i)} 
                    className="bg-green-700 hover:bg-green-600 text-white px-3 py-1 rounded-lg text-xs font-medium transition-all opacity-0 group-hover:opacity-100"
                    disabled={running === i}
                  >
                    {running === i ? 'Running...' : 'Run'}
                  </button>

                  <button
                    onClick={() => sugisuggest(i)}
                    className="bg-purple-700 hover:bg-purple-600 text-white px-3 py-1 rounded-lg text-xs font-medium transition-all opacity-0 group-hover:opacity-100"
                  >
                    SUGIsugest
                  </button>
                </>
              )}

              <button 
                onClick={() => deleteCell(i)} 
                className="bg-gray-800 hover:bg-red-600 text-gray-400 hover:text-white px-3 py-1 rounded-lg text-xs transition-all opacity-0 group-hover:opacity-100"
              >
                Delete
              </button>
            </div>

            {/* Cell Content */}
            <textarea
              className="w-full min-h-[120px] bg-black/50 border border-gray-800 rounded-lg p-3 text-sm font-mono text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent resize-y"
              value={typeof c.source === 'string' ? c.source : c.source?.join('') ?? ''}
              onChange={(e) => updateCellSource(i, e.target.value)}
              placeholder={c.cell_type === 'code' ? '# Write your code here...' : 'Write markdown...'}
            />

            {/* Cell Output */}
            {c.cell_type === 'code' && <OutputView outputs={c.outputs || []} />}
          </div>
        ))}

        {cells.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500 text-sm">
            <p className="mb-4">No cells in this notebook</p>
            <div className="flex gap-2">
              <button 
                onClick={() => addCell('code')} 
                className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm"
              >
                Add Code Cell
              </button>
              <button 
                onClick={() => addCell('markdown')} 
                className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm"
              >
                Add Markdown Cell
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
