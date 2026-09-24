import { jsPDF } from 'jspdf';
import qrcode from 'qrcode-generator';
import { code128 } from './code128';
import { qrInhalt } from './codes';
import { datumSortierbar } from './format';

export type EtikettArt = 'qr' | 'strich';

export interface Etikett {
  name: string;
  einheit: string;
  /** Immer der eigene Code des Artikels ("MB-..."), nie eine fremde EAN. */
  code: string;
  art: EtikettArt;
}

/** Ein Blatt voller Etiketten. Alle Masse in Millimetern. */
export interface Bogen {
  id: string;
  titel: string;
  spalten: number;
  zeilen: number;
  breite: number;
  hoehe: number;
  /** Lage der linken oberen Ecke des ersten Etiketts auf dem Blatt. */
  links: number;
  oben: number;
  /**
   * Innenrand. Drucker schaffen den Blattrand nicht, und ein Code braucht
   * rundum etwas Weiss (Ruhezone), sonst liest ihn keine Kamera.
   */
  rand: number;
  /** Normales Papier: duenne Linien zum Ausschneiden. */
  schnitt: boolean;
}

/**
 * Ein weiterer Bogen ist eine Zeile hier. Der Etikettenbogen ist ein
 * verbreitetes Format (etwa Avery Zweckform 3474), bis feststeht, welches der
 * Betrieb verwendet. Titel kurz halten: am Handy schneidet die Auswahl ab.
 */
export const BOEGEN: Bogen[] = [
  {
    id: 'z3474', titel: 'Etikettenbogen 70 × 37 mm (24)',
    spalten: 3, zeilen: 8, breite: 70, hoehe: 37, links: 0, oben: 0.5, rand: 4, schnitt: false,
  },
  {
    id: 'a4', titel: 'Normales A4, 90 × 45 mm (12)',
    spalten: 2, zeilen: 6, breite: 90, hoehe: 45, links: 15, oben: 13.5, rand: 5, schnitt: true,
  },
];

const SCHWARZ: [number, number, number] = [0, 0, 0];
const GRAU: [number, number, number] = [110, 120, 130];
const LINIE: [number, number, number] = [190, 196, 204];

/**
 * Etiketten als PDF. `erstesFreies` zaehlt ab 1 und erlaubt, einen
 * angebrochenen Bogen weiterzuverwenden.
 */
export function etikettenPdf(etiketten: Etikett[], bogen: Bogen, erstesFreies = 1): File {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const jeSeite = bogen.spalten * bogen.zeilen;
  let platz = Math.min(Math.max(Math.round(erstesFreies), 1), jeSeite) - 1;

  if (bogen.schnitt) schnittlinien(doc, bogen);
  for (const e of etiketten) {
    if (platz >= jeSeite) {
      doc.addPage();
      if (bogen.schnitt) schnittlinien(doc, bogen);
      platz = 0;
    }
    const x = bogen.links + (platz % bogen.spalten) * bogen.breite;
    const y = bogen.oben + Math.floor(platz / bogen.spalten) * bogen.hoehe;
    if (e.art === 'qr') qrEtikett(doc, e, x, y, bogen);
    else strichEtikett(doc, e, x, y, bogen);
    platz++;
  }

  const blob = doc.output('blob');
  return new File([blob], `MaterialBlitz_Etiketten_${datumSortierbar(Date.now())}.pdf`, {
    type: 'application/pdf',
  });
}

// ------------------------------------------------------------- Etiketten

/** QR links, so hoch wie das Etikett; daneben Name, Einheit und Code. */
function qrEtikett(doc: jsPDF, e: Etikett, x: number, y: number, b: Bogen): void {
  const s = b.hoehe - 2 * b.rand;
  qrZeichnen(doc, qrInhalt(e.code, e.name, e.einheit), x + b.rand, y + b.rand, s);

  const tx = x + b.rand + s + 3;
  const tb = x + b.breite - b.rand - tx;
  const unten = y + b.hoehe - b.rand;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SCHWARZ);
  const zeilen = zeilenKuerzen(doc, e.name, tb, 4);
  doc.text(zeilen, tx, y + b.rand, { baseline: 'top' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAU);
  doc.text(e.einheit, tx, y + b.rand + zeilen.length * zeilenHoehe(9) + 1, { baseline: 'top' });
  doc.setFontSize(7);
  doc.text(e.code, tx, unten, { baseline: 'bottom' });
}

