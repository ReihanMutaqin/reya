"""Jembatan AI lokal untuk REYA.

Semua model dimuat secara lokal dan secara malas (hanya saat diperlukan).
Jalankan dengan: uvicorn server:app --host 127.0.0.1 --port 8765
"""

from __future__ import annotations

import importlib.util
import io
import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parent
VOICES_DIR = ROOT / "voices"
VOICES_DIR.mkdir(exist_ok=True)

# Load .env from project root if present
def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip("'\"")
        if key not in os.environ:
            os.environ[key] = val

load_env_file(ROOT.parent / ".env")
load_env_file(ROOT / ".env")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "openrouter/free")

OLLAMA_URL = os.getenv("REYA_OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("REYA_OLLAMA_MODEL", "qwen3:4b")
TTS_MODEL = os.getenv(
    "REYA_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"
)
CLONE_MODEL = os.getenv(
    "REYA_CLONE_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
)
STT_MODEL = os.getenv("REYA_STT_MODEL", "small")

app = FastAPI(title="REYA Local AI", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3088",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3088",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

_model_lock = threading.Lock()
_tts_models: dict[str, object] = {}
_natural_tts_model: object | None = None
_stt_model: object | None = None


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20_000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=20)


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2_000)
    engine: Literal["supertonic", "qwen"] = "supertonic"
    speaker: str = "F2"
    instruction: str = (
        "Suara perempuan muda yang cute, ceria, playful, hangat, ekspresif, "
        "lembut, dan natural seperti karakter robot sahabat REYA"
    )
    language: str = "Auto"


def package_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip()).strip("-")
    return cleaned[:48] or "suara-saya"


async def ollama_is_ready() -> bool:
    try:
        async with httpx.AsyncClient(timeout=1.2) as client:
            response = await client.get(f"{OLLAMA_URL}/api/tags")
        return response.is_success
    except httpx.HTTPError:
        return False


@app.get("/health")
async def health() -> dict[str, object]:
    ollama_ok = await ollama_is_ready()
    has_openrouter = bool(OPENROUTER_API_KEY)
    active_model = OPENROUTER_MODEL if has_openrouter else OLLAMA_MODEL
    return {
        "ollama": ollama_ok or has_openrouter,
        "openrouter": has_openrouter,
        "natural_tts": package_available("supertonic"),
        "tts": package_available("qwen_tts"),
        "stt": package_available("faster_whisper"),
        "model": active_model,
    }


@app.post("/api/chat")
async def chat(request: ChatRequest) -> dict[str, str]:
    system_prompt = (
        "Kamu adalah REYA, robot AI perempuan yang imut, ceria, hangat, ramah, dan pintar. "
        "Bicaralah dalam Bahasa Indonesia yang natural, santai, dan ringkas (1-2 kalimat pendek). "
        "Jawab langsung pada intinya layaknya mengobrol langsung lewat mic. "
        "Jangan gunakan formatting markdown yang rumit karena jawabanmu akan dibacakan dengan suara."
    )

    # 1. Try OpenRouter if API key is configured
    if OPENROUTER_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "http://localhost:3088",
                        "X-Title": "REYA Robot AI",
                    },
                    json={
                        "model": OPENROUTER_MODEL,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            *[item.model_dump() for item in request.messages[-10:]],
                        ],
                        "max_tokens": 160,
                        "temperature": 0.75,
                    },
                )
            if response.is_success:
                data = response.json()
                answer = (
                    data.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                    .strip()
                )
                if answer:
                    return {"message": answer}
        except Exception:
            pass  # Fallback to Ollama if OpenRouter network error

    # 2. Fallback to Local Ollama
    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": system_prompt},
            *[item.model_dump() for item in request.messages[-10:]],
        ],
        "options": {"temperature": 0.72, "top_p": 0.9, "num_predict": 160},
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        response.raise_for_status()
        answer = response.json().get("message", {}).get("content", "").strip()
        if not answer:
            raise HTTPException(status_code=502, detail="AI tidak memberi jawaban")
        return {"message": answer}
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=503,
            detail="AI belum siap. Periksa koneksi OpenRouter atau Ollama.",
        ) from error


def load_tts_model(model_id: str) -> object:
    if not package_available("qwen_tts"):
        raise RuntimeError("Paket qwen-tts belum terpasang")
    with _model_lock:
        if model_id in _tts_models:
            return _tts_models[model_id]
        import torch
        from qwen_tts import Qwen3TTSModel

        has_cuda = torch.cuda.is_available()
        kwargs: dict[str, object] = {
            "device_map": "cuda:0" if has_cuda else "cpu",
            "dtype": torch.bfloat16 if has_cuda else torch.float32,
        }
        if has_cuda and package_available("flash_attn"):
            kwargs["attn_implementation"] = "flash_attention_2"
        model = Qwen3TTSModel.from_pretrained(model_id, **kwargs)
        _tts_models[model_id] = model
        return model


