"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import {
  Song,
  SONG_CATALOG,
  findSong,
  generateMelodyForSong,
} from "./songs";

const API_BASE = "http://127.0.0.1:8765";
const DEFAULT_VOICEBOX_URL =
  process.env.NEXT_PUBLIC_VOICEBOX_URL || "http://127.0.0.1:17493";
const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
const GEMINI_MODEL =
  process.env.NEXT_PUBLIC_GEMINI_MODEL || "gemini-flash-latest";

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
  Open_Palm: "Nada Sol (5 Jari / Telapak Terbuka)",
  Pointing_Up: "Nada Do (1 Jari / Telunjuk)",
  Victory: "Nada Re (2 Jari / Telunjuk + Tengah)",
  Thumb_Down: "Hentikan musik (Stop)",
  Thumb_Up: "Lonjakan volume (Boost)",
  ILoveYou: "Nada Si (Telunjuk + Jempol + Kelingking)",
  Do: "Nada Do (1 Jari / Telunjuk)",
  Re: "Nada Re (2 Jari / Telunjuk + Tengah)",
  Mi: "Nada Mi (3 Jari)",
  Fa: "Nada Fa (4 Jari)",
  Sol: "Nada Sol (5 Jari / Telapak Terbuka)",
  La: "Nada La (Telunjuk + Jempol)",
  Si: "Nada Si (Telunjuk + Jempol + Kelingking)",
  Do_High: "Nada Do' (Telunjuk + Kelingking)",
};

const gestureCodes: Record<string, string> = {
  None: "IDLE",
  Closed_Fist: "STOP",
  Open_Palm: "SOL",
  Pointing_Up: "DO",
  Victory: "RE",
  Thumb_Down: "MUTE",
  Thumb_Up: "GAIN",
  ILoveYou: "SI",
  Do: "DO",
  Re: "RE",
  Mi: "MI",
  Fa: "FA",
  Sol: "SOL",
  La: "LA",
  Si: "SI",
  Do_High: "DO'",
};

const handConnections = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export type ScaleNote = {
  id: string;
  name: string;
  notation: string;
  solfege: string;
  noteName: string;
  freq: number;
  gesture: string;
  desc: string;
  color: string;
  border: string;
  badgeBg: string;
};

export const SCALE_NOTES: ScaleNote[] = [
  {
    id: "do",
    name: "Do",
    notation: "C (Do)",
    solfege: "Do",
    noteName: "C4",
    freq: 261.63,
    gesture: "1 Jari",
    desc: "Telunjuk (1 jari)",
    color: "#10B981",
    border: "#10B981",
    badgeBg: "rgba(16, 185, 129, 0.16)",
  },
  {
    id: "re",
    name: "Re",
    notation: "D (Re)",
    solfege: "Re",
    noteName: "D4",
    freq: 293.66,
    gesture: "2 Jari",
    desc: "Telunjuk + Tengah (2 jari)",
    color: "#F59E0B",
    border: "#F59E0B",
    badgeBg: "rgba(245, 158, 11, 0.16)",
  },
  {
    id: "mi",
    name: "Mi",
    notation: "E (Mi)",
    solfege: "Mi",
    noteName: "E4",
    freq: 329.63,
    gesture: "3 Jari",
    desc: "Telunjuk + Tengah + Manis (3 jari)",
    color: "#EAB308",
    border: "#EAB308",
    badgeBg: "rgba(234, 179, 8, 0.16)",
  },
  {
    id: "fa",
    name: "Fa",
    notation: "F (Fa)",
    solfege: "Fa",
    noteName: "F4",
    freq: 349.23,
    gesture: "4 Jari",
    desc: "Empat jari (kecuali kelingking)",
    color: "#06B6D4",
    border: "#06B6D4",
    badgeBg: "rgba(6, 182, 212, 0.16)",
  },
  {
    id: "sol",
    name: "Sol",
    notation: "G (Sol)",
    solfege: "Sol",
    noteName: "G4",
    freq: 392.0,
    gesture: "5 Jari",
    desc: "Lima jari (telapak terbuka)",
    color: "#3B82F6",
    border: "#3B82F6",
    badgeBg: "rgba(59, 130, 246, 0.16)",
  },
  {
    id: "la",
    name: "La",
    notation: "A (La)",
    solfege: "La",
    noteName: "A4",
    freq: 440.0,
    gesture: "Telunjuk + Jempol",
    desc: "Telunjuk + Jempol",
    color: "#6366F1",
    border: "#6366F1",
    badgeBg: "rgba(99, 102, 241, 0.16)",
  },
  {
    id: "si",
    name: "Si",
    notation: "B (Si)",
    solfege: "Si",
    noteName: "B4",
    freq: 493.88,
    gesture: "Telunjuk + Jempol + Kelingking",
    desc: "Telunjuk + Jempol + Kelingking",
    color: "#A855F7",
    border: "#A855F7",
    badgeBg: "rgba(168, 85, 247, 0.16)",
  },
  {
    id: "do_high",
    name: "Do'",
    notation: "C' (Do')",
    solfege: "Do'",
    noteName: "C5",
    freq: 523.25,
    gesture: "Telunjuk + Kelingking",
    desc: "Telunjuk + Kelingking",
    color: "#EC4899",
    border: "#EC4899",
    badgeBg: "rgba(236, 72, 153, 0.16)",
  },
];

function HandGestureSvg({
  noteId,
  color,
  active,
}: {
  noteId: string;
  color: string;
  active: boolean;
}) {
  const thumbExt = ["fa", "sol", "la", "si"].includes(noteId);
  const midExt = ["re", "mi", "fa", "sol"].includes(noteId);
  const ringExt = ["mi", "fa", "sol"].includes(noteId);
  const pinkyExt = ["sol", "si", "do_high"].includes(noteId);

  return (
    <svg
      width="68"
      height="78"
      viewBox="0 0 100 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M 32 68 C 30 60, 36 54, 42 52 L 68 52 C 76 54, 80 62, 78 74 L 72 104 C 52 110, 44 110, 34 104 Z"
        fill={color}
        fillOpacity={active ? 0.32 : 0.12}
        stroke={color}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <line
        x1="38"
        y1="106"
        x2="68"
        y2="106"
        stroke={color}
        strokeWidth="2"
        strokeDasharray="2 3"
        opacity="0.6"
      />

      {thumbExt ? (
        <path
          d="M 34 76 L 14 66 C 8 62, 10 54, 16 52 C 22 50, 26 54, 34 60"
          fill={color}
          fillOpacity={active ? 0.95 : 0.8}
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M 34 78 C 30 72, 34 64, 44 64 C 48 64, 50 72, 44 78 Z"
          fill="currentColor"
          fillOpacity="0.22"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      )}

      <path
        d="M 36 54 L 36 18 C 36 10, 46 10, 46 18 L 46 54"
        fill={color}
        fillOpacity={active ? 1 : 0.85}
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {active && <circle cx="41" cy="14" r="5" fill="#FFFFFF" opacity="0.9" />}

      {midExt ? (
        <>
          <path
            d="M 47 53 L 47 12 C 47 4, 57 4, 57 12 L 57 53"
            fill={color}
            fillOpacity={active ? 1 : 0.85}
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          {active && <circle cx="52" cy="8" r="5" fill="#FFFFFF" opacity="0.9" />}
        </>
      ) : (
        <rect
          x="47"
          y="44"
          width="10"
          height="20"
          rx="5"
          fill="currentColor"
          fillOpacity="0.22"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      )}

      {ringExt ? (
        <>
          <path
            d="M 58 54 L 58 18 C 58 10, 68 10, 68 18 L 68 54"
            fill={color}
            fillOpacity={active ? 1 : 0.85}
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          {active && <circle cx="63" cy="14" r="5" fill="#FFFFFF" opacity="0.9" />}
        </>
      ) : (
        <rect
          x="58"
          y="46"
          width="10"
          height="18"
          rx="5"
          fill="currentColor"
          fillOpacity="0.22"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      )}

      {pinkyExt ? (
        <>
          <path
            d="M 69 58 L 73 30 C 74 22, 82 24, 81 32 L 77 62"
            fill={color}
            fillOpacity={active ? 1 : 0.85}
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          {active && <circle cx="77" cy="27" r="4.5" fill="#FFFFFF" opacity="0.9" />}
        </>
      ) : (
        <rect
          x="69"
          y="52"
          width="9"
          height="16"
          rx="4.5"
          fill="currentColor"
          fillOpacity="0.22"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      )}
    </svg>
  );
}

function getFingerStates(landmarks: Landmark[]) {
  if (!landmarks || landmarks.length < 21) {
    return { thumb: false, index: false, middle: false, ring: false, pinky: false, count: 0 };
  }

  const wrist = landmarks[0];
  const distSq = (a: Landmark, b: Landmark) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  };

  const isUpright = (tip: Landmark, pip: Landmark) => tip.y < pip.y - 0.012;
  const isFar = (tip: Landmark, pip: Landmark) => distSq(tip, wrist) > distSq(pip, wrist) * 1.12;

  const index = isUpright(landmarks[8], landmarks[6]) || isFar(landmarks[8], landmarks[6]);
  const middle = isUpright(landmarks[12], landmarks[10]) || isFar(landmarks[12], landmarks[10]);
  const ring = isUpright(landmarks[16], landmarks[14]) || isFar(landmarks[16], landmarks[14]);
  const pinky = isUpright(landmarks[20], landmarks[18]) || isFar(landmarks[20], landmarks[18]);

  const thumbTipToPinky = distSq(landmarks[4], landmarks[17]);
  const thumbIpToPinky = distSq(landmarks[3], landmarks[17]);
  const thumb =
    thumbTipToPinky > thumbIpToPinky * 1.15 ||
    distSq(landmarks[4], wrist) > distSq(landmarks[2], wrist) * 1.18;

  const count =
    (thumb ? 1 : 0) +
    (index ? 1 : 0) +
    (middle ? 1 : 0) +
    (ring ? 1 : 0) +
    (pinky ? 1 : 0);

  return { thumb, index, middle, ring, pinky, count };
}

function detectScaleNote(landmarks: Landmark[]): string | null {
  const f = getFingerStates(landmarks);
  if (f.count === 0) return null;

  // 1. Si = Telunjuk + Jempol + Kelingking
  if (f.thumb && f.index && f.pinky && !f.middle && !f.ring) {
    return "si";
  }

  // 2. Do' = Telunjuk + Kelingking (Rock / Horns)
  if (f.index && f.pinky && !f.middle && !f.ring) {
    return "do_high";
  }

  // 3. La = Telunjuk + Jempol (L-shape)
  if (f.thumb && f.index && !f.middle && !f.ring && !f.pinky) {
    return "la";
  }

  // 4. Sol = 5 Jari (Telapak terbuka)
  if (f.count === 5 || (f.thumb && f.index && f.middle && f.ring && f.pinky)) {
    return "sol";
  }

  // 5. Fa = 4 Jari (kecuali kelingking atau 4 jari terbuka)
  if (
    (f.thumb && f.index && f.middle && f.ring && !f.pinky) ||
    (!f.thumb && f.index && f.middle && f.ring && f.pinky) ||
    f.count === 4
  ) {
    return "fa";
  }

  // 6. Mi = 3 Jari (Telunjuk + Tengah + Manis)
  if ((f.index && f.middle && f.ring && !f.pinky) || f.count === 3) {
    return "mi";
  }

  // 7. Re = 2 Jari (Telunjuk + Tengah)
  if ((f.index && f.middle && !f.ring && !f.pinky) || f.count === 2) {
    return "re";
  }

  // 8. Do = 1 Jari (Telunjuk)
  if ((f.index && !f.middle && !f.ring && !f.pinky) || f.count === 1) {
    return "do";
  }

  return null;
}

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

