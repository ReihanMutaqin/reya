"""Jembatan AI lokal untuk REYA.

Semua model dimuat secara lokal dan secara malas (hanya saat diperlukan).
Jalankan dengan: uvicorn server:app --host 127.0.0.1 --port 8765
"""

from __future__ import annotations

import base64
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
load_env_file(ROOT.parent / ".env.local")
load_env_file(ROOT / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
VOICEBOX_URL = os.getenv("VOICEBOX_URL", "http://127.0.0.1:17493").rstrip("/")

TTS_MODEL = os.getenv(
    "REYA_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"
)
CLONE_MODEL = os.getenv(
    "REYA_CLONE_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
)
STT_MODEL = os.getenv("REYA_STT_MODEL", "small")

app = FastAPI(title="REYA Local AI", version="0.2.0")
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
    engine: Literal["supertonic", "qwen", "voicebox"] = "supertonic"
    speaker: str = "F2"
    instruction: str = (
        "Suara perempuan muda yang cute, ceria, playful, hangat, ekspresif, "
        "lembut, dan natural seperti karakter robot sahabat REYA"
    )
    language: str = "Auto"
    voicebox_url: str | None = None


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


async def fetch_voicebox_profiles(base_url: str = VOICEBOX_URL) -> list[dict[str, str]]:
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            response = await client.get(f"{base_url.rstrip('/')}/profiles")
        if not response.is_success:
            return []
        payload = response.json()
        items = payload if isinstance(payload, list) else payload.get("profiles", [])
        profiles: list[dict[str, str]] = []
        for item in items:
            if isinstance(item, dict) and item.get("id"):
                profiles.append(
                    {
                        "id": str(item["id"]),
                        "name": str(item.get("name") or item["id"]),
                        "language": str(item.get("language") or "id"),
                    }
                )
        return profiles
    except Exception:
        return []


@app.get("/health")
async def health() -> dict[str, object]:
    vb_profiles = await fetch_voicebox_profiles()
    has_gemini = bool(GEMINI_API_KEY)
    return {
        "ollama": has_gemini,
        "gemini": has_gemini,
        "voicebox": len(vb_profiles) > 0,
        "voicebox_profiles": vb_profiles,
        "natural_tts": package_available("supertonic"),
        "tts": package_available("qwen_tts"),
        "stt": package_available("faster_whisper"),
        "model": GEMINI_MODEL,
    }


@app.get("/api/voicebox/profiles")
async def voicebox_profiles(url: str | None = None) -> dict[str, object]:
    target = (url or VOICEBOX_URL).rstrip("/")
    profiles = await fetch_voicebox_profiles(target)
    return {"online": len(profiles) > 0, "url": target, "profiles": profiles}


@app.post("/api/chat")
async def chat(request: ChatRequest) -> dict[str, str]:
    system_prompt = (
        "Kamu adalah REYA, robot AI perempuan yang ceria, hangat, ramah, dan pintar. "
        "Aturan bicara REYA: "
        "1. Selalu gunakan Bahasa Indonesia percakapan yang santai, luwes, dan akrab (gunakan kata 'aku' dan 'kamu'). "
        "2. Jangan gunakan bahasa kaku seperti 'Anda' atau 'Sebagai AI'. "
        "3. Jawab singkat, jelas, dan ekspresif (1-2 kalimat pendek) agar enak didengar saat diucapkan dengan suara."
    )

    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY belum diatur di file .env",
        )

    history_lines = [
        f"{'Pengguna' if m.role == 'user' else 'REYA'}: {m.content}"
        for m in request.messages[-8:]
    ]
    prompt_text = f"{system_prompt}\n\nPercakapan:\n" + "\n".join(history_lines) + "\nREYA:"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
                headers={
                    "Content-Type": "application/json",
                    "X-goog-api-key": GEMINI_API_KEY,
                },
                json={
                    "contents": [
                        {
                            "parts": [
                                {
                                    "text": prompt_text,
                                }
                            ]
                        }
                    ]
                },
            )
        response.raise_for_status()
        data = response.json()
        candidates = data.get("candidates") or []
        if candidates:
            parts = candidates[0].get("content", {}).get("parts") or []
            text_out = "".join(p.get("text", "") for p in parts).strip()
            if text_out:
                return {"message": text_out, "model": GEMINI_MODEL}
        raise HTTPException(status_code=502, detail="Argon Gemini tidak memberi jawaban")
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=503,
            detail="Gagal menghubungi Argon Gemini API.",
        ) from error


def synthesize_voicebox(request: TTSRequest) -> bytes:
    target_url = (request.voicebox_url or VOICEBOX_URL).rstrip("/")
    profile_id = request.speaker or "default"

    with httpx.Client(timeout=30) as client:
        # Try OpenAI-compatible speech endpoint exposed by jamiepine/voicebox
        try:
            speech_res = client.post(
                f"{target_url}/v1/audio/speech",
                json={
                    "model": "qwen",
                    "input": request.text.strip(),
                    "voice": profile_id,
                    "response_format": "wav",
                },
            )
            if speech_res.is_success and len(speech_res.content) > 200:
                return speech_res.content
        except Exception:
            pass

        # Fallback to native /generate endpoint in jamiepine/voicebox
        gen_res = client.post(
            f"{target_url}/generate",
            json={
                "text": request.text.strip(),
                "profile_id": profile_id,
                "language": "id" if request.language == "Auto" else request.language,
                "instruct": request.instruction,
            },
        )
        gen_res.raise_for_status()
        content_type = gen_res.headers.get("content-type", "")
        if "audio/" in content_type and len(gen_res.content) > 200:
            return gen_res.content

        data = gen_res.json()
        if isinstance(data, dict):
            b64_audio = data.get("audio") or data.get("audio_base64")
            if isinstance(b64_audio, str) and b64_audio:
                return base64.b64decode(b64_audio)
            gen_id = data.get("id") or data.get("generation_id")
            if gen_id:
                for audio_route in (
                    f"{target_url}/audio/{gen_id}",
                    f"{target_url}/history/{gen_id}/export-audio",
                ):
                    audio_res = client.get(audio_route)
                    if audio_res.is_success and len(audio_res.content) > 200:
                        return audio_res.content

    raise RuntimeError("Server Voicebox tidak mengembalikan data audio")


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
    if request.engine == "voicebox":
        return synthesize_voicebox(request), 24000

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
