import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/**
 * Excel-Dateien (.xlsx) schreiben und lesen — nur so viel, wie die
 * Archivliste braucht. Eine .xlsx ist ein Zip voller XML; dafuer genuegt
 * fflate (wenige KB) statt einer Excel-Bibliothek mit ueber einem Megabyte.
 *
 * Warum nicht einfach CSV: Excel macht beim Oeffnen einer CSV aus jeder
 * EAN eine Zahl ("4,00638E+12") und wirft fuehrende Nullen weg. In der .xlsx
 * ist die Code-Spalte als Text formatiert, dann bleibt die Nummer, wie sie ist.
 */

// ------------------------------------------------------------- Schreiben

export interface Spalte {
  titel: string;
  /** Breite in Zeichen. */
  breite: number;
  /** Als Text formatiert — auch fuer Zellen, die erst in Excel befuellt werden. */
  text?: boolean;
  /** Als Zahl schreiben, damit Excel damit rechnen und summieren kann. */
  zahl?: boolean;
}

export interface Tabelle {
  name: string;
  spalten: Spalte[];
  zeilen: string[][];
  /** Auswahlliste in Excel; andere Werte bleiben mit einem Hinweis erlaubt. */
  auswahl?: { spalte: number; werte: string[] };
  /** Kopfzeile fett, festgehalten und mit Filter. */
  kopf?: boolean;
  /** Lange Texte umbrechen (fuer die Anleitung). */
  umbruch?: boolean;
  /**
   * Zeilen ueber der Kopfzeile — ein Briefkopf wie auf dem PDF. Die Tabelle
   * rutscht darunter; Filter und festgehaltene Kopfzeile wandern mit.
   */
  vorspann?: Vorspann[];
  /** Bild links oben in der ersten Zeile, etwa das Firmenlogo. */
  bild?: Bild;
}

export interface Vorspann {
  werte: string[];
  /** `paar`: Beschriftung grau in der ersten Zelle, der Wert fett daneben. */
  stil?: 'fett' | 'titel' | 'grau' | 'paar';
  /** Zeilenhoehe in Punkt — fuer die Zeile, in der das Bild sitzt. */
  hoehe?: number;
}

export interface Bild {
  daten: Uint8Array;
  typ: 'png' | 'jpeg';
  /** Angezeigte Groesse in Pixeln. */
  breite: number;
  hoehe: number;
}

// Stilnummern in styles.xml unten — Reihenfolge von cellXfs.
const S_NORMAL = 0;
const S_KOPF = 1;
const S_TEXT = 2;
const S_UMBRUCH = 3;
const S_FETT = 4;
const S_TITEL = 5;
const S_GRAU = 6;

function vorspannStil(v: Vorspann, spalte: number): number {
  switch (v.stil) {
    case 'fett': return S_FETT;
    case 'titel': return S_TITEL;
    case 'grau': return S_GRAU;
    case 'paar': return spalte ? S_FETT : S_GRAU;
    default: return S_NORMAL;
  }
}

const STILE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="FF102B49"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FF788696"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EDF2"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Steuerzeichen sind in XML verboten — Excel verweigert sonst die ganze Datei.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

/** 0 -> A, 25 -> Z, 26 -> AA */
function spaltenName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Zeilennummer der Kopfzeile — 1, ausser ein Vorspann steht darueber. */
function kopfZeile(t: Tabelle): number {
  return (t.vorspann?.length ?? 0) + 1;
}

/** Bereich von Kopfzeile bis letzter Zeile, fuer Filter und Filtername. */
function filterBereich(t: Tabelle, absolut = false): string {
  const k = kopfZeile(t);
  const letzte = spaltenName(t.spalten.length - 1);
  const ende = k + Math.max(t.zeilen.length, 1);
  return absolut ? `$A$${k}:$${letzte}$${ende}` : `A${k}:${letzte}${ende}`;
}

