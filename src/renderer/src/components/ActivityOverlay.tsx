import { useEffect, useState } from 'react'
import type { ActivityEntry } from '@shared/types'

const ACTOR_COLORS: Record<ActivityEntry['actor'], string> = {
  you: 'var(--text-chip)',
  agent: 'var(--teal)',
  system: 'var(--amber)'
}

export function ActivityOverlay({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [entries, setEntries] = useState<ActivityEntry[]>([])

  useEffect(() => {
    void window.taskdeck.getActivity(150).then(setEntries)
  }, [])

  return (
    <div className="overlay">
      <div className="overlay-header">
        <span className="label" style={{ color: 'var(--text-dim)' }}>
          Activity
        </span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="overlay-body" style={{ gap: 0 }}>
        {entries.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Nothing yet — capture something.</div>
        )}
        {entries.map((e) => (
          <div
            key={e.id}
            style={{
              display: 'flex',
              gap: 10,
              padding: '7px 0',
              borderBottom: '1px solid var(--border-softer)',
              fontSize: 12,
              lineHeight: 1.5
            }}
          >
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-ghost)', flex: 'none', width: 88 }}>
              {new Date(e.ts).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
            <span className="mono" style={{ fontSize: 10, color: ACTOR_COLORS[e.actor], flex: 'none', width: 40 }}>
              {e.actor}
            </span>
            <span style={{ color: 'var(--text-mid)' }}>{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
