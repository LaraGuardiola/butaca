// Lo que devuelve el servidor (server/src/api.ts)
export type TitleCard = {
  id: number
  kind: 'movie' | 'show'
  name: string
  year: number | null
  overview: string | null
  tagline: string | null
  genres: string[]
  rating: number | null
  card: string | null
  backdrop: string | null
  logo: string | null
  poster: string | null
  // Solo en "Seguir viendo"
  mediaId?: number
  progress?: number
  subtitle?: string | null
}

export type Home = { hero: TitleCard[]; rows: { id: string; title: string; items: TitleCard[] }[] }

export type Episode = {
  id: number
  season: number | null
  episode: number | null
  name: string
  overview: string | null
  still: string | null
  duration: number | null
  progress: number
}

export type TitleDetail = TitleCard & {
  quality: { width: number; height: number; hdr: string | null } | null
  seasons: { season: number; episodes: Episode[] }[]
  play: { mediaId: number; label: string } | null
}

export type Track = { index: number; codec: string; lang?: string; title?: string; channels?: number; forced?: boolean; default: boolean }

export type MediaInfo = {
  id: number
  titleId: number
  titleName: string
  kind: 'movie' | 'show'
  logo: string | null
  backdrop: string | null
  name: string | null
  label: string
  duration: number
  width: number
  height: number
  hdr: string | null
  stream: string
  /** Audio no soportado convertido al vuelo; se pide con ?t=segundos */
  live: string
  mode: 'direct' | 'live' | 'none'
  directPlay: boolean
  unsupported: string[]
  position: number
  audio: (Track & { order: number; supported: boolean })[]
  subs: (Track & { url: string })[]
  defaultSub: number | null
  next: { id: number; name: string | null; label: string; still: string | null } | null
  intro: { start: number; end: number } | null
  trick: { interval: number; w: number; h: number; cols: number; rows: number; urls: string[] } | null
}
