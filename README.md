# RAKSHA — Runtime Agent Kernel for Secure Human-Governed Autonomy

AI agent → structured tool proposal → **RAKSHA interceptor** → context/sequence/policy analysis → explainable risk (0-100) → **ALLOW / REVIEW / BLOCK**.

- ALLOW → runs in a safe synthetic sandbox
- REVIEW → paused; human clicks **ALLOW ONCE** or **DENY** (approval covers only that one action)
- BLOCK → never executes; session is contained
- Every important event is recorded in protected activity history for later verification

## Windows setup (beginner)
1. Install Python 3.11+ and Node.js 20+ (tick "Add to PATH").
2. Double-click `setup.bat` (creates `.venv`, installs everything).
3. Double-click `run_demo.bat`, then open http://127.0.0.1:5173

Or run in a terminal:

```bat
npm run dev
```

## Main demo flow
1. The RAKSHA cover page appears once per browser session. Click **ACTIVATE**.
2. Open **COMMAND CENTER**.
3. Enter any non-empty demo API key and click **CONNECT AI**. The key is never stored or logged. The free offline **RAKSHA Demo Model** is used.
4. Chat normally. RAKSHA silently watches the AI's proposed tool actions.
5. A risky prompt automatically opens **HUMAN AUTHORIZATION REQUIRED** with **ALLOW ONCE / DENY**.
6. Dangerous actions are blocked and only that user session is contained.
7. Click the current user ID to open the **LIVE USERS** switcher, add another user, or move between active users without mixing their conversations.
8. The **LIVE USER ACTIVITY** panel auto-updates across independent sessions.
9. **DISCONNECT** closes the current demo model connection, clears all live sessions/activity, and returns the Command Center to a fresh connection screen. Permanent Activity History remains available as evidence.
10. **ATTACK LAB** contains 12 controlled attack cards; each result opens in a popup.
11. **ACTIVITY HISTORY** explains the protected record in plain language and includes a safe change-detection test.

## Offline by default
No paid API key is required. The built-in **MockProvider** drives the demo.

Optional cloud configuration is still available: copy `.env.example` to `.env`, then set `GROQ_API_KEY` + `GROQ_MODEL` or `GEMINI_API_KEY` + `GEMINI_MODEL`. Any cloud failure automatically falls back to Mock. The model only *proposes* tools; RAKSHA decides whether anything executes.

## Safety of the sandbox
`sandbox/` is synthetic. File access cannot leave it (`..` and absolute paths are rejected), shell is **simulated** (never executed), email is written to the local sandbox mailbox, HTTP makes no network call, and the database is a local SQLite demo.

## Activity History / audit integrity
The backend stores protected activity records with SHA-256 linking and a Merkle-root fingerprint. The UI intentionally explains these concepts in plain language. The history-protection test modifies an in-memory copy only, so the real activity history is never damaged. A local demo anchor can save the current fingerprint; `legacy_demo/AuditAnchor.sol` remains as the optional blockchain reference contract.

## Tests
```bat
.venv\Scripts\python.exe -m pytest backend\tests -q
cd frontend && npx vitest run
cd ..
npm --prefix frontend run build
```

## Main API routes
`/api/agent/connect` · `/api/agent/disconnect` · `/api/agent/message` · `/api/activity` · `/api/session/evaluate` · `/api/reviews` (+ `/{id}/approve|deny`) · `/api/policies` · `/api/audit/{events,verify,tamper-demo,reset,anchor}` · `/api/attacks`
