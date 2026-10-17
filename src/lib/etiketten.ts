import { jsPDF } from 'jspdf';
import qrcode from 'qrcode-generator';
import { code128 } from './code128';
import { datumSortierbar } from './format';

import type { EtikettArt, EtikettBogen } from '../model';
import { innenrand, qrSeite, raster } from './boegen';

export type { EtikettArt };

export interface Etikett {
  name: string;
  einheit: string;
  /**
   * Was der Code traegt: beim eigenen Code `MB1|...` (QR) bzw. "MB-..."
   * (Strichcode), sonst schlicht Artikelnummer oder Bezeichnung. Nie eine
   * fremde EAN — die klebt ohnehin schon am Material.
   */
  inhalt: string;
  /** Klarschrift unter dem Code; leer, wenn sie nur den Namen wiederholte. */
  klartext: string;
  art: EtikettArt;
}

const SCHWARZ: [number, number, number] = [0, 0, 0];
const GRAU: [number, number, number] = [110, 120, 130];
const LINIE: [number, number, number] = [190, 196, 204];

function neuesBlatt(bogen: EtikettBogen): jsPDF {
  // Quer schon im PDF: dreht erst der Druckdialog, verkleinert er dabei,
  // und nichts sitzt mehr auf dem Bogen.
  return new jsPDF({ unit: 'mm', format: 'a4', orientation: bogen.quer ? 'landscape' : 'portrait', compress: true });
}

/**
 * Etiketten als PDF. `erstesFreies` zaehlt ab 1 und erlaubt, einen
 * angebrochenen Bogen weiterzuverwenden. Mehrere Stueck eines Artikels
 * stehen einfach mehrfach in `etiketten`.
 */
export function etikettenPdf(etiketten: Etikett[], bogen: EtikettBogen, erstesFreies = 1): File {
  const doc = neuesBlatt(bogen);
  const r = raster(bogen);
  let platz = Math.min(Math.max(Math.round(erstesFreies), 1), r.jeBlatt) - 1;

  if (bogen.schnitt) schnittlinien(doc, bogen);
  for (const e of etiketten) {
    if (platz >= r.jeBlatt) {
      doc.addPage('a4', bogen.quer ? 'landscape' : 'portrait');
      if (bogen.schnitt) schnittlinien(doc, bogen);
      platz = 0;
    }
    const x = r.links + (platz % r.spalten) * r.schrittX;
    const y = r.oben + Math.floor(platz / r.spalten) * r.schrittY;
    if (e.art === 'qr') qrEtikett(doc, e, x, y, bogen);
    else strichEtikett(doc, e, x, y, bogen);
    platz++;
  }

  return new File([doc.output('blob')], `MaterialBlitz_Etiketten_${datumSortierbar(Date.now())}.pdf`, {
    type: 'application/pdf',
  });
}

/**
 * Nur die Umrisse, nummeriert — auf Normalpapier drucken und gegen den
 * Etikettenbogen ins Licht halten. So zeigt sich ein Versatz, bevor ein
 * teurer Bogen verdruckt ist.
 */
export function probeblattPdf(bogen: EtikettBogen): File {
  const doc = neuesBlatt(bogen);
  const r = raster(bogen);
  doc.setDrawColor(...SCHWARZ);
  doc.setLineWidth(0.15);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAU);
  doc.setFontSize(Math.min(14, Math.max(5, bogen.hoehe * 0.3)));
  for (let i = 0; i < r.jeBlatt; i++) {
    const x = r.links + (i % r.spalten) * r.schrittX;
    const y = r.oben + Math.floor(i / r.spalten) * r.schrittY;
    doc.rect(x, y, bogen.breite, bogen.hoehe);
    doc.text(String(i + 1), x + bogen.breite / 2, y + bogen.hoehe / 2, { align: 'center', baseline: 'middle' });
  }
  const name = bogen.titel.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return new File([doc.output('blob')], `MaterialBlitz_Probeblatt_${name}.pdf`, { type: 'application/pdf' });
}

// ------------------------------------------------------------- Etiketten

/**
 * Schrift waechst und schrumpft mit dem Etikett. 1 entspricht 37 mm Hoehe,
 * dem Format, fuer das die Groessen einst gewaehlt wurden. Nach unten
 * begrenzt: unter 5 pt liest es niemand mehr.
 */
function skala(b: EtikettBogen): number {
  return Math.min(1.6, Math.max(0.5, b.hoehe / 37));
}

