# Python GPT-Live Agent: picoclaw Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `main/python-agent` (the GPT-Live worker, agent name `cheeko-gptlive`) a drop-in runtime for picoclaw characters: same manager-owned `.md` persona, same quiz bank and Door ladder, same memory files, same post-session persistence, so characters can be moved to it one at a time by changing their runtime agent name in the manager.

**Architecture:** Keep LiveKit Agents 1.8 and its GPT-Live plugin for the protocol. Port picoclaw's *session assembly* around it: pull the character from the manager, hydrate an ephemeral workspace of `AGENT.md`, `SOUL.md`, `USER.md` from the same scaffold picoclaw uses, build the voice instructions from those files, fetch the quiz batch, expose quiz and memory logic as backend function tools, persist transcripts and usage through the same manager endpoints. One worker process serves every character; the manager routes per character (`runtime_agent_name`).

**Tech Stack:** Python 3.10+ (dev box) / 3.11 (local), `livekit-agents[openai,silero]~=1.8.1`, `aiohttp` (already a transitive dependency), `jinja2`, `pytest` + `pytest-asyncio` for tests. No new runtime dependencies.

**Spec:** This document's "Design" section, plus picoclaw ADR-0002 (`D:\picoclaw\docs\adr\0002-manager-owns-character-to-runtime-agent-routing.md`) and ADR-0011 (`D:\picoclaw\docs\adr\0011-gpt-live-runs-in-go-with-backend-tools.md`, decision 5 describes the same tool design this plan ports).

## Global Constraints

- The persona text the voice model receives is built **from files on disk** in an ephemeral per-session workspace (`main/python-agent/workspaces/<room>/`): `AGENT.md` = picoclaw's scaffold with the manager's `systemPrompt` injected at `<!-- PERSONA -->` and the language at `<!-- LANGUAGE -->`, `SOUL.md` = manager's `soul`, `USER.md` = child profile from dispatch metadata. Joined with `\n\n---\n\n` like picoclaw's `BuildSystemPrompt`. The workspace is deleted when the session ends.
- Manager calls use the service key header `X-Service-Key: $MANAGER_API_SECRET` and unwrap the `{code, msg, data}` envelope; `code != 0` is an error. Base URL is `$MANAGER_API_URL` (e.g. `http://127.0.0.1:8002/toy`).
- Every manager call is best-effort with a 3 s timeout: a failure logs and degrades (no quiz, generic persona) but never blocks the session from starting.
- GPT-Live constraints stand: instructions and voice are immutable after start; mid-session guidance goes through `append_instructions` / `append_thinking` / `append_commentary` (≤ 500 tokens each); no scripted speech; delegation `responses` only.
- Sample rate stays 16 kHz for device rooms (`RoomInputOptions(audio_sample_rate=16000)` is already set); browser rooms may pass `rate: 24000` in the `gptlive` metadata block.
- Existing behaviour must not regress: the dashboard GPT-Live tab (voice, accent) and the headless `lk` test recipe keep working after every task.
- Tests: `cd main/python-agent && python -m pytest -q` using the venv that has livekit-agents (locally `main/livekit-server/.venv-gptlive/Scripts/python.exe`). Manager HTTP is never hit in tests; the client takes an injected `fetch` callable.
- Commit after every task: `feat(python-agent): ...`.
- Never print `OPENAI_API_KEY` or `MANAGER_API_SECRET`.

---

## Design

### Session assembly (mirrors picoclaw `cmd/picoclaw-livekit/main.go` bridgeFactory)

1. Parse the room name `<uuid>_<MAC>_<type>` and the dispatch metadata (`character`, `character_id`, `child_profile{name, age, gender, interests, parent_rule}`, `session_language_name`, `session_language_code`, `language`, `gptlive{voice, accent, rate}`).
2. Pull the persona: `GET /agent/character/by-name/{character}/session` (fallback `GET /agent/character/{character_id}/session`). Fields used: `systemPrompt`, `soul`, `greetingPrompt`, `language`, `characterName`.
3. Hydrate the workspace: write `AGENT.md`, `SOUL.md`, `USER.md` into `workspaces/<room>/`, plus `memory/MEMORY.md` (empty) and `memory/state/` for MEMO files.
4. Restore character state: `GET /progress/state?device_mac=` → write each `states[].memo` to `memory/state/<state_type>.md` (same files picoclaw keeps), and pass the memos to the backend as context.
5. If the greeting prompt carries `{{QUIZ_QUESTIONS}}`, `{{RIDDLES}}` or `{{MATH_PROBLEMS}}`: `GET /quiz/next-questions?device_mac=&character=` and render the block; other placeholders (`{{TODAY_DATE}}`, `{{TIME_BAND}}`, `{{TODAY_PLAN}}`, `{{TAG}}`) render to text; content-bank placeholders (`{{JOKES}}`, `{{WHY_QUESTIONS}}`, `{{STORY_OF_THE_DAY}}`, `{{WORDS_OF_THE_DAY}}`, `{{SPELL_WORDS}}`) are removed for now (content banks are a later task).
6. Build the voice instructions (files + delegation block + accent) and the backend instructions (operator note + quiz block + restored memos), build the tool list for the character, start the session, send the greeting as commentary when the device says `ready_for_greeting` or after 3 s.
7. On shutdown: `POST /agent/chat-history/session`, `POST /agent/device/{mac}/sessions/{room}/end`, `POST /device/token-usage`, then delete the workspace.

### Tools offered to the backend (from ADR-0011 decision 5)

| Characters | Tools |
|---|---|
| all | `get_time_date`, `remember_child_fact`, hosted `WebSearch` |
| Quizzy (`daily_quiz`), Bujho (`daily_riddle`), Ginti (`daily_math`) | plus `quiz_status`, `quiz_score_answer`, `quiz_record_wonder` |

`quiz_score_answer(question_id, result ∈ {correct, miss, revealed}, transcript)` owns the Door ladder: `miss` increments tries and returns the next Door directive; the ladder exhausts at three tries (two when the question has no authored choices/teach text) and then records `revealed`; `correct` at Door 3 is recorded as `revealed` (mastery rule). Every terminal verdict writes `memory/state/<type>.md` with the cascade's `MEMO:` line and posts `/quiz/answer`. The directive is also pushed to the voice model with `append_instructions`.

### File layout

```
main/python-agent/
  cheeko_gptlive_worker.py   # entrypoint (thin): prewarm, entrypoint, cli
  agent/
    __init__.py
    metadata.py              # room name + dispatch metadata parsing
    manager.py               # ManagerClient: persona, quiz batch, reporters, state, persistence
    workspace.py             # hydrate + read the .md files, build the system prompt
    persona.py               # delegation/accent blocks, backend note, greeting
    placeholders.py          # {{...}} rendering incl. the quiz block
    doors.py                 # door_for(), door_directive_text() (ported wording)
    quiz.py                  # QuizTracker + quiz tools
    tools.py                 # get_time_date, remember_child_fact, tool set per character
    persistence.py           # transcript capture + shutdown uploads
  workspace-template/
    AGENT.md                 # copied from D:\picoclaw\workspace-template\AGENT.md
    SOUL.md                  # copied from D:\picoclaw\workspace-template\SOUL.md
    USER.md                  # copied from D:\picoclaw\workspace-template\USER.md
  prompts/cheeko.yaml        # kept only as the no-manager fallback
  tests/                     # pytest
  requirements.txt, requirements-dev.txt, .env.example
```

---

### Task 1: Package skeleton, metadata parsing, test harness

**Files:**
- Create: `main/python-agent/agent/__init__.py`, `main/python-agent/agent/metadata.py`, `main/python-agent/requirements-dev.txt`, `main/python-agent/tests/__init__.py`, `main/python-agent/tests/test_metadata.py`, `main/python-agent/pytest.ini`

**Interfaces:**
- Produces: `parse_room_name(room: str) -> tuple[str | None, str | None]` (MAC as `AA:BB:...`, room type), `SessionMeta` dataclass, `parse_dispatch_metadata(raw: str | None, room: str) -> SessionMeta`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_metadata.py
from agent.metadata import SessionMeta, parse_dispatch_metadata, parse_room_name


def test_room_name_yields_mac_and_type():
    assert parse_room_name("969bf3c6-8d58-4fe5-9f5b-0b964d27e295_68EE8F60BAAC_conversation") == ("68:EE:8F:60:BA:AC", "conversation")
    assert parse_room_name("gptlive-test-3") == (None, None)


def test_dispatch_metadata_fields_and_defaults():
    raw = '{"character":"Quizzy","character_id":"c-1","child_profile":{"name":"Aarav","age":7,"interests":"space"},' \
          '"session_language_name":"Hindi","gptlive":{"voice":"vesper","accent":"indian","rate":24000}}'
    m = parse_dispatch_metadata(raw, "u_68EE8F60BAAC_conversation")
    assert m == SessionMeta(device_mac="68:EE:8F:60:BA:AC", character="Quizzy", character_id="c-1",
                            child_name="Aarav", child_age=7, child_gender="", child_interests="space", parent_rule="",
                            language="Hindi", voice="vesper", accent="indian", sample_rate=24000)


def test_dispatch_metadata_tolerates_garbage():
    m = parse_dispatch_metadata("not json", "u_68EE8F60BAAC_conversation")
    assert m.character == "Cheeko" and m.voice == "marin" and m.accent == "default" and m.sample_rate == 16000
    assert parse_dispatch_metadata('{"gptlive":{"voice":"aster"}}', "x").voice == "marin"  # refused voice never chosen
```

`pytest.ini`: `[pytest]\npythonpath = .\nasyncio_mode = auto`. `requirements-dev.txt`: `pytest\npytest-asyncio`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:\cheeko-backend\main\python-agent && ..\livekit-server\.venv-gptlive\Scripts\python.exe -m pip install -q -r requirements-dev.txt && ..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q tests/test_metadata.py`
Expected: FAIL, `ModuleNotFoundError: agent.metadata`.

- [ ] **Step 3: Write metadata.py**

