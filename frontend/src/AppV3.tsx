import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import gsap from "gsap"
import MotionScene from "./motion/MotionScene"

type Environment = "command" | "redteam" | "governance" | "evidence"
type ProviderMode = "demo" | "ollama"
type Verdict = "ALLOW" | "REVIEW" | "BLOCK"

type Health = {
  status: string
  project: string
  version: string
  security_engine: string
  offline_ready: boolean
}

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

type Scenario = {
  id: string
  name: string
  category: string
  severity: string
  description: string
  expected_verdict: Verdict
}

type AttackEvent = {
  action: { tool?: string; operation?: string; resource?: string; destination?: string }
  verdict: Verdict
  risk_score: number
  reasons: string[]
  signals: string[]
}

type AttackResult = {
  scenario_id: string
  name: string
  expected_verdict: Verdict
  final_verdict: Verdict
  final_risk_score: number
  passed: boolean
  contained: boolean
  events: AttackEvent[]
}

type AuditEvent = {
  event_id?: string
  seq?: number
  type?: string
  session_id?: string
  timestamp?: string
  data?: Record<string, unknown>
}

type ApiErrorPayload = { detail?: unknown }

const NAV: { key: Environment; num: string; label: string; sub: string }[] = [
  { key: "command", num: "01", label: "Command Center", sub: "live enforcement" },
  { key: "redteam", num: "02", label: "Red-Team Lab", sub: "breach simulation" },
  { key: "governance", num: "03", label: "Human Governance", sub: "authority checkpoint" },
  { key: "evidence", num: "04", label: "Evidence Center", sub: "forensic proof" },
]

function makeId(prefix = "id") {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${suffix}`
}

function explainDetail(detail: unknown): string {
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => {
      if (typeof item === "string") return item
      if (item && typeof item === "object") {
        const obj = item as { msg?: unknown; loc?: unknown }
        const msg = typeof obj.msg === "string" ? obj.msg : "Validation error"
        const loc = Array.isArray(obj.loc) ? obj.loc.join(" → ") : "request"
        return `${loc}: ${msg}`
      }
      return "Validation error"
    })
    return messages.join(" · ")
  }
  if (detail && typeof detail === "object") {
    try { return JSON.stringify(detail) } catch { return "Request was rejected by the backend" }
  }
  return "Request was rejected by the backend"
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  })
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const payload = await response.json() as ApiErrorPayload
      if (payload.detail !== undefined) message = explainDetail(payload.detail)
    } catch { /* response was not JSON */ }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

function verdictTone(verdict?: string | null) {
  if (verdict === "ALLOW") return "allow"
  if (verdict === "REVIEW") return "review"
  if (verdict === "BLOCK") return "block"
  return "neutral"
}

function formatEventName(value?: string) {
  return (value ?? "SYSTEM EVENT").replaceAll("_", " ")
}

function RiskMatrix({ decision }: { decision: Decision | null }) {
  const labels: Record<string, string> = {
    resource_risk: "Resource",
    destination_risk: "Destination",
    intent_risk: "Intent",
    permission_risk: "Permission",
    sequence_risk: "Sequence",
    policy_risk: "Policy",
    identity_risk: "Identity",
    tool_risk: "Tool",
  }
  if (!decision) {
    return <div className="v3-empty compact">Waiting for the next proposed action.</div>
  }
  return (
    <div className="risk-matrix">
      {Object.entries(decision.components ?? {}).map(([key, value]) => (
        <div className="risk-signal" key={key}>
          <div><span>{labels[key] ?? key}</span><b>{value}</b></div>
          <div className="risk-meter"><i style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, value / 100))})` }} /></div>
        </div>
      ))}
    </div>
  )
}

