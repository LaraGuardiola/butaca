"""Ayudante del modo cine: mantiene abierta la conexión con las bombillas Tapo y hace fundidos suaves.

Las Tapo no admiten transiciones de brillo y lanzar el CLI de kasa cuesta ~1 s por orden, así que
el fundido se veía a escalones. Con la conexión abierta cada orden tarda ~0,1 s: mandamos el brillo
interpolado en el tiempo, de 1 en 1 %, y la bombilla suaviza el resto.

Protocolo por stdin/stdout, una línea JSON por mensaje:
  {"id": 1, "op": "state", "host": "192.168.1.34"}            -> {"id": 1, "on": true, "brightness": 47}
  {"id": 2, "op": "fade", "host": "...", "to": 6, "ms": 2500} -> {"id": 2, "ok": true} al terminar
Un fundido nuevo en la misma bombilla corta el anterior y parte del brillo actual.
"""

import asyncio
import json
import sys
import time

from kasa import Device, DeviceConfig, DeviceConnectionParameters, DeviceEncryptionType, DeviceFamily

devices: dict[str, Device] = {}
fades: dict[str, asyncio.Task] = {}
level: dict[str, int] = {}


async def device(host: str) -> Device:
    if host not in devices:
        # Sin discovery UDP (falla a menudo en la wifi de 2,4 GHz): le decimos qué es la bombilla
        conn = DeviceConnectionParameters(DeviceFamily.SmartTapoBulb, DeviceEncryptionType.Klap)
        devices[host] = await Device.connect(config=DeviceConfig(host, connection_type=conn))
    return devices[host]


async def retry(host: str, fn):
    """Un reintento con conexión nueva: la sesión KLAP caduca si pasa mucho rato sin usarse."""
    try:
        return await fn(await device(host))
    except Exception:
        old = devices.pop(host, None)
        if old:
            try:
                await old.disconnect()
            except Exception:
                pass
        return await fn(await device(host))


async def state(host: str) -> dict:
    async def read(d: Device):
        await d.update()
        return {"on": d.is_on, "brightness": d.modules["Light"].brightness}

    s = await retry(host, read)
    level[host] = s["brightness"]
    return s


async def fade(host: str, to: int, ms: int) -> None:
    start = level.get(host)
    if start is None:
        start = (await state(host))["brightness"]
    t0 = time.monotonic()
    dur = max(ms, 1) / 1000
    while True:
        k = min(1.0, (time.monotonic() - t0) / dur)
        ease = k * k * (3 - 2 * k)  # suave al principio y al final
        b = max(1, round(start + (to - start) * ease))
        if b != level.get(host):
            await retry(host, lambda d: d.modules["Light"].set_brightness(b))
            level[host] = b
        if k >= 1:
            return
        await asyncio.sleep(0.02)


def reply(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


async def handle(msg: dict) -> None:
    mid, host = msg.get("id"), msg["host"]
    try:
        if msg["op"] == "state":
            reply({"id": mid, **await state(host)})
        elif msg["op"] == "fade":
            prev = fades.get(host)
            if prev and not prev.done():
                prev.cancel()
            task = fades[host] = asyncio.create_task(fade(host, int(msg["to"]), int(msg.get("ms", 2500))))
            try:
                await task
                reply({"id": mid, "ok": True})
            except asyncio.CancelledError:
                reply({"id": mid, "ok": True, "cancelled": True})
    except Exception as e:
        reply({"id": mid, "error": str(e) or type(e).__name__})


async def main() -> None:
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    while line := await reader.readline():
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        asyncio.create_task(handle(msg))
    for d in devices.values():
        await d.disconnect()


asyncio.run(main())
