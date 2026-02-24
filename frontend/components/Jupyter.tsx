import { useEffect, useRef, useState } from "react"

interface Cell {
  id: string
  code: string
  output: string
  error?: string
  executed: boolean
}

export default function Jupyter({ noteId }: { noteId: string }) {
  const [cells, setCells] = useState<Cell[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  /* ---------- WS ---------- */
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8000/ws/jupyter")
    wsRef.current = ws

    ws.onmessage = ev => {
      const data = JSON.parse(ev.data)

      if (data.type === "cell_update" && data.noteId === noteId) {
        setCells(data.cells)
      }
    }

    return () => ws.close()
  }, [noteId])

  /* ---------- Run cell ---------- */
  const runCell = (id: string) => {
    wsRef.current?.send(
      JSON.stringify({
        type: "run_cell",
        noteId,
        cellId: id
      })
    )
  }

  /* ---------- Suggest fix ---------- */
  const suggestFix = (cell: Cell) => {
    wsRef.current?.send(
      JSON.stringify({
        type: "suggest_fix",
        noteId,
        cellId: cell.id,
        code: cell.code,
        error: cell.error
      })
    )
  }

  return (
    <div className="h-full flex flex-col overflow-auto">
      <div className="p-2 border-b font-bold">Jupyter (Note Context)</div>

      <div className="flex-1 overflow-auto p-2 space-y-4">
        {cells.map(c => (
          <div key={c.id} className="border rounded p-2">
            <pre className="bg-black p-2">{c.code}</pre>

            <div className="flex gap-2 mt-2">
              <button
                onClick={() => runCell(c.id)}
                className="bg-green-600 px-3"
              >
                Run
              </button>

              {c.error && (
                <button
                  onClick={() => suggestFix(c)}
                  className="bg-yellow-600 px-3"
                >
                  SugiSuggest
                </button>
              )}
            </div>

            {c.executed && (
              <pre className="bg-gray-900 mt-2 p-2">
                {c.error || c.output}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
