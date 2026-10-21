// Trabajo pesado en segundo plano, de uno en uno: miniaturas para avanzar y detección de intros.
import { join } from "node:path";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { paths } from "./config.ts";
import { db, type MediaRow } from "./db.ts";
import { detectCrop } from "./probe.ts";
import { commonSegment, decodeAudio, fingerprint, HOP_SEC } from "./fingerprint.ts";

export type TrickInfo = { interval: number; w: number; h: number; cols: number; rows: number; sheets: number };

const TRICK: Omit<TrickInfo, "sheets"> = { interval: 10, w: 320, h: 180, cols: 10, rows: 10 };
const TRICK_DIR = join(paths.img, "trick");
mkdirSync(TRICK_DIR, { recursive: true });

/** La intro se busca en el primer 25 % del episodio, como mucho 10 minutos. */
const INTRO_WINDOW = 600;
const INTRO_MIN = 15;
const INTRO_MAX = 150;
/** Segunda pasada: buscar una intro ya conocida en una ventana más larga. */
const LONG_WINDOW = 1800;

async function makeTrickplay(m: MediaRow, log: (s: string) => void) {
  const crop = await detectCrop(m.path, (m.duration ?? 600) * 0.3);
  const { w, h, cols, rows, interval } = TRICK;
  const vf = [
    `fps=1/${interval}`,
    crop,
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    `crop=${w}:${h}`,
    `tile=${cols}x${rows}`,
  ].filter(Boolean).join(",");
  const prefix = `${m.id}-`;
  for (const f of readdirSync(TRICK_DIR)) if (f.startsWith(prefix)) rmSync(join(TRICK_DIR, f));

  // Solo fotogramas clave: 10 veces más rápido y para una miniatura de avance sobra
  const p = Bun.spawn(
    ["ffmpeg", "-v", "fatal", "-y", "-skip_frame", "nokey", "-i", m.path, "-an", "-sn", "-dn", "-vf", vf,
      "-fps_mode", "vfr", "-q:v", "6", join(TRICK_DIR, `${prefix}%03d.jpg`)],
    { stdout: "ignore", stderr: "pipe" },
  );
  const err = await new Response(p.stderr).text();
  if ((await p.exited) !== 0) throw new Error(err.slice(-300));
  const sheets = readdirSync(TRICK_DIR).filter((f) => f.startsWith(prefix)).length;
  db.query("UPDATE media SET trick=? WHERE id=?").run(JSON.stringify({ ...TRICK, sheets }), m.id);
  log(`miniaturas ✓ ${m.path.split("/").pop()} (${sheets} hojas)`);
}

/** Compara cada episodio con sus vecinos de temporada y se queda con el tramo común más plausible. */
async function detectIntros(titleId: number, season: number, log: (s: string) => void) {
  const eps = db.query<MediaRow, [number, number]>(
    "SELECT * FROM media WHERE title_id=? AND season=? ORDER BY episode",
  ).all(titleId, season);
  if (eps.length < 2) {
    for (const e of eps) db.query("UPDATE media SET intro_checked=1 WHERE id=?").run(e.id);
    return;
  }
  const prints = new Map<number, Uint32Array>();
  const print = async (m: MediaRow) => {
    let fp = prints.get(m.id);
    if (!fp) {
      const secs = Math.min(INTRO_WINDOW, Math.max(120, (m.duration ?? 2400) * 0.25));
      fp = fingerprint(await decodeAudio(m.path, secs));
      prints.set(m.id, fp);
    }
    return fp;
  };

  const found = new Map<number, { start: number; end: number }>();
  const keep = (id: number, start: number, end: number) => {
    const len = end - start;
    if (len < INTRO_MIN || len > INTRO_MAX) return;
    const prev = found.get(id);
    if (!prev || len > prev.end - prev.start) found.set(id, { start, end });
  };
  for (let i = 0; i < eps.length - 1; i++) {
    try {
      const seg = commonSegment(await print(eps[i]), await print(eps[i + 1]), INTRO_MIN);
      if (seg) {
        keep(eps[i].id, seg.aStart, seg.aEnd);
        keep(eps[i + 1].id, seg.bStart, seg.bEnd);
      }
    } catch (e) {
      log(`intro ✗ ${(e as Error).message}`);
    }
  }
  // Episodios con el cold open largo: la intro cae fuera de la ventana. Buscamos la huella exacta
  // de una intro ya encontrada en los primeros 30 minutos (o la mitad del episodio).
  const ref = eps.find((e) => found.has(e.id));
  if (ref) {
    const r = found.get(ref.id)!;
    const intro = (await print(ref)).slice(Math.floor(r.start / HOP_SEC), Math.ceil(r.end / HOP_SEC));
    for (const e of eps.filter((x) => !found.has(x.id))) {
      try {
        const long = fingerprint(await decodeAudio(e.path, Math.min(LONG_WINDOW, (e.duration ?? 2400) * 0.5)));
        // Al menos el 70 % de la intro de referencia: un trozo suelto suele ser una coincidencia o un corte
        const seg = commonSegment(intro, long, Math.max(INTRO_MIN, (r.end - r.start) * 0.7));
        if (seg) keep(e.id, seg.bStart, seg.bEnd);
      } catch (err) {
        log(`intro ✗ ${(err as Error).message}`);
      }
    }
  }

  for (const e of eps) {
    const f = found.get(e.id);
    db.query("UPDATE media SET intro_start=?, intro_end=?, intro_checked=1 WHERE id=?")
      .run(f?.start ?? null, f?.end ?? null, e.id);
  }
  log(`intros ✓ temporada ${season}: ${found.size}/${eps.length} episodios con intro`);
}

let running: Promise<void> | null = null;

export function runJobs(log: (s: string) => void = console.log) {
  running ??= (async () => {
    const seasons = db.query<{ title_id: number; season: number }, []>(
      `SELECT DISTINCT title_id, season FROM media WHERE season IS NOT NULL AND intro_checked IS NULL`,
    ).all();
    for (const s of seasons) await detectIntros(s.title_id, s.season, log);

    const pending = db.query<MediaRow, []>("SELECT * FROM media WHERE trick IS NULL ORDER BY added_at DESC").all();
    for (const m of pending) await makeTrickplay(m, log).catch((e) => log(`miniaturas ✗ ${m.path}: ${e.message}`));
  })().finally(() => (running = null));
  return running;
}
