export type ScaleNoteId =
  | "do"
  | "re"
  | "mi"
  | "fa"
  | "sol"
  | "la"
  | "si"
  | "do_prime";

export type SongNote = {
  id: ScaleNoteId;
  lyric: string;
  delay: number; // millisecond offset from song start
  freq?: number;
  dur?: number;
};

export type Song = {
  id: string;
  title: string;
  category: "Nasional" | "Anak" | "Daerah" | "Populer" | "Klasik";
  keywords: string[];
  notes: SongNote[];
};

export const SONG_CATALOG: Song[] = [
  {
    id: "kartini",
    title: "Ibu Kita Kartini",
    category: "Nasional",
    keywords: ["kartini", "ibu kita kartini", "ibu kartini"],
    notes: [
      { id: "do", lyric: "I-", delay: 0 },
      { id: "re", lyric: "bu", delay: 440 },
      { id: "mi", lyric: "ki-", delay: 880 },
      { id: "fa", lyric: "ta", delay: 1320 },
      { id: "sol", lyric: "Kar-", delay: 1760 },
      { id: "mi", lyric: "ti-", delay: 2450 },
      { id: "do", lyric: "ni", delay: 2900 },
      { id: "fa", lyric: "Pu-", delay: 3800 },
      { id: "la", lyric: "tri", delay: 4240 },
      { id: "sol", lyric: "se-", delay: 4680 },
      { id: "fa", lyric: "ja-", delay: 5120 },
      { id: "mi", lyric: "ti", delay: 5560 },
      { id: "re", lyric: "Pu-", delay: 6500 },
      { id: "fa", lyric: "tri", delay: 6940 },
      { id: "mi", lyric: "In-", delay: 7380 },
      { id: "re", lyric: "do-", delay: 7820 },
      { id: "do", lyric: "ne-", delay: 8260 },
      { id: "mi", lyric: "si-", delay: 8700 },
      { id: "sol", lyric: "a", delay: 9140 },
      { id: "fa", lyric: "Ha-", delay: 10050 },
      { id: "mi", lyric: "rum", delay: 10490 },
      { id: "re", lyric: "na-", delay: 10930 },
      { id: "do", lyric: "nya", delay: 11450 },
    ],
  },
  {
    id: "balonku",
    title: "Balonku Ada Lima",
    category: "Anak",
    keywords: ["balonku", "balonku ada lima", "balon"],
    notes: [
      { id: "mi", lyric: "Ba-", delay: 0 },
      { id: "fa", lyric: "lon-", delay: 380 },
      { id: "sol", lyric: "ku", delay: 760 },
      { id: "do_prime", lyric: "a-", delay: 1140 },
      { id: "sol", lyric: "da", delay: 1520 },
      { id: "mi", lyric: "li-", delay: 1900 },
      { id: "do", lyric: "ma", delay: 2300 },
      { id: "re", lyric: "Ru-", delay: 3000 },
      { id: "mi", lyric: "pa", delay: 3380 },
      { id: "fa", lyric: "ru-", delay: 3760 },
      { id: "re", lyric: "pa", delay: 4140 },
      { id: "sol", lyric: "war-na-nya", delay: 4560 },
      { id: "fa", lyric: "Hi-", delay: 5350 },
      { id: "sol", lyric: "jau", delay: 5730 },
      { id: "la", lyric: "ku-", delay: 6110 },
      { id: "sol", lyric: "ning", delay: 6490 },
      { id: "fa", lyric: "ke-", delay: 6870 },
      { id: "mi", lyric: "la-", delay: 7250 },
      { id: "re", lyric: "bu", delay: 7630 },
      { id: "re", lyric: "Me-", delay: 8350 },
      { id: "mi", lyric: "rah", delay: 8730 },
      { id: "fa", lyric: "mu-", delay: 9110 },
      { id: "re", lyric: "da", delay: 9490 },
      { id: "sol", lyric: "dan", delay: 9870 },
      { id: "do", lyric: "bi-ru", delay: 10250 },
    ],
  },
  {
    id: "bintang_kecil",
    title: "Bintang Kecil",
    category: "Anak",
    keywords: ["bintang kecil", "bintang di langit"],
    notes: [
      { id: "do", lyric: "Bin-", delay: 0 },
      { id: "do", lyric: "tang", delay: 400 },
      { id: "sol", lyric: "ke-", delay: 800 },
      { id: "sol", lyric: "cil", delay: 1200 },
      { id: "la", lyric: "di", delay: 1600 },
      { id: "la", lyric: "la-", delay: 2000 },
      { id: "sol", lyric: "ngit", delay: 2450 },
      { id: "fa", lyric: "yang", delay: 3200 },
      { id: "fa", lyric: "ting-", delay: 3600 },
      { id: "mi", lyric: "gi", delay: 4000 },
      { id: "mi", lyric: "A-", delay: 4400 },
      { id: "re", lyric: "mat", delay: 4800 },
      { id: "re", lyric: "ba-", delay: 5200 },
      { id: "do", lyric: "nyak", delay: 5650 },
      { id: "sol", lyric: "meng-", delay: 6400 },
      { id: "sol", lyric: "hi-", delay: 6800 },
      { id: "fa", lyric: "as", delay: 7200 },
      { id: "fa", lyric: "ang-", delay: 7600 },
      { id: "mi", lyric: "ka-", delay: 8000 },
      { id: "re", lyric: "sa", delay: 8450 },
      { id: "do", lyric: "A-", delay: 9200 },
      { id: "do", lyric: "ku", delay: 9600 },
      { id: "sol", lyric: "in-", delay: 10000 },
      { id: "sol", lyric: "gin", delay: 10400 },
      { id: "la", lyric: "ter-", delay: 10800 },
      { id: "la", lyric: "bang", delay: 11200 },
      { id: "sol", lyric: "dan", delay: 11600 },
      { id: "fa", lyric: "me-", delay: 12200 },
      { id: "mi", lyric: "la-", delay: 12600 },
      { id: "re", lyric: "yang", delay: 13000 },
      { id: "do", lyric: "♪", delay: 13500 },
    ],
  },
  {
    id: "pelangi",
    title: "Pelangi-Pelangi",
    category: "Anak",
    keywords: ["pelangi", "pelangi pelangi", "pelangi-pelangi"],
    notes: [
      { id: "do", lyric: "Pe-", delay: 0 },
      { id: "mi", lyric: "la-", delay: 400 },
      { id: "sol", lyric: "ngi", delay: 800 },
      { id: "sol", lyric: "pe-", delay: 1200 },
      { id: "mi", lyric: "la-", delay: 1600 },
      { id: "do", lyric: "ngi", delay: 2000 },
      { id: "re", lyric: "A-", delay: 2700 },
      { id: "mi", lyric: "lang-", delay: 3100 },
      { id: "fa", lyric: "kah", delay: 3500 },
      { id: "fa", lyric: "in-", delay: 3900 },
      { id: "mi", lyric: "dah-", delay: 4300 },
      { id: "re", lyric: "mu", delay: 4700 },
      { id: "mi", lyric: "Me-", delay: 5400 },
      { id: "fa", lyric: "rah", delay: 5800 },
      { id: "sol", lyric: "ku-", delay: 6200 },
      { id: "la", lyric: "ning", delay: 6600 },
      { id: "sol", lyric: "hi-", delay: 7000 },
      { id: "fa", lyric: "jau", delay: 7400 },
      { id: "mi", lyric: "Di", delay: 8100 },
      { id: "fa", lyric: "la-", delay: 8500 },
      { id: "sol", lyric: "ngit", delay: 8900 },
      { id: "mi", lyric: "yang", delay: 9300 },
      { id: "re", lyric: "bi-", delay: 9700 },
      { id: "do", lyric: "ru", delay: 10100 },
    ],
  },
  {
    id: "gundul_pacul",
    title: "Gundul-Gundul Pacul",
    category: "Daerah",
    keywords: ["gundul", "gundul pacul", "gundul-gundul pacul"],
    notes: [
      { id: "do", lyric: "Gun-", delay: 0 },
      { id: "mi", lyric: "dul", delay: 400 },
      { id: "do", lyric: "gun-", delay: 800 },
      { id: "mi", lyric: "dul", delay: 1200 },
      { id: "fa", lyric: "pa-", delay: 1600 },
      { id: "sol", lyric: "cul", delay: 2000 },
      { id: "sol", lyric: "cul", delay: 2450 },
      { id: "do", lyric: "ge-", delay: 3200 },
      { id: "mi", lyric: "lem-", delay: 3600 },
      { id: "do", lyric: "be-", delay: 4000 },
      { id: "mi", lyric: "ngan", delay: 4400 },
      { id: "fa", lyric: "pa-", delay: 4800 },
      { id: "sol", lyric: "cul", delay: 5200 },
      { id: "sol", lyric: "cul", delay: 5650 },
      { id: "do", lyric: "Wa-", delay: 6400 },
      { id: "mi", lyric: "kul", delay: 6800 },
      { id: "sol", lyric: "ngglim-", delay: 7200 },
      { id: "fa", lyric: "pang", delay: 7600 },
      { id: "fa", lyric: "se-", delay: 8000 },
      { id: "sol", lyric: "ga-", delay: 8400 },
      { id: "fa", lyric: "ne", delay: 8800 },
      { id: "mi", lyric: "da-di", delay: 9200 },
      { id: "re", lyric: "sak", delay: 9600 },
      { id: "do", lyric: "ra-tan", delay: 10050 },
    ],
  },
  {
    id: "kakaktua",
    title: "Burung Kakaktua",
    category: "Daerah",
    keywords: ["kakaktua", "burung kakaktua", "burung kakatua"],
    notes: [
      { id: "mi", lyric: "Bu-", delay: 0 },
      { id: "mi", lyric: "rung", delay: 420 },
      { id: "do_prime", lyric: "ka-", delay: 840 },
      { id: "la", lyric: "kak-", delay: 1260 },
      { id: "sol", lyric: "tu-", delay: 1680 },
      { id: "fa", lyric: "a", delay: 2100 },
      { id: "sol", lyric: "♪", delay: 2550 },
      { id: "mi", lyric: "Hing-", delay: 3250 },
      { id: "fa", lyric: "gap", delay: 3670 },
      { id: "sol", lyric: "di", delay: 4090 },
      { id: "fa", lyric: "jen-", delay: 4510 },
      { id: "mi", lyric: "de-", delay: 4930 },
      { id: "re", lyric: "la", delay: 5350 },
      { id: "mi", lyric: "Ne-", delay: 6050 },
      { id: "mi", lyric: "nek", delay: 6470 },
      { id: "do_prime", lyric: "su-", delay: 6890 },
      { id: "la", lyric: "dah", delay: 7310 },
      { id: "sol", lyric: "tu-", delay: 7730 },
      { id: "fa", lyric: "a", delay: 8150 },
      { id: "sol", lyric: "♪", delay: 8570 },
      { id: "mi", lyric: "Gi-", delay: 9270 },
      { id: "fa", lyric: "gi-", delay: 9690 },
      { id: "sol", lyric: "nya", delay: 10110 },
      { id: "fa", lyric: "ting-", delay: 10530 },
      { id: "mi", lyric: "gal", delay: 10950 },
      { id: "re", lyric: "du-", delay: 11370 },
      { id: "do", lyric: "a", delay: 11800 },
    ],
  },
  {
    id: "twinkle",
    title: "Twinkle Twinkle Little Star",
    category: "Populer",
    keywords: ["twinkle", "twinkle twinkle", "twinkle little star", "bintang kejora"],
    notes: [
      { id: "do", lyric: "Twin-", delay: 0 },
      { id: "do", lyric: "kle", delay: 400 },
      { id: "sol", lyric: "twin-", delay: 800 },
      { id: "sol", lyric: "kle", delay: 1200 },
      { id: "la", lyric: "lit-", delay: 1600 },
      { id: "la", lyric: "tle", delay: 2000 },
      { id: "sol", lyric: "star", delay: 2450 },
      { id: "fa", lyric: "How", delay: 3200 },
      { id: "fa", lyric: "I", delay: 3600 },
      { id: "mi", lyric: "won-", delay: 4000 },
      { id: "mi", lyric: "der", delay: 4400 },
      { id: "re", lyric: "what", delay: 4800 },
      { id: "re", lyric: "you", delay: 5200 },
      { id: "do", lyric: "are", delay: 5650 },
      { id: "sol", lyric: "Up", delay: 6400 },
      { id: "sol", lyric: "a-", delay: 6800 },
      { id: "fa", lyric: "bove", delay: 7200 },
      { id: "fa", lyric: "the", delay: 7600 },
      { id: "mi", lyric: "world", delay: 8000 },
      { id: "mi", lyric: "so", delay: 8400 },
      { id: "re", lyric: "high", delay: 8850 },
      { id: "do", lyric: "Twin-", delay: 9600 },
      { id: "do", lyric: "kle", delay: 10000 },
      { id: "sol", lyric: "twin-", delay: 10400 },
      { id: "sol", lyric: "kle", delay: 10800 },
      { id: "la", lyric: "lit-", delay: 11200 },
      { id: "la", lyric: "tle", delay: 11600 },
      { id: "sol", lyric: "star", delay: 12050 },
      { id: "fa", lyric: "How", delay: 12800 },
      { id: "mi", lyric: "I", delay: 13200 },
      { id: "re", lyric: "won-", delay: 13600 },
      { id: "do", lyric: "der", delay: 14050 },
    ],
  },
  {
    id: "birthday",
    title: "Selamat Ulang Tahun",
    category: "Populer",
    keywords: ["ulang tahun", "happy birthday", "selamat ulang tahun"],
    notes: [
      { id: "do", lyric: "Hap-", delay: 0 },
      { id: "do", lyric: "py", delay: 350 },
      { id: "re", lyric: "birth-", delay: 700 },
      { id: "do", lyric: "day", delay: 1080 },
      { id: "fa", lyric: "to", delay: 1500 },
      { id: "mi", lyric: "you", delay: 1950 },
      { id: "do", lyric: "Hap-", delay: 2700 },
      { id: "do", lyric: "py", delay: 3050 },
      { id: "re", lyric: "birth-", delay: 3400 },
      { id: "do", lyric: "day", delay: 3780 },
      { id: "sol", lyric: "to", delay: 4200 },
      { id: "fa", lyric: "you", delay: 4650 },
      { id: "do", lyric: "Hap-", delay: 5400 },
      { id: "do", lyric: "py", delay: 5750 },
      { id: "do_prime", lyric: "birth-", delay: 6100 },
      { id: "la", lyric: "day", delay: 6500 },
      { id: "fa", lyric: "un-", delay: 6900 },
      { id: "mi", lyric: "tuk", delay: 7300 },
      { id: "re", lyric: "mu", delay: 7750 },
      { id: "si", lyric: "Hap-", delay: 8550 },
      { id: "si", lyric: "py", delay: 8900 },
      { id: "la", lyric: "birth-", delay: 9250 },
      { id: "fa", lyric: "day", delay: 9650 },
      { id: "sol", lyric: "to", delay: 10100 },
      { id: "fa", lyric: "you", delay: 10600 },
    ],
  },
  {
    id: "indonesia_raya",
    title: "Indonesia Raya",
    category: "Nasional",
    keywords: ["indonesia raya", "lagu kebangsaan", "tanah airku"],
    notes: [
      { id: "sol", lyric: "In-", delay: 0 },
      { id: "do_prime", lyric: "do-", delay: 420 },
      { id: "do_prime", lyric: "ne-", delay: 840 },
      { id: "si", lyric: "sia", delay: 1260 },
      { id: "do_prime", lyric: "ta-", delay: 1680 },
      { id: "re", lyric: "nah", delay: 2100 },
      { id: "do_prime", lyric: "a-", delay: 2520 },
      { id: "la", lyric: "ir-", delay: 2940 },
      { id: "sol", lyric: "ku", delay: 3400 },
      { id: "fa", lyric: "Ta-", delay: 4100 },
      { id: "mi", lyric: "nah", delay: 4520 },
      { id: "fa", lyric: "tum-", delay: 4940 },
      { id: "sol", lyric: "pah", delay: 5360 },
      { id: "la", lyric: "da-", delay: 5780 },
      { id: "sol", lyric: "rah-", delay: 6200 },
      { id: "mi", lyric: "ku", delay: 6650 },
    ],
  },
  {
    id: "ode_to_joy",
    title: "Ode to Joy (Simfoni)",
    category: "Klasik",
    keywords: ["ode to joy", "beethoven", "simfoni"],
    notes: [
      { id: "mi", lyric: "Mi", delay: 0 },
      { id: "mi", lyric: "Mi", delay: 380 },
      { id: "fa", lyric: "Fa", delay: 760 },
      { id: "sol", lyric: "Sol", delay: 1140 },
      { id: "sol", lyric: "Sol", delay: 1520 },
      { id: "fa", lyric: "Fa", delay: 1900 },
      { id: "mi", lyric: "Mi", delay: 2280 },
      { id: "re", lyric: "Re", delay: 2660 },
      { id: "do", lyric: "Do", delay: 3040 },
      { id: "do", lyric: "Do", delay: 3420 },
      { id: "re", lyric: "Re", delay: 3800 },
      { id: "mi", lyric: "Mi", delay: 4180 },
      { id: "mi", lyric: "Mi", delay: 4560 },
      { id: "re", lyric: "Re", delay: 5040 },
      { id: "re", lyric: "Re", delay: 5520 },
    ],
  },
];

