// Lectura de pistas con ffprobe y extracción de fotogramas/subtítulos con ffmpeg.

export type AudioTrack = { index: number; codec: string; channels: number; lang?: string; title?: string; default: boolean };
export type SubTrack = { index: number; codec: string; lang?: string; title?: string; forced: boolean; default: boolean };

export type Probe = {
  duration: number; container: string; vcodec?: string; width?: number; height?: number;
  hdr?: "HDR10" | "HLG" | "DV"; audio: AudioTrack[]; subs: SubTrack[];
};

/** Subtítulos de texto que sabemos pasar a WebVTT (PGS/VobSub son imágenes). */
export const TEXT_SUBS = new Set(["subrip", "ass", "ssa", "webvtt", "mov_text", "text"]);

async function run(cmd: string[]): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`${cmd[0]} falló (${code}): ${err.slice(-400)}`);
  return out;
}

export async function probe(path: string): Promise<Probe> {
  const json = JSON.parse(
    await run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]),
  );
  const streams: any[] = json.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const dovi = v?.side_data_list?.some((d: any) => /dovi|dolby vision/i.test(d.side_data_type));
  const hdr = dovi ? "DV" : v?.color_transfer === "smpte2084" ? "HDR10" : v?.color_transfer === "arib-std-b67" ? "HLG" : undefined;
  const tags = (s: any) => ({ lang: s.tags?.language, title: s.tags?.title });

  return {
    duration: Number(json.format?.duration ?? v?.duration ?? 0),
    container: String(json.format?.format_name ?? ""),
    vcodec: v?.codec_name,
    width: v?.width,
    height: v?.height,
    hdr,
    audio: streams.filter((s) => s.codec_type === "audio").map((s) => ({
      index: s.index, codec: s.codec_name, channels: s.channels ?? 2, ...tags(s), default: !!s.disposition?.default,
    })),
    subs: streams.filter((s) => s.codec_type === "subtitle").map((s) => ({
      index: s.index, codec: s.codec_name, ...tags(s),
      forced: !!s.disposition?.forced || /forced/i.test(s.tags?.title ?? ""), default: !!s.disposition?.default,
    })),
  };
}

/** Bandas negras (letterbox) alrededor de `at`, como filtro crop=w:h:x:y. */
async function detectCrop(path: string, at: number): Promise<string | null> {
  const p = Bun.spawn(
    ["ffmpeg", "-ss", String(Math.max(0, at)), "-i", path, "-frames:v", "12", "-vf", "cropdetect=limit=24:round=2:reset=0", "-f", "null", "-"],
    { stdout: "ignore", stderr: "pipe" },
  );
  const err = await new Response(p.stderr).text();
  await p.exited;
  const crops = [...err.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  const last = crops[crops.length - 1];
  return last ? `crop=${last[1]}:${last[2]}:${last[3]}:${last[4]}` : null;
}

/** Fotograma en `at` segundos, sin bandas negras, escalado a 16:9 de `width` px, como JPEG. */
export async function grabFrame(path: string, at: number, width: number, out: string) {
  const crop = await detectCrop(path, at);
  const h = Math.round((width * 9) / 16 / 2) * 2;
  // Tras recortar, rellenamos 16:9 cortando los lados (cover) para que las tarjetas no lleven bandas
  const vf = [crop, `scale=${width}:${h}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${width}:${h}`, "format=yuv420p"]
    .filter(Boolean)
    .join(",");
  await run(["ffmpeg", "-v", "error", "-y", "-ss", String(Math.max(0, at)), "-i", path, "-frames:v", "1", "-vf", vf, "-q:v", "3", out]);
}

/** Extrae una pista de subtítulos como WebVTT. */
export async function extractVtt(path: string, streamIndex: number, out: string) {
  await run(["ffmpeg", "-v", "error", "-y", "-i", path, "-map", `0:${streamIndex}`, "-c:s", "webvtt", "-f", "webvtt", out]);
}

/** Redimensiona una imagen ya descargada. */
export async function resizeImage(src: string, width: number, out: string) {
  await run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", `scale=${width}:-2:flags=lanczos`, "-q:v", "3", out]);
}
