import { createEffect, createResource, createSignal, For, on, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { get, url } from '../lib/server'
import { focusFirst } from '../lib/nav'
import { go } from '../lib/router'
import { quality, runtime } from '../lib/format'
import Backdrop from '../components/Backdrop'
import Row from '../components/Row'
import { MetaLine, TitleHeading } from '../components/Meta'
import type { Episode, TitleDetail } from '../types'

const EP_STEP = 400 + 28

export default function Title(props: { id: number; active: () => boolean }) {
  const [res, { refetch }] = createResource(() => props.id, (id) => get<TitleDetail>(`/api/titles/${id}`))
  const [t, setT] = createStore<{ v?: TitleDetail }>({})
  const [season, setSeason] = createSignal<number>()
  const [inEpisodes, setInEpisodes] = createSignal(false)
  /** Último episodio enfocado: los botones de arriba actúan sobre él (reanudar o empezar de cero). */
  const [picked, setPicked] = createSignal<Episode>()
  let el!: HTMLDivElement
  let first = true

  createEffect(() => {
    const d = res()
    if (!d) return
    setT('v', reconcile(d, { key: 'id' }))
    if (first) {
      first = false
      // Abrir en la temporada del episodio que toca ver
      const target = d.seasons.find((s) => s.episodes.some((e) => e.id === d.play?.mediaId))
      setSeason(target?.season ?? d.seasons[0]?.season)
      requestAnimationFrame(() => focusFirst(el))
    }
  })
  createEffect(on(props.active, (a, prev) => a && prev === false && refetch(), { defer: true }))

  const episodes = () => t.v?.seasons.find((s) => s.season === season())?.episodes ?? []
  const isShow = () => t.v?.kind === 'show'

  const playEpisode = (e: Episode) => go({ name: 'player', mediaId: e.id, startFromZero: e.progress >= 1 })

  /** Qué hacen los botones: el episodio elegido o, si no hay, lo que propone el servidor. */
  const action = () => {
    const e = picked()
    if (e) {
      const resume = e.progress > 0 && e.progress < 1
      const ep = e.episode != null ? ` T${e.season ?? 1}:E${e.episode}` : ''
      return { mediaId: e.id, label: `${resume ? 'Reanudar' : 'Reproducir'}${ep}`, resume, fromZero: e.progress >= 1 }
    }
    const p = t.v?.play
    if (!p) return null
    return { mediaId: p.mediaId, label: p.label, resume: p.label.startsWith('Reanudar'), fromZero: false }
  }

  return (
    <div class="title-screen" ref={el} classList={{ 'in-episodes': inEpisodes() }}>
      <Backdrop src={t.v?.backdrop} dim="title" />
      <Show when={t.v}>
        {(d) => (
          <>
            <div class="title-info">
              <TitleHeading t={d()} />
              <MetaLine t={d()} extra={quality(d().quality)} />
              <Show when={d().tagline}>
                <p class="tagline">{d().tagline}</p>
              </Show>
              <Show when={d().overview}>
                <p class="overview clamp-4">{d().overview}</p>
              </Show>
              <div class="actions" data-nav-group>
                <Show when={action()}>
                  {(p) => (
                    <button
                      class="btn btn-primary"
                      data-focusable
                      data-autofocus
                      tabIndex={-1}
                      onFocus={() => setInEpisodes(false)}
                      onClick={() => go({ name: 'player', mediaId: p().mediaId, startFromZero: p().fromZero })}
                    >
                      <span class="icon-play" /> {p().label}
                    </button>
                  )}
                </Show>
                <Show when={action()?.resume}>
                  <button
                    class="btn"
                    data-focusable
                    tabIndex={-1}
                    onFocus={() => setInEpisodes(false)}
                    onClick={() => go({ name: 'player', mediaId: action()!.mediaId, startFromZero: true })}
                  >
                    Desde el principio
                  </button>
                </Show>
              </div>
            </div>

            <Show when={isShow()}>
              <div class="episodes">
                <Show when={d().seasons.length > 1}>
                  <div class="season-tabs" data-nav-group>
                    <For each={d().seasons}>
                      {(s) => (
                        <button
                          class="tab"
                          classList={{ selected: s.season === season() }}
                          data-focusable
                          tabIndex={-1}
                          onFocus={() => {
                            setInEpisodes(true)
                            setSeason(s.season)
                          }}
                        >
                          {s.season === 0 ? 'Especiales' : `Temporada ${s.season}`}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={d().seasons.length === 1}>
                  <h2 class="row-title">{season() === 0 ? 'Episodios' : `Temporada ${season()}`}</h2>
                </Show>
                {/* keyed por temporada: al cambiarla la fila vuelve al principio */}
                <Show when={season()} keyed>
                  {(_s) => (
                    <Row items={episodes()} step={EP_STEP} class="episode-row">
                      {(e, _i, focused) => (
                        <button
                          class="episode"
                          data-focusable
                          tabIndex={-1}
                          onFocus={() => {
                            focused()
                            setInEpisodes(true)
                            setPicked(e)
                          }}
                          onClick={() => playEpisode(e)}
                        >
                          <div class="episode-thumb">
                            <Show when={e.still}>
                              <img src={url(e.still)} alt="" loading="lazy" />
                            </Show>
                            <span class="episode-num">{e.episode}</span>
                            <Show when={e.progress > 0}>
                              <div class="progress card-progress">
                                <div style={{ width: `${Math.min(100, e.progress * 100)}%` }} />
                              </div>
                            </Show>
                          </div>
                          <div class="episode-name">{e.name}</div>
                          <div class="episode-meta">{runtime(e.duration)}</div>
                          <Show when={e.overview}>
                            <p class="episode-overview clamp-2">{e.overview}</p>
                          </Show>
                        </button>
                      )}
                    </Row>
                  )}
                </Show>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}
