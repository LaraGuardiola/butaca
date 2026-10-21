// Metadatos e imágenes: TMDB si hay token, y siempre un plan B con fotogramas del propio vídeo.
import { join } from "node:path";
import { existsSync } from "node:fs";
import { config, paths } from "./config.ts";
import { db, type MediaRow, type TitleRow } from "./db.ts";
import { grabFrame, resizeImage } from "./probe.ts";

const LANG = "es-ES";
const CARD_W = 640;

async function tmdb(path: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
  const token = config.tmdbToken!;
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  const bearer = token.startsWith("eyJ");
  if (!bearer) url.searchParams.set("api_key", token);
  const res = await fetch(url, { headers: bearer ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`TMDB ${res.status} en ${path}`);
  return res.json();
}

async function download(tmdbPath: string | null | undefined, size: string): Promise<string | null> {
  if (!tmdbPath) return null;
  const file = `tmdb-${size}-${tmdbPath.replace(/^\//, "")}`;
  const out = join(paths.img, file);
  if (existsSync(out)) return file;
  const res = await fetch(`https://image.tmdb.org/t/p/${size}${tmdbPath}`);
  if (!res.ok) return null;
  await Bun.write(out, res);
  return file;
}

async function cardFrom(file: string | null): Promise<string | null> {
  if (!file) return null;
  const card = file.replace(/\.\w+$/, `-card.jpg`);
  if (!existsSync(join(paths.img, card))) await resizeImage(join(paths.img, file), CARD_W, join(paths.img, card));
  return card;
}

const byVotes = (a: any, b: any) => b.vote_average - a.vote_average || b.width - a.width;
const pick = (imgs: any[] = [], langs: (string | null)[]) => {
  for (const l of langs) {
    const hit = imgs.filter((i) => i.iso_639_1 === l).sort(byVotes)[0];
    if (hit) return hit.file_path as string;
  }
  return null;
};

/** Variantes del nombre para buscar: completo, sin paréntesis, antes del " - ". */
function queries(name: string): string[] {
  const noParen = name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const head = noParen.split(/\s+-\s+/)[0];
  const paren = name.match(/\(([^)]+)\)/)?.[1];
  return [...new Set([noParen, name, head, paren].filter(Boolean) as string[])];
}

async function enrichFromTmdb(t: TitleRow) {
  const kind = t.kind === "show" ? "tv" : "movie";
  let hit: any;
  for (const q of queries(t.name)) {
    const yearKey = kind === "tv" ? "first_air_date_year" : "year";
    const r = await tmdb(`/search/${kind}`, { query: q, language: LANG, [yearKey]: t.year ?? undefined });
    hit = r.results?.[0];
    if (hit) break;
  }
  if (!hit) return false;

  const d = await tmdb(`/${kind}/${hit.id}`, {
    language: LANG, append_to_response: "images", include_image_language: "es,en,null",
  });
  const overview = d.overview || (await tmdb(`/${kind}/${hit.id}`, { language: "en-US" })).overview;
  // Fondo sin texto (iso null) para que el logo luzca encima
  const backdrop = await download(pick(d.images?.backdrops, [null]) ?? d.backdrop_path, "original");
  db.query(
    `UPDATE titles SET tmdb_id=?, name=?, year=?, overview=?, tagline=?, genres=?, rating=?,
       backdrop=?, card=?, poster=?, logo=? WHERE id=?`,
  ).run(
    d.id, d.name ?? d.title ?? t.name, Number((d.first_air_date ?? d.release_date ?? "").slice(0, 4)) || t.year,
    overview || null, d.tagline || null, JSON.stringify((d.genres ?? []).map((g: any) => g.name)),
    d.vote_average ?? null, backdrop, await cardFrom(backdrop),
    await download(d.poster_path, "w500"), await download(pick(d.images?.logos, ["es", "en", null]), "w500"),
    t.id,
  );

  if (kind === "tv") {
    const seasons = db.query<{ season: number }, [number]>(
      "SELECT DISTINCT season FROM media WHERE title_id=? AND season IS NOT NULL",
    ).all(t.id);
    for (const { season } of seasons) {
      const s = await tmdb(`/tv/${d.id}/season/${season}`, { language: LANG }).catch(() => null);
      for (const ep of s?.episodes ?? []) {
        db.query(
          `UPDATE media SET name=COALESCE(?, name), overview=COALESCE(?, overview), still=COALESCE(?, still)
           WHERE title_id=? AND season=? AND episode=?`,
        ).run(ep.name || null, ep.overview || null, await download(ep.still_path, "w780"), t.id, season, ep.episode_number);
      }
    }
  }
  return true;
}

/** Fondo de respaldo: un fotograma a ~20% del primer vídeo del título. */
async function frameArtwork(t: TitleRow) {
  const m = db.query<MediaRow, [number]>(
    "SELECT * FROM media WHERE title_id=? ORDER BY season, episode LIMIT 1",
  ).get(t.id);
  if (!m) return;
  const file = `frame-t${t.id}.jpg`;
  await grabFrame(m.path, (m.duration ?? 600) * 0.2, 1920, join(paths.img, file));
  db.query("UPDATE titles SET backdrop=COALESCE(backdrop, ?), card=COALESCE(card, ?) WHERE id=?")
    .run(file, await cardFrom(file), t.id);
}

export async function enrichPending(log: (s: string) => void) {
  const pending = db.query<TitleRow, []>("SELECT * FROM titles WHERE meta_at IS NULL").all();
  for (const t of pending) {
    try {
      const ok = config.tmdbToken ? await enrichFromTmdb(t) : false;
      log(`${ok ? "TMDB ✓" : "sin TMDB"}  ${t.name}`);
    } catch (e) {
      log(`TMDB ✗  ${t.name}: ${(e as Error).message}`);
    }
    const now = db.query<TitleRow, [number]>("SELECT * FROM titles WHERE id=?").get(t.id)!;
    if (!now.backdrop) await frameArtwork(now).catch((e) => log(`fotograma ✗ ${t.name}: ${e.message}`));
    db.query("UPDATE titles SET meta_at=? WHERE id=?").run(Date.now(), t.id);
  }

  // Episodios sin still de TMDB: fotograma propio
  const noStill = db.query<MediaRow, []>(
    "SELECT media.* FROM media JOIN titles ON titles.id=title_id WHERE kind='show' AND still IS NULL",
  ).all();
  for (const m of noStill) {
    const file = `frame-m${m.id}.jpg`;
    await grabFrame(m.path, (m.duration ?? 600) * 0.3, CARD_W, join(paths.img, file))
      .then(() => db.query("UPDATE media SET still=? WHERE id=?").run(file, m.id))
      .catch((e) => log(`still ✗ ${m.path}: ${e.message}`));
  }
}
