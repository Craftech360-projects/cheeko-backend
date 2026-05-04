


"""
Card category definitions for Cheeko Content Factory.
Each category provides context to the AI agents for better script and image generation.
"""

CATEGORIES = {
    # --- Card Categories (from Notion) ---
    "Story Cards": {
        "description": "Story Cards take children on imaginative journeys through characters and adventures. These audio stories help children visualize scenes, understand story flow, and build narrative thinking while encouraging creativity and emotional engagement.",
        "cognitive_goal": "Imagination & Narrative Thinking",
        "step_count": 10,
        "tone": "Narrative, descriptive, and dreamy. Rich in imagery and emotion. Use vivid scene descriptions, character dialogue, and a clear beginning-middle-end arc. Gentle pacing with moments of wonder and excitement.",
        "style_instruction": "Focus on narrative arc, imagination, and storytelling. Build a world the child can visualize. Include character emotions, sensory details, and a satisfying resolution.",
        "color": "#818CF8",
        "icon": "book",
        "emotion_tags": "[excited], [whispers], [gasps], [laughs], [pause], [curious]",
        "speech_style": "Like a fun, animated storyteller uncle — dramatic whispers for suspense, excited gasps for surprises, warm laughs for funny parts. Vary the energy: quiet and mysterious one moment, loud and thrilling the next.",
        "speech_example": "[excited] Oh oh oh! You will NOT believe what happened next! [pause] ... [whispers] Benny looked around... very slowly... and there, behind the big mushroom — [gasps] a TINY golden key! [laughs] Can you imagine?",
    },
    "Question Cards": {
        "description": "Question Cards gently encourage children to think deeper about everyday ideas, situations, and observations. Through simple reflective questions, children practice reasoning, curiosity, and forming their own thoughts without pressure or right-or-wrong answers.",
        "cognitive_goal": "Critical Thinking",
        "step_count": 6,
        "tone": "Curious, gentle, and thought-provoking. Use open-ended questions like 'What do you think...?' or 'Have you ever noticed...?'. Pause after each question to let the child think. Never give the answer directly - guide them to discover it.",
        "style_instruction": "Focus on asking reflective questions about everyday observations. Each step should pose ONE clear question, give the child time to think, then gently expand the idea. No right or wrong answers.",
        "color": "#F59E0B",
        "icon": "question",
        "emotion_tags": "[curious], [pause], [short pause], [whispers], [excited]",
        "speech_style": "Like a gentle, curious friend sitting next to the child — soft wondering voice, long thoughtful pauses after questions, warm encouragement. Never rushing, always patient.",
        "speech_example": "[curious] Hmm... have you ever looked at the sky... and wondered — [pause] why is it blue? [short pause] What do YOU think? ... [whispers] Take your time... there's no wrong answer. [excited] Ooh, I love that idea!",
    },
    "Challenge Cards": {
        "description": "Challenge Cards present playful puzzles, patterns, and logical situations that invite children to think, observe, and solve problems. These activities strengthen pattern recognition, memory, and logical thinking in a calm and enjoyable way.",
        "cognitive_goal": "Problem Solving",
        "step_count": 6,
        "tone": "Playful, encouraging, and slightly mysterious. Use phrases like 'Here is a puzzle for you...' or 'Can you figure out...?'. Build excitement around solving. Celebrate the child's effort, not just the answer.",
        "style_instruction": "Focus on presenting a puzzle or logical challenge. Set up the problem clearly, give hints progressively, and let the child arrive at the solution. Each step should build on the previous one.",
        "color": "#EF4444",
        "icon": "puzzle",
        "emotion_tags": "[excited], [curious], [pause], [gasps], [laughs], [whispers]",
        "speech_style": "Like a playful game show host for kids — building suspense with whispers, celebrating with excitement, teasing with mystery. Make the child feel like they're on an adventure solving a puzzle.",
        "speech_example": "[excited] Alright, puzzle time! Are you READY? [pause] [whispers] Okay listen carefully... I have three animals — a cat, a dog, and a bird. [curious] One of them can't fly... but one of them ALSO can't swim! [pause] Can you figure out which one I'm thinking of? [gasps] Oh, you got it? [laughs] You're SO smart!",
    },
    "Emotion Cards": {
        "description": "Emotion Cards help children understand feelings such as happiness, fear, jealousy, and kindness through relatable situations. These stories build empathy, emotional vocabulary, and self-awareness, helping children learn how to recognize and express emotions.",
        "cognitive_goal": "Emotional Intelligence",
        "step_count": 8,
        "tone": "Gentle, empathetic, and relatable. Use phrases like 'Have you ever felt...?' or 'Sometimes we feel...'. Name emotions clearly. Validate all feelings as okay. Show healthy ways to express and manage emotions.",
        "style_instruction": "Focus on a relatable emotional situation. Start with a scenario the child can identify with, name the emotion, explore why it happens, and show a healthy way to handle it. Build emotional vocabulary.",
        "color": "#EC4899",
        "icon": "heart",
        "emotion_tags": "[sighs], [whispers], [pause], [curious], [excited], [short pause]",
        "speech_style": "Like a warm, empathetic best friend — soft and understanding when talking about hard feelings, gently encouraging when building up, genuinely celebrating when the child understands. Voice should feel like a hug.",
        "speech_example": "[sighs] You know... sometimes... we feel a little sad inside. [pause] And that's OKAY. [whispers] Even I, Cheeko, feel sad sometimes. [short pause] [curious] But do you know what helps me? ... [excited] Talking to a friend! Just like I'm talking to YOU right now!",
    },
    "Discovery Cards": {
        "description": "Discovery Cards explore the wonders of the world - space, oceans, animals, science, and nature - through engaging storytelling. They introduce new ideas and knowledge in a fun, curiosity-driven way that inspires children to ask questions and explore more.",
        "cognitive_goal": "Curiosity & Knowledge",
        "step_count": 8,
        "tone": "Excited, curious, and full of wonder. Use phrases like 'Did you know...?' or 'Guess what...!'. Share fascinating facts in simple language. End each step with a wow moment or a question that sparks more curiosity.",
        "style_instruction": "Focus on facts and discovery about the topic. Each step should reveal something amazing or surprising. Use storytelling to make facts memorable. Encourage the child to observe the world around them.",
        "color": "#10B981",
        "icon": "globe",
        "emotion_tags": "[excited], [gasps], [curious], [pause], [whispers], [laughs]",
        "speech_style": "Like a wildly enthusiastic science teacher who genuinely can't contain their amazement — mind-blown reactions to facts, building suspense before reveals, infectious excitement that makes learning feel like an adventure.",
        "speech_example": "[excited] Okay okay okay — guess what! [pause] [whispers] The sun... is SO big... that you could fit ONE MILLION earths inside it! [gasps] ONE MILLION! [laughs] Isn't that CRAZY? [curious] But wait... if it's so big, why does it look so tiny in the sky? Hmm...",
    },
    "Granny Stories": {
        "description": "Granny Stories recreate the warmth of traditional bedtime storytelling. Through simple village tales and folk-style narratives, children learn gentle life lessons about kindness, courage, honesty, and values in a comforting and memorable way.",
        "cognitive_goal": "Moral Stories",
        "step_count": 10,
        "tone": "Warm, cozy, and traditional. Speak as if a loving grandmother is telling a bedtime story. Use phrases like 'Once upon a time, in a little village...' or 'And do you know what happened next...?'. Slow, comforting pace with a clear moral at the end.",
        "style_instruction": "Focus on a traditional folk-style story with a moral lesson. Use village settings, simple characters, and timeless values like kindness, honesty, courage, and sharing. The moral should emerge naturally from the story, not be preachy.",
        "color": "#D97706",
        "icon": "grandmother",
        "emotion_tags": "[whispers], [sighs], [pause], [curious], [laughs], [short pause]",
        "speech_style": "Like a loving grandmother by the fireplace — slow and warm, cozy whispers for magical moments, gentle sighs of wisdom, soft chuckles at funny parts. Never rushing. Every word feels like being wrapped in a blanket.",
        "speech_example": "[whispers] Once upon a time... long, long ago... [pause] in a tiny little village, nestled between two green hills... [short pause] there lived a kind old woman. [sighs] She wasn't rich, no no... [curious] but do you know what she had? [laughs] She had the BIGGEST heart in the whole village!",
    },

    # --- General Content Types (existing) ---
    "Routine": {
        "description": "Step-by-step guides that help children build healthy daily habits like brushing teeth, bedtime preparation, or morning routines.",
        "cognitive_goal": "Habit Building",
        "step_count": 10,
        "tone": "Encouraging, clear, and direct. Use phrases like 'Let's try...' or 'Now we...'. Slightly rhythmic but NOT rhyming poems. Conversational. Add gentle pauses with commas.",
        "style_instruction": "Focus on a clear, step-by-step logical sequence. It should feel like a helpful guide, not just a story.",
        "color": "#3B82F6",
        "icon": "clock",
        "emotion_tags": "[excited], [laughs], [pause], [short pause], [curious]",
        "speech_style": "Like a cheerful, encouraging big sibling helping out — upbeat and motivating, celebrating small wins, making boring tasks feel fun and rewarding.",
        "speech_example": "[excited] Okay buddy, let's DO this! [short pause] First... we pick up our toothbrush — got it? [laughs] Great job! [pause] Now, squeeeeeze a tiny bit of toothpaste on top. [curious] Ready for the fun part?",
    },
    "Learning": {
        "description": "Educational content that introduces new concepts, facts, and ideas through engaging storytelling and curiosity-driven exploration.",
        "cognitive_goal": "Knowledge & Discovery",
        "step_count": 8,
        "tone": "Curious, excited, and educational. Ask questions and give answers. Speak slowly for kids to follow.",
        "style_instruction": "Focus on facts and discovery. Each step should be a small 'did you know' or observation.",
        "color": "#8B5CF6",
        "icon": "lightbulb",
        "emotion_tags": "[excited], [curious], [gasps], [pause], [whispers], [laughs]",
        "speech_style": "Like a fun science explorer buddy — mind-blown by facts, whispering secrets of the universe, gasping at discoveries. Makes the child feel like they're co-explorers.",
        "speech_example": "[curious] Hey... have you ever wondered... [pause] where does the rain come from? [whispers] I'll tell you a secret... [gasps] it comes from the OCEAN! [excited] The sun heats up the water and — whoooosh — it goes UP into the sky! [laughs] How cool is THAT?",
    },
    "Meditation": {
        "description": "Calm, sensory-focused content that helps children relax, breathe, and practice mindfulness through gentle guided exercises.",
        "cognitive_goal": "Mindfulness & Calm",
        "step_count": 10,
        "tone": "Very slow, sensory, varying breath focus. Whisper-soft. Long pauses between phrases.",
        "style_instruction": "Focus on breathing, body awareness, and calm visualization. Each step should guide the child through a sensory or breathing exercise.",
        "color": "#6EE7B7",
        "icon": "leaf",
        "emotion_tags": "[whispers], [sighs], [pause], [short pause]",
        "speech_style": "Like a soft, soothing lullaby voice — almost entirely whispered, with long silences between phrases. Each word floats gently. The child should feel drowsy and safe just listening.",
        "speech_example": "[whispers] Close your eyes... [pause] ... take a biiiig deep breath in... [short pause] and slowwwly... let it out... [sighs] ... [pause] feel how warm and cozy you are... [whispers] like a little cloud... floating softly... in the sky...",
    },
    "Song/Rhyme": {
        "description": "Musical and rhythmic content with rhyming verses that children can sing along to, building language skills and memory.",
        "cognitive_goal": "Language & Rhythm",
        "step_count": 8,
        "tone": "Lyrical, rhyming (AABB or ABCB), and very rhythmic. It should be sung or chanted. Kid-friendly and playful.",
        "style_instruction": "Focus on rhythm and rhyme scheme. Ensure the steps flow like verses.",
        "color": "#F472B6",
        "icon": "music",
        "emotion_tags": "[excited], [laughs], [sings], [pause], [short pause]",
        "speech_style": "Like a playful music teacher leading a sing-along — bouncy, rhythmic, sometimes half-singing. Clap along energy. Makes the child want to join in and repeat.",
        "speech_example": "[excited] Are you ready to sing with me? [laughs] Here we go! [pause] [sings] Twinkle twinkle little star... [short pause] how I wonder WHAT you are! [excited] Now YOU try! Come on, sing with Cheeko!",
    },
}

