// Modo cine: la bombilla Tapo baja al reproducir, sube un poco en pausa y vuelve a su estado al salir.
// Usa el CLI de python-kasa. Si la bombilla estaba apagada no se toca: no queremos encender luces solas.
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "./config.ts";

type Event = "play" | "pause" | "stop";
type Saved = { on: boolean; brightness: number };

const KASA = Bun.which("kasa") ?? join(homedir(), ".local/bin/kasa");
const DIM = 6;
const PAUSE = 35;
/** "stop" espera un poco: al pasar al siguiente episodio llega "play" enseguida y no queremos parpadeo. */
const STOP_GRACE_MS = 4000;

const saved = new Map<string, Saved>();
let queue: Promise<void> = Promise.resolve();
let stopTimer: Timer | undefined;
let last: Event = "stop";

/** Sin discovery UDP (falla a menudo en la wifi de 2,4 GHz): le decimos qué es la bombilla. Un reintento. */
async function kasa(host: string, ...args: string[]): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const p = Bun.spawn(
      [KASA, "--host", host, "--device-family", "SMART.TAPOBULB", "--encrypt-type", "KLAP", ...args],
      { stdout: "pipe", stderr: "pipe" },
    );
    const out = await new Response(p.stdout).text();
    if ((await p.exited) === 0 && !/Raised error/.test(out)) return out;
    if (attempt >= 1) throw new Error(`kasa ${args.join(" ")} falló en ${host}`);
  }
}

async function readState(host: string): Promise<Saved> {
  const out = await kasa(host, "state");
  return {
    on: /Device state: True/.test(out),
    brightness: Number(out.match(/Brightness \(brightness\): (\d+)/)?.[1] ?? 100),
  };
}

/** Fundido en tres pasos (la bombilla ya suaviza cada cambio). */
async function fade(host: string, from: number, to: number) {
  for (const k of [1, 2, 3]) await kasa(host, "light", "brightness", String(Math.round(from + ((to - from) * k) / 3)));
}

const current = new Map<string, number>();

async function apply(event: Event) {
  for (const host of config.lights) {
    try {
      if (event !== "stop" && !saved.has(host)) {
        const s = await readState(host);
        saved.set(host, s);
        current.set(host, s.brightness);
      }
      const s = saved.get(host);
      if (!s?.on) continue;
      const target = event === "play" ? Math.min(DIM, s.brightness) : event === "pause" ? Math.min(PAUSE, s.brightness) : s.brightness;
      await fade(host, current.get(host) ?? s.brightness, target);
      current.set(host, target);
      if (event === "stop") {
        saved.delete(host);
        current.delete(host);
      }
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
