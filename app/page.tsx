"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";

const API_BASE = "http://127.0.0.1:8765";
const OPENROUTER_API_KEY = process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL =
  process.env.NEXT_PUBLIC_OPENROUTER_MODEL || "google/gemma-4-26b-a4b-it:free";
const FALLBACK_MODELS = [
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "openai/gpt-oss-20b:free",
  "openrouter/free",
];

type Message = { role: "user" | "assistant"; content: string };
type Health = {
  ollama: boolean;
  openrouter?: boolean;
  natural_tts: boolean;
  tts: boolean;
  stt: boolean;
  model?: string;
};
type VoiceEngine = "supertonic" | "qwen" | "browser";
type MusicModeId = "piano" | "bells" | "drums" | "synth" | "beats";
type MusicMode = {
  id: MusicModeId;
  icon: string;
  name: string;
  caption: string;
  instruction: string;
  drumLabels?: string[];
};
type Landmark = { x: number; y: number; z?: number };
type HandInfo = {
  name: string;
  score: number;
  landmarks: Landmark[];
  handedness: string;
};
type HandPosition = { x: number; y: number; note: string; playing: boolean };
type HandPositions = { left?: HandPosition; right?: HandPosition };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

const gestureLabels: Record<string, string> = {
  None: "Mencari tangan…",
  Closed_Fist: "⏹ Stop",
  Open_Palm: "▶ Aktivasi",
  Pointing_Up: "♪ Bermain",
  Thumb_Down: "⏹ Stop",
  Thumb_Up: "🔥 Boost",
  Victory: "⏭ Ganti mode",
  ILoveYou: "💥 Drop",
};

const handConnections = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/* ─── Pentatonic scale engine ─── */
const C0 = 16.352;
const PENTA_SEMI = [0, 2, 4, 7, 9];
const PENTA_NAME = ["C", "D", "E", "G", "A"];

function buildScale(startOctave: number, numOctaves: number) {
  const notes: { freq: number; name: string }[] = [];
  for (let o = 0; o < numOctaves; o++) {
    for (let n = 0; n < 5; n++) {
      const oct = startOctave + o;
      notes.push({
        freq: C0 * Math.pow(2, oct + PENTA_SEMI[n] / 12),
        name: `${PENTA_NAME[n]}${oct}`,
      });
    }
  }
  notes.push({ freq: C0 * Math.pow(2, startOctave + numOctaves), name: `C${startOctave + numOctaves}` });
  return notes;
}

const melodyScale = buildScale(3, 3);
const bassScale = buildScale(2, 2);

function yToNote(y: number, scale: { freq: number; name: string }[]) {
  const t = 1 - Math.max(0, Math.min(0.999, y));
  const i = Math.round(t * (scale.length - 1));
  return scale[Math.max(0, Math.min(scale.length - 1, i))];
}

/* ─── Music modes ─── */
const musicModes: MusicMode[] = [
  {
    id: "piano",
    icon: "🎹",
    name: "Piano Pelangi",
    caption: "Nada lembut mengalir",
    instruction: "Angkat tangan tinggi untuk nada tinggi, turunkan untuk rendah. Geser kiri-kanan untuk brightness.",
  },
  {
    id: "bells",
    icon: "✨",
    name: "Lonceng Bintang",
    caption: "Nada bening & dreamy",
    instruction: "Angkat tangan pelan-pelan untuk nada bening yang naik. Tangan rendah membunyikan lonceng dalam.",
  },
  {
    id: "drums",
    icon: "🥁",
    name: "Drum Pop",
    caption: "Pukul ritme sendiri",
    instruction: "Tangan tinggi → hi-hat & crash. Tangan rendah → kick & tom. Gerakkan tangan cepat ke bawah untuk pukul.",
    drumLabels: ["Kick", "Tom", "Pop", "Snare", "Clap", "Hi-hat", "Rim", "Crash"],
  },
  {
    id: "synth",
    icon: "🪐",
    name: "Synth Orbit",
    caption: "Nada robot futuristik",
    instruction: "Tangan tinggi = synth tajam, tangan rendah = sub-bass tebal. Kiri-kanan ubah warna suara.",
  },
  {
    id: "beats",
    icon: "🤖",
    name: "Beat Robot",
    caption: "Pola ritme instan",
    instruction: "Ketinggian tangan memilih pola beat berbeda. Gerakkan naik-turun untuk variasi irama.",
    drumLabels: ["Bop", "Hop", "Tik", "Clap", "Disco", "Game", "Cute", "Final"],
  },
];

/* ─── Audio synthesis ─── */
function playNote(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  mode: MusicModeId,
  brightness: number,
  pan: number,
  isBass: boolean,
) {
  const t = ctx.currentTime;
  const dur = isBass ? 0.75 : 0.5;
  const vol = isBass ? 0.3 : 0.4;

  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(pan * 0.6, t);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(500 + brightness * 4500, t);
  filter.Q.value = 1.5;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, t);

  filter.connect(panner);
  panner.connect(gain);
  gain.connect(dest);

  const voice = (ratio: number, volume: number, type: OscillatorType, length: number, target = filter as AudioNode) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq * ratio, t);
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(volume, t + 0.016);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    o.connect(g);
    g.connect(target);
    o.start(t);
    o.stop(t + length + 0.03);
  };

  if (mode === "piano") {
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    voice(1, vol, "triangle", dur);
    voice(2, vol * 0.08, "sine", dur * 0.6);
  } else if (mode === "bells") {
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur * 1.5);
    voice(1, vol * 0.9, "sine", dur * 1.4);
    voice(2.76, vol * 0.18, "sine", dur * 0.8, panner);
    voice(4.07, vol * 0.06, "sine", dur * 0.5, panner);
  } else if (mode === "synth") {
    gain.gain.exponentialRampToValueAtTime(vol * 0.7, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.8);
    voice(1, vol * 0.6, isBass ? "square" : "sawtooth", dur * 0.75);
    voice(1.005, vol * 0.4, isBass ? "square" : "sawtooth", dur * 0.6);
  } else if (mode === "beats") {
    gain.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * (isBass ? 0.5 : 2), t + 0.1);
    o.connect(filter);
    o.start(t);
    o.stop(t + 0.25);
  }
}

function playChord(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  mode: MusicModeId,
  brightness: number,
  pan: number,
) {
  playNote(ctx, dest, freq, mode, brightness, pan, false);
  playNote(ctx, dest, freq * Math.pow(2, 4 / 12), mode, brightness, pan, false);
  playNote(ctx, dest, freq * Math.pow(2, 7 / 12), mode, brightness, pan, false);
}

function scheduleDrumHit(
  context: AudioContext,
  destination: AudioNode,
  pad: number,
  when = context.currentTime,
) {
  const kind = pad % 8;
  if (kind === 0 || kind === 4) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(kind === 0 ? 155 : 105, when);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 0 ? 42 : 62, when + 0.2);
    gain.gain.setValueAtTime(0.7, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.24);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(when);
    oscillator.stop(when + 0.25);
    return;
  }

  const duration = kind === 2 || kind === 6 ? 0.09 : 0.2;
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * duration)), context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < channel.length; index += 1) {
    const fade = 1 - index / channel.length;
    channel[index] = (Math.random() * 2 - 1) * fade;
  }
  const noise = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  noise.buffer = buffer;
  filter.type = kind === 2 || kind === 6 ? "highpass" : "bandpass";
  filter.frequency.value = kind === 2 ? 6500 : kind === 6 ? 4200 : 1700;
  gain.gain.setValueAtTime(kind === 2 ? 0.26 : 0.42, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  noise.start(when);
  noise.stop(when + duration);
}

