/**
 * Laeuft die App im Windows-Programm? Das Programm setzt vor dem ersten
 * Skript `window.materialblitzWindows`. Am Handy und im Browser fehlt die
 * Marke, dort bleibt alles beim Alten.
 *
 * Gebraucht nur fuer Texte: Am PC wird geklickt statt getippt, und Dateien
 * landen im Download-Ordner statt im Teilen-Dialog.
 */
export const AM_PC = (window as { materialblitzWindows?: unknown }).materialblitzWindows === true
  // Nur am Entwicklungsserver: …/MaterialBlitz/?pc zeigt das PC-Layout im Browser.
  || (import.meta.env.DEV && new URLSearchParams(location.search).has('pc'));

/** Meldungstext, wenn eine Datei nicht weitergegeben werden konnte. */
export const NICHT_MOEGLICH: [string, string] = AM_PC
  ? ['Speichern nicht möglich', 'Die Datei ließ sich nicht im Download-Ordner ablegen.']
  : ['Teilen nicht möglich', 'Dieses Gerät bietet keinen Teilen-Dialog für Dateien an.'];
