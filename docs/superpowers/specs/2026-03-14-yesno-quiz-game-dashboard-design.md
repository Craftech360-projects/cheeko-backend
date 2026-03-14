# Yes/No Quiz Agent + Game Dashboard — Design Spec

**Date:** 2026-03-14
**Status:** Approved
**Approach:** Clone & Adapt (from math game pattern)

---

## Overview

Two deliverables:

1. **Yes/No Quiz Agent** — A new LiveKit game agent that generates fun-fact yes/no questions via LLM, with stars+lives progression and verbal hints.
2. **Game Dashboard** — A pre-connection React UI that lets the child pick which game to play before connecting to LiveKit.

Target audience: Children ages 3-16, using the Cheeko AI companion (same as math game).

---

## Architecture

### Dispatch Flow

```
React App loads → GameDashboard shows (no LiveKit connection yet)
    ↓
Child taps a game card (e.g., "Fun Facts")
    ↓
app.tsx sets agentName = "yesno-quiz-agent"
    ↓
/api/token generates JWT with RoomConfiguration.agents[0].agent_name = "yesno-quiz-agent"
    ↓
LiveKit Cloud routes to yesno_quiz_worker.py (registered with agent_name="yesno-quiz-agent")
    ↓
YesNoQuizHUD activates based on data channel messages (type: "yesno_question")
```

### Key Decision: Pre-Connection Dashboard

The dashboard renders BEFORE any LiveKit connection. The child picks a game, then the app connects with the correct agent_name baked into the JWT. This avoids mid-session agent switching complexity.

---

## Part 1: Backend — Yes/No Quiz Agent

### New Files (under `main/livekit-server/`)

| File | Purpose |
|------|---------|
| `workers/yesno_quiz_worker.py` | Worker entrypoint (mirrors math_game_worker.py) |
| `src/games/yesno_quiz_engine.py` | Game loop: generate Q → wait for answer → score → next |
| `src/games/yesno_quiz_question_generator.py` | LLM generates age-appropriate fun-fact yes/no questions |
| `src/games/yesno_quiz_hints.py` | Verbal hint manager (LLM clue after timeout) |
| `src/games/yesno_quiz_state.py` | Game state (stars, lives, current question, streak) |

### Reused Modules (no changes needed)

- `src/games/math_game_data_channel.py` — DataChannel class (event emitter for room data)
- `src/games/math_game_narrator.py` — Narrator class (speaks via agent session)
- `src/games/math_game_pipeline.py` — STT/LLM/TTS pipeline creation

### Worker Configuration

- **Agent name:** `yesno-quiz-agent`
- **Port:** `8088`
- **Character name:** `Fact Finder` (or reuse `Cheeko`)
- **LLM provider:** Same as math game (OpenRouter, configurable via env)

### Game State (`yesno_quiz_state.py`)

Same structure as `MathGameState`:

```python
class YesNoQuizState:
    game_mode: str          # "explorer" | "commander"
    stars: int              # collected stars (target: 5 per level)
    total_needed: int       # 5
    lives: int | None       # commander mode only (start: 3)
    max_lives: int | None   # 3
    level: int              # current level
    mission_number: int     # current mission
    current_question_id: str
    current_question: dict  # { question, correct_answer, fun_fact, category }
    consecutive_correct: int
    questions_asked: int
```

### Question Generator (`yesno_quiz_question_generator.py`)

Uses LLM (via OpenRouter) to generate questions dynamically.

**Prompt pattern:**
```
You are generating fun yes/no trivia questions for a {age}-year-old child.

Generate a question about {topic}. The question must be answerable with YES or NO.

Rules:
- Use simple, age-appropriate language
- Make it fun and educational
- Include a short fun fact to reveal after answering
- Vary difficulty based on age: ages 3-5 very simple, ages 6-9 moderate, ages 10+ challenging

Return JSON only:
{
  "question": "Do penguins live in the North Pole?",
  "correct_answer": false,
  "fun_fact": "Penguins live in the South Pole! They love cold weather but only in Antarctica.",
  "category": "animals"
}
```

**Topic rotation:** Cycle through categories: animals, science, geography, food, space, nature, human body, history. Track used categories to avoid repetition within a level.

### Hint Manager (`yesno_quiz_hints.py`)

Unlike math game (which eliminates wrong options), yes/no quiz uses verbal hints since eliminating 1 of 2 options would give away the answer.