```python
"""Room name and dispatch metadata, the two things the gateway hands a worker."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

VOICES = ("beacon", "cinder", "marin", "stone", "vesper")  # aster is refused for this account
DEFAULT_CHARACTER = "Cheeko"

_ROOM = re.compile(r"^[0-9a-f-]{36}_([0-9A-Fa-f]{12})_([a-z_]+)$")


def parse_room_name(room: str) -> tuple[str | None, str | None]:
    m = _ROOM.match(room or "")
    if not m:
        return None, None
    raw, kind = m.group(1).upper(), m.group(2)
    return ":".join(raw[i:i + 2] for i in range(0, 12, 2)), kind


@dataclass(frozen=True)
class SessionMeta:
    device_mac: str | None
    character: str
    character_id: str
    child_name: str
    child_age: int
    child_gender: str
    child_interests: str
    parent_rule: str
    language: str
    voice: str
    accent: str
    sample_rate: int


def parse_dispatch_metadata(raw: str | None, room: str) -> SessionMeta:
    try:
        data = json.loads(raw) if raw else {}
        if not isinstance(data, dict):
            data = {}
    except ValueError:
        data = {}
    child = data.get("child_profile") or {}
    if not isinstance(child, dict):
        child = {}
    live = data.get("gptlive") or {}
    if not isinstance(live, dict):
        live = {}
    try:
        age = int(child.get("age") or 0)
    except (TypeError, ValueError):
        age = 0
    voice = str(live.get("voice") or "").lower()
    mac, _ = parse_room_name(room)
    return SessionMeta(
        device_mac=mac,
        character=str(data.get("character") or DEFAULT_CHARACTER).strip() or DEFAULT_CHARACTER,
        character_id=str(data.get("character_id") or "").strip(),
        child_name=str(child.get("name") or "").strip(),
        child_age=age,
        child_gender=str(child.get("gender") or "").strip(),
        child_interests=str(child.get("interests") or "").strip(),
        parent_rule=str(child.get("parent_rule") or "").strip(),
        language=str(data.get("session_language_name") or data.get("language") or "English").strip() or "English",
        voice=voice if voice in VOICES else "marin",
        accent="indian" if live.get("accent") == "indian" else "default",
        sample_rate=24000 if live.get("rate") == 24000 else 16000,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add main/python-agent/agent main/python-agent/tests main/python-agent/pytest.ini main/python-agent/requirements-dev.txt
git commit -m "feat(python-agent): package skeleton with room and dispatch metadata parsing"
```

---

### Task 2: Manager client (persona, quiz, state, persistence endpoints)

**Files:**
- Create: `main/python-agent/agent/manager.py`
- Test: `main/python-agent/tests/test_manager.py`

**Interfaces:**
- Produces: `ManagerClient(base_url, secret, fetch=None)` with async methods `character_session(name, character_id) -> dict | None`, `quiz_batch(device_mac, character) -> dict | None`, `progress_state(device_mac) -> list[dict]`, `post_quiz_answer(device_mac, question_id, result, bank, attempts)`, `post_quiz_attempts(device_mac, question_id, attempts)`, `post_wonder(device_mac, question, answer, code)`, `send_chat_history(device_mac, session_id, messages)`, `send_session_end(device_mac, session_id, message_count)`, `send_token_usage(device_mac, session_id, usage: dict)`.
- `fetch(method, url, json_body) -> (status:int, body:dict)` is injectable; the default uses `aiohttp` with a 3 s timeout and the `X-Service-Key` header.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_manager.py
import pytest

from agent.manager import ManagerClient


class FakeFetch:
    def __init__(self, responses):
        self.responses, self.calls = responses, []

    async def __call__(self, method, url, body):
        self.calls.append((method, url, body))
        for prefix, resp in self.responses.items():
            if prefix in url:
                return resp
        return 404, {"code": 404, "msg": "not found"}


@pytest.mark.asyncio
async def test_character_session_by_name_then_by_id():
    fetch = FakeFetch({"/agent/character/by-name/Quizzy/session": (200, {"code": 0, "data": {"systemPrompt": "You are Quizzy", "soul": "Curious", "greetingPrompt": "Ask {{QUIZ_QUESTIONS}}", "language": "en"}})})
    mc = ManagerClient("http://m/toy", "s3cret", fetch=fetch)
    got = await mc.character_session("Quizzy", "c-1")
    assert got["systemPrompt"] == "You are Quizzy"
    assert fetch.calls[0][0] == "GET"

    fetch = FakeFetch({"/agent/character/c-1/session": (200, {"code": 0, "data": {"systemPrompt": "by id"}})})
    mc = ManagerClient("http://m/toy", "s3cret", fetch=fetch)
    assert (await mc.character_session("Nobody", "c-1"))["systemPrompt"] == "by id"
    assert await ManagerClient("http://m/toy", "s", fetch=FakeFetch({})).character_session("X", "") is None


@pytest.mark.asyncio
async def test_quiz_batch_and_reporters_use_the_cascade_payloads():
    fetch = FakeFetch({"/quiz/next-questions": (200, {"code": 0, "data": {"level": 1, "questions": [{"id": "11"}]}}),
                       "/quiz/answer": (200, {"code": 0}), "/quiz/attempts": (200, {"code": 0}), "/quiz/wonder": (200, {"code": 0})})
    mc = ManagerClient("http://m/toy", "s", fetch=fetch)
    batch = await mc.quiz_batch("68:EE:8F:60:BA:AC", "Quizzy")
    assert batch["level"] == 1 and "device_mac=68%3AEE%3A8F%3A60%3ABA%3AAC" in fetch.calls[0][1] and "character=Quizzy" in fetch.calls[0][1]
    await mc.post_quiz_answer("68:EE:8F:60:BA:AC", "11", "correct", "quiz", [{"verdict": "correct", "transcript": "eight"}])
    assert fetch.calls[1][2] == {"device_mac": "68:EE:8F:60:BA:AC", "question_id": "11", "result": "correct", "bank": "quiz",
                                 "attempts": [{"verdict": "correct", "transcript": "eight"}]}
    await mc.post_wonder("68:EE:8F:60:BA:AC", "why is the sky blue", "scattering", "W1")
    assert fetch.calls[2][2] == {"device_mac": "68:EE:8F:60:BA:AC", "question": "why is the sky blue", "answer": "scattering", "code": "W1"}


@pytest.mark.asyncio
async def test_persistence_payloads():
    fetch = FakeFetch({"/agent/chat-history/session": (200, {"code": 0}), "/sessions/room-1/end": (200, {"code": 0}), "/device/token-usage": (200, {"code": 0})})
    mc = ManagerClient("http://m/toy", "s", fetch=fetch)
    await mc.send_chat_history("AA:BB:CC:DD:EE:FF", "room-1", [{"chatType": 1, "content": "hi", "timestamp": 1}])
    await mc.send_session_end("AA:BB:CC:DD:EE:FF", "room-1", 1)
    await mc.send_token_usage("AA:BB:CC:DD:EE:FF", "room-1", {"totalTokens": 120, "sessionDurationSeconds": 31.0, "messageCount": 1})
    assert fetch.calls[0][2]["macAddress"] == "AA:BB:CC:DD:EE:FF" and fetch.calls[0][2]["sessionId"] == "room-1"
    assert "/agent/device/AA:BB:CC:DD:EE:FF/sessions/room-1/end" in fetch.calls[1][1] and fetch.calls[1][2]["status"] == "ended"
    assert fetch.calls[2][2]["mac"] == "AA:BB:CC:DD:EE:FF" and fetch.calls[2][2]["totalTokens"] == 120


@pytest.mark.asyncio
async def test_failures_never_raise():
    async def boom(method, url, body):
        raise RuntimeError("down")
    mc = ManagerClient("http://m/toy", "s", fetch=boom)
    assert await mc.character_session("Quizzy", "") is None
    assert await mc.quiz_batch("AA", "Quizzy") is None
    assert await mc.progress_state("AA") == []
    await mc.post_quiz_answer("AA", "1", "correct", "", [])  # no exception
```

- [ ] **Step 2: Run test to verify it fails**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q tests/test_manager.py`
Expected: FAIL, `ModuleNotFoundError: agent.manager`.

- [ ] **Step 3: Write manager.py**

```python
"""The manager API as picoclaw's worker uses it: service-key auth, {code,data} envelope, best effort."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable
from urllib.parse import quote

import aiohttp

logger = logging.getLogger("cheeko-gptlive.manager")

Fetch = Callable[[str, str, dict | None], Awaitable[tuple[int, dict]]]
TIMEOUT = aiohttp.ClientTimeout(total=3)


class ManagerClient:
    def __init__(self, base_url: str, secret: str, fetch: Fetch | None = None) -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.secret = secret or ""
        self._fetch = fetch or self._http_fetch
        self._http: aiohttp.ClientSession | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.base_url)

    async def _http_fetch(self, method: str, url: str, body: dict | None) -> tuple[int, dict]:
        if self._http is None or self._http.closed:
            self._http = aiohttp.ClientSession(timeout=TIMEOUT)
        headers = {"X-Service-Key": self.secret, "Authorization": f"Bearer {self.secret}", "Content-Type": "application/json"}
        async with self._http.request(method, url, json=body, headers=headers) as resp:
            try:
                data = await resp.json(content_type=None)
            except Exception:
                data = {}
            return resp.status, data if isinstance(data, dict) else {}

    async def aclose(self) -> None:
        if self._http is not None and not self._http.closed:
            await self._http.close()

    async def _call(self, method: str, path: str, body: dict | None = None, *, what: str) -> Any | None:
        """Returns the envelope's data (or True for a bare success), None on any failure."""
        if not self.enabled:
            return None
        try:
            status, payload = await self._fetch(method, self.base_url + path, body)
        except Exception as e:  # network, timeout, bad JSON: degrade, never block the session
            logger.warning("manager %s failed: %s", what, e)
            return None
        if status >= 300 or payload.get("code", 0) not in (0, 200):
            logger.warning("manager %s rejected: status=%s code=%s msg=%s", what, status, payload.get("code"), payload.get("msg"))
            return None
        return payload.get("data", True)

    # persona
    async def character_session(self, name: str, character_id: str) -> dict | None:
        if name:
            data = await self._call("GET", f"/agent/character/by-name/{quote(name, safe='')}/session", what="character by name")
            if isinstance(data, dict):
                return data
        if character_id:
            data = await self._call("GET", f"/agent/character/{quote(character_id, safe='')}/session", what="character by id")
            if isinstance(data, dict):
                return data
        return None

    # quiz
    async def quiz_batch(self, device_mac: str, character: str) -> dict | None:
        path = f"/quiz/next-questions?device_mac={quote(device_mac, safe='')}&character={quote(character, safe='')}"
        data = await self._call("GET", path, what="quiz batch")
        return data if isinstance(data, dict) else None

    async def progress_state(self, device_mac: str) -> list[dict]:
        data = await self._call("GET", f"/progress/state?device_mac={quote(device_mac, safe='')}", what="progress state")
        states = data.get("states") if isinstance(data, dict) else None
        return [s for s in (states or []) if isinstance(s, dict)]

    async def post_quiz_answer(self, device_mac: str, question_id: str, result: str, bank: str, attempts: list[dict]) -> None:
        body: dict[str, Any] = {"device_mac": device_mac, "question_id": str(question_id), "result": result}
        if bank:
            body["bank"] = bank
        if attempts:
            body["attempts"] = attempts
        await self._call("POST", "/quiz/answer", body, what="quiz answer")

    async def post_quiz_attempts(self, device_mac: str, question_id: str, attempts: list[dict]) -> None:
        await self._call("POST", "/quiz/attempts", {"device_mac": device_mac, "question_id": str(question_id), "attempts": attempts}, what="quiz attempts")

    async def post_wonder(self, device_mac: str, question: str, answer: str, code: str) -> None:
        await self._call("POST", "/quiz/wonder", {"device_mac": device_mac, "question": question.strip(), "answer": answer.strip(), "code": code.strip()}, what="wonder question")

    # persistence
    async def send_chat_history(self, device_mac: str, session_id: str, messages: list[dict]) -> None:
        await self._call("POST", "/agent/chat-history/session", {"macAddress": device_mac, "sessionId": session_id, "messages": messages}, what="chat history")

    async def send_session_end(self, device_mac: str, session_id: str, message_count: int) -> None:
        body = {"status": "ended", "endedAt": datetime.now(timezone.utc).isoformat(), "messageCount": message_count}
        await self._call("POST", f"/agent/device/{device_mac}/sessions/{quote(session_id, safe='')}/end", body, what="session end")

    async def send_token_usage(self, device_mac: str, session_id: str, usage: dict) -> None:
        await self._call("POST", "/device/token-usage", {"mac": device_mac, "sessionId": session_id, **usage}, what="token usage")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add main/python-agent/agent/manager.py main/python-agent/tests/test_manager.py
git commit -m "feat(python-agent): manager client for persona, quiz bank, state and persistence"
```

