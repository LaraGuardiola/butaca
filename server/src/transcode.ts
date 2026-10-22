// Conversión al vuelo para lo que la tele no decodifica (DTS, TrueHD…): el vídeo se copia tal cual
// y solo se recodifican las pistas de audio no soportadas, a E-AC-3 5.1. Sale en Matroska por la
// respuesta HTTP mientras ffmpeg lo produce, así que no se puede saltar con Range: para avanzar,
// la tele pide otra vez el stream con ?t=segundos. (MPEG-TS no vale: el HEVC copiado sale sin tiempos.)
import type { AudioTrack } from "./probe.ts";

export const TV_AUDIO = new Set(["aac", "ac3", "eac3", "mp3", "flac", "opus", "vorbis", "pcm_s16le", "pcm_s24le"]);

export function liveStream(req: Request, path: string, audio: AudioTrack[], headers: Record<string, string>) {
  const t = Math.max(0, Number(new URL(req.url).searchParams.get("t")) || 0);
  const codecArgs = audio.flatMap((a, i) =>
    TV_AUDIO.has(a.codec)
      ? [`-c:a:${i}`, "copy"]
      : [`-c:a:${i}`, "eac3", `-b:a:${i}`, "640k", ...(a.channels > 6 ? [`-ac:a:${i}`, "6"] : [])],
  );
  const proc = Bun.spawn(
    [
      "ffmpeg", "-v", "error", "-nostdin",
      // Sin decodificar, el corte cae en un fotograma clave: el que devuelve startOf(t)
      ...(t > 0 ? ["-ss", String(t), "-noaccurate_seek"] : []),
      "-i", path,
      // V mayúscula: el primer vídeo de verdad, no la carátula adjunta
      "-map", "0:V:0", "-map", "0:a?", "-sn", "-dn",
      "-c:v", "copy", ...codecArgs,
      "-f", "matroska", "-live", "1", "pipe:1",
    ],
    { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
  );
  // La tele corta la conexión al salir o al saltar: matamos ffmpeg para no dejarlo trabajando
  req.signal.addEventListener("abort", () => proc.kill());
  void new Response(proc.stderr).text().then((err) => {
    if (err.trim() && !req.signal.aborted) console.warn(`conversión ${path.split("/").pop()}: ${err.trim().slice(-300)}`);
  });
  return new Response(proc.stdout, { headers: { ...headers, "Content-Type": "video/x-matroska", "Cache-Control": "no-store" } });
}

/**
 * En qué segundo empieza de verdad el stream pedido con ?t: ffmpeg salta al fotograma clave que diga
 * el índice del fichero, que no siempre es el más cercano. ffprobe salta igual, así que leemos el
 * primer paquete que ve y la tele usa ese segundo como origen (reloj y subtítulos cuadrados).
 */
export async function startOf(path: string, t: number): Promise<number> {
  if (t <= 0) return 0;
  const p = Bun.spawn(
    ["ffprobe", "-v", "error", "-select_streams", "V:0", "-read_intervals", `${t}%+#1`,
      "-show_entries", "packet=pts_time", "-of", "csv=p=0", path],
    { stdout: "pipe", stderr: "ignore" },
  );
  const first = Number.parseFloat(await new Response(p.stdout).text());
  return Number.isFinite(first) && first <= t ? first : t;
}
