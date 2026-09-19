/** Datum als TT.MM.JJJJ — das Format, das deutsches Excel als Datum erkennt. */
export function datum(ms: number): string {
  const d = new Date(ms);
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join('.');
}

/** Uhrzeit als HH:MM. */
export function zeit(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** JJJJ-MM-TT fuer Dateinamen — sortiert sich im Ordner von selbst. */
export function datumSortierbar(ms: number): string {
  const d = new Date(ms);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

export function zeitKompakt(ms: number): string {
  return zeit(ms).replace(':', '');
}

/** Menge mit Dezimal-Komma. */
export function menge(n: number): string {
  return String(n).replace('.', ',');
}

/** Eingabe mit Komma oder Punkt zu einer Zahl. */
export function zahl(text: string): number {
  const n = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Umlaute und Sonderzeichen aus Dateinamen entfernen — sie machen in
 * Mailanhaengen und auf Windows-Laufwerken zuverlaessig Aerger.
 */
export function dateinameTeil(text: string): string {
  return (
    text
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
      .replace(/ß/g, 'ss')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'ohne-Name'
  );
}

export function tageSeit(ms: number): number {
  return Math.floor((Date.now() - ms) / 86_400_000);
}
