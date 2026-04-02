'use client'
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const FABRIC_OPTIONS = [
  { id: null, label: 'All Capabilities', icon: '🧠' },
  { id: 'finance', label: 'Finance', icon: '💰' },
  { id: 'hr', label: 'HR', icon: '👥' },
  { id: 'payroll', label: 'Payroll', icon: '💷' },
  { id: 'compliance', label: 'Compliance', icon: '⚖️' },
  { id: 'assets', label: 'Assets', icon: '🏗️' },
]

const SUGGESTED = [
  "What's the trial balance for this month?",
  "Run payroll for December 2024",
  "Show me all overdue maintenance",
  "Generate the Q4 Gift Aid claim",
  "Who has pending leave requests?",
  "Summarise the compliance dashboard",
]

interface Message { role: 'user' | 'assistant'; content: string; ts: Date }

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Jai Shri Krishna 🙏\n\nI'm the Digital Brain — your AI assistant for Shital Temple. I have access to all platform capabilities: finance, payroll, HR, assets, compliance, and more.\n\nHow can I assist you today?",
      ts: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedFabric, setSelectedFabric] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg: Message = { role: 'user', content: text, ts: new Date() }
    setMessages((m) => [...m, userMsg])
    setInput('')
    setLoading(true)

    try {
      const token = localStorage.getItem('shital_token') || ''
      const response = await fetch(`${API}/brain/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
          fabric: selectedFabric,
        }),
      })
      const data = await response.json()
      setMessages((m) => [...m, { role: 'assistant', content: data.response || 'I encountered an error. Please try again.', ts: new Date() }])
    } catch {
      setMessages((m) => [...m, {
        role: 'assistant',
        content: '⚠️ I cannot connect to the backend right now. Please ensure the Python API is running.',
        ts: new Date(),
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-64px)] animate-fade-in">
      {/* Main chat */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-saffron-gradient flex items-center justify-center text-2xl shadow-saffron-lg">🧠</div>
          <div>
            <h1 className="text-2xl font-black text-white">Digital Brain</h1>
            <p className="text-white/40 text-sm">Powered by Claude · Agentic AI · {FABRIC_OPTIONS.find(f => f.id === selectedFabric)?.label || 'All Capabilities'}</p>
          </div>
          {/* Fabric filter */}
          <div className="ml-auto flex gap-2 flex-wrap justify-end">
            {FABRIC_OPTIONS.map((f) => (
              <button
                key={String(f.id)}
                onClick={() => setSelectedFabric(f.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                  selectedFabric === f.id
                    ? 'bg-saffron-400/20 text-saffron-400 border border-saffron-400/30'
                    : 'glass text-white/40 hover:text-white/70'
                }`}
              >
                {f.icon} {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4">
          <AnimatePresence>
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div className={`w-9 h-9 rounded-2xl flex items-center justify-center text-sm font-bold flex-shrink-0 ${msg.role === 'assistant' ? 'bg-saffron-gradient' : 'bg-white/10 text-white'}`}>
                  {msg.role === 'assistant' ? '🧠' : 'U'}
                </div>
                <div className={`max-w-[75%] rounded-2xl px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'assistant'
                    ? 'glass text-white/85 rounded-tl-none'
                    : 'bg-saffron-gradient text-white rounded-tr-none'
                }`}>
                  {msg.content}
                  <p className="text-[10px] opacity-40 mt-2">
                    {msg.ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-3"
            >
              <div className="w-9 h-9 rounded-2xl bg-saffron-gradient flex items-center justify-center text-sm">🧠</div>
              <div className="glass rounded-2xl rounded-tl-none px-5 py-4">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.div key={i} className="w-2 h-2 rounded-full bg-saffron-400"
                      animate={{ y: [0, -6, 0] }} transition={{ duration: 0.6, delay: i * 0.15, repeat: Infinity }} />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="glass rounded-2xl p-4">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
            placeholder="Ask the Digital Brain anything... (Enter to send, Shift+Enter for new line)"
            className="w-full bg-transparent text-white placeholder-white/30 text-sm resize-none focus:outline-none min-h-[60px] max-h-[160px]"
            rows={2}
          />
          <div className="flex items-center justify-between mt-3">
            <p className="text-white/20 text-xs">Shift+Enter for new line</p>
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              className="btn-primary px-6 py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send →
            </button>
          </div>
        </div>
      </div>

      {/* Suggestions sidebar */}
      <div className="w-72 space-y-4">
        <div className="glass rounded-2xl p-5">
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">Try asking...</h3>
          <div className="space-y-2">
            {SUGGESTED.map((s) => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                className="w-full text-left px-4 py-3 rounded-xl glass text-white/60 text-xs hover:text-white hover:bg-white/5 transition-all leading-relaxed"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">Digital DNA</h3>
          <p className="text-white/40 text-xs leading-relaxed mb-3">
            The Digital Brain has access to all registered micro-capabilities across all Foundation Fabrics.
          </p>
          <a href="/api/v1/dna" target="_blank" className="text-saffron-400 text-xs hover:text-saffron-300">
            View capability registry →
          </a>
        </div>
      </div>
    </div>
  )
}
