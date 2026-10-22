// Modo cine: la bombilla Tapo baja al reproducir, sube un poco en pausa y vuelve a su estado al salir.
// Habla con lights.py (python-kasa con la conexión abierta) para que el fundido sea continuo.
// Si la bombilla estaba apagada no se toca: no queremos encender luces solas.
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { config } from "./config.ts";

type Event = "play" | "pause" | "stop";
type Saved = { on: boolean; brightness: number };
type Reply = { id: number; error?: string; on?: boolean; brightness?: number };

const DIM = 6;
const PAUSE = 35;
const FADE_MS: Record<Event, number> = { play: 3000, pause: 1200, stop: 2500 };
/** "stop" espera un poco: al pasar al siguiente episodio llega "play" enseguida y no queremos parpadeo. */
const STOP_GRACE_MS = 4000;

const saved = new Map<string, Saved>();
let queue: Promise<void> = Promise.resolve();
let stopTimer: Timer | undefined;
let last: Event = "stop";

/** El Python del entorno de uv donde vive python-kasa (el CLI `kasa` es un enlace a ese entorno). */
function kasaPython() {
  const kasa = Bun.which("kasa") ?? join(homedir(), ".local/bin/kasa");
  try {
    return join(dirname(realpathSync(kasa)), "python");
  } catch {
    return "python3";
  }
}

let helper: ReturnType<typeof spawnHelper> | null = null;

function spawnHelper() {
  const proc = Bun.spawn([kasaPython(), join(import.meta.dir, "lights.py")], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  const pending = new Map<number, (r: Reply) => void>();
  let seq = 0;
  void (async () => {
    let buf = "";
    for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const r = JSON.parse(buf.slice(0, nl)) as Reply;
        buf = buf.slice(nl + 1);
        pending.get(r.id)?.(r);
        pending.delete(r.id);
      }
    }
  })();
  void proc.exited.then(() => {
    helper = null;
    for (const done of pending.values()) done({ id: -1, error: "el ayudante de luces se ha cerrado" });
  });
  return {
    send(msg: Record<string, unknown>) {
      const id = ++seq;
      return new Promise<Reply>((resolve) => {
        pending.set(id, resolve);
        proc.stdin.write(JSON.stringify({ id, ...msg }) + "\n");
        proc.stdin.flush();
      }).then((r) => {
        if (r.error) throw new Error(r.error);
        return r;
      });
    },
  };
}

const send = (msg: Record<string, unknown>) => (helper ??= spawnHelper()).send(msg);

async function apply(event: Event) {
  for (const host of config.lights) {
    try {
      if (event !== "stop" && !saved.has(host)) {
        const r = await send({ op: "state", host });
        saved.set(host, { on: !!r.on, brightness: r.brightness ?? 100 });
      }
      const s = saved.get(host);
      if (!s?.on) continue;
      const target = event === "play" ? Math.min(DIM, s.brightness) : event === "pause" ? Math.min(PAUSE, s.brightness) : s.brightness;
      if (event === "stop") saved.delete(host);
      // Sin await: el fundido corre en segundo plano y uno nuevo lo corta
      send({ op: "fade", host, to: target, ms: FADE_MS[event] }).catch((e) => console.warn(`luz ${host}: ${e.message}`));
    } catch (e) {
      console.warn(`luz ${host}: ${(e as Error).message}`);
    }
  }
}

export function ambient(event: Event) {
  if (!config.lights.length) return;
  clearTimeout(stopTimer);
  const run = (e: Event) => {
    if (e === last) return;
    last = e;
    queue = queue.then(() => apply(e));
  };
  if (event === "stop") stopTimer = setTimeout(() => run("stop"), STOP_GRACE_MS);
  else run(event);
}