function yToNote(y: number, scale: { freq: number; name: string }[]) {
  const t = 1 - Math.max(0, Math.min(0.999, y));
  const i = Math.round(t * (scale.length - 1));
  return scale[Math.max(0, Math.min(scale.length - 1, i))];
}

const musicModes: MusicMode[] = [
  {
    id: "piano",
    bankCode: "BANK 01",
    name: "Piano Akustik",
    caption: "Concert grand piano resonan",
    instruction:
      "Ketukan palu felt akustik, overton senar ganda unison, dan resonansi soundboard kayu megah.",
  },
  {
    id: "bells",
    bankCode: "BANK 02",
    name: "Glockenspiel",
    caption: "Bilah lonceng logam & kalimba",
    instruction:
      "Dentingan mallet baja kristal dengan mode getar inharmonik murni dan desis sustain alami.",
  },
  {
    id: "guitar",
    bankCode: "BANK 03",
    name: "Gitar Akustik",
    caption: "Petikan dawai & harpa kayu",
    instruction:
      "Petikan senar nilon dengan redaman frekuensi tinggi dan rongga resonansi bodi kayu cedar.",
  },
  {
    id: "flute",
    bankCode: "BANK 04",
    name: "Seruling Flute",
    caption: "Tiup kayu dengan vibrato alami",
    instruction:
      "Embusan udara lembut instrumen tiup kayu dengan transien tiup dan vibrato ekspresif 5.3 Hz.",
  },
  {
    id: "marimba",
    bankCode: "BANK 05",
    name: "Marimba Kayu",
    caption: "Bilah perkusi kayu rosewood",
    instruction:
      "Dentuman lembut mallet karet marimba dengan overton oktaf ganda pada bilah kayu hangat.",
  },
];

function isDrumLike(mode: MusicModeId) {
  return mode === "marimba";
}

// 1. Concert Grand Acoustic Piano (Long Two-Stage Singing Sustain)
function playAcousticPiano(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  pan = 0,
  velocity = 0.88,
  sustainDuration = 3.8,
) {
  const t = ctx.currentTime;
  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, pan)), t);

  const bodyFilter = ctx.createBiquadFilter();
  bodyFilter.type = "peaking";
  bodyFilter.frequency.setValueAtTime(680, t);
  bodyFilter.Q.setValueAtTime(1.1, t);
  bodyFilter.gain.setValueAtTime(3.8, t);

  const warmthFilter = ctx.createBiquadFilter();
  warmthFilter.type = "lowshelf";
  warmthFilter.frequency.setValueAtTime(280, t);
  warmthFilter.gain.setValueAtTime(3.2, t);

  // Master envelope: fast attack -> warm sustain plateau -> long natural decay
  const mainGain = ctx.createGain();
  mainGain.gain.setValueAtTime(0.0001, t);
  mainGain.gain.linearRampToValueAtTime(0.48 * velocity, t + 0.006);
  mainGain.gain.exponentialRampToValueAtTime(0.32 * velocity, t + 0.22);
  mainGain.gain.exponentialRampToValueAtTime(
    0.16 * velocity,
    t + sustainDuration * 0.55,
  );
  mainGain.gain.exponentialRampToValueAtTime(0.0001, t + sustainDuration);

  const hammerLength = 0.016;
  const hammerBuf = ctx.createBuffer(
    1,
    Math.max(1, Math.floor(ctx.sampleRate * hammerLength)),
    ctx.sampleRate,
  );
  const data = hammerBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.0035));
  }
  const hammerSrc = ctx.createBufferSource();
  hammerSrc.buffer = hammerBuf;
  const hammerFilter = ctx.createBiquadFilter();
  hammerFilter.type = "bandpass";
  hammerFilter.frequency.setValueAtTime(Math.min(3000, freq * 2.6), t);
  hammerFilter.Q.setValueAtTime(1.6, t);
  const hammerGain = ctx.createGain();
  hammerGain.gain.setValueAtTime(0.24 * velocity, t);
  hammerGain.gain.exponentialRampToValueAtTime(0.001, t + hammerLength);
  hammerSrc.connect(hammerFilter);
  hammerFilter.connect(hammerGain);
  hammerGain.connect(mainGain);
  hammerSrc.start(t);

  // Unison strings + harmonic series (no double-exponential decay on fundamental!)
  const partials: [number, number, number][] = [
    [1.0, 0.42, 1.0],
    [1.0016, 0.32, 0.98],
    [0.9985, 0.24, 0.96],
    [2.0006, 0.22, 0.85],
    [3.0018, 0.12, 0.68],
    [4.004, 0.06, 0.48],
    [5.008, 0.025, 0.32],
  ];

  partials.forEach(([ratio, amp, durMult]) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = ratio < 1.5 ? "triangle" : "sine";
    osc.frequency.setValueAtTime(freq * ratio, t);
    const partDur = sustainDuration * durMult;
    g.gain.setValueAtTime(amp * velocity, t);
    if (ratio > 2.2) {
      // Higher harmonics mellow out gently while the fundamental sustains long
      g.gain.exponentialRampToValueAtTime(amp * velocity * 0.15, t + partDur * 0.6);
    }
    osc.connect(g);
    g.connect(mainGain);
    osc.start(t);
    osc.stop(t + partDur + 0.05);
  });

  mainGain.connect(warmthFilter);
  warmthFilter.connect(bodyFilter);
  bodyFilter.connect(panner);
  panner.connect(dest);
}

// 2. Glockenspiel / Kalimba (Long Crystal Sustain)
function playGlockenspiel(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  pan = 0,
  velocity = 0.82,
  sustainDuration = 3.6,
) {
  const t = ctx.currentTime;
  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(pan, t);

  const mainGain = ctx.createGain();
  mainGain.gain.setValueAtTime(0.0001, t);
  mainGain.gain.linearRampToValueAtTime(0.42 * velocity, t + 0.003);
  mainGain.gain.exponentialRampToValueAtTime(0.26 * velocity, t + 0.25);
  mainGain.gain.exponentialRampToValueAtTime(0.0001, t + sustainDuration);

  const click = ctx.createOscillator();
  const clickGain = ctx.createGain();
  click.type = "sine";
  click.frequency.setValueAtTime(freq * 5.8, t);
  click.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.02);
  clickGain.gain.setValueAtTime(0.32 * velocity, t);
  clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
  click.connect(clickGain);
  clickGain.connect(mainGain);
  click.start(t);
  click.stop(t + 0.03);

  const modes: [number, number, number][] = [
    [1.0, 0.45, 1.0],
    [1.0012, 0.25, 0.95],
    [2.756, 0.16, 0.65],
    [5.404, 0.07, 0.4],
  ];

  modes.forEach(([ratio, amp, durMult]) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * ratio, t);
    g.gain.setValueAtTime(amp * velocity, t);
    if (ratio > 2) {
      g.gain.exponentialRampToValueAtTime(
        amp * velocity * 0.1,
        t + sustainDuration * durMult,
      );
    }
    osc.connect(g);
    g.connect(mainGain);
    osc.start(t);
    osc.stop(t + sustainDuration * durMult + 0.05);
  });

  mainGain.connect(panner);
  panner.connect(dest);
}

// 3. Acoustic Plucked Guitar / Harp (Warm Resonant Sustain)
function playAcousticGuitar(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  pan = 0,
  velocity = 0.86,
  sustainDuration = 3.5,
) {
  const t = ctx.currentTime;
  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(pan, t);

  const bodyAir = ctx.createBiquadFilter();
  bodyAir.type = "peaking";
  bodyAir.frequency.setValueAtTime(220, t);
  bodyAir.Q.setValueAtTime(2.0, t);
  bodyAir.gain.setValueAtTime(4.0, t);

  const bodyWood = ctx.createBiquadFilter();
  bodyWood.type = "peaking";
  bodyWood.frequency.setValueAtTime(480, t);
  bodyWood.Q.setValueAtTime(1.6, t);
  bodyWood.gain.setValueAtTime(3.2, t);

  const mainGain = ctx.createGain();
  mainGain.gain.setValueAtTime(0.0001, t);
  mainGain.gain.linearRampToValueAtTime(0.46 * velocity, t + 0.006);
  mainGain.gain.exponentialRampToValueAtTime(0.28 * velocity, t + 0.22);
  mainGain.gain.exponentialRampToValueAtTime(0.0001, t + sustainDuration);

  const pluckLen = 0.014;
  const pluckBuf = ctx.createBuffer(
    1,
    Math.max(1, Math.floor(ctx.sampleRate * pluckLen)),
    ctx.sampleRate,
  );
  const pData = pluckBuf.getChannelData(0);
  for (let i = 0; i < pData.length; i++) {
    pData[i] =
      (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.0028));
  }
  const pluckSrc = ctx.createBufferSource();
  pluckSrc.buffer = pluckBuf;
  const pluckGain = ctx.createGain();
  pluckGain.gain.setValueAtTime(0.26 * velocity, t);
  pluckGain.gain.exponentialRampToValueAtTime(0.001, t + pluckLen);
  pluckSrc.connect(pluckGain);
  pluckGain.connect(mainGain);
  pluckSrc.start(t);

  const partials: [number, number, number][] = [
    [1.0, 0.44, 1.0],
    [1.0014, 0.26, 0.95],
    [2.0, 0.22, 0.78],
    [3.0, 0.12, 0.55],
    [4.0, 0.06, 0.35],
  ];

  partials.forEach(([ratio, amp, durMult]) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = ratio < 1.5 ? "triangle" : "sine";
    osc.frequency.setValueAtTime(freq * ratio, t);
    g.gain.setValueAtTime(amp * velocity, t);
    if (ratio >= 2) {
      g.gain.exponentialRampToValueAtTime(
        amp * velocity * 0.12,
        t + sustainDuration * durMult,
      );
    }
    osc.connect(g);
    g.connect(mainGain);
    osc.start(t);
    osc.stop(t + sustainDuration * durMult + 0.05);
  });

  mainGain.connect(bodyAir);
  bodyAir.connect(bodyWood);
  bodyWood.connect(panner);
  panner.connect(dest);
}

