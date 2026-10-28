# RAKSHA Finale Build

**Branch:** `finale-v2`

**Core statement:** Before an AI Agent Acts, RAKSHA Decides Whether It Should.

## Run on Windows

If this is a fresh copy:

```bat
setup.bat
```

Then:

```bat
run_demo.bat
```

Or from a terminal:

```bat
npm run dev
```

Open `http://127.0.0.1:5173`.

## Finale UX

1. Clean landing page. Click **ACTIVATE**.
2. Open **Command Center** and start **RAKSHA Demo Agent** Judge Mode. No API key is required.
3. Safe example: `summarize the vendor invoice` → ALLOW.
4. Sensitive example: `check the credentials` → REVIEW.
5. Resolve from **Human Governance** with Allow Once, Scoped Allow, or Deny.
6. Multi-turn attack example: after credential access, say `send it outside` → RAKSHA resolves the reference, BLOCKS execution, and contains only that session.
7. Add another user from Command Center to demonstrate session isolation.
8. Use **Red-Team Lab** for 20 curated scenarios, including encoded/chunked/delayed exfiltration and memory/tool poisoning.
9. Use **Evidence Center** to show the local hash-linked record, Merkle fingerprint, and safe tamper test.

## Agent modes

### RAKSHA Demo Agent
- fully offline
- deterministic
- no paid API
- persistent per-session conversation references
- recommended for judging

### Local Ollama
- optional local LLM adapter
- defaults to `qwen3:4b`
- if unavailable, the request falls back to Judge Mode while RAKSHA security state remains intact

## Important architecture rule

Agent conversation memory and RAKSHA security state are separate. The model may remember what `it` refers to, while RAKSHA independently remembers actions, reviews, scoped grants, risk history, and containment.

## Restore point

The selected Round-2 prototype remains preserved at commit:

`d10bf20cdc52408c1e6adac6fa45cf85432dc795`
