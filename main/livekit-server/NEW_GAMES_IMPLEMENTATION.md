# New Games Implementation Plan

## Overview
Add 3 new educational games to Cheeko's game system following the existing architecture pattern.

---

## New Games

### 1. Professor Quest (Science & Nature)

**Concept:** "The Mystery Specimen" - An eccentric explorer professor who has "discovered" something and needs the child's help to identify it.

**Gameplay:**
- Professor describes a mystery animal, planet, or plant through its traits
- Example: "I found a creature that breathes through its skin and has a long, sticky tongue!"
- Child guesses based on clues

**Educational Value:**
- Classification skills
- Biology basics
- Scientific observation

**Win Condition:** 5 correct guesses in a row

**Age Adaptation:**
| Age | Content Examples |
|-----|-----------------|
| 3-5 | Dog, Elephant, Butterfly, Sun, Moon |
| 6-8 | Frog, Volcano, Rain, Whale, Cactus |
| 9-12 | Photosynthesis, Gravity, Atoms, Ecosystems |

---

### 2. Guess the Object

**Concept:** Cheeko describes everyday objects through cryptic properties.

**Gameplay:**
- "I have keys but no lock..."
- "I fly but I'm not a bird..."
- Child uses inference to guess the object

**Educational Value:**
- Listening skills
- Inference abilities
- Vocabulary building

**Win Condition:** 5 correct guesses in a row

**Age Adaptation:**
| Age | Content Examples |
|-----|-----------------|
| 3-5 | Ball, Cup, Spoon, Book, Toy |
| 6-8 | Mirror, Clock, Umbrella, Phone, Scissors |
| 9-12 | Shadow, Echo, Music, Time, Memory |

---

### 3. Shape Sorter

**Concept:** Interactive geometry companion for learning shapes, sizes, and spatial concepts.

**Gameplay (Progressive Challenges):**
1. **Shape Identification:** "What shape is this?" (circle, square, triangle)
2. **Property Questions:** "How many sides does a square have?"
3. **Comparison:** "Which shape has more corners - triangle or square?"
4. **Spatial Reasoning:** "What shape has no corners at all?"

**Educational Value:**
- Shape recognition
- Counting (sides, corners)
- Comparison skills
- Spatial reasoning

**Win Condition:** 7 correct in a row (more for geometry depth)

**Age Adaptation:**
| Age | Focus |
|-----|-------|
| 3-5 | Basic shapes: circle, square, triangle |
| 6-8 | Add rectangle, oval, star, diamond; counting sides |
| 9-12 | Pentagon, hexagon, 3D concepts, area comparison |

---

## Technical Implementation

### Files to Create

```
main/livekit-server/src/games/
├── professor_quest_game.py    # Game state class
├── guess_object_game.py       # Game state class
└── shape_sorter_game.py       # Game state class

main/livekit-server/src/prompts/
├── professor_quest.yaml       # Prompt template
├── guess_object.yaml          # Prompt template
└── shape_sorter.yaml          # Prompt template
```

### Files to Modify

| File | Changes |
|------|---------|
| `main.py` | Add to `_GAME_PROMPT_FILES`, update game detection, add tool imports |
| `game_tools.py` | Add 3 new `@function_tool` validators + state setters |
| `assistant.py` | Add 3 new `enable_*_game()` methods |

---

## Game State Class Template

Each game follows this pattern (based on `riddle_game.py`):

```python
class NewGameState:
    def __init__(self):
        self.reset()

    def reset(self):
        self.item_bank = []           # Questions/specimens/objects
        self.current_index = 0
        self.current_attempts = 0
        self.max_attempts = 2
        self.streak = 0
        self.total_answered = 0

    def load_item_bank(self, items: list):
        # Load pre-generated content

    def get_current_item(self) -> dict:
        # Get current question

    def validate_answer(self, user_answer: str) -> dict:
        # Check answer, update streak/attempts
        # Returns: {correct, retry, move_next, streak, game_complete}

    def needs_new_bank(self) -> bool:
        # Check if need more content

    def is_game_complete(self) -> bool:
        # Check win condition (streak >= target)
```

---

## Function Tool Template

Each game needs a validation tool:

