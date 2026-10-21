import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { config } from "./config.ts";
import { db, type MediaRow } from "./db.ts";
import { parseFile, showKey } from "./parse.ts";
import { probe } from "./probe.ts";
import { enrichPending } from "./artwork.ts";
import { runJobs } from "./jobs.ts";

const VIDEO = new Set([".mkv", ".mp4", ".m4v", ".mov", ".avi", ".ts", ".m2ts", ".webm"]);

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (VIDEO.has(extname(e.name).toLowerCase()) && !/\bsample\b/i.test(e.name)) yield p;
  }
}

let running: Promise<void> | null = null;

/** Escaneo incremental: solo vuelve a analizar ficheros nuevos o modificados. */
export function scan(log: (s: string) => void = console.log): Promise<void> {
  running ??= doScan(log).finally(() => (running = null));
  return running;
}

async function doScan(log: (s: string) => void) {
  const t0 = performance.now();
  const known = new Map(
    db.query<Pick<MediaRow, "path" | "size" | "mtime">, []>("SELECT path, size, mtime FROM media").all().map((r) => [r.path, r]),
  );
  const seen = new Set<string>();
  let added = 0;

  for (const lib of config.libraries) {
    for await (const path of walk(lib)) {
      const st = await stat(path);
      if (st.size < config.minVideoBytes) continue;
      seen.add(path);
      const prev = known.get(path);
      if (prev && prev.size === st.size && prev.mtime === Math.floor(st.mtimeMs)) continue;

      try {
        const info = await probe(path);
        if (!info.vcodec) continue;
        const p = parseFile(path);
        const kind = p.kind === "episode" ? "show" : "movie";
        const name = p.kind === "episode" ? p.show : p.title;
        const key = kind === "show" ? `s:${showKey(name)}` : `m:${showKey(name)}:${p.year ?? ""}`;
        const now = Date.now();

        const titleId = db.query<{ id: number }, [string, string, string, number | null, number]>(
          `INSERT INTO titles (kind, key, name, year, added_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET added_at = MAX(added_at, excluded.added_at) RETURNING id`,
        ).get(kind, key, name, p.year ?? null, now)!.id;

        db.query(
          `INSERT INTO media (title_id, path, size, mtime, season, episode, name, duration, container, vcodec,
             width, height, hdr, audio, subs, added_at)
           VALUES ($t, $path, $size, $mtime, $season, $episode, $name, $duration, $container, $vcodec,
             $width, $height, $hdr, $audio, $subs, $now)
           ON CONFLICT(path) DO UPDATE SET title_id=$t, size=$size, mtime=$mtime, season=$season, episode=$episode,
             duration=$duration, container=$container, vcodec=$vcodec, width=$width, height=$height, hdr=$hdr,
             audio=$audio, subs=$subs, trick=NULL, intro_checked=NULL`,
        ).run({
          $t: titleId, $path: path, $size: st.size, $mtime: Math.floor(st.mtimeMs),
          $season: p.kind === "episode" ? p.season : null, $episode: p.kind === "episode" ? p.episode : null,
          $name: p.kind === "episode" ? (p.title ?? null) : null,
          $duration: info.duration, $container: info.container, $vcodec: info.vcodec ?? null,
          $width: info.width ?? null, $height: info.height ?? null, $hdr: info.hdr ?? null,
          $audio: JSON.stringify(info.audio), $subs: JSON.stringify(info.subs), $now: now,
        });
        added++;
        log(`+ ${name}${p.kind === "episode" ? ` S${p.season}E${p.episode}` : ""}`);
      } catch (e) {
        log(`✗ ${path}: ${(e as Error).message}`);
      }
    }
  }

  const gone = [...known.keys()].filter((p) => !seen.has(p));
  for (const p of gone) db.query("DELETE FROM media WHERE path=?").run(p);
  db.exec("DELETE FROM titles WHERE id NOT IN (SELECT DISTINCT title_id FROM media)");

  await enrichPending(log);
  void runJobs(log);
  log(`Escaneo listo en ${((performance.now() - t0) / 1000).toFixed(1)}s: ${added} nuevos, ${gone.length} retirados`);
}
