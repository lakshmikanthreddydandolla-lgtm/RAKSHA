import { useCallback, useEffect, useMemo, useState } from "react"

type Environment = "command" | "redteam" | "governance" | "evidence"
type ProviderMode = "demo" | "ollama"
type Verdict = "ALLOW" | "REVIEW" | "BLOCK"

type ChatEntry = { id: string; role: "user" | "assistant" | "raksha"; text: string }
type Decision = {
  verdict: Verdict
  risk_score: number
  reasons: string[]
  signals: string[]
  components: Record<string, number>
  predicted_consequence: string
  review_id?: string | null
  contained?: boolean
  execution_status?: string
  action?: { tool?: string; operation?: string; resource?: string; destination?: string }
}
type AgentResponse = {
  provider: string
  fallback_reason?: string | null
  assistant_message: string
  intent: string
  rationale: string
  results: { proposal: Record<string, unknown>; decision: Decision }[]
  contained: boolean
  context: { last_resource?: string; last_secret_resource?: boolean; history_length: number }
}
type LiveSession = {
  session_id: string
  provider: string
  status: string
  latest_verdict?: Verdict | null
  latest_risk?: number | null
  contained: boolean
  history_length: number
  grant_count: number
}
type Review = {
  review_id: string
  session_id: string
  status: string
  final_outcome?: string | null
  action: { tool?: string; operation?: string; resource?: string; destination?: string; user_intent?: string }
  risk_score: number
  reasons: string[]
  components: Record<string, number>
  signals: string[]
  predicted_consequence: string
  execution_status: string
  scope_grant?: Record<string, string> | null
}
type Scenario = { id: string; name: string; category: string; severity: string; description: string; expected_verdict: Verdict }
type AttackResult = {
  scenario_id: string
  name: string
  expected_verdict: Verdict
  final_verdict: Verdict
  final_risk_score: number
  passed: boolean
  contained: boolean
  events: ({ action: { tool?: string; resource?: string; destination?: string } } & Decision)[]
}
type AuditEvent = { event_id?: string; seq?: number; type?: string; session_id?: string; timestamp?: string; data?: Record<string, unknown> }

type ApiError = { detail?: string }