/** QR links, so hoch wie das Etikett; daneben Name, Einheit und Klarschrift. */
function qrEtikett(doc: jsPDF, e: Etikett, x: number, y: number, b: EtikettBogen): void {
  const r = innenrand(b);
  const s = qrSeite(b);
  const oben = y + (b.hoehe - s) / 2;
  const unten = oben + s;
  qrZeichnen(doc, e.inhalt, x + r, oben, s);

  const tx = x + r + s + Math.max(1.5, r * 0.75);
  const tb = x + b.breite - r - tx;
  if (tb < 4) return; // Fuer Text bleibt kein Platz — der Code genuegt.
  const k = skala(b);
  const pName = Math.max(5, 9 * k);
  const pEinheit = Math.max(4.5, 8 * k);
  const pKlar = Math.max(4.5, 7 * k);
  const klarH = e.klartext ? zeilenHoehe(pKlar) : 0;
  const einheitH = zeilenHoehe(pEinheit) + 0.5;

  // Der Name bekommt, was nach Einheit und Klarschrift bleibt — mindestens eine Zeile.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(pName);
  doc.setTextColor(...SCHWARZ);
  const maxZeilen = Math.max(1, Math.min(4, Math.floor((s - klarH - einheitH) / zeilenHoehe(pName))));
  const zeilen = zeilenKuerzen(doc, e.name, tb, maxZeilen);
  doc.text(zeilen, tx, oben, { baseline: 'top' });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAU);
  const einheitY = oben + zeilen.length * zeilenHoehe(pName) + 0.5;
  if (einheitY + zeilenHoehe(pEinheit) <= unten - klarH) {
    doc.setFontSize(pEinheit);
    doc.text(e.einheit, tx, einheitY, { baseline: 'top' });
  }
  if (e.klartext) {
    doc.setFontSize(pKlar);
    doc.text(zeilenKuerzen(doc, e.klartext, tb, 1), tx, unten, { baseline: 'bottom' });
  }
}

/** Name oben, darunter der Strichcode ueber die ganze Breite, darunter die Klarschrift. */
function strichEtikett(doc: jsPDF, e: Etikett, x: number, y: number, b: EtikettBogen): void {
  const r = innenrand(b);
  const k = skala(b);
  const innen = b.breite - 2 * r;
  const oben = y + r;
  const unten = y + b.hoehe - r;
  const pName = Math.max(5, 9 * k);
  const pKlar = Math.max(4.5, 8 * k);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(pName);
  doc.setTextColor(...SCHWARZ);
  const zeilen = zeilenKuerzen(doc, e.name, innen, b.hoehe >= 30 ? 2 : 1);
  doc.text(zeilen, x + r, oben, { baseline: 'top' });

  const breiten = code128(e.inhalt);
  // Zehn Module Ruhezone links und rechts gehoeren zur Breite dazu.
  const module = breiten.reduce((sum, w) => sum + w, 0) + 20;
  // Hoechstens 0,5 mm je Modul: breiter liest sich nicht besser, nur schlechter zielen.
  const m = Math.min(0.5, innen / module);
  const klarH = e.klartext ? zeilenHoehe(pKlar) + 0.5 : 0;
  const barOben = oben + zeilen.length * zeilenHoehe(pName) + 1.5 * k;
  // Auf grossen Etiketten nicht ueber die ganze Hoehe — 25 mm Striche
  // liest jede Kamera, hoeher sieht nur seltsam aus.
  const hoehe = Math.min(unten - klarH - barOben, 25 * k);
  let bx = x + (b.breite - module * m) / 2 + 10 * m;
  doc.setFillColor(...SCHWARZ);
  breiten.forEach((w, i) => {
    if (i % 2 === 0) doc.rect(bx, barOben, w * m, hoehe, 'F');
    bx += w * m;
  });

  if (e.klartext) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(pKlar);
    doc.setTextColor(...GRAU);
    doc.text(e.klartext, x + b.breite / 2, barOben + hoehe + 0.5, { align: 'center', baseline: 'top' });
  }
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

function schnittlinien(doc: jsPDF, b: EtikettBogen): void {
  const r = raster(b);
  doc.setDrawColor(...LINIE);
  doc.setLineWidth(0.1);
  // Je Etikett ein Rahmen: mit Luecken zwischen den Etiketten stimmt ein
  // durchgehendes Gitter nicht.
  for (let i = 0; i < r.jeBlatt; i++) {
    doc.rect(r.links + (i % r.spalten) * r.schrittX, r.oben + Math.floor(i / r.spalten) * r.schrittY, b.breite, b.hoehe);
  }
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
