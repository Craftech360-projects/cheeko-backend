# Phase 1 — Pending / Deferred

Multi-character Phase 1 (Manager API) is committed and unit-tested (271 pass).
Two items are intentionally deferred. Both are safe to leave: present behavior is
correct (every character resolves to `LIVEKIT_DEFAULT_AGENT=cheeko-agent1`).

## 1. Migration smoke test — NOT RUN

Migration `prisma/migrations/20260623000100_add_runtime_agent_and_soul/` adds
nullable `runtime_agent_name` + `soul` to `ai_agent` and `ai_agent_template`.

- **Why pending:** no DB access in the implementation session; never run
  `migrate deploy` against prod from there.
- **Status:** SQL is idempotent (`ADD COLUMN IF NOT EXISTS`), `prisma validate`
  passes, `prisma generate` succeeds.
- **To close:** run against a dev/staging DB and confirm no drift:
  ```bash
  npm run prisma:migrate        # prisma migrate dev (applies + checks drift)
  # or, on a deployed env:
  npm run prisma:deploy         # prisma migrate deploy
  ```
  Verify: both columns exist and all existing rows have `runtime_agent_name = NULL`.

## 2. RFID AI-card → proper per-character routing — DEFERRED

Today the AI-card path (`src/services/rfid.service.js`, `lookupCardByUid`) routes
**every** card to the default agent. Two reasons, both currently pointing to default:

1. The card's `action_data` carries only a character *name* string, not a
   `characterId` / `runtime_agent_name`. `lookupCardByUid(rfidUid)` has no
   `user_id`, and `agent_name` is not unique across users — so the `ai_agent` row
   can't be resolved safely at that layer. The resolver runs on
   `{ runtime_agent_name: actionData.runtime_agent_name || null }` → always default.
2. Locked decision #3: all `ai_agent.runtime_agent_name` are NULL until the same
   change that deploys a specialized worker → everything resolves to default anyway.

- **Why pending:** building name→row resolution now would route to specialized
  workers (math-tutor / riddle-solver / word-ladder) that **do not exist yet**,
  which decision #3 forbids.
- **To close (only once a specialized worker is deployed):** plumb the device's
  `user_id` into `lookupCardByUid` and resolve the row the same way
  `setCharacterByName` does (`src/services/agent.service.js:~1458`):
  ```js
  const agent = await prisma.ai_agent.findFirst({
    where: { user_id: device.user_id, agent_name: { equals: agentName, mode: 'insensitive' } },
    select: { id: true, agent_name: true, runtime_agent_name: true, system_prompt: true, soul: true, language: true },
  });
  // then: resolveSessionForCharacter(agent, { language })
  ```
  Note: the primary no-card path (`getCurrentCharacter`) already resolves from a
  real row, so it needs no change — it routes correctly the moment a character
  gets a non-NULL `runtime_agent_name`.
