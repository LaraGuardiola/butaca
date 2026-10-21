// WebVTT mínimo: los pintamos nosotros para que se vean igual en la tele y en el PC.
export type Cue = { start: number; end: number; lines: string[] }

const ts = (s: string) => {
  const p = s.trim().split(':').map(Number)
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]
}

export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = []
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const rows = block.split('\n')
    const i = rows.findIndex((r) => r.includes('-->'))
    if (i < 0) continue
    const [a, b] = rows[i].split('-->')
    const lines = rows
      .slice(i + 1)
      .map((l) => l.replace(/\{[^}]*\}/g, '').replace(/<(?!\/?i>)[^>]+>/g, '').replace(/\\N/g, '\n').trim())
      .filter(Boolean)
    if (lines.length) cues.push({ start: ts(a), end: ts(b.trim().split(/\s/)[0]), lines })
  }
  return cues.sort((x, y) => x.start - y.start)
}

/** Cues activas en `t` (puede haber varias a la vez en subtítulos ASS convertidos). */
export function activeCues(cues: Cue[], t: number): Cue[] {
  let lo = 0
  let hi = cues.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= t) lo = mid + 1
    else hi = mid
  }
  const out: Cue[] = []
  for (let i = lo - 1; i >= 0 && i >= lo - 20; i--) if (cues[i].end > t) out.unshift(cues[i])
  return out
}
