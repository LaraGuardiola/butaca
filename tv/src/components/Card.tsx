import { Show } from 'solid-js'
import { url } from '../lib/server'

export type CardProps = {
  image?: string | null
  name: string
  logo?: string | null
  subtitle?: string | null
  progress?: number
  wide?: boolean
  onFocus?: () => void
  onClick?: () => void
}

export default function Card(props: CardProps) {
  return (
    <button
      class="card"
      classList={{ 'card-wide': props.wide }}
      data-focusable
      tabIndex={-1}
      onFocus={props.onFocus}
      onClick={props.onClick}
    >
      <Show when={props.image} fallback={<div class="card-empty" />}>
        <img class="card-img" src={url(props.image)} alt="" loading="lazy" />
      </Show>
      <div class="card-label">
        <Show when={props.logo} fallback={<span class="card-name">{props.name}</span>}>
          <img class="card-logo" src={url(props.logo)} alt={props.name} />
        </Show>
        <Show when={props.subtitle}>
          <span class="card-sub">{props.subtitle}</span>
        </Show>
      </div>
      <Show when={props.progress! > 0}>
        <div class="progress card-progress">
          <div style={{ width: `${Math.min(100, props.progress! * 100)}%` }} />
        </div>
      </Show>
    </button>
  )
}