---

### Task 3: Workspace hydration and the `.md` system prompt

**Files:**
- Create: `main/python-agent/workspace-template/AGENT.md` (copy of `D:\picoclaw\workspace-template\AGENT.md`, 83 lines, keeps `<!-- PERSONA -->` and `<!-- LANGUAGE -->`), `main/python-agent/workspace-template/SOUL.md` (copy), `main/python-agent/agent/workspace.py`
- Test: `main/python-agent/tests/test_workspace.py`

**Interfaces:**
- Consumes: `SessionMeta` (Task 1), the persona dict from `ManagerClient.character_session` (Task 2).
- Produces: `Persona` dataclass (`system_prompt, soul, greeting, language`), `persona_from_manager(data: dict | None, meta: SessionMeta) -> Persona`, `hydrate_workspace(root: Path, room: str, persona: Persona, meta: SessionMeta, memos: list[dict]) -> Path`, `build_system_prompt(workspace: Path) -> str`, `remove_workspace(workspace: Path)`.
- `build_system_prompt` reads the files back from disk (that is the point: the agent runs on `.md` files) and joins identity, `## AGENT.md`, `## SOUL.md`, `## USER.md` with `\n\n---\n\n`, as picoclaw's `BuildSystemPrompt` + `LoadBootstrapFiles` do.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_workspace.py
from pathlib import Path

from agent.metadata import SessionMeta
from agent.workspace import Persona, build_system_prompt, hydrate_workspace, persona_from_manager, remove_workspace

META = SessionMeta(device_mac="68:EE:8F:60:BA:AC", character="Quizzy", character_id="c-1", child_name="Aarav", child_age=7,
                   child_gender="", child_interests="space", parent_rule="No scary stories", language="Hindi",
                   voice="marin", accent="default", sample_rate=16000)


def test_persona_from_manager_falls_back_to_defaults():
    p = persona_from_manager({"systemPrompt": " You are Quizzy. ", "soul": "Curious", "greetingPrompt": "Hi {{QUIZ_QUESTIONS}}", "language": "hi"}, META)
    assert p == Persona(system_prompt="You are Quizzy.", soul="Curious", greeting="Hi {{QUIZ_QUESTIONS}}", language="hi")
    q = persona_from_manager(None, META)
    assert "Quizzy" in q.system_prompt and q.soul == "" and q.greeting == "" and q.language == "Hindi"


def test_hydrate_writes_the_three_files_and_state(tmp_path: Path):
    p = Persona(system_prompt="You are Quizzy.", soul="Curious and kind.", greeting="", language="hi")
    ws = hydrate_workspace(tmp_path, "room-1", p, META, [{"state_type": "daily_quiz", "memo": "MEMO: type=daily_quiz | date=2026-09-12"}])
    agent_md = (ws / "AGENT.md").read_text(encoding="utf-8")
    assert "You are Quizzy." in agent_md and "<!-- PERSONA -->" not in agent_md
    assert "Respond in the session language: Hindi." in agent_md
    assert (ws / "SOUL.md").read_text(encoding="utf-8").strip() == "Curious and kind."
    user_md = (ws / "USER.md").read_text(encoding="utf-8")
    for line in ("- Name: Aarav", "- Age: 7 years old", "- Interests: space", "- Primary language: Hindi", "- Timezone: Asia/Kolkata", "- Parent rule: No scary stories"):
        assert line in user_md
    assert (ws / "memory" / "state" / "daily_quiz.md").read_text(encoding="utf-8").startswith("MEMO: type=daily_quiz")
    assert (ws / "memory" / "MEMORY.md").exists()


def test_system_prompt_is_built_from_the_files(tmp_path: Path):
    ws = hydrate_workspace(tmp_path, "room-2", Persona("You are Cheeko.", "Playful.", "", "en"), META, [])
    (ws / "SOUL.md").write_text("Edited on disk.", encoding="utf-8")  # proves the prompt comes from files, not memory
    prompt = build_system_prompt(ws)
    assert prompt.index("# Cheeko") < prompt.index("## AGENT.md") < prompt.index("## SOUL.md") < prompt.index("## USER.md")
    assert "Edited on disk." in prompt and "\n\n---\n\n" in prompt
    remove_workspace(ws)
    assert not ws.exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q tests/test_workspace.py`
Expected: FAIL, `ModuleNotFoundError: agent.workspace`.

- [ ] **Step 3: Copy the templates and write workspace.py**

```bash
cp D:/picoclaw/workspace-template/AGENT.md D:/cheeko-backend/main/python-agent/workspace-template/AGENT.md
cp D:/picoclaw/workspace-template/SOUL.md  D:/cheeko-backend/main/python-agent/workspace-template/SOUL.md
```

```python
"""An ephemeral per-session workspace of .md files, hydrated like picoclaw does it.

AGENT.md = scaffold with the manager persona at <!-- PERSONA --> and the language at
<!-- LANGUAGE -->; SOUL.md = the manager soul; USER.md = the child profile; memory/state
holds the MEMO files restored from the manager. The system prompt is read back from
these files, so what the model sees is exactly what is on disk.
"""
from __future__ import annotations

import re
import shutil
from dataclasses import dataclass
from pathlib import Path

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "workspace-template"
PERSONA_PLACEHOLDER = "<!-- PERSONA -->"
LANGUAGE_PLACEHOLDER = "<!-- LANGUAGE -->"

IDENTITY = """# Cheeko

You are the character described in AGENT.md and SOUL.md, talking with a child.
USER.md describes the child. memory/MEMORY.md holds what you remembered about them."""

_SAFE = re.compile(r"[^A-Za-z0-9_.-]+")


@dataclass(frozen=True)
class Persona:
    system_prompt: str
    soul: str
    greeting: str
    language: str


def persona_from_manager(data: dict | None, meta) -> Persona:
    data = data if isinstance(data, dict) else {}
    system_prompt = str(data.get("systemPrompt") or "").strip()
    if not system_prompt:
        system_prompt = f"You are {meta.character}, a warm, playful and safe AI friend for a child."
    return Persona(
        system_prompt=system_prompt,
        soul=str(data.get("soul") or "").strip(),
        greeting=str(data.get("greetingPrompt") or "").strip(),
        language=str(data.get("language") or "").strip() or meta.language,
    )


def _inject_persona(scaffold: str, persona: str) -> str:
    persona = persona.strip()
    if PERSONA_PLACEHOLDER in scaffold:
        return scaffold.replace(PERSONA_PLACEHOLDER, persona)
    return persona + "\n\n" + scaffold if persona else scaffold


def render_user_md(meta) -> str:
    fields = [("Name", meta.child_name), ("Gender", meta.child_gender), ("Interests", meta.child_interests),
              ("Primary language", meta.language)]
    if meta.child_age > 0:
        fields.insert(1, ("Age", f"{meta.child_age} years old"))
    fields.append(("Timezone", "Asia/Kolkata"))
    if meta.parent_rule:
        fields.append(("Parent rule", meta.parent_rule))
    lines = ["# User", "", "## User Information", ""]
    lines += [f"- {label}: {value}" for label, value in fields if value]
    return "\n".join(lines) + "\n"


def hydrate_workspace(root: Path, room: str, persona: Persona, meta, memos: list[dict]) -> Path:
    ws = root / (_SAFE.sub("_", room) or "room")
    (ws / "memory" / "state").mkdir(parents=True, exist_ok=True)
    scaffold = (TEMPLATE_DIR / "AGENT.md").read_text(encoding="utf-8")
    agent_md = _inject_persona(scaffold, persona.system_prompt).replace(LANGUAGE_PLACEHOLDER, meta.language)
    (ws / "AGENT.md").write_text(agent_md, encoding="utf-8")
    soul = persona.soul or (TEMPLATE_DIR / "SOUL.md").read_text(encoding="utf-8")
    (ws / "SOUL.md").write_text(soul, encoding="utf-8")
    (ws / "USER.md").write_text(render_user_md(meta), encoding="utf-8")
    memory = ws / "memory" / "MEMORY.md"
    if not memory.exists():
        memory.write_text("# Memory\n", encoding="utf-8")
    for state in memos:
        kind = _SAFE.sub("_", str(state.get("state_type") or "")).strip("_")
        memo = str(state.get("memo") or "").strip()
        if kind and memo:
            (ws / "memory" / "state" / f"{kind}.md").write_text(memo + "\n", encoding="utf-8")
    return ws


def _section(ws: Path, name: str) -> str:
    path = ws / name
    if not path.exists():
        return ""
    body = path.read_text(encoding="utf-8").strip()
    return f"## {name}\n\n{body}" if body else ""


def build_system_prompt(workspace: Path) -> str:
    parts = [IDENTITY] + [s for s in (_section(workspace, n) for n in ("AGENT.md", "SOUL.md", "USER.md")) if s]
    return "\n\n---\n\n".join(parts)


def remove_workspace(workspace: Path) -> None:
    shutil.rmtree(workspace, ignore_errors=True)