function blattXml(t: Tabelle, mitBild: boolean): string {
  const cols = t.spalten.map((s, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${s.breite}" customWidth="1"${s.text ? ` style="${S_TEXT}"` : ''}/>`,
  ).join('');

  // Im Vorspann ist auch eine Ziffernfolge Text — die Spalte darunter mag
  // Zahlen fuehren, der Briefkopf nicht.
  const zeile = (werte: string[], r: number, stil: (i: number) => number, vorspann?: Vorspann) =>
    `<row r="${r}"${vorspann?.hoehe ? ` ht="${vorspann.hoehe}" customHeight="1"` : ''}>` + werte.map((w, i) => {
      const s = stil(i);
      const ref = `${spaltenName(i)}${r}`;
      if (!vorspann && t.spalten[i]?.zahl && /^-?\d+(\.\d+)?$/.test(w)) return `<c r="${ref}"><v>${w}</v></c>`;
      // Inline-Text statt sharedStrings: eine Datei weniger, Excel liest beides.
      return w === ''
        ? (s ? `<c r="${ref}" s="${s}"/>` : '')
        : `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${xml(w)}</t></is></c>`;
    }).join('') + '</row>';

  const koerperStil = (i: number) => (t.umbruch ? S_UMBRUCH : t.spalten[i]?.text ? S_TEXT : S_NORMAL);
  const k = kopfZeile(t);
  const zeilen = [
    ...(t.vorspann ?? []).map((v, i) =>
      zeile(v.werte, i + 1, (sp) => vorspannStil(v, sp), v)),
    zeile(t.spalten.map((s) => s.titel), k, () => (t.kopf ? S_KOPF : koerperStil(0))),
    ...t.zeilen.map((z, i) => zeile(z, k + 1 + i, koerperStil)),
  ].join('');

  // Ohne Gitternetz, sobald ein Briefkopf darueber steht: dann soll es
  // aussehen wie ein Schein, nicht wie ein Rechenblatt.
  const gitter = t.vorspann?.length ? ' showGridLines="0"' : '';
  // Festgehalten nur ohne Briefkopf — ein Dutzend starrer Zeilen liesse am
  // Laptop kaum Platz fuer die Tabelle.
  const ansicht = t.kopf && !t.vorspann?.length
    ? `<sheetViews><sheetView${gitter} workbookViewId="0"><pane ySplit="${k}" topLeftCell="A${k + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView${gitter} workbookViewId="0"/></sheetViews>`;
  const filter = t.kopf ? `<autoFilter ref="${filterBereich(t)}"/>` : '';

  // Eine Liste in der Formel darf hoechstens 255 Zeichen haben und kein
  // Komma enthalten — sonst lieber keine Auswahl als eine kaputte Datei.
  let pruefung = '';
  if (t.auswahl) {
    const werte = t.auswahl.werte.filter((w) => !/[,"]/.test(w));
    const liste = werte.join(',');
    if (werte.length && liste.length <= 250) {
      const sp = spaltenName(t.auswahl.spalte);
      pruefung = `<dataValidations count="1"><dataValidation type="list" errorStyle="information" allowBlank="1" showInputMessage="1" showErrorMessage="1"`
        + ` errorTitle="Einheit" error="Diese Einheit kennt die App noch nicht. Sie wird beim Einlesen dazugenommen."`
        + ` sqref="${sp}2:${sp}5000"><formula1>"${xml(liste)}"</formula1></dataValidation></dataValidations>`;
    }
  }

  // Mit Briefkopf ist es ein Schein, der auch ausgedruckt wird: quer und
  // auf eine Seite Breite, sonst landen die hinteren Spalten auf Blatt zwei.
  const schein = Boolean(t.vorspann?.length);
  const seite = schein
    ? '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
      + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    : '';

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + (schein ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '')
    + ansicht + `<cols>${cols}</cols><sheetData>${zeilen}</sheetData>` + filter + pruefung + seite
    + (mitBild ? '<drawing r:id="rId1"/>' : '')
    + '</worksheet>';
}

/** 1 Pixel = 9525 EMU, die Masseinheit von DrawingML. */
const EMU = 9525;

function zeichnungXml(bild: Bild): string {
  // oneCellAnchor: das Bild haengt an A1 und behaelt seine Groesse, auch
  // wenn jemand Spalten breiter zieht.
  const cx = Math.round(bild.breite) * EMU;
  const cy = Math.round(bild.hoehe) * EMU;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<xdr:oneCellAnchor>'
    + `<xdr:from><xdr:col>0</xdr:col><xdr:colOff>${4 * EMU}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${4 * EMU}</xdr:rowOff></xdr:from>`
    + `<xdr:ext cx="${cx}" cy="${cy}"/>`
    + '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>'
    + '<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>'
    + `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>`
    + '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>';
}

function beziehung(typ: string, ziel: string): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${typ}" Target="${ziel}"/>`
    + '</Relationships>';
}

/** Die fertige .xlsx als Datei zum Teilen bzw. Speichern. */
export function xlsxDatei(tabellen: Tabelle[], name: string): File {
  // fflate legt immer einen gewoehnlichen ArrayBuffer an, nie einen geteilten.
  return new File([xlsxErzeugen(tabellen) as Uint8Array<ArrayBuffer>], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Mehrere Tabellen als eine .xlsx. Die erste ist beim Oeffnen aktiv. */
export function xlsxErzeugen(tabellen: Tabelle[]): Uint8Array {
  const n = tabellen.length;
  const nummern = tabellen.map((_, i) => i + 1);
  const dateien: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Default Extension="png" ContentType="image/png"/>'
      + '<Default Extension="jpeg" ContentType="image/jpeg"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + nummern.map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + tabellen.map((t, i) => t.bild ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : '').join('')
      + '</Types>'),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets>' + tabellen.map((t, i) => `<sheet name="${xml(t.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>'
      // Der Filter braucht diesen Namen, sonst repariert Excel die Datei beim Oeffnen.
      + '<definedNames>' + tabellen.map((t, i) => t.kopf
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(t.name)}'!${filterBereich(t, true)}</definedName>`
        : '').join('') + '</definedNames>'
      + '</workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + nummern.map((i) => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')
      + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>'),
    'xl/styles.xml': strToU8(STILE),
  };
  tabellen.forEach((t, i) => {
    const nr = i + 1;
    dateien[`xl/worksheets/sheet${nr}.xml`] = strToU8(blattXml(t, Boolean(t.bild)));
    if (!t.bild) return;
    const bildDatei = `bild${nr}.${t.bild.typ}`;
    dateien[`xl/media/${bildDatei}`] = t.bild.daten;
    dateien[`xl/drawings/drawing${nr}.xml`] = strToU8(zeichnungXml(t.bild));
    dateien[`xl/drawings/_rels/drawing${nr}.xml.rels`] = strToU8(beziehung('image', `../media/${bildDatei}`));
    dateien[`xl/worksheets/_rels/sheet${nr}.xml.rels`] = strToU8(beziehung('drawing', `../drawings/drawing${nr}.xml`));
  });
  return zipSync(dateien, { level: 6 });
}

