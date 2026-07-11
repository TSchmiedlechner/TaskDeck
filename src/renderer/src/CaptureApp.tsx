import { useEffect, useRef, useState } from 'react'

/**
 * The quick-capture spotlight. Zero required fields: type or paste anything,
 * Enter captures to the inbox, Shift+Enter for a newline, Esc dismisses.
 */
export function CaptureApp(): React.JSX.Element {
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    return window.taskdeck.onCaptureShown(() => {
      setText('')
      setDone(false)
      window.setTimeout(() => inputRef.current?.focus(), 30)
    })
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    void window.taskdeck.capture(trimmed)
    setDone(true)
    window.setTimeout(() => {
      void window.taskdeck.closeCapture()
      setText('')
      setDone(false)
    }, 900)
  }

  return (
    <div style={{ background: 'transparent', height: '100vh' }}>
      <div className="capture-card">
        {done ? (
          <div className="capture-done">
            <span>✓</span>
            <span>In inbox — the agent will propose structure in a moment.</span>
          </div>
        ) : (
          <>
            <textarea
              ref={inputRef}
              className="capture-input"
              rows={1}
              placeholder="Type anything — half a sentence, a pasted mail, a URL…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                } else if (e.key === 'Escape') {
                  void window.taskdeck.closeCapture()
                }
              }}
            />
            <div className="capture-hints">
              <span>↵ capture</span>
              <span>⇧↵ newline</span>
              <span>esc dismiss</span>
              <span style={{ flex: 1 }} />
              <span style={{ color: 'var(--text-ghost)' }}>no fields · goes to inbox</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