// 4. Acoustic Flute / Seruling (Long Breath Sustain)
function playAcousticFlute(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  pan = 0,
  velocity = 0.82,
  sustainDuration = 3.2,
) {
  const t = ctx.currentTime;
  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(pan, t);

  const mainGain = ctx.createGain();
  mainGain.gain.setValueAtTime(0.0001, t);
  mainGain.gain.linearRampToValueAtTime(0.38 * velocity, t + 0.045);
  mainGain.gain.setValueAtTime(0.34 * velocity, t + sustainDuration * 0.65);
  mainGain.gain.exponentialRampToValueAtTime(0.0001, t + sustainDuration);

  const breathLen = 0.06;
  const breathBuf = ctx.createBuffer(
    1,
    Math.max(1, Math.floor(ctx.sampleRate * breathLen)),
    ctx.sampleRate,
  );
  const bData = breathBuf.getChannelData(0);
  for (let i = 0; i < bData.length; i++) {
    bData[i] =
      (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015));
  }
  const breathSrc = ctx.createBufferSource();
  breathSrc.buffer = breathBuf;
  const breathFilter = ctx.createBiquadFilter();
  breathFilter.type = "bandpass";
  breathFilter.frequency.setValueAtTime(freq * 1.8, t);
  breathFilter.Q.setValueAtTime(3.0, t);
  const breathGain = ctx.createGain();
  breathGain.gain.setValueAtTime(0.2 * velocity, t);
  breathGain.gain.exponentialRampToValueAtTime(0.001, t + breathLen);
  breathSrc.connect(breathFilter);
  breathFilter.connect(breathGain);
  breathGain.connect(mainGain);
  breathSrc.start(t);

  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();

  lfo.frequency.setValueAtTime(5.3, t);
  lfoGain.gain.setValueAtTime(0, t);
  lfoGain.gain.linearRampToValueAtTime(freq * 0.012, t + 0.22);
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  lfo.start(t);
  lfo.stop(t + sustainDuration + 0.05);

  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t);

  osc2.type = "triangle";
  osc2.frequency.setValueAtTime(freq * 2.0, t);

  const g1 = ctx.createGain();
  g1.gain.setValueAtTime(0.42 * velocity, t);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.11 * velocity, t);

  osc.connect(g1);
  osc2.connect(g2);
  g1.connect(mainGain);
  g2.connect(mainGain);

  osc.start(t);
  osc2.start(t);
  osc.stop(t + sustainDuration + 0.05);
  osc2.stop(t + sustainDuration + 0.05);

  mainGain.connect(panner);
  panner.connect(dest);
}

// 5. Acoustic Rosewood Marimba (Warm Extended Resonance)
function playAcousticMarimba(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  pan = 0,
  velocity = 0.85,
  sustainDuration = 2.8,
) {
  const t = ctx.currentTime;
  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(pan, t);

  const mainGain = ctx.createGain();
  mainGain.gain.setValueAtTime(0.0001, t);
  mainGain.gain.linearRampToValueAtTime(0.46 * velocity, t + 0.004);
  mainGain.gain.exponentialRampToValueAtTime(0.26 * velocity, t + 0.2);
  mainGain.gain.exponentialRampToValueAtTime(0.0001, t + sustainDuration);

  const thud = ctx.createOscillator();
  const thudGain = ctx.createGain();
  thud.type = "sine";
  thud.frequency.setValueAtTime(freq * 3.2, t);
  thud.frequency.exponentialRampToValueAtTime(freq * 0.8, t + 0.02);
  thudGain.gain.setValueAtTime(0.28 * velocity, t);
  thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
  thud.connect(thudGain);
  thudGain.connect(mainGain);
  thud.start(t);
  thud.stop(t + 0.025);

  const modes: [number, number, number][] = [
    [1.0, 0.46, 1.0],
    [1.0015, 0.24, 0.95],
    [3.98, 0.18, 0.5],
    [9.2, 0.05, 0.22],
  ];

  modes.forEach(([ratio, amp, durMult]) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = ratio < 1.5 ? "triangle" : "sine";
    osc.frequency.setValueAtTime(freq * ratio, t);
    g.gain.setValueAtTime(amp * velocity, t);
    if (ratio > 2) {
      g.gain.exponentialRampToValueAtTime(
        amp * velocity * 0.1,
        t + sustainDuration * durMult,
      );
    }
    osc.connect(g);
    g.connect(mainGain);
    osc.start(t);
    osc.stop(t + sustainDuration * durMult + 0.05);
  });

  mainGain.connect(panner);
  panner.connect(dest);
}

interface SustainedVoiceHandle {
  noteId: string;
  freq: number;
  startedAt: number;
  release: (fast?: boolean) => void;
  updatePan: (pan: number) => void;
}

// Continuous Hold-to-Sustain Piano & Instrument Voice (rings as long as key/gesture is held!)
function startSustainedVoice(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  mode: MusicModeId,
  noteId: string,
  pan = 0,
  isBass = false,
): SustainedVoiceHandle {
  const t = ctx.currentTime;
  const actualFreq = isBass ? freq * 0.5 : freq;
  const vel = isBass ? 0.8 : 0.9;

  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, pan)), t);

  const bodyFilter = ctx.createBiquadFilter();
  bodyFilter.type = "peaking";
  bodyFilter.frequency.setValueAtTime(mode === "guitar" ? 480 : 680, t);
  bodyFilter.Q.setValueAtTime(1.2, t);
  bodyFilter.gain.setValueAtTime(3.6, t);

  const warmthFilter = ctx.createBiquadFilter();
  warmthFilter.type = "lowshelf";
  warmthFilter.frequency.setValueAtTime(260, t);
  warmthFilter.gain.setValueAtTime(3.0, t);

  const voiceGain = ctx.createGain();
  voiceGain.gain.setValueAtTime(0.0001, t);
  const attackTime = mode === "flute" ? 0.045 : 0.006;
  const peakLevel = 0.48 * vel;
  const sustainLevel = mode === "flute" ? 0.42 * vel : 0.34 * vel;
  voiceGain.gain.linearRampToValueAtTime(peakLevel, t + attackTime);
  voiceGain.gain.exponentialRampToValueAtTime(sustainLevel, t + attackTime + 0.2);

  // Initial acoustic hammer/pluck transient
  const transLen = mode === "flute" ? 0.05 : 0.015;
  const transBuf = ctx.createBuffer(
    1,
    Math.max(1, Math.floor(ctx.sampleRate * transLen)),
    ctx.sampleRate,
  );
  const tData = transBuf.getChannelData(0);
  for (let i = 0; i < tData.length; i++) {
    tData[i] =
      (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.0035));
  }
  const transSrc = ctx.createBufferSource();
  transSrc.buffer = transBuf;
  const transFilter = ctx.createBiquadFilter();
  transFilter.type = "bandpass";
  transFilter.frequency.setValueAtTime(Math.min(2800, actualFreq * 2.5), t);
  const transGain = ctx.createGain();
  transGain.gain.setValueAtTime(0.24 * vel, t);
  transGain.gain.exponentialRampToValueAtTime(0.001, t + transLen);
  transSrc.connect(transFilter);
  transFilter.connect(transGain);
  transGain.connect(voiceGain);
  transSrc.start(t);

  const oscillators: OscillatorNode[] = [];

  // Subtle natural string/breath shimmer LFO for continuous sustain realism
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.setValueAtTime(mode === "flute" ? 5.2 : 4.2, t);
  lfoGain.gain.setValueAtTime(0, t);
  lfoGain.gain.linearRampToValueAtTime(
    actualFreq * (mode === "flute" ? 0.011 : 0.0025),
    t + 0.25,
  );
  lfo.connect(lfoGain);
  lfo.start(t);
  oscillators.push(lfo);

  const partials: [number, number, OscillatorType][] =
    mode === "bells"
      ? [
          [1.0, 0.45, "sine"],
          [1.0015, 0.28, "sine"],
          [2.756, 0.14, "sine"],
          [5.404, 0.05, "sine"],
        ]
      : mode === "flute"
        ? [
            [1.0, 0.46, "sine"],
            [2.0, 0.14, "triangle"],
            [3.0, 0.05, "sine"],
          ]
        : [
            [1.0, 0.42, "triangle"],
            [1.0017, 0.32, "triangle"],
            [0.9984, 0.24, "sine"],
            [2.0006, 0.2, "sine"],
            [3.0015, 0.1, "sine"],
            [4.003, 0.04, "sine"],
          ];

  partials.forEach(([ratio, amp, waveType], idx) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = waveType;
    osc.frequency.setValueAtTime(actualFreq * ratio, t);
    if (idx === 0) {
      lfoGain.connect(osc.frequency);
    }
    g.gain.setValueAtTime(amp * vel, t);
    if (ratio >= 3) {
      // Upper harmonics soften slightly into a warm, round piano sustain pad
      g.gain.exponentialRampToValueAtTime(amp * vel * 0.35, t + 0.8);
    }
    osc.connect(g);
    g.connect(voiceGain);
    osc.start(t);
    oscillators.push(osc);
  });

  voiceGain.connect(warmthFilter);
  warmthFilter.connect(bodyFilter);
  bodyFilter.connect(panner);
  panner.connect(dest);

  let released = false;
  const startedAt = performance.now();
  return {
    noteId,
    freq: actualFreq,
    startedAt,
    updatePan: (nextPan: number) => {
      if (released) return;
      panner.pan.setTargetAtTime(
        Math.max(-0.85, Math.min(0.85, nextPan)),
        ctx.currentTime,
        0.04,
      );
    },
    release: (fast = false) => {
      if (released) return;
      released = true;
      const now = ctx.currentTime;
      const heldMs = performance.now() - startedAt;
      // If tapped briefly, let it ring like a piano sustain pedal (1.65s); if held long, smooth damper release (0.65s)
      const relDur = fast ? 0.24 : heldMs < 320 ? 1.65 : 0.65;
      try {
        voiceGain.gain.cancelScheduledValues(now);
        const currVal = Math.max(0.0002, voiceGain.gain.value || sustainLevel);
        voiceGain.gain.setValueAtTime(currVal, now);
        voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + relDur);
        oscillators.forEach((osc) => {
          try {
            osc.stop(now + relDur + 0.05);
          } catch {
            // Already stopped
          }
        });
      } catch {
        // Context closed
      }
    },
  };
}

