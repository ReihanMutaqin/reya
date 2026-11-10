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
const DEFAULT_VOICEBOX_URL =
  process.env.NEXT_PUBLIC_VOICEBOX_URL || "http://127.0.0.1:17493";
const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
const GEMINI_MODEL =
  process.env.NEXT_PUBLIC_GEMINI_MODEL || "gemini-flash-latest";
const OPENROUTER_API_KEY = process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || "";
const FALLBACK_MODELS = [
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "openai/gpt-oss-20b:free",
  "openrouter/free",
];

type Message = { role: "user" | "assistant"; content: string };
type VoiceboxProfile = {
  id: string;
  name: string;
  language?: string;
  description?: string;
};
type Health = {
  ollama: boolean;
  gemini?: boolean;
  openrouter?: boolean;
  voicebox?: boolean;
  voicebox_profiles?: VoiceboxProfile[];
  natural_tts: boolean;
  tts: boolean;
  stt: boolean;
  model?: string;
};
type VoiceEngine = "voicebox" | "supertonic" | "qwen" | "browser";
type MusicModeId = "piano" | "bells" | "drums" | "synth" | "beats";
type MusicMode = {
  id: MusicModeId;
  bankCode: string;
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
  onresult:
    | ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

const gestureLabels: Record<string, string> = {
  None: "Mencari tangan di kamera",
  Closed_Fist: "Hentikan musik (Stop)",
  Open_Palm: "Aktifkan sensor & mainkan akor",
  Pointing_Up: "Mainkan nada melodi",
  Thumb_Down: "Hentikan musik (Stop)",
  Thumb_Up: "Lonjakan volume (Boost)",
  Victory: "Pindah bank instrumen",
  ILoveYou: "Efek sub-drop",
};

const gestureCodes: Record<string, string> = {
  None: "IDLE",
  Closed_Fist: "STOP",
  Open_Palm: "CHRD",
  Pointing_Up: "NOTE",
  Thumb_Down: "MUTE",
  Thumb_Up: "GAIN",
  Victory: "BANK",
  ILoveYou: "DROP",
};

const handConnections = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

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
  notes.push({
    freq: C0 * Math.pow(2, startOctave + numOctaves),
    name: `C${startOctave + numOctaves}`,
  });
  return notes;
}

const melodyScale = buildScale(3, 3);
const bassScale = buildScale(2, 2);

function yToNote(y: number, scale: { freq: number; name: string }[]) {
  const t = 1 - Math.max(0, Math.min(0.999, y));
  const i = Math.round(t * (scale.length - 1));
  return scale[Math.max(0, Math.min(scale.length - 1, i))];
}

const musicModes: MusicMode[] = [
  {
    id: "piano",
    bankCode: "BANK 01",
    name: "Piano Pelangi",
    caption: "Harmoni segitiga lembut",
    instruction:
      "Angkat tangan tinggi untuk oktaf atas, turunkan untuk oktaf bawah. Geser horizontal untuk mengatur bukaan filter.",
  },
  {
    id: "bells",
    bankCode: "BANK 02",
    name: "Lonceng Bintang",
    caption: "Resonansi harmonik jernih",
    instruction:
      "Gerakkan telunjuk perlahan di area atas untuk denting lonceng panjang. Tangan kiri mengisi resonansi oktaf bawah.",
  },
  {
    id: "drums",
    bankCode: "BANK 03",
    name: "Drum Pop",
    caption: "8 pad perkusi sintetis",
    instruction:
      "Posisi tinggi memicu hi-hat dan crash, posisi rendah memicu kick dan tom. Hentakkan tangan ke bawah untuk pukulan aksen.",
    drumLabels: ["Kick", "Tom", "Pop", "Snare", "Clap", "Hi-hat", "Rim", "Crash"],
  },
  {
    id: "synth",
    bankCode: "BANK 04",
    name: "Synth Orbit",
    caption: "Osilator sawtooth ganda",
    instruction:
      "Tangan kanan memainkan lead sawtooth detuned, tangan kiri memainkan sub-bass gelombang kotak.",
  },
  {
    id: "beats",
    bankCode: "BANK 05",
    name: "Beat Robot",
    caption: "Sekuen pola ritme instan",
    instruction:
      "Setiap tingkat ketinggian tangan memilih salah satu dari 8 pola sekuenser ritme otomatis.",
    drumLabels: ["Bop", "Hop", "Tik", "Clap", "Disco", "Game", "Cute", "Final"],
  },
];

function isDrumLike(mode: MusicModeId) {
  return mode === "drums" || mode === "beats";
}

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

  const voice = (
    ratio: number,
    volume: number,
    type: OscillatorType,
    length: number,
    target = filter as AudioNode,
  ) => {
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
    o.frequency.exponentialRampToValueAtTime(
      freq * (isBass ? 0.5 : 2),
      t + 0.1,
    );
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
    oscillator.frequency.exponentialRampToValueAtTime(
      kind === 0 ? 42 : 62,
      when + 0.2,
    );
    gain.gain.setValueAtTime(0.7, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.24);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(when);
    oscillator.stop(when + 0.25);
    return;
  }

  const duration = kind === 2 || kind === 6 ? 0.09 : 0.2;
  const buffer = context.createBuffer(
    1,
    Math.max(1, Math.floor(context.sampleRate * duration)),
    context.sampleRate,
  );
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
}

const starterMessages: Message[] = [
  {
    role: "assistant",
    content:
      "Halo! Aku REYA. Otakku kini ditenagai Gemini Flash dan suaraku terhubung ke studio Voicebox. Mau ngobrol lewat mikrofon atau main musik pakai gerakan tangan?",
  },
];

function fallbackAnswer(text: string) {
  const normalized = text.toLowerCase();
  if (normalized.includes("siapa") || normalized.includes("nama")) {
    return "Namaku REYA, robot AI lokal sahabatmu! Aku memakai Gemini Flash untuk berpikir cepat dan Voicebox untuk berbicara.";
  }
  if (normalized.includes("musik")) {
    return "Ayo main musik! Buka telapak tangan di depan kamera atau sentuh langsung area matriks nada di bawah untuk membunyikan instrumen.";
  }
  if (normalized.includes("voicebox") || normalized.includes("suara")) {
    return "Aku mendukung penuh Voicebox di port 17493. Kamu bisa memilih profil suara atau membuat kloning suara di menu Studio Suara.";
  }
  if (normalized.includes("halo") || normalized.includes("hai")) {
    return "Halo! Senang banget bisa ngobrol sama kamu hari ini. Mau bahas topik seru atau main synth bareng?";
  }
  return "Aku siap mendengarkan dan menjawab! Kamu bisa bicara lewat mikrofon atau mengetik pertanyaanmu di bawah.";
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
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
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
    const channelData = Array.from({ length: channels }, (_, channel) =>
      decoded.getChannelData(channel),
    );
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
        view.setInt16(
          offset,
          sample < 0 ? sample * 0x8000 : sample * 0x7fff,
          true,
        );
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

/* Purposeful technical SVG icons (R-04: relevant hardware glyphs, zero decorative emoji) */
function IconMic() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

function IconSpeaker() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function IconCamera() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function IconWave() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12h3l3-7 4 14 4-10 3 3h3" />
    </svg>
  );
}

