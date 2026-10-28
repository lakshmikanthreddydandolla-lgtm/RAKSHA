# RAKSHA Final UX Specification

## Product north star
RAKSHA must feel like a premium spatial security operating system, not a generic AI dashboard. Normal operation is calm and usable. Security events become cinematic only when they matter.

## Global visual system
- Themes: `AURORA` and `ARCHIVE`.
- AURORA: ivory, beige, cream, champagne metal, graphite, restrained coffee accents, emerald ALLOW, amber REVIEW, refined crimson BLOCK.
- ARCHIVE: black, warm off-white, charcoal, silver, blackened metal, subtle grain/vignette. Same layout and UX, slightly different visual character for brain, plaques, cards, evidence, and policies.
- Global controls in every workflow: Home, Theme, Motion. Small circular controls, semi-transparent when idle, bright on hover/mouse movement.
- Motion modes: `LITE` default, `FULL` optional. LITE preserves every interaction while reducing particles, shadows, distortion, DPR and lighting cost. Switching mode never reloads or loses state.
- No sound anywhere.

## Welcome and activation
Cover is minimal and premium: RAKSHA, tagline, ACTIVATE. No brain or internal UI is visible before activation.
On ACTIVATE the cover disintegrates into particles. Those particles form the 3D AI brain and then the protective RAKSHA shell around it. A brief `RAKSHA ACTIVE` status appears, then shrinks away.

## AI core and shell
- Brain: engineered exterior plus living inner core.
- Embedded text inside volume identifies `DEMO`, `LOCAL`, or validated external provider/model.
- Idle: faint breathing pulse. No hover reaction.
- Thinking/responding: subtle stronger pulse only.
- Brain never rotates in Core Hub.
- Shell combines particle sphere, layered rings and transparent membrane.
- REVIEW: amber pulse. BLOCK: membrane tightens, rings align, particles pull inward. VERIFIED: rings briefly synchronize.

## Core Hub
After activation only the protected brain is visible.
Click brain to reveal five thin engineered metal plaques orbiting slowly around it: Command Center, Red-Team Lab, Human Governance, Evidence Center, Policies.
Manual drag rotates plaques only; brain remains fixed. Auto orbit pauses while dragging and resumes after idle. Second brain click retracts plaques.
Selecting a plaque: brief sharp anticipation, plaque locks, physically transforms into that workflow entrance, camera passes through.

## Command Center
Entrance reveals three provider choices: Demo Model, Local AI, Real AI.
Selecting one uses a black-hole/suction transition into the workspace.
Workspace:
- Left: collapsible VS Code-inspired operational sidebar for users, sessions, provider, activity, risk, containment.
- Center: small-medium AI brain with embedded provider identity.
- Right: normal chatbot conversation only. No rich response cards.

### Providers
- Demo Model: reliable deterministic judge-safe path.
- Local AI: Ollama `llama3.2`, 30-second timeout, real health check before CONNECTED, explicit fallback if unavailable.
- Real AI: future-scope path; validate provider/model before displaying identity.

### Users
Create users by human-readable name, never USER_1 numbering. Hidden unique IDs remain internal. Delete removes live user/session state and updates active user count immediately.

### Review
Human approval appears as focused popup with cause/context and ALLOW/DENY.
ALLOW: popup folds into a small archive box icon, then disappears.
DENY: popup collapses into fragments swallowed by a small bin icon, then disappears.
These metaphors connect to Human Governance.

### ALLOW and BLOCK
Normal ALLOW has no special animation.
Critical BLOCK: center workspace performs silent old-TV CRT shutdown into a horizontal line, blacks out, then shows BLOCKED. RESET SESSION reverses the CRT effect and restores same user. DELETE USER removes the live user.

### Disconnect
Disconnect animates a tiny brain slicing/shutting down inside the control; main brain becomes grey/lifeless; return to provider selection.

## Red-Team / Attack Lab
Entry transforms into a deck of cards falling from above, scattering, then arranging.
Real risk scores remain unchanged. Card rank expresses relative severity/importance: highest Joker, then King, Queen, Jack, numeric ranks.
Suits represent attack families:
- Spades: privilege/identity/permission abuse.
- Hearts: prompt injection/manipulation/poisoned instructions.
- Diamonds: secrets/credentials/exfiltration.
- Clubs: destructive/tool/database/terminal abuse.
- Joker: complex cross-category multi-step attacks.
Selecting a card brings it forward, plays a small metaphor animation based on character/suit, then unfolds a technical step timeline underneath. Back/X returns to deck; Home returns Core Hub.

## Human Governance
Simple horizontal architectural tree.
Two nodes: Box (accepted) and Bin (denied). Clicking one extends only the screen region from that node onward into the corresponding log. Opening the other retracts the first. Back/X collapses current branch. Home returns Core Hub.

## Evidence Center
Hybrid physical forensic vault + futuristic floating horizontal evidence timeline.
Each security event is an evidence capsule. Click capsule and it expands in place while chain remains visible. Shows human-readable record with optional technical hash details.
VERIFY sends a pulse through the chain. Intact chain ends in EVIDENCE VERIFIED. SIMULATE TAMPER visibly fractures one capsule; verification pulse breaks there and shows TAMPERING DETECTED.

## Policies
Calmest, least cinematic workflow.
Five control areas: Allow Threshold, Review Threshold, Block Threshold, Trusted Users, Trusted Tools.
Threshold configuration uses small expressive emoji feedback for healthy/borderline/invalid policy setup.
Trusted users/tools appear as compact tokens. Adding trust triggers a brief refined knighting metaphor: RAKSHA marker taps left shoulder then right shoulder, then TRUST GRANTED. Tokens can be inspected or revoked. Trust is scoped and never bypasses hard security rules.

## Loading and notifications
Loading is minimal branded core + rotating rings with truthful status text such as INITIALIZING RAKSHA, CHECKING LOCAL MODEL, LOADING LLAMA 3.2. No fake percentages.
Avoid generic toast stacks. Prefer object/state feedback. Small temporary status capsules are allowed for concise confirmations/errors.

## Navigation
Home is global and always returns Core Hub.
Back is contextual and moves one level up inside current workflow.
X closes only the local expanded state.
Theme and Motion changes preserve current workflow and state.
