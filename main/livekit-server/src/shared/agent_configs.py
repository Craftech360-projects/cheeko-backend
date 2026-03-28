"""
Agent configurations for multi-agent system
Maps character names to agent worker names and their configurations
"""

# Agent configurations for each character/game mode
AGENT_CONFIGS = {
    "Cheeko": {
        "agent_name": "cheeko-agent",
        "prompt_file": None,  # Uses database prompt
        "tools": [],
        "features": ["battery", "volume", "mode_switching", "music"],
        "game_state_class": None,
        "port": 8081,
    },
    "Math Tutor": {
        "agent_name": "math-tutor-agent",
        "prompt_file": "src/prompts/math_tutor.yaml",
        "tools": ["check_math_answer"],
        "features": ["battery", "volume"],
        "game_state_class": "MathGameState",
        "port": 8082,
    },
    "Riddle Solver": {
        "agent_name": "riddle-solver-agent",
        "prompt_file": "src/prompts/riddle_solver.yaml",
        "tools": ["check_riddle_answer"],
        "features": ["battery", "volume"],
        "game_state_class": "RiddleGameState",
        "port": 8085,
    },
    "Word Ladder": {
        "agent_name": "word-ladder-agent",
        "prompt_file": "src/prompts/word_ladder.yaml",
        "tools": ["validate_word_ladder_move"],
        "features": ["battery", "volume"],
        "game_state_class": "WordLadderGameState",
        "port": 8086,
    },
    "Cheeko Magic": {
        "agent_name": "cheeko-magic-agent",
        "prompt_file": None,  # Uses database prompt
        "tools": [],
        "features": ["mode_switching"],
        "game_state_class": None,
        "port": 8087,
    },
    "Cheeko Astronaut": {
        "agent_name": "cheeko-astronaut-agent",
        "prompt_file": None,  # Uses database prompt
        "tools": [],
        "features": ["mode_switching"],
        "game_state_class": None,
        "port": 8088,
    },
    "Cheeko German": {
        "agent_name": "cheeko-german-agent",
        "prompt_file": None,  # Uses database prompt
        "tools": [],
        "features": ["mode_switching"],
        "game_state_class": None,
        "port": 8089,
    },
}

# Reverse mapping: agent_name -> character_name
AGENT_TO_CHARACTER = {v["agent_name"]: k for k, v in AGENT_CONFIGS.items()}

# Character name to agent name mapping (for MQTT gateway)
CHARACTER_TO_AGENT = {k: v["agent_name"] for k, v in AGENT_CONFIGS.items()}

# Game prompt file mapping
GAME_PROMPT_FILES = {
    "Math Tutor": "math_tutor.yaml",
    "Riddle Solver": "riddle_solver.yaml",
    "Word Ladder": "word_ladder.yaml",
}


def get_config_by_agent_name(agent_name: str) -> dict:
    """Get configuration by agent name"""
    character = AGENT_TO_CHARACTER.get(agent_name)
    if character:
        return AGENT_CONFIGS[character]
    return AGENT_CONFIGS["Cheeko"]  # Default


def get_agent_name_for_character(character: str) -> str:
    """Get agent name for a character"""
    return CHARACTER_TO_AGENT.get(character, "cheeko-agent")


def is_game_mode(character: str) -> bool:
    """Check if character is a game mode"""
    return character in ["Math Tutor", "Riddle Solver", "Word Ladder"]