function scheduleBeatPattern(
  context: AudioContext,
  destination: AudioNode,
  patternIndex: number,
) {
  const patterns = [
    [[0, 0], [2, 1], [1, 2], [2, 3]],
    [[0, 0], [2, 1], [0, 2], [1, 3]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[1, 0], [3, 1], [1, 2], [3, 3]],
    [[0, 0], [2, 1], [1, 2], [2, 2.5], [3, 3]],
    [[0, 0], [6, 1], [4, 2], [6, 3]],
    [[0, 0], [3, 1], [2, 2], [3, 2.5], [1, 3]],
    [[0, 0], [2, 0.5], [1, 1], [3, 1.5], [0, 2], [7, 3]],
  ];
  const startAt = context.currentTime;
  for (const [pad, step] of patterns[patternIndex % patterns.length]) {
    scheduleDrumHit(context, destination, pad, startAt + step * 0.15);
  }
}

function playDropEffect(ctx: AudioContext, dest: AudioNode) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(200, t);
  osc.frequency.exponentialRampToValueAtTime(35, t + 0.5);
  g.gain.setValueAtTime(0.55, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + 0.9);
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.15), ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
  const noise = ctx.createBufferSource();
  const ng = ctx.createGain();
  noise.buffer = buf;
  ng.gain.setValueAtTime(0.25, t + 0.45);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
  noise.connect(ng);
  ng.connect(dest);
  noise.start(t + 0.45);
  noise.stop(t + 0.75);
}

const starterMessages: Message[] = [
  {
    role: "assistant",
    content:
      "Hai! Aku REYA. Aku siap ngobrol cepat lewat mic, melihat gesture tanganmu, dan bermain musik. Mau ngobrol apa hari ini?",
  },
];

function fallbackAnswer(text: string) {
  const normalized = text.toLowerCase();
  if (normalized.includes("siapa") || normalized.includes("nama")) {
    return "Namaku REYA, robot AI sahabatmu! Aku bisa bicara cepat, mendengar suara, dan bermain musik gesture.";
  }
  if (normalized.includes("musik")) {
    return "Ayo main musik! Buka telapak tanganmu ✋ untuk mulai, lalu angkat tangan tinggi untuk nada tinggi dan turunkan untuk nada rendah!";
  }
  if (normalized.includes("kamera") || normalized.includes("tangan")) {
    return "Nyalakan kamera untuk mencoba gesture tangan: ✋ aktivasi, ☝️ nada, 👍 boost, 🤟 drop, dan ✊ stop.";
  }
  if (normalized.includes("halo") || normalized.includes("hai")) {
    return "Halo! Senang banget ketemu kamu! Mau langsung ngobrol santai atau coba main musik bareng?";
  }
  return "Aku siap mendengar dan berbicara! Coba tanyakan apa saja atau aktifkan mode ngobrol langsung.";
}

async function convertRecordingToWav(blob: Blob) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const sampleRate = decoded.sampleRate;
    const frames = decoded.length;
    const channels = Math.min(decoded.numberOfChannels, 2);
    const bytesPerSample = 2;
    const buffer = new ArrayBuffer(44 + frames * channels * bytesPerSample);
    const view = new DataView(buffer);
    const writeText = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    writeText(0, "RIFF");
    view.setUint32(4, 36 + frames * channels * bytesPerSample, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, frames * channels * bytesPerSample, true);
    let offset = 44;
    const channelData = Array.from({ length: channels }, (_, channel) => decoded.getChannelData(channel));
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += bytesPerSample;
      }
    }
    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    await context.close();
  }
}

async function getBrowserVoices() {
  const available = window.speechSynthesis.getVoices();
  if (available.length) return available;
  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.speechSynthesis.removeEventListener("voiceschanged", finish);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", finish);
    window.setTimeout(finish, 1200);
  });
}