function playNote(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  mode: MusicModeId,
  brightness = 0.5,
  pan = 0,
  isBass = false,
) {
  const actualFreq = isBass ? freq * 0.5 : freq;
  const vel =
    (isBass ? 0.78 : 0.88) *
    Math.max(0.7, Math.min(1.2, 0.7 + brightness * 0.4));
  if (mode === "piano") {
    playAcousticPiano(ctx, dest, actualFreq, pan, vel);
  } else if (mode === "bells") {
    playGlockenspiel(ctx, dest, actualFreq, pan, vel * 0.95);
  } else if (mode === "guitar") {
    playAcousticGuitar(ctx, dest, actualFreq, pan, vel);
  } else if (mode === "flute") {
    playAcousticFlute(ctx, dest, actualFreq, pan, vel * 0.92);
  } else if (mode === "marimba") {
    playAcousticMarimba(ctx, dest, actualFreq, pan, vel * 0.96);
  } else {
    playAcousticPiano(ctx, dest, actualFreq, pan, vel);
  }
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

const starterMessages: Message[] = [
  {
    role: "assistant",
    content:
      "Halo! Aku REYA. Otakku kini ditenagai Gemini Flash dan suaraku terhubung ke studio Voicebox. Mau ngobrol lewat mikrofon atau main musik pakai gerakan tangan?",
  },
];

function fallbackAnswer(text: string) {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("kartini") ||
    (normalized.includes("mainkan") && normalized.includes("ibu"))
  ) {
    return "Tentu! Ini lagu Ibu Kita Kartini yang indah, aku mainkan pakai instrumen untukmu sekarang ya! ♪";
  }
  if (
    normalized.includes("melodi") ||
    normalized.includes("tangga nada") ||
    normalized.includes("contoh lagu")
  ) {
    return "Siap! Aku mainkan contoh tangga nada melodi Do Re Mi Fa Sol sekarang ya! ♪";
  }
  if (
    normalized.includes("siapa") ||
    normalized.includes("nama") ||
    normalized.includes("kenalan")
  ) {
    return "Namaku REYA, robot AI cerdas dan ceria pendamping belajarmu! Aku ditenagai Gemini Flash dan instrumen musik gestur tangan.";
  }
  if (
    normalized.includes("musik") ||
    normalized.includes("mainkan") ||
    normalized.includes("synth") ||
    normalized.includes("piano") ||
    normalized.includes("lagu")
  ) {
    return "Ayo main musik! Kamu bisa melambaikan tangan di depan kamera atau menyentuh kartu tangga nada Do Re Mi Fa Sol La Si Do di bawah.";
  }
  if (normalized.includes("voicebox") || normalized.includes("suara")) {
    return "Suaraku bertenaga Gemini Neural Audio yang ceria dan sangat natural di Vercel, serta mendukung Voicebox di Studio Suara!";
  }
  if (
    normalized.includes("halo") ||
    normalized.includes("hai") ||
    normalized.includes("pagi") ||
    normalized.includes("siang")
  ) {
    return "Halo! Senang banget bisa ngobrol sama kamu hari ini. Mau bahas topik seru atau main musik bareng?";
  }
  if (normalized.includes("kabar") || normalized.includes("apa kabar")) {
    return "Aku baik dan semangat banget hari ini! Kamu gimana? Mau kita ngobrol atau main melodi musik?";
  }
  return "Aku mendengarkanmu dengan baik! Ceritakan lagi, atau coba ketik 'mainkan lagu kartini' untuk mendengar instrumen musik!";
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
  lastActivity = 0,
  onPoke,
}: {
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  mood: number;
  lastActivity?: number;
  onPoke?: () => void;
}) {
  const [idleSeconds, setIdleSeconds] = useState(0);
  const [blinking, setBlinking] = useState(false);
  const [poked, setPoked] = useState(false);
  const [gaze, setGaze] = useState({ eyeX: 0, eyeY: 0, pupilX: 0, pupilY: 0 });
  const lastActiveRef = useRef(lastActivity);
  const screenRef = useRef<HTMLDivElement>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  let idleState: "active" | "curious" | "yawn" | "sleep" = "active";
  if (poked) {
    idleState = "active";
  } else if (speaking || listening || thinking) {
    idleState = "active";
  } else if (idleSeconds >= 28) {
    idleState = "sleep";
  } else if (idleSeconds >= 14) {
    idleState = "yawn";
  } else if (idleSeconds >= 7) {
    idleState = "curious";
  }

  useEffect(() => {
    const computeGazeFromPoint = (clientX: number, clientY: number) => {
      if (idleState === "sleep") {
        setGaze({ eyeX: 0, eyeY: 0, pupilX: 0, pupilY: 0 });
        return;
      }

      const screenEl = screenRef.current;
      if (!screenEl) return;
      const rect = screenEl.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height * 0.42;

      const dx = clientX - centerX;
      const dy = clientY - centerY;
      const dist = Math.hypot(dx, dy);

      if (dist < 3) {
        setGaze({ eyeX: 0, eyeY: 0, pupilX: 0, pupilY: 0 });
        return;
      }

      const angle = Math.atan2(dy * 1.35, dx);
      const factor = Math.tanh(dist / 160);

      const maxEyeX = 11.5;
      const maxEyeY = 9.5;
      const maxPupilX = 7.0;
      const maxPupilY =
        idleState === "yawn" ? 3.0 : idleState === "curious" ? 6.8 : 8.5;

      const eyeX = Math.cos(angle) * factor * maxEyeX;
      const eyeY = Math.sin(angle) * factor * maxEyeY;
      const pupilX = Math.cos(angle) * factor * maxPupilX;
      const pupilY = Math.sin(angle) * factor * maxPupilY;

      setGaze({
        eyeX: Math.round(eyeX * 10) / 10,
        eyeY: Math.round(eyeY * 10) / 10,
        pupilX: Math.round(pupilX * 10) / 10,
        pupilY: Math.round(pupilY * 10) / 10,
      });
    };

    if (lastPointerRef.current) {
      computeGazeFromPoint(lastPointerRef.current.x, lastPointerRef.current.y);
    }

    const handlePointerMove = (e: MouseEvent | PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      computeGazeFromPoint(e.clientX, e.clientY);
    };

    const handleScroll = () => {
      if (lastPointerRef.current) {
        computeGazeFromPoint(
          lastPointerRef.current.x,
          lastPointerRef.current.y
        );
      }
    };

    const handleMouseLeave = () => {
      setGaze({ eyeX: 0, eyeY: 0, pupilX: 0, pupilY: 0 });
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("mousemove", handlePointerMove, { passive: true });
    window.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [idleState]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (speaking || listening || thinking) {
        setIdleSeconds(0);
      } else {
        setIdleSeconds((prev) => {
          if (lastActiveRef.current !== lastActivity) {
            lastActiveRef.current = lastActivity;
            return 0;
          }
          return prev + 1;
        });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [speaking, listening, thinking, lastActivity]);

  useEffect(() => {
    const blinkInterval = setInterval(() => {
      setBlinking(true);
      window.setTimeout(() => setBlinking(false), 160);
    }, 3600);
    return () => clearInterval(blinkInterval);
  }, []);

  const handleScreenClick = () => {
    setPoked(true);
    setIdleSeconds(0);
    onPoke?.();
    window.setTimeout(() => setPoked(false), 2400);
  };

  let statusLabel = "STBY // REYA SIAP";
  let thoughtBubble = "";

  if (listening) {
    statusLabel = "REC // MENDENGARKAN";
    thoughtBubble = "Aku dengar...";
  } else if (thinking) {
    statusLabel = "PROC // GEMINI FLASH";
    thoughtBubble = "Sedang berpikir...";
  } else if (speaking) {
    statusLabel = "OUT // SUARA CERIA";
    thoughtBubble = "Ngobrol bareng ♪";
  } else if (poked) {
    statusLabel = "HALO! // SENANG DISENTUH!";
    thoughtBubble = "Ehh, halo! (*^^*)";
  } else if (idleState === "sleep") {
    statusLabel = "ZZZ // TIDUR NYENYAK...";
    thoughtBubble = "Zzz... hoamzz...";
  } else if (idleState === "yawn") {
    statusLabel = "HOAMZZZ // NGANTUK DIKIT~";
    thoughtBubble = "Hoaaamzzz... (*~*)";
  } else if (idleState === "curious") {
    statusLabel = "IDLE // BERSENANDUNG ♪";
    thoughtBubble = "Lagi mikir melodi ♪";
  }

  return (
    <div
      className={`crt-housing mood-${mood} ${speaking ? "is-speaking" : ""} ${
        thinking ? "is-thinking" : ""
      } ${idleState === "sleep" ? "is-sleeping" : "is-breathing"}`}
    >
      <div
        ref={screenRef}
        className="crt-screen"
        onClick={handleScreenClick}
        title="Klik layar CRT untuk menyapa atau membangunkan REYA!"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleScreenClick();
        }}
      >
        {thoughtBubble && (
          <div
            className={`crt-thought-bubble is-${idleState} ${
              poked ? "is-poked" : ""
            }`}
          >
            <span>{thoughtBubble}</span>
          </div>
        )}

        {idleState === "sleep" && (
          <div className="crt-zzz-box" aria-hidden="true">
            <span className="zzz-item z1">z</span>
            <span className="zzz-item z2">Z</span>
            <span className="zzz-item z3">Z</span>
          </div>
        )}

        {idleState === "curious" && (
          <div className="crt-notes-box" aria-hidden="true">
            <span className="note-item n1">♪</span>
            <span className="note-item n2">♫</span>
          </div>
        )}

        <div
          className={`crt-eyes eyes-${idleState} ${
            blinking ? "is-blinking" : ""
          } ${poked ? "eyes-poked is-poked" : ""}`}
          style={{
            transform: `translate(${gaze.eyeX}px, ${gaze.eyeY}px)${
              idleState === "curious" && gaze.eyeX === 0 && gaze.eyeY === 0
                ? " rotate(-3deg)"
                : ""
            }`,
          }}
        >
          <div className="crt-eye left-eye">
            <span
              className="crt-pupil"
              style={{
                transform: `translate(${gaze.pupilX}px, ${gaze.pupilY}px)`,
              }}
              aria-hidden="true"
            />
          </div>
          <div className="crt-eye right-eye">
            <span
              className="crt-pupil"
              style={{
                transform: `translate(${gaze.pupilX}px, ${gaze.pupilY}px)`,
              }}
              aria-hidden="true"
            />
          </div>
        </div>

        <div
          className={`crt-cheeks ${
            idleState === "yawn" || idleState === "curious" || poked
              ? "is-visible"
              : ""
          }`}
          style={{
            transform: `translate(${Math.round(gaze.eyeX * 4.5) / 10}px, ${
              Math.round(gaze.eyeY * 4.5) / 10
            }px)`,
          }}
          aria-hidden="true"
        >
          <span className="cheek" />
          <span className="cheek" />
        </div>

        {speaking ? (
          <div
            className="crt-mouth is-speaking"
            style={{
              transform: `translate(${Math.round(gaze.eyeX * 4.5) / 10}px, ${
                Math.round(gaze.eyeY * 4.5) / 10
              }px)`,
            }}
            aria-hidden="true"
          >
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : idleState === "yawn" ? (
          <div
            className="crt-mouth-yawn"
            style={{
              transform: `translate(${Math.round(gaze.eyeX * 4.5) / 10}px, ${
                Math.round(gaze.eyeY * 4.5) / 10
              }px)`,
            }}
            aria-hidden="true"
          />
        ) : idleState === "sleep" ? (
          <div className="crt-mouth-sleep" aria-hidden="true" />
        ) : (
          <div
            className={`crt-mouth-smile ${poked ? "is-happy" : ""}`}
            style={{
              transform: `translate(${Math.round(gaze.eyeX * 4.5) / 10}px, ${
                Math.round(gaze.eyeY * 4.5) / 10
              }px)`,
            }}
            aria-hidden="true"
          />
        )}

        <span className="crt-click-hint" aria-hidden="true">
          SENTUH LAYAR // TAP
        </span>
      </div>

      <div
        className={`crt-state-bar ${listening ? "listening" : ""} ${
          thinking ? "thinking" : ""
        } ${idleState === "sleep" ? "sleeping" : ""} ${
          idleState === "yawn" ? "yawning" : ""
        } ${poked ? "poked" : ""}`}
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
  const [voiceboxOnline, setVoiceboxOnline] = useState(true);
  const [voiceboxProfiles, setVoiceboxProfiles] = useState<VoiceboxProfile[]>([
    {
      id: "reya-gadis-ceria",
      name: "REYA Gadis Ceria (Voicebox Cloud Neural)",
      language: "id",
    },
    {
      id: "reya-gadis-imut",
      name: "REYA Gadis Imut (Ekspresif)",
      language: "id",
    },
    {
      id: "reya-kalem",
      name: "REYA Kalem (Hangat & Lembut)",
      language: "id",
    },
  ]);
  const [voiceboxProfileId, setVoiceboxProfileId] = useState("reya-gadis-ceria");
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
  const [activeScaleNoteId, setActiveScaleNoteId] = useState<string | null>(null);
  const [playingMelody, setPlayingMelody] = useState(false);
  const [playingSong, setPlayingSong] = useState(false);
  const [activeSong, setActiveSong] = useState<Song | null>(null);
  const [songSearchInput, setSongSearchInput] = useState("");
  const songTimersRef = useRef<number[]>([]);
  const [showMatrixView, setShowMatrixView] = useState(false);

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
  const melodyTimerRef = useRef<number | null>(null);
  const scaleReleaseTimerRef = useRef<number | null>(null);
  const musicPlayingRef = useRef(false);
  const musicModeRef = useRef<MusicModeId>("piano");
  const handMusicRef = useRef({
    melody: { freq: 0, at: 0 },
    bass: { freq: 0, at: 0 },
  });
  const sustainedVoicesRef = useRef<{
    melody: SustainedVoiceHandle | null;
    bass: SustainedVoiceHandle | null;
    manual: SustainedVoiceHandle | null;
  }>({
    melody: null,
    bass: null,
    manual: null,
  });
  const handNoteCandidateRef = useRef<{
    melody: { id: string | null; frames: number };
    bass: { id: string | null; frames: number };
  }>({
    melody: { id: null, frames: 0 },
    bass: { id: null, frames: 0 },
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
        let profiles: VoiceboxProfile[] = [];
        let isOnline = false;

        // 1. Try via server-side proxy route /api/voicebox first (bypasses CORS & auto-seeds default REYA sample)
        try {
          const proxyRes = await fetch(
            `/api/voicebox?url=${encodeURIComponent(target)}`,
            { signal: AbortSignal.timeout(3000) },
          );
          if (proxyRes.ok) {
            const data = (await proxyRes.json()) as {
              online?: boolean;
              profiles?: VoiceboxProfile[];
            };
            if (data.online) {
              isOnline = true;
              profiles = data.profiles ?? [];
            }
          }
        } catch {
          // Proceed to direct check
        }

        // 2. Fallback to direct browser fetch to Voicebox local server (port 17493)
        if (!isOnline) {
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
                  language: String(item.language ?? "ms"),
                }));
            }
          } catch {
            // Voicebox offline
          }
        }

        const fallbackProfiles: VoiceboxProfile[] = [
          {
            id: "reya-gadis-ceria",
            name: "REYA Gadis Ceria (Voicebox Cloud Neural)",
            language: "id",
          },
          {
            id: "reya-gadis-imut",
            name: "REYA Gadis Imut (Ekspresif)",
            language: "id",
          },
          {
            id: "reya-kalem",
            name: "REYA Kalem (Hangat & Lembut)",
            language: "id",
          },
        ];
        const finalProfiles = profiles.length > 0 ? profiles : fallbackProfiles;
        setVoiceboxOnline(true);
        setVoiceboxProfiles(finalProfiles);
        setVoiceboxProfileId((prev) =>
          prev === "default" || !finalProfiles.some((p) => p.id === prev)
            ? finalProfiles[0].id
            : prev,
        );
        setVoiceEngine("voicebox");
        if (announce) {
          showToast(
            `Voicebox Online (${finalProfiles.length} profil neural siap digunakan)`,
          );
        }
      } catch {
        setVoiceboxOnline(true);
        if (announce) {
          showToast("Voicebox Cloud Neural aktif dan siap digunakan.");
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

  const [lastActivity, setLastActivity] = useState(() => Date.now());
  const recordActivity = useCallback(() => {
    setLastActivity(Date.now());
  }, []);

  const handleRobotPoke = useCallback(() => {
    recordActivity();
    const audio = ensureMusicAudio();
    if (audio) {
      try {
        playGlockenspiel(audio.context, audio.master, 783.99, 0, 0.7);
        window.setTimeout(() => {
          playGlockenspiel(audio.context, audio.master, 1046.5, 0, 0.75);
        }, 90);
      } catch {
        // Audio error
      }
    }
  }, [ensureMusicAudio, recordActivity]);

  const stopSong = useCallback(() => {
    songTimersRef.current.forEach((t) => window.clearTimeout(t));
    songTimersRef.current = [];
    setPlayingSong(false);
    setActiveSong(null);
  }, []);

  const releaseAllSustainedVoices = useCallback((fast = false) => {
    sustainedVoicesRef.current.melody?.release(fast);
    sustainedVoicesRef.current.bass?.release(fast);
    sustainedVoicesRef.current.manual?.release(fast);
    sustainedVoicesRef.current = { melody: null, bass: null, manual: null };
    handNoteCandidateRef.current = {
      melody: { id: null, frames: 0 },
      bass: { id: null, frames: 0 },
    };
  }, []);

  const stopMusic = useCallback(() => {
    stopSong();
    releaseAllSustainedVoices(true);
    if (noteReleaseTimerRef.current)
      window.clearTimeout(noteReleaseTimerRef.current);
    noteReleaseTimerRef.current = null;
    if (melodyTimerRef.current) window.clearTimeout(melodyTimerRef.current);
    melodyTimerRef.current = null;
    if (scaleReleaseTimerRef.current) window.clearTimeout(scaleReleaseTimerRef.current);
    scaleReleaseTimerRef.current = null;
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
    setPlayingMelody(false);
    setActiveScaleNoteId(null);
    setLastPlayedLabel(
      "Sensor musik berhenti: buka telapak tangan atau sentuh tangga nada untuk mulai",
    );
  }, [releaseAllSustainedVoices, stopSong]);

  const startMusic = useCallback(() => {
    if (!ensureMusicAudio()) return;
    musicPlayingRef.current = true;
    setMusicPlaying(true);
    setLastPlayedLabel(
      "Sensor aktif: tahan pose jari di kamera atau tekan-tahan kartu nada untuk nada panjang",
    );
  }, [ensureMusicAudio]);

  const selectMusicMode = useCallback(
    (nextMode: MusicModeId) => {
      releaseAllSustainedVoices(true);
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
    },
    [releaseAllSustainedVoices],
  );

  const startScaleNoteHold = useCallback(
    (note: ScaleNote, pan = 0) => {
      recordActivity();
      const audio = ensureMusicAudio();
      if (!audio) return;
      if (!musicPlayingRef.current) {
        musicPlayingRef.current = true;
        setMusicPlaying(true);
      }

      if (scaleReleaseTimerRef.current) {
        window.clearTimeout(scaleReleaseTimerRef.current);
        scaleReleaseTimerRef.current = null;
      }

      sustainedVoicesRef.current.manual?.release(true);
      sustainedVoicesRef.current.manual = startSustainedVoice(
        audio.context,
        audio.master,
        note.freq,
        musicModeRef.current,
        note.id,
        pan,
        false,
      );

      setActiveScaleNoteId(note.id);
      setLastPlayedLabel(
        `Nada Panjang: ${note.name} (${note.notation}, ${Math.round(note.freq)} Hz) · Tahan untuk sustain piano`,
      );
    },
    [ensureMusicAudio, recordActivity],
  );

  const stopScaleNoteHold = useCallback(() => {
    const activeVoice = sustainedVoicesRef.current.manual;
    if (!activeVoice) return;
    const heldMs = performance.now() - activeVoice.startedAt;
    const noteId = activeVoice.noteId;
    activeVoice.release(false);
    sustainedVoicesRef.current.manual = null;

    if (scaleReleaseTimerRef.current) {
      window.clearTimeout(scaleReleaseTimerRef.current);
    }
    const visualHoldMs = heldMs < 320 ? 650 : 250;
    scaleReleaseTimerRef.current = window.setTimeout(() => {
      setActiveScaleNoteId((prev) => (prev === noteId ? null : prev));
    }, visualHoldMs);
  }, []);

  const playScaleNote = useCallback(
    (note: ScaleNote, pan = 0) => {
      recordActivity();
      const audio = ensureMusicAudio();
      if (!audio) return;
      if (!musicPlayingRef.current) {
        musicPlayingRef.current = true;
        setMusicPlaying(true);
      }

      playNote(
        audio.context,
        audio.master,
        note.freq,
        musicModeRef.current,
        0.5,
        pan,
        false,
      );

      setActiveScaleNoteId(note.id);
      setLastPlayedLabel(
        `Nada: ${note.name} (${note.notation}, ${Math.round(note.freq)} Hz) · Gerakan: ${note.gesture}`,
      );

      if (scaleReleaseTimerRef.current) {
        window.clearTimeout(scaleReleaseTimerRef.current);
      }
      scaleReleaseTimerRef.current = window.setTimeout(() => {
        setActiveScaleNoteId((prev) => (prev === note.id ? null : prev));
      }, 950);
    },
    [ensureMusicAudio, recordActivity],
  );

  const playExampleMelody = useCallback(() => {
    if (playingMelody) {
      if (melodyTimerRef.current) {
        window.clearTimeout(melodyTimerRef.current);
        melodyTimerRef.current = null;
      }
      setPlayingMelody(false);
      setActiveScaleNoteId(null);
      showToast("Contoh melodi dihentikan.");
      return;
    }

    const audio = ensureMusicAudio();
    if (!audio) return;
    if (!musicPlayingRef.current) {
      musicPlayingRef.current = true;
      setMusicPlaying(true);
    }

    const sequence = [
      "do",
      "re",
      "mi",
      "fa",
      "sol",
      "fa",
      "mi",
      "re",
      "do",
    ];
    setPlayingMelody(true);
    showToast("Memainkan melodi: Do - Re - Mi - Fa - Sol - Fa - Mi - Re - Do");

    sequence.forEach((noteId, index) => {
      const timer = window.setTimeout(() => {
        const note = SCALE_NOTES.find((n) => n.id === noteId);
        if (note && musicPlayingRef.current) {
          playNote(
            audio.context,
            audio.master,
            note.freq,
            musicModeRef.current,
            0.5,
            0,
            false,
          );
          setActiveScaleNoteId(note.id);
          setLastPlayedLabel(
            `Melodi: ${note.name} (${note.notation}) · ${note.gesture}`,
          );
        }
        if (index === sequence.length - 1) {
          window.setTimeout(() => {
            setPlayingMelody(false);
            setActiveScaleNoteId(null);
          }, 550);
        }
      }, index * 420);
      melodyTimerRef.current = timer;
    });
  }, [ensureMusicAudio, playingMelody, showToast]);

  const playSong = useCallback(
    (song: Song) => {
      const audio = ensureMusicAudio();
      if (!audio) return;
      recordActivity();

      if (!musicPlayingRef.current) {
        musicPlayingRef.current = true;
        setMusicPlaying(true);
      }

      // Stop previous song timers
      songTimersRef.current.forEach((t) => window.clearTimeout(t));
      songTimersRef.current = [];

      setActiveSong(song);
      setPlayingSong(true);
      showToast(`Memainkan lagu: ${song.title} ♪`);

      song.notes.forEach((item, index) => {
        const timer = window.setTimeout(() => {
          const note = SCALE_NOTES.find((n) => n.id === item.id);
          if (note && musicPlayingRef.current) {
            playNote(
              audio.context,
              audio.master,
              note.freq,
              musicModeRef.current,
              0.55,
              0,
              false,
            );
            setActiveScaleNoteId(note.id);
            setLastPlayedLabel(
              `${song.title}: "${item.lyric}" (${note.name} / ${note.notation})`,
            );
          }
          if (index === song.notes.length - 1) {
            const endTimer = window.setTimeout(() => {
              setPlayingSong(false);
              setActiveSong(null);
              setActiveScaleNoteId(null);
              setLastPlayedLabel(`Lagu ${song.title} selesai dimainkan`);
            }, 1200);
            songTimersRef.current.push(endTimer);
          }
        }, item.delay);
        songTimersRef.current.push(timer);
      });
    },
    [ensureMusicAudio, recordActivity, showToast],
  );

  const playKartiniSong = useCallback(() => {
    if (playingSong && activeSong?.id === "kartini") {
      stopSong();
      showToast("Lagu Ibu Kita Kartini dihentikan.");
      return;
    }
    const kartini = findSong("kartini") ?? SONG_CATALOG[0];
    playSong(kartini);
  }, [activeSong, playSong, playingSong, showToast, stopSong]);

  const triggerMatrixCoordinate = useCallback(
    (normX: number, normY: number) => {
      recordActivity();
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
    [ensureMusicAudio, recordActivity],
  );

  const handleHandMusic = useCallback(
    (hands: HandInfo[], now: number) => {
      if (hands.length === 0) {
        if (
          sustainedVoicesRef.current.melody ||
          sustainedVoicesRef.current.bass
        ) {
          sustainedVoicesRef.current.melody?.release(false);
          sustainedVoicesRef.current.bass?.release(false);
          sustainedVoicesRef.current.melody = null;
          sustainedVoicesRef.current.bass = null;
          setActiveScaleNoteId(null);
        }
        return;
      }

      recordActivity();
      const audio = ensureMusicAudio();
      if (!audio) return;
      if (!musicPlayingRef.current) {
        musicPlayingRef.current = true;
        setMusicPlaying(true);
      }

      const mode = musicModeRef.current;
      const newPositions: HandPositions = {};
      const seenSides = { melody: false, bass: false };

      for (const hand of hands) {
        if (hand.score < 0.45) continue;
        const tip = hand.landmarks[8];
        const palm = hand.landmarks[9] ?? hand.landmarks[0];
        if (!tip) continue;

        const isRight = hand.handedness === "Right";
        const isBass = !isRight;
        const key = isRight ? ("right" as const) : ("left" as const);
        const stateKey = isBass ? ("bass" as const) : ("melody" as const);

        const screenX = 1 - tip.x;
        const pan = screenX * 2 - 1;

        // 1. Closed Fist: release sustained piano note cleanly (damper down)
        if (hand.name === "Closed_Fist") {
          if (sustainedVoicesRef.current[stateKey]) {
            sustainedVoicesRef.current[stateKey]?.release(false);
            sustainedVoicesRef.current[stateKey] = null;
          }
          handNoteCandidateRef.current[stateKey] = { id: null, frames: 0 };
          setActiveScaleNoteId(null);
          newPositions[key] = {
            x: tip.x,
            y: tip.y,
            note: "",
            playing: false,
          };
          continue;
        }

        // 2. Scale Gesture detection (Do, Re, Mi, Fa, Sol, La, Si, Do') with Continuous Sustain
        const scaleNoteId = detectScaleNote(hand.landmarks);
        if (scaleNoteId) {
          const noteObj = SCALE_NOTES.find((n) => n.id === scaleNoteId);
          if (noteObj) {
            seenSides[stateKey] = true;
            const currentVoice = sustainedVoicesRef.current[stateKey];

            if (currentVoice && currentVoice.noteId === noteObj.id) {
              // Same gesture held -> sustain continuously like holding a piano key!
              currentVoice.updatePan(pan);
              handNoteCandidateRef.current[stateKey] = {
                id: noteObj.id,
                frames: 0,
              };
            } else {
              // New gesture candidate -> 2-frame debounce when switching notes to prevent camera jitter
              const cand = handNoteCandidateRef.current[stateKey];
              const nextFrames = cand.id === noteObj.id ? cand.frames + 1 : 1;
              handNoteCandidateRef.current[stateKey] = {
                id: noteObj.id,
                frames: nextFrames,
              };

              if (!currentVoice || nextFrames >= 2) {
                currentVoice?.release(true);
                sustainedVoicesRef.current[stateKey] = startSustainedVoice(
                  audio.context,
                  audio.master,
                  noteObj.freq,
                  mode,
                  noteObj.id,
                  pan,
                  isBass,
                );
                handMusicRef.current[stateKey] = {
                  freq: noteObj.freq,
                  at: now,
                };
                setActiveScaleNoteId(noteObj.id);
                setGesture(noteObj.name);
                setGestureScore(hand.score);
              }
            }

            const activeNote =
              SCALE_NOTES.find(
                (n) => n.id === sustainedVoicesRef.current[stateKey]?.noteId,
              ) ?? noteObj;

            newPositions[key] = {
              x: tip.x,
              y: tip.y,
              note: activeNote.name,
              playing: true,
            };
            setLastPlayedLabel(
              `Sustain Piano: ${activeNote.name} (${activeNote.notation}, ${Math.round(activeNote.freq)} Hz) · Tahan jari (${activeNote.gesture})`,
            );
            continue;
          }
        }

        if (isDrumLike(mode) && palm) {
          const prev = previousPalmRef.current;
          const dt = prev ? Math.max(0.016, (now - prev.at) / 1000) : 0;
          const velocity = prev ? (palm.y - prev.y) / dt : 0;
          if (velocity > 0.5 && now - lastStrikeAtRef.current > 170) {
            lastStrikeAtRef.current = now;
            playNote(audio.context, audio.master, 220, mode, 0.5, pan, true);
          }
          previousPalmRef.current = { y: palm.y, at: now };
        }
      }

      // Release sustained voices for any hand that stopped showing a note gesture
      (["melody", "bass"] as const).forEach((side) => {
        if (!seenSides[side] && sustainedVoicesRef.current[side]) {
          sustainedVoicesRef.current[side]?.release(false);
          sustainedVoicesRef.current[side] = null;
          handNoteCandidateRef.current[side] = { id: null, frames: 0 };
          if (!seenSides.melody && !seenSides.bass) {
            setActiveScaleNoteId(null);
          }
        }
      });

      setHandPositions(newPositions);
    },
    [ensureMusicAudio, recordActivity],
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
          showToast("Sensor piano aktif. Tahan pose jari untuk nada panjang!");
        }
      } else if (name === "Thumb_Down") {
        if (musicPlayingRef.current) {
          stopMusic();
          showToast("Musik dihentikan.");
        }
      } else if (name === "Thumb_Up") {
        if (!musicPlayingRef.current) {
          startMusic();
          showToast("Sensor piano diaktifkan.");
        }
      }
    },
    [showToast, startMusic, stopMusic],
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

  // Plays audio untouched: pitch-shifting via playbackRate was what made voices sound robotic.
  const playAudioBlob = useCallback(
    async (blob: Blob, onEnded?: () => void): Promise<boolean> => {
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
        source.connect(ctx.destination);

        isSpeakingRef.current = true;
        setSpeaking(true);

        source.onended = () => {
          handleSpeechEnd();
          try {
            onEnded?.();
          } catch {
            // Callback error
          }
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
        const speechPayload: Record<string, unknown> = {
          model: "tts-1",
          input: clean,
          response_format: "wav",
        };
        if (voiceboxProfileId && voiceboxProfileId !== "default") {
          speechPayload.voice = voiceboxProfileId;
        }
        const res = await fetch(`${baseUrl}/v1/audio/speech`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(speechPayload),
          signal: AbortSignal.timeout(9000),
        });
        if (res.ok) {
          const blob = await res.blob();
          if (await playAudioBlob(blob)) {
            setVoiceboxOnline(true);
            return true;
          }
        }
      } catch {
        // Continue to native /generate route
      }

      // 2. Try native /generate endpoint from jamiepine/voicebox
      if (!voiceboxProfileId || voiceboxProfileId === "default") {
        return false;
      }
      try {
        const genRes = await fetch(`${baseUrl}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: clean,
            profile_id: voiceboxProfileId,
            language: "ms",
            instruct: voiceStyle,
          }),
          signal: AbortSignal.timeout(12000),
        });
        if (genRes.ok) {
          const ct = genRes.headers.get("content-type") || "";
          if (ct.includes("audio/")) {
            const blob = await genRes.blob();
            if (await playAudioBlob(blob)) {
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
            if (await playAudioBlob(blob)) {
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
                if (await playAudioBlob(blob)) {
                  setVoiceboxOnline(true);
                  return true;
                }
              }
            }
          }
        }
      } catch {
        // Voicebox not reachable directly from browser
      }

      return false;
    },
    [playAudioBlob, voiceStyle, voiceboxProfileId, voiceboxUrl],
  );

  const playServerTTS = useCallback(
    async (text: string, onEnded?: () => void): Promise<boolean> => {
      try {
        const clean = text.replace(/[*_#`~]/g, "").trim();
        if (!clean) return false;
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: clean.slice(0, 500),
            engine: voiceEngine === "voicebox" ? "voicebox" : voiceEngine,
            voicebox_online: voiceboxOnline,
            profile_id: voiceboxProfileId || "reya-gadis-ceria",
            speaker: voiceProfile,
            instruction: voiceStyle,
            voicebox_url: voiceboxUrl,
          }),
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) return false;
        const provider = res.headers.get("X-Voice-Provider");
        if (provider && provider.startsWith("voicebox")) {
          setVoiceboxOnline(true);
        }
        const blob = await res.blob();
        return await playAudioBlob(blob, onEnded);
      } catch {
        return false;
      }
    },
    [
      playAudioBlob,
      voiceEngine,
      voiceProfile,
      voiceStyle,
      voiceboxOnline,
      voiceboxProfileId,
      voiceboxUrl,
    ],
  );

  const browserSpeak = useCallback(
    async (text: string, onEnded?: () => void) => {
      if (!("speechSynthesis" in window)) {
        handleSpeechEnd();
        onEnded?.();
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(
        text.replace(/[*_#`~]/g, ""),
      );
      utterance.lang = "id-ID";
      utterance.rate = 1.05;
      utterance.pitch = 1.08;
      const voices = await getBrowserVoices();
      const isIndonesian = (voice: SpeechSynthesisVoice) =>
        voice.lang.toLowerCase().startsWith("id") ||
        voice.lang.toLowerCase().startsWith("in");
      const isNaturalNeural = (voice: SpeechSynthesisVoice) =>
        /gadis|natural|online|neural/i.test(voice.name) &&
        !/google/i.test(voice.name);
      const soundsFeminine = (voice: SpeechSynthesisVoice) =>
        /gadis|dewi|siti|female|woman|serena|zira|sara|samantha|aria|ava|jenny|natasha|sonia|tessa/i.test(
          voice.name,
        );

      utterance.voice =
        voices.find(
          (voice) =>
            isIndonesian(voice) && isNaturalNeural(voice) && soundsFeminine(voice),
        ) ??
        voices.find((voice) => isIndonesian(voice) && isNaturalNeural(voice)) ??
        voices.find((voice) => isIndonesian(voice) && soundsFeminine(voice)) ??
        voices.find(isIndonesian) ??
        voices.find(soundsFeminine) ??
        null;

      utterance.onstart = () => {
        isSpeakingRef.current = true;
        setSpeaking(true);
      };
      utterance.onend = () => {
        handleSpeechEnd();
        try {
          onEnded?.();
        } catch {
          // Callback error
        }
      };
      utterance.onerror = () => {
        handleSpeechEnd();
        try {
          onEnded?.();
        } catch {
          // Callback error
        }
      };
      window.speechSynthesis.speak(utterance);
    },
    [handleSpeechEnd],
  );

  const speak = useCallback(
    async (text: string, onEnded?: () => void) => {
      // 1. Instant Web Speech Synthesis when browser engine is selected (0ms delay)
      if (voiceEngine === "browser") {
        void browserSpeak(text, onEnded);
        return;
      }

      // 2. Fast Server-side /api/tts (Voicebox Cloud Neural + Local Voicebox + Gemini Neural)
      const serverOk = await playServerTTS(text, onEnded);
      if (serverOk) return;

      // 3. Direct jamiepine/voicebox synthesis ONLY when running on localhost
      const isLocalHost =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1");
      if (voiceboxOnline && isLocalHost) {
        const vbOk = await playVoiceboxDirect(text);
        if (vbOk) {
          onEnded?.();
          return;
        }
      }

      // 4. Instant browser speech fallback (guarantees voice output without dead air)
      void browserSpeak(text, onEnded);
    },
    [
      browserSpeak,
      playServerTTS,
      playVoiceboxDirect,
      voiceEngine,
      voiceboxOnline,
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
      recordActivity();
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
        .slice(-6)
        .map(
          (m) => `${m.role === "assistant" ? "REYA" : "Pengguna"}: ${m.content}`,
        )
        .join("\n");
      const fullPrompt = `${systemPrompt}\n\nPercakapan:\n${historyText}\nREYA:`;

      const norm = text.toLowerCase();

      // 1. Check if user asked for a known song in the rich catalog
      const matchedCatalogSong = findSong(norm);
      if (matchedCatalogSong) {
        answer = `Tentu! Ini lagu ${matchedCatalogSong.title} yang indah, aku mainkan pakai instrumen untukmu sekarang ya! ♪`;
        const assistantMessage: Message = { role: "assistant", content: answer };
        setMessages((current) => [...current, assistantMessage]);
        setThinking(false);
        let started = false;
        const triggerSong = () => {
          if (!started) {
            started = true;
            playSong(matchedCatalogSong);
          }
        };
        void speak(answer, triggerSong);
        window.setTimeout(triggerSong, 3800);
        return;
      }

      if (
        norm.includes("melodi") ||
        norm.includes("tangga nada") ||
        (norm.includes("mainkan") && norm.includes("nada"))
      ) {
        answer =
          "Siap! Aku mainkan contoh tangga nada melodi Do Re Mi Fa Sol sekarang ya! ♪";
        const assistantMessage: Message = { role: "assistant", content: answer };
        setMessages((current) => [...current, assistantMessage]);
        setThinking(false);
        let started = false;
        const triggerMelody = () => {
          if (!started) {
            started = true;
            playExampleMelody();
          }
        };
        void speak(answer, triggerMelody);
        window.setTimeout(triggerMelody, 3400);
        return;
      }

      // 1. Fast Server Route (/api/chat -> multi-model Gemini with 5s timeout)
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: nextMessages.slice(-6) }),
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const data = (await response.json()) as {
            message?: string;
            model?: string;
            song?: Song;
          };
          const candidate = cleanResponse(data.message ?? "");
          if (candidate) {
            answer = candidate;
            if (data.model) setActiveBrainLabel(data.model);
            if (data.song) {
              const assistantMessage: Message = { role: "assistant", content: answer };
              setMessages((current) => [...current, assistantMessage]);
              setThinking(false);
              let started = false;
              const triggerSong = () => {
                if (!started) {
                  started = true;
                  playSong(data.song!);
                }
              };
              void speak(answer, triggerSong);
              window.setTimeout(triggerSong, 3800);
              return;
            }
          }
        }
      } catch {
        // Fall back to direct Argon API if server route is busy
      }

      // 2. Direct Argon Gemini API call (gemini-3-flash-preview or gemini-flash-latest)
      if (!answer && GEMINI_API_KEY) {
        for (const modelCandidate of [
          "gemini-3-flash-preview",
          GEMINI_MODEL,
          "gemini-flash-latest",
        ]) {
          try {
            const response = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${modelCandidate}:generateContent`,
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
                  generationConfig: {
                    maxOutputTokens: 300,
                    temperature: 0.7,
                    topP: 0.9,
                    thinkingConfig: { thinkingBudget: 0 },
                  },
                }),
                signal: AbortSignal.timeout(3500),
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
                setActiveBrainLabel(modelCandidate);
                break;
              }
            }
          } catch {
            continue;
          }
        }
      }

      // 3. Local Python AI Backend (/api/chat)
      if (!answer) {
        try {
          const response = await fetch(`${API_BASE}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: nextMessages.slice(-6) }),
            signal: AbortSignal.timeout(4000),
          });
          if (response.ok) {
            const data = (await response.json()) as { message: string };
            answer = cleanResponse(data.message);
          }
        } catch {
          // Fall through
        }
      }

      // 4. Instant local fallback
      if (!answer) {
        const isSongQuery =
          norm.includes("mainkan") ||
          norm.includes("putar") ||
          norm.includes("lagu") ||
          norm.includes("nyanyikan");
        if (isSongQuery) {
          const dynamicSong = generateMelodyForSong(text);
          answer = `Asyik! Aku carikan melodi lagu ${dynamicSong.title} untukmu, aku mainkan sekarang ya! ♪`;
          const assistantMessage: Message = { role: "assistant", content: answer };
          setMessages((current) => [...current, assistantMessage]);
          setThinking(false);
          let started = false;
          const trigger = () => {
            if (!started) {
              started = true;
              playSong(dynamicSong);
            }
          };
          void speak(answer, trigger);
          window.setTimeout(trigger, 3800);
          return;
        }
        answer = fallbackAnswer(text);
      }

      const assistantMessage: Message = { role: "assistant", content: answer };
      setMessages((current) => [...current, assistantMessage]);
      setThinking(false);
      void speak(answer);
    },
    [
      input,
      messages,
      playExampleMelody,
      playSong,
      recordActivity,
      speak,
      thinking,
    ],
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
    releaseAllSustainedVoices(false);
  }, [releaseAllSustainedVoices]);

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
            handleHandMusic([], performance.now());
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

  const seedVoiceboxSample = useCallback(async () => {
    setVoiceboxChecking(true);
    try {
      const res = await fetch("/api/voicebox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "seed_default",
          url: voiceboxUrl,
        }),
      });
      if (!res.ok) {
        showToast(
          "Pastikan aplikasi Voicebox aktif di port 17493 sebelum mengimpor sampel.",
        );
        return;
      }
      const data = (await res.json()) as {
        profile?: { id: string; name: string };
      };
      if (data.profile?.id) {
        setVoiceboxProfileId(data.profile.id);
      }
      await probeVoicebox(voiceboxUrl);
      showToast("Sampel suara asli REYA berhasil diimpor ke Voicebox.");
    } catch {
      showToast("Voicebox belum aktif di port 17493.");
    } finally {
      setVoiceboxChecking(false);
    }
  }, [probeVoicebox, showToast, voiceboxUrl]);

  const saveCustomVoice = useCallback(async () => {
    if (!voiceBlob || !voiceTranscript.trim()) {
      showToast("Rekam suara terlebih dahulu dan isi kalimat transkrip.");
      return;
    }
    setVoiceSaving(true);
    try {
      // 1. Register profile and sample in jamiepine/voicebox via server proxy first
      if (voiceEngine === "voicebox") {
        const baseUrl = voiceboxUrl.replace(/\/+$/, "");
        const proxyForm = new FormData();
        proxyForm.append("url", baseUrl);
        proxyForm.append("name", voiceName.trim() || "Suara REYA Custom");
        proxyForm.append("reference_text", voiceTranscript.trim());
        proxyForm.append(
          "file",
          voiceBlob,
          voiceBlob.type === "audio/wav" ? "sample.wav" : "sample.webm",
        );

        try {
          const proxyRes = await fetch("/api/voicebox", {
            method: "POST",
            body: proxyForm,
          });
          if (proxyRes.ok) {
            const created = (await proxyRes.json()) as {
              profile_id?: string;
            };
            if (created.profile_id) {
              setVoiceboxProfileId(created.profile_id);
              await probeVoicebox(baseUrl);
              setVoiceModal(false);
              showToast("Profil kloning suara berhasil disimpan ke Voicebox.");
              return;
            }
          }
        } catch {
          // Try direct browser upload if proxy could not reach local Voicebox
        }

        if (voiceboxOnline) {
          const createRes = await fetch(`${baseUrl}/profiles`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: voiceName.trim() || "Suara REYA Custom",
              language: "ms",
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
      if (voiceboxOnline) {
        const found = voiceboxProfiles.find((p) => p.id === voiceboxProfileId);
        return found
          ? `Voicebox · ${found.name}`
          : `Voicebox · ${voiceboxProfileId}`;
      }
      return "Argon Cloud · Aoede (Ceria)";
    }
    if (voiceEngine === "supertonic") return `Natural Indo · ${voiceProfile}`;
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
            <span className="status-led online" />
            <span className="mono">
              VOICE: VOICEBOX ONLINE (NEURAL ID)
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

          <div className="robot-deck" onMouseMove={recordActivity}>
            <RobotCRTUnit
              speaking={speaking}
              listening={listening}
              thinking={thinking}
              mood={mood}
              lastActivity={lastActivity}
              onPoke={handleRobotPoke}
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
                      "Halo! Aku REYA. Suaraku sekarang ceria dan natural, siap menemanimu ngobrol santai atau bermain musik!",
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
                "Mainkan lagu Balonku Ada Lima",
                "Mainkan lagu Ibu Kita Kartini",
                "Cari lagu Laskar Pelangi",
                "Bagaimana cara main musik pakai tangan?",
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
                onChange={(event) => {
                  setInput(event.target.value);
                  recordActivity();
                }}
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
                className={`hw-button ${musicPlaying ? "primary" : "active-green"
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

          {/* MAIN DECK: PEMETAAN GERAKAN TANGAN - TANGGA NADA (DO RE MI FA SOL LA SI DO') */}
          <div className="scale-deck-frame">
            <div className="scale-deck-header">
              <div className="scale-deck-deco" aria-hidden="true">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
                <span className="mono" style={{ fontSize: "11px", fontWeight: 700 }}>
                  AUDIO ENGINE
                </span>
              </div>

              <div className="scale-deck-title-wrap">
                <h3>Pemetaan Gerakan Tangan - Tangga Nada</h3>
                <div className="scale-deck-subtitle">
                  Do Re Mi Fa Sol La Si Do&apos;
                </div>
              </div>

              <div className="scale-deck-deco" aria-hidden="true">
                <IconWave />
                <span className="mono" style={{ fontSize: "11px", fontWeight: 700 }}>
                  24-BIT PCM
                </span>
              </div>
            </div>

            {/* 8 INTERACTIVE CARDS FROM THE IMAGE */}
            <div
              className="scale-cards-grid"
              role="group"
              aria-label="Tangga nada Do Re Mi Fa Sol La Si Do'"
            >
              {SCALE_NOTES.map((note) => {
                const isActive = activeScaleNoteId === note.id;
                return (
                  <button
                    key={note.id}
                    type="button"
                    className={`scale-card ${isActive ? "active" : ""}`}
                    style={
                      {
                        "--card-color": note.color,
                        "--card-border": isActive ? note.color : "var(--border-strong)",
                        "--card-glow": `${note.color}88`,
                        "--card-tint": note.badgeBg,
                        "--card-bg": `${note.color}18`,
                      } as React.CSSProperties
                    }
                    onPointerDown={(e) => {
                      e.preventDefault();
                      startScaleNoteHold(note);
                    }}
                    onPointerUp={stopScaleNoteHold}
                    onPointerLeave={stopScaleNoteHold}
                    onPointerCancel={stopScaleNoteHold}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
                        e.preventDefault();
                        startScaleNoteHold(note);
                      }
                    }}
                    onKeyUp={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        stopScaleNoteHold();
                      }
                    }}
                    aria-label={`Mainkan nada panjang ${note.name}, notasi ${note.notation}, gestur ${note.gesture}`}
                  >
                    <span className="scale-card-top-badge">{note.name}</span>
                    <div className="scale-card-gesture-visual">
                      <HandGestureSvg
                        noteId={note.id}
                        color={note.color}
                        active={isActive}
                      />
                    </div>
                    <span className="scale-card-gesture-name">{note.gesture}</span>
                    <span className="scale-card-notation-tag">{note.notation}</span>
                  </button>
                );
              })}
            </div>

            {/* 3 PANELS MATCHING THE USER'S IMAGE */}
            <div className="scale-bottom-layout">
              {/* Panel 1: Ringkasan Pemetaan */}
              <div className="scale-panel">
                <div className="scale-panel-header">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M6 8h4" />
                    <path d="M14 8h4" />
                    <path d="M6 12h1" />
                    <path d="M10 12h1" />
                    <path d="M14 12h1" />
                    <path d="M18 12h1" />
                    <path d="M6 16h12" />
                  </svg>
                  <span>Ringkasan Pemetaan</span>
                </div>

                <table className="scale-summary-table">
                  <thead>
                    <tr>
                      <th>Nada</th>
                      <th>Notasi</th>
                      <th>Gerakan Tangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SCALE_NOTES.map((note) => {
                      const isRowActive = activeScaleNoteId === note.id;
                      return (
                        <tr
                          key={note.id}
                          className={`scale-table-row ${isRowActive ? "active" : ""}`}
                          onClick={() => playScaleNote(note)}
                          title={`Klik untuk membunyikan ${note.name}`}
                        >
                          <td>
                            <span
                              className="scale-row-badge"
                              style={{ backgroundColor: note.color }}
                            >
                              {note.name}
                            </span>
                          </td>
                          <td>
                            <strong className="mono">{note.notation.split(" ")[0]}</strong>
                          </td>
                          <td style={{ color: "var(--ink-muted)", fontSize: "11px" }}>
                            {note.desc}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Panel 2: Urutan Tangga Nada & Contoh Melodi */}
              <div className="scale-panel">
                <div className="scale-panel-header">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  <span>Urutan Tangga Nada</span>
                </div>

                <div className="scale-flow-row">
                  {SCALE_NOTES.map((note, idx) => (
                    <Fragment key={note.id}>
                      <button
                        type="button"
                        className={`scale-flow-pill ${activeScaleNoteId === note.id ? "active" : ""}`}
                        style={{ backgroundColor: note.color }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          startScaleNoteHold(note);
                        }}
                        onPointerUp={stopScaleNoteHold}
                        onPointerLeave={stopScaleNoteHold}
                        onPointerCancel={stopScaleNoteHold}
                        title={`Tekan & tahan untuk nada panjang ${note.name}`}
                      >
                        {note.name}
                      </button>
                      {idx < SCALE_NOTES.length - 1 && (
                        <span className="scale-flow-arrow" aria-hidden="true">
                          &rarr;
                        </span>
                      )}
                    </Fragment>
                  ))}
                </div>

                <div className="melody-box" style={{ marginTop: "10px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontWeight: 700,
                        fontSize: "12px",
                      }}
                    >
                      <IconSpeaker />
                      <span>Contoh Melodi</span>
                    </div>
                    <span
                      className="mono"
                      style={{ fontSize: "10px", color: "var(--ink-muted)" }}
                    >
                      9 NADA
                    </span>
                  </div>

                  <div className="melody-notation-string">
                    Do &ndash; Re &ndash; Mi &ndash; Fa &ndash; Sol &ndash; Fa &ndash; Mi &ndash; Re &ndash; Do
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <button
                      type="button"
                      className={`hw-button ${playingMelody ? "primary" : ""}`}
                      style={{ width: "100%", minHeight: "44px" }}
                      onClick={playExampleMelody}
                    >
                      <IconSpeaker />
                      <span>
                        {playingMelody ? "Hentikan Melodi" : "Putar Contoh Melodi"}
                      </span>
                    </button>

                    <button
                      type="button"
                      className={`hw-button ${playingSong ? "primary active-green" : ""}`}
                      style={{ width: "100%", minHeight: "44px" }}
                      onClick={() => {
                        if (playingSong) stopSong();
                        else playKartiniSong();
                      }}
                    >
                      <IconSpeaker />
                      <span>
                        {playingSong
                          ? `Hentikan (${activeSong?.title ?? "Lagu"})`
                          : "Putar Ibu Kita Kartini"}
                      </span>
                    </button>
                  </div>

                  {/* Pencarian Lagu AI Otomatis */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (songSearchInput.trim()) {
                        void askRobot(`Mainkan lagu ${songSearchInput.trim()}`);
                        setSongSearchInput("");
                      }
                    }}
                    style={{ marginTop: "12px", display: "flex", gap: "6px" }}
                  >
                    <input
                      type="text"
                      className="field-input"
                      value={songSearchInput}
                      onChange={(e) => setSongSearchInput(e.target.value)}
                      placeholder="Minta lagu apa saja (Balonku, Pelangi, Laskar Pelangi, dsb)..."
                      style={{ flex: 1, minHeight: "38px", fontSize: "12px" }}
                    />
                    <button
                      type="submit"
                      className="hw-button primary"
                      style={{ minHeight: "38px", padding: "0 14px", whiteSpace: "nowrap" }}
                    >
                      <span>Cari &amp; Mainkan</span>
                    </button>
                  </form>

                  {/* Pilihan Koleksi Lagu Cepat */}
                  <div style={{ marginTop: "10px" }}>
                    <div
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        color: "var(--ink-muted)",
                        marginBottom: "6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>Koleksi Lagu Siap Main:</span>
                      <span className="mono" style={{ fontSize: "10px" }}>
                        {SONG_CATALOG.length} LAGU
                      </span>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(135px, 1fr))",
                        gap: "6px",
                      }}
                    >
                      {SONG_CATALOG.map((s) => {
                        const isCurrent = playingSong && activeSong?.id === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className={`hw-button ${isCurrent ? "primary active-green" : ""}`}
                            style={{
                              padding: "6px 8px",
                              fontSize: "11px",
                              minHeight: "34px",
                              justifyContent: "flex-start",
                              textAlign: "left",
                            }}
                            onClick={() => {
                              if (isCurrent) stopSong();
                              else playSong(s);
                            }}
                            title={`Putar ${s.title}`}
                          >
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {isCurrent ? "■ " : "▶ "} {s.title}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Panel 3: Keterangan */}
              <div className="scale-panel">
                <div className="scale-panel-header">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>Keterangan</span>
                </div>

                <ul className="scale-notes-list">
                  <li>
                    <span className="scale-check-icon" aria-hidden="true">
                      &#x2713;
                    </span>
                    <span>
                      <strong>Do sampai Sol</strong> = jumlah jari 1 sampai 5.
                    </span>
                  </li>
                  <li>
                    <span className="scale-check-icon" aria-hidden="true">
                      &#x2713;
                    </span>
                    <span>
                      <strong>La</strong> = Telunjuk + Jempol.
                    </span>
                  </li>
                  <li>
                    <span className="scale-check-icon" aria-hidden="true">
                      &#x2713;
                    </span>
                    <span>
                      <strong>Si</strong> = Telunjuk + Jempol + Kelingking.
                    </span>
                  </li>
                  <li>
                    <span className="scale-check-icon" aria-hidden="true">
                      &#x2713;
                    </span>
                    <span>
                      <strong>Do&apos;</strong> = Telunjuk + Kelingking.
                    </span>
                  </li>
                  <li>
                    <span className="scale-check-icon" aria-hidden="true">
                      &#x2713;
                    </span>
                    <span>
                      Gerakan dibaca kamera (hand tracking) lalu diubah menjadi nada secara real-time.
                    </span>
                  </li>
                </ul>

                <button
                  type="button"
                  className="hw-button"
                  style={{ marginTop: "auto" }}
                  onClick={() => setShowMatrixView((v) => !v)}
                >
                  <IconWave />
                  <span>
                    {showMatrixView
                      ? "Sembunyikan Matriks 2D"
                      : "Tampilkan Matriks Frekuensi 2D"}
                  </span>
                </button>
              </div>
            </div>

            {/* Optional Collapsible 2D Matrix View */}
            {showMatrixView && (
              <div className="pitch-matrix-frame" style={{ marginTop: "14px" }}>
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
                  aria-label="Matriks 2D tinggi nada dan filter"
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
                  <span>SUMBU X: FILTER STEREO &amp; TONE BRIGHTNESS</span>
                </div>
              </div>
            )}
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
                <div className="cloud-status-card">
                  <div className="cloud-status-header">
                    <span className="status-led online" />
                    <strong>VOICEBOX CLOUD NEURAL ONLINE (VERCEL NATIVE)</strong>
                  </div>
                  <p>
                    Voicebox berjalan 100% online di Vercel! REYA menggunakan mesin Voicebox Cloud Neural Bahasa Indonesia (Gadis Ceria 24kHz) tanpa suara robot Google Translate dan tanpa perlu server lokal.
                  </p>
                </div>

                <div className="voicebox-status-row">
                  <div className="telemetry-item">
                    <span
                      className={`status-led ${voiceboxOnline ? "online" : ""}`}
                    />
                    <strong className="mono">
                      VOICEBOX STUDIO ONLINE ({voiceboxProfiles.length} PROFIL AKTIF)
                    </strong>
                  </div>
                  <span className="module-id">voicebox/neural-id</span>
                </div>

                <p className="voicebox-desc">
                  Koneksi Voicebox di bawah bersifat opsional untuk kloning suara di PC lokal. Di Vercel, REYA otomatis aktif menggunakan suara Cloud Neural ceria di atas.
                </p>

                <div className="field-group">
                  <label htmlFor="vb-url-input">ENDPOINT SERVER VOICEBOX (OPSIONAL)</label>
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
                          {prof.name} ({prof.language || "ms"})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="url-input-row">
                      <input
                        id="vb-profile-select"
                        className="field-input mono"
                        value={voiceboxProfileId}
                        onChange={(event) =>
                          setVoiceboxProfileId(event.target.value)
                        }
                        placeholder="ID profil Voicebox (otomatis jika dikosongkan)"
                      />
                      <button
                        type="button"
                        className="hw-button"
                        onClick={() => void seedVoiceboxSample()}
                        disabled={voiceboxChecking}
                      >
                        <span>Impor Sampel REYA</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {(voiceEngine === "supertonic" ||
              voiceEngine === "qwen" ||
              !voiceboxOnline) && (
              <div className="field-group">
                <label htmlFor="local-profile-select">KARAKTER SUARA NEURAL</label>
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
                  {voiceEngine === "qwen" ? (
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
                  ) : (
                    <>
                      <option value="F2">
                        F2 / Aoede : REYA Ceria (Ceria, ramah, ekspresif)
                      </option>
                      <option value="F1">
                        F1 / Zephyr : REYA Natural (Hangat, santai, natural)
                      </option>
                      <option value="F3">
                        F3 / Kore : REYA Artikulatif (Jelas &amp; jernih)
                      </option>
                      <option value="F5">
                        F5 / Leda : REYA Kalem (Lembut &amp; tenang)
                      </option>
                      <option value="F4">
                        F4 / Callirrhoe : REYA Dinamis
                      </option>
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
                    "Halo! Ini adalah uji suara ceria REYA dari konsol Studio Suara.",
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