def load_natural_tts_model() -> object:
    global _natural_tts_model
    if not package_available("supertonic"):
        raise RuntimeError("Paket suara natural belum terpasang")
    with _model_lock:
        if _natural_tts_model is None:
            from supertonic import TTS

            _natural_tts_model = TTS(auto_download=True)
        return _natural_tts_model


def voice_metadata(voice_id: str) -> dict[str, str]:
    voice_key = safe_name(voice_id.removeprefix("clone:"))
    metadata_path = VOICES_DIR / f"{voice_key}.json"
    if not metadata_path.exists():
        raise FileNotFoundError("Suara custom tidak ditemukan")
    return json.loads(metadata_path.read_text(encoding="utf-8"))


def synthesize(request: TTSRequest) -> tuple[bytes, int]:
    import soundfile as sf

    if request.engine == "supertonic":
        model = load_natural_tts_model()
        voice_name = request.speaker if request.speaker in {"F1", "F2", "F3", "F4", "F5"} else "F2"
        voice_style = model.get_voice_style(voice_name=voice_name)  # type: ignore[attr-defined]
        is_long_instruction = len(request.text) > 220
        wav, _duration = model.synthesize(  # type: ignore[attr-defined]
            text=request.text.strip(),
            voice_style=voice_style,
            lang="id",
            total_steps=12,
            speed=1.02 if is_long_instruction else 1.06,
            max_chunk_length=120,
            silence_duration=0.2 if is_long_instruction else 0.16,
            verbose=False,
        )
        sample_rate = int(model.sample_rate)  # type: ignore[attr-defined]
        output = io.BytesIO()
        sf.write(output, wav.squeeze(), sample_rate, format="WAV")  # type: ignore[attr-defined]
        return output.getvalue(), sample_rate
    if request.speaker.startswith("clone:"):
        metadata = voice_metadata(request.speaker)
        model = load_tts_model(CLONE_MODEL)
        wavs, sample_rate = model.generate_voice_clone(  # type: ignore[attr-defined]
            text=request.text,
            language="Auto",
            ref_audio=metadata["audio_path"],
            ref_text=metadata["transcript"],
        )
    else:
        model = load_tts_model(TTS_MODEL)
        wavs, sample_rate = model.generate_custom_voice(  # type: ignore[attr-defined]
            text=request.text,
            language="Auto",
            speaker=request.speaker,
            instruct=request.instruction,
        )
    output = io.BytesIO()
    sf.write(output, wavs[0], sample_rate, format="WAV")
    return output.getvalue(), sample_rate


@app.post("/api/tts")
def text_to_speech(request: TTSRequest) -> Response:
    try:
        audio, _sample_rate = synthesize(request)
        return Response(content=audio, media_type="audio/wav")
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/voices")
def list_voices() -> dict[str, list[dict[str, str]]]:
    voices = []
    for path in VOICES_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            voices.append({"voice_id": data["voice_id"], "name": data["name"]})
        except (OSError, KeyError, json.JSONDecodeError):
            continue
    return {"voices": voices}


@app.post("/api/voices")
async def create_voice(
    name: str = Form(...),
    transcript: str = Form(...),
    audio: UploadFile = File(...),
) -> dict[str, str]:
    if len(transcript.strip()) < 3:
        raise HTTPException(status_code=400, detail="Transkrip terlalu pendek")
    voice_key = safe_name(name)
    suffix = Path(audio.filename or "voice.webm").suffix.lower()
    if suffix not in {".wav", ".mp3", ".m4a", ".ogg", ".webm", ".flac"}:
        suffix = ".webm"
    audio_path = VOICES_DIR / f"{voice_key}{suffix}"
    content = await audio.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Rekaman terlalu besar")
    audio_path.write_bytes(content)
    metadata = {
        "voice_id": f"clone:{voice_key}",
        "name": name.strip()[:80] or "Suara Saya",
        "audio_path": str(audio_path),
        "transcript": transcript.strip(),
    }
    (VOICES_DIR / f"{voice_key}.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"voice_id": metadata["voice_id"], "name": metadata["name"]}


def load_stt_model() -> object:
    global _stt_model
    if not package_available("faster_whisper"):
        raise RuntimeError("Paket faster-whisper belum terpasang")
    with _model_lock:
        if _stt_model is None:
            import torch
            from faster_whisper import WhisperModel

            has_cuda = torch.cuda.is_available()
            _stt_model = WhisperModel(
                STT_MODEL,
                device="cuda" if has_cuda else "cpu",
                compute_type="float16" if has_cuda else "int8",
            )
        return _stt_model


@app.post("/api/stt")
async def speech_to_text(audio: UploadFile = File(...)) -> dict[str, str]:
    suffix = Path(audio.filename or "speech.webm").suffix or ".webm"
    content = await audio.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio terlalu besar")
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name
        model = load_stt_model()
        segments, _info = model.transcribe(  # type: ignore[attr-defined]
            temp_path, language="id", vad_filter=True, beam_size=5
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        return {"text": text}
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    finally:
        if temp_path:
            Path(temp_path).unlink(missing_ok=True)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
