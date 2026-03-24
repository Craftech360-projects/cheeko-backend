---
id: function-tools
sidebar_position: 4
---

# AI Function Tools

These are the LLM-callable functions registered with the LiveKit agent session. When the AI decides to perform an action — play music, change volume, check a math answer, switch modes — it invokes one of these tools. The tools are defined under `main/livekit-server/src/features/` and loaded into the agent at session startup using a lazy-loading pattern implemented in `src/agent/assistant.py`.

---

## Tool Categories

### Music Tools (`music_tools.py`)

Handles music search, playback, and playlist management via the `MusicService` and `UnifiedAudioPlayer`. Signals are also published to the device over a LiveKit data channel on topic `music_control`.

| Function | Signature | What it does | Return value |
|---|---|---|---|
| `play_music` | `(context, song_name=None, language=None)` | Searches for a specific song by name, or falls back to the favorites playlist, or plays a random song. Streams audio via `UnifiedAudioPlayer`. | Empty string (suppresses agent speech) or error message |
| `stop_music` | `(context)` | Stops current playback and disables auto-loop. Publishes `music_playback_stopped` to the data channel. | `"Music stopped"` or `"No music is currently playing"` |
| `next_song` | `(context)` | Advances to the next song in the favorites playlist (wraps around), or picks a new random song. Publishes `music_next` to the data channel. | `"Playing next: {title}"` or error message |
| `previous_song` | `(context)` | Goes to the previous song in the favorites playlist (wraps around). Only works in favorites playlist mode; returns an error in random mode. | `"Playing previous: {title}"` or `"Previous song not available in random mode"` |

**Playlist modes:**

- `"favorites"` — ordered playlist fetched from the backend; loops on completion
- `"search"` — result of a specific song name query
- `"random"` — a single song chosen randomly from the library

**Music Mode auto-play:** When the device connects with room type `"music"`, `start_music_mode()` is called automatically. It enables `audio_player.auto_loop_enabled = True` so songs play back-to-back without any user prompt.

---

### Volume and Light Tools (`volume_tools.py`)

Controls device volume and LED lighting via the `mcp_executor` (MCP protocol bridge to the ESP32).

| Function | Signature | What it does | Return value |
|---|---|---|---|
| `self_set_volume` | `(context, volume: int)` | Sets device volume to a specific level (0–100). | Status message from MCP executor |
| `self_get_volume` | `(context, unused="")` | Reads the current volume level from the device. | Current volume message from MCP executor |
| `self_volume_up` | `(context, unused="")` | Increases device volume by one step. | Status message from MCP executor |
| `self_volume_down` | `(context, unused="")` | Decreases device volume by one step. | Status message from MCP executor |
| `self_mute` | `(context, unused="")` | Mutes the device. | Status message from MCP executor |
| `self_unmute` | `(context, unused="")` | Unmutes the device. | Status message from MCP executor |
| `set_light_color` | `(context, color: str)` | Sets the LED color by name (e.g., `"red"`, `"blue"`, `"rainbow"`). | Status message from MCP executor |
| `set_light_mode` | `(context, mode: str)` | Sets the LED mode: `"rainbow"`, `"default"`, or `"custom"`. | Status message from MCP executor |
| `set_rainbow_speed` | `(context, speed_ms: str)` | Sets the rainbow animation speed in milliseconds (valid range: 50–1000). | Status message from MCP executor |

All volume and light tools delegate to `assistant.mcp_executor` after calling `set_context(context)` to attach the active LiveKit `RunContext`.

---

### Battery Tools (`battery_tools.py`)

| Function | Signature | What it does | Return value |
|---|---|---|---|
| `check_battery_level` | `(context)` | Retrieves real-time battery percentage and charging state from the device via `mcp_executor.get_battery_status()`. | Human-readable string, e.g., `"Battery is at 85% and charging"` or `"Battery is at 42% (not charging)"` |

---

### Mode Switching (`mode_switching.py`)

Switches the active agent worker by sending a `character-change` message over the LiveKit data channel to the MQTT gateway. The gateway tears down the current session and connects the device to a new agent worker.

| Function | Signature | What it does | Return value |
|---|---|---|---|
| `update_agent_mode` | `(context, mode_name: str)` | Normalizes the requested mode name, then publishes `{"type": "character-change", "characterName": "..."}` over the data channel with `reliable=True`. | `"Switching to {name}! See you soon!"` |

**CHARACTER_ALIASES mapping** (defined in `mode_switching.py`):

