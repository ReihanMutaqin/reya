"use client";

type OrtTensor = {
  data: Float32Array | BigInt64Array;
  dims: number[];
};

type OrtSession = {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
};

type OrtModule = {
  env: {
    wasm: {
      wasmPaths: string;
      numThreads: number;
    };
  };
  InferenceSession: {
    create(
      bufferOrUrl: ArrayBuffer | Uint8Array | string,
      options?: Record<string, unknown>,
    ): Promise<OrtSession>;
  };
  Tensor: new (
    type: string,
    data: Float32Array | BigInt64Array,
    dims: number[],
  ) => OrtTensor;
};

type SupertonicConfig = {
  ae: {
    sample_rate: number;
    base_chunk_size: number;
  };
  ttl: {
    chunk_compress_factor: number;
    latent_dim: number;
  };
};

type StyleEmbeddingJson = {
  style_ttl: {
    type?: string;
    data: unknown[];
    dims: number[];
  };
  style_dp: {
    type?: string;
    data: unknown[];
    dims: number[];
  };
};

const HF_ONNX_BASE =
  "https://huggingface.co/Supertone/supertonic-3/resolve/main/onnx";
const ORT_CDN_URL =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/ort.min.mjs";
const ORT_WASM_DIR =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/";
const CACHE_NAME = "reya-supertonic3-onnx-v1";

let ortPromise: Promise<OrtModule> | null = null;
let enginePromise: Promise<{
  ort: OrtModule;
  dpOrt: OrtSession;
  textEncOrt: OrtSession;
  vectorEstOrt: OrtSession;
  vocoderOrt: OrtSession;
  cfgs: SupertonicConfig;
  indexer: number[];
}> | null = null;
let engineReady = false;

const styleCache = new Map<
  string,
  { styleTtl: OrtTensor; styleDp: OrtTensor }
>();

function loadOrtModule(): Promise<OrtModule> {
  if (!ortPromise) {
    ortPromise = (
      new Function("url", "return import(url)")(ORT_CDN_URL) as Promise<OrtModule>
    ).then((ort) => {
      ort.env.wasm.wasmPaths = ORT_WASM_DIR;
      ort.env.wasm.numThreads = 1;
      return ort;
    });
  }
  return ortPromise;
}

async function fetchCachedBytes(url: string): Promise<ArrayBuffer> {
  if (typeof window !== "undefined" && "caches" in window) {
    try {
      const cache = await window.caches.open(CACHE_NAME);
      const cached = await cache.match(url);
      if (cached && cached.ok) {
        return await cached.arrayBuffer();
      }
      const res = await fetch(url, { mode: "cors" });
      if (res.ok) {
        void cache.put(url, res.clone());
        return await res.arrayBuffer();
      }
    } catch {
      // Fall through to direct fetch
    }
  }
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) {
    throw new Error(`Gagal memuat model ONNX: ${url}`);
  }
  return await res.arrayBuffer();
}

export function isSupertonicWebReady(): boolean {
  return engineReady;
}

export function preloadSupertonicWeb(): Promise<unknown> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!enginePromise) {
    enginePromise = (async () => {
      const ort = await loadOrtModule();
      const [cfgsRes, idxRes, dpBuf, textEncBuf, vectorEstBuf, vocoderBuf] =
        await Promise.all([
          fetch("/supertonic/tts.json"),
          fetch("/supertonic/unicode_indexer.json"),
          fetchCachedBytes(`${HF_ONNX_BASE}/duration_predictor.onnx`),
          fetchCachedBytes(`${HF_ONNX_BASE}/text_encoder.onnx`),
          fetchCachedBytes(`${HF_ONNX_BASE}/vector_estimator.onnx`),
          fetchCachedBytes(`${HF_ONNX_BASE}/vocoder.onnx`),
        ]);

      const cfgs = (await cfgsRes.json()) as SupertonicConfig;
      const indexer = (await idxRes.json()) as number[];

      const opts = { executionProviders: ["wasm"] };
      const [dpOrt, textEncOrt, vectorEstOrt, vocoderOrt] = await Promise.all([
        ort.InferenceSession.create(dpBuf, opts),
        ort.InferenceSession.create(textEncBuf, opts),
        ort.InferenceSession.create(vectorEstBuf, opts),
        ort.InferenceSession.create(vocoderBuf, opts),
      ]);

      engineReady = true;
      return {
        ort,
        dpOrt,
        textEncOrt,
        vectorEstOrt,
        vocoderOrt,
        cfgs,
        indexer,
      };
    })().catch((err) => {
      enginePromise = null;
      engineReady = false;
      throw err;
    });
  }
  return enginePromise;
}

