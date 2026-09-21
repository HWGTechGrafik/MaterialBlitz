import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const leer = fileURLToPath(new URL('./src/lib/leer.ts', import.meta.url));

// Fassung, Stand und Zeitpunkt beim Bauen einsetzen. Daran erkennt man am
// Handy, ob ein Update wirklich angekommen ist — sonst bleibt nur Raten.
const paket = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const stand = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    // Ohne Versionsverwaltung gebaut — kein Grund, den Bau abzubrechen.
    return 'lokal';
  }
})();

export default defineConfig({
  // Die Seite liegt auf GitHub Pages in einem Unterverzeichnis. Fehlt das hier,
  // sucht der Service Worker seine Dateien im Wurzelverzeichnis — was online
  // unbemerkt bleibt und erst offline auf der Baustelle auffaellt.
  base: '/MaterialBlitz/',

  resolve: {
    alias: {
      // jsPDF zieht diese drei nur fuer das ungenutzte html()-Plugin mit:
      // zusammen rund 110 KB gzip. Raus damit.
      html2canvas: leer,
      canvg: leer,
      dompurify: leer,
    },
  },

  define: {
    __FASSUNG__: JSON.stringify(paket.version),
    __STAND__: JSON.stringify(stand),
    __GEBAUT__: JSON.stringify(String(Date.now())),
  },

  build: {
    target: 'es2022',
    sourcemap: false,
  },

  plugins: [
    VitePWA({
      strategies: 'generateSW',
      // Kein autoUpdate: automatisches Neuladen verschluckt einen halb
      // getippten Schein. Der Nutzer entscheidet, wann aktualisiert wird.
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'MaterialBlitz',
        // Unter dem Icon ist nach rund 11 Zeichen Schluss.
        short_name: 'MatBlitz',
        description: 'Digitaler Materialschein',
        lang: 'de',
        dir: 'ltr',
        start_url: '/MaterialBlitz/',
        scope: '/MaterialBlitz/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#102B49',
        theme_color: '#102B49',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: '/MaterialBlitz/index.html',
        // Ohne diese Liste beantwortet der Service Worker **jede** Navigation
        // unterhalb von /MaterialBlitz/ mit der App - auch eine eigene Seite,
        // die danebenliegt. Die laege dann zwar auf dem Server, waere am
        // Geraet aber nicht zu erreichen, und man suchte den Fehler im
        // Deploy statt hier.
        navigateFallbackDenylist: [/masse\.html$/],
      },
      devOptions: { enabled: false },
    }),
  ],
});
