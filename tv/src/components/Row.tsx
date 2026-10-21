import { createSignal, For, type JSX } from 'solid-js'

/**
 * Fila horizontal estilo Netflix TV: la tarjeta enfocada se queda a la izquierda y la fila se desliza.
 * Se mueve con transform (GPU) en vez de scroll nativo, que en la tele va a tirones.
 */
export default function Row<T>(props: {
  title?: string
  items: T[]
  step: number // ancho de tarjeta + hueco
  class?: string
  children: (item: T, index: () => number, focused: () => void) => JSX.Element
}) {
  const [idx, setIdx] = createSignal(0)
  return (
    <section class={`row ${props.class ?? ''}`} data-nav-group>
      {props.title && <h2 class="row-title">{props.title}</h2>}
      <div class="row-track" style={{ transform: `translateX(${-idx() * props.step}px)` }}>
        <For each={props.items}>{(item, i) => props.children(item, i, () => setIdx(i()))}</For>
      </div>
    </section>
  )
}
