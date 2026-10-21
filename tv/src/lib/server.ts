// Localiza el servidor Butaca: el guardado, el de compilación o, si el PC cambió de IP, barriendo la subred.
declare const __BUTACA_SERVER__: string

const KEY = 'butaca.server'
let base = ''

export const url = (path: string | null | undefined) => (path ? base + path : undefined)

async function ping(origin: string, ms = 1500): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(`${origin}/api/ping`, { signal: ctrl.signal })
    return r.ok && (await r.json()).app === 'butaca'
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

function stored(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}

export async function connect(onStatus: (s: string) => void): Promise<boolean> {
  // Previsualización en el navegador: la app la sirve el propio servidor
  if (location.protocol.startsWith('http') && !import.meta.env.DEV) {
    base = location.origin
    return true
  }
  const known = [stored(), __BUTACA_SERVER__].filter(Boolean) as string[]
  for (const origin of known) if (await ping(origin)) return use(origin)

  const u = new URL(__BUTACA_SERVER__)
  const prefix = u.hostname.split('.').slice(0, 3).join('.')
  onStatus(`Buscando Butaca en ${prefix}.x…`)
  for (let start = 1; start < 255; start += 32) {
    const batch = Array.from({ length: Math.min(32, 255 - start) }, (_, i) => `http://${prefix}.${start + i}:${u.port}`)
    const found = await Promise.all(batch.map(async (o) => ((await ping(o, 1200)) ? o : null)))
    const hit = found.find(Boolean)
    if (hit) return use(hit)
  }
  return false
}

function use(origin: string) {
  base = origin
  try { localStorage.setItem(KEY, origin) } catch { /* sin almacenamiento */ }
  return true
}

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(base + path)
  if (!r.ok) throw new Error(`${r.status} ${path}`)
  return r.json()
}

export function post(path: string, body: unknown) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {})
}