export function findSong(query: string): Song | undefined {
  const norm = query.toLowerCase().trim();
  return SONG_CATALOG.find((song) => {
    if (song.keywords.some((kw) => norm.includes(kw))) return true;
    if (norm.includes(song.title.toLowerCase())) return true;
    return false;
  });
}

// Generate harmonious AI melody transcription for any song title when not in catalog
export function generateMelodyForSong(title: string): Song {
  const cleanTitle = title.replace(/(mainkan|putar|lagu|musik|dong|coba|tolong)/gi, "").trim();
  const displayTitle = cleanTitle ? cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1) : "Melodi Ceria";
  
  // Melodic motifs that sound pleasing and musical across REYA's acoustic instruments
  const motifTemplates: ScaleNoteId[][] = [
    ["do", "mi", "sol", "do_prime", "la", "sol", "fa", "mi", "re", "do"],
    ["mi", "sol", "la", "sol", "do_prime", "si", "la", "sol", "mi", "re", "do"],
    ["do", "re", "mi", "fa", "sol", "la", "sol", "mi", "fa", "re", "do"],
  ];
  
  // Deterministic motif pick based on title hash
  let hash = 0;
  for (let i = 0; i < cleanTitle.length; i++) hash = (hash * 31 + cleanTitle.charCodeAt(i)) & 0xff;
  const pickedNotes = motifTemplates[hash % motifTemplates.length];
  
  const notes: SongNote[] = pickedNotes.map((noteId, idx) => ({
    id: noteId,
    lyric: `♪`,
    delay: idx * 420,
  }));

  return {
    id: `ai_${Date.now()}`,
    title: displayTitle,
    category: "Populer",
    keywords: [cleanTitle.toLowerCase()],
    notes,
  };
}

