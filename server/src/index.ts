import { join, extname, normalize } from "node:path";
import { networkInterfaces, hostname } from "node:os";
import { watch } from "node:fs";
import { config, paths } from "./config.ts";
import { db, type MediaRow } from "./db.ts";
import { scan } from "./scanner.ts";
import * as api from "./api.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });
const notFound = () => json({ error: "no encontrado" }, 404);

const MIME: Record<string, string> = {
  ".mkv": "video/x-matroska", ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
  ".mov": "video/quicktime", ".ts": "video/mp2t", ".m2ts": "video/mp2t", ".avi": "video/x-msvideo",
};

/** Sirve un fichero respetando Range, que es lo que usa AVPlay para hacer seek. */
function serveRange(req: Request, path: string, type: string) {
  const file = Bun.file(path);
  const size = file.size;
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  const base = { ...CORS, "Content-Type": type, "Accept-Ranges": "bytes" };
  if (!range || (!range[1] && !range[2])) {
    return new Response(file, { headers: { ...base, "Content-Length": String(size) } });
  }
  let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  }
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: { ...base, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
  });
}

function lanIp() {
  for (const list of Object.values(networkInterfaces()))
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal && /^(192\.168|10\.)/.test(i.address)) return i.address;
  return "localhost";
}

const server = Bun.serve({
  port: config.port,
  hostname: "0.0.0.0",
  idleTimeout: 0, // streams largos
  routes: {
    "/api/ping": () => json({ app: "butaca", host: hostname() }),
    "/api/home": () => json(api.home()),
    "/api/titles/:id": (req) => {
      const t = api.title(Number(req.params.id));
      return t ? json(t) : notFound();
    },
    "/api/media/:id": (req) => {
      const m = api.media(Number(req.params.id));
      return m ? json(m) : notFound();
    },
    "/api/progress": {
      POST: async (req) => {
        const { mediaId, position, duration } = await req.json();
        api.saveProgress(Number(mediaId), Number(position), Number(duration));
        return json({ ok: true });
      },
      OPTIONS: () => new Response(null, { headers: CORS }),
    },
    "/api/scan": {
      POST: () => {
        void scan();
        return json({ ok: true });
      },
    },
    "/stream/:id": (req) => {
      const m = db.query<MediaRow, [number]>("SELECT path FROM media WHERE id=?").get(Number(req.params.id));
      if (!m) return notFound();
      return serveRange(req, m.path, MIME[extname(m.path).toLowerCase()] ?? "application/octet-stream");
    },
    "/subs/:id/:file": async (req) => {
      const index = Number.parseInt(req.params.file);
      try {
        const out = await api.vtt(Number(req.params.id), index);
        return new Response(Bun.file(out), { headers: { ...CORS, "Content-Type": "text/vtt; charset=utf-8" } });
      } catch (e) {
        return json({ error: (e as Error).message }, 500);
      }
    },
    "/img/:file": (req) => {
      const f = Bun.file(join(paths.img, normalize(req.params.file).replace(/^(\.\.[/\\])+/, "")));
      return new Response(f, { headers: { ...CORS, "Cache-Control": "public, max-age=31536000, immutable" } });
    },
  },
  // La app de la tele también se sirve aquí para previsualizarla en el navegador del PC
  async fetch(req) {
    const url = new URL(req.url);
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    const f = Bun.file(join(paths.tvDist, rel === "/" ? "index.html" : rel));
    if (await f.exists()) return new Response(f);
    return new Response(Bun.file(join(paths.tvDist, "index.html")));
  },
  error(e) {
    console.error(e);
    return json({ error: e.message }, 500);
  },
});

console.log(`🍿 Butaca en http://${lanIp()}:${server.port}`);
console.log(`   Bibliotecas: ${config.libraries.join(", ")}`);
console.log(`   TMDB: ${config.tmdbToken ? "sí" : "no (usaré fotogramas de los vídeos)"}`);

void scan();

// Re-escanear cuando cambien las bibliotecas (descargas que terminan, etc.)
let timer: Timer | undefined;
for (const lib of config.libraries) {
  try {
    watch(lib, { recursive: true }, (_ev, name) => {
      if (name && !/\.(mkv|mp4|m4v|mov|avi|ts|m2ts|webm)$/i.test(name)) return;
      clearTimeout(timer);
      timer = setTimeout(() => void scan(), 5000);
    });
  } catch (e) {
    console.warn(`No puedo vigilar ${lib}: ${(e as Error).message}`);
  }
}
