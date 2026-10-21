import { createEffect, createResource, createSignal, For, on, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { get } from '../lib/server'
import { focusFirst } from '../lib/nav'
import { go } from '../lib/router'
import Backdrop from '../components/Backdrop'
import Card from '../components/Card'
import Row from '../components/Row'
import { MetaLine, TitleHeading } from '../components/Meta'
import type { Home as HomeData, TitleCard } from '../types'

const ROW_H = 340
const STEP = 400 + 28

export default function Home(props: { active: () => boolean }) {
  const [res, { refetch }] = createResource(() => get<HomeData>('/api/home'))
  // reconcile por id: al refrescar ("Seguir viendo" cambia) no se recrean las tarjetas ni se pierde el foco
  const [data, setData] = createStore<HomeData>({ hero: [], rows: [] })
  const [rowIdx, setRowIdx] = createSignal(0)
  const [featured, setFeatured] = createSignal<TitleCard>()
  const [backdrop, setBackdrop] = createSignal<string | null>()
  let el!: HTMLDivElement
  let first = true

  createEffect(() => {
    const d = res()
    if (!d) return
    setData(reconcile(d, { key: 'id' }))
    if (first) {
      first = false
      requestAnimationFrame(() => focusFirst(el))
    }
  })

  // Al volver del reproductor, refrescar progreso
  createEffect(on(props.active, (a, prev) => a && prev === false && refetch(), { defer: true }))

  // El fondo cambia con un pequeño retardo para no parpadear al recorrer la fila rápido
  let timer: number | undefined
  createEffect(
    on(featured, (t) => {
      clearTimeout(timer)
      timer = setTimeout(() => setBackdrop(t?.backdrop), 280) as unknown as number
    }),
  )

  const open = (t: TitleCard) => (t.mediaId ? go({ name: 'player', mediaId: t.mediaId }) : go({ name: 'title', id: t.id }))

  return (
    <div class="home" ref={el}>
      <Backdrop src={backdrop()} dim="home" />
      <div class="brand brand-corner">butaca</div>

      {/* keyed: se remonta en cada cambio para animar la entrada */}
      <Show when={featured()} keyed>
        {(t) => (
          <div class="hero-info">
            <TitleHeading t={t} />
            <Show when={t.subtitle}>
              <div class="hero-sub">{t.subtitle}</div>
            </Show>
            <MetaLine t={t} />
            <Show when={t.overview}>
              <p class="overview clamp-3">{t.overview}</p>
            </Show>
          </div>
        )}
      </Show>

      <Show when={res.error}>
        <div class="empty">No he podido cargar la biblioteca: {String(res.error)}</div>
      </Show>
      <Show when={res() && !data.rows.length}>
        <div class="empty">La biblioteca está vacía. Añade vídeos a las carpetas de butaca.config.json.</div>
      </Show>

      <div class="rows-viewport">
        <div class="rows" style={{ transform: `translateY(${-rowIdx() * ROW_H}px)` }}>
          <For each={data.rows}>
            {(row, r) => (
              <div class="home-row" classList={{ passed: r() < rowIdx() }}>
                <Row title={row.title} items={row.items} step={STEP}>
                  {(t, _i, focused) => (
                    <Card
                      image={t.card}
                      name={t.name}
                      logo={t.logo}
                      subtitle={t.subtitle}
                      progress={t.progress}
                      onFocus={() => {
                        focused()
                        setRowIdx(r())
                        setFeatured(t)
                      }}
                      onClick={() => open(t)}
                    />
                  )}
                </Row>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
