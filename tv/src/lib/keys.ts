// Mando de Samsung → acciones. Los handlers forman una pila: el de arriba (p. ej. el reproductor) decide primero.
declare const tizen: any

export type Action =
  | 'up' | 'down' | 'left' | 'right' | 'ok' | 'back'
  | 'playpause' | 'play' | 'pause' | 'stop' | 'ff' | 'rw'

const CODES: Record<number, Action> = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok',
  10009: 'back', 8: 'back', 27: 'back', // Back del mando; Retroceso/Esc en el PC
  10252: 'playpause', 32: 'playpause', 415: 'play', 19: 'pause', 413: 'stop', 417: 'ff', 412: 'rw',
}

const MEDIA_KEYS = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind']

type Handler = (a: Action, e: KeyboardEvent) => boolean | void
const stack: Handler[] = []

/** Registra un handler; devuelve la función para quitarlo. Si devuelve true, la tecla no sigue bajando. */
export function onKey(h: Handler) {
  stack.push(h)
  return () => {
    const i = stack.lastIndexOf(h)
    if (i >= 0) stack.splice(i, 1)
  }
}

export function installKeys() {
  try {
    for (const k of MEDIA_KEYS) tizen.tvinputdevice.registerKey(k)
  } catch { /* fuera de la tele */ }

  document.addEventListener('keydown', (e) => {
    const a = CODES[e.keyCode]
    if (!a) return
    e.preventDefault()
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i](a, e)) return
  })
}

export function exitApp() {
  try {
    tizen.application.getCurrentApplication().exit()
  } catch { /* navegador */ }
}

export const isTizen = () => typeof tizen !== 'undefined'