function mapSpeakerCode(speakerOrProfile?: string): string {
  const norm = (speakerOrProfile || "").toLowerCase().trim();
  if (norm === "f1" || norm.includes("natural") || norm.includes("zephyr")) {
    return "F1";
  }
  if (norm === "f3" || norm.includes("artikulatif") || norm.includes("kore")) {
    return "F3";
  }
  if (norm === "f4" || norm.includes("dinamis")) {
    return "F4";
  }
  if (norm === "f5" || norm.includes("kalem") || norm.includes("leda")) {
    return "F5";
  }
  return "F2";
}

function flattenNumbers(input: unknown[]): number[] {
  const out: number[] = [];
  const stack: unknown[] = [...input];
  while (stack.length > 0) {
    const item = stack.shift();
    if (Array.isArray(item)) {
      stack.unshift(...item);
    } else if (typeof item === "number") {
      out.push(item);
    }
  }
  return out;
}

async function getStyleTensors(
  ort: OrtModule,
  voiceCode: string,
): Promise<{ styleTtl: OrtTensor; styleDp: OrtTensor }> {
  const cached = styleCache.get(voiceCode);
  if (cached) return cached;

  const res = await fetch(`/supertonic/voice_styles/${voiceCode}.json`);
  if (!res.ok) {
    throw new Error(`Gagal memuat gaya suara ${voiceCode}`);
  }
  const data = (await res.json()) as StyleEmbeddingJson;
  const ttlFlat = flattenNumbers(data.style_ttl.data);
  const dpFlat = flattenNumbers(data.style_dp.data);

  const styleTtl = new ort.Tensor(
    data.style_ttl.type || "float32",
    Float32Array.from(ttlFlat),
    data.style_ttl.dims,
  );
  const styleDp = new ort.Tensor(
    data.style_dp.type || "float32",
    Float32Array.from(dpFlat),
    data.style_dp.dims,
  );

  const pair = { styleTtl, styleDp };
  styleCache.set(voiceCode, pair);
  return pair;
}