**Flow:**
1. Question displayed, timer starts
2. After 10s with no answer → HintManager triggers
3. LLM generates a verbal clue based on the question and correct answer
4. Narrator speaks the clue
5. After 20s total with no answer → timeout, mark wrong, move to next

**Hint prompt:**
```
The child was asked: "{question}"
The correct answer is: {yes/no}
Give a short, fun hint (1 sentence) that helps without directly saying the answer.
```

### LLM Tool

```python
@function_tool
async def check_yesno_answer(answer: str) -> str:
    """Check if the child's yes/no answer is correct.

    Args:
        answer: The child's answer - "yes" or "no"
    """
    # Normalize: "yeah", "yep", "sure" → "yes"; "nah", "nope" → "no"
    # Compare against game_state.current_question["correct_answer"]
    # Return JSON result
```

### Game Engine (`yesno_quiz_engine.py`)

**Game loop (mirrors math game engine):**

1. `on_game_start(child_name, age, game_mode)` — Narrator greets, generates first question
2. `on_question_generated(question)` — Sends `yesno_question` via data channel, narrator reads it
3. `on_tap_answer(message)` — Called when child taps YES/NO button
4. `on_voice_answer(result)` — Called when LLM tool processes voice input
5. `_process_answer(answer, input_method)` — Score, send result, reveal fun fact, advance
6. `on_hint_triggered(question_id)` — Generate and speak verbal hint
7. `_next_question()` — Generate next question or end level/game

**Scoring:**
- Correct answer → +1 star
- Wrong answer → -1 life (commander mode only), no effect in explorer mode
- 3+ consecutive correct → bonus star
- 5 stars → level complete
- 0 lives → game over (commander mode)

### Worker Entrypoint (`yesno_quiz_worker.py`)

Mirrors `math_game_worker.py` structure:

1. `prewarm()` — Load YAML config, TTS config, DB helper
2. `entrypoint(ctx)` — Parse room name, load child profile, create pipeline, wire modules
3. Register data channel handlers: `yesno_answer`, `game_control`, `ready_for_greeting`, `end_prompt`, `shutdown_request`
4. Register `function_tools_executed` event for voice answer processing
5. Connect, start session, publish initial state

### PM2 Config Addition

```js
// In ecosystem.config.js
{
  name: "yesno-quiz-agent",
  script: "python",
  args: "workers/yesno_quiz_worker.py dev",
  cwd: "./main/livekit-server",
  env: {
    PORT: 8088,
    YESNO_LLM_PROVIDER: "openrouter",
    YESNO_LLM_MODEL: "openai/gpt-4o-mini",
  }
}
```

---

## Part 2: Data Channel Protocol

### Agent → Frontend Messages

#### `yesno_question` — New question

```typescript
{
  type: "yesno_question",
  question_id: string,          // UUID
  question_text: string,        // "Do fish live in water?"
  category: string,             // "animals"
  game_mode: "explorer" | "commander",
  progress: GameProgress,
}
```

#### `yesno_result` — Answer feedback

```typescript
{
  type: "yesno_result",
  question_id: string,
  correct: boolean,
  user_answer: "yes" | "no" | null,  // null on timeout
  correct_answer: boolean,            // true = yes, false = no
  fun_fact: string,                   // "Fish breathe using gills!"
  input_method: "tap" | "voice" | "timeout",
  progress: GameProgress,
  game_complete: boolean,
  game_over: boolean,
  consecutive_correct: number,
  bonus_star: boolean,
}
```

#### `yesno_hint` — Verbal hint

```typescript
{
  type: "yesno_hint",
  question_id: string,
  hint_text: string,            // "Think about what lives underwater..."
}
```

#### `game_state` — Lifecycle (reused)

```typescript
{
  type: "game_state",
  state: "started" | "completed" | "game_over" | "restarted",
  game_mode: "explorer" | "commander",
  progress: GameProgress,
}
```

#### `child_profile` — Player info (reused)

```typescript
{
  type: "child_profile",
  name: string,
  age: number | null,
  gender: string,
  language: string,
  game_mode: "explorer" | "commander",
}
```

### Frontend → Agent Messages

#### `yesno_answer` — Child's answer

```typescript
{
  type: "yesno_answer",
  question_id: string,
  value: "yes" | "no",
  input_method: "tap",
}
```

#### `game_control` — Game commands (reused)

```typescript
{
  type: "game_control",
  action: "restart" | "next_level",
}
```

