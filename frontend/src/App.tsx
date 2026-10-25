import { useCallback, useEffect, useState } from "react"

import {
  connectAI,
  disconnectAI,
  getAttackScenarios,
  getLiveActivity,
  resetSession,
  runAttackScenario,
  sendAgentMessage,
  type AIConnection,
  type ActionDecision,
  type AgentResponse,
  type AttackRunResult,
  type AttackScenario,
  type LiveActivityEvent,
  type LiveSessionSummary,
} from "./api"
import {
  AgentView,
  ForensicsView,
  PoliciesView,
  ReviewCard,
  ReviewsView,
} from "./views"

type View =
  | "command"
  | "attack"
  | "agent"
  | "review"
  | "forensics"
  | "policies"

type ChatRole = "user" | "assistant" | "raksha"

interface ChatEntry {
  id: string
  role: ChatRole
  text: string
}

interface HealthResponse {
  status: string
  project: string
  version: string
  security_engine: string
}

const TABS: [View, string][] = [
  ["command", "COMMAND CENTER"],
  ["attack", "ATTACK LAB"],
  ["agent", "LIVE AGENT"],
  ["review", "HUMAN REVIEW"],
  ["forensics", "ACTIVITY HISTORY"],
  ["policies", "POLICIES"],
]

function newSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `user-${crypto.randomUUID().slice(0, 8)}`
  }
  return `user-${Math.random().toString(36).slice(2, 10)}`
}

function initialSessionId() {
  const saved = sessionStorage.getItem("raksha-user-session")
  if (saved) return saved
  const created = newSessionId()
  sessionStorage.setItem("raksha-user-session", created)
  return created
}

function newMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function App() {
  const [activated, setActivated] = useState(
    () => sessionStorage.getItem("raksha-activated") === "1",
  )
  const [activating, setActivating] = useState(false)
  const [activationError, setActivationError] = useState("")
  const [view, setView] = useState<View>("command")
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState("")

  const [attackScenarios, setAttackScenarios] = useState<AttackScenario[]>([])
  const [attackResult, setAttackResult] = useState<AttackRunResult | null>(null)
  const [runningAttack, setRunningAttack] = useState("")

  const [sessionId, setSessionId] = useState(initialSessionId)
  const [apiKey, setApiKey] = useState("")
  const [connection, setConnection] = useState<AIConnection | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [message, setMessage] = useState("")
  const [chats, setChats] = useState<Record<string, ChatEntry[]>>({})
  const [responses, setResponses] = useState<Record<string, AgentResponse | null>>({})
  const [decisions, setDecisions] = useState<Record<string, ActionDecision | null>>({})
  const [agentBusy, setAgentBusy] = useState(false)
  const [activity, setActivity] = useState<LiveActivityEvent[]>([])
  const [activeSessions, setActiveSessions] = useState(0)
  const [liveSessions, setLiveSessions] = useState<LiveSessionSummary[]>([])
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false)
  const [reviewModal, setReviewModal] = useState<{
    sessionId: string
    reviewId: string
    riskScore: number
    reasons: string[]
    action: ActionDecision["action"]
  } | null>(null)

  const chat = chats[sessionId] ?? []
  const latestResponse = responses[sessionId] ?? null
  const lastDecision = decisions[sessionId] ?? null
  const currentLiveSession = liveSessions.find((item) => item.session_id === sessionId)

  function updateSessionChat(
    sid: string,
    update: ChatEntry[] | ((current: ChatEntry[]) => ChatEntry[]),
  ) {
    setChats((current) => {
      const existing = current[sid] ?? []
      const next = typeof update === "function" ? update(existing) : update
      return { ...current, [sid]: next }
    })
  }

  const loadHealth = useCallback(async () => {
    const response = await fetch("/api/health")
    if (!response.ok) {
      throw new Error("RAKSHA backend is not available")
    }
    const data = (await response.json()) as HealthResponse
    setHealth(data)
    return data
  }, [])

  async function activateRaksha() {
    setActivating(true)
    setActivationError("")
    try {
      await loadHealth()
      sessionStorage.setItem("raksha-activated", "1")
      setActivated(true)
    } catch (err) {
      setActivationError(
        err instanceof Error ? err.message : "Could not activate RAKSHA",
      )
    } finally {
      setActivating(false)
    }
  }

  useEffect(() => {
    if (!activated) return
    loadHealth().catch(() => setError("Backend unavailable"))
  }, [activated, loadHealth])

  useEffect(() => {
    if (!activated) return
    getAttackScenarios()
      .then((result) => setAttackScenarios(result.scenarios))
      .catch(() => setAttackScenarios([]))
  }, [activated])

  const refreshActivity = useCallback(async () => {
    try {
      const result = await getLiveActivity(30)
      setActivity(result.events.slice().reverse())
      setActiveSessions(result.active_sessions)
      setLiveSessions(result.sessions)
    } catch {
      // The dashboard remains usable even if the activity feed is temporarily unavailable.
    }
  }, [])

  useEffect(() => {
    if (!activated) return
    refreshActivity()
    const timer = window.setInterval(refreshActivity, 1500)
    return () => window.clearInterval(timer)
  }, [activated, refreshActivity])

  async function handleConnectAI() {
    if (!apiKey.trim()) {
      setError("Enter any demo API key to connect the free model.")
      return
    }

    setConnecting(true)
    setError("")
    try {
      const result = await connectAI(sessionId, apiKey)
      setConnection(result)
      updateSessionChat(sessionId, [
        {
          id: newMessageId(),
          role: "raksha",
          text: "AI connected. RAKSHA is now watching every proposed action before it can run.",
        },
      ])
      setResponses((current) => ({ ...current, [sessionId]: null }))
      setDecisions((current) => ({ ...current, [sessionId]: null }))
      await refreshActivity()
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI connection failed")
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnectAI() {
    setError("")
    setAgentBusy(false)
    try {
      await disconnectAI()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect the AI model")
      return
    }

    const fresh = newSessionId()
    sessionStorage.setItem("raksha-user-session", fresh)
    setSessionId(fresh)
    setConnection(null)
    setApiKey("")
    setMessage("")
    setChats({})
    setResponses({})
    setDecisions({})
    setReviewModal(null)
    setSessionMenuOpen(false)
    setActivity([])
    setLiveSessions([])
    setActiveSessions(0)
    await refreshActivity()
  }

  async function startNewUserSession() {
    const next = newSessionId()
    setError("")

    if (connection && apiKey.trim()) {
      try {
        await connectAI(next, apiKey)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create a new user session")
        return
      }
    }

    sessionStorage.setItem("raksha-user-session", next)
    setSessionId(next)
    setMessage("")
    updateSessionChat(next, [
      {
        id: newMessageId(),
        role: "raksha",
        text: "New user session connected. This user's conversation and security state are isolated from every other user.",
      },
    ])
    setResponses((current) => ({ ...current, [next]: null }))
    setDecisions((current) => ({ ...current, [next]: null }))
    setSessionMenuOpen(false)
    await refreshActivity()
  }

  function switchUserSession(nextSessionId: string) {
    sessionStorage.setItem("raksha-user-session", nextSessionId)
    setSessionId(nextSessionId)
    setMessage("")
    setError("")
    setSessionMenuOpen(false)
  }

  async function resetCurrentSession() {
    try {
      await resetSession(sessionId)
      updateSessionChat(sessionId, [
        {
          id: newMessageId(),
          role: "raksha",
          text: "This user session was reset. RAKSHA is ready for a fresh conversation.",
        },
      ])
      setResponses((current) => ({ ...current, [sessionId]: null }))
      setDecisions((current) => ({ ...current, [sessionId]: null }))
      if (reviewModal?.sessionId === sessionId) setReviewModal(null)
      await refreshActivity()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Session reset failed")
    }
  }

  async function sendChatMessage() {
    const text = message.trim()
    if (!text || !connection || agentBusy) return

    const sid = sessionId
    setMessage("")
    setError("")
    updateSessionChat(sid, (current) => [
      ...current,
      { id: newMessageId(), role: "user", text },
    ])
    setAgentBusy(true)

    try {
      const response = await sendAgentMessage(sid, text)
      setResponses((current) => ({ ...current, [sid]: response }))

      const last = response.results.length
        ? response.results[response.results.length - 1].decision
        : null
      setDecisions((current) => ({ ...current, [sid]: last }))

      updateSessionChat(sid, (current) => [
        ...current,
        {
          id: newMessageId(),
          role: "assistant",
          text: response.assistant_message || "Request processed.",
        },
      ])

      const review = response.results.find(
        (result) => result.decision.verdict === "REVIEW" && result.decision.review_id,
      )
      const block = response.results.find((result) => result.decision.verdict === "BLOCK")

      if (review && review.decision.review_id) {
        updateSessionChat(sid, (current) => [
          ...current,
          {
            id: newMessageId(),
            role: "raksha",
            text: `Human review required. RAKSHA paused a risk-${review.decision.risk_score} action before execution.`,
          },
        ])
        setReviewModal({
          sessionId: sid,
          reviewId: review.decision.review_id,
          riskScore: review.decision.risk_score,
          reasons: review.decision.reasons,
          action: review.decision.action,
        })
      }

      if (block) {
        updateSessionChat(sid, (current) => [
          ...current,
          {
            id: newMessageId(),
            role: "raksha",
            text: `Dangerous action blocked at risk ${block.decision.risk_score}. This user session is now contained.`,
          },
        ])
      }

      await refreshActivity()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent request failed")
    } finally {
      setAgentBusy(false)
    }
  }

  async function handleAttackScenario(scenarioId: string) {
    setRunningAttack(scenarioId)
    setError("")
    try {
      const result = await runAttackScenario(scenarioId)
      setAttackResult(result)
      await refreshActivity()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Attack simulation failed")
    } finally {
      setRunningAttack("")
    }
  }

  function verdictClass(verdict?: string | null) {
    if (verdict === "ALLOW") return "allow"
    if (verdict === "REVIEW") return "review"
    if (verdict === "BLOCK") return "block"
    return "neutral"
  }

  if (!activated) {
    return (
      <main className="activation-page">
        <div className="activation-glow activation-glow-one" />
        <div className="activation-glow activation-glow-two" />
        <section className="activation-card">
          <div className="activation-mark">R</div>
          <p className="activation-kicker">AUTONOMOUS AI SECURITY</p>
          <h1>RAKSHA</h1>
          <p className="activation-subtitle">
            Runtime Agent Kernel for Secure Human-Governed Autonomy
          </p>
          <p className="activation-copy">
            Activate the protection layer to connect the security engine,
            policy controls, activity proof, human review, and agent runtime.
          </p>
          <button className="activate-button" onClick={activateRaksha} disabled={activating}>
            {activating ? "ACTIVATING..." : "ACTIVATE"}
          </button>
          {activationError && <p className="activation-error">{activationError}</p>}
          <span className="activation-note">Shown once per browser session</span>
        </section>
      </main>
    )
  }

  return (
    <main className="app">
      <div className="grid" />

      <header className="topbar">
        <div className="brand-small">
          <div className="shield-small">R</div>
          <div>
            <span className="brand-name">RAKSHA</span>
            <span className="brand-sub">AUTONOMOUS AI SECURITY</span>
          </div>
        </div>

        <div className="system-online">
          <span className="status-dot" />
          {health ? `PROTECTED · API ${health.version}` : "CONNECTING"}
        </div>
      </header>

      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={`tab ${view === id ? "active" : ""}`}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === "agent" && <AgentView sessionId={sessionId} />}
      {view === "review" && <ReviewsView />}
      {view === "forensics" && <ForensicsView />}
      {view === "policies" && <PoliciesView />}

      <div className="dashboard">
        {view === "command" && (
          <>
            <section className="hero-row command-hero">
              <div>
                <p className="eyebrow">LIVE AI SECURITY OPERATIONS</p>
                <h1>COMMAND CENTER</h1>
                <p className="description">
                  Connect an AI model, let users interact naturally, and let RAKSHA
                  intervene only when a proposed action becomes risky.
                </p>
              </div>

              <div className={`risk-orb ${verdictClass(lastDecision?.verdict)}`}>
                <span className="risk-label">LATEST RISK</span>
                <strong>{lastDecision ? lastDecision.risk_score : "00"}</strong>
                <span className="risk-verdict">
                  {lastDecision ? lastDecision.verdict : "MONITORING"}
                </span>
              </div>
            </section>

            <section className="stats-grid command-stats">
              <StatCard
                label="AI CONNECTION"
                value={connection ? "CONNECTED" : "NOT CONNECTED"}
                accent={connection ? "allow" : ""}
              />
              <StatCard label="LIVE USER SESSIONS" value={String(activeSessions)} />
              <StatCard label="RECENT ACTIVITY" value={String(activity.length)} />
              <StatCard
                label="LAST DECISION"
                value={lastDecision?.verdict ?? "—"}
                accent={verdictClass(lastDecision?.verdict)}
              />
            </section>

            <section className="panel ai-connect-panel">
              <div className="connect-copy">
                <span className="panel-index">01</span>
                <div>
                  <h2>CONNECT AI MODEL</h2>
                  <p>
                    For the free demo, any non-empty API key connects to the
                    offline RAKSHA Demo Model. The key is never stored or logged.
                  </p>
                </div>
              </div>

              <div className="connect-controls">
                <label>
                  AI API KEY
                  <input
                    type="password"
                    value={apiKey}
                    disabled={Boolean(connection)}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="Enter any demo API key"
                  />
                </label>

                {!connection ? (
                  <button
                    className="primary-button connect-button"
                    onClick={handleConnectAI}
                    disabled={connecting}
                  >
                    {connecting ? "CONNECTING..." : "CONNECT AI"}
                  </button>
                ) : (
                  <div className="connected-actions">
                    <div className="connected-card">
                      <span className="status-dot" />
                      <div>
                        <strong>AI CONNECTED</strong>
                        <small>{connection.provider} · FREE DEMO</small>
                      </div>
                    </div>
                    <button
                      className="disconnect-button"
                      onClick={handleDisconnectAI}
                      disabled={agentBusy || connecting}
                    >
                      DISCONNECT
                    </button>
                  </div>
                )}
              </div>
            </section>

            {connection ? (
              <>
                <div className="command-grid">
                  <section className="panel live-chat-panel">
                    <div className="panel-heading command-panel-heading">
                      <div>
                        <span className="panel-index">02</span>
                        <h2>LIVE AI INTERACTION</h2>
                      </div>
                      <div className="session-tools">
                        <div className="user-switcher">
                          <button
                            className="session-chip session-selector"
                            onClick={() => setSessionMenuOpen((open) => !open)}
                            aria-expanded={sessionMenuOpen}
                          >
                            <span>
                              <strong>{currentLiveSession?.display_name ?? "CURRENT USER"}</strong>
                              <small>{sessionId}</small>
                            </span>
                            <b>⌄</b>
                          </button>

                          {sessionMenuOpen && (
                            <div className="user-popover">
                              <div className="user-popover-head">
                                <span>LIVE USERS</span>
                                <strong>{liveSessions.length}</strong>
                              </div>
                              <div className="user-list">
                                {liveSessions.map((user) => (
                                  <button
                                    key={user.session_id}
                                    className={`user-option ${user.session_id === sessionId ? "selected" : ""}`}
                                    onClick={() => switchUserSession(user.session_id)}
                                  >
                                    <span className="user-avatar">{user.display_name.slice(-2)}</span>
                                    <span>
                                      <strong>{user.display_name}</strong>
                                      <small>{user.session_id}</small>
                                    </span>
                                    <em className={verdictClass(
                                      user.status === "CONTAINED" ? "BLOCK" : user.latest_verdict,
                                    )}>
                                      {["APPROVED", "DENIED", "CONTAINED"].includes(user.status)
                                        ? user.status
                                        : user.latest_verdict ?? user.status}
                                    </em>
                                  </button>
                                ))}
                              </div>
                              <button className="add-user-button" onClick={startNewUserSession}>
                                + ADD NEW USER
                              </button>
                            </div>
                          )}
                        </div>

                        <button className="mini-button soft" onClick={resetCurrentSession}>
                          RESET USER
                        </button>
                      </div>
                    </div>

                    <div className="chat-window">
                      {chat.length === 0 ? (
                        <div className="chat-empty">
                          <strong>Start a normal conversation.</strong>
                          <span>
                            RAKSHA watches proposed tool actions quietly in the background.
                          </span>
                        </div>
                      ) : (
                        chat.map((entry) => (
                          <div key={entry.id} className={`chat-row ${entry.role}`}>
                            <span className="chat-role">
                              {entry.role === "user"
                                ? "YOU"
                                : entry.role === "assistant"
                                  ? "AI"
                                  : "RAKSHA"}
                            </span>
                            <div className="chat-bubble">{entry.text}</div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="chat-compose">
                      <textarea
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault()
                            void sendChatMessage()
                          }
                        }}
                        rows={2}
                        placeholder="Message the connected AI..."
                      />
                      <button
                        className="primary-button chat-send"
                        onClick={sendChatMessage}
                        disabled={agentBusy || !message.trim()}
                      >
                        {agentBusy ? "RAKSHA CHECKING..." : "SEND"}
                      </button>
                    </div>

                  </section>

                  <section className="panel live-decision-panel">
                    <div className="panel-heading">
                      <div>
                        <span className="panel-index">03</span>
                        <h2>RAKSHA DECISION</h2>
                      </div>
                    </div>

                    {!latestResponse || latestResponse.results.length === 0 ? (
                      <div className="decision-empty">
                        <div className="decision-shield">R</div>
                        <strong>No risky tool action yet.</strong>
                        <p>
                          Normal conversation can continue without interruption. RAKSHA
                          steps in only when the AI proposes an action that needs control.
                        </p>
                      </div>
                    ) : (
                      <div className="decision-stack">
                        {latestResponse.results.map((result, index) => (
                          <article className="live-decision-card" key={index}>
                            <div className="live-decision-top">
                              <span>
                                {result.proposal.tool} · {result.proposal.resource || "no resource"}
                              </span>
                              <strong className={verdictClass(result.decision.verdict)}>
                                {result.decision.risk_score} · {result.decision.verdict}
                              </strong>
                            </div>
                            <p>{result.decision.reasons.join(" · ")}</p>
                            <small>{result.decision.execution_status}</small>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <section className="panel live-activity-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="panel-index">04</span>
                      <h2>LIVE USER ACTIVITY</h2>
                    </div>
                    <span className="live-badge">AUTO-UPDATING</span>
                  </div>

                  <p className="activity-intro">
                    Each user session is isolated. Safe users continue normally while
                    suspicious sessions can be reviewed, blocked, or contained independently.
                  </p>

                  <div className="activity-list">
                    {activity.length === 0 ? (
                      <p className="timeline-empty">Waiting for user activity...</p>
                    ) : (
                      activity.map((event) => (
                        <ActivityRow key={event.event_id} event={event} />
                      ))
                    )}
                  </div>
                </section>
              </>
            ) : (
              <section className="connection-empty panel">
                <div className="connection-illustration">AI</div>
                <div>
                  <h2>Connect a model to begin live protection.</h2>
                  <p>
                    Once connected, the live chat appears here. Normal conversations stay
                    uninterrupted, while risky prompts automatically trigger RAKSHA decisions
                    and human review when needed.
                  </p>
                </div>
              </section>
            )}
          </>
        )}

        {view === "attack" && (
          <section className="attack-lab">
            <div className="attack-lab-heading">
              <div>
                <p className="eyebrow">CONTROLLED SECURITY SIMULATION</p>
                <h2>ATTACK LAB</h2>
                <p>
                  Run one of twelve controlled scenarios against the same RAKSHA runtime
                  used by live AI sessions.
                </p>
              </div>
              <strong>{attackScenarios.length} SCENARIOS</strong>
            </div>

            <div className="attack-grid">
              {attackScenarios.map((scenario, index) => (
                <article className="attack-card" key={scenario.id}>
                  <div className="attack-number">
                    ATTACK {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="attack-meta">
                    <span>{scenario.category}</span>
                    <span
                      className={
                        scenario.severity === "CRITICAL"
                          ? "severity-critical"
                          : "severity-high"
                      }
                    >
                      {scenario.severity}
                    </span>
                  </div>
                  <h3>{scenario.name}</h3>
                  <p>{scenario.description}</p>
                  <div className="expected-row">
                    EXPECTED
                    <strong className={verdictClass(scenario.expected_verdict)}>
                      {scenario.expected_verdict}
                    </strong>
                  </div>
                  <button
                    className="scenario-button"
                    disabled={runningAttack !== ""}
                    onClick={() => handleAttackScenario(scenario.id)}
                  >
                    {runningAttack === scenario.id ? "ATTACK RUNNING..." : "RUN SCENARIO"}
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {error && <div className="error-banner">{error}</div>}
      </div>

      {reviewModal && (
        <div className="modal-backdrop review-modal-backdrop" role="presentation">
          <section
            className="review-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Human authorization required"
          >
            <div className="review-modal-heading">
              <span className="review-alert-mark">!</span>
              <div>
                <p className="eyebrow">RAKSHA PAUSED THIS ACTION</p>
                <h3>HUMAN AUTHORIZATION REQUIRED</h3>
                <p>
                  {reviewModal.sessionId} needs a human decision before this action can run.
                </p>
              </div>
            </div>
            <ReviewCard
              review={{
                review_id: reviewModal.reviewId,
                risk_score: reviewModal.riskScore,
                reasons: reviewModal.reasons,
                action: {
                  ...reviewModal.action,
                  user_intent: "Live AI conversation",
                },
              }}
              onResolved={(review) => {
                const sid = reviewModal.sessionId
                updateSessionChat(sid, (current) => [
                  ...current,
                  {
                    id: newMessageId(),
                    role: "raksha",
                    text:
                      review.status === "APPROVED"
                        ? "Human approved this one action. No permanent permission was granted."
                        : "Human denied this action. The user session remains available.",
                  },
                ])
                setReviewModal(null)
                void refreshActivity()
              }}
            />
          </section>
        </div>
      )}

      {attackResult && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setAttackResult(null)}>
          <section
            className="attack-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Attack simulation result"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setAttackResult(null)} aria-label="Close">
              ×
            </button>

            <div className="attack-result-head">
              <div>
                <span>SIMULATION RESULT</span>
                <h3>{attackResult.name}</h3>
                <p>{attackResult.description}</p>
              </div>
              <div className={`attack-result-verdict ${verdictClass(attackResult.final_verdict)}`}>
                <strong>{attackResult.final_risk_score}</strong>
                <span>{attackResult.final_verdict}</span>
              </div>
            </div>

            <div className="simulation-path modal-path">
              {attackResult.events.map((event, index) => (
                <div className="simulation-step" key={`${event.action.tool}-${index}`}>
                  <span>STEP {String(index + 1).padStart(2, "0")}</span>
                  <strong>{event.action.tool}</strong>
                  <code>{event.action.resource}</code>
                  <div>
                    RISK <strong>{event.risk_score}</strong>
                  </div>
                  <b className={verdictClass(event.verdict)}>{event.verdict}</b>
                </div>
              ))}
            </div>

            <div className="comparison-row modal-comparison">
              EXPECTED
              <strong className={verdictClass(attackResult.expected_verdict)}>
                {attackResult.expected_verdict}
              </strong>
              <span>→</span>
              ACTUAL
              <strong className={verdictClass(attackResult.final_verdict)}>
                {attackResult.final_verdict}
              </strong>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function StatCard({
  label,
  value,
  accent = "",
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong className={accent}>{value}</strong>
    </div>
  )
}

function ActivityRow({ event }: { event: LiveActivityEvent }) {
  const tone =
    event.verdict === "BLOCK"
      ? "block"
      : event.verdict === "REVIEW"
        ? "review"
        : event.verdict === "ALLOW"
          ? "allow"
          : "neutral"

  const time = event.timestamp
    ? new Date(event.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : ""

  return (
    <div className="activity-row">
      <span className={`activity-dot ${tone}`} />
      <div className="activity-session">
        <strong>{event.session_id}</strong>
        <small>{time}</small>
      </div>
      <div className="activity-message">
        <strong>{event.message}</strong>
        {event.resource && <small>{event.resource}</small>}
      </div>
      {event.risk_score !== null && event.risk_score !== undefined ? (
        <span className="activity-risk">RISK {event.risk_score}</span>
      ) : (
        <span />
      )}
      <span className={`activity-status ${tone}`}>{event.status ?? "LIVE"}</span>
    </div>
  )
}

export default App
