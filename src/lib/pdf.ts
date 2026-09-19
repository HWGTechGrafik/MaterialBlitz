import { jsPDF } from 'jspdf';
// Funktionsform statt doc.autoTable(): nur die ist in 3.x sauber typisiert.
import autoTable from 'jspdf-autotable';
import type { Baustelle, Firma, Kunde, Schein } from '../model';
import { datum, dateinameTeil, datumSortierbar, menge, zeit, zeitKompakt } from './format';
import { markeDataURL } from './marke';

const NAVY: [number, number, number] = [16, 43, 73];
const GRAU: [number, number, number] = [120, 134, 150];
const GOLD: [number, number, number] = [180, 120, 0];
const LINIE: [number, number, number] = [205, 212, 220];

/**
 * Layout B — Formularblock.
 *
 * Der tragende Gedanke: Kunde, Baustelle, Bereich und Datum stehen rechts oben
 * in einem umrandeten Kasten, also bei jedem Schein **an derselben Stelle**.
 * Im Buero findet man sie, ohne lesen zu muessen.
 *
 * Deutsche Umlaute brauchen **keine eingebettete Schrift**: Die Standard-14
 * nutzen WinAnsiEncoding (CP1252), das ä ö ü Ä Ö Ü ß enthaelt. Dadurch bleibt
 * ein Schein bei rund 5 KB statt mehreren hundert.
 */
export function pdfErzeugen(
  schein: Schein,
  baustelle: Baustelle,
  firma: Firma,
  kunde?: Kunde,
): jsPDF {
  // compress steht sonst auf false — derselbe Schein waere achtmal so gross.
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const breite = doc.internal.pageSize.getWidth();
  const stand = schein.beendet ?? Date.now();
  const zeilen = schein.positionen.map((p, i) => [
    String(i + 1), p.name, menge(p.menge), p.einheit,
  ]);

  const fusszeile = (seite: number) => {
    const h = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...LINIE);
    doc.setLineWidth(0.2);
    doc.line(15, h - 14, breite - 15, h - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GRAU);
    doc.text(
      `${zeilen.length} Positionen · erzeugt am ${datum(stand)} um ${zeit(stand)} Uhr mit MaterialBlitz`,
      15, h - 9,
    );
    doc.text(`Seite ${seite}`, breite - 15, h - 9, { align: 'right' });
  };

  const kopf = (erste: boolean) => {
    if (!erste) {
      // Folgeseiten tragen nur eine schmale Zeile — der Tabellenkopf
      // wiederholt sich ohnehin von selbst.
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...GRAU);
      const teile = ['Materialschein', baustelle.ort];
      if (schein.bezeichnung) teile.push(schein.bezeichnung);
      teile.push(datum(stand));
      doc.text(teile.join(' · '), 15, 14);
      return;
    }

    const marke = markeDataURL();
    let textX = 15;
    if (marke) {
      try {
        doc.addImage(marke, 'PNG', 15, 15, 16, 16);
        textX = 34;
      } catch {
        // Ohne Bildmarke sieht der Kopf schlichter aus — kein Grund,
        // den Schein nicht zu erzeugen.
      }
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text(firma.name || 'MaterialBlitz', textX, 21);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GRAU);
    const anschrift = [firma.strasse, firma.ort, firma.telefon && `Tel. ${firma.telefon}`]
      .filter(Boolean)
      .join(' · ');
    if (anschrift) doc.text(anschrift, textX, 26);

    // Eckdaten-Kasten rechts
    const kx = breite - 90;
    const ky = 36;
    doc.setDrawColor(...LINIE);
    doc.setLineWidth(0.3);
    doc.roundedRect(kx, ky, 75, 30, 1.5, 1.5);
    const paare: Array<[string, string]> = [
      // Im PDF ausgeschrieben — anders als im CSV, wo die Spalte leer bleibt.
      // Das Blatt liest ein Mensch.
      ['Kunde', kunde?.name ?? 'ohne Kunden'],
      ['Projekt', baustelle.ort],
      ['Bereich', schein.bezeichnung || '—'],
      ['Datum', `${datum(stand)}, ${zeit(stand)}`],
    ];
    let y = ky + 6.5;
    for (const [k, v] of paare) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...GRAU);
      doc.text(k, kx + 4, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...NAVY);
      doc.text(doc.splitTextToSize(v, 45)[0] ?? '', kx + 26, y);
      y += 6.5;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(...NAVY);
    doc.text('Materialschein', 15, 48);

    if (schein.nachtragVon) {
      doc.setFillColor(255, 243, 214);
      doc.setDrawColor(...GOLD);
      doc.setLineWidth(0.3);
      doc.roundedRect(15, 51.5, 24, 6.5, 1, 1, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...GOLD);
      doc.text('NACHTRAG', 27, 56, { align: 'center' });
    }
  };

  let erste = true;
  kopf(true);
  autoTable(doc, {
    head: [['Pos', 'Material', 'Menge', 'Einheit']],
    body: zeilen,
    startY: 72,
    margin: { top: 22, left: 15, right: 15, bottom: 20 },
    styles: {
      font: 'helvetica', fontSize: 10, cellPadding: 2.2,
      textColor: NAVY, lineColor: LINIE, lineWidth: 0.1,
    },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 248, 250] },
    columnStyles: {
      0: { cellWidth: 12, textColor: GRAU, halign: 'right' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
      3: { cellWidth: 20, textColor: GRAU },
    },
    didDrawPage: (d: { pageNumber: number }) => {
      if (!erste) kopf(false);
      erste = false;
      fusszeile(d.pageNumber);
    },
  });

  return doc;
}

export function pdfDateiname(schein: Schein, baustelle: Baustelle): string {
  const stand = schein.beendet ?? Date.now();
  const teile = [
    'MaterialBlitz', datumSortierbar(stand), zeitKompakt(stand), dateinameTeil(baustelle.ort),
  ];
  if (schein.bezeichnung) teile.push(dateinameTeil(schein.bezeichnung));
  return teile.join('_') + '.pdf';
}

export function pdfDatei(
  schein: Schein, baustelle: Baustelle, firma: Firma, kunde?: Kunde,
): File {
  const blob = pdfErzeugen(schein, baustelle, firma, kunde).output('blob');
  return new File([blob], pdfDateiname(schein, baustelle), { type: 'application/pdf' });
}
