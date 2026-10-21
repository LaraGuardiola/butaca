import { defineConfig, type Plugin } from 'vite'
import solid from 'vite-plugin-solid'
import { networkInterfaces } from 'node:os'

function lanIp() {
  for (const list of Object.values(networkInterfaces()))
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal && /^(192\.168|10\.)/.test(i.address)) return i.address
  return 'localhost'
}

/**
 * Tizen carga la app desde file://, donde los <script type="module"> fallan por CORS.
 * Generamos un IIFE clásico con defer.
 */
function classicScript(): Plugin {
  return {
    name: 'tizen-classic-script',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, '<script defer src="$1"></script>')
        .replace(/ crossorigin/g, ''),
  }
}

export default defineConfig({
  base: './',
  plugins: [solid(), classicScript()],
  define: {
    __BUTACA_SERVER__: JSON.stringify(process.env.BUTACA_SERVER ?? `http://${lanIp()}:8420`),
  },
  build: {
    target: 'chrome85', // Tizen 6.5 (QN90B, 2022)
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rollupOptions: { output: { format: 'iife' } },
  },
})