function AppV3() {
  const [activated, setActivated] = useState(() => sessionStorage.getItem("raksha-v3-activated") === "1")
  const [activating, setActivating] = useState(false)
  const [environment, setEnvironment] = useState<Environment>("command")
  const [sessionId, setSessionId] = useState(() => sessionStorage.getItem("raksha-v3-session") || makeId("user"))
  const [providerMode, setProviderMode] = useState<ProviderMode>("demo")
  const [connected, setConnected] = useState(false)
  const [providerName, setProviderName] = useState("RAKSHA Demo Agent")
  const [message, setMessage] = useState("")
  const [chat, setChat] = useState<Record<string, ChatEntry[]>>({})
  const [latest, setLatest] = useState<Record<string, AgentResponse | null>>({})
  const [busy, setBusy] = useState(false)
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [selectedScenarioId, setSelectedScenarioId] = useState("")
  const [attackResult, setAttackResult] = useState<AttackResult | null>(null)
  const [runningScenario, setRunningScenario] = useState("")
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [verify, setVerify] = useState<Record<string, unknown> | null>(null)
  const [tamper, setTamper] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState("")
  const [liteMotion, setLiteMotion] = useState(() => localStorage.getItem("raksha-v3-lite") === "1")
  const sceneRoot = useRef<HTMLDivElement>(null)

  const currentChat = chat[sessionId] ?? []
  const currentResponse = latest[sessionId] ?? null
  const lastDecision = useMemo<Decision | null>(() => {
    if (!currentResponse?.results?.length) return null
    return currentResponse.results[currentResponse.results.length - 1].decision
  }, [currentResponse])
  const currentSession = sessions.find((item) => item.session_id === sessionId)
  const selectedScenario = scenarios.find((item) => item.id === selectedScenarioId) ?? scenarios[0]
  const pendingReviews = reviews.filter((review) => review.status === "PENDING")
  const activeReview = pendingReviews.find((review) => review.session_id === sessionId) ?? pendingReviews[0] ?? reviews[0]

  const addChat = useCallback((sid: string, entry: ChatEntry) => {
    setChat((existing) => ({ ...existing, [sid]: [...(existing[sid] ?? []), entry] }))
  }, [])

  const verifyFinaleBackend = useCallback(async () => {
    const health = await api<Health>("/api/health")
    if (health.project !== "RAKSHA" || health.version !== "2.0.0-finale") {
      throw new Error(`Wrong RAKSHA backend detected (${health.version || "unknown"}). Close old prototype terminals and run this finale folder again.`)
    }
    return health
  }, [])

  const refreshRuntime = useCallback(async () => {
    try {
      const [sessionData, reviewData] = await Promise.all([
        api<{ sessions: LiveSession[] }>("/api/sessions"),
        api<{ reviews: Review[] }>("/api/reviews"),
      ])
      setSessions(sessionData.sessions)
      setReviews(reviewData.reviews)
    } catch { /* transient refresh should not kill the interface */ }
  }, [])

  const refreshEvidence = useCallback(async () => {
    try {
      const [events, proof] = await Promise.all([
        api<{ events: AuditEvent[] }>("/api/audit/events?limit=160"),
        api<Record<string, unknown>>("/api/audit/verify"),
      ])
      setAuditEvents(events.events.slice().reverse())
      setVerify(proof)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evidence refresh failed")
    }
  }, [])

  useEffect(() => {
    sessionStorage.setItem("raksha-v3-session", sessionId)
  }, [sessionId])

  useEffect(() => {
    if (!activated) return
    void verifyFinaleBackend().catch((err) => setError(err instanceof Error ? err.message : "Finale backend unavailable"))
    api<{ scenarios: Scenario[] }>("/api/attacks")
      .then((data) => {
        setScenarios(data.scenarios)
        if (!selectedScenarioId && data.scenarios[0]) setSelectedScenarioId(data.scenarios[0].id)
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load Red-Team scenarios"))
    void refreshRuntime()
    const timer = window.setInterval(refreshRuntime, 1600)
    return () => window.clearInterval(timer)
  }, [activated, refreshRuntime, selectedScenarioId, verifyFinaleBackend])

  useLayoutEffect(() => {
    if (!activated || liteMotion || !sceneRoot.current) return
    const target = sceneRoot.current.querySelector(".v3-environment")
    if (!target) return
    gsap.fromTo(target,
      { opacity: 0, y: 26, rotateX: 3.5, scale: 0.985 },
      { opacity: 1, y: 0, rotateX: 0, scale: 1, duration: 0.75, ease: "power3.out" },
    )
  }, [environment, activated, liteMotion])

  async function activate() {
    setActivating(true)
    setError("")
    try {
      await verifyFinaleBackend()
      sessionStorage.setItem("raksha-v3-activated", "1")
      setActivated(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "RAKSHA finale backend unavailable")
    } finally {
      setActivating(false)
    }
  }

  async function connect(mode = providerMode, sid = sessionId) {
    setError("")
    try {
      await verifyFinaleBackend()
      const data = await api<{ provider: string }>("/api/agent/connect", {
        method: "POST",
        body: JSON.stringify({ session_id: sid, mode }),
      })
      setConnected(true)
      setProviderName(data.provider)
      addChat(sid, {
        id: makeId("msg"),
        role: "raksha",
        text: mode === "demo"
          ? "Judge Mode online. Conversation context and security state are now isolated for this user."
          : "Local Ollama selected. If the model is unavailable, Judge Mode takes over without resetting RAKSHA security state.",
      })
      await refreshRuntime()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent connection failed")
    }
  }

  async function disconnect() {
    try {
      await api("/api/agent/disconnect", { method: "POST" })
      setConnected(false)
      setChat({})
      setLatest({})
      setReviews([])
      setSessions([])
      const next = makeId("user")
      setSessionId(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed")
    }
  }

  async function newUser() {
    const next = makeId("user")
    setSessionId(next)
    if (connected) await connect(providerMode, next)
  }

  async function resetUser() {
    try {
      await api(`/api/session/${sessionId}`, { method: "DELETE" })
      setChat((value) => ({ ...value, [sessionId]: [] }))
      setLatest((value) => ({ ...value, [sessionId]: null }))
      if (connected) await connect(providerMode, sessionId)
      await refreshRuntime()
    } catch (err) {
      setError(err instanceof Error ? err.message : "User reset failed")
    }
  }

  async function sendMessage() {
    const text = message.trim()
    if (!text || busy || !connected) return
    setBusy(true)
    setMessage("")
    setError("")
    addChat(sessionId, { id: makeId("msg"), role: "user", text })
    try {
      const data = await api<AgentResponse>("/api/agent/message", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, message: text }),
      })
      setLatest((value) => ({ ...value, [sessionId]: data }))
      addChat(sessionId, { id: makeId("msg"), role: "assistant", text: data.assistant_message })
      if (data.fallback_reason) addChat(sessionId, { id: makeId("msg"), role: "raksha", text: data.fallback_reason })
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
    setError("")
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
    try {
      const result = await api<Record<string, unknown>>("/api/audit/tamper-demo", { method: "POST" })
      setTamper(result)
      await refreshEvidence()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tamper test failed")
    }
  }

  function moveTo(next: Environment) {
    setEnvironment(next)
    if (next === "evidence") void refreshEvidence()
  }

  function toggleMotion() {
    const next = !liteMotion
    setLiteMotion(next)
    localStorage.setItem("raksha-v3-lite", next ? "1" : "0")
  }

  if (!activated) {
    return (
      <main className="v3-landing">
        <div className="landing-linework" />
        <div className="landing-orbit orbit-a" />
        <div className="landing-orbit orbit-b" />
        <section className="v3-landing-copy">
          <div className="landing-brand-row"><span className="landing-sigil">R</span><span>YUKTHI 2026 · FINALE</span></div>
          <h1>RAKSHA</h1>
          <p className="landing-fullform">Runtime Agent Kernel for Secure Human-Governed Autonomy</p>
          <div className="landing-rule" />
          <p className="landing-statement">Before an AI Agent Acts,<br /><strong>RAKSHA Decides Whether It Should.</strong></p>
          <button className="v3-activate" onClick={activate} disabled={activating}>
            <span>{activating ? "VERIFYING RUNTIME" : "ACTIVATE RAKSHA"}</span><i>↗</i>
          </button>
          {error && <div className="landing-error-v3">{error}</div>}
        </section>
        <div className="landing-index">R / 03</div>
      </main>
    )
  }

  return (
    <main className={`v3-shell env-${environment} ${liteMotion ? "lite" : "full"}`}>
      <MotionScene
        environment={environment}
        verdict={lastDecision?.verdict ?? null}
        reducedMotion={liteMotion}
        activeAttackSteps={attackResult?.events.length ?? (runningScenario ? 3 : 1)}
      />
      <div className="scene-vignette" />

      <aside className="v3-rail">
        <div className="v3-brand"><span>R</span><div><strong>RAKSHA</strong><small>RUNTIME SECURITY</small></div></div>
        <nav>
          {NAV.map((item) => (
            <button key={item.key} className={environment === item.key ? "active" : ""} onClick={() => moveTo(item.key)}>
              <span>{item.num}</span><div><strong>{item.label}</strong><small>{item.sub}</small></div>
            </button>
          ))}
        </nav>
        <div className="v3-rail-foot">
          <button onClick={toggleMotion}>{liteMotion ? "ENABLE CINEMATIC" : "LITE MOTION"}</button>
          <div className="runtime-state"><i /><span>FINALE RUNTIME</span><b>8011</b></div>
        </div>
      </aside>

      <section className="v3-stage" ref={sceneRoot}>
        <header className="v3-topbar">
          <div><span>ZERO-TRUST AGENT CONTROL PLANE</span><strong>{NAV.find((item) => item.key === environment)?.label}</strong></div>
          <div className="v3-status">
            <span className={currentSession?.contained ? "danger" : connected ? "ok" : "idle"}>{currentSession?.contained ? "CONTAINED" : connected ? "PROTECTED" : "OFFLINE"}</span>
            <b>{sessionId}</b>
          </div>
        </header>

        {error && <div className="v3-error"><b>RUNTIME NOTICE</b><span>{error}</span><button onClick={() => setError("")}>×</button></div>}

        {environment === "command" && (
          <div className="v3-environment command-world">
            <section className="command-title-block">
              <div><span className="micro-label">LIVE SECURITY OPERATIONS / 01</span><h2>Watch the boundary,<br />not just the chatbot.</h2><p>The model can reason. Every action still has to cross RAKSHA.</p></div>
              <div className={`risk-dial ${verdictTone(lastDecision?.verdict)}`}><span>RISK</span><strong>{String(lastDecision?.risk_score ?? 0).padStart(2, "0")}</strong><b>{lastDecision?.verdict ?? "MONITOR"}</b></div>
            </section>

            {!connected ? (
              <section className="provider-launch">
                <div className="provider-intro"><span>AGENT LINK</span><strong>Choose the brain.<br />RAKSHA keeps authority.</strong></div>
                <button className={`launch-mode ${providerMode === "demo" ? "selected" : ""}`} onClick={() => setProviderMode("demo")}>
                  <span>A</span><div><strong>Judge Mode</strong><small>OFFLINE · DETERMINISTIC · FINALE SAFE</small><p>No fake key. No quota. Persistent per-user context.</p></div><i>01</i>
                </button>
                <button className={`launch-mode ${providerMode === "ollama" ? "selected" : ""}`} onClick={() => setProviderMode("ollama")}>
                  <span>B</span><div><strong>Local Ollama</strong><small>LOCAL MODEL · OPTIONAL</small><p>Real local model path with fallback to Judge Mode.</p></div><i>02</i>
                </button>
                <button className="launch-button" onClick={() => connect()}><span>{providerMode === "demo" ? "START JUDGE MODE" : "CONNECT LOCAL MODEL"}</span><b>ENTER RUNTIME ↗</b></button>
              </section>
            ) : (
              <div className="operations-layout">
                <section className="ops-chat surface-panel">
                  <div className="ops-head"><div><span>AGENT CHANNEL</span><strong>{providerName}</strong></div><div className="ops-actions"><button onClick={newUser}>+ USER</button><button onClick={resetUser}>RESET</button><button onClick={disconnect}>DISCONNECT</button></div></div>
                  <div className="user-lanes">
                    {sessions.map((item, index) => (
                      <button key={item.session_id} onClick={() => setSessionId(item.session_id)} className={`${item.session_id === sessionId ? "selected" : ""} ${item.contained ? "contained" : ""}`}>
                        <b>U{String(index + 1).padStart(2, "0")}</b><span>{item.contained ? "LOCKED" : item.latest_verdict ?? "ACTIVE"}</span><i />
                      </button>
                    ))}
                  </div>
                  <div className="v3-chatlog">
                    {currentChat.length === 0 ? (
                      <div className="chat-zero"><span>CONTEXT TEST</span><strong>Talk naturally.</strong><p>Try: “summarize the invoice” → “check the credentials” → approve → “send it outside”.</p></div>
                    ) : currentChat.map((entry) => (
                      <article key={entry.id} className={`v3-message ${entry.role}`}><span>{entry.role === "user" ? "YOU" : entry.role === "assistant" ? "AGENT" : "RAKSHA"}</span><p>{entry.text}</p></article>
                    ))}
                  </div>
                  <div className="v3-composer"><textarea rows={2} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} placeholder="Give the agent a task..." /><button onClick={sendMessage} disabled={!message.trim() || busy}>{busy ? "CHECKING" : "SEND ↗"}</button></div>
                </section>

                <section className="ops-security surface-panel">
                  <div className="security-head"><span>DECISION ENGINE</span><strong>{lastDecision ? `${lastDecision.risk_score} / ${lastDecision.verdict}` : "STANDBY"}</strong></div>
                  <div className={`verdict-plate ${verdictTone(lastDecision?.verdict)}`}><span>{lastDecision?.action?.tool ?? "NO ACTION"}</span><strong>{lastDecision?.action?.resource ?? "Protected tool boundary"}</strong><b>{lastDecision?.execution_status ?? "WAITING"}</b></div>
                  {lastDecision && <ul className="decision-reasons">{lastDecision.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}</ul>}
                  <RiskMatrix decision={lastDecision} />
                  <div className="security-context"><span>SEQUENCE MEMORY</span><b>{currentResponse?.context?.history_length ?? 0} events</b><p>{lastDecision?.predicted_consequence ?? "RAKSHA is monitoring the session."}</p></div>
                </section>
              </div>
            )}
          </div>
        )}

        {environment === "redteam" && (
          <div className="v3-environment redteam-world">
            <section className="redteam-header"><div><span className="micro-label">BREACH SIMULATION / 02</span><h2>Red-Team Lab</h2><p>Drive attacks through the same enforcement kernel used by the live agent.</p></div><div className="scenario-count"><strong>{scenarios.length}</strong><span>CURATED<br />ATTACKS</span></div></section>
            <div className="redteam-console">
              <aside className="threat-rail surface-panel">
                <div className="threat-filter"><span>THREAT LIBRARY</span><b>EXPECTED OUTCOME</b></div>
                <div className="threat-list">{scenarios.map((scenario, index) => <button key={scenario.id} className={selectedScenario?.id === scenario.id ? "selected" : ""} onClick={() => { setSelectedScenarioId(scenario.id); setAttackResult(null) }}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{scenario.name}</strong><small>{scenario.category}</small></div><b className={verdictTone(scenario.expected_verdict)}>{scenario.expected_verdict}</b></button>)}</div>
              </aside>

              <section className="simulation-bay surface-panel">
                {selectedScenario ? <>
                  <div className="sim-head"><div><span>{selectedScenario.category} / {selectedScenario.severity}</span><h3>{selectedScenario.name}</h3><p>{selectedScenario.description}</p></div><button className="run-breach" disabled={runningScenario === selectedScenario.id} onClick={() => runScenario(selectedScenario.id)}>{runningScenario === selectedScenario.id ? "SIMULATING..." : "RUN BREACH ↗"}</button></div>
                  <div className="attack-track">
                    {(attackResult?.events ?? []).length === 0 ? (
                      <div className="attack-track-empty"><span>ATTACK PATH</span><strong>ARMED</strong><p>Run the scenario. Each proposed action will appear here as it crosses the RAKSHA boundary.</p></div>
                    ) : attackResult!.events.map((event, index) => <article key={index} className={verdictTone(event.verdict)}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{event.action.tool}</small><strong>{event.action.resource || event.action.destination || "action"}</strong></div><i /><b>{event.risk_score}</b><em>{event.verdict}</em></article>)}
                  </div>
                  <div className="sim-footer"><div><span>EXPECTED</span><strong>{selectedScenario.expected_verdict}</strong></div><div><span>ACTUAL</span><strong className={verdictTone(attackResult?.final_verdict)}>{attackResult?.final_verdict ?? "—"}</strong></div><div><span>SESSION</span><strong>{attackResult?.contained ? "CONTAINED" : attackResult ? "ACTIVE" : "—"}</strong></div><div><span>VERIFICATION</span><strong>{attackResult ? (attackResult.passed ? "MATCH" : "MISMATCH") : "—"}</strong></div></div>
                </> : <div className="v3-empty">No Red-Team scenarios loaded.</div>}
              </section>
            </div>
          </div>
        )}

        {environment === "governance" && (
          <div className="v3-environment governance-world">
            <section className="governance-header"><div><span className="micro-label">AUTHORITY CHECKPOINT / 03</span><h2>Nothing crosses<br />without permission.</h2><p>Human approval is narrow, visible, and bound to the affected session.</p></div><div className="pending-count"><strong>{pendingReviews.length}</strong><span>PENDING<br />DECISIONS</span></div></section>
            <div className="governance-layout">
              <aside className="review-queue surface-panel"><div className="queue-title"><span>REVIEW QUEUE</span><b>{reviews.length}</b></div>{reviews.length === 0 ? <div className="v3-empty compact">No review requests yet.</div> : reviews.map((review) => <button key={review.review_id} className={activeReview?.review_id === review.review_id ? "selected" : ""}><span>{review.status}</span><strong>{review.action.resource || review.action.tool}</strong><small>{review.session_id}</small></button>)}</aside>
              <section className="checkpoint surface-panel">
                {activeReview ? <>
                  <div className="checkpoint-top"><div><span>PAUSED ACTION</span><h3>{activeReview.action.tool}</h3><p>{activeReview.action.user_intent}</p></div><div className="review-score"><strong>{activeReview.risk_score}</strong><span>{activeReview.status}</span></div></div>
                  <div className="checkpoint-route"><div><span>RESOURCE</span><strong>{activeReview.action.resource || "—"}</strong></div><i>→</i><div><span>DESTINATION</span><strong>{activeReview.action.destination || "local"}</strong></div></div>
                  <div className="checkpoint-reasons">{activeReview.reasons.slice(0, 4).map((reason, index) => <div key={reason}><span>{String(index + 1).padStart(2, "0")}</span><p>{reason}</p></div>)}</div>
                  <div className="checkpoint-consequence"><span>IF APPROVED</span><p>{activeReview.predicted_consequence}</p></div>
                  {activeReview.status === "PENDING" ? <div className="checkpoint-actions"><button className="allow" onClick={() => decideReview(activeReview, "ALLOW_ONCE")}>ALLOW ONCE</button><button className="scope" onClick={() => decideReview(activeReview, "SCOPED_ALLOW")}>SCOPED ALLOW</button><button className="deny" onClick={() => decideReview(activeReview, "DENY")}>DENY</button></div> : <div className="checkpoint-resolved">{activeReview.final_outcome ?? activeReview.status}</div>}
                </> : <div className="checkpoint-empty"><span>HUMAN GATE</span><strong>CLEAR</strong><p>Sensitive actions will physically stop here before execution.</p></div>}
              </section>
            </div>
          </div>
        )}

        {environment === "evidence" && (
          <div className="v3-environment evidence-world">
            <section className="evidence-header"><div><span className="micro-label">FORENSIC PROOF / 04</span><h2>Every intervention<br />leaves a trace.</h2><p>Human-readable incident history backed by a tamper-evident local chain.</p></div><button onClick={refreshEvidence}>REFRESH RECORD ↻</button></section>
            <div className="evidence-layout">
              <section className="integrity-panel surface-panel"><span>INTEGRITY STATE</span><strong className={verify?.chain_valid === true ? "ok" : "warn"}>{verify?.chain_valid === true ? "VERIFIED" : verify ? "CHECK FAILED" : "CHECKING"}</strong><div className="integrity-stats"><div><span>EVENTS</span><b>{String(verify?.event_count ?? auditEvents.length)}</b></div><div><span>MERKLE ROOT</span><b>{String(verify?.merkle_root ?? "—").slice(0, 18)}...</b></div></div><button onClick={runTamper}>RUN SAFE TAMPER TEST</button>{tamper && <div className="tamper-proof"><strong>{tamper.chain_valid === false ? "CHANGE DETECTED" : "NO CHANGE"}</strong><span>Original modified: {String(tamper.real_log_modified)}</span></div>}</section>
              <section className="forensic-stream surface-panel"><div className="stream-head"><span>RECENT SECURITY STORY</span><b>{auditEvents.length} EVENTS LOADED</b></div><div className="timeline">{auditEvents.length === 0 ? <div className="v3-empty compact">No evidence events yet.</div> : auditEvents.map((event, index) => <article key={`${event.event_id}-${index}`}><span>{String(event.seq ?? "").padStart(3, "0")}</span><i /><div><strong>{formatEventName(event.type)}</strong><small>{event.session_id || "system"}</small></div><time>{event.timestamp?.slice(11, 19) ?? ""}</time></article>)}</div></section>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

export default AppV3