### Shared Types

```typescript
interface GameProgress {
  stars: number;
  total_needed: number;       // 5
  lives: number | null;       // commander mode
  max_lives: number | null;   // 3
  mission_number: number;
  level: number;
}
```

---

## Part 3: Frontend — Yes/No Quiz HUD

### New Files (under `D:\agent-starter-react\`)

| File | Purpose |
|------|---------|
| `components/yesno-quiz/YesNoQuizHUD.tsx` | Main game overlay |
| `components/yesno-quiz/YesNoButtons.tsx` | Two large YES/NO panels |
| `components/yesno-quiz/QuestionBubble.tsx` | Question text with category badge |
| `components/yesno-quiz/FunFactToast.tsx` | Fun fact reveal after answer |
| `hooks/yesno-quiz/use-yesno-quiz.ts` | State management hook |
| `lib/yesno-quiz/types.ts` | TypeScript interfaces |
| `lib/yesno-quiz/sfx.ts` | Sound effects (Web Audio API) |

### Reused Components (from math game)

- `StarProgress` — Star collection progress bar
- `LivesDisplay` — Heart lives visualization
- `GameOverlay` — Level complete / game over screens

### Component Hierarchy

```
AgentSessionView_01
├── MathGameHUD          (activates on "math_question" messages)
├── YesNoQuizHUD         (activates on "yesno_question" messages)
│   ├── StarProgress     (reused)
│   ├── LivesDisplay     (reused)
│   ├── QuestionBubble
│   ├── YesNoButtons
│   ├── FunFactToast
│   └── GameOverlay      (reused)
```

### Layout

```
┌──────────────────────────────────┐
│ [Mode] [Level]  [♥♥♡] [★★★☆☆]  │  ← Top bar
├──────────────────────────────────┤
│                                  │
│    ┌──────────────────────┐      │
│    │  🐠 Animals          │      │  ← Category badge
│    │                      │      │
│    │  Do fish live in     │      │  ← Question text
│    │  water?              │      │
│    └──────────────────────┘      │
│                                  │
│   ┌──────────┐  ┌──────────┐    │
│   │    ✅    │  │    ❌    │    │  ← YES / NO buttons
│   │   YES    │  │    NO    │    │     Large touch targets (min 44x44px)
│   │          │  │          │    │
│   └──────────┘  └──────────┘    │
│                                  │
│   ┌──────────────────────┐      │
│   │ 🐟 Fish breathe      │      │  ← Fun fact toast (appears after answer)
│   │ using gills!          │      │
│   └──────────────────────┘      │
│                                  │
│   [Progress ████░░░░] 3/5 ★     │
│   "Tap YES or NO, or say it!"   │
└──────────────────────────────────┘
```

### State Hook (`use-yesno-quiz.ts`)

```typescript
interface YesNoQuizHookState {
  gameActive: boolean;
  gameMode: GameMode;
  currentQuestion: YesNoQuestionMessage | null;
  progress: GameProgress;
  feedback: YesNoResultMessage | null;
  funFact: string | null;
  consecutiveCorrect: number;
  gameComplete: boolean;
  gameOver: boolean;
  showingResult: boolean;
  agentSpeaking: boolean;
  childProfile: ChildProfile | null;
  sendAnswer: (value: "yes" | "no") => void;
}
```

**Message routing:** Listens on `RoomEvent.DataReceived`, routes by `message.type`:
- `"yesno_question"` → `handleQuestion`
- `"yesno_result"` → `handleResult` (includes fun_fact display)
- `"yesno_hint"` → `handleHint`
- `"game_state"` → `handleGameState`
- `"child_profile"` → `handleProfile`

### YesNoButtons Component

Two large buttons side by side:

```typescript
// Button states:
// Normal:   bg-[#161b22] border-[#30363d]
// Selected: ring-2 ring-blue-400
// Correct:  bg-[#238636] animate-correct-bounce
// Wrong:    bg-[#da3633] animate-shake
// Disabled: opacity-50

// YES button: green accent (#238636)
// NO button:  red accent (#da3633)
```

Touch targets: minimum 120x100px each (well above 44x44px minimum).

### FunFactToast Component

Slides up from bottom after answer result, displays for 3 seconds:
- Shows fun fact text with category emoji
- Light background, rounded corners
- Auto-dismisses before next question

### Sound Effects (`sfx.ts`)

Same Web Audio API pattern as math game:

