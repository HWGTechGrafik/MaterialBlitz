// Die Begriffe dieses Projekts. Sie stehen so auch in der Oberflaeche.

/** Ein Eintrag im Katalog — Tippvorlage, nicht Inhalt eines Scheins. */
export interface Artikel {
  id?: number;
  name: string;
  einheit: string;
  /** Wie oft insgesamt verwendet. Bestimmt die Reihenfolge der Vorschlaege. */
  anzahl: number;
}

export interface Kunde {
  id?: number;
  name: string;
  /** Ausgeblendet statt geloescht, wenn Historie daran haengt. */
  versteckt?: boolean;
}

export interface Baustelle {
  id?: number;
  ort: string;
  /** Optional — Werkstatt, Lager und Eigenbedarf haben keinen Kunden. */
  kundeId?: number;
  /** Arbeit fertig: verschwindet aus dem Dashboard, bleibt auffindbar. */
  abgeschlossen?: boolean;
  versteckt?: boolean;
  /** Zeitstempel der letzten Benutzung — das Dashboard sortiert danach. */
  zuletzt: number;
}

/**
 * Eine Zeile im Schein. **Abschrift, kein Verweis**: sie haelt fest, was zum
 * Zeitpunkt des Aufschreibens galt, und aendert sich nie wieder — auch nicht,
 * wenn der Artikel im Katalog umbenannt oder geloescht wird.
 */
export interface Position {
  name: string;
  menge: number;
  einheit: string;
}

/** Nur *offen* ist bearbeitbar; die anderen beiden sind Endzustaende. */
export type ScheinZustand = 'offen' | 'geteilt' | 'uebergeben';

export interface Schein {
  id?: number;
  baustelleId: number;
  /** Optionale Bezeichnung, etwa "Top 12". Leer ist der Normalfall. */
  bezeichnung?: string;
  zustand: ScheinZustand;
  erstellt: number;
  /** Zeitpunkt des Teilens bzw. Uebergebens. */
  beendet?: number;
  /** Gesetzt, wenn dieser Schein ein Nachtrag zu einem anderen ist. */
  nachtragVon?: number;
  /** Gesetzt, wenn der Schein von einem Kollegen uebernommen wurde. */
  herkunft?: string;
  positionen: Position[];
}

export interface Firma {
  name: string;
  strasse: string;
  ort: string;
  telefon: string;
}

export interface Einstellungen {
  id?: number;
  firma: Firma;
  /** Feste Liste plus selbst ergaenzte. */
  einheiten: string[];
  lizenz?: string;
  /**
   * Adresse des Bueros. Steht **nicht** auf dem PDF — sie liegt beim Senden
   * in der Zwischenablage, damit sie in der Mail nur noch einzusetzen ist.
   * Der Teilen-Dialog kennt kein Empfaengerfeld, das ist der naechste Weg.
   */
  buero?: string;
  letzteSicherung?: number;
  /** Artikel seit der letzten Sicherung — loest die Erinnerung mit aus. */
  neueArtikel: number;
}

export const EINHEITEN_STANDARD = ['Stk', 'm', 'lfm', 'kg', 'Rolle', 'Pkg', 'Satz'];

/**
 * Einheiten, bei denen "+1" eine sinnvolle Eingabe ist. Bei Metern nicht —
 * und ein Druckpunkt, der je nach Artikel etwas anderes tut, waere schlimmer
 * als keiner.
 */
export const ZAEHLBAR = ['Stk', 'Pkg', 'Satz', 'Rolle'];

export function istZaehlbar(einheit: string): boolean {
  return ZAEHLBAR.includes(einheit);
}

export const FIRMA_LEER: Firma = { name: '', strasse: '', ort: '', telefon: '' };

/** Erinnerung an die Sicherung: was zuerst eintritt. */
export const SICHERUNG_TAGE = 30;
export const SICHERUNG_ARTIKEL = 20;

/**
 * Menge zu einem Schein hinzufuegen. Derselbe Artikel steht nur **einmal**
 * auf einem Schein — erneutes Aufschreiben zaehlt zusammen.
 */
export function positionHinzufuegen(
  positionen: Position[],
  name: string,
  menge: number,
  einheit: string,
): { positionen: Position[]; index: number } {
  const i = positionen.findIndex((p) => p.name === name && p.einheit === einheit);
  if (i >= 0) {
    const kopie = positionen.slice();
    const alt = kopie[i]!;
    kopie[i] = { ...alt, menge: runden(alt.menge + menge) };
    return { positionen: kopie, index: i };
  }
  return { positionen: [...positionen, { name, menge, einheit }], index: positionen.length };
}

/** Gegen Rundungsfehler beim Addieren von Kommazahlen (0,1 + 0,2). */
export function runden(n: number): number {
  return Math.round(n * 1000) / 1000;
}
