// Vistas que consume la tele: home, ficha de título y datos de reproducción.
import { join } from "node:path";
import { existsSync } from "node:fs";
import { paths } from "./config.ts";
import { db, type MediaRow, type ProgressRow, type TitleRow } from "./db.ts";
import { extractVtt, TEXT_SUBS, type AudioTrack, type SubTrack } from "./probe.ts";

/** Lo que la QN90B decodifica por hardware (Tizen 6.5). DTS y TrueHD no están. */
const TV_VIDEO = new Set(["h264", "hevc", "vp9", "av1", "mpeg2video", "mpeg4"]);
const TV_AUDIO = new Set(["aac", "ac3", "eac3", "mp3", "flac", "opus", "vorbis", "pcm_s16le", "pcm_s24le"]);
const DONE_RATIO = 0.92;

const img = (f: string | null) => (f ? `/img/${encodeURIComponent(f)}` : null);
const epLabel = (m: Pick<MediaRow, "season" | "episode">) => (m.episode != null ? `T${m.season ?? 1}:E${m.episode}` : "");

function titleCard(t: TitleRow) {
  return {
    id: t.id, kind: t.kind, name: t.name, year: t.year, overview: t.overview, tagline: t.tagline,
    genres: t.genres ? (JSON.parse(t.genres) as string[]) : [], rating: t.rating,
    card: img(t.card), backdrop: img(t.backdrop), logo: img(t.logo), poster: img(t.poster),
  };
}

function nextEpisode(m: MediaRow): MediaRow | null {
  if (m.episode == null) return null;
  return db.query<MediaRow, [number, number, number, number]>(
    `SELECT * FROM media WHERE title_id=? AND (season > ? OR (season = ? AND episode > ?))
     ORDER BY season, episode LIMIT 1`,
  ).get(m.title_id, m.season ?? 1, m.season ?? 1, m.episode);
}

/** "Seguir viendo": por título, lo último a medias, o el siguiente episodio si acabaste el anterior. */
function continueWatching() {
  const rows = db.query<ProgressRow & MediaRow, []>(
    `SELECT p.*, m.* FROM progress p JOIN media m ON m.id = p.media_id
     WHERE p.updated_at = (SELECT MAX(p2.updated_at) FROM progress p2 JOIN media m2 ON m2.id=p2.media_id
                           WHERE m2.title_id = m.title_id)
     ORDER BY p.updated_at DESC LIMIT 20`,
  ).all();
  const out = [];
  for (const r of rows) {
    const target = r.done ? nextEpisode(r) : r;
    if (!target) continue;
    const t = db.query<TitleRow, [number]>("SELECT * FROM titles WHERE id=?").get(target.title_id)!;
    const resume = r.done ? 0 : r.position / r.duration;
    out.push({
      ...titleCard(t),
      card: img(target.still) ?? img(t.card),
      mediaId: target.id,
      progress: resume,
      subtitle: [epLabel(target), target.name].filter(Boolean).join(" · ") || null,
    });
  }
  return out;
}

export function home() {
  const titles = db.query<TitleRow, []>("SELECT * FROM titles ORDER BY added_at DESC").all();
  const cards = titles.map(titleCard);
  const withArt = cards.filter((c) => c.backdrop);
  const rows = [
    { id: "continue", title: "Seguir viendo", items: continueWatching() },
    { id: "recent", title: "Añadido recientemente", items: cards.slice(0, 20) },
    { id: "shows", title: "Series", items: cards.filter((c) => c.kind === "show") },
    { id: "movies", title: "Películas", items: cards.filter((c) => c.kind === "movie") },
  ];
  // Géneros con al menos 2 títulos se convierten en filas propias
  const genres = new Map<string, typeof cards>();
  for (const c of cards) for (const g of c.genres) genres.set(g, [...(genres.get(g) ?? []), c]);
  for (const [g, items] of genres) if (items.length >= 2) rows.push({ id: `g:${g}`, title: g, items });

  return { hero: withArt.slice(0, 6), rows: rows.filter((r) => r.items.length) };
}

