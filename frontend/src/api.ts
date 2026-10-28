export type Verdict = 'ALLOW' | 'REVIEW' | 'BLOCK'
export type ProviderMode = 'demo' | 'ollama' | 'real'

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
  action: {
    tool: string
    operation: string
    resource: string
    destination: string
  }
  risk_score: number
  verdict: Verdict
  reasons: string[]
  components: RiskComponents
  sequence_signals?: string[]
  signals?: string[]
  contained?: boolean
  execution_status?: string
  review_id?: string | null
  tool_result?: ToolResult | null
}

export class ApiError extends Error {
  status: number
  code?: string
  detail?: unknown

  constructor(message: string, status: number, code?: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const raw = await response.text()
  let parsed: unknown = null
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = raw
    }
  }
  if (!response.ok) {
    let message = `Request failed: ${response.status}`
    let code: string | undefined
    if (typeof parsed === 'string' && parsed.trim()) message = parsed
    if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
      const detail = (parsed as { detail: unknown }).detail
      if (typeof detail === 'string') message = detail
      if (detail && typeof detail === 'object') {
        const d = detail as { message?: string; code?: string }
        if (d.message) message = d.message
        if (d.code) code = d.code
      }
    }
    throw new ApiError(message, response.status, code, parsed)
  }
  return parsed as T
}

async function send<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return parseResponse<T>(response)
}

export interface LiveSessionSummary {
  session_id: string
  display_name: string
  connected: boolean
  provider: string
  model: string | null
  status: string
  latest_verdict: Verdict | null
  latest_risk: number | null
  contained: boolean
  history_length: number
  grant_count: number
}

export const getSessions = () => send<{ count: number; sessions: LiveSessionSummary[] }>('/api/sessions')
export const createUser = (name: string) => send<LiveSessionSummary>('/api/users', 'POST', { name })
export const deleteUser = (sessionId: string) => send<{ session_id: string; deleted: boolean }>(`/api/users/${encodeURIComponent(sessionId)}`, 'DELETE')
export const resetUserSession = (sessionId: string) => send<LiveSessionSummary>(`/api/session/${encodeURIComponent(sessionId)}/reset`, 'POST')

export interface AIConnection {
  connected: boolean
  provider: string
  provider_id: string
  mode: string
  model: string | null
  message: string
  session: LiveSessionSummary
}

export const connectAI = (
  sessionId: string,
  mode: Exclude<ProviderMode, 'real'>,
  displayName: string,
  model?: string,
) => send<AIConnection>('/api/agent/connect', 'POST', {
  session_id: sessionId,
  mode,
  display_name: displayName,
  model: mode === 'ollama' ? (model || 'llama3.2') : undefined,
})

export const disconnectAI = () => send<{ connected: boolean; disconnected_sessions: number; message: string }>('/api/agent/disconnect', 'POST')

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

export const sendAgentMessage = (sessionId: string, message: string) => send<AgentResponse>('/api/agent/message', 'POST', {
  session_id: sessionId,
  message,
})

export interface Review {
  review_id: string
  session_id: string
  status: 'PENDING' | 'APPROVED' | 'DENIED'
  final_outcome: string | null
  created_at: string
  resolved_at?: string | null
  action: {
    tool: string
    operation: string
    resource: string
    destination: string
    user_intent: string
  }
  risk_score: number
  reasons: string[]
  components?: RiskComponents
  signals?: string[]
  predicted_consequence?: string
  execution_status: string
  tool_result: ToolResult | null
}

export const getReviews = (sessionId?: string, status?: string) => {
  const params = new URLSearchParams()
  if (sessionId) params.set('session_id', sessionId)
  if (status) params.set('status', status)
  return send<{ reviews: Review[] }>(`/api/reviews${params.size ? `?${params}` : ''}`)
}
export const approveReview = (id: string) => send<Review>(`/api/reviews/${id}/approve`, 'POST')
export const denyReview = (id: string) => send<Review>(`/api/reviews/${id}/deny`, 'POST')

export interface AttackScenario {
  id: string
  name: string
  category: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string
  description: string
  expected_verdict: Verdict
}

export interface AttackEvent {
  action: {
    tool: string
    operation: string
    resource: string
    destination: string
  }
  risk_score: number
  verdict: Verdict
  reasons: string[]
  components: RiskComponents
  sequence_signals?: string[]
  signals?: string[]
}

export interface AttackRunResult {
  scenario_id: string
  name: string
  category: string
  severity: string
  description: string
  expected_verdict: Verdict
  session_id: string
  final_risk_score: number
  final_verdict: Verdict
  passed: boolean
  contained: boolean
  events: AttackEvent[]
}

export const getAttackScenarios = () => send<{ count: number; scenarios: AttackScenario[] }>('/api/attacks')
export const runAttackScenario = (scenarioId: string) => send<AttackRunResult>(`/api/attacks/${encodeURIComponent(scenarioId)}/run`, 'POST')

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
  chain_valid_before?: boolean
  chain_valid: boolean
  tampered_index: number
  invalid_index: number | null
  real_log_modified: boolean
}

export const getAuditEvents = () => send<{ event_count: number; events: AuditEvent[] }>('/api/audit/events')
export const verifyAudit = () => send<AuditVerify>('/api/audit/verify')
export const runTamperDemo = () => send<TamperResult>('/api/audit/tamper-demo', 'POST')
export const anchorAudit = () => send<{ label: string; merkle_root: string }>('/api/audit/anchor', 'POST')

export interface Policy {
  thresholds: { allow_max: number; review_max: number }
  allowed_tools: string[]
  default_agent_permissions: string[]
  sensitive_markers: string[]
  trusted_destinations: string[]
  trusted_users: string[]
  trusted_tools: string[]
  destructive_operations: string[]
  high_risk_permissions: string[]
}

export const getPolicy = () => send<Policy>('/api/policies')
export const updatePolicy = (update: Partial<Policy>) => send<Policy>('/api/policies', 'PUT', update)
export const resetPolicy = () => send<Policy>('/api/policies/reset', 'POST')
