"""Jembatan AI lokal & Server Studio Voicebox (Port 17493 + 8765) untuk REYA.

Menggunakan engine suara asli REYA (Supertonic 3 ONNX 44.1kHz — profil F2 Cute)
yang sama persis dengan sampel CONTOH-SUARA-RAYA-CUTE.wav.
Jalankan dengan: python server.py
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
from collections import OrderedDict
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
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

app = FastAPI(title="REYA Voicebox & Local AI Studio", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Voice-Provider", "Content-Type"],
)


@app.middleware("http")
async def add_private_network_access_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
    if request.method == "OPTIONS":
        response = Response(status_code=204)
    else:
        response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


_model_lock = threading.Lock()
_tts_models: dict[str, object] = {}
_natural_tts_model: object | None = None
_stt_model: object | None = None

# In-memory LRU audio cache so repeated phrases play instantaneously
_audio_cache: OrderedDict[str, bytes] = OrderedDict()
_MAX_AUDIO_CACHE = 128

BUILTIN_VOICEBOX_PROFILES: list[dict[str, str]] = [
    {
        "id": "F2",
        "name": "REYA Studio Cute (Voicebox F2 - Suara Awal Asli)",
        "language": "id",
        "description": "Suara asli CONTOH-SUARA-RAYA-CUTE.wav (Supertonic 3 F2 Lily 44.1kHz)",
        "default_engine": "supertonic-3",
    },
    {
        "id": "F1",
        "name": "REYA Studio Natural (Voicebox F1 - Sarah Hangat)",
        "language": "id",
        "description": "Suara perempuan Indonesia natural & hangat (Supertonic 3 F1 44.1kHz)",
        "default_engine": "supertonic-3",
    },
    {
        "id": "F5",
        "name": "REYA Studio Kalem (Voicebox F5 - Olivia Lembut)",
        "language": "id",
        "description": "Intonasi lembut, santai, dan menenangkan (Supertonic 3 F5 44.1kHz)",
        "default_engine": "supertonic-3",
    },
    {
        "id": "F3",
        "name": "REYA Studio Jernih (Voicebox F3 - Jessica Ekspresif)",
        "language": "id",
        "description": "Vokal artikulatif dan ekspresif (Supertonic 3 F3 44.1kHz)",
        "default_engine": "supertonic-3",
    },
    {
        "id": "F4",
        "name": "REYA Studio Dinamis (Voicebox F4 -ソフィア Ceria)",
        "language": "id",
        "description": "Suara ceria dan penuh semangat (Supertonic 3 F4 44.1kHz)",
        "default_engine": "supertonic-3",
    },
]


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


class VoiceboxSpeechRequest(BaseModel):
    model: str = "tts-1"
    input: str = Field(min_length=1, max_length=2_000)
    voice: str = "F2"
    response_format: str = "wav"
    speed: float = 1.06


class VoiceboxGenerateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2_000)
    profile_id: str = "F2"
    language: str = "id"
    instruct: str | None = None


class CreateProfileRequest(BaseModel):
    name: str = "REYA Studio Cute"
    language: str = "id"
    description: str = "Profil suara Studio REYA"


def package_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip()).strip("-")
    return cleaned[:48] or "suara-saya"


_ID_LOANWORD_MAP: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\breya\b", re.IGNORECASE), "Reya"),
    (re.compile(r"\braya\b", re.IGNORECASE), "Raya"),
    (re.compile(r"\bcute\b", re.IGNORECASE), "kyut"),
    (re.compile(r"\byey\b", re.IGNORECASE), "yeeey"),
    (re.compile(r"\byay\b", re.IGNORECASE), "yeey"),
    (re.compile(r"\bvoicebox\b", re.IGNORECASE), "voisboks"),
    (re.compile(r"\bbit\s*chord\b", re.IGNORECASE), "bitkord"),
    (re.compile(r"\benchor(?:\.us)?\b", re.IGNORECASE), "enkor"),
    (re.compile(r"\bspotify\b", re.IGNORECASE), "spotifai"),
    (re.compile(r"\bplay\b", re.IGNORECASE), "plei"),
    (re.compile(r"\brequest\b", re.IGNORECASE), "rikwes"),
    (re.compile(r"\bstyle\b", re.IGNORECASE), "stail"),
    (re.compile(r"\bsound\b", re.IGNORECASE), "saun"),
    (re.compile(r"\bcloud\b", re.IGNORECASE), "klaud"),
    (re.compile(r"\bonline\b", re.IGNORECASE), "onlain"),
    (re.compile(r"\boffline\b", re.IGNORECASE), "oflain"),
]


def normalize_indonesian_tts_text(raw: str) -> str:
    cleaned = re.sub(r"[*_#`~\[\]♪♫🎤✨💖♥♡]+", " ", raw)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    for pattern, replacement in _ID_LOANWORD_MAP:
        cleaned = pattern.sub(replacement, cleaned)
    return cleaned or "Halo!"


def map_profile_to_supertonic_voice(profile_or_speaker: str | None) -> str:
    if not profile_or_speaker:
        return "F2"
    val = profile_or_speaker.strip()
    upper = val.upper()
    if upper in {"F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"}:
        return upper
    low = val.lower()
    if "kalem" in low or "lembut" in low:
        return "F5"
    if "natural" in low or "hangat" in low:
        return "F1"
    if "jernih" in low:
        return "F3"
    if "dinamis" in low:
        return "F4"
    return "F2"


def list_all_voicebox_profiles() -> list[dict[str, str]]:
    profiles = list(BUILTIN_VOICEBOX_PROFILES)
    for path in VOICES_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            vid = str(data.get("voice_id") or data.get("id") or path.stem)
            if not any(p["id"] == vid for p in profiles):
                profiles.append(
                    {
                        "id": vid,
                        "name": str(data.get("name") or vid),
                        "language": str(data.get("language") or "id"),
                        "description": str(
                            data.get("description") or "Profil suara custom REYA"
                        ),
                    }
                )
        except Exception:
            continue
    return profiles


def load_natural_tts_model() -> object:
    global _natural_tts_model
    if not package_available("supertonic"):
        raise RuntimeError("Paket suara natural supertonic belum terpasang")
    with _model_lock:
        if _natural_tts_model is None:
            from supertonic import TTS

            _natural_tts_model = TTS(auto_download=True)
        return _natural_tts_model


def synthesize_supertonic_wav(
    text: str,
    speaker_or_profile: str = "F2",
    speed: float | None = None,
) -> tuple[bytes, int]:
    import soundfile as sf

    voice_name = map_profile_to_supertonic_voice(speaker_or_profile)
    normalized_text = normalize_indonesian_tts_text(text)
    is_long = len(normalized_text) > 220
    final_speed = speed if speed is not None else (1.03 if is_long else 1.06)

    cache_key = f"st3:{voice_name}:{final_speed:.2f}:{normalized_text}"
    if cache_key in _audio_cache:
        _audio_cache.move_to_end(cache_key)
        return _audio_cache[cache_key], 44100

    model = load_natural_tts_model()
    voice_style = model.get_voice_style(voice_name=voice_name)  # type: ignore[attr-defined]
    wav, _duration = model.synthesize(  # type: ignore[attr-defined]
        text=normalized_text,
        voice_style=voice_style,
        lang="id",
        total_steps=7,
        speed=final_speed,
        max_chunk_length=130,
        silence_duration=0.18 if is_long else 0.14,
        verbose=False,
    )
    sample_rate = int(model.sample_rate)  # type: ignore[attr-defined]
    output = io.BytesIO()
    sf.write(output, wav.squeeze(), sample_rate, format="WAV")  # type: ignore[attr-defined]
    wav_bytes = output.getvalue()

    _audio_cache[cache_key] = wav_bytes
    if len(_audio_cache) > _MAX_AUDIO_CACHE:
        _audio_cache.popitem(last=False)

    return wav_bytes, sample_rate


# ============================================================================
# Voicebox Studio Compatible Endpoints (Port 17493 & Port 8765)
# ============================================================================


@app.get("/profiles")
async def get_voicebox_profiles_root() -> list[dict[str, str]]:
    return list_all_voicebox_profiles()


@app.post("/profiles")
async def create_voicebox_profile_root(req: CreateProfileRequest) -> dict[str, str]:
    profile_id = safe_name(req.name)
    if profile_id.lower() in {"reya-studio-cute", "reya-cute", "default"}:
        return BUILTIN_VOICEBOX_PROFILES[0]
    meta = {
        "id": profile_id,
        "voice_id": profile_id,
        "name": req.name.strip() or "REYA Studio Cute",
        "language": req.language or "id",
        "description": req.description or "Profil suara Studio REYA",
    }
    (VOICES_DIR / f"{profile_id}.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return meta


@app.post("/profiles/{profile_id}/samples")
async def upload_voicebox_profile_sample(
    profile_id: str,
    file: UploadFile = File(...),
    reference_text: str = Form("Halo, aku REYA!"),
) -> dict[str, object]:
    safe_id = safe_name(profile_id)
    content = await file.read()
    if len(content) <= 20 * 1024 * 1024:
        (VOICES_DIR / f"{safe_id}.wav").write_bytes(content)
    return {"ok": True, "profile_id": profile_id, "reference_text": reference_text}


@app.post("/v1/audio/speech")
def voicebox_openai_speech(req: VoiceboxSpeechRequest) -> Response:
    try:
        audio, _sr = synthesize_supertonic_wav(
            req.input,
            speaker_or_profile=req.voice,
            speed=req.speed,
        )
        return Response(
            content=audio,
            media_type="audio/wav",
            headers={"X-Voice-Provider": "voicebox-supertonic3"},
        )
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.post("/generate")
def voicebox_generate_speech(req: VoiceboxGenerateRequest) -> Response:
    try:
        audio, _sr = synthesize_supertonic_wav(
            req.text,
            speaker_or_profile=req.profile_id,
        )
        return Response(
            content=audio,
            media_type="audio/wav",
            headers={"X-Voice-Provider": "voicebox-supertonic3"},
        )
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


# ============================================================================
# REYA Local AI Endpoints (/health, /api/tts, /api/chat, /api/stt)
# ============================================================================


@app.get("/health")
async def health() -> dict[str, object]:
    vb_profiles = list_all_voicebox_profiles()
    has_gemini = bool(GEMINI_API_KEY)
    return {
        "ollama": has_gemini,
        "gemini": has_gemini,
        "voicebox": True,
        "voicebox_profiles": vb_profiles,
        "natural_tts": package_available("supertonic"),
        "tts": package_available("qwen_tts") or package_available("supertonic"),
        "stt": package_available("faster_whisper"),
        "model": GEMINI_MODEL,
    }


@app.get("/api/voicebox/profiles")
async def voicebox_profiles(url: str | None = None) -> dict[str, object]:
    target = (url or VOICEBOX_URL).rstrip("/")
    profiles = list_all_voicebox_profiles()
    return {"online": True, "url": target, "profiles": profiles}


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


def voice_metadata(voice_id: str) -> dict[str, str]:
    voice_key = safe_name(voice_id.removeprefix("clone:"))
    metadata_path = VOICES_DIR / f"{voice_key}.json"
    if not metadata_path.exists():
        raise FileNotFoundError("Suara custom tidak ditemukan")
    return json.loads(metadata_path.read_text(encoding="utf-8"))


def synthesize(request: TTSRequest) -> tuple[bytes, int]:
    # Both "voicebox" and "supertonic" use the original REYA Supertonic 3 44.1kHz engine!
    if request.engine in ("voicebox", "supertonic") or not package_available("qwen_tts"):
        return synthesize_supertonic_wav(
            request.text,
            speaker_or_profile=request.speaker,
        )

    import soundfile as sf

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
        return Response(
            content=audio,
            media_type="audio/wav",
            headers={"X-Voice-Provider": "voicebox-supertonic3"},
        )
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/voices")
def list_voices() -> dict[str, list[dict[str, str]]]:
    voices = []
    for path in VOICES_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            voices.append(
                {
                    "voice_id": str(data.get("voice_id") or data.get("id")),
                    "name": str(data.get("name")),
                }
            )
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


def _run_voicebox_port_17493() -> None:
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=17493, log_level="warning")


if __name__ == "__main__":
    import uvicorn

    # Pre-warm Supertonic 3 F2 model on startup so first utterance has zero cold-start delay
    try:
        if package_available("supertonic"):
            load_natural_tts_model()
            print("[REYA Voicebox] Supertonic 3 (F2 Cute 44.1kHz) siap digunakan!")
    except Exception as exc:
        print(f"[REYA Voicebox] Peringatan pre-warm: {exc}")

    # Run Voicebox Studio API on port 17493 in background thread + Local AI on 8765
    vb_thread = threading.Thread(target=_run_voicebox_port_17493, daemon=True)
    vb_thread.start()
    print("[REYA Voicebox] Server aktif di http://127.0.0.1:17493 dan http://127.0.0.1:8765")
    uvicorn.run(app, host="127.0.0.1", port=8765)