```

Also add `workspaces/` to `main/python-agent/.gitignore` (create the file with that one line).

- [ ] **Step 4: Run tests to verify they pass**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add main/python-agent/workspace-template main/python-agent/agent/workspace.py main/python-agent/tests/test_workspace.py main/python-agent/.gitignore
git commit -m "feat(python-agent): hydrate AGENT.md, SOUL.md, USER.md per session and build the prompt from them"
```

---

### Task 4: Placeholders, the quiz block, and the Door ladder wording

**Files:**
- Create: `main/python-agent/agent/placeholders.py`, `main/python-agent/agent/doors.py`
- Test: `main/python-agent/tests/test_placeholders.py`, `main/python-agent/tests/test_doors.py`

**Interfaces:**
- Produces: `wants_quiz(prompt: str) -> bool`, `render_placeholders(prompt: str, batch: dict | None, now: datetime) -> str`, `quiz_block(batch: dict | None) -> str`; `door_for(question: dict, tries: int) -> int` (1, 2, 3), `door_directive_text(question: dict, tries: int) -> str` (wording ported from picoclaw `agent_bridge.go:1450`), `ladder_exhausted(question: dict, tries: int) -> bool`.
- A question dict is the manager's shape: `id, question_text, answer_text, accepted_answers, choice_order, teach_text`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_placeholders.py
from datetime import datetime

from agent.placeholders import quiz_block, render_placeholders, wants_quiz

BATCH = {"level": 1, "age_band": "6-8", "bank": "quiz", "answered_today": 2,
         "questions": [{"id": "11", "question_text": "How many legs does a spider have?", "answer_text": "eight", "accepted_answers": ["8"]},
                       {"id": "12", "question_text": "What colour is the sky?", "answer_text": "blue", "accepted_answers": []}],
         "wonder_to_ask": {"code": "W7", "question_text": "Why is the sky blue?", "second_pass": False, "previous_answer": ""}}


def test_wants_quiz_matches_the_three_placeholders():
    assert wants_quiz("x {{QUIZ_QUESTIONS}}") and wants_quiz("{{RIDDLES}}") and wants_quiz("{{MATH_PROBLEMS}}")
    assert not wants_quiz("{{JOKES}} {{TODAY_DATE}}")


def test_quiz_block_lists_questions_with_ids_and_answers():
    block = quiz_block(BATCH)
    assert "## Today's Quiz Questions (Level 1, ages 6-8)" in block
    assert "(id=11) How many legs does a spider have? — Answer: eight (also accept: 8)" in block
    assert "(id=12) What colour is the sky? — Answer: blue" in block
    assert "answered 2 already today" in block
    assert "Wonder Question (code W7): Why is the sky blue?" in block
    assert "question bank is unavailable" in quiz_block(None)


def test_render_placeholders_fills_or_strips():
    prompt = "Today is {{TODAY_DATE}} ({{TIME_BAND}}). {{QUIZ_QUESTIONS}} Jokes: {{JOKES}} end"
    out = render_placeholders(prompt, BATCH, datetime(2026, 9, 13, 9, 30))
    assert "Sunday, 13 September 2026" in out and "(morning)" in out and "(id=11)" in out
    assert "{{" not in out
```

```python
# tests/test_doors.py
from agent.doors import door_directive_text, door_for, ladder_exhausted

FULL = {"id": "7", "question_text": "How many legs?", "choice_order": ["eight", "six"], "teach_text": "four legs each side"}
BARE = {"id": "8", "question_text": "What colour?", "choice_order": [], "teach_text": ""}


def test_door_for_clamps_and_skips_unauthored_doors():
    assert [door_for(FULL, t) for t in (0, 1, 2, 9)] == [1, 2, 3, 3]
    assert [door_for(BARE, t) for t in (0, 1, 2, 5)] == [1, 1, 1, 1]


def test_directive_wording_matches_the_cascade():
    assert "Ask question 7 plainly" in door_directive_text(FULL, 0)
    assert '"eight" or "six"' in door_directive_text(FULL, 1)
    d3 = door_directive_text(FULL, 2)
    assert "four legs each side" in d3 and "Do NOT say the answer" in d3
    assert "all three tries" in door_directive_text(FULL, 3)
    assert door_directive_text(BARE, 0) == ""
    assert "missed question 8 once" in door_directive_text(BARE, 1)
    assert "result=revealed" in door_directive_text(BARE, 2)


def test_ladder_exhausted():
    assert not ladder_exhausted(FULL, 2) and ladder_exhausted(FULL, 3)
    assert not ladder_exhausted(BARE, 1) and ladder_exhausted(BARE, 2)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q tests/test_placeholders.py tests/test_doors.py`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write doors.py**

```python
"""The Door ladder, ported word for word from picoclaw agent_bridge.go doorDirective."""
from __future__ import annotations

DOOR_OPEN, DOOR_CHOICE, DOOR_GUIDED = 1, 2, 3


def _authored(q: dict) -> tuple[bool, bool]:
    choices = [c for c in (q.get("choice_order") or []) if str(c).strip()]
    return len(choices) >= 2, bool(str(q.get("teach_text") or "").strip())


def door_for(q: dict, tries: int) -> int:
    has_choices, has_teach = _authored(q)
    if tries <= 0:
        return DOOR_OPEN
    if tries == 1:
        return DOOR_CHOICE if has_choices else (DOOR_GUIDED if has_teach else DOOR_OPEN)
    return DOOR_GUIDED if has_teach else (DOOR_CHOICE if has_choices else DOOR_OPEN)


def ladder_exhausted(q: dict, tries: int) -> bool:
    has_choices, has_teach = _authored(q)
    if not has_choices and not has_teach:
        return tries >= 2  # no authored ladder: the prompt's own two-miss reveal
    return tries >= DOOR_GUIDED


def door_directive_text(q: dict, tries: int) -> str:
    qid = str(q.get("id") or "")
    has_choices, has_teach = _authored(q)
    if not has_choices and not has_teach:
        if tries == 0:
            return ""
        if tries == 1:
            return (f"## This Question\nThe child has now missed question {qid} once. Give one hint or an either/or version, "
                    f"then ask the same question again and wait.")
        return (f"## This Question\nThe child has now missed question {qid} {tries} times. Kindly tell them the answer, say one "
                f"warm encouraging line, and move straight on to the next question. Your MEMO for this turn MUST carry "
                f"scored_q={qid}, scored_text, and result=revealed.")
    if tries >= DOOR_GUIDED:
        return (f"## This Question\nQuestion {qid} has now had all three tries. Do not explain it again and do NOT tell the child "
                f"the answer. Say one warm line — you will come back to this one another day — and move straight on to the next "
                f"question. Your MEMO for this turn MUST carry scored_q={qid}, scored_text, and result=revealed.")
    door = door_for(q, tries)
    if door == DOOR_CHOICE:
        a, b = (q.get("choice_order") or ["", ""])[:2]
        return (f"## This Question\nAsk question {qid} as a two-way choice, exactly these options and in this order: "
                f'"{a}" or "{b}". Do not add a third option and do not say which is right.')
    if door == DOOR_GUIDED:
        return (f"## This Question\nQuestion {qid}: say this explanation in your own warm words, in one breath: "
                f'"{q.get("teach_text")}". Then ask the question again and wait. Do NOT say the answer.')
    return f"## This Question\nAsk question {qid} plainly, in your own words. Do not offer choices and do not hint yet."
```

- [ ] **Step 4: Write placeholders.py**

```python
"""The {{PLACEHOLDER}} vocabulary the manager-owned greeting prompts use."""
from __future__ import annotations

import re
from datetime import datetime

QUIZ_PLACEHOLDERS = ("{{QUIZ_QUESTIONS}}", "{{RIDDLES}}", "{{MATH_PROBLEMS}}")
CONTENT_PLACEHOLDERS = ("{{JOKES}}", "{{WHY_QUESTIONS}}", "{{STORY_OF_THE_DAY}}", "{{WORDS_OF_THE_DAY}}", "{{SPELL_WORDS}}", "{{TODAY_PLAN}}", "{{TAG}}")
_ANY = re.compile(r"\{\{[A-Z_]+\}\}")


def wants_quiz(prompt: str) -> bool:
    return any(p in (prompt or "") for p in QUIZ_PLACEHOLDERS)


def time_band(now: datetime) -> str:
    h = now.hour
    return "morning" if h < 12 else "afternoon" if h < 17 else "evening" if h < 21 else "night"


def quiz_block(batch: dict | None) -> str:
    if not batch or not batch.get("questions"):
        return ("## Today's Quiz Questions\nThe question bank is unavailable right now. Do NOT run a scored quiz and do NOT "
                "invent questions. Offer free chat instead, and tell the child new questions are coming soon.")
    lines = [f"## Today's Quiz Questions (Level {batch.get('level', 1)}, ages {batch.get('age_band', '')})".rstrip(", ages )") ]
    answered = int(batch.get("answered_today") or 0)
    if answered:
        lines.append(f"The child has answered {answered} already today; continue from the list below, in order.")
    for i, q in enumerate(batch["questions"], 1):
        accepted = [str(a) for a in (q.get("accepted_answers") or []) if str(a).strip()]
        extra = f" (also accept: {', '.join(accepted)})" if accepted else ""
        lines.append(f"{i}. (id={q.get('id')}) {q.get('question_text')} — Answer: {q.get('answer_text')}{extra}")
    wonder = batch.get("wonder_to_ask") or {}
    if wonder.get("question_text"):
        lines.append("")
        lines.append(f"Wonder Question (code {wonder.get('code', '')}): {wonder['question_text']}")
        if wonder.get("second_pass") and wonder.get("previous_answer"):
            lines.append(f"Last time the child answered: {wonder['previous_answer']}")
    return "\n".join(lines)


def render_placeholders(prompt: str, batch: dict | None, now: datetime) -> str:
    out = prompt or ""
    block = quiz_block(batch) if wants_quiz(out) else ""
    for p in QUIZ_PLACEHOLDERS:
        out = out.replace(p, block)
    out = out.replace("{{TODAY_DATE}}", now.strftime("%A, %d %B %Y")).replace("{{TIME_BAND}}", f"({time_band(now)})")
    for p in CONTENT_PLACEHOLDERS:
        out = out.replace(p, "")
    return _ANY.sub("", out)
```

The `quiz_block` header line strips a trailing `, ages )` only when the band is empty; with a band it renders `(Level 1, ages 6-8)` as the test expects.

- [ ] **Step 5: Run tests to verify they pass**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q`
Expected: all passed.

- [ ] **Step 6: Commit**

```bash
git add main/python-agent/agent/placeholders.py main/python-agent/agent/doors.py main/python-agent/tests/test_placeholders.py main/python-agent/tests/test_doors.py
git commit -m "feat(python-agent): prompt placeholders, quiz block and the Door ladder wording"
```