function id(prefix = "id") {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${rand}`
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  })
  if (!response.ok) {
    let detail = `Request failed (${response.status})`
    try { detail = ((await response.json()) as ApiError).detail ?? detail } catch { /* ignore */ }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

function verdictTone(verdict?: string | null) {
  if (verdict === "ALLOW") return "allow"
  if (verdict === "REVIEW") return "review"
  if (verdict === "BLOCK") return "block"
  return "neutral"
}

function RiskBars({ decision }: { decision: Decision | null }) {
  const labels: Record<string, string> = {
    resource_risk: "Resource",
    destination_risk: "Destination",
    intent_risk: "Intent",
    permission_risk: "Permission",
    sequence_risk: "Sequence",
    policy_risk: "Policy",
    identity_risk: "Identity",
    tool_risk: "Tool power",
  }
  if (!decision) return <div className="empty-state">Security signals appear here when an action enters RAKSHA.</div>
  return (
    <div className="risk-bars">
      {Object.entries(decision.components ?? {}).map(([key, value]) => (
        <div className="risk-row" key={key}>
          <div><span>{labels[key] ?? key}</span><strong>{value}</strong></div>
          <div className="risk-track"><i style={{ width: `${Math.min(100, value)}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

function DecisionCorridor({ decision, reducedMotion }: { decision: Decision | null; reducedMotion: boolean }) {
  const tone = verdictTone(decision?.verdict)
  return (
    <section className={`corridor ${tone} ${reducedMotion ? "reduced" : ""}`} aria-label="RAKSHA decision corridor">
      <div className="corridor-line" />
      <div className="corridor-node agent-node"><small>01</small><strong>AGENT</strong><span>proposal</span></div>
      <div className="corridor-node action-node"><small>02</small><strong>ACTION</strong><span>{decision?.action?.tool ?? "waiting"}</span></div>
      <div className="kernel-node"><span>RAKSHA</span><strong>{decision ? decision.risk_score : "--"}</strong><em>{decision?.verdict ?? "MONITOR"}</em></div>
      <div className="corridor-node tool-node"><small>04</small><strong>TOOL</strong><span>{decision?.action?.resource ?? "protected"}</span></div>
      {decision?.verdict === "REVIEW" && <div className="review-gate"><span>HUMAN GATE</span></div>}
      {decision?.verdict === "BLOCK" && <div className="block-bar"><span>EXECUTION STOPPED</span></div>}
    </section>
  )
}

function App() {
  const [activated, setActivated] = useState(() => sessionStorage.getItem("raksha-finale-activated") === "1")
  const [activating, setActivating] = useState(false)
  const [environment, setEnvironment] = useState<Environment>("command")
  const [sessionId, setSessionId] = useState(() => sessionStorage.getItem("raksha-finale-session") || id("user"))
  const [providerMode, setProviderMode] = useState<ProviderMode>("demo")
  const [connected, setConnected] = useState(false)
  const [providerName, setProviderName] = useState("RAKSHA Demo Agent")
  const [message, setMessage] = useState("")
  const [chat, setChat] = useState<Record<string, ChatEntry[]>>({})
  const [busy, setBusy] = useState(false)
  const [latest, setLatest] = useState<Record<string, AgentResponse | null>>({})
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [attackResult, setAttackResult] = useState<AttackResult | null>(null)
  const [runningScenario, setRunningScenario] = useState("")
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [verify, setVerify] = useState<Record<string, unknown> | null>(null)
  const [tamper, setTamper] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState("")
  const [reducedMotion, setReducedMotion] = useState(() => localStorage.getItem("raksha-lite-motion") === "1")

  const currentChat = chat[sessionId] ?? []
  const response = latest[sessionId] ?? null
  const lastDecision = useMemo(() => {
    if (!response?.results?.length) return null
    return response.results[response.results.length - 1].decision
  }, [response])
  const currentSession = sessions.find((item) => item.session_id === sessionId)

  const updateChat = useCallback((sid: string, entry: ChatEntry) => {
    setChat((existing) => ({ ...existing, [sid]: [...(existing[sid] ?? []), entry] }))
  }, [])

  const refreshRuntime = useCallback(async () => {
    try {
      const [sessionData, reviewData] = await Promise.all([
        api<{ sessions: LiveSession[] }>("/api/sessions"),
        api<{ reviews: Review[] }>("/api/reviews"),
      ])
      setSessions(sessionData.sessions)
      setReviews(reviewData.reviews)
    } catch { /* keep demo usable during transient refresh */ }
  }, [])

  const refreshEvidence = useCallback(async () => {
    try {
      const [events, proof] = await Promise.all([
        api<{ events: AuditEvent[] }>("/api/audit/events?limit=120"),
        api<Record<string, unknown>>("/api/audit/verify"),
      ])
      setAuditEvents(events.events.slice().reverse())
      setVerify(proof)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evidence refresh failed")
    }
  }, [])

  useEffect(() => {
    sessionStorage.setItem("raksha-finale-session", sessionId)
  }, [sessionId])

  useEffect(() => {
    if (!activated) return
    api<{ scenarios: Scenario[] }>("/api/attacks").then((data) => setScenarios(data.scenarios)).catch(() => setScenarios([]))
    refreshRuntime()
    const timer = window.setInterval(refreshRuntime, 1800)
    return () => window.clearInterval(timer)
  }, [activated, refreshRuntime])

  async function activate() {
    setActivating(true)
    setError("")
    try {
      await api("/api/health")
      sessionStorage.setItem("raksha-finale-activated", "1")
      setActivated(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "RAKSHA backend unavailable")
    } finally {
      setActivating(false)
    }
  }

  async function connect(mode = providerMode, sid = sessionId) {
    setError("")
    try {
      const data = await api<{ provider: string }>("/api/agent/connect", {
        method: "POST",
        body: JSON.stringify({ session_id: sid, mode }),
      })
      setConnected(true)
      setProviderName(data.provider)
      updateChat(sid, { id: id("msg"), role: "raksha", text: mode === "demo"
        ? "Judge Mode online. No API key, cloud quota, or internet is required."
        : "Local Ollama selected. If the model is unavailable, RAKSHA will fall back to Judge Mode while preserving security state." })
      await refreshRuntime()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent connection failed")
    }
  }

  async function disconnect() {
    setError("")
    try {
      await api("/api/agent/disconnect", { method: "POST" })
      setConnected(false)
      setChat({})
      setLatest({})
      setReviews([])
      setSessions([])
      const next = id("user")
      sessionStorage.setItem("raksha-finale-session", next)
      setSessionId(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed")
    }
  }

  async function newUser() {
    const sid = id("user")
    setSessionId(sid)
    if (connected) await connect(providerMode, sid)
  }

  async function resetUser() {
    await api(`/api/session/${sessionId}`, { method: "DELETE" })
    setChat((value) => ({ ...value, [sessionId]: [] }))
    setLatest((value) => ({ ...value, [sessionId]: null }))
    if (connected) await connect(providerMode, sessionId)
    await refreshRuntime()
  }

  async function sendMessage() {
    const text = message.trim()
    if (!text || busy || !connected) return
    setMessage("")
    setBusy(true)
    setError("")
    updateChat(sessionId, { id: id("msg"), role: "user", text })
    try {
      const data = await api<AgentResponse>("/api/agent/message", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, message: text }),
      })
      setLatest((value) => ({ ...value, [sessionId]: data }))
      updateChat(sessionId, { id: id("msg"), role: "assistant", text: data.assistant_message })
      if (data.fallback_reason) updateChat(sessionId, { id: id("msg"), role: "raksha", text: data.fallback_reason })
      await refreshRuntime()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent request failed")
    } finally {
      setBusy(false)
    }
  }

  async function decideReview(review: Review, decision: "ALLOW_ONCE" | "DENY" | "SCOPED_ALLOW") {
    const scope = decision === "SCOPED_ALLOW" ? {
      tool: review.action.tool ?? "*",
      resource: review.action.resource ?? "*",
      destination: review.action.destination ?? "*",
    } : null
    try {
      await api(`/api/reviews/${review.review_id}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision, scope }),
      })
      await refreshRuntime()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review decision failed")
    }
  }

  async function runScenario(scenarioId: string) {
    setRunningScenario(scenarioId)
    setAttackResult(null)
    try {
      const data = await api<AttackResult>(`/api/attacks/${scenarioId}/run`, { method: "POST" })
      setAttackResult(data)
      await refreshRuntime()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scenario failed")
    } finally {
      setRunningScenario("")
    }
  }

  async function runTamper() {
    const result = await api<Record<string, unknown>>("/api/audit/tamper-demo", { method: "POST" })
    setTamper(result)
    await refreshEvidence()
  }

  function toggleMotion() {
    const next = !reducedMotion
    setReducedMotion(next)
    localStorage.setItem("raksha-lite-motion", next ? "1" : "0")
  }

  if (!activated) {
    return (
      <main className="landing">
        <div className="landing-noise" />
        <section className="landing-copy">
          <div className="landing-mark">R</div>
          <p className="kicker">RUNTIME AI ACTION SECURITY</p>
          <h1>RAKSHA</h1>
          <p className="full-form">Runtime Agent Kernel for Secure Human-Governed Autonomy</p>
          <p className="landing-line">Before an AI Agent Acts, RAKSHA Decides Whether It Should.</p>
          <button className="activate" onClick={activate} disabled={activating}>{activating ? "VERIFYING SYSTEM" : "ACTIVATE"}</button>
          {error && <p className="landing-error">{error}</p>}
          <span className="landing-meta">YUKTHI 2026 · FINALE SYSTEM</span>
        </section>
      </main>
    )
  }

  const nav: [Environment, string, string][] = [
    ["command", "Command Center", "01"],
    ["redteam", "Red-Team Lab", "02"],
    ["governance", "Human Governance", "03"],
    ["evidence", "Evidence Center", "04"],
  ]

  return (
    <main className={`shell ${reducedMotion ? "lite-motion" : "full-motion"}`}>
      <div className="ambient ambient-a" /><div className="ambient ambient-b" />
      <aside className="rail">
        <div className="rail-brand"><div className="rail-mark">R</div><div><strong>RAKSHA</strong><span>FINALE / 2.0</span></div></div>
        <nav>{nav.map(([key, label, num]) => <button key={key} className={environment === key ? "active" : ""} onClick={() => { setEnvironment(key); if (key === "evidence") void refreshEvidence() }}><span>{num}</span><strong>{label}</strong></button>)}</nav>
        <div className="rail-bottom">
          <button className="motion-toggle" onClick={toggleMotion}>{reducedMotion ? "FULL MOTION" : "LITE MOTION"}</button>
          <div className="system-chip"><i />RUNTIME ACTIVE</div>
        </div>
      </aside>

      <section className="stage">
        <header className="stage-top">
          <div><span className="eyebrow">ZERO-TRUST AGENT CONTROL PLANE</span><h2>{nav.find(([key]) => key === environment)?.[1]}</h2></div>
          <div className="top-session"><span>{currentSession?.contained ? "CONTAINED" : connected ? "PROTECTED" : "OFFLINE"}</span><strong>{sessionId}</strong></div>
        </header>

        {error && <div className="error-banner"><span>!</span>{error}<button onClick={() => setError("")}>×</button></div>}

        {environment === "command" && (
          <div className="environment command-environment">
            <section className="command-hero glass-panel">
              <div className="hero-copy"><span className="section-index">LIVE / 01</span><h3>Every proposed action crosses a security boundary.</h3><p>The agent can reason and propose. RAKSHA owns execution.</p></div>
              <div className={`verdict-orb ${verdictTone(lastDecision?.verdict)}`}><span>LATEST RISK</span><strong>{lastDecision?.risk_score ?? "00"}</strong><em>{lastDecision?.verdict ?? "MONITORING"}</em></div>
            </section>

            <DecisionCorridor decision={lastDecision} reducedMotion={reducedMotion} />

            {!connected ? (
              <section className="connect-deck">
                <article className={`provider-card ${providerMode === "demo" ? "selected" : ""}`} onClick={() => setProviderMode("demo")}><span className="provider-index">A</span><div><strong>RAKSHA DEMO AGENT</strong><small>OFFLINE · FREE · RECOMMENDED</small></div><p>Deterministic Judge Mode with persistent session context. No fake API key.</p></article>
                <article className={`provider-card ${providerMode === "ollama" ? "selected" : ""}`} onClick={() => setProviderMode("ollama")}><span className="provider-index">B</span><div><strong>LOCAL OLLAMA</strong><small>LOCAL LLM · OPTIONAL</small></div><p>Uses your local model when available and falls back safely to Judge Mode.</p></article>
                <button className="primary-action" onClick={() => connect()}>{providerMode === "demo" ? "START JUDGE MODE" : "CONNECT LOCAL MODEL"}</button>
              </section>
            ) : (
              <div className="command-grid">
                <section className="chat-panel glass-panel">
                  <div className="panel-head"><div><span className="section-index">AGENT LINK</span><h3>{providerName}</h3></div><div className="session-actions"><button onClick={newUser}>+ USER</button><button onClick={resetUser}>RESET</button><button onClick={disconnect}>DISCONNECT</button></div></div>
                  <div className="session-strip">{sessions.map((item, index) => <button key={item.session_id} className={`${item.session_id === sessionId ? "selected" : ""} ${item.contained ? "contained" : ""}`} onClick={() => setSessionId(item.session_id)}><b>U{String(index + 1).padStart(2, "0")}</b><span>{item.contained ? "LOCKED" : item.latest_verdict ?? "ACTIVE"}</span></button>)}</div>
                  <div className="chat-log">{currentChat.length === 0 ? <div className="chat-placeholder"><strong>Start naturally.</strong><p>Try “read the invoice”, “check the credentials”, then “send it outside”. The agent and security kernel preserve separate context.</p></div> : currentChat.map((entry) => <div key={entry.id} className={`chat-item ${entry.role}`}><span>{entry.role === "user" ? "YOU" : entry.role === "assistant" ? "AGENT" : "RAKSHA"}</span><p>{entry.text}</p></div>)}</div>
                  <div className="composer"><textarea value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage() } }} placeholder="Give the agent a task..." rows={2} /><button disabled={!message.trim() || busy} onClick={sendMessage}>{busy ? "EVALUATING" : "SEND"}</button></div>
                </section>

                <section className="decision-panel glass-panel">
                  <div className="panel-head"><div><span className="section-index">SECURITY EXPLANATION</span><h3>{lastDecision ? `${lastDecision.risk_score} · ${lastDecision.verdict}` : "Waiting for action"}</h3></div></div>
                  {lastDecision ? <><ul className="reason-list">{lastDecision.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><RiskBars decision={lastDecision} /><div className="consequence"><span>CONSEQUENCE</span><p>{lastDecision.predicted_consequence}</p></div></> : <RiskBars decision={null} />}
                </section>
              </div>
            )}
          </div>
        )}

        {environment === "redteam" && (
          <div className="environment redteam-environment">
            <section className="section-intro"><div><span className="section-index">RED / 20 CURATED TESTS</span><h3>Attack the control plane before someone else does.</h3></div><p>Every scenario runs through the same security pipeline used by the live agent.</p></section>
            <div className="scenario-grid">{scenarios.map((scenario, index) => <article className="scenario-card" key={scenario.id}><div className="scenario-top"><span>{String(index + 1).padStart(2, "0")}</span><em className={scenario.severity.toLowerCase()}>{scenario.severity}</em></div><small>{scenario.category}</small><h4>{scenario.name}</h4><p>{scenario.description}</p><div className="scenario-foot"><span>EXPECTED · {scenario.expected_verdict}</span><button disabled={runningScenario === scenario.id} onClick={() => runScenario(scenario.id)}>{runningScenario === scenario.id ? "RUNNING" : "RUN SCENARIO"}</button></div></article>)}</div>
            {attackResult && <div className="attack-modal-backdrop" onClick={() => setAttackResult(null)}><section className="attack-modal" onClick={(e) => e.stopPropagation()}><div className="attack-modal-head"><div><span>RED-TEAM RESULT</span><h3>{attackResult.name}</h3></div><button onClick={() => setAttackResult(null)}>×</button></div><div className={`attack-verdict ${verdictTone(attackResult.final_verdict)}`}><strong>{attackResult.final_risk_score}</strong><span>{attackResult.final_verdict}</span><em>{attackResult.passed ? "EXPECTED BEHAVIOR MATCHED" : "RESULT MISMATCH"}</em></div><div className="attack-flow">{attackResult.events.map((event, index) => <article key={index} className={verdictTone(event.verdict)}><span>{index + 1}</span><div><strong>{event.action.tool}</strong><small>{event.action.resource || event.action.destination}</small></div><b>{event.risk_score} · {event.verdict}</b></article>)}</div></section></div>}
          </div>
        )}

        {environment === "governance" && (
          <div className="environment governance-environment">
            <section className="section-intro"><div><span className="section-index">HUMAN AUTHORITY</span><h3>The agent stops here until a person decides.</h3></div><p>Allow once, deny, or grant the narrowest possible session-bound scope.</p></section>
            <div className="review-grid">{reviews.length === 0 ? <div className="wide-empty">No review requests are waiting. Sensitive actions will appear here automatically.</div> : reviews.map((review) => <article className={`review-card ${review.status.toLowerCase()}`} key={review.review_id}><div className="review-head"><div><small>{review.session_id}</small><h4>{review.action.tool} · {review.action.resource || "no resource"}</h4></div><div className="review-risk"><strong>{review.risk_score}</strong><span>{review.status}</span></div></div><div className="review-route"><span>RESOURCE<strong>{review.action.resource || "—"}</strong></span><i>→</i><span>DESTINATION<strong>{review.action.destination || "local"}</strong></span></div><ul>{review.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}</ul><div className="consequence"><span>PREDICTED CONSEQUENCE</span><p>{review.predicted_consequence}</p></div>{review.status === "PENDING" ? <div className="review-actions"><button className="allow-once" onClick={() => decideReview(review, "ALLOW_ONCE")}>ALLOW ONCE</button><button className="scoped" onClick={() => decideReview(review, "SCOPED_ALLOW")}>SCOPED ALLOW</button><button className="deny" onClick={() => decideReview(review, "DENY")}>DENY</button></div> : <div className="resolved-stamp">{review.final_outcome ?? review.status}</div>}</article>)}</div>
          </div>
        )}

        {environment === "evidence" && (
          <div className="environment evidence-environment">
            <section className="evidence-top">
              <article className="proof-card glass-panel"><span>DO THE RECORDS STILL MATCH?</span><strong>{verify?.chain_valid === true ? "YES · ALL GOOD" : verify ? "CHECK FAILED" : "CHECKING"}</strong><p>Tamper-evident local audit history. RAKSHA links security events cryptographically and summarizes them with a Merkle fingerprint.</p><div className="proof-meta"><span>EVENTS<b>{String(verify?.event_count ?? auditEvents.length)}</b></span><span>ROOT<b>{String(verify?.merkle_root ?? "—").slice(0, 14)}...</b></span></div></article>
              <article className="tamper-card"><span>SAFE CHANGE TEST</span><h3>Prove the chain notices modification.</h3><p>The test changes an in-memory copy only. Your real security record remains untouched.</p><button onClick={runTamper}>RUN SAFE CHANGE TEST</button>{tamper && <div className="tamper-result"><strong>{tamper.chain_valid === false ? "CHANGE DETECTED" : "NO CHANGE DETECTED"}</strong><span>Original log modified: {String(tamper.real_log_modified)}</span></div>}</article>
            </section>
            <section className="story-panel glass-panel"><div className="panel-head"><div><span className="section-index">RECENT SECURITY STORY</span><h3>What happened, in order.</h3></div><button onClick={refreshEvidence}>REFRESH</button></div><div className="evidence-stream">{auditEvents.length === 0 ? <div className="empty-state">No evidence events yet.</div> : auditEvents.map((event, index) => <article key={`${event.event_id}-${index}`}><span>{String(event.seq ?? "").padStart(3, "0")}</span><div><strong>{event.type?.replaceAll("_", " ")}</strong><small>{event.session_id || "system"} · {event.timestamp}</small></div><i /></article>)}</div></section>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