```typescript
playCorrectSfx()    // Rising chime (reuse from math game)
playWrongSfx()      // Low buzz (reuse from math game)
playCompleteSfx()   // Ascending fanfare (reuse from math game)
playGameOverSfx()   // Descending tones (reuse from math game)
playFactRevealSfx() // NEW: gentle "ding" for fun fact reveal
```

### Timing Constants

```typescript
const RESULT_DISPLAY_MS = 2000;     // Show correct/wrong + fun fact
const FUN_FACT_DISPLAY_MS = 3000;   // Fun fact toast duration
const TAP_COOLDOWN_MS = 500;        // Debounce between taps
const GAME_END_OVERLAY_MS = 4000;   // Level complete / game over overlay
```

### Animations

Reuse existing from `globals.css`:
- `animate-correct-bounce` — correct answer
- `animate-shake` — wrong answer
- `animate-star-pop` — new star earned
- `animate-confetti` — level complete

New:
- `animate-slide-up` — fun fact toast entrance
- `animate-fade-out` — fun fact toast exit

---

## Part 4: Game Dashboard

### New Files (under `D:\agent-starter-react\`)

| File | Purpose |
|------|---------|
| `components/game-dashboard/GameDashboard.tsx` | Pre-connection game picker screen |
| `components/game-dashboard/GameCard.tsx` | Individual game card component |
| `lib/game-dashboard/games.ts` | Game registry (name, icon, agent_name, description) |

### Game Registry (`games.ts`)

```typescript
export interface GameDefinition {
  id: string;
  name: string;
  icon: string;
  agent_name: string;
  description: string;
  color: string;
  minAge?: number;
}

export const GAMES: GameDefinition[] = [
  {
    id: "math_quiz",
    name: "Math Quest",
    icon: "🧮",
    agent_name: "math-game-agent",
    description: "Solve math puzzles!",
    color: "#238636",
  },
  {
    id: "yesno_quiz",
    name: "Fun Facts",
    icon: "🤔",
    agent_name: "yesno-quiz-agent",
    description: "True or false?",
    color: "#1f6feb",
  },
  {
    id: "riddles",
    name: "Riddles",
    icon: "🔮",
    agent_name: "riddle-solver-agent",
    description: "Can you solve it?",
    color: "#8b5cf6",
  },
  {
    id: "word_ladder",
    name: "Word Ladder",
    icon: "🔤",
    agent_name: "word-ladder-agent",
    description: "Build words!",
    color: "#f59e0b",
  },
];
```

### Dashboard Layout

```
┌──────────────────────────────────┐
│                                  │
│        🎮 Pick a Game!           │
│        Hi, {childName}!          │
│                                  │
│   ┌────────────┐ ┌────────────┐ │
│   │    🧮      │ │    🤔      │ │
│   │  Math      │ │   Fun      │ │
│   │  Quest     │ │  Facts     │ │
│   │ "Solve     │ │ "True or   │ │
│   │  math      │ │  false?"   │ │
│   │  puzzles!" │ │            │ │
│   └────────────┘ └────────────┘ │
│                                  │
│   ┌────────────┐ ┌────────────┐ │
│   │    🔮      │ │    🔤      │ │
│   │  Riddles   │ │   Word     │ │
│   │            │ │  Ladder    │ │
│   │ "Can you   │ │ "Build     │ │
│   │  solve it?"│ │  words!"   │ │
│   └────────────┘ └────────────┘ │
│                                  │
└──────────────────────────────────┘
```

### GameCard Component

```typescript
// Rounded card with colored border-left accent
// Hover: scale(1.03) + shadow increase
// Tap: scale(0.97) feedback
// Each card shows: icon (large), name, description
// Min touch target: 120x120px
```

### Integration with app.tsx

**Current flow:**
```
app.tsx → reads AGENT_NAME from env → connects immediately
```

**New flow:**
```
app.tsx → shows GameDashboard → child picks game → sets agentName state → connects
```

**Changes to `app.tsx`:**
```typescript
// New state
const [selectedGame, setSelectedGame] = useState<string | null>(null);

// If no game selected, show dashboard
if (!selectedGame) {
  return <GameDashboard onSelectGame={(agentName) => setSelectedGame(agentName)} />;
}

// Otherwise, connect with selected agent
// Pass selectedGame as agentName to useSession() and roomConfig
```

