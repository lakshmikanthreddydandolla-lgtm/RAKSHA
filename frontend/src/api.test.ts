import { afterEach, describe, expect, it, vi } from "vitest"

import {
  evaluateSessionAction,
  getSessionHistory,
  resetSession,
} from "./api"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("RAKSHA API client", () => {
  it("sends an action to the session evaluation endpoint", async () => {
    const mockResponse = {
      agent_id: "invoice-agent-17",
      session_id: "demo-session",
      history_length: 1,
      action: {
        tool: "read_file",
        operation: "read",
        resource: "vendor_invoice.pdf",
        destination: "local",
      },
      risk_score: 0,
      verdict: "ALLOW",
      reasons: ["No significant policy violations detected"],
      components: {
        resource_risk: 0,
        destination_risk: 0,
        intent_risk: 0,
        permission_risk: 0,
        sequence_risk: 0,
      },
      sequence_signals: [],
    }

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    })

    vi.stubGlobal("fetch", fetchMock)

    const result = await evaluateSessionAction({
      agent_id: "invoice-agent-17",
      session_id: "demo-session",
      tool: "read_file",
      operation: "read",
      resource: "vendor_invoice.pdf",
      destination: "local",
      user_intent: "summarize vendor invoice",
      permissions: ["read_file"],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/session/evaluate",
      expect.objectContaining({
        method: "POST",
      }),
    )

    expect(result.verdict).toBe("ALLOW")
  })

  it("loads session history", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        session_id: "demo-session",
        history_length: 0,
        events: [],
      }),
    })

    vi.stubGlobal("fetch", fetchMock)

    const result = await getSessionHistory("demo-session")

    expect(result.history_length).toBe(0)
  })

  it("resets a session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        session_id: "demo-session",
        status: "reset",
      }),
    })

    vi.stubGlobal("fetch", fetchMock)

    const result = await resetSession("demo-session")

    expect(result.status).toBe("reset")
  })
})