import { createSignal, For, Match, onMount, Show, Switch } from 'solid-js'
import { connect } from './lib/server'
import { exitApp, installKeys, onKey } from './lib/keys'
import { navHandler } from './lib/nav'
import { back, stack, top } from './lib/router'
import Home from './screens/Home'
import Title from './screens/Title'
import Player from './screens/Player'

export default function App() {
  const [ready, setReady] = createSignal(false)
  const [status, setStatus] = createSignal('Conectando con Butaca…')

  onMount(async () => {
    installKeys()
    // Handler base: navegación y "atrás". Las pantallas apilan los suyos por encima.
    onKey((a) => {
      if (a === 'back') {
        if (!back()) exitApp()
        return true
      }
      return navHandler(a)
    })
    if (await connect(setStatus)) setReady(true)
    else setStatus('No encuentro el servidor. ¿Está Butaca encendido en el PC?')
  })

  return (
    <Show when={ready()} fallback={<Splash text={status()} />}>
      <For each={stack()}>
        {(entry) => {
          const active = () => top() === entry
          const r = entry.route
          return (
            <div class="screen" classList={{ hidden: !active() }}>
              <Switch>
                <Match when={r.name === 'home'}>
                  <Home active={active} />
                </Match>
                <Match when={r.name === 'title' && r}>{(t) => <Title id={t().id} active={active} />}</Match>
                <Match when={r.name === 'player' && r}>
                  {(p) => <Player mediaId={p().mediaId} startFromZero={p().startFromZero} />}
                </Match>
              </Switch>
            </div>
          )
        }}
      </For>
    </Show>
  )
}

function Splash(props: { text: string }) {
  return (
    <div class="splash">
      <div class="brand">butaca</div>
      <div class="splash-status">{props.text}</div>
    </div>
  )
}