**Changes to `agent-session-block.tsx`:**
```typescript
// Add YesNoQuizHUD alongside MathGameHUD
<MathGameHUD />
<YesNoQuizHUD />
// Each self-activates based on data channel message types
// Only one will be active at a time
```

**Changes to `app-config.ts`:**
- `AGENT_NAME` env var becomes a fallback/default
- Primary source is the dashboard selection

---

## Part 5: Game Design Evaluation

### 5-Component Filter

| Component | Rating | Evidence |
|-----------|--------|----------|
| **Clarity** | Strong | Binary choice (Yes/No) is maximally clear. Large labeled buttons with checkmark/cross icons. |
| **Motivation** | Strong | Fun facts revealed after each answer create "I learned something!" moments. Stars + streak for progression. |
| **Response** | Strong | Immediate visual + audio feedback on tap. Voice input supported. Buttons disabled during processing. |
| **Satisfaction** | Strong | Correct = green bounce + chime + fun fact reveal. Streak combos. Level celebrations with confetti. |
| **Fit** | Strong | Matches Cheeko's educational companion identity. Age-appropriate content via LLM. |

### Risk: 50/50 Guessing

With only 2 options, random guessing has 50% success rate.

**Mitigations:**
- Require 5 stars per level (sustained guessing unlikely: 0.5^5 = 3.1%)
- Commander mode has 3 lives (wrong guesses cost lives)
- Fun facts after each answer reward engagement over speed
- Verbal hints after timeout encourage thinking over guessing

### State Machine

```
IDLE → QUESTION_DISPLAYED → WAITING_FOR_ANSWER
    ↓                            ↓              ↓
    └── on_game_start      on_tap_answer   HINT_SPOKEN (10s timeout)
                            on_voice_answer     ↓
                                ↓           WAITING_FOR_ANSWER (continue)
                           SHOWING_RESULT       ↓
                                ↓           TIMEOUT (20s) → SHOWING_RESULT
                           FUN_FACT_DISPLAYED
                                ↓
                    ┌── QUESTION_DISPLAYED (next Q)
                    ├── LEVEL_COMPLETE (5 stars)
                    └── GAME_OVER (0 lives)
```

### Timing Values (Starting Values)

| Parameter | Value | Test Plan |
|-----------|-------|-----------|
| Hint timeout | 10s | If >30% of questions get hints, reduce to 8s. If <5%, increase to 12s. |
| Answer timeout | 20s | If >20% timeout, increase to 25s. If <5%, reduce to 15s. |
| Result display | 2s | Must be long enough to read fun fact. If users report "too slow", reduce to 1.5s. |
| Fun fact display | 3s | Overlaps with narrator reading the fact. Auto-dismiss. |
| Stars per level | 5 | Keeps levels short (~2-3 min). If sessions feel too short, increase to 7. |
| Lives (commander) | 3 | Standard. If too punishing for 7-9 year olds, increase to 4. |

---

## Part 6: Files Changed Summary

### New Files

**Backend (D:\cheeko-backend\main\livekit-server\):**
- `workers/yesno_quiz_worker.py`
- `src/games/yesno_quiz_engine.py`
- `src/games/yesno_quiz_question_generator.py`
- `src/games/yesno_quiz_hints.py`
- `src/games/yesno_quiz_state.py`
- `src/features/yesno_game_tools.py`

**Frontend (D:\agent-starter-react\):**
- `components/yesno-quiz/YesNoQuizHUD.tsx`
- `components/yesno-quiz/YesNoButtons.tsx`
- `components/yesno-quiz/QuestionBubble.tsx`
- `components/yesno-quiz/FunFactToast.tsx`
- `hooks/yesno-quiz/use-yesno-quiz.ts`
- `lib/yesno-quiz/types.ts`
- `lib/yesno-quiz/sfx.ts`
- `components/game-dashboard/GameDashboard.tsx`
- `components/game-dashboard/GameCard.tsx`
- `lib/game-dashboard/games.ts`

### Modified Files

**Backend:**
- `ecosystem.config.js` — Add yesno-quiz-agent PM2 process

**Frontend:**
- `components/app/app.tsx` — Add game selection state, show dashboard before connecting
- `components/agents-ui/blocks/agent-session-view-01/components/agent-session-block.tsx` — Add `<YesNoQuizHUD />` overlay
- `app-config.ts` — Make AGENT_NAME dynamic (fallback only)
- `styles/globals.css` — Add `animate-slide-up` and `animate-fade-out` keyframes