function IconTheme({ dark }: { dark: boolean }) {
  return dark ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function RobotCRTUnit({
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
  const statusLabel = listening
    ? "REC // MENDENGARKAN"
    : thinking
    ? "PROC // GEMINI FLASH"
    : speaking
    ? "OUT // VOICEBOX AUDIO"
    : "STBY // REYA SIAP";

  return (
    <div
      className={`crt-housing mood-${mood} ${speaking ? "is-speaking" : ""} ${
        thinking ? "is-thinking" : ""
      }`}
    >
      <div className="crt-screen">
        <div className="crt-eyes">
          <div className="crt-eye" />
          <div className="crt-eye" />
        </div>
        <div className="crt-mouth" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
      <div
        className={`crt-state-bar ${listening ? "listening" : ""} ${
          thinking ? "thinking" : ""
        }`}
      >
        {statusLabel}
      </div>
    </div>
  );
}

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [messages, setMessages] = useState<Message[]>(starterMessages);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceChatMode, setVoiceChatMode] = useState(false);
  const [activeBrainLabel, setActiveBrainLabel] = useState("gemini-flash-latest");
  const [health, setHealth] = useState<Health>({
    ollama: false,
    gemini: true,
    openrouter: true,
    voicebox: false,
    natural_tts: false,
    tts: false,
    stt: false,
  });

  const [voiceboxUrl, setVoiceboxUrl] = useState(DEFAULT_VOICEBOX_URL);
  const [voiceboxOnline, setVoiceboxOnline] = useState(false);
  const [voiceboxProfiles, setVoiceboxProfiles] = useState<VoiceboxProfile[]>([]);
  const [voiceboxProfileId, setVoiceboxProfileId] = useState("default");
  const [voiceboxChecking, setVoiceboxChecking] = useState(false);

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
  const [lastPlayedLabel, setLastPlayedLabel] = useState(
    "Siap dimainkan: klik matriks nada atau buka telapak tangan di kamera",
  );

  const [voiceEngine, setVoiceEngine] = useState<VoiceEngine>("voicebox");
  const [voiceProfile, setVoiceProfile] = useState("F2");
  const [voiceStyle, setVoiceStyle] = useState(
    "Suara perempuan muda yang ceria, hangat, ekspresif, lembut, dan natural seperti sahabat",
  );
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
  const pitchFieldRef = useRef<HTMLDivElement>(null);
  const pointerDownRef = useRef(false);
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
  const handMusicRef = useRef({
    melody: { freq: 0, at: 0 },
    bass: { freq: 0, at: 0 },
  });
  const previousPalmRef = useRef<{ y: number; at: number } | null>(null);
  const lastStrikeAtRef = useRef(0);
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  const micChunksRef = useRef<Blob[]>([]);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceChatModeRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const listenRef = useRef<() => void>(() => undefined);
  const speakRef = useRef<(text: string) => void>(() => undefined);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      window.localStorage.setItem("reya-theme", next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!voiceModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setVoiceModal(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [voiceModal]);

  useEffect(() => {
    voiceChatModeRef.current = voiceChatMode;
  }, [voiceChatMode]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }, []);

  const probeVoicebox = useCallback(
    async (customUrl?: string, announce = false) => {
      const target = (customUrl ?? voiceboxUrl).replace(/\/+$/, "");
      setVoiceboxChecking(true);
      try {
        // 1. Try direct browser fetch to Voicebox local server (port 17493)
        let profiles: VoiceboxProfile[] = [];
        let isOnline = false;

        try {
          const directRes = await fetch(`${target}/profiles`, {
            signal: AbortSignal.timeout(1800),
          });
          if (directRes.ok) {
            isOnline = true;
            const raw = (await directRes.json()) as unknown;
            const list = Array.isArray(raw)
              ? raw
              : typeof raw === "object" && raw !== null && "profiles" in raw
              ? ((raw as { profiles?: unknown[] }).profiles ?? [])
              : [];
            profiles = list
              .filter((item): item is Record<string, unknown> =>
                Boolean(item && typeof item === "object"),
              )
              .map((item) => ({
                id: String(item.id ?? item.profile_id ?? "default"),
                name: String(item.name ?? item.id ?? "Profil Voicebox"),
                language: String(item.language ?? "id"),
              }));
          }
        } catch {
          // 2. Try via server-side proxy route /api/voicebox
          const proxyRes = await fetch(
            `/api/voicebox?url=${encodeURIComponent(target)}`,
            { signal: AbortSignal.timeout(2200) },
          );
          if (proxyRes.ok) {
            const data = (await proxyRes.json()) as {
              online?: boolean;
              profiles?: VoiceboxProfile[];
            };
            isOnline = Boolean(data.online);
            profiles = data.profiles ?? [];
          }
        }

        setVoiceboxOnline(isOnline);
        setVoiceboxProfiles(profiles);
        if (isOnline && profiles.length > 0) {
          setVoiceboxProfileId((prev) =>
            prev === "default" ? profiles[0].id : prev,
          );
          setVoiceEngine("voicebox");
        }
        if (announce) {
          showToast(
            isOnline
              ? `Voicebox terhubung (${profiles.length} profil ditemukan)`
              : "Voicebox belum aktif di port 17493, mode cadangan siap digunakan",
          );
        }
      } catch {
        setVoiceboxOnline(false);
        if (announce) {
          showToast("Voicebox belum terdeteksi di port 17493");
        }
      } finally {
        setVoiceboxChecking(false);
      }
    },
    [showToast, voiceboxUrl],
  );

  useEffect(() => {
    let mounted = true;
    const checkHealth = async () => {
      void probeVoicebox();
      try {
        const response = await fetch(`${API_BASE}/health`, {
          signal: AbortSignal.timeout(1800),
        });
        const data = (await response.json()) as Health;
        if (mounted) setHealth(data);
      } catch {
        if (mounted) {
          setHealth({
            ollama: false,
            gemini: true,
            openrouter: true,
            voicebox: false,
            natural_tts: false,
            tts: false,
            stt: false,
          });
        }
      }
    };
    void checkHealth();
    const timer = window.setInterval(checkHealth, 15000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [probeVoicebox]);

  const changeVoiceEngine = useCallback((engine: VoiceEngine) => {
    setVoiceEngine(engine);
    if (engine === "supertonic") setVoiceProfile("F2");
    if (engine === "qwen") setVoiceProfile("Serena");
  }, []);

  const ensureMusicAudio = useCallback(() => {
    let context = audioContextRef.current;
    let master = masterGainRef.current;
    if (!context || context.state === "closed" || !master) {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return null;
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = 0.22;
      master.connect(context.destination);
      audioContextRef.current = context;
      masterGainRef.current = master;
    }
    if (context.state === "suspended") void context.resume();
    return { context, master };
  }, []);

  const stopMusic = useCallback(() => {
    if (noteReleaseTimerRef.current)
      window.clearTimeout(noteReleaseTimerRef.current);
    noteReleaseTimerRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.close();
    audioContextRef.current = null;
    masterGainRef.current = null;
    musicPlayingRef.current = false;
    handMusicRef.current = {
      melody: { freq: 0, at: 0 },
      bass: { freq: 0, at: 0 },
    };
    previousPalmRef.current = null;
    setHandPositions({});
    setMusicPlaying(false);
    setLastPlayedLabel(
      "Sensor musik berhenti: buka telapak tangan atau sentuh matriks untuk mulai",
    );
  }, []);

  const startMusic = useCallback(() => {
    if (!ensureMusicAudio()) return;
    musicPlayingRef.current = true;
    setMusicPlaying(true);
    setLastPlayedLabel(
      "Sensor aktif: angkat telunjuk di kamera atau geser matriks nada di bawah",
    );
  }, [ensureMusicAudio]);

  const selectMusicMode = useCallback((nextMode: MusicModeId) => {
    musicModeRef.current = nextMode;
    setMusicMode(nextMode);
    handMusicRef.current = {
      melody: { freq: 0, at: 0 },
      bass: { freq: 0, at: 0 },
    };
    previousPalmRef.current = null;
    setHandPositions({});
    const next =
      musicModes.find((mode) => mode.id === nextMode) ?? musicModes[0];
    setLastPlayedLabel(`${next.bankCode} // ${next.name} siap dimainkan`);
  }, []);

  const triggerMatrixCoordinate = useCallback(
    (normX: number, normY: number) => {
      const audio = ensureMusicAudio();
      if (!audio) return;
      if (!musicPlayingRef.current) {
        musicPlayingRef.current = true;
        setMusicPlaying(true);
      }

      const clampedX = Math.max(0, Math.min(0.999, normX));
      const clampedY = Math.max(0, Math.min(0.999, normY));
      const mode = musicModeRef.current;
      const now = performance.now();
      const note = yToNote(clampedY, melodyScale);
      const prev = handMusicRef.current.melody;
      const isDrum = isDrumLike(mode);
      const cooldown = isDrum ? 140 : 65;

      if (Math.abs(note.freq - prev.freq) > 1 || now - prev.at > cooldown) {
        handMusicRef.current.melody = { freq: note.freq, at: now };
        const brightness = clampedX;
        const pan = clampedX * 2 - 1;

        if (mode === "drums") {
          const padIndex = Math.floor((1 - clampedY) * 7.99);
          scheduleDrumHit(audio.context, audio.master, padIndex);
        } else if (mode === "beats") {
          const padIndex = Math.floor((1 - clampedY) * 7.99);
          scheduleBeatPattern(audio.context, audio.master, padIndex);
        } else {
          playNote(
            audio.context,
            audio.master,
            note.freq,
            mode,
            brightness,
            pan,
            false,
          );
        }
      }

      const modeInfo =
        musicModes.find((m) => m.id === mode) ?? musicModes[0];
      const label =
        isDrum && modeInfo.drumLabels
          ? modeInfo.drumLabels[Math.floor((1 - clampedY) * 7.99)]
          : note.name;
      const cutoffHz = Math.round(500 + clampedX * 4500);

      setHandPositions((curr) => ({
        ...curr,
        right: {
          x: 1 - clampedX,
          y: clampedY,
          note: label ?? note.name,
          playing: true,
        },
      }));
      setLastPlayedLabel(
        `Nada aktif: ${label ?? note.name} (${Math.round(note.freq)} Hz · Filter ${cutoffHz} Hz)`,
      );
    },
    [ensureMusicAudio],
  );

  const handleHandMusic = useCallback(
    (hands: HandInfo[], now: number) => {
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
        const key = isRight ? ("right" as const) : ("left" as const);
        const scale = isBass ? bassScale : melodyScale;
        const stateKey = isBass ? ("bass" as const) : ("melody" as const);

        const isPlaying =
          hand.name === "Pointing_Up" || hand.name === "Open_Palm";
        const screenX = 1 - tip.x;
        const brightness = Math.max(0, Math.min(1, screenX));
        const pan = screenX * 2 - 1;

        if (isPlaying) {
          const note = yToNote(tip.y, scale);
          const prev = handMusicRef.current[stateKey];
          const freqChanged = Math.abs(note.freq - prev.freq) > 1;
          const elapsed = now - prev.at;
          const isDrum = isDrumLike(mode);
          const cooldown = isDrum ? 160 : 75;

          if (freqChanged && elapsed > cooldown) {
            handMusicRef.current[stateKey] = { freq: note.freq, at: now };

            if (mode === "drums") {
              const padIndex = Math.floor(
                (1 - Math.max(0, Math.min(0.999, tip.y))) * 7.99,
              );
              scheduleDrumHit(audio.context, audio.master, padIndex);
            } else if (mode === "beats") {
              const padIndex = Math.floor(
                (1 - Math.max(0, Math.min(0.999, tip.y))) * 7.99,
              );
              scheduleBeatPattern(audio.context, audio.master, padIndex);
            } else if (hand.name === "Open_Palm") {
              playChord(
                audio.context,
                audio.master,
                note.freq,
                mode,
                brightness,
                pan,
              );
            } else {
              playNote(
                audio.context,
                audio.master,
                note.freq,
                mode,
                brightness,
                pan,
                isBass,
              );
            }
          }

          const modeInfo =
            musicModes.find((m) => m.id === mode) ?? musicModes[0];
          const label =
            isDrum && modeInfo.drumLabels
              ? modeInfo.drumLabels[
                  Math.floor((1 - Math.max(0, Math.min(0.999, tip.y))) * 7.99)
                ]
              : note.name;
          newPositions[key] = {
            x: tip.x,
            y: tip.y,
            note: label ?? note.name,
            playing: true,
          };
          setLastPlayedLabel(
            `Sensor tangan: ${label ?? note.name} (${Math.round(note.freq)} Hz)`,
          );
        } else {
          newPositions[key] = {
            x: tip.x,
            y: tip.y,
            note: "",
            playing: false,
          };
        }

        if (isDrumLike(mode) && palm) {
          const prev = previousPalmRef.current;
          const dt = prev ? Math.max(0.016, (now - prev.at) / 1000) : 0;
          const velocity = prev ? (palm.y - prev.y) / dt : 0;
          if (velocity > 0.5 && now - lastStrikeAtRef.current > 170) {
            lastStrikeAtRef.current = now;
            const padIndex = Math.floor(
              (1 - Math.max(0, Math.min(0.999, tip.y))) * 7.99,
            );
            scheduleDrumHit(audio.context, audio.master, padIndex);
          }
          previousPalmRef.current = { y: palm.y, at: now };
        }
      }

      setHandPositions(newPositions);
    },
    [ensureMusicAudio],
  );

  const runGestureAction = useCallback(
    (name: string) => {
      const now = performance.now();
      if (
        name === lastGestureRef.current &&
        now - lastGestureAtRef.current < 2200
      )
        return;
      lastGestureRef.current = name;
      lastGestureAtRef.current = now;

      if (name === "Open_Palm") {
        if (!musicPlayingRef.current) {
          startMusic();
          showToast("Sensor musik aktif. Angkat telunjuk untuk mengatur nada.");
        }
      } else if (name === "Closed_Fist" || name === "Thumb_Down") {
        if (musicPlayingRef.current) {
          stopMusic();
          showToast("Musik dihentikan.");
        }
      } else if (name === "Victory") {
        if (musicPlayingRef.current) {
          const currentIndex = musicModes.findIndex(
            (mode) => mode.id === musicModeRef.current,
          );
          const nextMode = musicModes[(currentIndex + 1) % musicModes.length];
          selectMusicMode(nextMode.id);
          showToast(`Bank instrumen: ${nextMode.name}`);
        } else {
          setMood((current) => (current + 1) % 3);
          showToast("Mode tampilan CRT REYA diganti.");
        }
      } else if (name === "Thumb_Up") {
        if (
          musicPlayingRef.current &&
          masterGainRef.current &&
          audioContextRef.current
        ) {
          const g = masterGainRef.current;
          const t = audioContextRef.current.currentTime;
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(0.5, t);
          g.gain.linearRampToValueAtTime(0.22, t + 2);
          showToast("Lonjakan volume aktif (Boost).");
          setMood((m) => (m + 1) % 3);
        } else {
          startMusic();
          showToast("Sensor musik diaktifkan.");
        }
      } else if (name === "ILoveYou") {
        const audio = ensureMusicAudio();
        if (audio) {
          musicPlayingRef.current = true;
          setMusicPlaying(true);
          playDropEffect(audio.context, audio.master);
          showToast("Efek sub-drop dimainkan.");
        }
      } else if (name === "Pointing_Up") {
        if (!musicPlayingRef.current) listenRef.current();
      }
    },
    [ensureMusicAudio, selectMusicMode, showToast, startMusic, stopMusic],
  );

  const drawHands = useCallback(
    (allLandmarks: Landmark[][], handedness: string[]) => {
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
        const stroke = isRight ? "#5CE8A0" : "#D2B3FF";
        const fill = isRight ? "#E8F47A" : "#D2B3FF";

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
          ctx.arc(
            (1 - point.x) * width,
            point.y * height,
            i % 4 === 0 ? 6 : 4,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        });

        const tip = landmarks[8];
        if (tip) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc((1 - tip.x) * width, tip.y * height, 16, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    },
    [],
  );

  const handleSpeechEnd = useCallback(() => {
    isSpeakingRef.current = false;
    setSpeaking(false);
    if (voiceChatModeRef.current) {
      window.setTimeout(() => {
        if (voiceChatModeRef.current && !isSpeakingRef.current) {
          listenRef.current();
        }
      }, 400);
    }
  }, []);

  const playAudioBlob = useCallback(
    async (blob: Blob, applyCuteShaping: boolean): Promise<boolean> => {
      try {
        if (!blob || blob.size < 100) return false;
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtx) return false;
        const ctx = new AudioCtx();
        if (ctx.state === "suspended") await ctx.resume();

        const arrayBuf = await blob.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuf);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = applyCuteShaping ? 1.12 : 1.0;

        if (applyCuteShaping) {
          const filter = ctx.createBiquadFilter();
          filter.type = "highshelf";
          filter.frequency.value = 3200;
          filter.gain.value = 2.4;
          source.connect(filter);
          filter.connect(ctx.destination);
        } else {
          source.connect(ctx.destination);
        }

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
    },
    [handleSpeechEnd],
  );

  const playVoiceboxDirect = useCallback(
    async (text: string): Promise<boolean> => {
      const clean = text.replace(/[*_#`~]/g, "").trim();
      if (!clean) return false;
      const baseUrl = voiceboxUrl.replace(/\/+$/, "");

      // 1. Try OpenAI-compatible Voicebox endpoint (/v1/audio/speech)
      try {
        const res = await fetch(`${baseUrl}/v1/audio/speech`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "qwen",
            input: clean,
            voice: voiceboxProfileId || "default",
            response_format: "wav",
          }),
          signal: AbortSignal.timeout(9000),
        });
        if (res.ok) {
          const blob = await res.blob();
          if (await playAudioBlob(blob, false)) {
            setVoiceboxOnline(true);
            return true;
          }
        }
      } catch {
        // Continue to native /generate route
      }

      // 2. Try native /generate endpoint from jamiepine/voicebox
      try {
        const genRes = await fetch(`${baseUrl}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: clean,
            profile_id: voiceboxProfileId || "default",
            language: "id",
            instruct: voiceStyle,
          }),
          signal: AbortSignal.timeout(12000),
        });
        if (genRes.ok) {
          const ct = genRes.headers.get("content-type") || "";
          if (ct.includes("audio/")) {
            const blob = await genRes.blob();
            if (await playAudioBlob(blob, false)) {
              setVoiceboxOnline(true);
              return true;
            }
          }
          const data = (await genRes.json()) as {
            id?: string;
            generation_id?: string;
            audio?: string;
            audio_base64?: string;
          };
          const b64 = data.audio || data.audio_base64;
          if (typeof b64 === "string" && b64.length > 100) {
            const binStr = window.atob(b64);
            const bytes = new Uint8Array(binStr.length);
            for (let i = 0; i < binStr.length; i++) {
              bytes[i] = binStr.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: "audio/wav" });
            if (await playAudioBlob(blob, false)) {
              setVoiceboxOnline(true);
              return true;
            }
          }
          const genId = data.id || data.generation_id;
          if (genId) {
            for (const suffix of [
              `/audio/${genId}`,
              `/history/${genId}/export-audio`,
            ]) {
              const audioRes = await fetch(`${baseUrl}${suffix}`, {
                signal: AbortSignal.timeout(6000),
              });
              if (audioRes.ok) {
                const blob = await audioRes.blob();
                if (await playAudioBlob(blob, false)) {
                  setVoiceboxOnline(true);
                  return true;
                }
              }
            }
          }
        }
      } catch {
        // Voicebox not running locally
      }

      return false;
    },
    [playAudioBlob, voiceStyle, voiceboxProfileId, voiceboxUrl],
  );

  const playServerTTS = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        const clean = text.replace(/[*_#`~]/g, "").trim();
        if (!clean) return false;
        const params = new URLSearchParams({
          text: clean.slice(0, 300),
          engine: voiceEngine === "voicebox" ? "voicebox" : "supertonic",
          profile_id: voiceboxProfileId || "default",
          voicebox_url: voiceboxUrl,
        });
        const res = await fetch(`/api/tts?${params.toString()}`);
        if (!res.ok) return false;
        const provider = res.headers.get("X-Voice-Provider");
        const blob = await res.blob();
        return await playAudioBlob(blob, provider !== "voicebox");
      } catch {
        return false;
      }
    },
    [playAudioBlob, voiceEngine, voiceboxProfileId, voiceboxUrl],
  );

  const browserSpeak = useCallback(
    async (text: string) => {
      if (!("speechSynthesis" in window)) {
        handleSpeechEnd();
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(
        text.replace(/[*_#`~]/g, ""),
      );
      utterance.lang = "id-ID";
      utterance.rate = 1.08;
      utterance.pitch = 1.28;
      const voices = await getBrowserVoices();
      const isIndonesian = (voice: SpeechSynthesisVoice) =>
        voice.lang.toLowerCase().startsWith("id") ||
        voice.lang.toLowerCase().startsWith("in");
      const isGoogleIndo = (voice: SpeechSynthesisVoice) =>
        isIndonesian(voice) && /google/i.test(voice.name);
      const soundsFeminine = (voice: SpeechSynthesisVoice) =>
        /gadis|dewi|siti|female|woman|serena|zira|sara|samantha|aria|ava|jenny|natasha|sonia|tessa/i.test(
          voice.name,
        );

      utterance.voice =
        voices.find(isGoogleIndo) ??
        voices.find((voice) => isIndonesian(voice) && soundsFeminine(voice)) ??
        voices.find(isIndonesian) ??
        voices.find(soundsFeminine) ??
        null;

      utterance.onstart = () => {
        isSpeakingRef.current = true;
        setSpeaking(true);
      };
      utterance.onend = handleSpeechEnd;
      utterance.onerror = handleSpeechEnd;
      window.speechSynthesis.speak(utterance);
    },
    [handleSpeechEnd],
  );

  const speak = useCallback(
    async (text: string) => {
      // 1. Direct jamiepine/voicebox synthesis if selected or online
      if (voiceEngine === "voicebox" || voiceboxOnline) {
        const vbOk = await playVoiceboxDirect(text);
        if (vbOk) return;
      }

      // 2. Local Python AI Server (Supertonic F2 / Qwen / Voicebox proxy)
      if (voiceEngine !== "browser") {
        try {
          const response = await fetch(`${API_BASE}/api/tts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text,
              engine: voiceEngine,
              speaker:
                voiceEngine === "voicebox" ? voiceboxProfileId : voiceProfile,
              instruction: voiceStyle,
              language: "Auto",
              voicebox_url: voiceboxUrl,
            }),
            signal: AbortSignal.timeout(7000),
          });
          if (response.ok) {
            const blob = await response.blob();
            if (await playAudioBlob(blob, false)) return;
          }
        } catch {
          // Fall through to Next.js /api/tts route
        }
      }

      // 3. Server-side /api/tts (Voicebox proxy + natural Indonesian audio fallback)
      if (voiceEngine !== "browser") {
        const serverOk = await playServerTTS(text);
        if (serverOk) return;
      }

      // 4. Browser SpeechSynthesis fallback
      void browserSpeak(text);
    },
    [
      browserSpeak,
      playAudioBlob,
      playServerTTS,
      playVoiceboxDirect,
      voiceEngine,
      voiceProfile,
      voiceStyle,
      voiceboxOnline,
      voiceboxProfileId,
      voiceboxUrl,
    ],
  );

  useEffect(() => {
    speakRef.current = (text: string) => void speak(text);
  }, [speak]);

  /* Argon Gemini Flash API chat with server & OpenRouter fallbacks */
  const askRobot = useCallback(
    async (rawText?: string) => {
      const text = (rawText ?? input).trim();
      if (!text || thinking) return;
      const userMessage: Message = { role: "user", content: text };
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      setInput("");
      setThinking(true);
      let answer = "";

      const systemPrompt =
        "Kamu adalah REYA, robot AI perempuan yang ceria, hangat, ramah, dan pintar. " +
        "Aturan bicara REYA: " +
        "1. Selalu gunakan Bahasa Indonesia percakapan yang santai, luwes, dan akrab (gunakan kata 'aku' dan 'kamu'). " +
        "2. Jangan gunakan bahasa kaku seperti 'Anda', 'Saya siap membantu', atau 'Sebagai AI'. " +
        "3. Jawab singkat, jelas, dan ekspresif (1 sampai 2 kalimat pendek) layaknya ngobrol langsung lewat suara.";

      const cleanResponse = (raw: string) =>
        raw
          .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
          .replace(
            /^(?:Here's a thinking process|Thinking Process:)[\s\S]*?\n\n/i,
            "",
          )
          .replace(/\*.*?\*/g, "")
          .replace(/[#_`]/g, "")
          .replace(/\u2014/g, ", ")
          .trim();

      const historyText = nextMessages
        .slice(-8)
        .map(
          (m) => `${m.role === "assistant" ? "REYA" : "Pengguna"}: ${m.content}`,
        )
        .join("\n");
      const fullPrompt = `${systemPrompt}\n\nPercakapan:\n${historyText}\nREYA:`;

      // 1. Direct Argon Gemini API call (gemini-flash-latest with X-goog-api-key)
      if (GEMINI_API_KEY) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-goog-api-key": GEMINI_API_KEY,
              },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: fullPrompt,
                      },
                    ],
                  },
                ],
              }),
              signal: AbortSignal.timeout(12000),
            },
          );
          if (response.ok) {
            const data = (await response.json()) as {
              candidates?: Array<{
                content?: { parts?: Array<{ text?: string }> };
              }>;
            };
            const candidate = cleanResponse(
              data.candidates?.[0]?.content?.parts
                ?.map((p) => p.text ?? "")
                .join("") ?? "",
            );
            if (candidate) {
              answer = candidate;
              setActiveBrainLabel(GEMINI_MODEL);
            }
          }
        } catch {
          // Try server route next
        }
      }

      // 2. Next.js Server Route (/api/chat)
      if (!answer) {
        try {
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: nextMessages.slice(-8) }),
            signal: AbortSignal.timeout(14000),
          });
          if (response.ok) {
            const data = (await response.json()) as {
              message?: string;
              model?: string;
            };
            const candidate = cleanResponse(data.message ?? "");
            if (candidate) {
              answer = candidate;
              if (data.model) setActiveBrainLabel(data.model);
            }
          }
        } catch {
          // Try OpenRouter or Local AI next
        }
      }

      // 3. Direct OpenRouter Fallback
      if (!answer && OPENROUTER_API_KEY) {
        for (const modelToTry of FALLBACK_MODELS) {
          if (answer) break;
          try {
            const response = await fetch(
              "https://openrouter.ai/api/v1/chat/completions",
              {
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
                    ...nextMessages
                      .slice(-8)
                      .map((m) => ({ role: m.role, content: m.content })),
                  ],
                  max_tokens: 130,
                  temperature: 0.8,
                }),
                signal: AbortSignal.timeout(12000),
              },
            );
            if (response.ok) {
              const data = (await response.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
              };
              const candidate = cleanResponse(
                data.choices?.[0]?.message?.content ?? "",
              );
              if (candidate) {
                answer = candidate;
                setActiveBrainLabel(modelToTry);
                break;
              }
            }
          } catch {
            // Try next fallback model
          }
        }
      }

      // 4. Local Python AI Backend
      if (!answer) {
        try {
          const response = await fetch(`${API_BASE}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: nextMessages.slice(-10) }),
            signal: AbortSignal.timeout(15000),
          });
          if (response.ok) {
            const data = (await response.json()) as { message: string };
            answer = cleanResponse(data.message);
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
    },
    [input, messages, speak, thinking],
  );

  const startBrowserRecognition = useCallback(() => {
    if (isSpeakingRef.current) return;
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      showToast(
        "Pengenalan suara browser tidak tersedia. Silakan ketik pesan.",
      );
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
    if (micRecorderRef.current?.state === "recording")
      micRecorderRef.current.stop();
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
        const blob = new Blob(micChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const form = new FormData();
        form.append("audio", blob, "ucapan.webm");
        try {
          const response = await fetch(`${API_BASE}/api/stt`, {
            method: "POST",
            body: form,
          });
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
  }, [
    askRobot,
    health.stt,
    listening,
    showToast,
    startBrowserRecognition,
    stopLocalRecording,
  ]);

  useEffect(() => {
    listenRef.current = () => void startListening();
  }, [startListening]);

  const toggleVoiceChatMode = useCallback(() => {
    setVoiceChatMode((prev) => {
      const next = !prev;
      if (next) {
        showToast("Mode obrolan suara aktif. Silakan bicara langsung.");
        void speak(
          "Hai! Mode obrolan suara aktif. Silakan bicara kapan saja!",
        );
      } else {
        showToast("Mode obrolan suara dimatikan.");
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
    if (context && canvasRef.current) {
      context.clearRect(
        0,
        0,
        canvasRef.current.width,
        canvasRef.current.height,
      );
    }
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
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Elemen video tidak tersedia");
      video.srcObject = stream;
      await video.play();

      if (video.videoWidth && video.videoHeight) {
        setCameraAspect(video.videoWidth / video.videoHeight);
      }

      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      let recognizer: GestureRecognizer;
      try {
        recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/gesture_recognizer.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.5,
        });
      } catch {
        recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/gesture_recognizer.task",
            delegate: "CPU",
          },
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
        if (
          activeVideo.readyState >= 2 &&
          activeVideo.currentTime !== lastVideoTimeRef.current
        ) {
          lastVideoTimeRef.current = activeVideo.currentTime;

          if (activeVideo.videoWidth && activeVideo.videoHeight) {
            setCameraAspect(activeVideo.videoWidth / activeVideo.videoHeight);
          }

          const result = await activeRecognizer.recognizeForVideo(
            activeVideo,
            performance.now(),
          );

          const hands: HandInfo[] = [];
          const allLandmarks: Landmark[][] = [];
          const allHandedness: string[] = [];

          for (let i = 0; i < (result.landmarks?.length ?? 0); i++) {
            const topGesture = result.gestures?.[i]?.[0];
            const landmarks = result.landmarks[i] as Landmark[];
            const hd =
              (
                result.handedness as Array<Array<{ categoryName: string }>>
              )?.[i]?.[0]?.categoryName ?? "Right";

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
            canvas
              ?.getContext("2d")
              ?.clearRect(0, 0, canvas.width, canvas.height);
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
      setCameraError(
        error instanceof Error
          ? `${error.message}. Izinkan akses kamera di pengaturan browser lalu coba lagi.`
          : "Kamera tidak dapat diakses. Periksa izin browser.",
      );
      setCameraOn(false);
    } finally {
      setCameraLoading(false);
    }
  }, [cameraOn, drawHands, handleHandMusic, runGestureAction, stopCamera]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      recognizerRef.current?.close();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (noteReleaseTimerRef.current)
        window.clearTimeout(noteReleaseTimerRef.current);
      if (audioContextRef.current) void audioContextRef.current.close();
    },
    [],
  );

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
        const rawBlob = new Blob(voiceChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        try {
          setVoiceBlob(await convertRecordingToWav(rawBlob));
          showToast("Contoh suara 6 detik tersimpan.");
        } catch {
          setVoiceBlob(rawBlob);
          showToast("Contoh suara tersimpan.");
        }
      };
      voiceRecorderRef.current = recorder;
      setVoiceRecording(true);
      recorder.start();
      showToast("Merekam contoh suara selama 6 detik...");
      window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 6000);
    } catch {
      setVoiceRecording(false);
      showToast("Mikrofon tidak dapat diakses.");
    }
  }, [showToast]);

  const saveCustomVoice = useCallback(async () => {
    if (!voiceBlob || !voiceTranscript.trim()) {
      showToast("Rekam suara terlebih dahulu dan isi kalimat transkrip.");
      return;
    }
    setVoiceSaving(true);
    try {
      // 1. If Voicebox is active/online, register profile and sample in jamiepine/voicebox
      if (voiceEngine === "voicebox" && voiceboxOnline) {
        const baseUrl = voiceboxUrl.replace(/\/+$/, "");
        const createRes = await fetch(`${baseUrl}/profiles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: voiceName.trim() || "Suara REYA Custom",
            language: "id",
            description: "Dibuat dari konsol web REYA",
          }),
        });
        if (createRes.ok) {
          const created = (await createRes.json()) as { id?: string };
          if (created.id) {
            const sampleForm = new FormData();
            sampleForm.append(
              "file",
              voiceBlob,
              voiceBlob.type === "audio/wav" ? "sample.wav" : "sample.webm",
            );
            sampleForm.append("reference_text", voiceTranscript.trim());
            await fetch(`${baseUrl}/profiles/${created.id}/samples`, {
              method: "POST",
              body: sampleForm,
            });
            setVoiceboxProfileId(created.id);
            await probeVoicebox(baseUrl);
            setVoiceModal(false);
            showToast("Profil kloning suara berhasil disimpan ke Voicebox.");
            return;
          }
        }
      }

      // 2. Save to local Python AI server
      const form = new FormData();
      form.append("name", voiceName.trim() || "Suara Saya");
      form.append("transcript", voiceTranscript.trim());
      form.append(
        "audio",
        voiceBlob,
        voiceBlob.type === "audio/wav" ? "referensi.wav" : "referensi.webm",
      );
      const response = await fetch(`${API_BASE}/api/voices`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error("Server suara belum siap");
      const data = (await response.json()) as { voice_id: string };
      setVoiceEngine("qwen");
      setVoiceProfile(data.voice_id);
      setVoiceModal(false);
      showToast("Suara custom siap digunakan.");
    } catch {
      showToast(
        "Jalankan aplikasi Voicebox (port 17493) atau server AI lokal untuk menyimpan kloning suara.",
      );
    } finally {
      setVoiceSaving(false);
    }
  }, [
    probeVoicebox,
    showToast,
    voiceBlob,
    voiceEngine,
    voiceName,
    voiceTranscript,
    voiceboxOnline,
    voiceboxUrl,
  ]);

  const activeMusicMode =
    musicModes.find((mode) => mode.id === musicMode) ?? musicModes[0];

  const scaleLabels = useMemo(() => {
    if (musicMode === "drums" || musicMode === "beats") {
      return activeMusicMode.drumLabels ?? [];
    }
    return melodyScale
      .filter((_, i) => i % 2 === 0 || i === melodyScale.length - 1)
      .map((n) => n.name);
  }, [musicMode, activeMusicMode]);

  const startMusicTutorial = useCallback(() => {
    startMusic();
    if (!cameraOn) void startCamera();
    const modeInfo =
      musicModes.find((mode) => mode.id === musicModeRef.current) ??
      musicModes[0];
    speakRef.current(
      `Ayo kita mainkan ${modeInfo.name}! Buka telapak tanganmu di depan kamera untuk mulai, lalu angkat tinggi untuk nada tinggi dan turunkan untuk nada rendah. Kamu juga bisa menyentuh area matriks nada secara langsung.`,
    );
    document
      .getElementById("music-lab")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [cameraOn, startCamera, startMusic]);

  const activeVoiceLabel = useMemo(() => {
    if (voiceEngine === "voicebox") {
      const found = voiceboxProfiles.find((p) => p.id === voiceboxProfileId);
      return found
        ? `Voicebox · ${found.name}`
        : voiceboxOnline
        ? `Voicebox · ${voiceboxProfileId}`
        : "Voicebox · Auto Indo";
    }
    if (voiceEngine === "supertonic") return `Supertonic · ${voiceProfile}`;
    if (voiceEngine === "qwen")
      return `Qwen · ${voiceProfile.replace("clone:", "")}`;
    return "Browser Speech";
  }, [
    voiceEngine,
    voiceProfile,
    voiceboxOnline,
    voiceboxProfileId,
    voiceboxProfiles,
  ]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="REYA beranda konsol">
          <span className="brand-mark">R1</span>
          <span className="brand-text">
            <b>REYA // UNIT-01</b>
            <small>Robot AI Lokal &amp; Synth</small>
          </span>
        </a>

        <div className="telemetry-strip" role="status" aria-live="polite">
          <div className="telemetry-item">
            <span className="status-led online" />
            <span className="mono">API: {activeBrainLabel}</span>
          </div>
          <span className="telemetry-divider" aria-hidden="true" />
          <div className="telemetry-item">
            <span
              className={`status-led ${
                voiceboxOnline || health.natural_tts ? "online" : ""
              }`}
            />
            <span className="mono">
              VOICE:{" "}
              {voiceboxOnline
                ? "VOICEBOX :17493"
                : "VOICEBOX / INDO STREAM"}
            </span>
          </div>
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className={`hw-button ${voiceChatMode ? "active-green" : ""}`}
            onClick={toggleVoiceChatMode}
          >
            <IconMic />
            <span>{voiceChatMode ? "Auto-Mic Aktif" : "Mode Suara"}</span>
          </button>
          <button
            type="button"
            className="hw-button"
            onClick={() => {
              setVoiceModal(true);
              void probeVoicebox();
            }}
          >
            <IconSpeaker />
            <span>Studio Suara</span>
          </button>
          <button
            type="button"
            className="hw-button"
            onClick={toggleTheme}
            aria-label={
              theme === "light"
                ? "Ganti ke tema Studio Malam"
                : "Ganti ke tema Chassis Terang"
            }
          >
            <IconTheme dark={theme === "dark"} />
            <span>{theme === "light" ? "Malam" : "Terang"}</span>
          </button>
        </div>
      </header>

      <div
        className={`console-grid ${cameraExpanded ? "camera-expanded" : ""}`}
        id="top"
      >
        {/* MOD-01: ROBOT ACOUSTIC UNIT & LIVE DIALOG */}
        <section className="hw-module" aria-labelledby="mod01-heading">
          <div className="module-index-bar">
            <span className="module-id">
              <span className="screw-dot" />
              MOD-01 // DIALOG &amp; VOICEBOX UNIT
            </span>
            <span className="module-id">GEMINI-ARGON READY</span>
          </div>

          <div className="robot-deck">
            <RobotCRTUnit
              speaking={speaking}
              listening={listening}
              thinking={thinking}
              mood={mood}
            />

            <div className="robot-info-column">
              <div className="robot-headline">
                <h1 id="mod01-heading">Halo, aku REYA.</h1>
                <p>
                  Konsol robot AI berbahasa Indonesia dengan otak Gemini Flash,
                  sintesis suara Voicebox, dan instrumen musik dua tangan.
                </p>
              </div>

              <div className="spec-readout-grid">
                <div className="spec-cell">
                  <small>MODEL OTAK</small>
                  <strong className="mono">{activeBrainLabel}</strong>
                </div>
                <div className="spec-cell">
                  <small>MESIN SUARA</small>
                  <strong className="mono">{activeVoiceLabel}</strong>
                </div>
              </div>

              <div className="mood-selector-row">
                {[
                  { id: 0, label: "01 CERIA" },
                  { id: 1, label: "02 KALEM" },
                  { id: 2, label: "03 FOKUS" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`mood-chip ${mood === item.id ? "active" : ""}`}
                    onClick={() => setMood(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="hw-button"
                  onClick={() =>
                    void speak(
                      "Halo! Aku REYA. Suaraku terhubung dengan Voicebox dan siap menemanimu ngobrol atau bermain musik!",
                    )
                  }
                >
                  <IconSpeaker />
                  <span>Uji Suara</span>
                </button>
              </div>
            </div>
          </div>

          <div className="dialog-section">
            <div className="dialog-header">
              <h2>Obrolan Langsung</h2>
              <span className="module-id">
                {speaking
                  ? "STATUS: MENGELUARKAN SUARA"
                  : thinking
                  ? "STATUS: MEMPROSES JAWABAN"
                  : listening
                  ? "STATUS: MEREKAM MIKROFON"
                  : "STATUS: SIAP MENERIMA PESAN"}
              </span>
            </div>

            <div className="messages-well" aria-live="polite">
              {messages.slice(-6).map((message, index) => (
                <div
                  className={`message-row ${message.role}`}
                  key={`${message.role}-${index}-${message.content.slice(0, 12)}`}
                >
                  <span className="message-tag">
                    {message.role === "assistant" ? "R1" : "U"}
                  </span>
                  <p className="message-bubble">{message.content}</p>
                </div>
              ))}
              {thinking && (
                <div className="message-row assistant">
                  <span className="message-tag">R1</span>
                  <p className="message-bubble mono">
                    Memproses respons lewat {activeBrainLabel}...
                  </p>
                </div>
              )}
            </div>

            <div className="prompt-strip">
              {[
                "Jelaskan cara kerja AI secara singkat",
                "Bagaimana cara main musik pakai tangan?",
                "Apa keunggulan mesin suara Voicebox?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="prompt-pill"
                  onClick={() => void askRobot(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <form
              className={`composer-bar ${listening ? "recording" : ""}`}
              onSubmit={(event) => {
                event.preventDefault();
                void askRobot();
              }}
            >
              <button
                type="button"
                className={`hw-button ${listening ? "primary" : ""}`}
                onClick={() => void startListening()}
                aria-label={
                  listening
                    ? "Hentikan perekaman mikrofon"
                    : "Bicara dengan REYA lewat mikrofon"
                }
              >
                <IconMic />
                <span>{listening ? "Stop Mic" : "Bicara"}</span>
              </button>
              <input
                className="composer-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  listening
                    ? "Mendengarkan suaramu..."
                    : "Tulis pesan untuk REYA atau tekan tombol Bicara..."
                }
                aria-label="Pesan untuk REYA"
              />
              <button
                className="hw-button primary send-btn"
                type="submit"
                disabled={!input.trim() || thinking}
              >
                <span>Kirim Pesan</span>
              </button>
            </form>
          </div>
        </section>

        {/* MOD-02: OPTICAL HAND-TRACKING SENSOR */}
        <aside className="hw-module" aria-labelledby="mod02-heading">
          <div className="module-index-bar">
            <span className="module-id">
              <span className="screw-dot" />
              MOD-02 // OPTICAL HAND SENSOR
            </span>
            <span className="module-id">MEDIAPIPE 2-HAND</span>
          </div>

          <div className="camera-header">
            <div>
              <h2 id="mod02-heading">Sensor Gerakan Tangan</h2>
            </div>
            <div className="camera-controls">
              <button
                type="button"
                className="hw-button"
                onClick={() => setCameraExpanded((prev) => !prev)}
                aria-label="Ubah ukuran layar kamera"
              >
                <span>{cameraExpanded ? "Ukuran Normal" : "Perbesar"}</span>
              </button>
              <button
                type="button"
                className={`hw-button ${cameraOn ? "active-green" : "primary"}`}
                onClick={() => void startCamera()}
                aria-pressed={cameraOn}
              >
                <IconCamera />
                <span>{cameraOn ? "Kamera Aktif" : "Nyalakan Kamera"}</span>
              </button>
            </div>
          </div>

          <div
            className={`viewfinder ${cameraExpanded ? "expanded" : ""}`}
            style={
              cameraAspect && !cameraExpanded
                ? { aspectRatio: `${cameraAspect}` }
                : undefined
            }
          >
            <video ref={videoRef} muted playsInline />
            <canvas ref={canvasRef} />

            {cameraOn && (
              <div className="viewfinder-hud-top">
                <span className="hud-tag">OPTICAL TRACKING ON</span>
                {cameraAspect && (
                  <span className="hud-tag">
                    {cameraAspect > 1.5 ? "16:9 HD" : "4:3"}
                  </span>
                )}
              </div>
            )}

            {!cameraOn && (
              <div className="viewfinder-state">
                <IconCamera />
                <strong>
                  {cameraLoading
                    ? "Menyiapkan model pelacak tangan..."
                    : cameraError
                    ? "Kamera gagal diaktifkan"
                    : "Sensor optik belum aktif"}
                </strong>
                <p>
                  {cameraError ||
                    "Klik tombol Nyalakan Kamera di kanan atas untuk mengendalikan synthesizer dengan gerakan jari dan telapak tangan."}
                </p>
              </div>
            )}
          </div>

          <div className="gesture-telemetry-bar">
            <div className="gesture-code-box">
              {gestureCodes[gesture] ?? "HAND"}
            </div>
            <div className="gesture-readout">
              <small>GESTURE TERDETEKSI</small>
              <strong>{gestureLabels[gesture] ?? gesture}</strong>
            </div>
            <div className="confidence-meter">
              {Math.round(gestureScore * 100)}%
            </div>
          </div>

          <div className="quick-actions-row">
            <button
              type="button"
              className={`hw-button ${musicPlaying ? "active-green" : ""}`}
              onClick={() => {
                if (musicPlaying) stopMusic();
                else startMusicTutorial();
              }}
            >
              <IconWave />
              <span>
                {musicPlaying ? "Matikan Synth" : "Mainkan Musik"}
              </span>
            </button>
            <button
              type="button"
              className="hw-button"
              onClick={() => {
                setVoiceModal(true);
                void probeVoicebox();
              }}
            >
              <IconSpeaker />
              <span>Konfigurasi Voicebox</span>
            </button>
          </div>
        </aside>

        {/* MOD-03: POLYPHONIC GESTURE SYNTH DECK */}
        <section
          className="hw-module synth-module"
          id="music-lab"
          aria-labelledby="mod03-heading"
        >
          <div className="module-index-bar">
            <span className="module-id">
              <span className="screw-dot" />
              MOD-03 // POLYPHONIC GESTURE SYNTHESIZER
            </span>
            <span className="module-id">
              {musicPlaying ? "AUDIO ENGINE: ACTIVE" : "AUDIO ENGINE: STANDBY"}
            </span>
          </div>

          <div className="synth-top-row">
            <div>
              <h2 id="mod03-heading">Mainkan Musik dengan Tanganmu</h2>
              <p>
                Gunakan gerakan tangan di depan kamera atau sentuh dan geser
                langsung kanvas matriks 2D di bawah untuk memainkan nada.
              </p>
            </div>
            <div className="camera-controls">
              <button
                type="button"
                className={`hw-button ${
                  musicPlaying ? "primary" : "active-green"
                }`}
                onClick={() => {
                  if (musicPlaying) stopMusic();
                  else startMusic();
                }}
              >
                <IconWave />
                <span>
                  {musicPlaying ? "Hentikan Sesi Musik" : "Aktifkan Mesin Synth"}
                </span>
              </button>
            </div>
          </div>

          <div
            className="synth-bank-tabs"
            role="tablist"
            aria-label="Bank instrumen musik"
          >
            {musicModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="tab"
                aria-selected={musicMode === mode.id}
                className={`bank-tab ${musicMode === mode.id ? "active" : ""}`}
                onClick={() => selectMusicMode(mode.id)}
              >
                <span className="bank-tab-code">{mode.bankCode}</span>
                <strong>{mode.name}</strong>
              </button>
            ))}
          </div>

          <div className="synth-workstation">
            <div className="pitch-matrix-frame">
              <div className="matrix-status-strip">
                <span className="mono">{lastPlayedLabel}</span>
                <span className="mono">
                  KANAN: {handPositions.right?.note || "--"} | KIRI:{" "}
                  {handPositions.left?.note || "--"}
                </span>
              </div>

              <div
                ref={pitchFieldRef}
                className="pitch-field"
                role="application"
                aria-label="Matriks 2D tinggi nada dan filter. Klik atau geser untuk membunyikan instrumen."
                onPointerDown={(event) => {
                  pointerDownRef.current = true;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const rect = event.currentTarget.getBoundingClientRect();
                  triggerMatrixCoordinate(
                    (event.clientX - rect.left) / rect.width,
                    (event.clientY - rect.top) / rect.height,
                  );
                }}
                onPointerMove={(event) => {
                  if (!pointerDownRef.current) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  triggerMatrixCoordinate(
                    (event.clientX - rect.left) / rect.width,
                    (event.clientY - rect.top) / rect.height,
                  );
                }}
                onPointerUp={() => {
                  pointerDownRef.current = false;
                }}
                onPointerCancel={() => {
                  pointerDownRef.current = false;
                }}
              >
                <div className="pitch-scale-labels">
                  {scaleLabels.map((label, i) => (
                    <div
                      className="pitch-line"
                      key={`${label}-${i}`}
                      style={{
                        top: `${(1 - i / Math.max(1, scaleLabels.length - 1)) * 100}%`,
                      }}
                    >
                      <span>{label}</span>
                    </div>
                  ))}
                </div>

                {handPositions.right?.playing && (
                  <div
                    className="hand-node melody"
                    style={{
                      top: `${handPositions.right.y * 100}%`,
                      left: `${(1 - handPositions.right.x) * 100}%`,
                    }}
                  >
                    <strong>{handPositions.right.note}</strong>
                    <small>LEAD</small>
                  </div>
                )}

                {handPositions.left?.playing && (
                  <div
                    className="hand-node bass"
                    style={{
                      top: `${handPositions.left.y * 100}%`,
                      left: `${(1 - handPositions.left.x) * 100}%`,
                    }}
                  >
                    <strong>{handPositions.left.note}</strong>
                    <small>BASS</small>
                  </div>
                )}
              </div>

              <div className="matrix-footer">
                <span>SUMBU Y: FREKUENSI NADA (BAWAH = RENDAH, ATAS = TINGGI)</span>
                <span>SUMBU X: FILTER CUTOFF (500 HZ SAMPAI 5000 HZ)</span>
              </div>
            </div>

            <aside className="synth-guide-card">
              <div>
                <span className="module-id">{activeMusicMode.bankCode}</span>
                <h3>{activeMusicMode.name}</h3>
                <p>{activeMusicMode.instruction}</p>
              </div>

              <ul className="gesture-spec-list">
                <li>
                  <code>TELAPAK</code>
                  <span>Aktifkan sensor &amp; mainkan akor mayor</span>
                </li>
                <li>
                  <code>TELUNJUK</code>
                  <span>Mainkan melodi mengikuti tinggi tangan</span>
                </li>
                <li>
                  <code>2 JARI</code>
                  <span>Pindah ke bank instrumen berikutnya</span>
                </li>
                <li>
                  <code>KEPAL</code>
                  <span>Hentikan seluruh keluaran suara synth</span>
                </li>
              </ul>

              <button
                type="button"
                className="hw-button"
                onClick={startMusicTutorial}
              >
                <IconSpeaker />
                <span>Dengar Panduan Suara REYA</span>
              </button>
            </aside>
          </div>
        </section>
      </div>

      {/* STUDIO SUARA & VOICEBOX CONFIGURATION MODAL */}
      {voiceModal && (
        <div className="modal-backdrop">
          <section
            className="voice-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-title"
          >
            <div className="modal-top">
              <div>
                <span className="module-id">KONFIGURASI SINTESIS SUARA</span>
                <h2 id="voice-title">Studio Suara &amp; Voicebox</h2>
              </div>
              <button
                type="button"
                className="hw-button"
                onClick={() => setVoiceModal(false)}
                aria-label="Tutup jendela Studio Suara"
              >
                <span>Tutup</span>
              </button>
            </div>

            <div className="engine-tabs" role="tablist">
              <button
                type="button"
                className={voiceEngine === "voicebox" ? "active" : ""}
                onClick={() => changeVoiceEngine("voicebox")}
              >
                Voicebox Studio
              </button>
              <button
                type="button"
                className={voiceEngine === "supertonic" ? "active" : ""}
                onClick={() => changeVoiceEngine("supertonic")}
              >
                Natural Indo
              </button>
              <button
                type="button"
                className={voiceEngine === "qwen" ? "active" : ""}
                onClick={() => changeVoiceEngine("qwen")}
              >
                Custom Qwen
              </button>
              <button
                type="button"
                className={voiceEngine === "browser" ? "active" : ""}
                onClick={() => changeVoiceEngine("browser")}
              >
                Browser
              </button>
            </div>

            {voiceEngine === "voicebox" && (
              <div className="voicebox-panel">
                <div className="voicebox-status-row">
                  <div className="telemetry-item">
                    <span
                      className={`status-led ${voiceboxOnline ? "online" : ""}`}
                    />
                    <strong className="mono">
                      {voiceboxOnline
                        ? "VOICEBOX TERHUBUNG"
                        : "VOICEBOX OFFLINE (FALLBACK AKTIF)"}
                    </strong>
                  </div>
                  <span className="module-id">jamiepine/voicebox</span>
                </div>

                <div className="field-group">
                  <label htmlFor="vb-url-input">ENDPOINT SERVER VOICEBOX</label>
                  <div className="url-input-row">
                    <input
                      id="vb-url-input"
                      className="field-input mono"
                      value={voiceboxUrl}
                      onChange={(event) => setVoiceboxUrl(event.target.value)}
                      placeholder="http://127.0.0.1:17493"
                    />
                    <button
                      type="button"
                      className="hw-button"
                      onClick={() => void probeVoicebox(voiceboxUrl, true)}
                      disabled={voiceboxChecking}
                    >
                      <span>
                        {voiceboxChecking ? "Mengecek..." : "Cek Koneksi"}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="field-group">
                  <label htmlFor="vb-profile-select">
                    PROFIL SUARA VOICEBOX (GET /profiles)
                  </label>
                  {voiceboxProfiles.length > 0 ? (
                    <select
                      id="vb-profile-select"
                      className="field-input"
                      value={voiceboxProfileId}
                      onChange={(event) =>
                        setVoiceboxProfileId(event.target.value)
                      }
                    >
                      {voiceboxProfiles.map((prof) => (
                        <option key={prof.id} value={prof.id}>
                          {prof.name} ({prof.language || "id"})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="vb-profile-select"
                      className="field-input mono"
                      value={voiceboxProfileId}
                      onChange={(event) =>
                        setVoiceboxProfileId(event.target.value)
                      }
                      placeholder="Masukkan ID atau nama profil Voicebox (contoh: default)"
                    />
                  )}
                </div>
              </div>
            )}

            {(voiceEngine === "supertonic" || voiceEngine === "qwen") && (
              <div className="field-group">
                <label htmlFor="local-profile-select">KARAKTER SUARA LOKAL</label>
                <select
                  id="local-profile-select"
                  className="field-input"
                  value={
                    voiceProfile.startsWith("clone:") ? "custom" : voiceProfile
                  }
                  onChange={(event) =>
                    event.target.value !== "custom" &&
                    setVoiceProfile(event.target.value)
                  }
                >
                  {voiceEngine === "supertonic" ? (
                    <>
                      <option value="F2">
                        F2 : REYA Cute (Ceria, muda, Bahasa Indonesia)
                      </option>
                      <option value="F5">F5 : REYA Calm (Lembut &amp; tenang)</option>
                      <option value="F1">F1 : Kalem &amp; dewasa</option>
                      <option value="F3">F3 : Jelas &amp; artikulatif</option>
                      <option value="F4">F4 : Ekspresif</option>
                    </>
                  ) : (
                    <>
                      <option value="Serena">Serena : Hangat &amp; lembut</option>
                      <option value="Vivian">Vivian : Muda &amp; ceria</option>
                      <option value="Aiden">Aiden : Jernih</option>
                      <option value="Ryan">Ryan : Dinamis</option>
                      {voiceProfile.startsWith("clone:") && (
                        <option value="custom">
                          {voiceProfile.replace("clone:", "")} (Custom Clone)
                        </option>
                      )}
                    </>
                  )}
                </select>
              </div>
            )}

            {(voiceEngine === "voicebox" || voiceEngine === "qwen") && (
              <>
                <div className="field-group">
                  <label htmlFor="voice-style-input">
                    INSTRUKSI GAYA BICARA (INSTRUCT)
                  </label>
                  <input
                    id="voice-style-input"
                    className="field-input"
                    value={voiceStyle}
                    onChange={(event) => setVoiceStyle(event.target.value)}
                  />
                </div>

                <div className="voicebox-panel">
                  <strong>Buat Profil Kloning Suara Baru</strong>
                  <div className="url-input-row">
                    <input
                      className="field-input"
                      value={voiceName}
                      onChange={(event) => setVoiceName(event.target.value)}
                      placeholder="Contoh: Suara Reyhan"
                      aria-label="Nama profil suara baru"
                    />
                    <button
                      type="button"
                      className={`hw-button ${voiceRecording ? "primary" : ""}`}
                      onClick={() => void recordCustomVoice()}
                    >
                      <IconMic />
                      <span>
                        {voiceRecording
                          ? "Berhenti"
                          : voiceBlob
                          ? "Rekam Ulang"
                          : "Rekam 6 Detik"}
                      </span>
                    </button>
                  </div>
                  <textarea
                    className="field-input"
                    value={voiceTranscript}
                    onChange={(event) => setVoiceTranscript(event.target.value)}
                    placeholder="Tulis kalimat persis yang diucapkan saat merekam contoh suara..."
                    rows={2}
                  />
                  <button
                    type="button"
                    className="hw-button"
                    onClick={() => void saveCustomVoice()}
                    disabled={voiceSaving}
                  >
                    <span>
                      {voiceSaving
                        ? "Menyimpan Profil..."
                        : "Simpan Profil Kloning Suara"}
                    </span>
                  </button>
                </div>
              </>
            )}

            <div style={{ marginTop: "18px", display: "flex", gap: "10px" }}>
              <button
                type="button"
                className="hw-button primary"
                style={{ width: "100%" }}
                onClick={() => {
                  setVoiceModal(false);
                  void speak(
                    "Halo! Ini adalah uji suara REYA dari konsol Studio Suara.",
                  );
                }}
              >
                <IconSpeaker />
                <span>Simpan &amp; Uji Suara REYA</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </main>
  );
}
