import type { Einstellungen } from './model';

export type Ansicht = 'uebersicht' | 'schein' | 'katalog' | 'einstellungen' | 'sperre';

interface Zustand {
  ansicht: Ansicht;
  baustelleId?: number;
  /** Zuletzt geaenderte Position — wird kurz hervorgehoben. */
  frisch?: number;
  einstellungen?: Einstellungen;
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
 * Ohne gueltige Lizenz laesst sich erfassen, aber nicht abgeben.
 * Hartes Sperren machte die App unbewertbar — niemand kauft, was er nicht
 * ausprobieren darf.
 */
export function freigeschaltet(): boolean {
  return Boolean(zustand.einstellungen?.lizenz);
}