/** Name oben, darunter der Strichcode ueber die ganze Breite, darunter der Code in Klarschrift. */
function strichEtikett(doc: jsPDF, e: Etikett, x: number, y: number, b: Bogen): void {
  const innen = b.breite - 2 * b.rand;
  const unten = y + b.hoehe - b.rand;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SCHWARZ);
  const zeilen = zeilenKuerzen(doc, e.name, innen, 2);
  doc.text(zeilen, x + b.rand, y + b.rand, { baseline: 'top' });

  const breiten = code128(e.code);
  // Zehn Module Ruhezone links und rechts gehoeren zur Breite dazu.
  const module = breiten.reduce((s, w) => s + w, 0) + 20;
  // Hoechstens 0,5 mm je Modul: breiter liest sich nicht besser, nur schlechter zielen.
  const m = Math.min(0.5, innen / module);
  const oben = y + b.rand + zeilen.length * zeilenHoehe(9) + 1.5;
  const hoehe = unten - 3.2 - oben;
  let bx = x + (b.breite - module * m) / 2 + 10 * m;
  doc.setFillColor(...SCHWARZ);
  breiten.forEach((w, i) => {
    if (i % 2 === 0) doc.rect(bx, oben, w * m, hoehe, 'F');
    bx += w * m;
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAU);
  doc.text(e.code, x + b.breite / 2, unten, { align: 'center', baseline: 'bottom' });
}

function qrZeichnen(doc: jsPDF, inhalt: string, x: number, y: number, seite: number): void {
  const qr = qrcode(0, 'M');
  // Die Bibliothek nimmt je Zeichen genau ein Byte. Umlaute daher vorher in
  // UTF-8 zerlegen - sonst liest die Kamera "Dbel" statt "Dübel".
  qr.addData(String.fromCharCode(...new TextEncoder().encode(inhalt)));
  qr.make();
  const n = qr.getModuleCount();
  const m = seite / n;
  doc.setFillColor(...SCHWARZ);
  // Dunkle Module einer Reihe zu einem Balken zusammenfassen: viel weniger
  // Rechtecke im PDF. Das Quentchen Ueberhoehung schliesst die Haarlinien,
  // die manche Anzeigen sonst zwischen den Reihen zeigen.
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) { c++; continue; }
      const anfang = c;
      while (c < n && qr.isDark(r, c)) c++;
      doc.rect(x + anfang * m, y + r * m, (c - anfang) * m, m + 0.02, 'F');
    }
  }
}

function schnittlinien(doc: jsPDF, b: Bogen): void {
  const rechts = b.links + b.spalten * b.breite;
  const unten = b.oben + b.zeilen * b.hoehe;
  doc.setDrawColor(...LINIE);
  doc.setLineWidth(0.1);
  for (let z = 0; z <= b.zeilen; z++) doc.line(b.links, b.oben + z * b.hoehe, rechts, b.oben + z * b.hoehe);
  for (let s = 0; s <= b.spalten; s++) doc.line(b.links + s * b.breite, b.oben, b.links + s * b.breite, unten);
}

// ------------------------------------------------------------------ Text

/** Zeilenhoehe in mm fuer eine Schriftgroesse in pt (jsPDF-Vorgabe 1,15). */
function zeilenHoehe(pt: number): number {
  return pt * 0.3528 * 1.15;
}

/** Umbrechen und nach `max` Zeilen mit "…" abschneiden. */
function zeilenKuerzen(doc: jsPDF, text: string, breite: number, max: number): string[] {
  const zeilen = doc.splitTextToSize(text, breite) as string[];
  if (zeilen.length <= max) return zeilen;
  const behalten = zeilen.slice(0, max);
  let letzte = behalten[max - 1]!;
  while (letzte && doc.getTextWidth(letzte + '…') > breite) letzte = letzte.slice(0, -1);
  behalten[max - 1] = letzte.trimEnd() + '…';
  return behalten;
}
