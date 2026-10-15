import type { Artikel } from '../model';

/**
 * Ordner im Archiv. Sie stehen nur am Artikel (Artikel.ordner) — die Liste
 * aller Ordner ergibt sich aus den Artikeln. So gleichen sie mit Dropbox,
 * Sicherung und Excel-Liste ab, ohne dass etwas Eigenes mitreisen muss.
 */

/** Alle Ordner, alphabetisch. */
export function ordnerListe(artikel: Artikel[]): string[] {
  return [...new Set(artikel.map((a) => a.ordner).filter((o): o is string => Boolean(o)))]
    .sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Eingabe zu einem Ordnernamen. Gibt es den Ordner schon in anderer
 * Schreibweise ("kabel" statt "Kabel"), gilt die vorhandene — sonst stuenden
 * bald zwei Ordner fuer dasselbe da. Leer heisst: ohne Ordner.
 */
export function ordnerAngleichen(eingabe: string, vorhandene: string[]): string | undefined {
  const name = eingabe.trim().replace(/\s+/g, ' ');
  if (!name) return undefined;
  return vorhandene.find((o) => o.toLowerCase() === name.toLowerCase()) ?? name;
}