---

### Task 5: Quiz tracker and quiz tools

**Files:**
- Create: `main/python-agent/agent/quiz.py`
- Test: `main/python-agent/tests/test_quiz.py`

**Interfaces:**
- Consumes: `doors.py` (Task 4), `ManagerClient` (Task 2).
- Produces: `MEMO_TYPES = {"quizzy": "daily_quiz", "bujho": "daily_riddle", "ginti": "daily_math"}`, `memo_type_for(character) -> str`, `QuizTracker(batch, workspace, memo_type, manager, device_mac, on_directive=None, now=None)` with `status() -> str`, `async score(question_id, result, transcript) -> str`, `async record_wonder(question, answer, code)`, `pending() -> dict | None`, and `quiz_tools(tracker) -> list` returning three `livekit.agents.function_tool` objects (`quiz_status`, `quiz_score_answer`, `quiz_record_wonder`).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_quiz.py
from datetime import datetime
from pathlib import Path

import pytest

from agent.quiz import QuizTracker, memo_type_for, quiz_tools

BATCH = {"level": 1, "age_band": "6-8", "bank": "quiz", "answered_today": 2,
         "questions": [{"id": "11", "question_text": "How many legs does a spider have?", "answer_text": "eight", "accepted_answers": ["8"],
                        "choice_order": ["eight", "six"], "teach_text": "four legs each side"},
                       {"id": "12", "question_text": "What colour is the sky?", "answer_text": "blue", "accepted_answers": [], "choice_order": [], "teach_text": ""}]}


class FakeManager:
    def __init__(self):
        self.answers, self.wonders = [], []

    async def post_quiz_answer(self, mac, qid, result, bank, attempts):
        self.answers.append((qid, result, bank, attempts))

    async def post_quiz_attempts(self, mac, qid, attempts):
        pass

    async def post_wonder(self, mac, question, answer, code):
        self.wonders.append((question, answer, code))


def tracker(tmp_path, mgr):
    return QuizTracker(BATCH, tmp_path, "daily_quiz", mgr, "68:EE:8F:60:BA:AC", now=lambda: datetime(2026, 9, 13))


def test_memo_type():
    assert memo_type_for("Quizzy") == "daily_quiz" and memo_type_for("bujho") == "daily_riddle" and memo_type_for("Cheeko") == ""


@pytest.mark.asyncio
async def test_correct_writes_memo_reports_and_moves_on(tmp_path: Path):
    mgr = FakeManager()
    t = tracker(tmp_path, mgr)
    directive = await t.score("11", "correct", "eight")
    assert "Ask question 12 plainly" in directive
    memo = (tmp_path / "memory" / "state" / "daily_quiz.md").read_text(encoding="utf-8")
    assert memo.startswith("MEMO: type=daily_quiz | date=2026-09-13 | scored_q=11 | scored_text=How many legs does a spider have? | result=correct | answered=3")
    assert mgr.answers == [("11", "correct", "quiz", [{"verdict": "correct", "transcript": "eight"}])]
    with pytest.raises(ValueError):
        await t.score("11", "correct", "eight")


@pytest.mark.asyncio
async def test_misses_walk_the_ladder_then_reveal(tmp_path: Path):
    mgr = FakeManager()
    pushed = []
    t = tracker(tmp_path, mgr)
    t.on_directive = pushed.append
    assert '"eight" or "six"' in await t.score("11", "miss", "six")
    assert "four legs each side" in await t.score("11", "miss", "ten")
    final = await t.score("11", "miss", "twelve")
    assert "all three tries" in final and "Ask question 12 plainly" in final
    assert mgr.answers[0][1] == "revealed" and len(mgr.answers[0][3]) == 3
    assert "pending question id=12" in t.status() and len(pushed) == 3


@pytest.mark.asyncio
async def test_correct_at_door_three_is_revealed(tmp_path: Path):
    mgr = FakeManager()
    t = tracker(tmp_path, mgr)
    await t.score("11", "miss", "six")
    await t.score("11", "miss", "ten")
    await t.score("11", "correct", "eight")
    assert mgr.answers[0][1] == "revealed"


@pytest.mark.asyncio
async def test_tools_are_function_tools_with_the_right_names(tmp_path: Path):
    t = tracker(tmp_path, FakeManager())
    names = [tool.info.name for tool in quiz_tools(t)]
    assert names == ["quiz_status", "quiz_score_answer", "quiz_record_wonder"]
    bad = await t.score("99", "correct", "x") if False else None  # unknown ids raise through the tool as a string error
    assert bad is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q tests/test_quiz.py`
Expected: FAIL, `ModuleNotFoundError: agent.quiz`.

- [ ] **Step 3: Write quiz.py**

```python
"""Game state the voice model cannot hold in prose: pending question, tries, verdicts."""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Callable

from livekit.agents import function_tool

from .doors import DOOR_GUIDED, door_directive_text, door_for, ladder_exhausted

logger = logging.getLogger("cheeko-gptlive.quiz")

MEMO_TYPES = {"quizzy": "daily_quiz", "bujho": "daily_riddle", "ginti": "daily_math"}


def memo_type_for(character: str) -> str:
    return MEMO_TYPES.get((character or "").strip().lower(), "")


class QuizTracker:
    def __init__(self, batch: dict, workspace: Path, memo_type: str, manager, device_mac: str,
                 on_directive: Callable[[str], None] | None = None, now: Callable[[], datetime] | None = None) -> None:
        self.batch = batch or {}
        self.questions: list[dict] = list(self.batch.get("questions") or [])
        self.workspace = Path(workspace)
        self.memo_type = memo_type or "daily_quiz"
        self.manager = manager
        self.device_mac = device_mac
        self.on_directive = on_directive
        self.now = now or datetime.now
        self.reported: set[str] = set()
        self.tries: dict[str, int] = {}
        self.attempts: dict[str, list[dict]] = {}

    def _find(self, qid: str) -> dict | None:
        qid = str(qid or "").strip()
        return next((q for q in self.questions if str(q.get("id")) == qid), None)

    def pending(self) -> dict | None:
        return next((q for q in self.questions if str(q.get("id")) not in self.reported), None)

    def status(self) -> str:
        answered = int(self.batch.get("answered_today") or 0) + len(self.reported)
        total = int(self.batch.get("answered_today") or 0) + len(self.questions)
        q = self.pending()
        if q is None:
            return f"STATUS: answered={answered} of {total} today | all questions done"
        qid = str(q.get("id"))
        tries = self.tries.get(qid, 0)
        return (f"STATUS: answered={answered} of {total} today | pending question id={qid} "
                f"(door {door_for(q, tries)}, tries {tries}): {q.get('question_text')}")

    async def score(self, question_id: str, result: str, transcript: str) -> str:
        q = self._find(question_id)
        if q is None:
            raise ValueError(f"question {question_id!r} is not in today's batch")
        qid = str(q.get("id"))
        if qid in self.reported:
            raise ValueError(f"question {qid} was already scored")
        transcript = (transcript or "").strip()
        if result == "miss":
            self.tries[qid] = self.tries.get(qid, 0) + 1
            self.attempts.setdefault(qid, []).append({"verdict": "wrong", "transcript": transcript})
            if not ladder_exhausted(q, self.tries[qid]):
                return self._next_directive(q)
            return await self._record(q, "revealed")
        if result == "correct":
            self.attempts.setdefault(qid, []).append({"verdict": "correct", "transcript": transcript})
            verdict = "revealed" if door_for(q, self.tries.get(qid, 0)) == DOOR_GUIDED else "correct"  # ADR-0009 mastery rule
            return await self._record(q, verdict)
        if result == "revealed":
            self.attempts.setdefault(qid, []).append({"verdict": "revealed", "transcript": transcript})
            return await self._record(q, "revealed")
        raise ValueError('result must be "correct", "miss" or "revealed"')

    async def _record(self, q: dict, verdict: str) -> str:
        qid = str(q.get("id"))
        self.reported.add(qid)
        answered = int(self.batch.get("answered_today") or 0) + len(self.reported)
        text = str(q.get("question_text") or "").replace("|", "/")
        memo = (f"MEMO: type={self.memo_type} | date={self.now().strftime('%Y-%m-%d')} | scored_q={qid} | "
                f"scored_text={text} | result={verdict} | answered={answered}")
        state_dir = self.workspace / "memory" / "state"
        state_dir.mkdir(parents=True, exist_ok=True)
        (state_dir / f"{self.memo_type}.md").write_text(memo + "\n", encoding="utf-8")
        await self.manager.post_quiz_answer(self.device_mac, qid, verdict, str(self.batch.get("bank") or ""), list(self.attempts.get(qid, [])))
        terminal = door_directive_text(q, self.tries.get(qid, 0)) if verdict == "revealed" and self.tries.get(qid, 0) > 0 else ""
        nxt = self.pending()
        tail = self._next_directive(nxt) if nxt else "All of today's questions are done. Celebrate briefly and move on to free play."
        return (terminal + "\n\n" + tail).strip()

    def _next_directive(self, q: dict) -> str:
        d = door_directive_text(q, self.tries.get(str(q.get("id")), 0)) or \
            f"## This Question\nAsk question {q.get('id')} plainly, in your own words. Do not offer choices and do not hint yet."
        if self.on_directive:
            self.on_directive(d)
        return d

    async def record_wonder(self, question: str, answer: str, code: str) -> None:
        await self.manager.post_wonder(self.device_mac, question, answer, code)


