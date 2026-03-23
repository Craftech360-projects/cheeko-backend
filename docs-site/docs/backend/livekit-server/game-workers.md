---
id: game-workers
sidebar_position: 3
---

# Game Workers

Three specialized workers handle interactive games for children. All three share the same infrastructure as the main cheeko_worker but differ in the LLM-callable tools, game state management, and greeting behavior.

## How Mode Switching Works

The MQTT gateway (`mqtt-gateway.js`) maintains a `CHARACTER_AGENT_MAP` that maps character names to agent worker names:

```javascript
const CHARACTER_AGENT_MAP = {
  "Cheeko": "cheeko-agent",
  "Math Tutor": "math-tutor-agent",
  "Riddle Solver": "riddle-solver-agent",
  "Word Ladder": "word-ladder-agent",
};
```

When the user says something like "let's play math" while talking to Cheeko, the `update_agent_mode` function tool (registered in every worker's `AgentSession`) sends a `character_change` message via the MCP data channel. The gateway receives this, tears down the current LiveKit room, and dispatches a new job to the appropriate agent worker. The new worker starts fresh in a new room.

Each worker registers itself with LiveKit using its `agent_name` (e.g. `"math-tutor-agent"`), and the gateway dispatches to that exact name using the LiveKit `AgentDispatchClient`.

`update_agent_mode` normalizes spoken character names via `CHARACTER_ALIASES` in `src/features/mode_switching.py` — e.g. "math", "maths", "math teacher" all resolve to `"Math Tutor"`.

## Shared Infrastructure

All four workers (cheeko + 3 game workers) share:

| Component | Source | Role |
|-----------|--------|------|
| `BaseAssistant` | `src/shared/base_assistant.py` | Base class; provides `play_greeting()`, `set_room_info()`, `set_agent_session()`, optional battery/volume tools |
| `entrypoint_utils` | `src/shared/entrypoint_utils.py` | `parse_room_name()`, `render_prompt_with_profile()`, `delete_livekit_room()`, `create_state_handlers()`, `load_game_prompt()`, `init_chat_history_service()`, `extract_and_send_chat_history()` |
| `ConfigLoader` | `src/config/config_loader.py` | Loads `config.yaml`, Gemini realtime config, default prompt |
| `DatabaseHelper` | `src/utils/database_helper.py` | HTTP client for Manager API (`get_agent_id`, `get_child_profile_by_mac`) |
| `PromptService` | `src/services/prompt_service.py` | API-fetched prompts with Jinja2 rendering |
| `UsageManager` | `src/utils/helpers.py` | Token and TTFT tracking, per-session usage logging |
| `GameAnalyticsManager` | `src/utils/helpers.py` | Buffers game attempts locally; batch-sends on session close |
| `UnifiedAudioPlayer` | `src/services/unified_audio_player.py` | Audio playback through the LiveKit session |
| Dispatch metadata | `ctx.job.metadata` | Child profile + Mem0 memories injected by MQTT gateway |
| Idle reminder system | Inline in each worker | Sends 3 reminders at 15s intervals if user doesn't respond |
| Duplicate agent check | Inline in each worker | Exits if another agent with `"agent"` in identity is already in room |
| `cleanup_room_and_session()` | Inline in each worker | Idempotent cleanup: usage log → game analytics → chat history → session close → room delete |

What differs per game worker:
- The `GAME_TOOLS` list (different `@function_tool` callables)
- The `GREETING_INSTRUCTION` class variable (immediate game start format)
- Game state object passed to `set_math_game_state()` / `set_riddle_game_state()` / `set_word_ladder_state()`
- The `mode_type` string passed to `GameAnalyticsManager` (`"math_tutor"`, `"riddle_solver"`, `"word_ladder"`)
- The `load_game_prompt()` call passes `CHARACTER_NAME` to select the matching YAML prompt template

**Prewarm optimization**: All three game workers cache `yaml_config`, `realtime_config`, and a `DatabaseHelper` instance in `prewarm()`. Cheeko does not do this. The prewarm also uses a lower Gemini temperature (0.6 vs 0.8) for more consistent game behavior.

---

## Math Tutor

**File:** `workers/math_tutor_worker.py`
**Agent name:** `math-tutor-agent`
**Port:** 8085 (env: `MATH_TUTOR_PORT`)
**Game tools:** `check_math_answer`, `update_agent_mode`

### Character and Greeting

```python
class MathTutorAssistant(BaseAssistant):
    GREETING_INSTRUCTION = """You are the Maths Commander. Start the game NOW with a greeting AND your first math question in ONE response.

REQUIRED FORMAT - Say EXACTLY this pattern:
"Namaste beta! I'm your Maths Commander! Arrey, we have an EMERGENCY! [UNIQUE STORY WITH MATH PROBLEM]? Tell me quick!"

RULES:
1. Greet + Ask first question in ONE turn
2. Use a UNIQUE Indian-themed story (cricket, food, animals, festivals)
3. Use simple addition or subtraction with numbers under 20
4. End with the question and STOP - do NOT add anything after
5. Wait silently for the child's answer"""
```

The greeting is delivered immediately when the device sends `ready_for_greeting`. The LLM generates a math problem embedded in a short Indian-themed story narrative.

### Problem Generation

Problems are generated entirely by the LLM within the system prompt instructions. There is no separate problem generator module — the prompt instructs the agent to use simple arithmetic (addition/subtraction, numbers under 20) with Indian cultural context (cricket scores, food quantities, festival items, animals).

### Answer Validation (`check_math_answer`)

The `check_math_answer` function tool in `src/features/game_tools.py` receives:
- `user_answer` — child's spoken answer (e.g. `"eight"`, `"8"`)
- `expected_answer` — the correct answer the LLM invented (e.g. `"5"`)

The tool parses both to integers (converting number words like "eight" → 8), compares them, and returns a JSON result string:

| Result field | Values | Meaning |
|-------------|--------|---------|
| `result` | `correct`, `retry`, `move_next` | Outcome of this attempt |
| `streak` | integer | Current consecutive correct count |
| `game_complete` | bool | Whether the streak target was reached |
| `message` | string | Instruction for the LLM's response |
| `attempt_number` | 1 or 2 | Which attempt this was |

The game state tracks streaks and attempt counts. A wrong first answer allows a retry; a wrong second answer moves to the next question. When a streak target is reached, `game_complete: true` is returned and the LLM delivers a victory message.

`GameAnalyticsManager` records each attempt locally and batch-sends all attempts on session close via Manager API (`/analytics/game-attempt`).

### Idle Reminders

If the child does not respond within 15 seconds of a question, the worker sends up to 3 reminders:
1. "Take your time! I'm here whenever you're ready with your answer."
2. "No rush! Would you like me to repeat the question?"
3. "Still thinking? That's okay! Math takes time. Let me know when you're ready."

The idle timer is cancelled when the agent detects user speech (`user_speech_committed`) or a function call (`function_calls_started`).

---

## Riddle Solver

**File:** `workers/riddle_solver_worker.py`
**Agent name:** `riddle-solver-agent`
**Port:** 8086 (env: `RIDDLE_SOLVER_PORT`)
**Game tools:** `check_riddle_answer`, `update_agent_mode`

### Character and Greeting

```python
class RiddleSolverAssistant(BaseAssistant):
    GREETING_INSTRUCTION = """Greet the user as the Riddle Master. Then IMMEDIATELY present your first riddle.
Do NOT wait for them to say "yes" or "ready" - after greeting, instantly ask the first riddle.
Example: "Namaste detective! Shhh... You've reached the Haunted Haveli! Here's your first mystery: I have hands but cannot clap, I have a face but cannot smile. What am I?"
After asking, STOP and wait silently for the answer."""
```

The persona is the "Riddle Master" set in a "Haunted Haveli" (haunted mansion) atmosphere. The first riddle is asked immediately on greeting.

### Riddle Selection

Riddles are selected and presented by the LLM based on the system prompt instructions — there is no separate riddle database or selection module. The LLM generates age-appropriate riddles drawing on the system prompt's topic guidance.

### Hint System

Hints are managed through the `check_riddle_answer` function tool. Similar to math, a wrong first answer triggers a retry/hint; a wrong second answer reveals the answer and moves to the next riddle. The tool returns structured JSON with `result`, `message`, `hint`, and `game_complete` fields that guide the LLM's spoken response.

### Idle Reminders

Same 15-second/3-reminder system as Math Tutor, with riddle-specific messages:
1. "Take your time! I'm here whenever you're ready with your answer."
2. "No rush! Would you like me to repeat the riddle?"
3. "Still thinking? That's okay! Riddles take time. Let me know when you're ready."

---

## Word Ladder

**File:** `workers/word_ladder_worker.py`
**Agent name:** `word-ladder-agent`
**Port:** 8087 (env: `WORD_LADDER_PORT`)
**Game tools:** `validate_word_ladder_move`, `update_agent_mode`

### Character and Greeting

The persona is the "Word Pilot". Unlike the other workers, the greeting is dynamically generated with the actual word pair:

```python
def __init__(self, instructions: str = None, start_word: str = "road", target_word: str = "root") -> None:
    super().__init__(instructions=instructions)
    self.start_word = start_word
    self.target_word = target_word
    self.GREETING_INSTRUCTION = f"""Greet the user as the Word Pilot. Then IMMEDIATELY announce the starting word and required letter.
You MUST clearly say: "Our starting word is '{start_word.upper()}'! It ends with the letter '{start_word[-1].upper()}'. So give me a word that STARTS with '{start_word[-1].upper()}'!"
Do NOT wait for them to say "yes" or "ready" - announce the starting word right after greeting.
After announcing, STOP and wait silently for their word."""
```

### Word Pair Generation

At startup, the entrypoint calls `pick_valid_word_pair()` from `src/games/word_ladder_game.py` before any API calls. This generates a `(start_word, target_word)` pair that is:
1. Injected into the game prompt via `extra_vars={'start_word': start_word, 'target_word': target_word}`
2. Passed to `WordLadderAssistant.__init__()` so the greeting uses the exact same pair
3. Used to initialize `assistant.word_ladder_state.reset(start_word, target_word)`

This ensures the prompt, the greeting instruction, and the game state all reference the same word pair from the moment the session starts.

### Word Validation (`validate_word_ladder_move`)

The `validate_word_ladder_move` function tool validates each word the child says:
- The word must start with the last letter of the previous word in the chain
- The word must be a real English word (validated against the word ladder game's dictionary)
- Duplicate words are not allowed within the same session

The tool returns a JSON result with `valid`, `reason`, `next_required_letter`, and `game_complete` fields. The LLM uses these to confirm valid moves, explain why a word was invalid, and announce the next required starting letter.

### Progression

The game ends when a word ending with the target letter/word is reached, or when a configurable number of steps is completed. The exact completion logic is defined in the `word_ladder_state` object from `src/games/word_ladder_game.py`.

### Idle Reminders

Same 15-second/3-reminder system, with word-game-specific messages:
1. "Take your time! I'm here whenever you're ready with your word."
2. "No rush! Would you like me to repeat the current letter?"
3. "Still thinking? That's okay! Word games take time. Let me know when you're ready."