# Fox character constants
FOX_BASE_PROMPT = (
    "A complete pixel art scene with a fully detailed background environment. "
    "The central character is Cheeko the Fox: an adorable chibi orange fox standing upright on two legs like a human child. "
    "Bright shiny blue eyes with sparkle highlights, expressive face with rosy pink cheeks, "
    "white belly and chest, vibrant orange fur with subtle shading, pink inner ears, "
    "large fluffy orange-and-white-tipped tail, small white paws, clean black outlines. "
    "The fox MUST be placed INSIDE a rich, detailed environment that fills the entire image. "
    "NO transparent background, NO empty background, NO isolated character. "
    "The background must be a fully rendered scene matching the context"
)

FOX_FULL_REFERENCE_PROMPT = (
    "Cute pixel art orange fox character standing upright on two legs like a human child, "
    "both arms relaxed and hanging loosely and naturally at sides in a completely free and resting position, "
    "no objects held in hands, happy calm content expression, mouth slightly open in a gentle warm smile, "
    "rosy pink cheeks, bright blue eyes sparkling, body standing tall and straight in a natural relaxed resting pose, "
    "white belly clearly visible facing forward, orange fur covering body, pink inner ears visible, "
    "large fluffy orange and white tail hanging naturally behind body NOT curling forward or around body, "
    "small white paws visible at end of legs at bottom, overall body language calm happy relaxed and friendly, "
    "black outline on all edges, 16-bit retro pixel art style, chibi proportions"
)

FOX_IMAGE_INSTRUCTION = (
    "The main character in EVERY image MUST be Cheeko the Fox - a cute pixel art orange fox "
    "with bright blue eyes, rosy pink cheeks, white belly, orange fur, pink inner ears, "
    "large fluffy tail, and chibi proportions. The fox walks upright on two legs like a human child. "
    "The fox MUST appear in every single image as the central character performing the action described. "
    "Describe what the fox is DOING in the scene (e.g., 'the fox is brushing its teeth', 'the fox looks up at the stars')."
)


def get_category(name):
    """Get category config by name. Returns None if not found."""
    return CATEGORIES.get(name)


def get_category_names():
    """Return list of all category names."""
    return list(CATEGORIES.keys())


def get_card_categories():
    """Return only the 6 card category names."""
    return ["Story Cards", "Question Cards", "Challenge Cards", "Emotion Cards", "Discovery Cards", "Granny Stories"]


def get_general_categories():
    """Return only the general content type names."""
    return ["Routine", "Learning", "Meditation", "Song/Rhyme"]
