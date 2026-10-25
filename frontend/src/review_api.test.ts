import { afterEach, describe, expect, it, vi } from "vitest"

import {
  approveReview,
  denyReview,
  getPolicy,
  runTamperDemo,
  sendAgentMessage,
  verifyAudit,
} from "./api"

function mockFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Human review API client", () => {
  it("approves via the real approve endpoint with POST", async () => {
    const fn = mockFetch({ status: "APPROVED", final_outcome: "ALLOW_ONCE" })
    const r = await approveReview("abc123")
    expect(fn).toHaveBeenCalledWith(
      "/api/reviews/abc123/approve",
      expect.objectContaining({ method: "POST" }),
    )
    expect(r.status).toBe("APPROVED")
  })

  it("denies via the real deny endpoint with POST", async () => {
    const fn = mockFetch({ status: "DENIED", final_outcome: "DENY" })
    await denyReview("abc123")
    expect(fn).toHaveBeenCalledWith(
      "/api/reviews/abc123/deny",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("surfaces HTTP 409 on repeated resolution", async () => {
    mockFetch({ detail: "Review already resolved" }, false, 409)
    await expect(approveReview("abc123")).rejects.toThrow(/already resolved/)
  })
})

describe("Agent, audit and policy clients", () => {
  it("posts agent messages with session and message", async () => {
    const fn = mockFetch({ provider: "mock", results: [] })
    await sendAgentMessage("s1", "hello")
    const [url, init] = fn.mock.calls[0]
    expect(url).toBe("/api/agent/message")
    expect(JSON.parse(init.body)).toEqual({ session_id: "s1", message: "hello" })
  })

  it("verifies the audit chain", async () => {
    mockFetch({ event_count: 3, chain_valid: true, merkle_root: "ab" })
    expect((await verifyAudit()).chain_valid).toBe(true)
  })

  it("runs the tamper demo", async () => {
    const fn = mockFetch({ chain_valid: false, real_log_modified: false })
    const r = await runTamperDemo()
    expect(fn.mock.calls[0][0]).toBe("/api/audit/tamper-demo")
    expect(r.chain_valid).toBe(false)
  })

  it("reads the policy", async () => {
    mockFetch({ thresholds: { allow_max: 30, review_max: 69 } })
    expect((await getPolicy()).thresholds.review_max).toBe(69)
  })
})

describe("Command Center API client", () => {
  it("connects the free demo AI without exposing the key in the response", async () => {
    const fn = mockFetch({
      connected: true,
      provider: "RAKSHA Demo Model",
      provider_id: "mock",
      mode: "FREE_DEMO",
      message: "Connected",
    })

    const { connectAI } = await import("./api")
    const result = await connectAI("user-1", "fake-demo-key")

    expect(result.connected).toBe(true)
    const [url, init] = fn.mock.calls[0]
    expect(url).toBe("/api/agent/connect")
    expect(JSON.parse(init.body)).toEqual({
      session_id: "user-1",
      api_key: "fake-demo-key",
    })
  })

  it("loads live multi-session activity", async () => {
    const fn = mockFetch({ active_sessions: 2, event_count: 2, events: [] })
    const { getLiveActivity } = await import("./api")
    const result = await getLiveActivity(24)

    expect(result.active_sessions).toBe(2)
    expect(fn.mock.calls[0][0]).toBe("/api/activity?limit=24")
  })
})
