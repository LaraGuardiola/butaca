// Interpreta nombres de archivo de vídeo: series (S01E02, 1x02, "Anime - 05"), pelis (Título (2019)).
import { basename, dirname, extname } from "node:path";

export type Parsed =
  | { kind: "episode"; show: string; season: number; episode: number; title?: string; year?: number }
  | { kind: "movie"; title: string; year?: number };

const JUNK =
  /\b(2160p|1080p|720p|480p|4k|uhd|hdr10\+?|hdr|dv|dovi|web[- ]?dl|webrip|bluray|blu-ray|brrip|bdrip|remux|hdtv|x264|x265|h\.?264|h\.?265|hevc|avc|aac\d?(\.\d)?|ac3|eac3|ddp?\d?(\.\d)?|dts(-hd)?|truehd|atmos|10bit|8bit|dual[ .-]?audio|multi|proper|repack|extended|internal|amzn|nf|dsnp|hmax|atvp)\b.*$/i;

/** Quita etiquetas de grupo [NOP], (1080p), sufijos de release y normaliza separadores. */
export function clean(s: string): string {
  return s
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((?:\d{3,4}p|[^)]*(?:rip|web|bluray)[^)]*)\)/gi, " ")
    .replace(/(?<=\w)[._](?=\w)/g, " ")
    .replace(JUNK, " ")
    .replace(/-\s*[A-Za-z0-9]+$/, (m) => (/\s/.test(m) ? m : " ")) // "-MeGusta" pegado al final
    .replace(/\s+/g, " ")
    .replace(/[\s\-–:]+$/, "")
    .trim();
}

function splitYear(s: string): { name: string; year?: number } {
  const m = s.match(/^(.*?)[\s(]+((?:19|20)\d{2})\)?$/);
  if (m && m[1].trim()) return { name: m[1].trim(), year: +m[2] };
  return { name: s };
}

export function parseFile(path: string): Parsed {
  const file = basename(path, extname(path));
  const folder = basename(dirname(path));

  // S01E02 / s1e2 / 1x02
  const se = file.match(/^(.*?)[\s._\-[]*\b[Ss](\d{1,2})[\s._]?[Ee](\d{1,3})(?:[-Ee]+\d{1,3})?\b(.*)$/) ??
    file.match(/^(.*?)[\s._\-]*\b(\d{1,2})x(\d{2,3})\b(.*)$/);
  if (se) {
    let show = clean(se[1]);
    if (!show) show = clean(folder.replace(/\b(season|temporada)\s*\d+\b/gi, ""));
    const title = clean(se[4].replace(/^[\s._\-]+/, "")) || undefined;
    const { name, year } = splitYear(show);
    return { kind: "episode", show: name, season: +se[2], episode: +se[3], title, year };
  }

  // Estilo anime: "Serie - 05", "Serie 05 [1080p]", "Serie - 05v2"
  const stripped = file.replace(/\[[^\]]*\]/g, " ").replace(/\((?:\d{3,4}p)\)/gi, " ").trim();
  const abs = stripped.match(/^(.*?\D)\s*(?:-\s*|\s)(?:e|ep|episode|episodio)?\s*(\d{1,4})(?:v\d)?\s*$/i);
  if (abs && !/^(19|20)\d{2}$/.test(abs[2])) {
    const { name, year } = splitYear(clean(abs[1]));
    const season = folder.match(/\b(?:season|temporada|s)\s*(\d{1,2})\b/i);
    return { kind: "episode", show: name, season: season ? +season[1] : 1, episode: +abs[2], year };
  }

  // "Breaking Bad/Season 2/03 - Título.mkv": el número es el episodio y la serie es la carpeta abuela
  const seasonDir = folder.match(/^(?:season|temporada|s)\s*(\d{1,2})$/i);
  const lead = file.match(/^(?:e|ep)?(\d{1,3})(?:\s*[-.]\s*|\s+)(.*)$/i);
  if (seasonDir && lead) {
    const { name, year } = splitYear(clean(basename(dirname(dirname(path)))));
    return { kind: "episode", show: name, season: +seasonDir[1], episode: +lead[1], title: clean(lead[2]) || undefined, year };
  }

  // Peli: "Título (2019)" gana; si no, el último año seguido de basura de release ("Titulo.2019.1080p")
  const plain = file.replace(/\[[^\]]*\]/g, " ").replace(/[._]/g, " ");
  const y = plain.match(/^(.*\S)\s*\(((?:19|20)\d{2})\)/) ?? plain.match(/^(.*\S)\s+((?:19|20)\d{2})(?:\s+\S.*)?$/);
  if (y) return { kind: "movie", title: clean(y[1]), year: +y[2] };
  return { kind: "movie", title: clean(file) };
}

/** Clave estable para agrupar episodios de la misma serie. */
export function showKey(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "");
}
