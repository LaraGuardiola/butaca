// Mando a distancia por red para teles Samsung (API remote.control, puerto 8002).
// Uso: bun scripts/tv-remote.ts KEY_1 KEY_2 ...   (TV_IP=192.168.1.33 por defecto)
// La primera vez la tele pide permiso; el token se guarda en ~/.config/butaca/tv-token.
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const ip = process.env.TV_IP ?? "192.168.1.33";
const keys = process.argv.slice(2);
const dir = join(homedir(), ".config/butaca");
const tokenFile = join(dir, "tv-token");
const token = (await Bun.file(tokenFile).text().catch(() => "")).trim();
const name = btoa("Butaca");

const url = `wss://${ip}:8002/api/v2/channels/samsung.remote.control?name=${name}${token ? `&token=${token}` : ""}`;
// La tele usa un certificado autofirmado
const ws = new WebSocket(url, { tls: { rejectUnauthorized: false } } as any);
const timeout = setTimeout(() => {
  console.error("✗ Sin respuesta en 60 s. ¿Aceptaste el aviso en la tele?");
  process.exit(1);
}, 60_000);

ws.onmessage = async (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.event === "ms.channel.unauthorized") {
    console.error("✗ La tele ha denegado la conexión");
    process.exit(1);
  }
  if (msg.event !== "ms.channel.connect") return;
  clearTimeout(timeout);
  if (msg.data?.token && msg.data.token !== token) {
    mkdirSync(dir, { recursive: true });
    await Bun.write(tokenFile, String(msg.data.token));
  }
  console.log("✓ Conectado");
  for (const key of keys) {
    ws.send(JSON.stringify({
      method: "ms.remote.control",
      params: { Cmd: "Click", DataOfCmd: key, Option: "false", TypeOfRemote: "SendRemoteKey" },
    }));
    console.log(`  → ${key}`);
    await Bun.sleep(400);
  }
  ws.close();
  process.exit(0);
};
ws.onerror = (e) => {
  console.error("✗ Error de conexión:", (e as ErrorEvent).message ?? e);
  process.exit(1);
};
console.log("Conectando… (si aparece un aviso en la tele, acéptalo)");