function RobotFace({
  speaking,
  listening,
  thinking,
  mood,
}: {
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  mood: number;
}) {
  return (
    <div className={`robot-wrap mood-${mood} ${speaking ? "is-speaking" : ""} ${thinking ? "is-thinking" : ""}`}>
      <div className="signal-orbit orbit-one" />
      <div className="signal-orbit orbit-two" />
      <div className="robot-ears">
        <span />
        <span />
      </div>
      <div className="robot-head">
        <div className="head-sheen" />
        <div className="robot-screen">
          <div className="eye eye-left"><span /></div>
          <div className="eye eye-right"><span /></div>
          <div className="robot-mouth">
            <i /><i /><i /><i /><i />
          </div>
        </div>
        <div className="cheek cheek-left" />
        <div className="cheek cheek-right" />
      </div>
      <div className={`listen-ring ${listening ? "active" : ""} ${thinking ? "thinking" : ""}`}>
        {listening ? "🎙 MENDENGARKAN" : thinking ? "⚡ BERPIKIR…" : speaking ? "♫ BERBICARA" : "REYA ONLINE"}
      </div>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>(starterMessages);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceChatMode, setVoiceChatMode] = useState(false);
  const [health, setHealth] = useState<Health>({ ollama: false, openrouter: true, natural_tts: false, tts: false, stt: false });
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraExpanded, setCameraExpanded] = useState(false);
  const [cameraAspect, setCameraAspect] = useState<number | null>(null);
  const [gesture, setGesture] = useState("None");
  const [gestureScore, setGestureScore] = useState(0);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicMode, setMusicMode] = useState<MusicModeId>("piano");
  const [handPositions, setHandPositions] = useState<HandPositions>({});
  const [lastPlayedLabel, setLastPlayedLabel] = useState("Siap bermain — buka telapak tangan ✋");
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngine>("supertonic");
  const [voiceProfile, setVoiceProfile] = useState("F2");
  const [voiceStyle, setVoiceStyle] = useState("Suara perempuan muda yang cute, ceria, playful, hangat, ekspresif, lembut, dan natural seperti karakter robot sahabat");
  const [mood, setMood] = useState(0);
  const [voiceModal, setVoiceModal] = useState(false);
  const [voiceName, setVoiceName] = useState("Suara Saya");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [toast, setToast] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognizerRef = useRef<GestureRecognizer | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const lastGestureAtRef = useRef(0);
  const lastGestureRef = useRef("None");
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const noteReleaseTimerRef = useRef<number | null>(null);
  const musicPlayingRef = useRef(false);
  const musicModeRef = useRef<MusicModeId>("piano");
  const handMusicRef = useRef({ melody: { freq: 0, at: 0 }, bass: { freq: 0, at: 0 } });
  const previousPalmRef = useRef<{ y: number; at: number } | null>(null);
  const lastStrikeAtRef = useRef(0);
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  const micChunksRef = useRef<Blob[]>([]);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const fallbackNoticeRef = useRef(false);
  const voiceChatModeRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const listenRef = useRef<() => void>(() => undefined);
  const speakRef = useRef<(text: string) => void>(() => undefined);

  useEffect(() => {
    voiceChatModeRef.current = voiceChatMode;
  }, [voiceChatMode]);

  const statusText = useMemo(() => {
    if (OPENROUTER_API_KEY) return "⚡ OpenRouter AI Cepat · Siap Bicara";
    if (health.ollama && health.natural_tts) return "Otak & suara natural aktif";
    if (health.natural_tts) return "Suara natural Indonesia aktif";
    if (health.ollama) return "Ollama aktif · suara perangkat";
    return "Mode demo · siap disambungkan";
  }, [health]);

  const changeVoiceEngine = useCallback((engine: VoiceEngine) => {
    setVoiceEngine(engine);
    fallbackNoticeRef.current = false;
    if (engine === "supertonic") setVoiceProfile("F2");
    if (engine === "qwen") setVoiceProfile("Serena");
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const response = await fetch(`${API_BASE}/health`, {
          signal: AbortSignal.timeout(1800),
        });
        const data = (await response.json()) as Health;
        if (mounted) setHealth(data);
      } catch {
        if (mounted) setHealth({ ollama: false, openrouter: true, natural_tts: false, tts: false, stt: false });
      }
    };
    void check();
    const timer = window.setInterval(check, 12000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const ensureMusicAudio = useCallback(() => {
    let context = audioContextRef.current;
    let master = masterGainRef.current;
    if (!context || context.state === "closed" || !master) {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return null;
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = 0.2;
      master.connect(context.destination);
      audioContextRef.current = context;
      masterGainRef.current = master;
    }
    if (context.state === "suspended") void context.resume();
    return { context, master };
  }, []);

  const stopMusic = useCallback(() => {
    if (noteReleaseTimerRef.current) window.clearTimeout(noteReleaseTimerRef.current);
    noteReleaseTimerRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.close();
    audioContextRef.current = null;
    masterGainRef.current = null;
    musicPlayingRef.current = false;
    handMusicRef.current = { melody: { freq: 0, at: 0 }, bass: { freq: 0, at: 0 } };
    previousPalmRef.current = null;
    setHandPositions({});
    setMusicPlaying(false);
    setLastPlayedLabel("Berhenti — buka telapak ✋ untuk mulai lagi");
  }, []);

  const startMusic = useCallback(() => {
    if (!ensureMusicAudio()) return;
    musicPlayingRef.current = true;
    setMusicPlaying(true);
    setLastPlayedLabel("Sensor aktif — angkat ☝️ dan gerakkan tanganmu naik-turun");
  }, [ensureMusicAudio]);

  const selectMusicMode = useCallback((nextMode: MusicModeId) => {
    musicModeRef.current = nextMode;
    setMusicMode(nextMode);
    handMusicRef.current = { melody: { freq: 0, at: 0 }, bass: { freq: 0, at: 0 } };
    previousPalmRef.current = null;
    setHandPositions({});
    const next = musicModes.find((mode) => mode.id === nextMode) ?? musicModes[0];
    setLastPlayedLabel(`${next.icon} ${next.name} siap dimainkan`);
  }, []);

  /* ─── Multi-hand music handler ─── */
  const handleHandMusic = useCallback((hands: HandInfo[], now: number) => {
    if (!musicPlayingRef.current) return;
    const audio = ensureMusicAudio();
    if (!audio) return;

    const mode = musicModeRef.current;
    const newPositions: HandPositions = {};

    for (const hand of hands) {
      if (hand.score < 0.5) continue;
      const tip = hand.landmarks[8];
      const palm = hand.landmarks[9] ?? hand.landmarks[0];
      if (!tip) continue;

      const isRight = hand.handedness === "Right";
      const isBass = !isRight;
      const key = isRight ? "right" as const : "left" as const;
      const scale = isBass ? bassScale : melodyScale;
      const stateKey = isBass ? "bass" as const : "melody" as const;

      const isPlaying = hand.name === "Pointing_Up" || hand.name === "Open_Palm";
      const screenX = 1 - tip.x;
      const brightness = Math.max(0, Math.min(1, screenX));
      const pan = screenX * 2 - 1;

      if (isPlaying) {
        const note = yToNote(tip.y, scale);
        const prev = handMusicRef.current[stateKey];
        const freqChanged = Math.abs(note.freq - prev.freq) > 1;
        const elapsed = now - prev.at;
        const isDrum = mode === "drums" || mode === "beats";
        const cooldown = isDrum ? 160 : 75;

        if (freqChanged && elapsed > cooldown) {
          handMusicRef.current[stateKey] = { freq: note.freq, at: now };

          if (mode === "drums") {
            const padIndex = Math.floor((1 - Math.max(0, Math.min(0.999, tip.y))) * 7.99);
            scheduleDrumHit(audio.context, audio.master, padIndex);
          } else if (mode === "beats") {
            const padIndex = Math.floor((1 - Math.max(0, Math.min(0.999, tip.y))) * 7.99);
            scheduleBeatPattern(audio.context, audio.master, padIndex);
          } else if (hand.name === "Open_Palm") {
            playChord(audio.context, audio.master, note.freq, mode, brightness, pan);
          } else {
            playNote(audio.context, audio.master, note.freq, mode, brightness, pan, isBass);
          }
        }

        const modeInfo = musicModes.find((m) => m.id === mode) ?? musicModes[0];
        const label = isDrum && modeInfo.drumLabels
          ? modeInfo.drumLabels[Math.floor((1 - Math.max(0, Math.min(0.999, tip.y))) * 7.99)]
          : note.name;
        newPositions[key] = { x: tip.x, y: tip.y, note: label ?? note.name, playing: true };
      } else {
        newPositions[key] = { x: tip.x, y: tip.y, note: "", playing: false };
      }

      /* drum strike on fast downward motion */
      if (isDrumLike(mode) && palm) {
        const prev = previousPalmRef.current;
        const dt = prev ? Math.max(0.016, (now - prev.at) / 1000) : 0;
        const velocity = prev ? (palm.y - prev.y) / dt : 0;
        if (velocity > 0.5 && now - lastStrikeAtRef.current > 170) {
          lastStrikeAtRef.current = now;
          const padIndex = Math.floor((1 - Math.max(0, Math.min(0.999, tip.y))) * 7.99);
          scheduleDrumHit(audio.context, audio.master, padIndex);
        }
        previousPalmRef.current = { y: palm.y, at: now };
      }
    }

    setHandPositions(newPositions);
  }, [ensureMusicAudio]);

  /* ─── Gesture actions (modern reactive style) ─── */
  const runGestureAction = useCallback((name: string) => {
    const now = performance.now();
    if (name === lastGestureRef.current && now - lastGestureAtRef.current < 2200) return;
    lastGestureRef.current = name;
    lastGestureAtRef.current = now;

    if (name === "Open_Palm") {
      if (!musicPlayingRef.current) {
        startMusic();
        showToast("🎵 Musik aktif! Angkat tanganmu ☝️");
      }
    } else if (name === "Closed_Fist" || name === "Thumb_Down") {
      if (musicPlayingRef.current) {
        stopMusic();
        showToast("⏹ Musik dihentikan");
      }
    } else if (name === "Victory") {
      if (musicPlayingRef.current) {
        const currentIndex = musicModes.findIndex((mode) => mode.id === musicModeRef.current);
        const nextMode = musicModes[(currentIndex + 1) % musicModes.length];
        selectMusicMode(nextMode.id);
        showToast(`⏭ ${nextMode.name}`);
      } else {
        setMood((current) => (current + 1) % 3);
        showToast("Mood REYA berubah ✨");
      }
    } else if (name === "Thumb_Up") {
      if (musicPlayingRef.current && masterGainRef.current && audioContextRef.current) {
        const g = masterGainRef.current;
        const t = audioContextRef.current.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(0.5, t);
        g.gain.linearRampToValueAtTime(0.2, t + 2);
        showToast("🔥 Boost!");
        setMood((m) => (m + 1) % 3);
      } else {
        startMusic();
        showToast("🎵 Musik aktif!");
      }
    } else if (name === "ILoveYou") {
      const audio = ensureMusicAudio();
      if (audio) {
        musicPlayingRef.current = true;
        setMusicPlaying(true);
        playDropEffect(audio.context, audio.master);
        showToast("💥 Drop!");
      }
    } else if (name === "Pointing_Up") {
      if (!musicPlayingRef.current) listenRef.current();
    }
  }, [ensureMusicAudio, selectMusicMode, showToast, startMusic, stopMusic]);

  /* ─── Draw multi-hand skeleton ─── */
  const drawHands = useCallback((allLandmarks: Landmark[][], handedness: string[]) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    allLandmarks.forEach((landmarks, idx) => {
      const isRight = handedness[idx] === "Right";
      const stroke = isRight ? "rgba(141, 255, 210, .92)" : "rgba(200, 160, 255, .92)";
      const fill = isRight ? "#f4ff8a" : "#d4b0ff";

      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(3, width / 200);
      ctx.lineCap = "round";
      for (const [start, end] of handConnections) {
        const a = landmarks[start];
        const b = landmarks[end];
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo((1 - a.x) * width, a.y * height);
        ctx.lineTo((1 - b.x) * width, b.y * height);
        ctx.stroke();
      }

      ctx.fillStyle = fill;
      landmarks.forEach((point, i) => {
        ctx.beginPath();
        ctx.arc((1 - point.x) * width, point.y * height, i % 4 === 0 ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
      });

      /* Glow ring around index finger tip */
      const tip = landmarks[8];
      if (tip) {
        ctx.strokeStyle = isRight ? "rgba(141, 255, 210, .55)" : "rgba(200, 160, 255, .55)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc((1 - tip.x) * width, tip.y * height, 18, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }, []);

  const handleSpeechEnd = useCallback(() => {
    isSpeakingRef.current = false;
    setSpeaking(false);
    // If voice conversation mode is on, auto-listen for next user utterance
    if (voiceChatModeRef.current) {
      window.setTimeout(() => {
        if (voiceChatModeRef.current && !isSpeakingRef.current) {
          listenRef.current();
        }
      }, 400);
    }
  }, []);

  const playCuteAudio = useCallback(async (text: string): Promise<boolean> => {
    try {
      const clean = text.replace(/[*_#`~]/g, "").trim();
      if (!clean) return false;
      const res = await fetch(`/api/tts?text=${encodeURIComponent(clean.slice(0, 300))}`);
      if (!res.ok) return false;
      const blob = await res.blob();
      if (!blob || blob.size < 100) return false;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return false;
      const ctx = new AudioCtx();
      if (ctx.state === "suspended") await ctx.resume();

      const arrayBuf = await blob.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuf);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = 1.13; // cute, youthful, anime-robot pitch & energetic cadence!

      const filter = ctx.createBiquadFilter();
      filter.type = "highshelf";
      filter.frequency.value = 3200;
      filter.gain.value = 2.5;

      source.connect(filter);
      filter.connect(ctx.destination);

      isSpeakingRef.current = true;
      setSpeaking(true);

      source.onended = () => {
        handleSpeechEnd();
        void ctx.close();
      };

      source.start(0);
      return true;
    } catch {
      return false;
    }
  }, [handleSpeechEnd]);

  const browserSpeak = useCallback(async (text: string) => {
    if (!("speechSynthesis" in window)) {
      handleSpeechEnd();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#`~]/g, ""));
    utterance.lang = "id-ID";
    utterance.rate = 1.08; // cheerful, lively cadence
    utterance.pitch = 1.32; // cute, cheerful, high-pitch anime robot voice
    const voices = await getBrowserVoices();
    const isIndonesian = (voice: SpeechSynthesisVoice) =>
      voice.lang.toLowerCase().startsWith("id") || voice.lang.toLowerCase().startsWith("in");
    const isGoogleIndo = (voice: SpeechSynthesisVoice) =>
      isIndonesian(voice) && /google/i.test(voice.name);
    const soundsFeminine = (voice: SpeechSynthesisVoice) =>
      /gadis|dewi|siti|female|woman|serena|zira|sara|samantha|aria|ava|jenny|natasha|sonia|tessa/i.test(voice.name);
    const isMalay = (voice: SpeechSynthesisVoice) => voice.lang.toLowerCase().startsWith("ms");

    utterance.voice =
      voices.find(isGoogleIndo) ??
      voices.find((voice) => isIndonesian(voice) && soundsFeminine(voice)) ??
      voices.find(isIndonesian) ??
      voices.find((voice) => isMalay(voice) && soundsFeminine(voice)) ??
      voices.find(soundsFeminine) ??
      null;

    utterance.onstart = () => {
      isSpeakingRef.current = true;
      setSpeaking(true);
    };
    utterance.onend = handleSpeechEnd;
    utterance.onerror = handleSpeechEnd;
    window.speechSynthesis.speak(utterance);
  }, [handleSpeechEnd]);

  const speak = useCallback(async (text: string) => {
    // 1. High-Quality Natural Cute Indonesian Voice (Online & Vercel)
    const cuteOk = await playCuteAudio(text);
    if (cuteOk) return;

    // 2. Local Python Server (Supertonic F2) if running locally
    if (voiceEngine !== "browser") {
      try {
        isSpeakingRef.current = true;
        setSpeaking(true);
        const response = await fetch(`${API_BASE}/api/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            engine: voiceEngine,
            speaker: voiceProfile,
            instruction: voiceStyle,
            language: "Auto",
          }),
        });
        if (response.ok) {
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.onended = () => {
            URL.revokeObjectURL(url);
            handleSpeechEnd();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            browserSpeak(text);
          };
          await audio.play();
          return;
        }
      } catch {
        // Fall through
      }
    }

    // 3. Tuned High-Pitch Browser Speech
    void browserSpeak(text);
  }, [browserSpeak, handleSpeechEnd, playCuteAudio, voiceEngine, voiceProfile, voiceStyle]);

  useEffect(() => {
    speakRef.current = (text: string) => void speak(text);
  }, [speak]);

  /* ─── Fast OpenRouter AI Chat (real-time conversation) ─── */
  const askRobot = useCallback(async (rawText?: string) => {
    const text = (rawText ?? input).trim();
    if (!text || thinking) return;
    const userMessage: Message = { role: "user", content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setThinking(true);
    let answer = "";

    const systemPrompt =
      "Kamu adalah REYA, robot AI perempuan yang sangat imut, ceria, manis, ramah, dan pintar seperti karakter anime chibi sahabat terbaik! " +
      "Aturan bicara REYA: " +
      "1. Selalu gunakan Bahasa Indonesia percakapan yang santai, luwes, imut, dan akrab (gunakan kata-kata seperti: 'aku', 'kamu', 'nih', 'dong', 'yuk', 'hehe', 'wah', 'senang banget', 'yay!'). " +
      "2. JANGAN PERNAH gunakan bahasa formal kaku seperti: 'Anda', 'Saya siap membantu', 'Sebagai AI', 'Tentu saja'. " +
      "3. Jawablah singkat, manis, dan ekspresif (1-2 kalimat pendek) layaknya sedang ngobrol santai langsung lewat suara. " +
      "4. Jawablah langsung ke inti pembicaraan dengan nada hangat dan ceria!";

    const cleanCuteResponse = (raw: string) => {
      return raw
        .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
        .replace(/^(?:Here's a thinking process|Thinking Process:)[\s\S]*?\n\n/i, "")
        .replace(/\*.*?\*/g, "")
        .replace(/[#_`]/g, "")
        .trim();
    };

    // 1. Direct OpenRouter call with fallback models (Fastest for conversation)
    if (OPENROUTER_API_KEY) {
      for (const modelToTry of FALLBACK_MODELS) {
        if (answer) break;
        try {
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "http://localhost:3088",
              "X-Title": "REYA Robot AI",
            },
            body: JSON.stringify({
              model: modelToTry,
              messages: [
                { role: "system", content: systemPrompt },
                ...nextMessages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
              ],
              max_tokens: 120,
              temperature: 0.85,
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (response.ok) {
            const data = (await response.json()) as {
              choices?: Array<{ message?: { content?: string } }>;
            };
            const candidate = cleanCuteResponse(data.choices?.[0]?.message?.content ?? "");
            if (candidate) {
              answer = candidate;
              break;
            }
          }
        } catch {
          // Try next fallback model
        }
      }
    }

    // 2. Try Python backend /api/chat if direct OpenRouter was skipped or failed
    if (!answer) {
      try {
        const response = await fetch(`${API_BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: nextMessages.slice(-10) }),
          signal: AbortSignal.timeout(30000),
        });
        if (response.ok) {
          const data = (await response.json()) as { message: string };
          answer = data.message.trim();
        }
      } catch {
        // Fall through
      }
    }

    // 3. Try Local Ollama direct
    if (!answer) {
      try {
        const response = await fetch("http://127.0.0.1:11434/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "qwen3:4b",
            stream: false,
            messages: [
              { role: "system", content: systemPrompt },
              ...nextMessages.slice(-8),
            ],
            options: { num_predict: 140 },
          }),
          signal: AbortSignal.timeout(45000),
        });
        if (response.ok) {
          const data = (await response.json()) as { message?: { content?: string } };
          answer = data.message?.content?.trim() ?? "";
        }
      } catch {
        // Fall through
      }
    }

    if (!answer) {
      answer = fallbackAnswer(text);
    }

    const assistantMessage: Message = { role: "assistant", content: answer };
    setMessages((current) => [...current, assistantMessage]);
    setThinking(false);
    void speak(answer);
  }, [input, messages, speak, thinking]);

  const startBrowserRecognition = useCallback(() => {
    if (isSpeakingRef.current) return;
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      showToast("Pengenalan suara browser tidak tersedia. Ketik pesan saja ya.");
      setListening(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "id-ID";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      setInput(transcript);
      if (transcript.trim()) void askRobot(transcript);
    };
    recognition.onend = () => {
      setListening(false);
    };
    recognition.onerror = () => {
      setListening(false);
    };
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
    }
  }, [askRobot, showToast]);

  const stopLocalRecording = useCallback(() => {
    if (micRecorderRef.current?.state === "recording") micRecorderRef.current.stop();
  }, []);

  const startListening = useCallback(async () => {
    if (isSpeakingRef.current) return;
    if (listening) {
      stopLocalRecording();
      setListening(false);
      return;
    }
    if (!health.stt) {
      startBrowserRecognition();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      micChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) micChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setListening(false);
        const blob = new Blob(micChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const form = new FormData();
        form.append("audio", blob, "ucapan.webm");
        try {
          const response = await fetch(`${API_BASE}/api/stt`, { method: "POST", body: form });
          if (!response.ok) throw new Error("STT gagal");
          const data = (await response.json()) as { text: string };
          setInput(data.text);
          if (data.text.trim()) void askRobot(data.text);
        } catch {
          showToast("Suara belum terbaca. Coba lagi atau ketik pesan.");
        }
      };
      micRecorderRef.current = recorder;
      setListening(true);
      recorder.start();
      window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 7000);
    } catch {
      startBrowserRecognition();
    }
  }, [askRobot, health.stt, listening, showToast, startBrowserRecognition, stopLocalRecording]);

  useEffect(() => {
    listenRef.current = () => void startListening();
  }, [startListening]);

  const toggleVoiceChatMode = useCallback(() => {
    setVoiceChatMode((prev) => {
      const next = !prev;
      if (next) {
        showToast("🎙 Mode Ngobrol Suara Aktif! Bicara langsung tanpa tekan tombol.");
        void speak("Hai! Mode obrolan suara aktif. Silakan bicara kapan saja!");
      } else {
        showToast("Mode ngobrol suara dimatikan.");
      }
      return next;
    });
  }, [showToast, speak]);

  const stopCamera = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recognizerRef.current?.close();
    recognizerRef.current = null;
    const context = canvasRef.current?.getContext("2d");
    if (context && canvasRef.current) context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setCameraOn(false);
    setGesture("None");
    setGestureScore(0);
    setHandPositions({});
  }, []);

  const startCamera = useCallback(async () => {
    if (cameraOn) {
      stopCamera();
      return;
    }
    setCameraLoading(true);
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Video tidak tersedia");
      video.srcObject = stream;
      await video.play();

      if (video.videoWidth && video.videoHeight) {
        setCameraAspect(video.videoWidth / video.videoHeight);
      }

      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      let recognizer: GestureRecognizer;
      try {
        recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/models/gesture_recognizer.task", delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.5,
        });
      } catch {
        recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/models/gesture_recognizer.task", delegate: "CPU" },
          runningMode: "VIDEO",
          numHands: 2,
        });
      }
      recognizerRef.current = recognizer;
      setCameraOn(true);

      const detect = async () => {
        const activeVideo = videoRef.current;
        const activeRecognizer = recognizerRef.current;
        if (!activeVideo || !activeRecognizer || !streamRef.current) return;
        if (activeVideo.readyState >= 2 && activeVideo.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = activeVideo.currentTime;

          if (activeVideo.videoWidth && activeVideo.videoHeight) {
            const aspect = activeVideo.videoWidth / activeVideo.videoHeight;
            setCameraAspect(aspect);
          }

          const result = await activeRecognizer.recognizeForVideo(activeVideo, performance.now());

          const hands: HandInfo[] = [];
          const allLandmarks: Landmark[][] = [];
          const allHandedness: string[] = [];

          for (let i = 0; i < (result.landmarks?.length ?? 0); i++) {
            const topGesture = result.gestures?.[i]?.[0];
            const landmarks = result.landmarks[i] as Landmark[];
            const hd = (result.handedness as Array<Array<{ categoryName: string }>>)?.[i]?.[0]?.categoryName ?? "Right";

            allLandmarks.push(landmarks);
            allHandedness.push(hd);

            hands.push({
              name: topGesture?.categoryName ?? "None",
              score: topGesture?.score ?? 0,
              landmarks,
              handedness: hd,
            });
          }

          if (allLandmarks.length > 0) {
            drawHands(allLandmarks, allHandedness);
            handleHandMusic(hands, performance.now());
          } else {
            const canvas = canvasRef.current;
            canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
            setHandPositions({});
          }

          if (hands.length > 0) {
            setGesture(hands[0].name);
            setGestureScore(hands[0].score);
          }

          for (const hand of hands) {
            if (hand.score > 0.66 && hand.name !== "None") {
              runGestureAction(hand.name);
              break;
            }
          }
        }
        animationRef.current = requestAnimationFrame(() => void detect());
      };
      void detect();
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraError(error instanceof Error ? error.message : "Kamera tidak dapat diakses");
      setCameraOn(false);
    } finally {
      setCameraLoading(false);
    }
  }, [cameraOn, drawHands, handleHandMusic, runGestureAction, stopCamera]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recognizerRef.current?.close();
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (noteReleaseTimerRef.current) window.clearTimeout(noteReleaseTimerRef.current);
    if (audioContextRef.current) void audioContextRef.current.close();
  }, []);

  const recordCustomVoice = useCallback(async () => {
    if (voiceRecorderRef.current?.state === "recording") {
      voiceRecorderRef.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      voiceChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) voiceChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setVoiceRecording(false);
        const rawBlob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        try {
          setVoiceBlob(await convertRecordingToWav(rawBlob));
          showToast("Contoh suara tersimpan");
        } catch {
          setVoiceBlob(rawBlob);
          showToast("Contoh suara tersimpan dalam format asli");
        }
      };
      voiceRecorderRef.current = recorder;
      setVoiceRecording(true);
      recorder.start();
      showToast("Merekam suara selama 6 detik…");
      window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 6000);
    } catch {
      setVoiceRecording(false);
      showToast("Mikrofon tidak dapat diakses");
    }
  }, [showToast]);

  const saveCustomVoice = useCallback(async () => {
    if (!voiceBlob || !voiceTranscript.trim()) {
      showToast("Rekam suara dan tulis kalimat yang diucapkan");
      return;
    }
    setVoiceSaving(true);
    const form = new FormData();
    form.append("name", voiceName.trim() || "Suara Saya");
    form.append("transcript", voiceTranscript.trim());
    form.append("audio", voiceBlob, voiceBlob.type === "audio/wav" ? "referensi.wav" : "referensi.webm");
    try {
      const response = await fetch(`${API_BASE}/api/voices`, { method: "POST", body: form });
      if (!response.ok) throw new Error("Server suara belum siap");
      const data = (await response.json()) as { voice_id: string };
      setVoiceEngine("qwen");
      setVoiceProfile(data.voice_id);
      setVoiceModal(false);
      showToast("Suara custom siap dipakai");
    } catch {
      showToast("Nyalakan server AI lokal untuk menyimpan suara custom");
    } finally {
      setVoiceSaving(false);
    }
  }, [showToast, voiceBlob, voiceName, voiceTranscript]);

  const activeMusicMode = musicModes.find((mode) => mode.id === musicMode) ?? musicModes[0];

  const scaleLabels = useMemo(() => {
    if (musicMode === "drums" || musicMode === "beats") {
      return activeMusicMode.drumLabels ?? [];
    }
    return melodyScale.filter((_, i) => i % 2 === 0 || i === melodyScale.length - 1).map((n) => n.name);
  }, [musicMode, activeMusicMode]);

  const startMusicTutorial = useCallback(() => {
    startMusic();
    if (!cameraOn) void startCamera();
    const modeInfo = musicModes.find((mode) => mode.id === musicModeRef.current) ?? musicModes[0];
    speakRef.current(
      `Yay, ayo main ${modeInfo.name}! Buka telapak tanganmu untuk mulai. Angkat tangan tinggi untuk nada tinggi dan turunkan untuk nada rendah. ` +
      `Pakai dua tangan sekaligus — kiri untuk bass, kanan untuk melodi. ` +
      `Tunjukkan dua jari untuk ganti mode, dan kepalkan tangan untuk berhenti. Jempol ke atas untuk efek boost!`,
    );
    document.getElementById("music-lab")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [cameraOn, startCamera, startMusic]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="REYA beranda">
          <span className="brand-mark">R</span>
          <span><b>REYA</b><small>Robot AI Lokal</small></span>
        </a>
        <div className="top-status">
          <span className={`live-dot ${OPENROUTER_API_KEY || health.ollama ? "connected" : ""}`} />
          <span>{statusText}</span>
        </div>
        <div className="topbar-actions">
          <button
            className={`ghost-button voice-chat-toggle ${voiceChatMode ? "active" : ""}`}
            onClick={toggleVoiceChatMode}
            title="Ngobrol suara hands-free seperti telepon"
          >
            <span className="button-icon">🎙</span> {voiceChatMode ? "Obrolan Suara Aktif" : "Mode Suara"}
          </button>
          <button className="ghost-button" onClick={() => setVoiceModal(true)}>
            <span className="button-icon">◉</span> Studio Suara
          </button>
        </div>
      </header>

      <div className={`dashboard ${cameraExpanded ? "camera-expanded-view" : ""}`} id="top">
        <section className="robot-stage panel">
          <div className="stage-copy">
            <span className="eyebrow">TEMAN CERDAS DI PERANGKATMU</span>
            <h1>Halo, aku <em>REYA.</em></h1>
            <p>Ngobrol suara cepat dengan OpenRouter AI, melihat gesture tanganmu full-screen, dan bermain musik.</p>
            <div className="privacy-badges">
              <span>⚡ OpenRouter Cepat</span>
              <span>Bahasa Indonesia</span>
              <span>Kamera Adaptif</span>
              <span>Musik 2 Tangan</span>
            </div>
          </div>
          <RobotFace speaking={speaking} listening={listening} thinking={thinking} mood={mood} />
          <div className="robot-caption">
            <span className={`wave-mini ${speaking || listening ? "active" : ""}`}><i /><i /><i /><i /><i /></span>
            {speaking
              ? "REYA sedang berbicara…"
              : thinking
              ? "REYA sedang berpikir cepat…"
              : listening
              ? "Aku mendengarkanmu lewat mic…"
              : voiceChatMode
              ? "Mode obrolan suara aktif — silakan bicara kapan saja!"
              : "Coba buka telapak tangan ✋ untuk musik atau klik mic untuk ngobrol"}
          </div>
        </section>

        <aside className="control-rail">
          <section className={`camera-card panel ${cameraOn ? "camera-active" : ""} ${cameraExpanded ? "is-expanded" : ""}`}>
            <div className="card-heading">
              <div>
                <span className="section-kicker">MATA REYA</span>
                <h2>Gesture tangan</h2>
              </div>
              <div className="camera-heading-actions">
                <button
                  className={`camera-expand-btn ${cameraExpanded ? "active" : ""}`}
                  onClick={() => setCameraExpanded((prev) => !prev)}
                  title={cameraExpanded ? "Perkecil tampilan kamera" : "Perbesar tampilan kamera (Full View)"}
                  aria-label="Mode layar kamera"
                >
                  {cameraExpanded ? "⤡ Normal" : "⛶ Full"}
                </button>
                <button
                  className={`switch ${cameraOn ? "on" : ""}`}
                  onClick={() => void startCamera()}
                  aria-label="Aktifkan kamera"
                  aria-pressed={cameraOn}
                >
                  <span />
                </button>
              </div>
            </div>

            <div
              className={`camera-window ${cameraExpanded ? "full-aspect" : ""}`}
              style={cameraAspect && !cameraExpanded ? { aspectRatio: `${cameraAspect}` } : undefined}
            >
              <video ref={videoRef} muted playsInline />
              <canvas ref={canvasRef} />
              {cameraOn && musicPlaying && (
                <div className="camera-music-overlay-v" aria-hidden="true">
                  <span className="zone-label zone-high">↑ nada tinggi</span>
                  <span className="zone-label zone-low">↓ nada rendah</span>
                  {handPositions.right?.playing && (
                    <div
                      className="cam-hand-dot melody"
                      style={{ top: `${handPositions.right.y * 100}%`, left: `${(1 - handPositions.right.x) * 100}%` }}
                    >
                      <span>{handPositions.right.note}</span>
                    </div>
                  )}
                  {handPositions.left?.playing && (
                    <div
                      className="cam-hand-dot bass"
                      style={{ top: `${handPositions.left.y * 100}%`, left: `${(1 - handPositions.left.x) * 100}%` }}
                    >
                      <span>{handPositions.left.note}</span>
                    </div>
                  )}
                </div>
              )}
              {!cameraOn && (
                <div className="camera-empty">
                  <span className="scan-hand">✋</span>
                  <strong>{cameraLoading ? "Menyiapkan AI kamera…" : "Kamera belum aktif"}</strong>
                  <small>{cameraError || "Aktifkan untuk deteksi tangan full frame"}</small>
                </div>
              )}
              {cameraOn && (
                <div className="camera-badges-top">
                  <span className="local-label"><i /> Kamera Full View</span>
                  {cameraAspect && <span className="res-badge">{cameraAspect > 1.5 ? "16:9 HD" : "4:3"}</span>}
                </div>
              )}
            </div>

            <div className="gesture-result">
              <div className="gesture-symbol">
                {gesture === "Thumb_Up" ? "👍" : gesture === "Victory" ? "✌️" : gesture === "Closed_Fist" ? "✊" : gesture === "Pointing_Up" ? "☝️" : gesture === "ILoveYou" ? "🤟" : gesture === "Open_Palm" ? "✋" : "👋"}
              </div>
              <div>
                <small>TERDETEKSI</small>
                <strong>{gestureLabels[gesture] ?? gesture}</strong>
              </div>
              <b>{Math.round(gestureScore * 100)}%</b>
            </div>
          </section>

          <section className="quick-grid">
            <button className={`quick-card music-card ${musicPlaying ? "active" : ""}`} onClick={() => {
              if (musicPlaying) stopMusic();
              else startMusicTutorial();
              document.getElementById("music-lab")?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}>
              <span className="quick-icon">♫</span>
              <span><small>MUSIK GESTURE</small><strong>{musicPlaying ? activeMusicMode.name : "Main pakai tangan"}</strong></span>
              <i className="equalizer"><b /><b /><b /></i>
            </button>
            <button className="quick-card voice-card" onClick={() => setVoiceModal(true)}>
              <span className="quick-icon">◉</span>
              <span><small>SUARA REYA</small><strong>{voiceEngine === "supertonic" ? "F2 · REYA Cute" : voiceEngine === "qwen" ? voiceProfile.replace("clone:", "") : "Suara browser"}</strong></span>
              <i className="arrow">↗</i>
            </button>
          </section>
        </aside>

        <section className={`music-lab panel ${musicPlaying ? "active" : ""}`} id="music-lab">
          <div className="music-lab-head">
            <div>
              <span className="section-kicker">MUSIK GESTURE · DUA TANGAN</span>
              <h2>Mainkan Musik dengan Tanganmu</h2>
              <p>Angkat tangan tinggi untuk nada tinggi, turunkan untuk rendah. Pakai dua tangan untuk harmoni.</p>
            </div>
            <div className="music-session-actions">
              <span className={`music-live-status ${musicPlaying ? "active" : ""}`}><i />{musicPlaying ? "Sensor aktif" : "Belum dimainkan"}</span>
              <button className={musicPlaying ? "stop" : ""} onClick={() => {
                if (musicPlaying) stopMusic();
                else startMusicTutorial();
              }}>{musicPlaying ? "Selesai bermain" : "Mulai bermain"}</button>
            </div>
          </div>

          <div className="music-mode-tabs" role="tablist" aria-label="Mode musik">
            {musicModes.map((mode) => (
              <button
                className={musicMode === mode.id ? "active" : ""}
                key={mode.id}
                onClick={() => selectMusicMode(mode.id)}
                role="tab"
                aria-selected={musicMode === mode.id}
              >
                <span>{mode.icon}</span>
                <strong>{mode.name}</strong>
                <small>{mode.caption}</small>
              </button>
            ))}
          </div>

          <div className="music-playground">
            <div className="instrument-board">
              <div className="instrument-status">
                <span>{activeMusicMode.icon}</span>
                <div><small>SEKARANG</small><strong aria-live="polite">{lastPlayedLabel}</strong></div>
              </div>

              <div className="pitch-field">
                <div className="pitch-gradient" />
                <div className="pitch-scale-labels">
                  {scaleLabels.map((label, i) => (
                    <span key={`${label}-${i}`} style={{ top: `${(1 - i / (scaleLabels.length - 1)) * 100}%` }}>{label}</span>
                  ))}
                </div>
                {handPositions.right?.playing && (
                  <div className="hand-dot melody" style={{ top: `${handPositions.right.y * 100}%`, left: `${(1 - handPositions.right.x) * 100}%` }}>
                    <span className="hand-dot-label">{handPositions.right.note}</span>
                    <span className="hand-dot-tag">Melody</span>
                  </div>
                )}
                {handPositions.left?.playing && (
                  <div className="hand-dot bass" style={{ top: `${handPositions.left.y * 100}%`, left: `${(1 - handPositions.left.x) * 100}%` }}>
                    <span className="hand-dot-label">{handPositions.left.note}</span>
                    <span className="hand-dot-tag">Bass</span>
                  </div>
                )}
                <div className="hand-info-row">
                  <span className="hand-info-chip melody">🎵 Kanan{handPositions.right?.playing ? `: ${handPositions.right.note}` : ""}</span>
                  <span className="hand-info-chip bass">🎸 Kiri{handPositions.left?.playing ? `: ${handPositions.left.note}` : ""}</span>
                </div>
              </div>

              <div className="hand-axis"><span>↓ rendah</span><b>naik-turunkan tanganmu</b><span>↑ tinggi</span></div>
            </div>

            <aside className="music-instructions">
              <div className="instruction-title"><span>?</span><div><small>PETUNJUK MODE</small><strong>{activeMusicMode.name}</strong></div></div>
              <p>{activeMusicMode.instruction}</p>
              <ol>
                <li><b>1</b><span>Nyalakan kamera, lalu buka <strong>✋ telapak tangan</strong> untuk mulai.</span></li>
                <li><b>2</b><span>Angkat <strong>☝️ telunjuk</strong> dan gerakkan tangan <strong>naik-turun</strong> untuk ubah nada.</span></li>
                <li><b>3</b><span><strong>👍 Boost</strong> volume · <strong>✌️</strong> ganti mode · <strong>🤟</strong> drop · <strong>✊</strong> stop.</span></li>
              </ol>
              <button onClick={startMusicTutorial}><span>◉</span> Dengar petunjuk REYA</button>
              <small className="music-privacy">Kamera dan bunyi diproses langsung di browser kamu.</small>
            </aside>
          </div>
        </section>

        <section className="conversation panel">
          <div className="conversation-head">
            <div>
              <span className="section-kicker">OBROLAN REAL-TIME</span>
              <h2>Bicara Cepat dengan REYA</h2>
            </div>
            <div className="brain-chip-group">
              <button
                className={`voice-mode-btn ${voiceChatMode ? "active" : ""}`}
                onClick={toggleVoiceChatMode}
              >
                <span>🎙</span> {voiceChatMode ? "Mode Mic Aktif" : "Auto-Mic"}
              </button>
              <div className="brain-chip">
                <span>⚡</span> {OPENROUTER_API_KEY ? "OpenRouter Free" : health.model || "Demo"}
              </div>
            </div>
          </div>

          <div className="messages" aria-live="polite">
            {messages.slice(-4).map((message, index) => (
              <div className={`message ${message.role}`} key={`${message.role}-${index}-${message.content.slice(0, 10)}`}>
                {message.role === "assistant" && <span className="message-avatar">R</span>}
                <p>{message.content}</p>
              </div>
            ))}
            {thinking && (
              <div className="message assistant">
                <span className="message-avatar">R</span>
                <p className="typing">
                  <span>REYA sedang berpikir</span>
                  <i></i><i></i><i></i>
                </p>
              </div>
            )}
          </div>

          <div className="suggestions">
            {["Ceritakan lelucon lucu", "Bagaimana cara main musik tangan?", "Kamu punya fitur apa saja?"].map((suggestion) => (
              <button key={suggestion} onClick={() => void askRobot(suggestion)}>{suggestion}</button>
            ))}
          </div>

          <form className={`composer ${listening ? "is-recording" : ""}`} onSubmit={(event) => { event.preventDefault(); void askRobot(); }}>
            <button
              type="button"
              className={`mic-button ${listening ? "recording" : ""} ${voiceChatMode ? "in-voice-mode" : ""}`}
              onClick={() => void startListening()}
              aria-label="Bicara dengan REYA lewat mic"
              title={listening ? "Sedang mendengarkan... klik untuk selesai" : "Klik untuk bicara dengan mic"}
            >
              {listening ? "■" : "🎙"}
            </button>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={listening ? "Sedang mendengarkan suaramu…" : "Ketik atau bicara langsung lewat mic…"}
              aria-label="Pesan untuk REYA"
            />
            <button className="send-button" type="submit" disabled={!input.trim() || thinking}>
              Kirim <span>→</span>
            </button>
          </form>

          <div className="gesture-guide">
            <span><b>✋</b> Mulai</span>
            <span><b>☝️</b> Mainkan</span>
            <span><b>👍</b> Boost</span>
            <span><b>✌️</b> Mode</span>
            <span><b>🤟</b> Drop</span>
            <span><b>✊</b> Stop</span>
          </div>
        </section>
      </div>

      {voiceModal && (
        <div className="modal-backdrop">
          <section className="voice-modal" role="dialog" aria-modal="true" aria-labelledby="voice-title">
            <button className="close-button" onClick={() => setVoiceModal(false)} aria-label="Tutup">×</button>
            <span className="modal-icon">◉</span>
            <span className="section-kicker">SUARA & AI MODEL</span>
            <h2 id="voice-title">Pilih Suara REYA</h2>
            <p>REYA menggunakan model OpenRouter untuk respon cepat, dipadukan dengan mesin suara natural.</p>
            <div className="engine-tabs">
              <button className={voiceEngine === "supertonic" ? "active" : ""} onClick={() => changeVoiceEngine("supertonic")}>Natural Indo</button>
              <button className={voiceEngine === "qwen" ? "active" : ""} onClick={() => changeVoiceEngine("qwen")}>Custom Qwen</button>
              <button className={voiceEngine === "browser" ? "active" : ""} onClick={() => changeVoiceEngine("browser")}>Browser</button>
            </div>
            <label className="field-label">Karakter suara
              <select value={voiceProfile.startsWith("clone:") ? "custom" : voiceProfile} onChange={(event) => event.target.value !== "custom" && setVoiceProfile(event.target.value)} disabled={voiceEngine === "browser"}>
                {voiceEngine === "supertonic" ? <>
                  <option value="F2">REYA Cute — ceria, muda & playful</option>
                  <option value="F5">REYA Calm — lembut & tenang</option>
                  <option value="F1">F1 — kalem & dewasa</option>
                  <option value="F3">F3 — jelas & profesional</option>
                  <option value="F4">F4 — percaya diri & ekspresif</option>
                </> : <>
                  <option value="Serena">Serena — hangat & lembut</option>
                  <option value="Vivian">Vivian — muda & ceria</option>
                  <option value="Aiden">Aiden — cerah & jelas</option>
                  <option value="Ryan">Ryan — dinamis</option>
                  {voiceProfile.startsWith("clone:") && <option value="custom">{voiceProfile.replace("clone:", "")} — custom</option>}
                </>}
              </select>
            </label>
            {voiceEngine === "qwen" && <label className="field-label">Gaya bicara
              <input value={voiceStyle} onChange={(event) => setVoiceStyle(event.target.value)} />
            </label>}
            {voiceEngine === "qwen" && <div className="clone-box">
              <div><strong>Clone suaramu</strong><small>Gunakan suara milikmu sendiri atau suara yang kamu punya izin untuk gunakan.</small></div>
              <div className="clone-row">
                <input value={voiceName} onChange={(event) => setVoiceName(event.target.value)} placeholder="Nama suara" />
                <button onClick={() => void recordCustomVoice()} className={voiceRecording ? "recording" : ""}>{voiceRecording ? "■ Selesai" : voiceBlob ? "✓ Rekam ulang" : "● Rekam 6 detik"}</button>
              </div>
              <textarea value={voiceTranscript} onChange={(event) => setVoiceTranscript(event.target.value)} placeholder="Tulis persis kalimat yang kamu ucapkan saat merekam…" rows={2} />
              <button className="save-voice" onClick={() => void saveCustomVoice()} disabled={voiceSaving}>{voiceSaving ? "Menyimpan…" : "Simpan suara custom"}</button>
            </div>}
            <div className="modal-note"><span>i</span>{voiceEngine === "supertonic" ? "REYA Cute memakai karakter F2 yang ceria, playful, muda, dan cocok untuk suara karakter. Modelnya resmi mendukung Bahasa Indonesia dan berjalan lokal di CPU." : voiceEngine === "qwen" ? "Qwen memakai mode otomatis karena Bahasa Indonesia belum tercantum sebagai bahasa resminya; paling cocok untuk eksperimen custom voice." : "Kualitas suara browser menggunakan sintesis suara bawaan sistem operasi."}</div>
            <button className="primary-wide" onClick={() => { setVoiceModal(false); void speak("Hai! Aku REYA. Suaraku siap diajak ngobrol cepat dan seru!"); }}>Dengar contoh suara</button>
          </section>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function isDrumLike(mode: MusicModeId) {
  return mode === "drums" || mode === "beats";
}