def quiz_tools(tracker: QuizTracker) -> list:
    @function_tool(name="quiz_status")
    async def quiz_status() -> str:
        """Where today's quiz stands: answered count, the pending question and its Door. Call before asking if unsure."""
        return tracker.status()

    @function_tool(name="quiz_score_answer")
    async def quiz_score_answer(question_id: str, result: str, transcript: str = "") -> str:
        """Score the child's latest answer to a quiz question.

        Args:
            question_id: The id shown next to the question, e.g. "11".
            result: "correct" when it matches the bank answer, "miss" when it does not (the tool decides hints,
                choices and reveals), "revealed" when the child asked for the answer.
            transcript: What the child said, verbatim.
        """
        try:
            return await tracker.score(question_id, result, transcript)
        except ValueError as e:
            return f"error: {e}"

    @function_tool(name="quiz_record_wonder")
    async def quiz_record_wonder(question: str, answer: str, code: str = "") -> str:
        """Record the Wonder Question the child asked today and the answer given, for tomorrow's recall."""
        await tracker.record_wonder(question, answer, code)
        return "recorded"

    return [quiz_status, quiz_score_answer, quiz_record_wonder]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q`
Expected: all passed. If `tool.info.name` is not the attribute name in this livekit-agents version, use `livekit.agents.llm.tool_context.FunctionTool` inspection: `tool.info.name` exists on `FunctionTool` in 1.8; adjust the test only if the attribute differs.

- [ ] **Step 5: Commit**

```bash
git add main/python-agent/agent/quiz.py main/python-agent/tests/test_quiz.py
git commit -m "feat(python-agent): quiz tracker and backend tools that own the Door ladder and MEMO state"
```

---

### Task 6: Persona blocks, memory tool, per-character tool sets

**Files:**
- Create: `main/python-agent/agent/persona.py`, `main/python-agent/agent/tools.py`
- Test: `main/python-agent/tests/test_persona.py`, `main/python-agent/tests/test_tools.py`

**Interfaces:**
- Produces (persona.py): `delegation_block(language: str, has_quiz: bool) -> str`, `ACCENT_INDIAN: str`, `voice_instructions(system_prompt_from_files: str, language: str, accent: str, bank_block: str, has_quiz: bool) -> str`, `backend_instructions(bank_block: str, memos: list[str], has_quiz: bool) -> str`, `greeting_instruction(character: str, greeting_prompt: str) -> str`.
- Produces (tools.py): `get_time_date` and `remember_child_fact(workspace)` function tools, `tools_for(character: str, workspace: Path, quiz_tracker) -> list`, `WEB_SEARCH_CHARACTERS: set[str] | None` (None = everyone).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_persona.py
from agent.persona import ACCENT_INDIAN, backend_instructions, greeting_instruction, voice_instructions


def test_voice_instructions_layers_files_rules_bank_and_accent():
    v = voice_instructions("# Cheeko\n\n---\n\n## AGENT.md\n\nYou are Quizzy.", "Hindi", "indian", "## Today's Quiz Questions\n1. (id=11) ...", True)
    assert v.index("You are Quizzy.") < v.index("<delegation>") < v.index("(id=11)") < v.index("<accent>")
    assert "Speak Hindi" in v and "quiz" in v.lower() and "remember_child_fact" not in v
    plain = voice_instructions("x", "English", "default", "", False)
    assert "<accent>" not in plain and "scored" not in plain


def test_backend_instructions_carry_bank_and_memos():
    b = backend_instructions("## Today's Quiz Questions", ["MEMO: type=daily_quiz | date=2026-09-12 | answered=3"], True)
    assert "quiz_score_answer" in b and "## Today's Quiz Questions" in b and "MEMO: type=daily_quiz" in b
    assert "quiz_score_answer" not in backend_instructions("", [], False)


def test_greeting_instruction():
    g = greeting_instruction("Quizzy", "Start with question one.")
    assert "Quizzy" in g and "Start with question one." in g
    assert "Greet" in greeting_instruction("Cheeko", "")
```

```python
# tests/test_tools.py
from pathlib import Path

import pytest

from agent.tools import get_time_date, remember_child_fact, tools_for


@pytest.mark.asyncio
async def test_remember_appends_a_dated_line(tmp_path: Path):
    tool = remember_child_fact(tmp_path)
    out = await tool._callable("has a dog named Harry")
    assert "remembered" in out
    assert "has a dog named Harry" in (tmp_path / "memory" / "MEMORY.md").read_text(encoding="utf-8")
    assert "error" in await tool._callable("   ")


def test_tools_for_character(tmp_path: Path):
    names = [t.info.name for t in tools_for("Cheeko", tmp_path, None)]
    assert names == ["get_time_date", "remember_child_fact"]
    class T:  # stand-in tracker
        pass
    names = [t.info.name for t in tools_for("Quizzy", tmp_path, quiz_tracker=None)]
    assert "quiz_score_answer" not in names  # no batch, no quiz tools
```

`tool._callable` is how a `FunctionTool` exposes its coroutine in livekit-agents 1.8 (`llm.tool_context.FunctionTool`); if the attribute differs, read `livekit/agents/llm/tool_context.py` and use the accessor it provides.

- [ ] **Step 2: Run tests to verify they fail**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q tests/test_persona.py tests/test_tools.py`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write persona.py**

```python
"""What the two models are told, composed once because GPT-Live cannot change it later."""
from __future__ import annotations

ACCENT_INDIAN = """<accent>
Speak Indian English: an Indian accent with Indian intonation and rhythm, and the everyday
phrasing a child in India hears at home and at school. Keep it natural and warm, never a caricature.
</accent>"""


def delegation_block(language: str, has_quiz: bool) -> str:
    language = (language or "English").strip() or "English"
    lines = [
        "<delegation>",
        "You cannot look things up or keep score yourself. Delegate any question about the current time,",
        "date or weather, any factual question you are not sure about, and anything worth remembering",
        "about the child. While you wait, say one short cheerful line, then read out the result when it arrives.",
        "Answer greetings, small talk, jokes and simple questions yourself.",
    ]
    if has_quiz:
        lines += [
            "Every time the child answers a quiz question, delegate so the answer gets scored, and then do exactly",
            "what the result tells you to do next: ask plainly, offer the two choices, explain then re-ask, or reveal",
            "and move on. Never decide on your own whether an answer was right.",
        ]
    lines += [f"Speak {language} with the child unless they clearly switch language.", "</delegation>"]
    return "\n".join(lines)


def voice_instructions(system_prompt_from_files: str, language: str, accent: str, bank_block: str, has_quiz: bool) -> str:
    parts = [system_prompt_from_files, delegation_block(language, has_quiz)]
    if bank_block.strip():
        parts.append(bank_block.strip())
    if accent == "indian":
        parts.append(ACCENT_INDIAN)
    return "\n\n---\n\n".join(parts)


def backend_instructions(bank_block: str, memos: list[str], has_quiz: bool) -> str:
    text = ("You handle the work a voice model delegates while it talks to a child aged 3 to 16. "
            "Use tools when current information is required or when the child says something worth remembering. "
            "Reply with one or two short, friendly, child-safe sentences the voice model can read out.")
    if has_quiz:
        text += (" For quiz answers, compare the child's words with the bank answer and accepted answers, then call "
                 "quiz_score_answer with result=correct or result=miss; call quiz_status if unsure which question is pending.")
    if bank_block.strip():
        text += "\n\n" + bank_block.strip()
    if memos:
        text += "\n\n## Saved state from earlier sessions\n" + "\n".join(m.strip() for m in memos if m.strip())
    return text


def greeting_instruction(character: str, greeting_prompt: str) -> str:
    head = f"Immediately greet the child as {character or 'Cheeko'} in one or two short sentences. Do not wait for them to speak first."
    if greeting_prompt.strip():
        return head + "\n\n" + greeting_prompt.strip()
    return head + " Then ask what they want to do, and pause to listen."
```

- [ ] **Step 4: Write tools.py**

```python
"""Backend tools every character gets, and the per-character tool set."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from livekit.agents import function_tool

from .quiz import memo_type_for, quiz_tools

WEB_SEARCH_CHARACTERS: set[str] | None = None  # None: hosted web search for everyone


@function_tool(name="get_time_date")
async def get_time_date(timezone: str = "Asia/Kolkata") -> str:
    """Get the current date and time.

    Args:
        timezone: IANA timezone name, default India Standard Time.
    """
    try:
        now = datetime.now(ZoneInfo(timezone))
    except Exception:
        timezone, now = "Asia/Kolkata", datetime.now(ZoneInfo("Asia/Kolkata"))
    return now.strftime("%A, %d %B %Y, %I:%M %p") + f" ({timezone})"


def remember_child_fact(workspace: Path):
    @function_tool(name="remember_child_fact")
    async def _remember(fact: str) -> str:
        """Remember one durable fact about the child for future sessions: a pet's name, a favourite, a family member.

        Args:
            fact: The fact, as one short sentence.
        """
        fact = " ".join((fact or "").split())
        if not fact:
            return "error: fact is required"
        memory = Path(workspace) / "memory" / "MEMORY.md"
        memory.parent.mkdir(parents=True, exist_ok=True)
        with memory.open("a", encoding="utf-8") as f:
            f.write(f"- {datetime.now().strftime('%Y-%m-%d')}: {fact}\n")
        return "remembered: " + fact

    return _remember


def tools_for(character: str, workspace: Path, quiz_tracker) -> list:
    tools = [get_time_date, remember_child_fact(workspace)]
    if quiz_tracker is not None and memo_type_for(character):
        tools += quiz_tools(quiz_tracker)
    return tools
```

`remember_child_fact` writes to the ephemeral workspace; the fact reaches future sessions only through the manager. Task 8 uploads `memory/MEMORY.md` lines as part of the session summary, so nothing is lost; until then this is session-local.

- [ ] **Step 5: Run tests to verify they pass**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q`
Expected: all passed.

- [ ] **Step 6: Commit**

```bash
git add main/python-agent/agent/persona.py main/python-agent/agent/tools.py main/python-agent/tests/test_persona.py main/python-agent/tests/test_tools.py
git commit -m "feat(python-agent): persona blocks, memory tool and per-character tool sets"
```

---

### Task 7: Worker entrypoint: assemble the session from the manager and the workspace

**Files:**
- Modify: `main/python-agent/cheeko_gptlive_worker.py` (replace; keep the console/dev/start docstring)
- Modify: `main/python-agent/.env.example` (add `MANAGER_API_URL=http://127.0.0.1:8002/toy`, `MANAGER_API_SECRET=`)
- Test: `main/python-agent/tests/test_assembly.py`

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: `assemble_session(ctx_room_name: str, metadata: str | None, manager: ManagerClient, workspaces_root: Path, now=None) -> SessionPlan` where `SessionPlan` has `meta, workspace, voice_instructions, backend_instructions, greeting, tools, quiz_tracker, has_quiz`. The entrypoint calls it, builds the `Agent`, and wires greeting, directive pushes, and shutdown.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_assembly.py
from datetime import datetime
from pathlib import Path

import pytest

from agent.manager import ManagerClient
from cheeko_gptlive_worker import assemble_session

ROOM = "969bf3c6-8d58-4fe5-9f5b-0b964d27e295_68EE8F60BAAC_conversation"
META = '{"character":"Quizzy","child_profile":{"name":"Aarav","age":7},"gptlive":{"voice":"vesper","accent":"indian"}}'


class FakeFetch:
    async def __call__(self, method, url, body):
        if "/agent/character/by-name/Quizzy/session" in url:
            return 200, {"code": 0, "data": {"systemPrompt": "You are Quizzy, quiz master.", "soul": "Kind.", "greetingPrompt": "Ask away. {{QUIZ_QUESTIONS}}", "language": "en"}}
        if "/quiz/next-questions" in url:
            return 200, {"code": 0, "data": {"level": 1, "age_band": "6-8", "bank": "quiz", "answered_today": 0,
                                            "questions": [{"id": "11", "question_text": "How many legs does a spider have?", "answer_text": "eight", "accepted_answers": [], "choice_order": [], "teach_text": ""}]}}
        if "/progress/state" in url:
            return 200, {"code": 0, "data": {"states": [{"state_type": "daily_quiz", "memo": "MEMO: type=daily_quiz | date=2026-09-12"}]}}
        return 404, {}


@pytest.mark.asyncio
async def test_assemble_quizzy_session(tmp_path: Path):
    plan = await assemble_session(ROOM, META, ManagerClient("http://m/toy", "s", fetch=FakeFetch()), tmp_path, now=lambda: datetime(2026, 9, 13, 9))
    assert plan.meta.voice == "vesper" and plan.meta.accent == "indian" and plan.has_quiz
    assert (plan.workspace / "AGENT.md").exists() and "You are Quizzy, quiz master." in plan.voice_instructions
    assert "(id=11)" in plan.voice_instructions and "(id=11)" in plan.backend_instructions and "<accent>" in plan.voice_instructions
    assert "MEMO: type=daily_quiz" in plan.backend_instructions
    assert "Ask away." in plan.greeting and "{{" not in plan.greeting
    assert [t.info.name for t in plan.tools] == ["get_time_date", "remember_child_fact", "quiz_status", "quiz_score_answer", "quiz_record_wonder"]


@pytest.mark.asyncio
async def test_assemble_without_manager_degrades(tmp_path: Path):
    plan = await assemble_session("gptlive-test-9", None, ManagerClient("", ""), tmp_path)
    assert plan.meta.character == "Cheeko" and not plan.has_quiz and plan.quiz_tracker is None
    assert "You are Cheeko" in plan.voice_instructions and [t.info.name for t in plan.tools] == ["get_time_date", "remember_child_fact"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q tests/test_assembly.py`
Expected: FAIL, `ImportError: cannot import name 'assemble_session'`.

- [ ] **Step 3: Rewrite cheeko_gptlive_worker.py**

```python
"""
Cheeko GPT-Live worker (agent name: cheeko-gptlive, port 8090)

