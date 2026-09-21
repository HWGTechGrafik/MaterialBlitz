/**
 * Welche Fassung gerade laeuft.
 *
 * Beim Bauen eingesetzt (vite.config.ts), nicht zur Laufzeit ermittelt. Die
 * Nummer aus package.json sagt wenig — entscheidend sind **Stand und
 * Zeitpunkt**: Genau daran erkennt man am Handy, ob ein Update wirklich
 * angekommen ist. Ohne diese Zeile bleibt nur Raten, und geraten haben wir in
 * diesem Projekt schon genug.
 */
import { datum, zeit } from './format';

declare const __FASSUNG__: string;
declare const __STAND__: string;
declare const __GEBAUT__: string;

export const FASSUNG = __FASSUNG__;
/** Kurzer Stand aus der Versionsverwaltung, oder 'lokal' ohne sie. */
export const STAND = __STAND__;
export const GEBAUT = Number(__GEBAUT__);

/** Eine Zeile fuer den Fuss: „0.1.0 · 589680a · 21.09.2026 23:47". */
export function fassungsZeile(): string {
  const teile = [FASSUNG, STAND];
  if (GEBAUT) teile.push(`${datum(GEBAUT)} ${zeit(GEBAUT)}`);
  return teile.join(' · ');
}
