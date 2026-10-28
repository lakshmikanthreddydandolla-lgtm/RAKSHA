import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  ApiError,
  approveReview,
  connectAI,
  createUser,
  deleteUser,
  denyReview,
  disconnectAI,
  getAttackScenarios,
  getAuditEvents,
  getPolicy,
  getReviews,
  getSessions,
  resetPolicy,
  resetUserSession,
  runAttackScenario,
  runTamperDemo,
  sendAgentMessage,
  updatePolicy,
  verifyAudit,
  type AttackRunResult,
  type AttackScenario,
  type AuditEvent,
  type AuditVerify,
  type LiveSessionSummary,
  type Policy,
  type ProviderMode,
  type Review,
} from '../api'
import { RakshaCore, type MotionMode, type SecurityState, type ThemeMode } from '../scene/RakshaCore'

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

function ErrorLine({ error }: { error: string }) {
  return error ? <div className="status-capsule error">{error}</div> : null
}

export function ProviderSelection({
  onChoose,
  onBack,
}: {
  onChoose: (provider: ProviderMode) => void
  onBack: () => void
}) {
  return (
    <section className="provider-stage workflow-stage">
      <button className="context-back" type="button" onClick={onBack}>← BACK</button>
      <div className="provider-eruption" aria-hidden="true">
        <span /> <span /> <span /> <span /> <span />
      </div>
      <div className="provider-copy">
        <p className="eyebrow">COMMAND CENTER</p>
        <h2>Select intelligence source</h2>
        <p>RAKSHA remains the execution authority regardless of the model behind the agent.</p>
      </div>
      <div className="provider-cards">
        <button type="button" className="provider-card" onClick={() => onChoose('demo')}>
          <span className="provider-index">01</span>
          <strong>DEMO MODEL</strong>
          <small>Deterministic · Judge-safe · Offline</small>
          <span className="provider-enter">ENTER</span>
        </button>
        <button type="button" className="provider-card local" onClick={() => onChoose('ollama')}>
          <span className="provider-index">02</span>
          <strong>LOCAL AI</strong>
          <small>Ollama · llama3.2 · 30s timeout</small>
          <span className="provider-enter">VERIFY & ENTER</span>
        </button>
        <button type="button" className="provider-card future" onClick={() => onChoose('real')}>
          <span className="provider-index">03</span>
          <strong>REAL AI</strong>
          <small>External provider adapter · Future scope</small>
          <span className="provider-enter">PREVIEW</span>
        </button>
      </div>
    </section>
  )
}

type ChatMessage = { role: 'user' | 'assistant'; text: string }

type ReviewPrompt = {
  reviewId: string
  risk: number
  reasons: string[]
  action: string
  resource: string
  destination: string
}

