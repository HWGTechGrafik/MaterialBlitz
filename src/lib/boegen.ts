import type { EtikettBogen } from '../model';

/**
 * Etikettenformate und ihr Raster auf dem A4-Blatt — ohne jsPDF, damit
 * Einstellungen und Druckdialog rechnen koennen, ohne den Brocken zu laden.
 *
 * Vorlagen nur, wenn das Raster die Stueckzahl des gekauften Bogens genau
 * trifft (Lehre aus der Billy Ledger App): ein Bogen mit 40 Etiketten, fuer
 * den die Rechnung 44 ergibt, sitzt nie. Fuer solche gibt es die eigene
 * Groesse mit festen Spalten und Zeilen und den Probedruck.
 * Titel kurz halten: am Handy schneidet die Auswahl ab.
 */
export const VORLAGEN: EtikettBogen[] = [
  { id: 'z3474', titel: '70 × 37 mm · 24 (Zweckform 3474)', breite: 70, hoehe: 37 },
  { id: 'a4', titel: 'Normales A4, 90 × 45 mm · 12', breite: 90, hoehe: 45, schnitt: true },
  { id: '105x37', titel: '105 × 37 mm · 16', breite: 105, hoehe: 37 },
  { id: '105x48', titel: '105 × 48 mm · 12', breite: 105, hoehe: 48 },
  { id: '105x74', titel: '105 × 74 mm · 8', breite: 105, hoehe: 74 },
  { id: 'a6', titel: '105 × 148 mm · 4 (A6)', breite: 105, hoehe: 148 },
  // Die Avery-Boegen haben Luecken zwischen den Spalten: ohne die sitzen die
  // aeusseren Spalten bis zu 2,5 mm daneben.
  { id: 'l7160', titel: '63,5 × 38,1 mm · 21 (Avery L7160)', breite: 63.5, hoehe: 38.1, abstandX: 2.54, spalten: 3, zeilen: 7 },
  { id: 'l7163', titel: '99,1 × 38,1 mm · 14 (Avery L7163)', breite: 99.1, hoehe: 38.1, abstandX: 2.54, spalten: 2, zeilen: 7 },
  { id: 'l7658', titel: '25,4 × 10 mm · 189 (HERMA 4333)', breite: 25.4, hoehe: 10, abstandX: 2.54, spalten: 7, zeilen: 27 },
];

export const VORGABE_BOGEN = 'z3474';

/** Grenzen fuer eigene Groessen, in mm. Kleiner liest keine Kamera mehr. */
export const MASS_MIN = { breite: 15, hoehe: 8 };
export const ABSTAND_MAX = 20;
export const EIGENE_MAX = 30;

export interface Raster {
  blattBreite: number;
  blattHoehe: number;
  spalten: number;
  zeilen: number;
  jeBlatt: number;
  /** Lage der linken oberen Ecke des ersten Etiketts. */
  links: number;
  oben: number;
  schrittX: number;
  schrittY: number;
}

/** Wie viele passen — das 1e-9 faengt Rundungsfehler wie 296,99999 ab. */
function passen(blatt: number, mass: number, abstand: number): number {
  return Math.max(0, Math.floor((blatt + abstand) / (mass + abstand) + 1e-9));
}

export function raster(b: EtikettBogen): Raster {
  const blattBreite = b.quer ? 297 : 210;
  const blattHoehe = b.quer ? 210 : 297;
  const ax = b.abstandX ?? 0;
  const ay = b.abstandY ?? 0;
  // Feste Spalten/Zeilen gelten, aber nie mehr, als aufs Blatt passen.
  const spalten = Math.min(b.spalten || Infinity, passen(blattBreite, b.breite, ax));
  const zeilen = Math.min(b.zeilen || Infinity, passen(blattHoehe, b.hoehe, ay));
  return {
    blattBreite, blattHoehe, spalten, zeilen, jeBlatt: spalten * zeilen,
    links: (blattBreite - spalten * b.breite - Math.max(0, spalten - 1) * ax) / 2,
    oben: (blattHoehe - zeilen * b.hoehe - Math.max(0, zeilen - 1) * ay) / 2,
    schrittX: b.breite + ax,
    schrittY: b.hoehe + ay,
  };
}

/**
 * Innenrand. Drucker schaffen den Blattrand nicht, und ein Code braucht
 * rundum etwas Weiss (Ruhezone), sonst liest ihn keine Kamera. Waechst mit
 * dem Etikett: 4 mm auf 37 mm Hoehe, gut 1 mm auf den winzigen HERMA.
 */
export function innenrand(b: EtikettBogen): number {
  return Math.min(5, Math.max(1, b.hoehe * 0.11), b.breite * 0.08 + 0.5);
}

/**
 * Feiner als 0,22 mm je Strich liest eine Handykamera nicht mehr sicher —
 * das sind gut 20 Zeichen auf einem 70 mm breiten Etikett.
 */
const MODUL_MIN = 0.22;

/**
 * Ob ein Text als Strichcode auf dieses Etikett passt. Code 128 B kennt keine
 * Umlaute; zu lang wird er zu fein, zu niedrig bleibt neben dem Namen kein
 * Platz fuer die Striche.
 */
export function strichcodeMoeglich(inhalt: string, b: EtikettBogen): boolean {
  if (!/^[\x20-\x7E]+$/.test(inhalt)) return false;
  if (b.hoehe < 18) return false;
  // Start, Pruefzeichen, Stopp und je zehn Module Ruhezone links und rechts.
  const module = 11 * inhalt.length + 35 + 20;
  return (b.breite - 2 * innenrand(b)) / module >= MODUL_MIN;
}

/** Seitenlaenge des QR-Codes, in mm — fuer Hinweise in den Einstellungen. */
export function qrSeite(b: EtikettBogen): number {
  const r = innenrand(b);
  return Math.min(b.hoehe - 2 * r, b.breite * 0.45);
}

/** Vorlagen und eigene Formate zusammen. */
export function alleBoegen(eigene: EtikettBogen[] = []): EtikettBogen[] {
  return [...VORLAGEN, ...eigene];
}

export function bogenFinden(id: string | undefined, eigene: EtikettBogen[] = []): EtikettBogen {
  const alle = alleBoegen(eigene);
  return alle.find((b) => b.id === id) ?? alle.find((b) => b.id === VORGABE_BOGEN)!;
}

/** Eine Zeile zum Format: was auf ein Blatt kommt und wo. */
export function rasterText(b: EtikettBogen): string {
  const r = raster(b);
  if (!r.jeBlatt) return 'So passt kein Etikett aufs Blatt.';
  const mm = (n: number) => n.toLocaleString('de-AT', { maximumFractionDigits: 1 });
  return `${r.jeBlatt} je Blatt (${r.spalten} × ${r.zeilen}), Rand links ${mm(r.links)} mm, oben ${mm(r.oben)} mm, QR-Code ${mm(qrSeite(b))} mm`;
}
