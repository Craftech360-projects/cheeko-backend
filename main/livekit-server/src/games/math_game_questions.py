"""
Question pools for Math Commander game.
Explorer: simple addition/subtraction for ages 4-6.
Commander: harder arithmetic including multiplication for ages 7+.
"""

import random
import logging

logger = logging.getLogger("math_game_questions")

EXPLORER_QUESTIONS = [
    {"question_text": "8 - 4 = ?", "story_text": "8 parrots on a tree, 4 fly away!", "correct_answer": 4},
    {"question_text": "5 + 3 = ?", "story_text": "5 samosas on a plate, Mummy brings 3 more!", "correct_answer": 8},
    {"question_text": "10 - 6 = ?", "story_text": "10 balloons at the mela, 6 pop!", "correct_answer": 4},
    {"question_text": "3 + 4 = ?", "story_text": "3 monkeys on a wall, 4 more jump up!", "correct_answer": 7},
    {"question_text": "9 - 5 = ?", "story_text": "9 laddoos in a box, you ate 5!", "correct_answer": 4},
    {"question_text": "6 + 2 = ?", "story_text": "6 kites in the sky, 2 more fly up!", "correct_answer": 8},
    {"question_text": "7 - 3 = ?", "story_text": "7 marbles in your pocket, you gave 3 to your friend!", "correct_answer": 4},
    {"question_text": "4 + 5 = ?", "story_text": "4 parathas on a plate, Dadiji makes 5 more!", "correct_answer": 9},
    {"question_text": "11 - 7 = ?", "story_text": "11 students in class, 7 go for lunch!", "correct_answer": 4},
    {"question_text": "2 + 6 = ?", "story_text": "2 elephants at the zoo, 6 more come for bath!", "correct_answer": 8},
    {"question_text": "8 + 3 = ?", "story_text": "8 crayons in the box, teacher gives 3 more!", "correct_answer": 11},
    {"question_text": "12 - 5 = ?", "story_text": "12 mangoes on the tree, 5 fall down!", "correct_answer": 7},
    {"question_text": "6 + 6 = ?", "story_text": "6 cricketers on one team, 6 on the other!", "correct_answer": 12},
    {"question_text": "10 - 3 = ?", "story_text": "10 diyas lit for Diwali, wind blows out 3!", "correct_answer": 7},
    {"question_text": "7 + 4 = ?", "story_text": "7 auto-rickshaws at the stand, 4 more arrive!", "correct_answer": 11},
    {"question_text": "15 - 8 = ?", "story_text": "15 Holi colors, 8 already used!", "correct_answer": 7},
    {"question_text": "5 + 9 = ?", "story_text": "5 peacocks dancing, 9 more join!", "correct_answer": 14},
    {"question_text": "13 - 6 = ?", "story_text": "13 coins in the piggy bank, you took out 6!", "correct_answer": 7},
    {"question_text": "9 + 7 = ?", "story_text": "9 samosas and 7 jalebis at the sweet shop!", "correct_answer": 16},
    {"question_text": "14 - 9 = ?", "story_text": "14 friends at the birthday party, 9 go home!", "correct_answer": 5},
]

COMMANDER_QUESTIONS = [
    {"question_text": "12 + 15 = ?", "story_text": "12 runs in the first over, 15 in the second!", "correct_answer": 27},
    {"question_text": "25 - 13 = ?", "story_text": "25 kites flying, 13 strings break!", "correct_answer": 12},
    {"question_text": "8 x 3 = ?", "story_text": "8 boxes with 3 laddoos each!", "correct_answer": 24},
    {"question_text": "45 - 28 = ?", "story_text": "45 tickets sold, 28 people already entered!", "correct_answer": 17},
    {"question_text": "6 x 7 = ?", "story_text": "6 rows of 7 diyas for Diwali!", "correct_answer": 42},
    {"question_text": "30 + 46 = ?", "story_text": "30 students from class A, 46 from class B!", "correct_answer": 76},
    {"question_text": "9 x 4 = ?", "story_text": "9 auto-rickshaws carrying 4 passengers each!", "correct_answer": 36},
    {"question_text": "50 - 23 = ?", "story_text": "50 mangoes in the basket, 23 already eaten!", "correct_answer": 27},
    {"question_text": "7 x 8 = ?", "story_text": "7 cricket teams with 8 players training!", "correct_answer": 56},
    {"question_text": "67 - 39 = ?", "story_text": "67 balloons at the mela, 39 popped!", "correct_answer": 28},
    {"question_text": "5 x 9 = ?", "story_text": "5 trains with 9 coaches each!", "correct_answer": 45},
    {"question_text": "33 + 48 = ?", "story_text": "33 boys and 48 girls at sports day!", "correct_answer": 81},
    {"question_text": "4 x 12 = ?", "story_text": "4 dozen eggs means how many eggs?", "correct_answer": 48},
    {"question_text": "80 - 35 = ?", "story_text": "80 crackers for Diwali, 35 already burst!", "correct_answer": 45},
    {"question_text": "11 x 3 = ?", "story_text": "11 overs bowled, 3 wickets per over!", "correct_answer": 33},
]


def get_question_pool(game_mode: str) -> list:
    """Return a shuffled copy of the question pool for the given mode."""
    pool = list(COMMANDER_QUESTIONS if game_mode == "commander" else EXPLORER_QUESTIONS)
    random.shuffle(pool)
    logger.info(f"questions.pool_loaded(mode={game_mode}, count={len(pool)})")
    return pool
