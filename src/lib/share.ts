export type TeilenErgebnis = 'geteilt' | 'abgebrochen' | 'nicht-moeglich';

/**
 * Dateien ueber den Teilen-Dialog des Geraets weitergeben.
 *
 * Drei Eigenheiten, die man kennen muss:
 *
 * 1. **Nur `files` uebergeben.** Ein `title` oder `text` daneben verdraengt am
 *    iPhone den Anhang — geteilt wird dann der Text statt der Datei.
 * 2. **`AbortError` ist kein Fehler.** Der Nutzer hat abgebrochen.
 * 3. **`<a download>` ist im Home-Bildschirm-Modus tot.** Safari ignoriert es
 *    stillschweigend. Der Teilen-Dialog ist dort nicht der bessere, sondern
 *    der einzige Weg; der Fallback unten greift nur im normalen Browser.
 *
 * Die App erfaehrt uebrigens **nicht**, ob die Mail am Ende wirklich abging.
 * Darum heisst es in der Oberflaeche "geteilt" und nicht "gesendet".
 */
export async function teilen(dateien: File[]): Promise<TeilenErgebnis> {
  if (navigator.canShare?.({ files: dateien })) {
    try {
      await navigator.share({ files: dateien });
      return 'geteilt';
    } catch (fehler) {
      if (fehler instanceof DOMException && fehler.name === 'AbortError') return 'abgebrochen';
      return 'nicht-moeglich';
    }
  }
  return herunterladen(dateien) ? 'geteilt' : 'nicht-moeglich';
}

/** Rueckfallebene fuer den normalen Browser am Rechner. */
function herunterladen(dateien: File[]): boolean {
  try {
    for (const datei of dateien) {
      const url = URL.createObjectURL(datei);
      const a = document.createElement('a');
      a.href = url;
      a.download = datei.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
    return true;
  } catch {
    return false;
  }
}

/** Datei ueber einen Dateiauswahl-Dialog einlesen. */
export function dateiWaehlen(): Promise<string | null> {
  return new Promise((fertig) => {
    const eingabe = document.createElement('input');
    eingabe.type = 'file';
    // Weit gefasst: am iPhone bekommen Anhaenge aus Mail und WhatsApp nicht
    // immer den erwarteten Typ mit.
    eingabe.accept = '.txt,text/plain,application/json';
    eingabe.addEventListener('change', async () => {
      const datei = eingabe.files?.[0];
      if (!datei) return fertig(null);
      try {
        fertig(await datei.text());
      } catch {
        fertig(null);
      }
    });
    eingabe.addEventListener('cancel', () => fertig(null));
    eingabe.click();
  });
}
