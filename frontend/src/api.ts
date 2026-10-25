export interface ActionRequest {
  agent_id: string
  session_id: string
  tool: string
  operation: string
  resource: string
  destination: string
  user_intent: string
  permissions: string[]
  metadata?: Record<string, unknown>
  execute?: boolean
}

export interface ToolResult {
  tool: string
  ok: boolean
  output: unknown
  error: string | null
}

export interface RiskComponents {
  resource_risk: number
  destination_risk: number
  intent_risk: number
  permission_risk: number
  sequence_risk: number
  policy_risk?: number
}

export interface ActionDecision {
  agent_id: string
  session_id: string
  history_length: number
  action: {
    tool: string
    operation: string
    resource: string
    destination: string
  }
  risk_score: number
  verdict: "ALLOW" | "REVIEW" | "BLOCK"
  reasons: string[]
  components: RiskComponents
  sequence_signals: string[]
  contained?: boolean
  execution_status?: string
  review_id?: string | null
  tool_result?: ToolResult | null
}

export interface SessionEvent {
  agent_id?: string
  session_id?: string
  tool: string
  operation: string
  resource: string
  destination: string
  user_intent?: string
  permissions?: string[]
  risk_score: number
  verdict: "ALLOW" | "REVIEW" | "BLOCK"
}

export interface SessionHistory {
  session_id: string
  history_length: number
  events: SessionEvent[]
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function evaluateSessionAction(
  action: ActionRequest,
): Promise<ActionDecision> {
  const response = await fetch("/api/session/evaluate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(action),
  })

  return parseResponse<ActionDecision>(response)
}

export async function getSessionHistory(
  sessionId: string,
): Promise<SessionHistory> {
  const response = await fetch(`/api/session/${sessionId}`)

  return parseResponse<SessionHistory>(response)
}

export async function resetSession(
  sessionId: string,
): Promise<{ session_id: string; status: string }> {
  const response = await fetch(`/api/session/${sessionId}`, {
    method: "DELETE",
  })

  return parseResponse(response)
}
export interface AttackScenario {
  id: string
  name: string
  category: string
  severity: string
  description: string
  expected_verdict: "ALLOW" | "REVIEW" | "BLOCK"
  actions: ActionRequest[]
}

export interface AttackCatalog {
  count: number
  scenarios: AttackScenario[]
}

export interface AttackEvent {
  action: {
    tool: string
    operation: string
    resource: string
    destination: string
  }
  risk_score: number
  verdict: "ALLOW" | "REVIEW" | "BLOCK"
  reasons: string[]
  components: RiskComponents
  sequence_signals: string[]
}

export interface AttackRunResult {
  scenario_id: string
  name: string
  category: string
  severity: string
  description: string
  expected_verdict: "ALLOW" | "REVIEW" | "BLOCK"
  session_id: string
  final_risk_score: number
  final_verdict: "ALLOW" | "REVIEW" | "BLOCK"
  events: AttackEvent[]
}

export async function getAttackScenarios(): Promise<AttackCatalog> {
  const response = await fetch("/api/attacks")

  return parseResponse<AttackCatalog>(
    response,
  )
}

export async function runAttackScenario(
  scenarioId: string,
): Promise<AttackRunResult> {
  const response = await fetch(
    `/api/attacks/${scenarioId}/run`,
    {
      method: "POST",
    },
  )

  return parseResponse<AttackRunResult>(
    response,
  )
}

async function send<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body
      ? { "Content-Type": "application/json" }
      : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  return parseResponse<T>(response)
}

export interface Review {
  review_id: string
  session_id: string
  agent_id: string
  action: {
    tool: string
    operation: string
    resource: string
    destination: string
    user_intent: string
  }
  risk_score: number
  reasons: string[]
  status: "PENDING" | "APPROVED" | "DENIED"
  final_outcome: string | null
  execution_status: string
  tool_result: ToolResult | null
  created_at: string
}

