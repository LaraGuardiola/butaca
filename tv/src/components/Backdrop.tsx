import { createEffect, createSignal, For, on } from 'solid-js'
import { url } from '../lib/server'

/** Fondo a pantalla completa con fundido cruzado entre imágenes. */
export default function Backdrop(props: { src?: string | null; dim?: 'home' | 'title' | 'player' }) {
  const [layers, setLayers] = createSignal<{ key: number; src: string }[]>([])
  let n = 0
  createEffect(
    on(
      () => props.src,
      (src) => {
        if (!src) return
        const img = new Image()
        // Esperamos a que cargue para que el fundido no muestre un hueco negro
        img.onload = () => setLayers((l) => [...l.slice(-1), { key: n++, src: img.src }])
        img.src = url(src)!
      },
    ),
  )
  return (
    <div class={`backdrop backdrop-${props.dim ?? 'home'}`}>
      <For each={layers()}>{(l) => <img class="backdrop-img" src={l.src} alt="" />}</For>
      <div class="backdrop-shade" />
    </div>
  )
}