| Canonical name | Recognized aliases |
|---|---|
| `Cheeko` | chiko, chico, cheeko, cheek o, default, default mode, normal, normal mode, regular |
| `Math Tutor` | math tutor, math, maths, math mode, tutor, math teacher, mathematics |
| `Riddle Solver` | riddle solver, riddle, riddles, riddle mode, riddle game, puzzle, puzzles |
| `Word Ladder` | word ladder, word game, word, words, ladder, word ladder game |

**Normalization logic:** `normalize_character_name()` lowercases the input, strips whitespace, replaces hyphens and underscores with spaces, then tries an exact match, alias match, and finally a substring/partial match before passing the input through unchanged.

**MODE_ALIASES in `main_agent.py`** (used by the main Cheeko agent's own `update_agent_mode` method, which writes back to the manager API instead of the gateway):

| Canonical name | Recognized aliases |
|---|---|
| `Cheeko` | chiko, chico, cheeko, cheek o, default, default mode, normal mode |
| `Story` | story, story mode, story time, storytelling, storyteller, tell stories, tell story, story teller |
| `Music` | music, music mode, musician, music time, sing, singing, song, songs |
| `Tutor` | tutor, tutor mode, teacher, teach, teaching, study, study mode, learning, learn |
| `Chat` | chat, chat mode, talk, conversation, friend, buddy, chatting |

---

### Game Tools (`game_tools.py`)

Used exclusively by the game agent workers (Math Tutor, Riddle Solver, Word Ladder). Each tool is passed to `AgentSession(tools=[...])` at session creation time in `main.py`; only one game tool is registered per session depending on the active agent.

#### `check_math_answer`

```python
async def check_math_answer(context: RunContext, user_answer: str, expected_answer: str) -> str
```

Validates a child's spoken math answer against the expected answer. Uses `_parse_number_from_text()` to convert words like `"eight"`, `"twenty-one"`, Hindi numerals (`ek`, `do`, `teen`...), and common speech-to-text errors (`"to"` → 2, `"ate"` → 8) into a float. Comparison allows a tolerance of ±0.01.

Tracks state in `_math_game_state` (streak, attempt count, max attempts). Game completes when streak reaches 5.

Return value — JSON string with fields:

| Field | Type | Meaning |
|---|---|---|
| `correct` | bool | Whether the answer was right |
| `retry` | bool | Whether the child should try again |
| `move_next` | bool | Whether to advance to the next question |
| `streak` | int | Current consecutive correct answer count |
| `game_complete` | bool | True when streak reaches 5 |
| `message` | str | Human-readable feedback |
| `correct_answer` | str | Present only when `move_next=True` and `correct=False` |

#### `check_riddle_answer`

```python
async def check_riddle_answer(context: RunContext, user_answer: str, expected_answer: str) -> str
```

Validates a child's spoken riddle answer. Strips common speech prefixes (`"it's a"`, `"I think it is"`, `"a "`, etc.) from both sides before comparing. Matching is fuzzy: exact match, expected contained in user answer, or user answer contained in expected (with a 50% length threshold to avoid false positives).

Tracks state in `_riddle_game_state`. Game completes when streak reaches 5.

Return value — same JSON schema as `check_math_answer`. When `move_next=True` and `correct=False`, a `correct_answer` field is included.

#### `validate_word_ladder_move`

```python
async def validate_word_ladder_move(context: RunContext, user_word: str) -> str
```

Validates a child's word in the Word Ladder game. Each word must start with the last letter of the previous word in the chain. Victory condition: 10 valid words chained. After 3 consecutive failures, the game restarts with a new word pair.

Return value — JSON string with fields:

| Field | Type | Meaning |
|---|---|---|
| `success` | bool | Whether the word was a valid move |
| `next_letter` | str | Letter the next word must start with |
| `expected_letter` | str | Letter the current word should have started with (on failure) |
| `game_status` | str | `"playing"`, `"victory"`, `"restart"`, or `"error"` |
| `words_used` | int | Number of words in the current chain |
| `message` | str | Human-readable feedback |
| `new_start` / `new_target` | str | Present only when `game_status="restart"` |

---

## Semantic Search (Content Discovery)

### Qdrant Semantic Search

Both `MusicService` and `StoryService` use `QdrantSemanticSearch` (from `src/services/semantic_search.py`) to find content by natural-language query. When the AI calls `play_music(song_name="something about animals")`, the flow is:

1. `play_music` calls `music_service.search_songs("something about animals")`
2. `MusicService.search_songs()` calls `semantic_search.search_music(query, language, limit=5)`
3. `QdrantSemanticSearch` encodes the query using `sentence-transformers` model `all-MiniLM-L6-v2` and queries the Qdrant cluster
4. Results are returned as `QdrantSearchResult` objects ranked by cosine similarity score
5. The top result is streamed via `UnifiedAudioPlayer.play_from_url()`

**Collections in Qdrant:**

| Collection | Content |
|---|---|
| `xiaozhi_music` | Music tracks with title, filename, language metadata |
| `xiaozhi_stories` | Story tracks with title, filename, category metadata |

**`QdrantSearchResult` dataclass fields:**

```python
@dataclass
class QdrantSearchResult:
    title: str
    filename: str
    language_or_category: str   # language for music, category for stories
    score: float                 # cosine similarity (0.0–1.0)
    metadata: Dict
    alternatives: List[str]
    romanized: str
```

**Configuration** (set via environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `QDRANT_URL` | `""` | Qdrant cluster URL |
| `QDRANT_API_KEY` | `""` | API key for the cluster |
| — | `0.5` | Minimum score threshold — results below this are discarded |
| — | `10` | Maximum raw search results fetched per query |

**Fallback behavior:**

- If `qdrant_client` or `sentence_transformers` are not installed, `QDRANT_AVAILABLE` is set to `False` and semantic search is skipped.
- `MusicService`: if Qdrant fails to initialize, the music service marks itself as unavailable and returns empty results.
- `StoryService`: if Qdrant fails to initialize, the service still marks itself initialized and operates in fallback mode (no semantic search results).

**Model caching:** `QdrantSemanticSearch` accepts `preloaded_model` and `preloaded_client` constructor arguments. When these are `None`, it pulls from a shared `model_cache` singleton (`src/utils/model_cache.py`) to avoid loading the embedding model more than once per worker process.

### URL generation

After a search result is selected, the file URL is assembled by `MusicService.get_song_url()` or `StoryService.get_story_url()`:

- **CDN path (default):** `https://{CLOUDFRONT_DOMAIN}/music/{language}/{filename}`
- **Direct S3 path:** `{S3_BASE_URL}/music/{language}/{filename}`
- Stories follow the same pattern under `stories/{category}/`

The path is percent-encoded (slashes preserved) before being appended.

---

## How Tools Are Registered

Tools are loaded lazily at session startup in `main.py` and wired into the agent via `assistant.py`. There are two registration paths:

### 1. Agent method binding (battery, volume, light, music, mode switching)

These tools are registered by calling `enable_*()` methods on the `Assistant` instance after it is created. Each method imports the relevant module, calls the module-level `inject_*_context()` function to store a reference to the assistant, then binds the decorated function directly onto the assistant instance:

```python
# example from assistant.py
def enable_battery_tools(self):
    from src.features.battery_tools import check_battery_level, inject_assistant_context
    inject_assistant_context(self)
    self.check_battery_level = check_battery_level

def enable_music_tools(self, music_service):
    from src.features.music_tools import play_music, stop_music, next_song, previous_song, inject_music_context
    inject_music_context(self, music_service)
    self.play_music = play_music
    # ...
```

Because the `Assistant` class inherits from `livekit.agents.Agent`, LiveKit's agent framework discovers all `@function_tool`-decorated attributes on the instance and exposes them to the LLM automatically.

### 2. Explicit `AgentSession(tools=[...])` (game tools only)

Game tools cannot use the instance-binding approach because they must be available to the LLM from the very first turn of the session. They are determined before session creation in `main.py`:

```python
if active_game == "Math Tutor":
    game_tools_list = [check_math_answer]
elif active_game == "Riddle Solver":
    game_tools_list = [check_riddle_answer]
elif active_game == "Word Ladder":
    game_tools_list = [validate_word_ladder_move]

session = AgentSession(llm=realtime_model, tools=game_tools_list)
```

After session creation, `set_math_game_state()`, `set_riddle_game_state()`, or `set_word_ladder_state()` are called to wire the active game state object into the corresponding tool module so the tools can track streaks and attempt counts.

### Analytics

All three game tools call `_game_analytics_manager.record_attempt()` after each evaluation. The manager is injected via `set_game_analytics_manager()` in `game_tools.py` and records `game_type`, `is_correct`, `attempt_number`, and `response_time_ms` for each interaction.