// ----------------------------------------------------------------- Lesen

/** Ob die Bytes ein Zip sind (xlsx) — sonst wird es als CSV versucht. */
export function istZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function dom(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

/** Elemente nach lokalem Namen — manche Programme schreiben "x:c" statt "c". */
function alle(el: Document | Element, name: string): Element[] {
  return Array.from(el.getElementsByTagNameNS('*', name));
}

/** "AB12" -> 27 */
function spalteAus(ref: string): number {
  const buchstaben = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  return [...buchstaben].reduce((n, b) => n * 26 + b.charCodeAt(0) - 64, 0) - 1;
}

/** Text eines <si> oder <is>: auch formatierter Text besteht aus mehreren <t>. */
function textVon(el: Element): string {
  return alle(el, 't')
    // Lautschrift (japanische Excel-Dateien) gehoert nicht zum Wert.
    .filter((t) => t.parentElement?.localName !== 'rPh')
    .map((t) => t.textContent ?? '').join('');
}

/**
 * Ein Blatt einer .xlsx als Zeilen aus Texten. Bevorzugt das Blatt `wunsch`,
 * sonst das erste. Zahlen kommen so, wie Excel sie speichert — eine als
 * Zahl eingetippte EAN also ohne fuehrende Null.
 */
export function xlsxLesen(bytes: Uint8Array, wunsch?: string): string[][] {
  const zip = unzipSync(bytes, {
    // Bilder und Makros braucht hier niemand — nur auspacken, was gelesen wird.
    filter: (d) => (d.name.startsWith('xl/') && d.name.endsWith('.xml')) || d.name.endsWith('.rels'),
  });
  const lies = (pfad: string) => (zip[pfad] ? strFromU8(zip[pfad]) : null);

  const mappe = lies('xl/workbook.xml');
  if (!mappe) throw new Error('Keine Excel-Arbeitsmappe.');
  const blaetter = alle(dom(mappe), 'sheet');
  if (!blaetter.length) throw new Error('Die Arbeitsmappe hat kein Blatt.');
  const blatt = blaetter.find((b) => b.getAttribute('name')?.trim().toLowerCase() === wunsch?.toLowerCase())
    ?? blaetter[0]!;

  // Welche Datei zum Blatt gehoert, steht in den Beziehungen — sheet1.xml ist
  // nicht zwingend das erste Blatt, wenn jemand Blaetter umsortiert hat.
  const rid = blatt.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    ?? blatt.getAttribute('r:id');
  const rels = lies('xl/_rels/workbook.xml.rels');
  let ziel = 'xl/worksheets/sheet1.xml';
  if (rels && rid) {
    const rel = alle(dom(rels), 'Relationship').find((r) => r.getAttribute('Id') === rid);
    const t = rel?.getAttribute('Target');
    if (t) ziel = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
  }
  const blattText = lies(ziel);
  if (!blattText) throw new Error('Das Blatt ließ sich nicht lesen.');

  const geteilt = lies('xl/sharedStrings.xml');
  const texte = geteilt ? alle(dom(geteilt), 'si').map(textVon) : [];

  const ergebnis: string[][] = [];
  for (const row of alle(dom(blattText), 'row')) {
    const r = Number(row.getAttribute('r')) - 1;
    const zeile: string[] = [];
    let naechste = 0;
    for (const c of alle(row, 'c')) {
      const ref = c.getAttribute('r');
      const sp = ref ? spalteAus(ref) : naechste;
      naechste = sp + 1;
      const typ = c.getAttribute('t');
      const v = alle(c, 'v')[0]?.textContent ?? '';
      let wert: string;
      if (typ === 's') wert = texte[Number(v)] ?? '';
      else if (typ === 'inlineStr') wert = alle(c, 'is')[0] ? textVon(alle(c, 'is')[0]!) : '';
      else if (typ === 'b') wert = v === '1' ? 'WAHR' : 'FALSCH';
      else if (typ === 'str' || typ === 'e') wert = v;
      // Zahl: "4.006381333931E+12" ausschreiben, sonst stuende die EAN mit Exponent da.
      else wert = v && Number.isFinite(Number(v)) ? zahlAlsText(Number(v)) : v;
      zeile[sp] = wert;
    }
    // Leere Zellen zwischendrin als '' statt Loecher im Array.
    ergebnis[r >= 0 ? r : ergebnis.length] = Array.from(zeile, (w) => w ?? '');
  }
  return Array.from(ergebnis, (z) => z ?? []);
}

function zahlAlsText(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return BigInt(n).toString();
  return String(n).replace('.', ',');
}

/**
 * CSV als Zeilen — fuer alle, die die Liste als CSV speichern. Trennzeichen
 * ist, was in der ersten Zeile am haeufigsten vorkommt: Semikolon (deutsches
 * Excel), Komma oder Tabulator.
 */
export function csvLesen(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const erste = text.split(/\r?\n/, 1)[0] ?? '';
  const trenner = [';', ',', '\t'].reduce((best, t) =>
    erste.split(t).length > erste.split(best).length ? t : best, ';');

  const zeilen: string[][] = [];
  let zeile: string[] = [];
  let feld = '';
  let inAnf = false;
  for (let i = 0; i < text.length; i++) {
    const z = text[i]!;
    if (inAnf) {
      if (z === '"' && text[i + 1] === '"') { feld += '"'; i++; }
      else if (z === '"') inAnf = false;
      else feld += z;
    } else if (z === '"' && feld === '') inAnf = true;
    else if (z === trenner) { zeile.push(feld); feld = ''; }
    else if (z === '\n' || z === '\r') {
      if (z === '\r' && text[i + 1] === '\n') i++;
      zeile.push(feld); zeilen.push(zeile); zeile = []; feld = '';
    } else feld += z;
  }
  if (feld !== '' || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
  return zeilen;
}
