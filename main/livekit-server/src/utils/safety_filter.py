import re

UNSAFE_RESPONSE_TEXT = "I can't use hurtful words. Please use kind words, or share a nice nickname instead."

# Conservative first-pass matcher for common profanity, abusive slurs,
# and explicit violent phrasing across English and common romanized Indian usage.
UNSAFE_TERMS = {
    "fuck", "fucking", "fucker", "shit", "shitty", "bitch", "bastard", "asshole",
    "motherfucker", "mf", "bsdk", "bhosdike", "bhosadi", "madarchod", "mc", "bc",
    "behenchod", "behnchod", "chutiya", "gandu", "harami", "haraami", "randi",
    "kamina", "kamine", "idiot", "bloody fool", "kill you", "murder you", "die bitch",
}

UNSAFE_PATTERNS = [
    re.compile(r"\bf+u+c*k+\b", re.IGNORECASE),
    re.compile(r"\bf+u+k+\b", re.IGNORECASE),
    re.compile(r"\bsh+i+t+\b", re.IGNORECASE),
    re.compile(r"\bb+i+t+c+h+\b", re.IGNORECASE),
    re.compile(r"\bbastard\b", re.IGNORECASE),
    re.compile(r"\basshole\b", re.IGNORECASE),
    re.compile(r"\bmother\s*f+u+c*k+er\b", re.IGNORECASE),
    re.compile(r"\bmadar\s*chod\b", re.IGNORECASE),
    re.compile(r"\bbehen\s*chod\b", re.IGNORECASE),
    re.compile(r"\bbhos(d|a)\w*\b", re.IGNORECASE),
    re.compile(r"\bchu+t+i+y+a+\b", re.IGNORECASE),
    re.compile(r"\bgand+u+\b", re.IGNORECASE),
    re.compile(r"\brand+i+\b", re.IGNORECASE),
    re.compile(r"\b(kill|murder|stab|shoot)\s+(you|him|her|them|someone)\b", re.IGNORECASE),
]


def normalize_safety_text(text: str) -> str:
    lowered = (text or "").lower()
    lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered).strip()
    return lowered


def contains_unsafe_content(text: str) -> bool:
    normalized = normalize_safety_text(text)
    if not normalized:
        return False

    for term in UNSAFE_TERMS:
        if term in normalized:
            return True

    return any(pattern.search(normalized) for pattern in UNSAFE_PATTERNS)