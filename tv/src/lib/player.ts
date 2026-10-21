// Reproductor con dos motores: AVPlay (hardware de la tele: HEVC, HDR, 4K, MKV) y <video> para el PC.
declare const webapis: any

export type PlayerEvents = {
  onTime?: (sec: number) => void
  onBuffering?: (on: boolean) => void
  onEnd?: () => void
  onError?: (msg: string) => void
}

export interface Player {
  load(src: string, startSec: number, opts: { uhd: boolean }): Promise<void>
  play(): void
  pause(): void
  seek(sec: number): void
  time(): number
  duration(): number
  /** `order`: posición entre las pistas de audio, igual que en ffprobe. */
  setAudio(order: number): void
  suspend(): void
  resume(): void
  destroy(): void
}

export const hasAvplay = () => typeof webapis !== 'undefined' && !!webapis.avplay

class AvPlayer implements Player {
  private av = webapis.avplay
  private dur = 0
  private t = 0
  private ev: PlayerEvents

  constructor(ev: PlayerEvents) {
    this.ev = ev
    // AVPlay pinta en este <object>; fuera de la tele el navegador mostraría "plugin not supported"
    if (!document.getElementById('avplayer')) {
      const obj = document.createElement('object')
      obj.id = 'avplayer'
      obj.type = 'application/avplayer'
      document.body.prepend(obj)
    }
  }

  load(src: string, startSec: number, opts: { uhd: boolean }) {
    const av = this.av
    av.open(src)
    av.setDisplayRect(0, 0, 1920, 1080)
    av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX')
    if (opts.uhd) av.setStreamingProperty('SET_MODE_4K', 'TRUE')
    av.setListener({
      onbufferingstart: () => this.ev.onBuffering?.(true),
      onbufferingcomplete: () => this.ev.onBuffering?.(false),
      oncurrentplaytime: (ms: number) => {
        this.t = ms / 1000
        this.ev.onTime?.(this.t)
      },
      onstreamcompleted: () => this.ev.onEnd?.(),
      onerror: (e: string) => this.ev.onError?.(String(e)),
    })
    return new Promise<void>((resolve, reject) => {
      av.prepareAsync(
        () => {
          this.dur = av.getDuration() / 1000
          av.setSilentSubtitle(true) // los subtítulos los pintamos nosotros
          const go = () => {
            av.play()
            resolve()
          }
          if (startSec > 1) {
            this.t = startSec
            av.seekTo(startSec * 1000, go, go)
          } else go()
        },
        (e: unknown) => reject(new Error(String(e))),
      )
    })
  }
  play() {
    this.av.play()
  }
  pause() {
    this.av.pause()
  }
  seek(sec: number) {
    this.t = Math.max(0, Math.min(sec, this.dur - 1))
    this.av.seekTo(Math.round(this.t * 1000))
  }
  time() {
    return this.t
  }
  duration() {
    return this.dur
  }
  setAudio(order: number) {
    const audio = (this.av.getTotalTrackInfo() as any[]).filter((t) => t.type === 'AUDIO')
    if (audio[order]) this.av.setSelectTrack('AUDIO', audio[order].index)
  }
  suspend() {
    this.av.suspend()
  }
  resume() {
    this.av.restore()
  }
  destroy() {
    try {
      this.av.stop()
      this.av.close()
    } catch { /* ya cerrado */ }
  }
}

class HtmlPlayer implements Player {
  private v: HTMLVideoElement

  constructor(ev: PlayerEvents) {
    const v = (this.v = document.createElement('video'))
    v.id = 'html-video'
    document.body.prepend(v)
    v.ontimeupdate = () => ev.onTime?.(v.currentTime)
    v.onwaiting = () => ev.onBuffering?.(true)
    v.onplaying = () => ev.onBuffering?.(false)
    v.onended = () => ev.onEnd?.()
    v.onerror = () => ev.onError?.(v.error?.message || `código ${v.error?.code}`)
  }
  async load(src: string, startSec: number) {
    this.v.src = src
    this.v.currentTime = startSec
    await this.v.play()
  }
  play() {
    void this.v.play()
  }
  pause() {
    this.v.pause()
  }
  seek(sec: number) {
    this.v.currentTime = sec
  }
  time() {
    return this.v.currentTime
  }
  duration() {
    return this.v.duration || 0
  }
  setAudio(order: number) {
    const tracks = (this.v as any).audioTracks
    if (tracks) for (let i = 0; i < tracks.length; i++) tracks[i].enabled = i === order
  }
  suspend() {
    this.v.pause()
  }
  resume() {}
  destroy() {
    this.v.pause()
    this.v.removeAttribute('src')
    this.v.load()
    this.v.remove()
  }
}

export function createPlayer(ev: PlayerEvents): Player {
  return hasAvplay() ? new AvPlayer(ev) : new HtmlPlayer(ev)
}
