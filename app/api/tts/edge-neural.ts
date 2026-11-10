import crypto from "node:crypto";
import tls from "node:tls";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = "143";
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const WIN_EPOCH = 11644473600;

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const SHA256_STATE = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a,
  0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2,
];

const SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba,
  0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6,
  0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33,
  0xd258b060, 0x72766564,
];

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const SHA256_ADJUSTMENT = 0xc9dc06a7;
const SHA256_BLOCK_CONSTANTS = [
  ...SHA256_ROUND_CONSTANTS.slice(0, 14),
  SHA256_ADJUSTMENT,
  ...SHA256_ROUND_CONSTANTS.slice(15),
];
const SHA256_SIGMA0_ADJUSTMENT = 0x059c0b80;
const SHA256_SIGMA1_ADJUSTMENT = 0x000b92c0;

const CS64_COEFFICIENTS: [number, number][] = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

function u32(v: number): number {
  return v >>> 0;
}

function imul32(a: number, b: number): number {
  return Math.imul(a, b) >>> 0;
}

function rol16(v: number): number {
  const x = v >>> 0;
  return ((x << 16) | (x >>> 16)) >>> 0;
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function sigma0(v: number): number {
  const x = v >>> 0;
  return (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
}

function sigma1(v: number): number {
  const x = v >>> 0;
  return (rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)) >>> 0;
}

function sha256Rounds(state: number[], words: number[], firstRound = 0): number[] {
  let [a, b, c, d, e, f, g, h] = state.map(u32);
  const constants = firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  for (let i = firstRound; i < 64; i++) {
    const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + s1 + ch + constants[i] + words[i]) >>> 0;
    const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (s0 + maj) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  return [a, b, c, d, e, f, g, h];
}

function expandSha256Schedule(words: number[], firstWord = 16): void {
  for (let i = firstWord; i < 64; i++) {
    const s1 = sigma1(words[i - 2]);
    const s0 = sigma0(words[i - 15]);
    words.push((s1 + words[i - 7] + s0 + words[i - 16]) >>> 0);
  }
}

function sha256Init(data7: Buffer): number[] {
  const words: number[] = new Array(14).fill(0);
  words.push(((data7[0] << 16) | (data7[1] << 8) | data7[2]) >>> 0);
  words.push(data7.readUInt32BE(3));

  for (let index = 16; index < 30; index++) {
    let value = SHA256_SCHEDULE[index - 16];
    if (index - 2 >= 14) {
      value =
        (value +
          (index === 16
            ? (sigma1(words[index - 2]) ^ SHA256_SIGMA1_ADJUSTMENT) >>> 0
            : sigma1(words[index - 2]))) >>>
        0;
    }
    if (index - 7 >= 14) {
      value = (value + words[index - 7]) >>> 0;
    }
    if (index - 15 >= 14) {
      value =
        (value +
          (index === 29
            ? (sigma0(words[index - 15]) ^ SHA256_SIGMA0_ADJUSTMENT) >>> 0
            : sigma0(words[index - 15]))) >>>
        0;
    }
    words.push(value >>> 0);
  }

  words.push(
    (sigma1(words[28]) +
      words[23] +
      sigma0(words[15]) +
      words[14] +
      SHA256_ADJUSTMENT -
      SHA256_ROUND_CONSTANTS[14]) >>>
      0,
  );
  expandSha256Schedule(words, 31);
  const working = sha256Rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((x, idx) => (x + working[idx]) >>> 0);
}

function sha256Digest(data: Buffer): Buffer {
  const length = 57 + data.length;
  const tail = data.subarray(7);
  const padZeroCount = (((55 - length) % 64) + 64) % 64;
  const padded = Buffer.alloc(tail.length + 1 + padZeroCount + 8);
  tail.copy(padded, 0);
  padded[tail.length] = 0x80;
  padded.writeBigUInt64BE(BigInt(length * 8), padded.length - 8);

  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words: number[] = [];
    for (let i = 0; i < 16; i++) {
      words.push(padded.readUInt32BE(offset + i * 4));
    }
    expandSha256Schedule(words, 16);
    const working = sha256Rounds(state, words, 0);
    state = state.map((x, idx) => (x + working[idx]) >>> 0);
  }

  const out = Buffer.alloc(32);
  state.forEach((w, idx) => out.writeUInt32BE(w >>> 0, idx * 4));
  return out;
}

function wordsLe4Even(data: Buffer): number[] {
  const rem = (4 - (data.length % 4)) % 4;
  const padded = rem > 0 ? Buffer.concat([data, Buffer.alloc(rem)]) : data;
  const words: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    words.push(padded.readUInt32LE(i));
  }
  if (words.length % 2 === 1) {
    words.push(0);
  }
  return words;
}