function preprocessIndonesianText(raw: string): string {
  let text = raw.normalize("NFKD");
  text = text.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}♪♫*_#`~[\]]+/gu,
    " ",
  );
  text = text
    .replace(/\bREYA\b/g, "Reya")
    .replace(/\bcute\b/gi, "kyut")
    .replace(/\bvoicebox\b/gi, "voisboks")
    .replace(/\bcloud\b/gi, "klaud")
    .replace(/\bonline\b/gi, "onlain")
    .replace(/[–‑—_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";
  if (!/[.!?;:,'")\]}…]$/.test(text)) {
    text += ".";
  }
  return `<id>${text}</id>`;
}

function writeWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.floor(clamped * 32767), true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export async function synthesizeSupertonicWeb(
  rawText: string,
  speakerOrProfile?: string,
  totalSteps = 5,
  speed = 1.06,
): Promise<Blob | null> {
  if (!engineReady) return null;
  try {
    const engine = (await preloadSupertonicWeb()) as Awaited<
      ReturnType<typeof preloadSupertonicWeb>
    > & {
      ort: OrtModule;
      dpOrt: OrtSession;
      textEncOrt: OrtSession;
      vectorEstOrt: OrtSession;
      vocoderOrt: OrtSession;
      cfgs: SupertonicConfig;
      indexer: number[];
    };
    if (!engine) return null;

    const processed = preprocessIndonesianText(rawText.slice(0, 260));
    if (!processed) return null;

    const { ort, dpOrt, textEncOrt, vectorEstOrt, vocoderOrt, cfgs, indexer } =
      engine;
    const voiceCode = mapSpeakerCode(speakerOrProfile);
    const { styleTtl, styleDp } = await getStyleTensors(ort, voiceCode);

    const unicodeVals = Array.from(processed).map((ch) => ch.charCodeAt(0));
    const len = unicodeVals.length;
    const textIds = new BigInt64Array(len);
    const textMask = new Float32Array(len);

    for (let i = 0; i < len; i++) {
      const idx = indexer[unicodeVals[i]];
      textIds[i] = BigInt(idx !== undefined && idx !== null && idx >= 0 ? idx : 0);
      textMask[i] = 1.0;
    }

    const textIdsTensor = new ort.Tensor("int64", textIds, [1, len]);
    const textMaskTensor = new ort.Tensor("float32", textMask, [1, 1, len]);

    const dpResult = await dpOrt.run({
      text_ids: textIdsTensor,
      style_dp: styleDp,
      text_mask: textMaskTensor,
    });

    const rawDur = Number(dpResult.duration.data[0] || 1.2);
    const durationSec = Math.max(0.4, rawDur / speed);

    const textEncResult = await textEncOrt.run({
      text_ids: textIdsTensor,
      style_ttl: styleTtl,
      text_mask: textMaskTensor,
    });

    const sampleRate = cfgs.ae.sample_rate;
    const chunkSize = cfgs.ae.base_chunk_size * cfgs.ttl.chunk_compress_factor;
    const wavLen = Math.floor(durationSec * sampleRate);
    const latentLen = Math.max(1, Math.floor((wavLen + chunkSize - 1) / chunkSize));
    const latentDim = cfgs.ttl.latent_dim * cfgs.ttl.chunk_compress_factor;

    const latentBuffer = new Float32Array(latentDim * latentLen);
    for (let i = 0; i < latentBuffer.length; i++) {
      const u1 = Math.max(1e-7, Math.random());
      const u2 = Math.random();
      latentBuffer[i] =
        Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    }

    const latentMask = new Float32Array(latentLen).fill(1.0);
    const latentMaskTensor = new ort.Tensor("float32", latentMask, [
      1,
      1,
      latentLen,
    ]);
    const totalStepTensor = new ort.Tensor(
      "float32",
      Float32Array.from([totalSteps]),
      [1],
    );

    for (let step = 0; step < totalSteps; step++) {
      const currentStepTensor = new ort.Tensor(
        "float32",
        Float32Array.from([step]),
        [1],
      );
      const noisyTensor = new ort.Tensor("float32", latentBuffer, [
        1,
        latentDim,
        latentLen,
      ]);
      const est = await vectorEstOrt.run({
        noisy_latent: noisyTensor,
        text_emb: textEncResult.text_emb,
        style_ttl: styleTtl,
        text_mask: textMaskTensor,
        latent_mask: latentMaskTensor,
        total_step: totalStepTensor,
        current_step: currentStepTensor,
      });
      latentBuffer.set(est.denoised_latent.data as Float32Array);
    }

    const vocoderResult = await vocoderOrt.run({
      latent: new ort.Tensor("float32", latentBuffer, [
        1,
        latentDim,
        latentLen,
      ]),
    });

    const wavData = vocoderResult.wav_tts.data as Float32Array;
    const trimmed = wavData.slice(0, Math.min(wavData.length, wavLen));
    return writeWavBlob(trimmed, sampleRate);
  } catch {
    return null;
  }
}