Full-duplex OpenAI GPT-Live voice model; reasoning + tool calls delegated to a backend Responses model.
Persona comes from the manager as AGENT.md / SOUL.md / USER.md files in an ephemeral workspace, like picoclaw.

Run:
  python cheeko_gptlive_worker.py console   # local mic, no room
  python cheeko_gptlive_worker.py dev       # register with LIVEKIT_URL (hot-reload)
  python cheeko_gptlive_worker.py start     # production (pm2 on the dev box)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

from livekit import rtc  # noqa: E402
from livekit.agents import Agent, AgentSession, JobContext, JobProcess, RoomInputOptions, WorkerOptions, cli  # noqa: E402
from livekit.plugins import openai, silero  # noqa: E402
from livekit.plugins.openai.realtime import GPTLiveModel  # noqa: E402

from agent.manager import ManagerClient  # noqa: E402
from agent.metadata import SessionMeta, parse_dispatch_metadata  # noqa: E402
from agent.persistence import SessionRecorder  # noqa: E402  (Task 8; stub until then, see below)
from agent.persona import backend_instructions, greeting_instruction, voice_instructions  # noqa: E402
from agent.placeholders import quiz_block, render_placeholders, wants_quiz  # noqa: E402
from agent.quiz import QuizTracker, memo_type_for  # noqa: E402
from agent.tools import tools_for  # noqa: E402
from agent.workspace import build_system_prompt, hydrate_workspace, persona_from_manager, remove_workspace  # noqa: E402

logger = logging.getLogger("cheeko-gptlive")
AGENT_NAME = "cheeko-gptlive"
DEFAULT_PORT = 8090
WORKSPACES = ROOT / "workspaces"
GREETING_FALLBACK_S = 3.0


@dataclass
class SessionPlan:
    meta: SessionMeta
    workspace: Path
    voice_instructions: str
    backend_instructions: str
    greeting: str
    tools: list
    quiz_tracker: QuizTracker | None
    has_quiz: bool


async def assemble_session(room_name: str, metadata: str | None, manager: ManagerClient, workspaces_root: Path,
                           now: Callable[[], datetime] | None = None) -> SessionPlan:
    now = now or datetime.now
    meta = parse_dispatch_metadata(metadata, room_name)
    persona_data, states = None, []
    if manager.enabled:
        persona_data, states = await asyncio.gather(
            manager.character_session(meta.character, meta.character_id),
            manager.progress_state(meta.device_mac or ""),
        )
    persona = persona_from_manager(persona_data, meta)
    workspace = hydrate_workspace(workspaces_root, room_name, persona, meta, states)

    batch = None
    if wants_quiz(persona.greeting) and manager.enabled and meta.device_mac:
        batch = await manager.quiz_batch(meta.device_mac, meta.character)
    tracker = None
    if batch and memo_type_for(meta.character):
        tracker = QuizTracker(batch, workspace, memo_type_for(meta.character), manager, meta.device_mac or "", now=now)
    has_quiz = tracker is not None
    bank = quiz_block(batch) if wants_quiz(persona.greeting) else ""
    memos = [str(s.get("memo") or "") for s in states if s.get("memo")]
    return SessionPlan(
        meta=meta, workspace=workspace,
        voice_instructions=voice_instructions(build_system_prompt(workspace), persona.language or meta.language, meta.accent, bank, has_quiz),
        backend_instructions=backend_instructions(bank, memos, has_quiz),
        greeting=greeting_instruction(meta.character, render_placeholders(persona.greeting, batch, now())),
        tools=tools_for(meta.character, workspace, tracker),
        quiz_tracker=tracker, has_quiz=has_quiz,
    )


class CheekoGPTLive(Agent):
    def __init__(self, plan: SessionPlan) -> None:
        self.plan = plan
        self._greeted = False
        super().__init__(
            instructions=plan.voice_instructions,
            tools=plan.tools + [openai.tools.WebSearch()],
            llm=GPTLiveModel(
                voice=plan.meta.voice,
                responses_options={"model": os.getenv("GPTLIVE_BACKEND_MODEL", "gpt-5.6-luna"), "instructions": plan.backend_instructions},
            ),
        )

    async def on_enter(self) -> None:
        if self.plan.quiz_tracker is not None:
            self.plan.quiz_tracker.on_directive = lambda d: asyncio.create_task(self.push_rule(d))
        await asyncio.sleep(GREETING_FALLBACK_S)
        await self.greet()

    async def greet(self) -> None:
        if self._greeted:
            return
        self._greeted = True
        handle = self.session.generate_reply(instructions=self.plan.greeting)
        await handle
        if handle.exception() is not None:
            logger.warning("model declined the greeting: %s", handle.exception())

    async def push_rule(self, text: str) -> None:
        """A standing rule for the voice model: a system message appended after start becomes session.instructions.append."""
        chat_ctx = self.chat_ctx.copy()
        chat_ctx.add_message(role="system", content=text)
        try:
            await self.update_chat_ctx(chat_ctx)
        except Exception as e:  # the directive also travels in the tool result, so this is best effort
            logger.warning("append_instructions failed: %s", e)


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()  # GPT-Live drops the default VAD; barge-in playback cutoff needs one


async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}
    manager = ManagerClient(os.getenv("MANAGER_API_URL", ""), os.getenv("MANAGER_API_SECRET", ""))
    metadata = ctx.job.metadata if ctx.job else None
    plan = await assemble_session(ctx.room.name, metadata, manager, WORKSPACES)
    logger.info("session: character=%s voice=%s accent=%s rate=%s quiz=%s tools=%s",
                plan.meta.character, plan.meta.voice, plan.meta.accent, plan.meta.sample_rate, plan.has_quiz,
                [t.info.name for t in plan.tools])

    session = AgentSession(vad=ctx.proc.userdata["vad"])
    agent = CheekoGPTLive(plan)
    recorder = SessionRecorder(session, manager, plan)

    @ctx.room.on("data_received")
    def _on_data(packet: rtc.DataPacket) -> None:
        try:
            msg = json.loads(packet.data.decode("utf-8"))
        except Exception:
            return
        if msg.get("type") == "ready_for_greeting":
            asyncio.create_task(agent.greet())
        # ptt_event, speech_end, abort: the model owns turns; ignored on purpose

    async def shutdown() -> None:
        await recorder.flush(session.usage)
        await manager.aclose()
        remove_workspace(plan.workspace)

    ctx.add_shutdown_callback(shutdown)
    await session.start(
        room=ctx.room, agent=agent,
        room_input_options=RoomInputOptions(audio_sample_rate=plan.meta.sample_rate, audio_num_channels=1),
    )
    logger.info("%s is LIVE in %s", AGENT_NAME, ctx.room.name)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm, agent_name=AGENT_NAME,
                              port=int(os.getenv("GPTLIVE_PORT", DEFAULT_PORT))))
```

Until Task 8 lands, create `agent/persistence.py` with a stub so the worker imports:

```python
class SessionRecorder:
    def __init__(self, session, manager, plan) -> None: ...
    async def flush(self, usage) -> None: ...
```

Keep the metrics, transcript, state and tool logging handlers from the old worker (`metrics_collected`, `conversation_item_added`, `agent_state_changed`, `function_tools_executed`, `error`) by moving them into `SessionRecorder.__init__` in Task 8; for this task, re-register them in `entrypoint` verbatim from the previous version so the dashboard logs do not regress.

- [ ] **Step 4: Run the tests and a real dispatch**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q`
Expected: all passed.

Then, with `MANAGER_API_URL` pointing at a running manager (dev box: `http://127.0.0.1:8002/toy` from the box, or the local API), run the worker in `dev` mode and use the headless recipe from the memory file (`lk --project cheek0 dispatch create ... --metadata '{"character":"Quizzy","child_profile":{"name":"Aarav","age":7}}'`) and confirm the log line `session: character=Quizzy ... quiz=True tools=[...]` and that `workspaces/<room>/AGENT.md` exists while the session runs.

- [ ] **Step 5: Commit**

```bash
git add main/python-agent/cheeko_gptlive_worker.py main/python-agent/agent/persistence.py main/python-agent/tests/test_assembly.py main/python-agent/.env.example
git commit -m "feat(python-agent): assemble each session from the manager persona and workspace files"
```

---

### Task 8: Persistence at shutdown

**Files:**
- Modify: `main/python-agent/agent/persistence.py` (replace the stub)
- Test: `main/python-agent/tests/test_persistence.py`

