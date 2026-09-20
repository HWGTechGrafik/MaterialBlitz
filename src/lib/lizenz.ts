/**
 * Lizenzschluessel — Format `MB-XXXX-XXXX-XXXX`.
 *
 * Die letzten vier Zeichen sind eine **Pruefsumme** ueber die ersten acht.
 * Geratene Schluessel fallen durch, die Pruefung braucht kein Internet.
 *
 * **Die Obergrenze ehrlich benannt:** Die App laeuft vollstaendig am Geraet
 * des Nutzers. Wer den Quelltext liest, kommt an der Pruefung vorbei — bei
 * einer Browser-App ist das nicht zu verhindern. Der Schluessel haelt den
 * ehrlichen Kunden auf, nicht den entschlossenen.
 *
 * Das Alphabet laesst I, O, 0 und 1 weg: sonst diktiert man am Telefon
 * "grosses O oder null?".
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SALZ = 'MaterialBlitz-2026';

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function basis32(zahl: number, stellen: number): string {
  let out = '';
  let rest = zahl;
  for (let i = 0; i < stellen; i++) {
    out = ALPHABET[rest % 32] + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function pruefsumme(rumpf: string): string {
  return basis32(fnv1a(rumpf + SALZ), 4);
}

/** Zeichen herausloesen: Bindestriche, Leerzeichen und das Praefix ignorieren. */
function roh(eingabe: string): string {
  let t = eingabe.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (t.startsWith('MB')) t = t.slice(2);
  return t.slice(0, 12);
}

/** Beim Tippen mitformatieren. */
export function formatieren(eingabe: string): string {
  const t = roh(eingabe);
  const gruppen: string[] = [];
  for (let i = 0; i < t.length; i += 4) gruppen.push(t.slice(i, i + 4));
  return 'MB-' + gruppen.join('-');
}

export function pruefen(eingabe: string): boolean {
  const t = roh(eingabe);
  return t.length === 12 && pruefsumme(t.slice(0, 8)) === t.slice(8, 12);
}

// erzeugen() gibt es hier bewusst nicht: Die App prueft Schluessel, sie gibt
// keine aus. Das macht der Betrieb mit einer eigenen, nicht veroeffentlichten
// Datei (schluessel-generator.html).
