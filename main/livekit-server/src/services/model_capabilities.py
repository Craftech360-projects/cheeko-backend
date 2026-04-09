from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GeminiCapabilityProfile:
    model_name: str
    supports_mid_session_generate: bool
    supports_mid_session_instruction_updates: bool
    supports_mid_session_chat_ctx_updates: bool
    supports_affective_dialog: bool
    supports_proactivity: bool

    @property
    def requires_external_forced_turns(self) -> bool:
        return not self.supports_mid_session_generate


def build_gemini_capability_profile(model_name: str) -> GeminiCapabilityProfile:
    normalized = (model_name or "").strip().lower()
    is_gemini_31 = normalized.startswith("gemini-3.1")

    if is_gemini_31:
        return GeminiCapabilityProfile(
            model_name=model_name,
            supports_mid_session_generate=False,
            supports_mid_session_instruction_updates=False,
            supports_mid_session_chat_ctx_updates=False,
            supports_affective_dialog=False,
            supports_proactivity=False,
        )

    return GeminiCapabilityProfile(
        model_name=model_name,
        supports_mid_session_generate=True,
        supports_mid_session_instruction_updates=True,
        supports_mid_session_chat_ctx_updates=True,
        supports_affective_dialog=True,
        supports_proactivity=True,
    )
