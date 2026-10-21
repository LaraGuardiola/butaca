// Pila de pantallas. Las de debajo siguen montadas (ocultas) para conservar foco y posición al volver.
import { createSignal } from 'solid-js'
import { focus } from './nav'

export type Route =
  | { name: 'home' }
  | { name: 'title'; id: number }
  | { name: 'player'; mediaId: number; startFromZero?: boolean }

type Entry = { key: number; route: Route; lastFocus?: HTMLElement | null }

let seq = 0
const [stack, setStack] = createSignal<Entry[]>([{ key: seq++, route: { name: 'home' } }])
export { stack }

export const top = () => stack()[stack().length - 1]

export function go(route: Route) {
  const s = stack()
  s[s.length - 1].lastFocus = document.activeElement as HTMLElement
  setStack([...s, { key: seq++, route }])
}

/** Sustituye la pantalla actual (p. ej. pasar al siguiente episodio sin apilar reproductores). */
export function replace(route: Route) {
  setStack([...stack().slice(0, -1), { key: seq++, route }])
}

export function back(): boolean {
  const s = stack()
  if (s.length <= 1) return false
  const prev = s[s.length - 2]
  setStack(s.slice(0, -1))
  requestAnimationFrame(() => prev.lastFocus?.isConnected && focus(prev.lastFocus))
  return true
}
