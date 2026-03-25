from pydantic import BaseModel
from typing import Literal


class TextInput(BaseModel):
    type: Literal["text_input"]
    text: str


class ProgressMessage(BaseModel):
    type: Literal["progress"] = "progress"
    stage: str
    message: str


class TranscriptionMessage(BaseModel):
    type: Literal["transcription"] = "transcription"
    text: str


class ResultMessage(BaseModel):
    type: Literal["result"] = "result"
    image: str
    prompt_used: str
    raw_mono: str
    width: int = 384
    height: int


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    stage: str
    message: str
