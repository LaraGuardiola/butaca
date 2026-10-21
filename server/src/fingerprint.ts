// Huella acústica (Haitsma-Kalker, la de Philips) para encontrar la intro que comparten los episodios.
// Cada ~93 ms de audio se resume en 32 bits: si la energía de cada banda sube o baja respecto a la
// vecina y al instante anterior. Dos episodios con la misma intro tienen tramos de huella casi iguales.

const SR = 5512;
const FRAME = 2048;
const HOP = 512;
const BANDS = 33;
export const HOP_SEC = HOP / SR;

/** Audio mono a 5,5 kHz de los primeros `seconds` segundos. */
export async function decodeAudio(path: string, seconds: number): Promise<Float32Array> {
  const p = Bun.spawn(
    ["ffmpeg", "-v", "error", "-t", String(seconds), "-i", path, "-map", "0:a:0", "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const buf = await new Response(p.stdout).arrayBuffer();
  if ((await p.exited) !== 0) throw new Error(`ffmpeg no pudo leer el audio de ${path}`);
  return new Float32Array(buf, 0, Math.floor(buf.byteLength / 4));
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

export function fingerprint(samples: Float32Array): Uint32Array {
  const frames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
  const win = new Float64Array(FRAME).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
  // 33 bandas logarítmicas entre 300 Hz y 2 kHz, donde vive casi toda la música
  const edges = Array.from({ length: BANDS + 1 }, (_, b) =>
    Math.round((300 * Math.pow(2000 / 300, b / BANDS) * FRAME) / SR),
  );
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  let prev = new Float64Array(BANDS);
  let cur = new Float64Array(BANDS);
  const out = new Uint32Array(Math.max(0, frames - 1));

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = samples[off + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < BANDS; b++) {
      let e = 0;
      for (let k = edges[b]; k < edges[b + 1]; k++) e += re[k] * re[k] + im[k] * im[k];
      cur[b] = e;
    }
    if (f > 0) {
      let h = 0;
      for (let m = 0; m < 32; m++) if (cur[m] - cur[m + 1] - (prev[m] - prev[m + 1]) > 0) h |= 1 << m;
      out[f - 1] = h >>> 0;
    }
    [prev, cur] = [cur, prev];
  }
  return out;
}

function popcount(x: number) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export type Segment = { aStart: number; aEnd: number; bStart: number; bEnd: number };

/**
 * Tramo común más largo entre dos huellas (en segundos de cada una).
 * 1) Votación: los hashes idénticos proponen desfases. 2) Con los mejores desfases medimos la tasa
 *    de bits erróneos suavizada y buscamos la racha más larga por debajo del umbral.
 */
export function commonSegment(a: Uint32Array, b: Uint32Array, minSec = 15): Segment | null {
  const index = new Map<number, number[]>();
  for (let j = 0; j < b.length; j++) {
    const list = index.get(b[j]);
    if (list) list.push(j);
    else index.set(b[j], [j]);
  }
  const votes = new Map<number, number>();
  for (let i = 0; i < a.length; i++) {
    const js = index.get(a[i]);
    if (!js || js.length > 20) continue; // hashes de silencio: se repiten por todas partes y no informan
    for (const j of js) votes.set(j - i, (votes.get(j - i) ?? 0) + 1);
  }
  const offsets = [...votes].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([o]) => o);

  const WIN = 24; // ~2,2 s de suavizado
  const THRESHOLD = 0.3; // dos audios distintos rondan 0,5
  let best: Segment | null = null;
  for (const off of offsets) {
    const i0 = Math.max(0, -off);
    const i1 = Math.min(a.length, b.length - off);
    if (i1 - i0 < WIN) continue;
    const err = new Float64Array(i1 - i0);
    for (let i = i0; i < i1; i++) err[i - i0] = popcount((a[i] ^ b[i + off]) >>> 0) / 32;
    let sum = 0;
    let run = -1;
    for (let k = 0; k <= err.length; k++) {
      if (k < err.length) {
        sum += err[k];
        if (k >= WIN) sum -= err[k - WIN];
      }
      const ok = k < err.length && k >= WIN - 1 && sum / WIN < THRESHOLD;
      if (ok && run < 0) run = k - (WIN - 1);
      if (!ok && run >= 0) {
        const s = run + i0;
        const e = k - 1 + i0;
        const len = (e - s) * HOP_SEC;
        if (len >= minSec && (!best || len > best.aEnd - best.aStart)) {
          best = { aStart: s * HOP_SEC, aEnd: e * HOP_SEC, bStart: (s + off) * HOP_SEC, bEnd: (e + off) * HOP_SEC };
        }
        run = -1;
      }
    }
  }
  return best;
}
