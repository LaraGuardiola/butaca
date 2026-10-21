export function clock(sec: number) {
  sec = Math.max(0, Math.floor(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

export function runtime(sec: number | null | undefined) {
  if (!sec) return ''
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}

export function quality(q: { width?: number | null; height?: number | null; hdr?: string | null } | null | undefined) {
  if (!q?.width) return []
  const tags = [q.width >= 3200 ? '4K' : q.width >= 1900 ? 'HD' : 'SD']
  if (q.hdr) tags.push(q.hdr === 'DV' ? 'Dolby Vision' : q.hdr)
  return tags
}

// ISO 639-2 → nombre en español
const LANGS: Record<string, string> = {
  spa: 'Español', eng: 'Inglés', jpn: 'Japonés', fre: 'Francés',
  fra: 'Francés', ger: 'Alemán', deu: 'Alemán', ita: 'Italiano',
  por: 'Portugués', kor: 'Coreano', chi: 'Chino', zho: 'Chino',
  rus: 'Ruso', cat: 'Catalán', glg: 'Gallego', eus: 'Euskera',
  baq: 'Euskera', ara: 'Árabe', cze: 'Checo', ces: 'Checo',
  dan: 'Danés', gre: 'Griego', ell: 'Griego', fin: 'Finés',
  fil: 'Filipino', heb: 'Hebreo', hrv: 'Croata', hun: 'Húngaro',
  ind: 'Indonesio', may: 'Malayo', msa: 'Malayo', nob: 'Noruego',
  nor: 'Noruego', dut: 'Neerlandés', nld: 'Neerlandés', pol: 'Polaco',
  rum: 'Rumano', ron: 'Rumano', swe: 'Sueco', tha: 'Tailandés',
  tur: 'Turco', ukr: 'Ucraniano', vie: 'Vietnamita', hin: 'Hindi',
}
const ALIAS: Record<string, string> = { es: 'spa', en: 'eng', ja: 'jpn', fr: 'fre', de: 'ger', it: 'ita', pt: 'por', ko: 'kor', zh: 'chi' }
const EXTRA: [RegExp, string][] = [
  [/\bspain\b|\bcastilian\b|\bespa(ñ|n)a\b/i, 'España'], [/latin|latam|latino/i, 'Latinoamérica'],
  [/brazil|brasil/i, 'Brasil'], [/portugal/i, 'Portugal'], [/simplified/i, 'Simplificado'], [/traditional/i, 'Tradicional'],
  [/\bsdh\b|\bcc\b/i, 'SDH'], [/forced|forzad/i, 'Forzados'], [/\bdub\b/i, 'Doblaje'], [/commentary|comentario/i, 'Comentarios'],
]

export function trackLabel(t: { lang?: string; title?: string; channels?: number }) {
  const code = t.lang ? (ALIAS[t.lang] ?? t.lang) : ''
  const lang = LANGS[code] ?? (t.lang ? t.lang.toUpperCase() : 'Desconocido')
  // Del título de la pista solo nos quedamos con lo que aporta: variante, SDH, forzados…
  const extras = t.title ? EXTRA.filter(([re]) => re.test(t.title!)).map(([, label]) => label) : []
  const ch = !t.channels ? '' : t.channels >= 8 ? ' 7.1' : t.channels >= 6 ? ' 5.1' : ''
  return [lang + ch, ...extras].join(' · ')
}
