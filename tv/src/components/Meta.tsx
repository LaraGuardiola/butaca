import { For, Show } from 'solid-js'
import { url } from '../lib/server'
import type { TitleCard } from '../types'

/** Logo (o nombre en grande) + línea de metadatos. */
export function TitleHeading(props: { t: TitleCard; size?: 'xl' | 'lg' }) {
  return (
    <Show when={props.t.logo} fallback={<h1 class={`title-name title-${props.size ?? 'xl'}`} classList={{ 'title-long': props.t.name.length > 28 }}>
          {props.t.name}
        </h1>}>
      <img class={`title-logo logo-${props.size ?? 'xl'}`} src={url(props.t.logo)} alt={props.t.name} />
    </Show>
  )
}

export function MetaLine(props: { t: TitleCard; extra?: string[] }) {
  const parts = () =>
    [
      props.t.year ? String(props.t.year) : '',
      props.t.kind === 'show' ? 'Serie' : 'Película',
      ...props.t.genres.slice(0, 3),
    ].filter(Boolean)
  return (
    <div class="meta">
      <Show when={props.t.rating}>
        <span class="meta-rating">★ {props.t.rating!.toFixed(1)}</span>
      </Show>
      <For each={parts()}>{(p) => <span class="meta-item">{p}</span>}</For>
      <For each={props.extra}>{(b) => <span class="badge">{b}</span>}</For>
    </div>
  )
}
