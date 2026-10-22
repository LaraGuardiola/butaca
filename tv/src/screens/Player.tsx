import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { get, post, url } from '../lib/server'
import { onKey } from '../lib/keys'
import { navHandler, pushScope } from '../lib/nav'
import { back, replace } from '../lib/router'
import { createPlayer, type Player as Engine, type PlayerEvents } from '../lib/player'
import { activeCues, parseVtt, type Cue } from '../lib/vtt'
import { clock, trackLabel } from '../lib/format'
import type { MediaInfo } from '../types'

const OSD_MS = 4000
const SAVE_MS = 10_000
const NEXT_CARD_SEC = 40
const THUMB_W = 384
const THUMB_H = 216

/** La bombilla: el servidor atenúa al reproducir y restaura al salir. */
const ambient = (event: 'play' | 'pause' | 'stop') => post('/api/ambient', { event })

export default function Player(props: { mediaId: number; startFromZero?: boolean }) {
  const [m, setM] = createSignal<MediaInfo>()
  const [t, setT] = createSignal(0)
  const [dur, setDur] = createSignal(0)
  const [paused, setPaused] = createSignal(false)
  const [buffering, setBuffering] = createSignal(true)
  const [error, setError] = createSignal<string>()
  const [osd, setOsd] = createSignal(true)
  const [scrub, setScrub] = createSignal<number | null>(null)
  const [panel, setPanel] = createSignal(false)
  const [audio, setAudio] = createSignal(0)
  const [sub, setSub] = createSignal<number | null>(null)
  const [cues, setCues] = createSignal<Cue[]>([])

  let engine: Engine | undefined
  /** Si el stream es el convertido al vuelo (audio DTS/TrueHD) */
  let live = false
  let osdTimer: number | undefined
  let scrubTimer: number | undefined
  let scrubHits = 0
  let closePanel: (() => void) | undefined
  let panelEl!: HTMLDivElement
  let finished = false
  /** Hasta que el vídeo arranca, ignoramos pausa/seek: el OK que abre el reproductor puede llegar de rebote. */
  let ready = false

  const shown = () => scrub() ?? t()
  const nextVisible = createMemo(() => !!m()?.next && dur() > 0 && t() > dur() - NEXT_CARD_SEC && !panel())
  const introVisible = createMemo(() => {
    const i = m()?.intro
    return !!i && dur() > 0 && t() >= i.start && t() < i.end - 2 && !panel() && scrub() == null
  })
  /** Miniatura de la hoja de sprites para el instante que se está buscando. */
  const thumb = createMemo(() => {
    const tp = m()?.trick
    const at = scrub()
    if (!tp || at == null || !dur()) return null
    const per = tp.cols * tp.rows
    const idx = Math.floor(at / tp.interval)
    const sheet = Math.min(tp.urls.length - 1, Math.floor(idx / per))
    const cell = idx - sheet * per
    const x = Math.max(96, Math.min(1824 - THUMB_W, 96 + (at / dur()) * 1728 - THUMB_W / 2))
    return {
      x,
      url: url(tp.urls[sheet])!,
      size: `${tp.cols * THUMB_W}px ${tp.rows * THUMB_H}px`,
      pos: `${-(cell % tp.cols) * THUMB_W}px ${-Math.floor(cell / tp.cols) * THUMB_H}px`,
    }
  })
  const lines = createMemo(() => activeCues(cues(), t()).flatMap((c) => c.lines))

  function showOsd(stay = false) {
    setOsd(true)
    clearTimeout(osdTimer)
    if (!stay) osdTimer = setTimeout(() => !paused() && !panel() && setOsd(false), OSD_MS) as unknown as number
  }

  function save() {
    const info = m()
    if (info && engine && dur() > 0) post('/api/progress', { mediaId: info.id, position: engine.time(), duration: dur() })
  }

  async function loadSub(index: number | null) {
    setSub(index)
    setCues([])
    const track = m()?.subs.find((s) => s.index === index)
    if (!track) return
    try {
      const r = await fetch(url(track.url)!)
      if (sub() === index) setCues(parseVtt(await r.text()))
    } catch {
      /* sin subtítulos */
    }
  }

  function togglePause() {
    if (!engine || !ready) return
    if (engine.isPaused()) engine.play()
    else engine.pause()
    // El estado lo manda el motor, no nuestra suposición
    setPaused(engine.isPaused())
    ambient(paused() ? 'pause' : 'play')
    showOsd(paused())
  }

  function skipIntro() {
    const i = m()?.intro
    if (!engine || !i) return
    engine.seek(i.end)
    setT(i.end)
  }

  /** Avance/retroceso acumulativo: cuanto más rato mantienes la flecha, más rápido. */
  function nudge(dir: 1 | -1) {
    if (!engine || !ready || !dur()) return
    scrubHits++
    const step = 10 * Math.min(6, 1 + Math.floor(scrubHits / 4))
    const target = Math.max(0, Math.min(dur() - 2, (scrub() ?? t()) + dir * step))
    setScrub(target)
    showOsd(true)
    clearTimeout(scrubTimer)
    scrubTimer = setTimeout(() => {
      engine!.seek(target)
      setT(target)
      setScrub(null)
      scrubHits = 0
      showOsd()
    }, 650) as unknown as number
  }

  function playNext() {
    const next = m()?.next
    if (!next) return back()
    save()
    finished = true
    replace({ name: 'player', mediaId: next.id, startFromZero: true })
  }

  const events: PlayerEvents = {
    onTime: (s) => scrub() == null && setT(s),
    onBuffering: setBuffering,
    onEnd: () => playNext(),
    onError: (e) => setError(e),
  }

  /** Arranca el motor: directo del fichero o, si el audio no lo entiende la tele, convertido al vuelo. */
  async function start(asLive: boolean, at: number) {
    const info = m()!
    engine?.destroy()
    live = asLive
    engine = asLive
      ? createPlayer(events, {
          duration: info.duration,
          startOf: (t) => get<{ t: number }>(`/api/live-start/${info.id}?t=${t.toFixed(2)}`).then((r) => r.t),
        })
      : createPlayer(events)
    await engine.load(url(asLive ? info.live : info.stream)!, at, { uhd: info.width > 2000 })
  }

  /** Elegir audio: si la pista no la decodifica la tele, pasamos al stream convertido en el mismo punto. */
  async function pickAudio(order: number, supported: boolean) {
    setAudio(order)
    if (supported || live) return engine?.setAudio(order)
    const at = engine?.time() ?? t()
    ready = false
    try {
      await start(true, at)
      engine!.setAudio(order)
      setPaused(false)
      ready = true
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function openPanel() {
    setPanel(true)
    showOsd(true)
    requestAnimationFrame(() => (closePanel = pushScope(panelEl)))
  }
  function hidePanel() {
    closePanel?.()
    closePanel = undefined
    setPanel(false)
    showOsd()
  }

  onMount(async () => {
    document.documentElement.classList.add('playing')

    const offKeys = onKey((a) => {
      if (panel()) {
        // Arriba/abajo recorren las pistas; solo Atrás cierra el panel
        if (a === 'back') hidePanel()
        else navHandler(a)
        return true
      }
      switch (a) {
        case 'back':
        case 'stop':
          save()
          back()
          break
        case 'ok':
          if (introVisible()) skipIntro()
          else if (nextVisible()) playNext()
          else togglePause()
          break
        case 'playpause':
          togglePause()
          break
        case 'play':
          if (paused()) togglePause()
          break
        case 'pause':
          if (!paused()) togglePause()
          break
        case 'left':
        case 'rw':
          nudge(-1)
          break
        case 'right':
        case 'ff':
          nudge(1)
          break
        case 'up':
          openPanel()
          break
        case 'down':
          showOsd()
          break
      }
      return true
    })

    const saver = setInterval(() => !paused() && save(), SAVE_MS)
    const onVisibility = () => {
      if (document.hidden) {
        save()
        engine?.suspend()
        ambient('stop')
      } else {
        engine?.resume()
        if (!paused()) ambient('play')
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    onCleanup(() => {
      offKeys()
      clearInterval(saver)
      clearTimeout(osdTimer)
      clearTimeout(scrubTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      if (!finished) save()
      engine?.destroy()
      ambient('stop')
      document.documentElement.classList.remove('playing')
    })

    try {
      const info = await get<MediaInfo>(`/api/media/${props.mediaId}`)
      setM(info)
      setAudio(info.audio.findIndex((a) => a.default) >= 0 ? info.audio.findIndex((a) => a.default) : 0)
      void loadSub(info.defaultSub)

      if (info.mode === 'none') throw new Error('Formato de vídeo no soportado')
      await start(info.mode === 'live', props.startFromZero ? 0 : info.position)
      setDur(engine!.duration() || info.duration)
      setBuffering(false)
      setPaused(engine!.isPaused())
      ready = true
      showOsd()
      ambient('play')
      // Precarga de las hojas de miniaturas para que el avance sea instantáneo
      for (const u of info.trick?.urls ?? []) new Image().src = url(u)!
    } catch (e) {
      setError((e as Error).message)
    }
  })

  return (
    <div class="player" classList={{ 'osd-on': osd(), 'panel-open': panel() }}>
      <Show when={buffering() && !error()}>
        <div class="spinner" />
      </Show>

      <div class="subtitles">
        <For each={lines()}>{(l) => <div class="sub-line" innerHTML={l.replace(/\n/g, '<br>')} />}</For>
      </div>

      <Show when={m()}>
        {(info) => (
          <>
            <div class="osd osd-top">
              <div class="osd-title">{info().titleName}</div>
              <Show when={info().label}>
                <div class="osd-episode">
                  {info().label}
                  {info().name ? ` · ${info().name}` : ''}
                </div>
              </Show>
            </div>

            <Show when={paused() && !panel()}>
              <div class="pause-badge">
                <span class="icon-pause-big" />
              </div>
            </Show>

            <div class="osd osd-bottom">
              <Show when={thumb()}>
                {(th) => (
                  <div class="trick" style={{ transform: `translateX(${th().x - 96}px)` }}>
                    <div
                      class="trick-img"
                      style={{ 'background-image': `url("${th().url}")`, 'background-size': th().size, 'background-position': th().pos }}
                    />
                    <div class="trick-time">{clock(scrub()!)}</div>
                  </div>
                )}
              </Show>
              <div class="timeline">
                <div class="timeline-fill" style={{ width: `${dur() ? (shown() / dur()) * 100 : 0}%` }}>
                  <div class="timeline-thumb" classList={{ scrubbing: scrub() != null }} />
                </div>
              </div>
              <div class="osd-times">
                <span>{clock(shown())}</span>
                <span class="osd-hint">▲ Audio y subtítulos · ◀ ▶ Avanzar</span>
                <span>-{clock(dur() - shown())}</span>
              </div>
            </div>

            <Show when={introVisible()}>
              <div class="skip-intro">Saltar intro</div>
            </Show>

            <Show when={nextVisible()}>
              <div class="next-card">
                <div class="next-label">Siguiente episodio · OK</div>
                <div class="next-name">
                  {info().next!.label} {info().next!.name ?? ''}
                </div>
                <div class="next-bar">
                  <div style={{ width: `${Math.min(100, ((t() - (dur() - NEXT_CARD_SEC)) / NEXT_CARD_SEC) * 100)}%` }} />
                </div>
              </div>
            </Show>

            <div class="track-panel" classList={{ open: panel() }} ref={panelEl}>
              <div class="track-col" data-nav-group data-scroll>
                <h3>Audio</h3>
                <For each={info().audio}>
                  {(a) => (
                    <button
                      class="track"
                      classList={{ selected: audio() === a.order }}
                      data-focusable
                      data-autofocus={audio() === a.order ? '' : undefined}
                      tabIndex={-1}
                      onClick={() => void pickAudio(a.order, a.supported)}
                    >
                      {trackLabel(a)}
                    </button>
                  )}
                </For>
              </div>
              <div class="track-col" data-nav-group data-scroll>
                <h3>Subtítulos</h3>
                <button
                  class="track"
                  classList={{ selected: sub() == null }}
                  data-focusable
                  tabIndex={-1}
                  onClick={() => loadSub(null)}
                >
                  Desactivados
                </button>
                <For each={info().subs}>
                  {(s) => (
                    <button
                      class="track"
                      classList={{ selected: sub() === s.index }}
                      data-focusable
                      tabIndex={-1}
                      onClick={() => loadSub(s.index)}
                    >
                      {trackLabel(s)}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </>
        )}
      </Show>

      <Show when={error()}>
        <div class="player-error">
          <h2>No se puede reproducir</h2>
          <p>{error()}</p>
          <Show when={m()?.unsupported.length}>
            <p>La tele no soporta: {m()!.unsupported.join(', ')}.</p>
          </Show>
          <p class="dim">Pulsa Atrás para volver</p>
        </div>
      </Show>
    </div>
  )
}
