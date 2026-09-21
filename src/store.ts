import type { Einstellungen } from './model';
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
