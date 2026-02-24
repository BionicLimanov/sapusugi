import React, { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Note } from '../types'
import { Plus, Trash2, Copy, Save } from 'lucide-react'

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false })
import 'react-quill/dist/quill.snow.css'

interface NotesProps {
  notes: Note[]
  onNoteCreate: () => void
  onNoteUpdate: (id: string, updates: Partial<Note>) => void
  onNoteDelete: (id: string) => void
  onNoteDuplicate: (note: Note) => void
}

const Notes: React.FC<NotesProps> = ({
  notes,
  onNoteCreate,
  onNoteUpdate,
  onNoteDelete,
  onNoteDuplicate,
}) => {
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [localNotes, setLocalNotes] = useState<Note[]>(notes)

  useEffect(() => {
    setLocalNotes(notes)
    if (notes.length > 0 && !activeNoteId) {
      setActiveNoteId(notes[0].id)
    }
  }, [notes])

  const activeNote = localNotes.find(note => note.id === activeNoteId)

  const handleTitleChange = (noteId: string, title: string) => {
    onNoteUpdate(noteId, { title })
    setLocalNotes(prev => 
      prev.map(note => 
        note.id === noteId ? { ...note, title } : note
      )
    )
  }

  const handleContentChange = (content: string) => {
    if (activeNote) {
      onNoteUpdate(activeNote.id, { content })
      setLocalNotes(prev =>
        prev.map(note =>
          note.id === activeNote.id ? { ...note, content } : note
        )
      )
    }
  }

  const modules = {
    toolbar: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      ['link', 'blockquote', 'code-block'],
      ['clean']
    ],
  }

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="p-3 border-b border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300">Notepad</h3>
          <button
            onClick={onNoteCreate}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-2 py-1.5 rounded-lg transition-colors text-xs"
          >
            <Plus size={14} />
            New
          </button>
        </div>

        {notes.length > 0 && (
          <select
            value={activeNoteId || ''}
            onChange={(e) => setActiveNoteId(e.target.value)}
            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {localNotes.map(note => (
              <option key={note.id} value={note.id}>
                {note.title} • {new Date(note.updated_at).toLocaleDateString()}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Note Content */}
      {activeNote ? (
        <div className="flex-1 flex flex-col p-3 overflow-hidden">
          <input
            type="text"
            value={activeNote.title}
            onChange={(e) => handleTitleChange(activeNote.id, e.target.value)}
            className="w-full px-3 py-2 mb-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-600"
            placeholder="Note title..."
          />

          <div className="flex-1 mb-3 overflow-hidden rounded-lg border border-gray-700">
            <style jsx global>{`
              .ql-container {
                font-size: 14px;
                height: calc(100% - 42px);
              }
              .ql-editor {
                min-height: 200px;
              }
              .ql-toolbar {
                border-bottom: 1px solid #374151 !important;
                background: #1f2937;
              }
              .ql-container {
                background: #111827;
              }
              .ql-editor {
                color: #fff;
              }
              .ql-stroke {
                stroke: #9ca3af;
              }
              .ql-fill {
                fill: #9ca3af;
              }
              .ql-picker-label {
                color: #9ca3af;
              }
            `}</style>
            <ReactQuill
              value={activeNote.content}
              onChange={handleContentChange}
              modules={modules}
              theme="snow"
              className="h-full"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => onNoteUpdate(activeNote.id, {})}
              className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors text-xs"
            >
              <Save size={14} />
              Save
            </button>
            <button
              onClick={() => onNoteDuplicate(activeNote)}
              className="flex items-center gap-1.5 bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1.5 rounded-lg transition-colors text-xs"
            >
              <Copy size={14} />
              Duplicate
            </button>
            <button
              onClick={() => onNoteDelete(activeNote.id)}
              className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition-colors text-xs"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm p-6 text-center">
          No notes yet. Create your first note to get started!
        </div>
      )}
    </div>
  )
}

export default Notes
