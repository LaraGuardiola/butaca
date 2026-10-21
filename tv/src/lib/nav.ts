// Navegación espacial con las flechas del mando.
// Enfocables: [data-focusable]. Grupos ([data-nav-group]) recuerdan su último elemento,
// así al bajar a una fila vuelves a la tarjeta donde la dejaste, como en Netflix.
import type { Action } from './keys'

type Dir = 'up' | 'down' | 'left' | 'right'

const memory = new WeakMap<Element, HTMLElement>()
const scopes: HTMLElement[] = []

const group = (el: Element | null) => el?.closest('[data-nav-group]') ?? null
const scope = () => scopes[scopes.length - 1] ?? document.body

export function current(): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null
  return a && a.hasAttribute('data-focusable') && scope().contains(a) ? a : null
}

export function focus(el: HTMLElement | null | undefined) {
  if (!el) return
  el.focus({ preventScroll: true })
  // Listas verticales largas (pistas de subtítulos): aquí sí queremos scroll nativo
  if (el.closest('[data-scroll]')) el.scrollIntoView({ block: 'nearest' })
  const g = group(el)
  if (g) memory.set(g, el)
}

function candidates(): HTMLElement[] {
  return Array.from(scope().querySelectorAll<HTMLElement>('[data-focusable]')).filter(
    (e) => !e.hasAttribute('disabled') && e.offsetParent !== null,
  )
}

/** Primer enfocable de un contenedor: el marcado con data-autofocus o el primero. */
export function focusFirst(root: ParentNode = scope()) {
  focus(root.querySelector<HTMLElement>('[data-autofocus]') ?? root.querySelector<HTMLElement>('[data-focusable]'))
}

/** Restringe la navegación a `el` (menús, paneles). Devuelve la función para salir. */
export function pushScope(el: HTMLElement) {
  const prev = current()
  scopes.push(el)
  focusFirst(el)
  return () => {
    const i = scopes.lastIndexOf(el)
    if (i >= 0) scopes.splice(i, 1)
    if (prev?.isConnected) focus(prev)
  }
}

export function move(dir: Dir): boolean {
  const from = current()
  if (!from) {
    focusFirst()
    return true
  }
  const a = from.getBoundingClientRect()
  const ax = a.left + a.width / 2
  const ay = a.top + a.height / 2
  let best: HTMLElement | null = null
  let bestScore = Infinity

  for (const el of candidates()) {
    if (el === from) continue
    const b = el.getBoundingClientRect()
    const bx = b.left + b.width / 2
    const by = b.top + b.height / 2
    let main: number, cross: number
    if (dir === 'left' || dir === 'right') {
      main = dir === 'right' ? b.left - a.right : a.left - b.right
      if ((dir === 'right' ? bx - ax : ax - bx) <= 1) continue
      cross = Math.abs(by - ay)
    } else {
      main = dir === 'down' ? b.top - a.bottom : a.top - b.bottom
      if ((dir === 'down' ? by - ay : ay - by) <= 1) continue
      cross = Math.abs(bx - ax)
    }
    // Penaliza fuerte salirse del eje: preferimos quedarnos en la misma fila/columna
    const score = Math.max(main, 0) + cross * 4
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }
  if (!best) return false

  const g = group(best)
  if (g && g !== group(from)) {
    const remembered = memory.get(g)
    if (remembered?.isConnected) best = remembered
  }
  focus(best)
  return true
}

/** Handler por defecto: flechas navegan, OK pulsa. */
export function navHandler(a: Action): boolean {
  if (a === 'up' || a === 'down' || a === 'left' || a === 'right') {
    move(a)
    return true
  }
  if (a === 'ok') {
    current()?.click()
    return true
  }
  return false
}
