import type { Einstellungen, Firma } from './model';
import type { Lizenz } from './lib/lizenz';

export type Ansicht = 'uebersicht' | 'schein' | 'katalog' | 'einstellungen' | 'sperre';

interface Zustand {
  ansicht: Ansicht;
  baustelleId?: number;
  /** Zuletzt geaenderte Position — wird kurz hervorgehoben. */
  frisch?: number;
  einstellungen?: Einstellungen;
  /** Die **gepruefte** Lizenz. Gesetzt heisst: Unterschrift stimmt. */
  lizenz?: Lizenz;
}

export const zustand: Zustand = { ansicht: 'uebersicht' };

let zeichner: (() => void) | null = null;

export function zeichnerSetzen(fn: () => void): void {
  zeichner = fn;
}

/** Neu aufbauen, ohne die Ansicht zu wechseln. */
export function neu(): void {
  zeichner?.();
}

export function gehe(ansicht: Ansicht, baustelleId?: number): void {
  zustand.ansicht = ansicht;
  if (baustelleId !== undefined) zustand.baustelleId = baustelleId;
  zustand.frisch = undefined;
  neu();
}

/**
 * Ohne gueltigen Schluessel kommt die App gar nicht erst hoch — kein Anlegen,
 * kein Erfassen, nichts.
 *
 * Gefragt wird nach der **geprueften** Lizenz, nicht nach dem gespeicherten
 * Text: die Unterschrift wird beim Start einmal nachgerechnet (main.ts), und
 * erst ihr Ergebnis schaltet frei. Ein von Hand in den Speicher geschriebener
 * Schluessel reicht damit nicht mehr.
 */
export function freigeschaltet(): boolean {
  return Boolean(zustand.lizenz);
}

/** Wer einen Schein erstellt hat — so, wie es auf PDF und CSV steht. */
export interface Ersteller {
  name: string | null;
  firma: string | null;
}

/**
 * Name und Firma aus der Lizenz, gefiltert nach der Wahl in den
 * Einstellungen. Fehlt der Lizenz das Gewaehlte (aeltere Schluessel tragen
 * nur den Namen), bleibt stehen, was da ist — leer wird es nie.
 */
export function ersteller(): Ersteller {
  const l = zustand.lizenz;
  if (!l) return { name: null, firma: null };
  const wahl = zustand.einstellungen?.ausweis ?? 'beides';
  return {
    name: wahl === 'firma' && l.firma ? null : l.name,
    firma: wahl === 'name' && l.name ? null : l.firma,
  };
}

/** Der Ersteller als eine Zeile, etwa fuer CSV, Fusszeile und Dashboard. */
export function erstellerText(trenner = ', '): string {
  const { name, firma } = ersteller();
  return [name, firma].filter(Boolean).join(trenner);
}

/**
 * Der Firmenkopf fuers PDF. Traegt die Lizenz eine Firma, gilt deren Name —
 * er haengt am Schluessel und laesst sich in den Einstellungen nicht
 * aendern. Anschrift und Telefon kommen weiter aus dem Firmenkopf.
 */
export function firmenkopf(firma: Firma): Firma {
  const ausLizenz = zustand.lizenz?.firma;
  return ausLizenz ? { ...firma, name: ausLizenz } : firma;
}