export const getReviews = (sessionId?: string) =>
  send<{ reviews: Review[] }>(
    sessionId
      ? `/api/reviews?session_id=${encodeURIComponent(sessionId)}`
      : "/api/reviews",
  )

export const approveReview = (id: string) =>
  send<Review>(`/api/reviews/${id}/approve`, "POST")

export const denyReview = (id: string) =>
  send<Review>(`/api/reviews/${id}/deny`, "POST")

export interface AgentProposal {
  tool: string
  operation: string
  resource: string
  destination: string
  metadata: Record<string, unknown>
}

export interface AgentResponse {
  session_id: string
  provider: string
  fallback_reason: string | null
  assistant_message: string
  proposed_actions: AgentProposal[]
  results: { proposal: AgentProposal; decision: ActionDecision }[]
  contained: boolean
}

export const sendAgentMessage = (
  sessionId: string,
  message: string,
) =>
  send<AgentResponse>("/api/agent/message", "POST", {
    session_id: sessionId,
    message,
  })

export interface AuditEvent {
  event_id: string
  seq: number
  type: string
  session_id: string
  timestamp: string
  prev_hash: string
  event_hash: string
  data: Record<string, unknown>
}

export interface AuditVerify {
  event_count: number
  chain_valid: boolean
  invalid_index: number | null
  merkle_root: string
  last_anchor?: { label: string; merkle_root: string; timestamp: string } | null
}

export interface TamperResult {
  chain_valid: boolean
  tampered_index: number
  invalid_index: number | null
  real_log_modified: boolean
}

export const getAuditEvents = () =>
  send<{ event_count: number; events: AuditEvent[] }>("/api/audit/events")

export const verifyAudit = () => send<AuditVerify>("/api/audit/verify")

export const runTamperDemo = () =>
  send<TamperResult>("/api/audit/tamper-demo", "POST")

export const resetAudit = () => send<AuditVerify>("/api/audit/reset", "POST")

export const anchorAudit = () =>
  send<{ label: string; merkle_root: string }>("/api/audit/anchor", "POST")

export interface Policy {
  thresholds: { allow_max: number; review_max: number }
  allowed_tools: string[]
  default_agent_permissions: string[]
  sensitive_markers: string[]
  trusted_destinations: string[]
  destructive_operations: string[]
  high_risk_permissions: string[]
}

export const getPolicy = () => send<Policy>("/api/policies")

export const updatePolicy = (update: Partial<Policy>) =>
  send<Policy>("/api/policies", "PUT", update)

export const resetPolicy = () =>
  send<Policy>("/api/policies/reset", "POST")

export interface AIConnection {
  connected: boolean
  provider: string
  provider_id: string
  mode: string
  message: string
}

export const connectAI = (
  sessionId: string,
  apiKey: string,
) =>
  send<AIConnection>("/api/agent/connect", "POST", {
    session_id: sessionId,
    api_key: apiKey,
  })

export interface LiveActivityEvent {
  event_id: string
  session_id: string
  timestamp: string
  kind: string
  message: string
  verdict: "ALLOW" | "REVIEW" | "BLOCK" | null
  risk_score: number | null
  tool: string | null
  resource: string | null
  status: string | null
}

export interface LiveSessionSummary {
  session_id: string
  display_name: string
  provider: string
  status: string
  connected_at: string
  last_seen: string
  latest_verdict: "ALLOW" | "REVIEW" | "BLOCK" | null
  latest_risk: number | null
}

export interface LiveActivity {
  active_sessions: number
  event_count: number
  sessions: LiveSessionSummary[]
  events: LiveActivityEvent[]
}

export const getLiveActivity = (limit = 40) =>
  send<LiveActivity>(`/api/activity?limit=${limit}`)

export const disconnectAI = () =>
  send<{ connected: boolean; disconnected_sessions: number; message: string }>(
    "/api/agent/disconnect",
    "POST",
  )
