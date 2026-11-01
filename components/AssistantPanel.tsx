'use client'
import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useRestaurant } from '@/lib/restaurant'
import { supabase } from '@/lib/supabase'

/*
 * "Ask getinvoiceIQ" — a slide-over chat with the read-only data agent
 * (app/api/assistant). It answers questions about the current
 * restaurant's invoices, purchases, prices and sales ("how much
 * chicken did I buy this week?"). The thread is kept per restaurant
 * in localStorage so it survives navigation.
 */

type ChatMsg = { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  'How much chicken did I buy this week?',
  'What did I spend at Restaurant Depot this month?',
  'Which prices went up recently?',
  'How is my food cost looking this month?',
]

export default function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useAuth()
  const { current } = useRestaurant()
  const restaurantId = current?.id
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const storageKey = restaurantId ? `mise.assistant.${restaurantId}` : null

  // Load this restaurant's thread when the panel opens / restaurant changes.
  useEffect(() => {
    if (!open || !storageKey) return
    try {
      const raw = localStorage.getItem(storageKey)
      setMessages(raw ? (JSON.parse(raw) as ChatMsg[]) : [])
    } catch {
      setMessages([])
    }
  }, [open, storageKey ])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending, open])

  function persist(next: ChatMsg[]) {
    setMessages(next)
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next.slice(-40)))
      } catch {
        /* storage full/blocked — the thread just won't persist */
      }
    }
  }

  async function send(text: string) {
    const content = text.trim()
    if (!content || sending || !restaurantId) return
    const next: ChatMsg[] = [...messages, { role: 'user', content }]
    persist(next)
    setInput('')
    setSending(true)
    try {
      let token = session?.access_token
      if (!token) {
        const { data } = await supabase.auth.getSession()
        token = data.session?.access_token
      }
      const now = new Date()
      const resp = await fetch('/api/assistant', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          messages: next,
          today: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
          weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
        }),
      })
      const data = (await resp.json().catch(() => ({}))) as { reply?: string; error?: string }
      const reply = resp.ok && data.reply ? data.reply : `Sorry — I couldn't check that just now. ${data.error ? `(${data.error})` : 'Please try again.'}`
      persist([...next, { role: 'assistant', content: reply }])
    } catch {
      persist([...next, { role: 'assistant', content: "Sorry — I couldn't reach the assistant. Check your connection and try again." }])
    } finally {
      setSending(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[390px] max-w-[92vw] flex-col bg-cream-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b px-4 py-3.5">
          <Sparkles size={16} className="text-pop" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink">Ask getinvoiceIQ</div>
            <div className="truncate text-[11px] text-ink-muted">
              {current?.name} — answers from your invoices & sales
            </div>
          </div>
          {messages.length > 0 && (
            <button onClick={() => persist([])} className="text-xs text-ink-muted transition hover:text-ink-2">
              Clear
            </button>
          )}
          <button onClick={onClose} className="text-ink-muted transition hover:text-ink-2">
            <X size={16} />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div>
              <p className="text-sm text-ink-muted">
                Ask me anything about this restaurant’s purchases, prices, suppliers or sales. For example:
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-lg border border-pop/25 bg-pop/10 px-3 py-2 text-left text-sm text-ink transition hover:bg-pop/15"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'self-end bg-ink text-cream'
                      : 'self-start bg-cream-surface-alt text-ink-2'
                  }`}
                >
                  {m.content}
                </div>
              ))}
              {sending && (
                <div className="flex items-center gap-2 self-start px-1 text-sm text-ink-muted">
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                  Checking your books…
                </div>
              )}
            </div>
          )}
        </div>

        <form
          className="flex items-center gap-2 border-t px-3 py-3"
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your invoices…"
            className="min-w-0 flex-1 rounded-lg border border-ink/[0.16] bg-cream-surface px-3 py-2.5 text-sm text-ink focus:border-terracotta focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink text-cream transition hover:bg-black disabled:opacity-40"
            title="Send"
          >
            <Send size={15} />
          </button>
        </form>
      </div>
    </>
  )
}
