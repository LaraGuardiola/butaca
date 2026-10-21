import { Database } from "bun:sqlite";
import { paths } from "./config.ts";

export const db = new Database(paths.db, { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS titles (
  id        INTEGER PRIMARY KEY,
  kind      TEXT NOT NULL,              -- 'movie' | 'show'
  key       TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  year      INTEGER,
  overview  TEXT,
  tagline   TEXT,
  genres    TEXT,                       -- JSON string[]
  rating    REAL,
  tmdb_id   INTEGER,
  backdrop  TEXT,                       -- ficheros en paths.img
  card      TEXT,
  poster    TEXT,
  logo      TEXT,
  meta_at   INTEGER,                    -- último intento de metadatos
  added_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id        INTEGER PRIMARY KEY,
  title_id  INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  path      TEXT NOT NULL UNIQUE,
  size      INTEGER NOT NULL,
  mtime     INTEGER NOT NULL,
  season    INTEGER,
  episode   INTEGER,
  name      TEXT,
  overview  TEXT,
  still     TEXT,
  duration  REAL,
  container TEXT,
  vcodec    TEXT,
  width     INTEGER,
  height    INTEGER,
  hdr       TEXT,
  audio     TEXT NOT NULL DEFAULT '[]', -- JSON AudioTrack[]
  subs      TEXT NOT NULL DEFAULT '[]', -- JSON SubTrack[]
  added_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS media_title ON media(title_id, season, episode);
CREATE TABLE IF NOT EXISTS progress (
  media_id   INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  position   REAL NOT NULL,
  duration   REAL NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`);

export type TitleRow = {
  id: number; kind: "movie" | "show"; key: string; name: string; year: number | null;
  overview: string | null; tagline: string | null; genres: string | null; rating: number | null;
  tmdb_id: number | null; backdrop: string | null; card: string | null; poster: string | null;
  logo: string | null; meta_at: number | null; added_at: number;
};

export type MediaRow = {
  id: number; title_id: number; path: string; size: number; mtime: number;
  season: number | null; episode: number | null; name: string | null; overview: string | null;
  still: string | null; duration: number | null; container: string | null; vcodec: string | null;
  width: number | null; height: number | null; hdr: string | null; audio: string; subs: string;
  added_at: number;
};

export type ProgressRow = { media_id: number; position: number; duration: number; done: number; updated_at: number };