export function title(id: number) {
  const t = db.query<TitleRow, [number]>("SELECT * FROM titles WHERE id=?").get(id);
  if (!t) return null;
  const media = db.query<MediaRow & { position: number | null; pdur: number | null; done: number | null; updated_at: number | null }, [number]>(
    `SELECT m.*, p.position, p.duration AS pdur, p.done, p.updated_at FROM media m
     LEFT JOIN progress p ON p.media_id = m.id WHERE m.title_id=? ORDER BY m.season, m.episode, m.path`,
  ).all(id);

  const seasons = new Map<number, unknown[]>();
  for (const m of media) {
    const s = m.season ?? 0;
    seasons.set(s, [...(seasons.get(s) ?? []), {
      id: m.id, season: m.season, episode: m.episode, name: m.name ?? (m.episode != null ? `Episodio ${m.episode}` : t.name),
      overview: m.overview, still: img(m.still), duration: m.duration,
      progress: m.done ? 1 : m.position && m.pdur ? m.position / m.pdur : 0,
    }]);
  }

  // Botón principal: reanudar lo último visto, siguiente episodio, o empezar desde el principio
  const last = media.filter((m) => m.updated_at).sort((a, b) => b.updated_at! - a.updated_at!)[0];
  const target = last ? (last.done ? nextEpisode(last) ?? media[0] : last) : media[0];
  const resuming = !!(target && last && target.id === last.id && !last.done);
  const play = target && {
    mediaId: target.id,
    label: `${resuming ? "Reanudar" : "Reproducir"}${t.kind === "show" ? ` ${epLabel(target)}` : ""}`,
  };

  const m0 = media[0];
  return {
    ...titleCard(t),
    quality: m0 && { width: m0.width, height: m0.height, hdr: m0.hdr },
    seasons: [...seasons].map(([season, episodes]) => ({ season, episodes })),
    play,
  };
}

/** Pista de subtítulos por defecto: castellano de España > castellano > nada. Forzados si el audio ya es español. */
function pickSub(subs: SubTrack[], audioLang?: string): number | null {
  const text = subs.filter((s) => TEXT_SUBS.has(s.codec));
  const spa = text.filter((s) => s.lang === "spa" || s.lang === "es");
  if (audioLang === "spa") return spa.find((s) => s.forced)?.index ?? null;
  const full = spa.filter((s) => !s.forced && !/sdh|cc/i.test(s.title ?? ""));
  return (full.find((s) => !/latin|lat\b|latam|américa|america/i.test(s.title ?? "")) ?? full[0] ?? spa[0])?.index ?? null;
}

export function media(id: number) {
  const m = db.query<MediaRow, [number]>("SELECT * FROM media WHERE id=?").get(id);
  if (!m) return null;
  const t = db.query<TitleRow, [number]>("SELECT * FROM titles WHERE id=?").get(m.title_id)!;
  const p = db.query<ProgressRow, [number]>("SELECT * FROM progress WHERE media_id=?").get(id);
  const audio: AudioTrack[] = JSON.parse(m.audio);
  const subs: SubTrack[] = JSON.parse(m.subs);
  const defAudio = audio.find((a) => a.default) ?? audio[0];
  const defSub = pickSub(subs, defAudio?.lang);
  const next = nextEpisode(m);

  // Extraer en segundo plano el subtítulo por defecto para que esté listo al dar a play
  if (defSub != null) void vtt(m.id, defSub);

  const reasons = [
    !TV_VIDEO.has(m.vcodec ?? "") && `vídeo ${m.vcodec}`,
    !audio.some((a) => TV_AUDIO.has(a.codec)) && `audio ${audio.map((a) => a.codec).join("/")}`,
  ].filter(Boolean) as string[];

  return {
    id: m.id, titleId: t.id, titleName: t.name, kind: t.kind, logo: img(t.logo), backdrop: img(t.backdrop),
    name: m.name, season: m.season, episode: m.episode, label: epLabel(m), duration: m.duration,
    width: m.width, height: m.height, hdr: m.hdr,
    stream: `/stream/${m.id}`,
    directPlay: reasons.length === 0, unsupported: reasons,
    position: p && !p.done ? p.position : 0,
    audio: audio.map((a, i) => ({ ...a, order: i, supported: TV_AUDIO.has(a.codec) })),
    subs: subs.filter((s) => TEXT_SUBS.has(s.codec)).map((s) => ({ ...s, url: `/subs/${m.id}/${s.index}.vtt` })),
    defaultSub: defSub,
    next: next && { id: next.id, name: next.name, label: epLabel(next), still: img(next.still) },
  };
}

export function saveProgress(mediaId: number, position: number, duration: number) {
  if (!(duration > 0)) return;
  const done = position / duration >= DONE_RATIO ? 1 : 0;
  db.query(
    `INSERT INTO progress (media_id, position, duration, done, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(media_id) DO UPDATE SET position=excluded.position, duration=excluded.duration,
       done=excluded.done, updated_at=excluded.updated_at`,
  ).run(mediaId, position, duration, done, Date.now());
}

const extracting = new Map<string, Promise<string>>();

/** Ruta del .vtt cacheado, extrayéndolo la primera vez. */
export function vtt(mediaId: number, streamIndex: number): Promise<string> {
  const key = `${mediaId}-${streamIndex}`;
  const out = join(paths.subs, `${key}.vtt`);
  if (existsSync(out)) return Promise.resolve(out);
  let job = extracting.get(key);
  if (!job) {
    const m = db.query<MediaRow, [number]>("SELECT * FROM media WHERE id=?").get(mediaId);
    if (!m) return Promise.reject(new Error("media no encontrada"));
    job = extractVtt(m.path, streamIndex, out).then(() => out).finally(() => extracting.delete(key));
    extracting.set(key, job);
  }
  return job;
}