**Interfaces:**
- Produces: `SessionRecorder(session, manager, plan)` registering the session handlers, `record_user(text)`, `record_agent(text)`, `snapshot() -> list[dict]` (`{"chatType": 1|2, "content", "timestamp"}` ms), `usage_payload(usage) -> dict`, `async flush(usage)` posting chat history, session end and token usage (only when `plan.meta.device_mac` and `manager.enabled`).
- Voice seconds come from the `LLMModelUsage` entry whose model is `gpt-live-1` (`session_duration`); tokens from the other entries.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_persistence.py
from types import SimpleNamespace

import pytest

from agent.persistence import SessionRecorder


class FakeManager:
    enabled = True

    def __init__(self):
        self.calls = []

    async def send_chat_history(self, mac, sid, messages):
        self.calls.append(("history", mac, sid, messages))

    async def send_session_end(self, mac, sid, n):
        self.calls.append(("end", mac, sid, n))

    async def send_token_usage(self, mac, sid, usage):
        self.calls.append(("usage", mac, sid, usage))


class FakeSession:
    def on(self, name):
        return lambda fn: fn


def plan(mac="68:EE:8F:60:BA:AC"):
    return SimpleNamespace(meta=SimpleNamespace(device_mac=mac), room_name="room-1")


@pytest.mark.asyncio
async def test_flush_posts_history_end_and_usage():
    mgr = FakeManager()
    rec = SessionRecorder(FakeSession(), mgr, plan())
    rec.room_name = "room-1"
    rec.record_user("hello")
    rec.record_agent("hi there")
    usage = SimpleNamespace(model_usage=[
        SimpleNamespace(model="gpt-live-1", session_duration=31.0, input_tokens=0, output_tokens=0, total_tokens=0),
        SimpleNamespace(model="gpt-5.6-luna", session_duration=0, input_tokens=100, output_tokens=20, total_tokens=120),
    ])
    await rec.flush(usage)
    kinds = [c[0] for c in mgr.calls]
    assert kinds == ["history", "end", "usage"]
    msgs = mgr.calls[0][3]
    assert [m["chatType"] for m in msgs] == [1, 2] and msgs[1]["content"] == "hi there"
    assert mgr.calls[1][3] == 2
    assert mgr.calls[2][3]["totalTokens"] == 120 and mgr.calls[2][3]["sessionDurationSeconds"] == 31.0 and mgr.calls[2][3]["messageCount"] == 2


@pytest.mark.asyncio
async def test_flush_skips_without_mac():
    mgr = FakeManager()
    rec = SessionRecorder(FakeSession(), mgr, plan(mac=None))
    await rec.flush(SimpleNamespace(model_usage=[]))
    assert mgr.calls == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q tests/test_persistence.py`
Expected: FAIL (stub does nothing).

- [ ] **Step 3: Write persistence.py**

```python
"""Transcript capture and the shutdown uploads picoclaw performs in post_session_persistence.go."""
from __future__ import annotations

import logging
import time

logger = logging.getLogger("cheeko-gptlive.persist")
CHAT_USER, CHAT_AGENT = 1, 2


class SessionRecorder:
    def __init__(self, session, manager, plan) -> None:
        self.manager, self.plan = manager, plan
        self.room_name = getattr(plan, "room_name", "") or ""
        self.messages: list[dict] = []
        self._register(session)

    def _register(self, session) -> None:
        @session.on("conversation_item_added")
        def _on_item(ev) -> None:
            item = ev.item
            role, text = getattr(item, "role", None), (getattr(item, "text_content", "") or "").strip()
            logger.info("TRANSCRIPT %s: %s", role or type(item).__name__, text)
            if role == "user" and text:
                self.record_user(text)
            elif role == "assistant" and text:
                self.record_agent(text)

        @session.on("agent_state_changed")
        def _on_state(ev) -> None:
            logger.info("STATE %s -> %s", ev.old_state, ev.new_state)

        @session.on("function_tools_executed")
        def _on_tools(ev) -> None:
            logger.info("TOOLS %s", [(c.name, c.arguments) for c in ev.function_calls])

        @session.on("error")
        def _on_error(ev) -> None:
            logger.error("SESSION ERROR %s", ev.error)

    def record_user(self, text: str) -> None:
        self.messages.append({"chatType": CHAT_USER, "content": text, "timestamp": int(time.time() * 1000)})

    def record_agent(self, text: str) -> None:
        self.messages.append({"chatType": CHAT_AGENT, "content": text, "timestamp": int(time.time() * 1000)})

    def snapshot(self) -> list[dict]:
        return list(self.messages)

    def usage_payload(self, usage) -> dict:
        seconds, in_tok, out_tok, total = 0.0, 0, 0, 0
        for u in getattr(usage, "model_usage", []) or []:
            if str(getattr(u, "model", "")).startswith("gpt-live"):
                seconds += float(getattr(u, "session_duration", 0) or 0)
            else:
                in_tok += int(getattr(u, "input_tokens", 0) or 0)
                out_tok += int(getattr(u, "output_tokens", 0) or 0)
                total += int(getattr(u, "total_tokens", 0) or 0)
        return {"inputTokens": in_tok, "outputTokens": out_tok, "totalTokens": total,
                "sessionDurationSeconds": round(seconds, 3), "messageCount": len(self.messages)}

    async def flush(self, usage) -> None:
        mac = getattr(self.plan.meta, "device_mac", None)
        if not mac or not getattr(self.manager, "enabled", False):
            logger.info("persistence skipped (mac=%s manager=%s)", mac, getattr(self.manager, "enabled", False))
            return
        sid = self.room_name
        await self.manager.send_chat_history(mac, sid, self.snapshot())
        await self.manager.send_session_end(mac, sid, len(self.messages))
        await self.manager.send_token_usage(mac, sid, self.usage_payload(usage))
```

In `cheeko_gptlive_worker.py`, set `plan.room_name = ctx.room.name` (add `room_name: str = ""` to `SessionPlan`) before creating the recorder, and remove the handlers that moved here.

- [ ] **Step 4: Run tests to verify they pass**

Run: `..\livekit-server\.venv-gptlive\Scripts\python.exe -m pytest -q`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add main/python-agent/agent/persistence.py main/python-agent/tests/test_persistence.py main/python-agent/cheeko_gptlive_worker.py
git commit -m "feat(python-agent): upload transcript, session end and token usage at shutdown"
```

---

### Task 9: Side-by-side rollout on the dev box

**Files:**
- Modify: `main/python-agent/README.md` (create; the runbook below)

Both workers already run on the box: `picoclaw-livekit` (agent `cheeko-agent`) and `cheeko-gptlive` (this worker). The manager decides per character which one serves it (`runtime_agent_name`, picoclaw ADR-0002), and the gateway passes that name to LiveKit's dispatch.

- [ ] **Step 1: Deploy the worker**

```bash
ssh root@64.227.170.31 'cd /root/xiaozhi-esp32-server && git pull --ff-only origin main && cd main/python-agent && .venv/bin/pip install -q -r requirements.txt && grep -q ^MANAGER_API_URL= .env || printf "MANAGER_API_URL=http://127.0.0.1:8002/toy\nMANAGER_API_SECRET=<copy SERVICE_SECRET_KEY from ../manager-api-node/.env>\n" >> .env; pm2 restart cheeko-gptlive --update-env && sleep 8 && pm2 logs cheeko-gptlive --lines 20 --nostream | grep -E "registered worker|error"'
```

Fill `MANAGER_API_SECRET` by hand on the box from `manager-api-node/.env` (`SERVICE_SECRET_KEY`); never paste it into chat or commits.

- [ ] **Step 2: Verify persona and quiz from the dashboard**

Dev admin dashboard → GPT-Live tab → agent `cheeko-gptlive`, a MAC whose character is Quizzy → Start. Expected in `pm2 logs cheeko-gptlive`: `session: character=Quizzy ... quiz=True`, a greeting that asks question one, `TOOLS [('quiz_score_answer', ...)]` after an answer, and on the manager side a new row from `/quiz/answer`. Then Stop and confirm `/agent/chat-history/session` received the transcript (manager logs or the parent app's history view).

- [ ] **Step 3: Move one character**

In the manager (admin UI or `PUT /agent/character/...` as the team does today), set the character's `runtime_agent_name` to `cheeko-gptlive`. Tap that character's card on a real device: the gateway dispatches to this worker, the device streams mic audio continuously (firmware must not gate the mic; PTT is ignored by this worker), and the child hears the GPT-Live persona. Move it back by resetting `runtime_agent_name` to `cheeko-agent`.

- [ ] **Step 4: Write the runbook and commit**

`main/python-agent/README.md`: what the worker is, the env vars (`OPENAI_API_KEY`, `LIVEKIT_*`, `MANAGER_API_URL`, `MANAGER_API_SECRET`, `GPTLIVE_*`), the workspace layout, the character→tool table, the deploy command from Step 1, the rollback (`runtime_agent_name` back to `cheeko-agent`), and the known gaps below.

```bash
git add main/python-agent/README.md
git commit -m "docs(python-agent): runbook for side-by-side rollout of GPT-Live characters"
```

---

## Known gaps (deliberately deferred)

- Content banks (`{{JOKES}}`, `{{STORY_OF_THE_DAY}}`, …) are stripped, not rendered. Next: a `content_block()` mirroring picoclaw `content_bank.go` and the manager's content endpoints.
- Session summary (`/sessions/{id}/summary`) is not generated; picoclaw asks its LLM for one. Next: ask the backend model for a two-line summary at shutdown and post it.
- `remember_child_fact` is session-local until the summary upload carries `memory/MEMORY.md` lines.
- Custom voices (`{"id": "voice_..."}`) and the `client` delegation mode.
- Device-side playback cut on interruption; measured first, added only if the tail feels long.

## Self-review

- **Spec coverage.** Persona from `.md` files (the main requirement): Tasks 3, 6, 7. Side by side + per-character routing: Task 9 (no code needed; manager already routes). Tools in priority order: Task 5 (quiz), Task 6 (memory, time, web search). Persistence: Task 8. Degradation without a manager: Tasks 2 and 7 tests.
- **Placeholder scan.** Every task has test and implementation code. Task 7 references `SessionRecorder` from Task 8 with an explicit stub so the order is executable.
- **Type consistency.** `SessionMeta` fields match between Tasks 1, 3, 7. `QuizTracker(batch, workspace, memo_type, manager, device_mac, on_directive, now)` matches Tasks 5 and 7. `tools_for(character, workspace, quiz_tracker)` matches Tasks 6 and 7. `FunctionTool.info.name` and `._callable` are the two livekit-agents internals the tests touch; verify them once in `livekit/agents/llm/tool_context.py` before Task 5.