export function CommandCenter({
  provider,
  theme,
  motion,
  onBack,
  onDisconnect,
}: {
  provider: ProviderMode
  theme: ThemeMode
  motion: MotionMode
  onBack: () => void
  onDisconnect: () => void
}) {
  const [sessions, setSessions] = useState<LiveSessionSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [newName, setNewName] = useState('')
  const [chatBySession, setChatBySession] = useState<Record<string, ChatMessage[]>>({})
  const [message, setMessage] = useState('')
  const [thinking, setThinking] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [security, setSecurity] = useState<SecurityState>('normal')
  const [review, setReview] = useState<ReviewPrompt | null>(null)
  const [reviewExit, setReviewExit] = useState<'box' | 'bin' | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selected = sessions.find((session) => session.session_id === selectedId) || sessions[0]
  const chat = selected ? chatBySession[selected.session_id] || [] : []
  const brainLabel = provider === 'demo' ? 'DEMO' : provider === 'ollama' ? 'LOCAL' : 'REAL'

  const refreshSessions = async (preferred?: string) => {
    const result = await getSessions()
    setSessions(result.sessions)
    const next = preferred || selectedId || result.sessions[0]?.session_id || ''
    if (next && result.sessions.some((session) => session.session_id === next)) setSelectedId(next)
    else setSelectedId(result.sessions[0]?.session_id || '')
  }

  useEffect(() => {
    refreshSessions().catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load users'))
  }, [])

  const connectSession = async (session: LiveSessionSummary) => {
    if (provider === 'real') return
    setError('')
    setNotice(provider === 'ollama' ? 'CHECKING LOCAL MODEL' : 'STARTING JUDGE MODE')
    try {
      await connectAI(session.session_id, provider, session.display_name, provider === 'ollama' ? 'llama3.2' : undefined)
      setNotice(provider === 'ollama' ? 'LOCAL AI CONNECTED' : 'DEMO MODEL READY')
      await refreshSessions(session.session_id)
      window.setTimeout(() => setNotice(''), 1600)
    } catch (cause) {
      const text = cause instanceof ApiError && cause.code === 'OLLAMA_UNAVAILABLE'
        ? `OLLAMA UNAVAILABLE · ${cause.message}`
        : cause instanceof Error ? cause.message : 'Connection failed'
      setError(text)
      setNotice('')
    }
  }

  const createNamedUser = async (event: FormEvent) => {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return
    setError('')
    try {
      const user = await createUser(name)
      setNewName('')
      await refreshSessions(user.session_id)
      await connectSession(user)
      setChatBySession((current) => ({
        ...current,
        [user.session_id]: [{ role: 'assistant', text: provider === 'real'
          ? 'External model adapters are presented as future scope in this finale build.'
          : 'Session ready. Ask the agent to perform a task and RAKSHA will govern any proposed action.' }],
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create user')
    }
  }

  const selectUser = async (session: LiveSessionSummary) => {
    setSelectedId(session.session_id)
    setBlocked(session.contained)
    setSecurity(session.contained ? 'block' : session.latest_verdict === 'REVIEW' ? 'review' : 'normal')
    if (!session.connected && provider !== 'real') await connectSession(session)
  }

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected || !message.trim() || thinking || blocked || provider === 'real') return
    const text = message.trim()
    setMessage('')
    setThinking(true)
    setError('')
    setChatBySession((current) => ({
      ...current,
      [selected.session_id]: [...(current[selected.session_id] || []), { role: 'user', text }],
    }))
    try {
      const result = await sendAgentMessage(selected.session_id, text)
      setChatBySession((current) => ({
        ...current,
        [selected.session_id]: [...(current[selected.session_id] || []), { role: 'assistant', text: result.assistant_message }],
      }))
      const critical = result.results.find((item) => item.decision.verdict === 'BLOCK')
      const needsReview = result.results.find((item) => item.decision.verdict === 'REVIEW' && item.decision.review_id)
      if (critical) {
        setSecurity('block')
        setBlocked(true)
      } else if (needsReview) {
        const decision = needsReview.decision
        setSecurity('review')
        setReview({
          reviewId: decision.review_id!,
          risk: decision.risk_score,
          reasons: decision.reasons,
          action: decision.action.operation,
          resource: decision.action.resource,
          destination: decision.action.destination,
        })
      } else {
        setSecurity('normal')
      }
      if (result.fallback_reason) setNotice(result.fallback_reason)
      await refreshSessions(selected.session_id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Agent request failed')
    } finally {
      setThinking(false)
    }
  }

  const resolveReview = async (decision: 'allow' | 'deny') => {
    if (!review) return
    try {
      if (decision === 'allow') await approveReview(review.reviewId)
      else await denyReview(review.reviewId)
      setReviewExit(decision === 'allow' ? 'box' : 'bin')
      await sleep(650)
      setReview(null)
      setReviewExit(null)
      setSecurity('normal')
      setNotice(decision === 'allow' ? 'DECISION ARCHIVED · ALLOWED' : 'DECISION ARCHIVED · DENIED')
      window.setTimeout(() => setNotice(''), 1500)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not resolve review')
    }
  }

  const resetBlockedSession = async () => {
    if (!selected) return
    try {
      await resetUserSession(selected.session_id)
      setBlocked(false)
      setSecurity('normal')
      setChatBySession((current) => ({ ...current, [selected.session_id]: [] }))
      await refreshSessions(selected.session_id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reset failed')
    }
  }

  const removeSelectedUser = async () => {
    if (!selected) return
    try {
      await deleteUser(selected.session_id)
      setChatBySession((current) => {
        const next = { ...current }
        delete next[selected.session_id]
        return next
      })
      setBlocked(false)
      setSecurity('normal')
      await refreshSessions('')
      setNotice('USER DELETED')
      window.setTimeout(() => setNotice(''), 1400)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Delete failed')
    }
  }

  const disconnect = async () => {
    setDisconnecting(true)
    setSecurity('offline')
    try {
      if (provider !== 'real') await disconnectAI()
      await sleep(800)
      onDisconnect()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Disconnect failed')
      setDisconnecting(false)
      setSecurity('normal')
    }
  }

  return (
    <section className={`command-workspace workflow-stage ${sidebarOpen ? '' : 'sidebar-collapsed'} ${blocked ? 'is-blocked' : ''}`}>
      <button className="context-back" type="button" onClick={onBack}>← PROVIDERS</button>
      {notice && <div className="status-capsule">{notice}</div>}
      <ErrorLine error={error} />

      <aside className="command-sidebar">
        <button type="button" className="sidebar-toggle" onClick={() => setSidebarOpen((value) => !value)}>{sidebarOpen ? '‹' : '›'}</button>
        {sidebarOpen && <>
          <div className="sidebar-heading"><span>ACTIVE USERS</span><strong>{sessions.length}</strong></div>
          <form className="new-user-form" onSubmit={createNamedUser}>
            <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Enter user name" maxLength={48} />
            <button type="submit">+</button>
          </form>
          <div className="user-list">
            {sessions.map((session) => (
              <button
                type="button"
                key={session.session_id}
                className={`user-row ${selected?.session_id === session.session_id ? 'active' : ''}`}
                onClick={() => selectUser(session)}
              >
                <span className={`presence ${session.contained ? 'contained' : session.connected ? 'online' : ''}`} />
                <span><strong>{session.display_name}</strong><small>{session.status} · {session.latest_risk ?? 0} risk</small></span>
              </button>
            ))}
          </div>
          <div className="sidebar-section">
            <span>PROVIDER</span>
            <strong>{provider === 'demo' ? 'RAKSHA DEMO' : provider === 'ollama' ? 'OLLAMA · LLAMA3.2' : 'EXTERNAL ADAPTER'}</strong>
          </div>
          {selected && <div className="sidebar-section">
            <span>SESSION</span>
            <strong>{selected.status}</strong>
            <small>{selected.history_length} governed actions</small>
          </div>}
        </>}
      </aside>

      <main className="command-core-zone">
        <div className={`brain-workbench ${disconnecting ? 'disconnecting' : ''}`}>
          <RakshaCore theme={theme} motion={motion} label={brainLabel} security={security} compact />
        </div>
        {selected ? <div className="selected-user-label">{selected.display_name}</div> : <div className="selected-user-label muted">CREATE A USER TO BEGIN</div>}

        {blocked && (
          <div className="crt-block-screen">
            <div className="crt-line" />
            <div className="block-copy">
              <span>CRITICAL ACTION PREVENTED</span>
              <strong>BLOCKED</strong>
              <p>Session contained by RAKSHA.</p>
              <div className="block-actions">
                <button type="button" onClick={resetBlockedSession}>RESET SESSION</button>
                <button type="button" className="danger" onClick={removeSelectedUser}>DELETE USER</button>
              </div>
            </div>
          </div>
        )}
      </main>

      <section className="chat-panel">
        <div className="chat-header">
          <span>AGENT CONVERSATION</span>
          <button className="disconnect-button" type="button" onClick={disconnect} disabled={disconnecting}>
            <span className="disconnect-brain"><i /><i /></span>
            {disconnecting ? 'SHUTTING DOWN' : 'DISCONNECT'}
          </button>
        </div>
        <div className="chat-scroll">
          {provider === 'real' && <div className="future-scope-card">
            <strong>EXTERNAL AI ADAPTER</strong>
            <p>This entrance demonstrates future provider integration. Finale execution uses the Demo Model or local Ollama so the security demo has no usage bill.</p>
          </div>}
          {!selected && provider !== 'real' && <div className="empty-chat">Create a named user from the left panel.</div>}
          {chat.map((item, index) => <div key={`${item.role}-${index}`} className={`chat-message ${item.role}`}>{item.text}</div>)}
          {thinking && <div className="chat-message assistant thinking">Thinking<span>...</span></div>}
        </div>
        <form className="chat-composer" onSubmit={sendMessage}>
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={provider === 'real' ? 'Future-scope provider preview' : selected ? 'Message the agent…' : 'Create a user first'}
            disabled={!selected || thinking || blocked || provider === 'real'}
          />
          <button type="submit" disabled={!selected || thinking || blocked || provider === 'real'}>SEND</button>
        </form>
      </section>

      {review && (
        <div className={`review-overlay ${reviewExit ? `review-${reviewExit}` : ''}`}>
          <div className="review-window">
            <p className="eyebrow">HUMAN APPROVAL REQUIRED</p>
            <h3>RAKSHA paused this action.</h3>
            <div className="review-facts">
              <span><small>ACTION</small>{review.action}</span>
              <span><small>RESOURCE</small>{review.resource || 'n/a'}</span>
              <span><small>DESTINATION</small>{review.destination || 'local'}</span>
              <span><small>RISK</small>{review.risk}/100</span>
            </div>
            <ul>{review.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}</ul>
            <div className="review-actions">
              <button type="button" className="allow" onClick={() => resolveReview('allow')}>ALLOW</button>
              <button type="button" className="deny" onClick={() => resolveReview('deny')}>DENY</button>
            </div>
          </div>
          {reviewExit === 'box' && <div className="decision-destination archive-box">▣</div>}
          {reviewExit === 'bin' && <div className="decision-destination deny-bin">⌫</div>}
        </div>
      )}
    </section>
  )
}

const severityScore: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }
const ranks = ['JOKER', 'KING', 'QUEEN', 'JACK', '10', '9', '8', '7', '6', '5', '4', '3', '2', 'ACE', 'K', 'Q', 'J', '10B', '9B', '8B']

function suitFor(category: string) {
  const value = category.toLowerCase()
  if (value.includes('authorization') || value.includes('governance')) return { symbol: '♠', name: 'SPADES' }
  if (value.includes('prompt') || value.includes('agent')) return { symbol: '♥', name: 'HEARTS' }
  if (value.includes('data') || value.includes('network') || value.includes('sequence')) return { symbol: '♦', name: 'DIAMONDS' }
  return { symbol: '♣', name: 'CLUBS' }
}

export function RedTeamLab({ onBack }: { onBack: () => void }) {
  const [scenarios, setScenarios] = useState<AttackScenario[]>([])
  const [selected, setSelected] = useState<AttackScenario | null>(null)
  const [result, setResult] = useState<AttackRunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getAttackScenarios().then((data) => setScenarios(data.scenarios)).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load attack deck'))
  }, [])

  const ranked = useMemo(() => [...scenarios].sort((a, b) => {
    const severity = (severityScore[b.severity] || 0) - (severityScore[a.severity] || 0)
    if (severity) return severity
    const verdictWeight = (b.expected_verdict === 'BLOCK' ? 2 : b.expected_verdict === 'REVIEW' ? 1 : 0) - (a.expected_verdict === 'BLOCK' ? 2 : a.expected_verdict === 'REVIEW' ? 1 : 0)
    return verdictWeight
  }), [scenarios])

  const run = async () => {
    if (!selected) return
    setRunning(true)
    setError('')
    try {
      setResult(await runAttackScenario(selected.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Attack simulation failed')
    } finally {
      setRunning(false)
    }
  }

  if (selected) {
    const index = ranked.findIndex((scenario) => scenario.id === selected.id)
    const rank = ranks[index] || String(Math.max(2, 20 - index))
    const suit = index === 0 ? { symbol: '★', name: 'JOKER' } : suitFor(selected.category)
    return (
      <section className="redteam-detail workflow-stage">
        <button className="context-back" type="button" onClick={() => { setSelected(null); setResult(null) }}>× ATTACK DECK</button>
        <ErrorLine error={error} />
        <div className={`attack-hero suit-${suit.name.toLowerCase()}`}>
          <div className="attack-card-focus">
            <span className="card-rank">{rank}</span>
            <span className="card-suit">{suit.symbol}</span>
            <strong>{selected.name}</strong>
            <small>{selected.severity} · {selected.expected_verdict}</small>
          </div>
          <div className="attack-metaphor" aria-hidden="true">
            <div className="metaphor-crown" />
            <div className="metaphor-figure">{suit.symbol}</div>
            <div className="metaphor-path"><i /><i /><i /></div>
          </div>
          <div className="attack-description">
            <p className="eyebrow">{selected.category}</p>
            <h2>{selected.name}</h2>
            <p>{selected.description}</p>
            <button type="button" className="run-attack" onClick={run} disabled={running}>{running ? 'RUNNING…' : 'RUN ATTACK'}</button>
          </div>
        </div>
        <div className={`attack-timeline ${result ? 'visible' : ''}`}>
          {result ? result.events.map((event, step) => (
            <div className={`timeline-step verdict-${event.verdict.toLowerCase()}`} key={`${event.action.tool}-${step}`}>
              <div className="timeline-node">{step + 1}</div>
              <div className="timeline-body">
                <span>STEP {String(step + 1).padStart(2, '0')}</span>
                <strong>{event.action.operation} · {event.action.resource || event.action.tool}</strong>
                <small>{event.action.destination || 'local'}</small>
                <div className="risk-meter"><i style={{ width: `${Math.min(100, event.risk_score)}%` }} /></div>
                <b>{event.risk_score}/100 · {event.verdict}</b>
                <p>{event.reasons[0] || 'RAKSHA evaluated the step in sequence context.'}</p>
              </div>
            </div>
          )) : <div className="timeline-placeholder">Run the selected scenario to unfold its governed attack sequence.</div>}
          {result && <div className={`timeline-final verdict-${result.final_verdict.toLowerCase()}`}><strong>RAKSHA DECISION</strong><span>{result.final_verdict} · {result.final_risk_score}/100</span></div>}
        </div>
      </section>
    )
  }

  return (
    <section className="redteam-stage workflow-stage">
      <button className="context-back" type="button" onClick={onBack}>← CORE HUB</button>
      <ErrorLine error={error} />
      <div className="redteam-title"><p className="eyebrow">RED-TEAM LAB</p><h2>Threat Deck</h2><p>Risk stays numeric. Rank and suit make the attack hierarchy memorable.</p></div>
      <div className="attack-deck">
        {ranked.map((scenario, index) => {
          const rank = ranks[index] || String(index + 2)
          const suit = index === 0 ? { symbol: '★', name: 'JOKER' } : suitFor(scenario.category)
          return (
            <button
              type="button"
              key={scenario.id}
              className={`attack-card suit-${suit.name.toLowerCase()}`}
              style={{ '--drop-delay': `${Math.min(index * 38, 520)}ms` } as React.CSSProperties}
              onClick={() => setSelected(scenario)}
            >
              <span className="card-rank">{rank}</span>
              <span className="card-suit">{suit.symbol}</span>
              <strong>{scenario.name}</strong>
              <small>{scenario.severity}</small>
              <em>{scenario.expected_verdict}</em>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function HumanGovernance({ onBack }: { onBack: () => void }) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [branch, setBranch] = useState<'accepted' | 'denied' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getReviews().then((data) => setReviews(data.reviews)).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load governance history'))
  }, [])

  const rows = branch === 'accepted'
    ? reviews.filter((review) => review.status === 'APPROVED')
    : branch === 'denied'
      ? reviews.filter((review) => review.status === 'DENIED')
      : []

  return (
    <section className="governance-stage workflow-stage">
      <button className="context-back" type="button" onClick={onBack}>← CORE HUB</button>
      <ErrorLine error={error} />
      <div className="governance-heading"><p className="eyebrow">HUMAN GOVERNANCE</p><h2>Decision architecture</h2></div>
      <div className="governance-tree">
        <div className="governance-root"><span>HUMAN<br />DECISIONS</span></div>
        <div className="tree-trunk" />
        <div className="governance-nodes">
          <button type="button" className={`governance-node box ${branch === 'accepted' ? 'active' : ''}`} onClick={() => setBranch(branch === 'accepted' ? null : 'accepted')}><span>▣</span><strong>ACCEPTED</strong></button>
          <button type="button" className={`governance-node bin ${branch === 'denied' ? 'active' : ''}`} onClick={() => setBranch(branch === 'denied' ? null : 'denied')}><span>⌫</span><strong>DENIED</strong></button>
        </div>
        <div className={`governance-branch ${branch ? 'open' : ''}`}>
          {branch && <>
            <button type="button" className="branch-close" onClick={() => setBranch(null)}>×</button>
            <p className="eyebrow">{branch === 'accepted' ? 'ARCHIVE BOX' : 'DENIAL BIN'}</p>
            <h3>{branch === 'accepted' ? 'Accepted decisions' : 'Denied decisions'}</h3>
            <div className="governance-log">
              {rows.length ? rows.map((review) => (
                <article key={review.review_id}>
                  <span>{new Date(review.created_at).toLocaleTimeString()}</span>
                  <strong>{review.action.operation} · {review.action.resource || review.action.tool}</strong>
                  <small>{review.risk_score}/100 · {review.final_outcome || review.status}</small>
                </article>
              )) : <p className="empty-state">No decisions in this branch yet.</p>}
            </div>
          </>}
        </div>
      </div>
    </section>
  )
}

export function EvidenceCenter({ onBack }: { onBack: () => void }) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [verification, setVerification] = useState<AuditVerify | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [tampered, setTampered] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getAuditEvents().then((data) => setEvents(data.events.slice(-18))).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load evidence'))
  }, [])

  const verify = async () => {
    setVerifying(true)
    setError('')
    try {
      const result = await verifyAudit()
      await sleep(850)
      setVerification(result)
      setTampered(result.invalid_index)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  const simulateTamper = async () => {
    setVerifying(true)
    try {
      const result = await runTamperDemo()
      await sleep(700)
      setTampered(result.invalid_index ?? result.tampered_index)
      setVerification({ event_count: events.length, chain_valid: result.chain_valid, invalid_index: result.invalid_index, merkle_root: '' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tamper demo failed')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <section className="evidence-stage workflow-stage">
      <button className="context-back" type="button" onClick={onBack}>← CORE HUB</button>
      <ErrorLine error={error} />
      <div className="vault-header"><p className="eyebrow">EVIDENCE CENTER</p><h2>Forensic chain vault</h2><p>Every capsule is one locally recorded security event.</p></div>
      <div className={`evidence-chain ${verifying ? 'verifying' : ''}`}>
        {events.length ? events.map((event, index) => {
          const expanded = selected === index
          return (
            <button
              type="button"
              key={event.event_id || `${event.seq}-${index}`}
              className={`evidence-capsule ${expanded ? 'expanded' : ''} ${tampered === index ? 'fractured' : ''}`}
              onClick={() => setSelected(expanded ? null : index)}
            >
              <span className="capsule-seq">{String(event.seq).padStart(3, '0')}</span>
              <strong>{event.type.replaceAll('_', ' ')}</strong>
              <small>{event.session_id}</small>
              {expanded && <div className="evidence-record">
                <p><b>TIME</b>{event.timestamp}</p>
                <p><b>SESSION</b>{event.session_id}</p>
                <p><b>EVENT</b>{event.type.replaceAll('_', ' ')}</p>
                <p><b>SUMMARY</b>{String(event.data?.verdict || event.data?.action?.toString?.() || 'Recorded by RAKSHA')}</p>
                <details><summary>Technical details</summary><code>{event.event_hash}</code><code>{event.prev_hash}</code></details>
              </div>}
            </button>
          )
        }) : <div className="empty-state">Generate security activity in Command Center or Red-Team Lab to populate the vault.</div>}
        <div className={`verification-node ${verification?.chain_valid ? 'verified' : verification && !verification.chain_valid ? 'failed' : ''}`}>
          <span>VERIFY</span>
        </div>
      </div>
      <div className="evidence-actions">
        <button type="button" onClick={verify} disabled={verifying}>{verifying ? 'VERIFYING…' : 'VERIFY EVIDENCE'}</button>
        <button type="button" onClick={simulateTamper} disabled={verifying || !events.length}>SIMULATE TAMPER</button>
      </div>
      {verification && <div className={`verification-result ${verification.chain_valid ? 'ok' : 'bad'}`}>
        <strong>{verification.chain_valid ? 'EVIDENCE VERIFIED' : 'TAMPERING DETECTED'}</strong>
        <span>{verification.chain_valid ? 'The verification pulse traversed the complete chain.' : `Verification fractured at record ${verification.invalid_index ?? tampered ?? 'unknown'}.`}</span>
      </div>}
    </section>
  )
}

function policyFace(policy: Policy) {
  const { allow_max, review_max } = policy.thresholds
  if (allow_max >= 45 || review_max <= allow_max + 5 || review_max >= 90) return '😟'
  if (allow_max >= 35 || review_max >= 80) return '😐'
  return '😄'
}

export function Policies({ onBack }: { onBack: () => void }) {
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [userInput, setUserInput] = useState('')
  const [toolInput, setToolInput] = useState('read_file')
  const [knighting, setKnighting] = useState<string | null>(null)
  const [inspect, setInspect] = useState<{ kind: 'user' | 'tool'; value: string } | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    getPolicy().then(setPolicy).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load policy'))
  }, [])

  const save = async (next: Policy) => {
    setPolicy(next)
    try {
      setPolicy(await updatePolicy(next))
      setNotice('POLICY UPDATED')
      window.setTimeout(() => setNotice(''), 1000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Policy update failed')
    }
  }

  const setThreshold = (key: 'allow' | 'review' | 'block', value: number) => {
    if (!policy) return
    const thresholds = { ...policy.thresholds }
    if (key === 'allow') thresholds.allow_max = Math.min(value, thresholds.review_max - 1)
    if (key === 'review') thresholds.review_max = Math.max(value, thresholds.allow_max + 1)
    if (key === 'block') thresholds.review_max = Math.max(thresholds.allow_max + 1, Math.min(99, value - 1))
    setPolicy({ ...policy, thresholds })
  }

  const commitThresholds = () => policy && save(policy)

  const grantTrust = async (kind: 'user' | 'tool', value: string) => {
    if (!policy || !value.trim()) return
    const clean = value.trim().toLowerCase()
    const key = kind === 'user' ? 'trusted_users' : 'trusted_tools'
    if (policy[key].includes(clean)) return
    setKnighting(`${kind}:${clean}`)
    await sleep(850)
    await save({ ...policy, [key]: [...policy[key], clean] })
    setKnighting(null)
    if (kind === 'user') setUserInput('')
  }

  const revoke = async () => {
    if (!policy || !inspect) return
    const key = inspect.kind === 'user' ? 'trusted_users' : 'trusted_tools'
    await save({ ...policy, [key]: policy[key].filter((value) => value !== inspect.value) })
    setInspect(null)
  }

  const restore = async () => {
    try {
      setPolicy(await resetPolicy())
      setNotice('POLICY RESET')
      window.setTimeout(() => setNotice(''), 1100)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reset failed')
    }
  }

  if (!policy) return <section className="policies-stage workflow-stage"><button className="context-back" type="button" onClick={onBack}>← CORE HUB</button><div className="mini-loader">LOADING POLICY</div><ErrorLine error={error} /></section>

  const face = policyFace(policy)
  const blockMin = policy.thresholds.review_max + 1
  return (
    <section className="policies-stage workflow-stage">
      <button className="context-back" type="button" onClick={onBack}>← CORE HUB</button>
      {notice && <div className="status-capsule">{notice}</div>}
      <ErrorLine error={error} />
      <div className="policy-heading"><p className="eyebrow">POLICIES</p><h2>Runtime boundaries</h2><p>Quiet controls. Hard security rules remain authoritative even when trust is granted.</p></div>
      <div className="policy-grid">
        <div className="threshold-stack">
          <label className="threshold-row"><span>ALLOW ≤ <b>{policy.thresholds.allow_max}</b></span><div className="emoji-marker">{face}</div><input type="range" min="5" max="60" value={policy.thresholds.allow_max} onChange={(event) => setThreshold('allow', Number(event.target.value))} onPointerUp={commitThresholds} onKeyUp={commitThresholds} /></label>
          <label className="threshold-row"><span>REVIEW ≤ <b>{policy.thresholds.review_max}</b></span><div className="emoji-marker">{face}</div><input type="range" min={policy.thresholds.allow_max + 1} max="95" value={policy.thresholds.review_max} onChange={(event) => setThreshold('review', Number(event.target.value))} onPointerUp={commitThresholds} onKeyUp={commitThresholds} /></label>
          <label className="threshold-row"><span>BLOCK ≥ <b>{blockMin}</b></span><div className="emoji-marker">{face}</div><input type="range" min={policy.thresholds.allow_max + 2} max="100" value={blockMin} onChange={(event) => setThreshold('block', Number(event.target.value))} onPointerUp={commitThresholds} onKeyUp={commitThresholds} /></label>
          <button type="button" className="policy-reset" onClick={restore}>RESTORE SECURE DEFAULTS</button>
        </div>
        <div className="trust-stack">
          <section className="trust-panel">
            <div><span>TRUSTED USERS</span><small>Scoped trust designation</small></div>
            <form onSubmit={(event) => { event.preventDefault(); grantTrust('user', userInput) }}><input value={userInput} onChange={(event) => setUserInput(event.target.value)} placeholder="User name" /><button type="submit">GRANT</button></form>
            <div className="trust-tokens">{policy.trusted_users.map((value) => <button type="button" className="trust-token" key={value} onClick={() => setInspect({ kind: 'user', value })}>{value}</button>)}</div>
          </section>
          <section className="trust-panel">
            <div><span>TRUSTED TOOLS</span><small>Scoped tool designation</small></div>
            <form onSubmit={(event) => { event.preventDefault(); grantTrust('tool', toolInput) }}><select value={toolInput} onChange={(event) => setToolInput(event.target.value)}><option>read_file</option><option>database_read</option><option>send_email</option><option>http_request</option><option>shell</option></select><button type="submit">GRANT</button></form>
            <div className="trust-tokens">{policy.trusted_tools.map((value) => <button type="button" className="trust-token" key={value} onClick={() => setInspect({ kind: 'tool', value })}>{value}</button>)}</div>
          </section>
        </div>
      </div>
      {knighting && <div className="knighting-overlay"><div className="candidate-token">{knighting.split(':')[1]}</div><div className="raksha-blade"><i /><i /></div><strong>TRUST GRANTED</strong></div>}
      {inspect && <div className="token-inspector"><button type="button" onClick={() => setInspect(null)}>×</button><p className="eyebrow">TRUST TOKEN</p><h3>{inspect.value}</h3><p>{inspect.kind === 'user' ? 'Trusted user' : 'Trusted tool'} within policy scope. Hard blocks and critical sequence protections remain active.</p><button type="button" className="danger" onClick={revoke}>REVOKE TRUST</button></div>}
    </section>
  )
}
