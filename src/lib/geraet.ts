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

/**
 * Nur im Browser offen, nicht vom Home-Bildschirm und nicht im
 * Windows-Programm. Dort darf der Browser die Daten der Seite ohne Nachfrage
 * wegraeumen — Safari etwa nach ein paar Tagen ohne Besuch.
 */
export const IM_BROWSER = !AM_PC
  && !window.matchMedia('(display-mode: standalone)').matches
  && (navigator as { standalone?: boolean }).standalone !== true;

/**
 * iPhone und iPad. Dort hat die App vom Home-Bildschirm einen eigenen
 * Speicher und nimmt nichts aus Safari mit. iPads melden sich als Mac,
 * erkennbar nur am Touchscreen.
 */
export const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** Chrome und Edge bieten das Installieren selbst an — das Angebot fuer spaeter aufheben. */
interface Installation extends Event { prompt(): Promise<void> }
let angebot: Installation | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  angebot = e as Installation;
});

export function installierbar(): boolean {
  return angebot !== null;
}

/** Den Installationsdialog des Browsers zeigen. Er laesst sich nur einmal je Angebot oeffnen. */
export async function installieren(): Promise<void> {
  const a = angebot;
  angebot = null;
  await a?.prompt();
}
