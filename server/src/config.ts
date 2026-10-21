import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

type FileConfig = { libraries?: string[]; port?: number; tmdbToken?: string; lights?: string[] };

const root = resolve(import.meta.dir, "../..");
const file: FileConfig = await Bun.file(join(root, "butaca.config.json")).json().catch(() => ({}));
const expand = (p: string) => p.replace(/^~(?=$|\/)/, homedir());

export const config = {
  root,
  port: Number(process.env.PORT ?? file.port ?? 8420),
  libraries: (file.libraries ?? ["~/Videos"]).map(expand),
  /** Token de lectura v4 o API key v3 de TMDB; sin él usamos fotogramas del propio vídeo. */
  tmdbToken: process.env.TMDB_TOKEN ?? file.tmdbToken,
  dataDir: expand(process.env.BUTACA_DATA ?? "~/.local/share/butaca"),
  minVideoBytes: 50 * 1024 * 1024,
  /** IPs de bombillas Tapo para el modo cine (vacío = desactivado). */
  lights: file.lights ?? [],
};

export const paths = {
  db: join(config.dataDir, "butaca.db"),
  img: join(config.dataDir, "img"),
  subs: join(config.dataDir, "subs"),
  tvDist: join(root, "tv/dist"),
};

mkdirSync(paths.img, { recursive: true });
mkdirSync(paths.subs, { recursive: true });
