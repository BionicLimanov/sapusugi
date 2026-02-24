import React, { useState, useEffect, useRef } from 'react'
import type { ChatMessage as BaseChatMessage } from '../types'
import { Send, Trash2, Globe, Database } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

type ChatMessageUI = BaseChatMessage & {
  render?: React.ReactNode
}

/** GPT-like markdown renderer with relaxed TS types */
const Markdown: React.FC<{ text: string }> = ({ text }) => (
  <div className="prose prose-invert max-w-none text-sm leading-relaxed">
    <ReactMarkdown
      remarkPlugins={[remarkGfm as any]}
      rehypePlugins={[rehypeHighlight as any]}
      components={{
        h1: (p) => <h1 {...p} className="text-lg font-bold mt-3 mb-2" />,
        h2: (p) => <h2 {...p} className="text-base font-semibold mt-2 mb-1" />,
        pre: (p) => <pre {...p} className="bg-gray-800 text-gray-100 rounded-lg p-2 overflow-x-auto my-2 text-xs" />,
        code: ({ inline, ...p }: any) =>
          inline ? <code {...p} className="bg-gray-800 rounded px-1 py-0.5 text-green-400 text-xs" /> : <code {...p} />,
        p: (p) => <p {...p} className="mb-2" />,
        ul: (p) => <ul {...p} className="list-disc ml-4 mb-2 text-sm" />,
        ol: (p) => <ol {...p} className="list-decimal ml-4 mb-2 text-sm" />,
      }}
    >
      {text}
    </ReactMarkdown>
  </div>
)

interface ChatProps {
  messages: ChatMessageUI[]
  onNewMessage: (message: string, useCrawl: boolean, usePg: boolean) => void
  onClearChat: () => void
  sources: string[]
  onSourcesUpdate: (urls: string[]) => void
  streamingText?: string
  loading?: boolean
  scrollRef?: React.RefObject<HTMLDivElement>
  wsReady?: boolean
}

const Chat: React.FC<ChatProps> = ({
  messages,
  onNewMessage,
  onClearChat,
  sources,
  onSourcesUpdate,
  streamingText = '',
  loading = false,
  scrollRef,
  wsReady = true,
}) => {
  const [input, setInput] = useState('')
  const [useCrawl, setUseCrawl] = useState(false)
  const [usePg, setUsePg] = useState(false)
  const [sourceInput, setSourceInput] = useState('')
  const [showSources, setShowSources] = useState(false)

  const localContainerRef = useRef<HTMLDivElement>(null)
  const containerRef = scrollRef ?? localContainerRef
  const bottomRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    const el = containerRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingText, loading])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    onNewMessage(text, useCrawl, usePg)
    setInput('')
  }

  const addSource = () => {
    if (sourceInput.trim()) {
      const urls = sourceInput.split(',').map(u => u.trim()).filter(Boolean)
      onSourcesUpdate([...sources, ...urls])
      setSourceInput('')
    }
  }

  const removeSource = (index: number) => {
    onSourcesUpdate(sources.filter((_, i) => i !== index))
  }

  const displayed = messages.filter(m => m.role !== 'system')

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header with controls */}
      <div className="p-3 border-b border-gray-800 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-300">AI Assistant</h3>
          <div className="flex items-center gap-2">
            {!wsReady && <span className="text-xs text-yellow-400">Connecting...</span>}
            <button
              onClick={onClearChat}
              className="p-1.5 text-red-400 hover:bg-red-600/20 rounded transition-colors"
              title="Clear chat"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Options */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer hover:text-gray-300">
              <input 
                type="checkbox" 
                checked={useCrawl} 
                onChange={(e) => setUseCrawl(e.target.checked)} 
                className="rounded w-3 h-3" 
              />
              <Globe size={12} />
              <span>Web Search</span>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer hover:text-gray-300">
              <input 
                type="checkbox" 
                checked={usePg} 
                onChange={(e) => setUsePg(e.target.checked)} 
                className="rounded w-3 h-3" 
              />
              <Database size={12} />
              <span>Database</span>
            </label>
          </div>

          {/* Sources Toggle */}
          <button
            onClick={() => setShowSources(!showSources)}
            className="text-xs text-blue-400 hover:text-blue-300 text-left transition-colors"
          >
            {showSources ? '− Hide' : '+ Show'} Sources ({sources.length})
          </button>

          {showSources && (
            <div className="space-y-2 pt-2 border-t border-gray-800">
              <div className="flex gap-1">
                <input
                  type="text"
                  value={sourceInput}
                  onChange={(e) => setSourceInput(e.target.value)}
                  placeholder="Add URLs..."
                  className="flex-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white placeholder-gray-500"
                />
                <button
                  onClick={addSource}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs transition-colors"
                >
                  Add
                </button>
              </div>

              {sources.length > 0 && (
                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                  {sources.map((s, i) => (
                    <span key={i} className="flex items-center gap-1 bg-gray-800 px-2 py-0.5 rounded text-xs text-gray-400">
                      <span className="truncate max-w-[200px]">{s}</span>
                      <button onClick={() => removeSource(i)} className="text-red-400 hover:text-red-300">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3" ref={containerRef}>
        {displayed.map((m, i) => (
          <div 
            key={i} 
            className={`
              rounded-lg p-3 text-sm
              ${m.role === 'user' 
                ? 'bg-blue-600/20 border border-blue-600/30 ml-6' 
                : 'bg-gray-800/50 border border-gray-700/50 mr-6'
              }
            `}
          >
            {m.role === 'assistant'
              ? (m.render ?? <Markdown text={m.content} />)
              : <div className="whitespace-pre-wrap text-sm">{m.content}</div>}
          </div>
        ))}

        {loading && (
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 mr-6">
            {streamingText
              ? <div className="whitespace-pre-wrap text-sm animate-pulse">{streamingText}</div>
              : <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-600"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white p-2 rounded-lg transition-colors"
            title={wsReady ? 'Send message' : 'Connecting...'}
          >
            <Send size={18} />
          </button>
        </div>
      </form>
    </div>
  )
}

export default Chat
