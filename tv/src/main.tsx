import { render } from 'solid-js/web'
import '@fontsource-variable/inter'
import './styles.css'
import App from './App'

// La app se diseña a 1920×1080 (el viewport de Tizen). En el PC la escalamos para que quepa en la ventana.
const root = document.getElementById('root')!
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080)
  document.documentElement.style.setProperty('--scale', String(s))
}
fit()
addEventListener('resize', fit)

render(() => <App />, root)
