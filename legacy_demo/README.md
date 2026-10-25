# SENTRA - Hackathon Proof of Concept

**SENTRA = Secure Execution & Non-Repudiable Trust Runtime for AI Agents**

A software-only runtime security layer for autonomous AI agents. It inspects tool calls, scores risk, blocks dangerous actions, triggers containment, and records tamper-evident audit evidence.

## Run

Requires only Python 3.9+.

```bash
python server.py
```

Open: `http://127.0.0.1:8080`

## Demo script

1. Click **Run safe workflow**. SENTRA allows a trusted document read and an approved internal email.
2. Click **Launch prompt-injection attack**. A poisoned document tries to steer the agent toward `.env` and an attacker-controlled email address.
3. SENTRA blocks the workflow, records the reason, and triggers automatic containment.
4. The dashboard shows an append-only hash chain and a Merkle root suitable for blockchain anchoring.

## Prototype vs finale version

This proof of concept uses a deterministic local risk engine so it runs on any laptop without API keys. The finale version can add:
- semantic classifier via Ollama or a cloud model,
- MCP / REST / LangChain adapters,
- sandboxed shadow execution,
- live credential revocation,
- Polygon Amoy or an enterprise ledger for Merkle-root anchoring,
- user/team policy authoring.

## Why blockchain is used carefully

Raw security logs stay off-chain for privacy and speed. SENTRA batches event hashes into a Merkle tree and anchors only the root, providing tamper evidence without exposing sensitive data.