function cs64Digest(data: Buffer, digest: Buffer): [number, number] {
  const keyA = (digest.readUInt32LE(0) | 1) >>> 0;
  const keyB = (digest.readUInt32LE(4) | 1) >>> 0;
  const factors: [number, number] = [
    imul32(keyA, CS64_FACTOR),
    imul32(keyB, CS64_FACTOR),
  ];

  const terms: number[] = CS64_COEFFICIENTS.map(([coeff], idx) =>
    imul32(coeff, factors[idx % 2]),
  );
  const offsets: number[] = CS64_COEFFICIENTS.map(([, off]) => off >>> 0);

  const words = wordsLe4Even(Buffer.concat([Buffer.from([0]), data]));
  words.forEach((word, index) => {
    let term = imul32(word, index % 2 === 0 ? keyA : keyB);
    let offset = imul32(
      rol16(word),
      index % 2 === 0 ? 0xef0569fb : 0xc31713db,
    );
    if (index === 0) {
      term = (term + imul32(CS64_ADJUSTMENT0, factors[0])) >>> 0;
      offset = (offset + CS64_ADJUSTMENT1) >>> 0;
    }
    terms.push(term);
    offsets.push(offset);
  });

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;

  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index];
    const y = terms[index + 1];

    let t = rol16((offsets[index] + x) >>> 0);
    let q = imul32(t, 0x76f50f34);
    swapAcc = (swapAcc + ((imul32(rol16(q), 0xc3efea97) + q) >>> 0)) >>> 0;

    t = rol16((offsets[index + 1] + y) >>> 0);
    q = imul32(t, 0x1881ce3c);
    swapLast = (imul32(rol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;

    state = (imul32(state, keyA) + x) >>> 0;
    state = imul32(rol16(state), 0xcf98b111);
    state = imul32(rol16(state), 0x87085b9f);
    state = imul32(rol16(state), 0x12ceb96d);
    state = imul32(rol16(state), 0x257e1d83);
    acc = (acc + state) >>> 0;

    t = (imul32(state, keyB) + y) >>> 0;
    t = imul32(rol16(t), 0xa27416f5);
    t = imul32(rol16(t), 0xd38396ff);
    state = imul32(rol16(imul32(rol16(t), 0x7c932b89)), 0xbfa49f69);
    acc = (acc + state) >>> 0;
  }

  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

export function generateSecMsGecV2(unixTimestamp?: number): string {
  let ticks =
    unixTimestamp !== undefined ? unixTimestamp : Math.floor(Date.now() / 1000);
  ticks += WIN_EPOCH;
  ticks -= ticks % 300;
  const ticks100ns = Math.round(ticks * 1e7);
  const strToHash = Buffer.from(`${ticks100ns}${TRUSTED_CLIENT_TOKEN}`, "ascii");
  const digest = sha256Digest(strToHash);
  const [cs0, cs1] = cs64Digest(strToHash, digest);
  const csBuf = Buffer.alloc(8);
  csBuf.writeUInt32LE(cs0, 0);
  csBuf.writeUInt32LE(cs1, 4);
  return `${csBuf.toString("hex").toUpperCase()}-${digest.toString("hex").toUpperCase()}`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function maskClientFrame(payload: Buffer, opcode = 0x01): Buffer {
  const mask = crypto.randomBytes(4);
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | len;
    mask.copy(header, 2);
  } else if (len < 65536) {
    header = Buffer.alloc(8);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
    mask.copy(header, 4);
  } else {
    header = Buffer.alloc(14);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
    mask.copy(header, 10);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    masked[i] = payload[i] ^ mask[i & 3];
  }
  return Buffer.concat([header, masked]);
}

export async function synthesizeEdgeNeuralTTS(
  text: string,
  voice = "id-ID-GadisNeural",
  rate = "+6%",
  pitch = "+4Hz",
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const cleanText = text
    .replace(/[*_#`~[\]♪♫]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
  if (!cleanText) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (res: { buffer: ArrayBuffer; contentType: string } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      try {
        socket.destroy();
      } catch {
        // Ignore
      }
      resolve(res);
    };

    const timeoutId = setTimeout(() => finish(null), 6500);

    const connId = crypto.randomUUID().replace(/-/g, "");
    const muid = crypto.randomBytes(16).toString("hex").toUpperCase();
    const secMsGec = generateSecMsGecV2();
    const wsKey = crypto.randomBytes(16).toString("base64");
    const path = `/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${connId}`;

    const socket = tls.connect(
      {
        host: "speech.platform.bing.com",
        port: 443,
        servername: "speech.platform.bing.com",
      },
      () => {
        const reqLines = [
          `GET ${path} HTTP/1.1`,
          `Host: speech.platform.bing.com`,
          `Connection: Upgrade`,
          `Upgrade: websocket`,
          `Sec-WebSocket-Version: 13`,
          `Sec-WebSocket-Key: ${wsKey}`,
          `Pragma: no-cache`,
          `Cache-Control: no-cache`,
          `Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold`,
          `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
          `Accept-Encoding: gzip, deflate, br, zstd`,
          `Accept-Language: en-US,en;q=0.9`,
          `Cookie: muid=${muid};`,
          `\r\n`,
        ];
        socket.write(reqLines.join("\r\n"));
      },
    );

    let handshakeDone = false;
    let rxBuffer: Buffer = Buffer.alloc(0);
    const audioChunks: Buffer[] = [];

    const sendSpeechFrames = () => {
      const ts = new Date().toUTCString();
      const configMsg =
        `X-Timestamp:${ts}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: "false",
                  wordBoundaryEnabled: "false",
                },
                outputFormat: "audio-24khz-48kbitrate-mono-mp3",
              },
            },
          },
        });
      socket.write(maskClientFrame(Buffer.from(configMsg, "utf8"), 0x01));

      const reqId = crypto.randomUUID().replace(/-/g, "");
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='id-ID'>` +
        `<voice name='${voice}'>` +
        `<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>` +
        `${escapeXml(cleanText)}` +
        `</prosody></voice></speak>`;
      const ssmlMsg =
        `X-RequestId:${reqId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${ts}Z\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;
      socket.write(maskClientFrame(Buffer.from(ssmlMsg, "utf8"), 0x01));
    };

    socket.on("data", (chunk: Buffer) => {
      rxBuffer = Buffer.concat([rxBuffer, chunk]);

      if (!handshakeDone) {
        const headerEnd = rxBuffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const headerStr = rxBuffer.subarray(0, headerEnd).toString("utf8");
        if (!headerStr.startsWith("HTTP/1.1 101")) {
          finish(null);
          return;
        }
        handshakeDone = true;
        rxBuffer = rxBuffer.subarray(headerEnd + 4);
        sendSpeechFrames();
      }

      // Parse WebSocket frames
      while (rxBuffer.length >= 2) {
        const b0 = rxBuffer[0];
        const b1 = rxBuffer[1];
        const opcode = b0 & 0x0f;
        const isMasked = (b1 & 0x80) !== 0;
        let payloadLen = b1 & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (rxBuffer.length < 4) return;
          payloadLen = rxBuffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (rxBuffer.length < 10) return;
          payloadLen = Number(rxBuffer.readBigUInt64BE(2));
          offset = 10;
        }

        const maskLen = isMasked ? 4 : 0;
        if (rxBuffer.length < offset + maskLen + payloadLen) return;

        let payload = rxBuffer.subarray(
          offset + maskLen,
          offset + maskLen + payloadLen,
        );
        if (isMasked) {
          const mask = rxBuffer.subarray(offset, offset + 4);
          const unmasked = Buffer.alloc(payloadLen);
          for (let i = 0; i < payloadLen; i++) {
            unmasked[i] = payload[i] ^ mask[i & 3];
          }
          payload = unmasked;
        }

        rxBuffer = rxBuffer.subarray(offset + maskLen + payloadLen);

        if (opcode === 0x01) {
          // Text frame
          const textData = payload.toString("utf8");
          if (textData.includes("Path:turn.end")) {
            const fullAudio = Buffer.concat(audioChunks);
            if (fullAudio.length > 200) {
              finish({
                buffer: fullAudio.buffer.slice(
                  fullAudio.byteOffset,
                  fullAudio.byteOffset + fullAudio.byteLength,
                ),
                contentType: "audio/mpeg",
              });
            } else {
              finish(null);
            }
            return;
          }
        } else if (opcode === 0x02) {
          // Binary frame: 2-byte big-endian header length + headers + MP3 audio bytes
          if (payload.length > 2) {
            const headerLen = payload.readUInt16BE(0);
            if (payload.length > 2 + headerLen) {
              const headerText = payload
                .subarray(2, 2 + headerLen)
                .toString("utf8");
              if (headerText.includes("Path:audio")) {
                audioChunks.push(Buffer.from(payload.subarray(2 + headerLen)));
              }
            }
          }
        } else if (opcode === 0x08) {
          // Close frame
          const fullAudio = Buffer.concat(audioChunks);
          if (fullAudio.length > 200) {
            finish({
              buffer: fullAudio.buffer.slice(
                fullAudio.byteOffset,
                fullAudio.byteOffset + fullAudio.byteLength,
              ),
              contentType: "audio/mpeg",
            });
          } else {
            finish(null);
          }
          return;
        }
      }
    });

    socket.on("error", () => finish(null));
    socket.on("close", () => {
      const fullAudio = Buffer.concat(audioChunks);
      if (fullAudio.length > 200) {
        finish({
          buffer: fullAudio.buffer.slice(
            fullAudio.byteOffset,
            fullAudio.byteOffset + fullAudio.byteLength,
          ),
          contentType: "audio/mpeg",
        });
      } else {
        finish(null);
      }
    });
  });
}