```python
@function_tool
async def check_game_answer(context: RunContext, user_answer: str, expected_answer: str) -> str:
    """
    Validate user's answer against expected answer.

    Args:
        user_answer: The child's spoken answer
        expected_answer: The correct answer

    Returns:
        JSON string with: correct, retry, move_next, streak, game_complete, message
    """
    # Normalize answers
    # Compare (exact or fuzzy match)
    # Update game state
    # Return result JSON
```

---

## Prompt YAML Template

Each game needs a persona prompt:

```yaml
prompt: |
  <identity>
  {% if child_name %}
  Child Profile:
  - Name: {{ child_name }}
  {% if child_age %}- Age: {{ child_age }} years old{% endif %}
  {% if child_interests %}- Interests: {{ child_interests }}{% endif %}
  {% endif %}
  </identity>

  <System>
  You are CHEEKO — the "[Persona Name]."
  **STRICT DIRECTIVE:** Stay in character.

  <strict_game_guardrails>
  # Block off-topic questions
  </strict_game_guardrails>

  **VOICE & DIALECT SPECIFICATIONS:**
  - Indian English accent
  - Speak slowly for comprehension
  - Use Indian vocabulary

  STEP 1: [GAME START]
  STEP 2: [PRESENT CHALLENGE]
  STEP 3: [HINT SYSTEM]
  STEP 4: [VICTORY CELEBRATION]
  STEP 5: ALWAYS call [tool_name]()
  </System>

  <GameRules>
  # Win/lose conditions
  # Retry rules
  </GameRules>

  <InitialGreeting>
  # Opening line
  </InitialGreeting>
```

---

## main.py Changes

### 1. Update Game Prompt Mapping (line ~62)

```python
_GAME_PROMPT_FILES = {
    "Math Tutor": "math_tutor.yaml",
    "Riddle Solver": "riddle_solver.yaml",
    "Word Ladder": "word_ladder.yaml",
    # NEW GAMES
    "Professor Quest": "professor_quest.yaml",
    "Guess the Object": "guess_object.yaml",
    "Shape Sorter": "shape_sorter.yaml"
}
```

### 2. Update Game Detection (line ~433)

```python
if active_game in ["Math Tutor", "Riddle Solver", "Word Ladder",
                   "Professor Quest", "Guess the Object", "Shape Sorter"]:
    # Import tools
    from src.features.game_tools import (
        # ... existing imports ...
        check_professor_quest_answer,
        check_guess_object_answer,
        validate_shape_answer,
        set_professor_quest_state,
        set_guess_object_state,
        set_shape_sorter_state
    )

    # Prepare tools based on game
    if active_game == "Professor Quest":
        game_tools_list = [check_professor_quest_answer]
    elif active_game == "Guess the Object":
        game_tools_list = [check_guess_object_answer]
    elif active_game == "Shape Sorter":
        game_tools_list = [validate_shape_answer]
```

### 3. Update State Initialization (line ~601)

```python
if active_game == "Professor Quest":
    assistant.enable_professor_quest_game()
    set_professor_quest_state(assistant.professor_quest_state)
elif active_game == "Guess the Object":
    assistant.enable_guess_object_game()
    set_guess_object_state(assistant.guess_object_state)
elif active_game == "Shape Sorter":
    assistant.enable_shape_sorter_game()
    set_shape_sorter_state(assistant.shape_sorter_state)
```

---

## Implementation Checklist

- [ ] Create `professor_quest_game.py`
- [ ] Create `guess_object_game.py`
- [ ] Create `shape_sorter_game.py`
- [ ] Create `professor_quest.yaml`
- [ ] Create `guess_object.yaml`
- [ ] Create `shape_sorter.yaml`
- [ ] Add tools to `game_tools.py`
- [ ] Add enable methods to `assistant.py`
- [ ] Update `main.py` prompt mapping
- [ ] Update `main.py` game detection
- [ ] Update `main.py` state initialization
- [ ] Test each game end-to-end

---

## Questions for Review

1. Should Professor Quest support different categories (Animals only? Plants only? Mix)?
2. For Shape Sorter, should it include 3D shapes for older kids (cube, sphere, pyramid)?
3. Do we need content generation services (like `question_generator_service.py`) for these games?
