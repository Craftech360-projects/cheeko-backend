# Phase 2 — Pending / Deferred (MQTT Gateway)

Phase 2 routing is committed. The gateway no longer maps character→agent locally;
it routes via the Manager-supplied `runtimeAgentName` (single `DEFAULT_RUNTIME_AGENT`
fallback = `cheeko-agent`, env-overridable via `LIVEKIT_DEFAULT_AGENT`). Tests: 11 pass.

## 1. set-character / cycle-character don't return `runtimeAgentName` — DEFERRED

The CHARACTER-CHANGE dispatch site (`gateway/mqtt-gateway.js`, `handleDeviceCharacterChange`)
calls Manager `POST /agent/device/:mac/set-character` (or `/cycle-character`). Those
responses carry `{ newModeName, success }` but **not** `runtimeAgentName`, so that path
currently routes to `DEFAULT_RUNTIME_AGENT`.

- **Why pending / safe today:** locked decision #3 — every character's
  `runtime_agent_name` is NULL until a specialized worker is deployed, so the resolver
  returns the default anyway. No specialized workers exist yet.
- **Impact when it matters:** once a character has a non-NULL `runtime_agent_name`,
  *explicitly switching to it via a card/voice command* would wrongly route to default
  (the no-card primary path and the MODE-CHANGE/START-AGENT paths already route
  correctly — they read the upgraded `current-character` endpoint).
- **To close:** extend Manager `setCharacterByName` + `cycleCharacter` (and their routes)
  to return the resolved contract (`runtimeAgentName`, `characterId`, `language`) via
  `resolveSessionForCharacter` — the same resolver Phase 1 added. The gateway site
  already destructures `runtimeAgentName`/`characterId`/`language` from
  `response.data.data`, so **no gateway change is needed** once Manager includes them.

## 2. Live dispatch-log verification — NOT RUN

Handoff P2 verification asks for dispatch logs showing `runtimeAgentName` from the
Manager on all paths (incl. virtual-connection + MODE-CHANGE), and a constant fallback
on Manager-down.

- **Why pending:** requires a running gateway + Manager + LiveKit; not exercisable here.
- **Covered instead:** unit tests assert the metadata contract (incl. `character_id`,
  `language`, no persona text), the `DEFAULT_RUNTIME_AGENT` value, and that the
  hardcoded `CHARACTER_AGENT_MAP` lookup is gone from both files. `node --check` clean.
- **To close:** run a device through Cheeko (no-card), a card tap, and a MODE-CHANGE;
  confirm dispatch logs show the Manager `runtimeAgentName`, and that killing the Manager
  falls back to `cheeko-agent`.
