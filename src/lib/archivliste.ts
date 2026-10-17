import { db, einstellungenLesen, einstellungenSchreiben } from '../db';
import type { Artikel, EtikettArt, EtikettCode } from '../model';
import { codePruefen, eigenerCode } from './codes';
import { ordnerAngleichen, ordnerListe } from './ordner';
import { datumSortierbar } from './format';
import { csvLesen, istZip, xlsxDatei, xlsxLesen, type Auswahl, type Tabelle } from './xlsx';

/**
 * Das Archiv als Excel-Liste: Vorlage zum Befuellen, Ausgabe des Bestands
 * und Einlesen. Gedacht fuers Buero, wo Artikel ohnehin in Listen stehen —
 * etwa vom Grosshaendler mit EAN.
 *
 * Anders als Schein-PDF und -Excel traegt diese Liste die Codes: sie ist ein
 * Pflegewerkzeug fuers Archiv, nichts, was zum Kunden geht.
 *
 * Einlesen kommt **dazu**, wie beim weitergegebenen Archiv: Codes kommen zu
 * den vorhandenen, Einheit, Ordner und Artikelnummer der Liste gelten.
 * Weg kommt nur, was ausdruecklich dasteht — „Ohne Ordner" nimmt einen
 * Artikel aus seinem Ordner, „Ja" unter „Löschen" nimmt ihn aus dem Archiv.
 * Eine Zeile, die fehlt, loescht nichts: sonst raeumte die Liste vom
 * Grosshaendler das halbe Archiv ab.
 */

const BLATT = 'Artikel';

const SPALTEN: Tabelle['spalten'] = [
  { titel: 'Bezeichnung', breite: 46 },
  // Als Text: Artikelnummern haben oft fuehrende Nullen.
  { titel: 'Artikelnummer', breite: 18, text: true },
  { titel: 'Einheit', breite: 10 },
  { titel: 'Ordner', breite: 20 },
  { titel: 'Codes', breite: 34, text: true },
  // Wie das Etikett aussieht — leer gilt die Vorgabe der App.
  { titel: 'Etikett', breite: 12 },
  { titel: 'Etikett-Inhalt', breite: 18 },
  { titel: 'Etiketten Stück', breite: 15, zahl: true },
  { titel: 'Löschen', breite: 10 },
];

const spalte = (titel: string) => SPALTEN.findIndex((s) => s.titel === titel);

/** Die Worte in der Liste. Ohne Komma — Excel-Auswahllisten trennen damit. */
const ART_WORT: Record<EtikettArt, string> = { qr: 'QR', strich: 'Strichcode' };
const INHALT_WORT: Record<EtikettCode, string> = { eigen: 'Eigener Code', nummer: 'Artikelnummer', name: 'Bezeichnung' };
const WIE_EINGESTELLT = 'Wie eingestellt';
/** In der Spalte Ordner: aus dem Ordner nehmen. Leer laesst ihn, wie er ist. */
const OHNE_ORDNER = 'Ohne Ordner';
const JA = 'Ja';

function auswahlen(einheiten: string[], ordner: string[]): Auswahl[] {
  // Excel nimmt hoechstens 255 Zeichen Auswahl — bei vielen Ordnern bleibt
  // nur „Ohne Ordner", die Namen tippt man dann wie bisher.
  const ordnerWerte = [OHNE_ORDNER, ...ordner];
  return [
    { spalte: spalte('Einheit'), werte: einheiten,
      titel: 'Einheit', hinweis: 'Diese Einheit kennt die App noch nicht. Sie wird beim Einlesen dazugenommen.' },
    { spalte: spalte('Ordner'), werte: ordnerWerte.join(',').length > 250 ? [OHNE_ORDNER] : ordnerWerte,
      titel: 'Ordner', hinweis: 'Diesen Ordner gibt es noch nicht. Er wird beim Einlesen angelegt.' },
    { spalte: spalte('Löschen'), werte: [JA],
      titel: 'Löschen', hinweis: 'Bitte „Ja“ zum Löschen – sonst bleibt der Artikel.' },
    { spalte: spalte('Etikett'), werte: Object.values(ART_WORT),
      titel: 'Etikett', hinweis: 'Bitte QR oder Strichcode – sonst bleibt es, wie es ist.' },
    { spalte: spalte('Etikett-Inhalt'), werte: [WIE_EINGESTELLT, ...Object.values(INHALT_WORT)],
      titel: 'Etikett-Inhalt', hinweis: 'Bitte einen Wert aus der Liste – sonst bleibt es, wie es ist.' },
  ];
}

// ------------------------------------------------------------- Ausgeben

const ANLEITUNG = [
  'So wird die Liste befüllt',
  'Im Blatt „Artikel“ steht je Zeile ein Artikel. Die erste Zeile mit den Spaltenköpfen bitte stehen lassen.',
  'Bezeichnung (Pflicht): so, wie sie auf dem Schein stehen soll, etwa „NYM-J 3x1,5“. Gibt es den Artikel im Archiv schon unter genau diesem Namen, wird er ergänzt statt doppelt angelegt.',
  'Artikelnummer (freiwillig): etwa die Nummer des Großhändlers oder aus der eigenen Warenwirtschaft. Sie steht beim Senden auf PDF und Excel des Materialscheins, so kann das Büro ohne Nachschlagen bestellen und verrechnen. Die Spalte ist als Text formatiert, führende Nullen bleiben. Leer heißt bei vorhandenen Artikeln: die Nummer bleibt, wie sie ist.',
  'Einheit: aus der Auswahl wählen. Eine Einheit, die die App noch nicht kennt, wird beim Einlesen dazugenommen. Leer heißt bei neuen Artikeln „Stk“, bei vorhandenen bleibt die bisherige.',
  'Ordner (freiwillig): etwa „Kabel“, „Schaltermaterial“ oder „Loxone“. Im Archiv liegen die Artikel dann in diesen Ordnern, beim Aufschreiben findet man sie auch darüber. Ein neuer Name wird ein neuer Ordner. „Ohne Ordner“ (in der Auswahl) nimmt den Artikel aus seinem Ordner; leer heißt bei vorhandenen Artikeln: der Ordner bleibt, wie er ist. Einen Ordner umbenennen: bei allen seinen Artikeln den neuen Namen eintragen.',
  'Codes (freiwillig): die Nummer unter dem Strichcode (EAN) oder ein eigener Code „MB-…“. Mehrere Codes mit Komma trennen. Die Spalte ist als Text formatiert – bitte so lassen, sonst macht Excel aus einer EAN „4,00638E+12“ und streicht führende Nullen.',
  '',
  'Etiketten (alles freiwillig)',
  'Etikett: „QR“ oder „Strichcode“ – welcher Code auf das gedruckte Etikett kommt. Leer heißt bei neuen Artikeln QR. Passt ein Strichcode nicht aufs Etikett (zu langer Text, Umlaute, zu kleines Etikett), druckt die App stattdessen einen QR-Code und sagt das.',
  'Etikett-Inhalt: was im Code steht. „Eigener Code“ ist der kurze Code der App („MB-…“). „Artikelnummer“ oder „Bezeichnung“ kann auch ein anderer Scanner im Betrieb lesen; ein Artikel ohne Nummer bekommt dann doch den eigenen Code. „Wie eingestellt“ folgt der Wahl unter Einstellungen › Etiketten.',
  'Etiketten Stück: wie viele Etiketten der Druck für diesen Artikel vorschlägt, etwa eines je Lagerfach. Leer heißt eines. Beim Drucken lässt sich die Zahl noch ändern.',
  'Leer heißt bei vorhandenen Artikeln in allen drei Spalten: es bleibt, wie es ist.',
  '',
  'Löschen',
  'Löschen: „Ja“ nimmt den Artikel samt seinen Codes aus dem Archiv. Die übrigen Spalten der Zeile zählen dann nicht. Leer heißt: der Artikel bleibt.',
  'Eine Zeile einfach herauszulöschen, löscht den Artikel nicht – er bleibt im Archiv. So kann auch eine Teilliste oder die Liste vom Großhändler nichts abräumen.',
  '',
  'Einlesen',
  'Als .xlsx speichern (CSV geht auch) und in MaterialBlitz unter Einstellungen › Archiv › „Excel-Liste einlesen“ wählen. Vorher zeigt die App, was dazukommt, was sich ändert und was gelöscht wird.',
  'Artikel, die nicht in der Liste stehen, bleiben. Codes kommen zu den vorhandenen dazu. Ein Code gehört genau einem Artikel – hing er bisher an einem anderen, wandert er herüber.',
  'Weitere Spalten (Preis, Hersteller …) stören nicht, sie werden übergangen. Die Spalten werden auch erkannt, wenn sie „Artikel“, „Material“, „Art.-Nr.“, „EAN“ oder „Strichcode“ heißen – eine Liste vom Großhändler lässt sich oft direkt einlesen.',
  '',
  'Material ohne Strichcode',
  'Beim Einlesen kann jeder Artikel ohne Code gleich einen eigenen Code bekommen. Im Archiv druckt „Etiketten drucken“ dazu QR- oder Strichcode-Etiketten. Wer die Liste danach wieder ausgibt, sieht die vergebenen Codes in der Spalte „Codes“.',
  '',
  'Bestehende Scheine ändern sich durch nichts davon – ihre Positionen sind Abschriften.',
];

function anleitung(): Tabelle {
  return {
    name: 'Anleitung',
    spalten: [{ titel: 'MaterialBlitz – Archivliste', breite: 110 }],
    zeilen: ANLEITUNG.map((z) => [z]),
    umbruch: true,
  };
}

/** Leere Vorlage mit Auswahlliste der Einheiten und Anleitung. */
export async function vorlageErzeugen(): Promise<File> {
  const [{ einheiten }, alle] = await Promise.all([einstellungenLesen(), db.artikel.toArray()]);
  const artikel: Tabelle = {
    name: BLATT, spalten: SPALTEN, zeilen: [], kopf: true, auswahl: auswahlen(einheiten, ordnerListe(alle)),
  };
  return xlsxDatei([artikel, anleitung()], 'MaterialBlitz_Archiv_Vorlage.xlsx');
}

/**
 * Das ganze Archiv als Liste — im selben Aufbau wie die Vorlage, damit sie
 * bearbeitet und wieder eingelesen werden kann. "Verwendet" ist nur zur
 * Auskunft und wird beim Einlesen uebergangen.
 */
export async function archivAlsExcel(): Promise<File> {
  const [{ einheiten }, alle] = await Promise.all([einstellungenLesen(), db.artikel.toArray()]);
  alle.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const artikel: Tabelle = {
    name: BLATT,
    spalten: [...SPALTEN, { titel: 'Verwendet', breite: 11 }],
    // Das Etikett ausgeschrieben, auch wo die Vorgabe gilt: so sieht man,
    // was gedruckt wuerde, und kann es gleich umstellen.
    zeilen: alle.map((a) => [
      a.name, a.nummer ?? '', a.einheit, a.ordner ?? '', (a.codes ?? []).join(', '),
      ART_WORT[a.etikettArt ?? 'qr'], a.etikettInhalt ? INHALT_WORT[a.etikettInhalt] : WIE_EINGESTELLT,
      String(a.etikettStueck ?? 1), '', String(a.anzahl),
    ]),
    kopf: true,
    auswahl: auswahlen(einheiten, ordnerListe(alle)),
  };
  return xlsxDatei([artikel, anleitung()], `MaterialBlitz_Archiv_${datumSortierbar(Date.now())}.xlsx`);
}

// ---------------------------------------------------------------- Lesen

export interface Eintrag {
  name: string;
  /** Fehlt, wenn die Zelle leer war — dann bleibt die bisherige Einheit. */
  einheit?: string;
  /** Ebenso: leer laesst den bisherigen Ordner. null: „Ohne Ordner". */
  ordner?: string | null;
  /** Ebenso: leer laesst die bisherige Artikelnummer. */
  nummer?: string;
  codes: string[];
  /** Fehlt: bleibt. */
  etikettArt?: EtikettArt;
  /** Fehlt: bleibt. null: zurueck auf "wie eingestellt". */
  etikettInhalt?: EtikettCode | null;
  /** Fehlt: bleibt. 1 ist die Vorgabe. */
  etikettStueck?: number;
  /** Aus dem Archiv nehmen — dann zaehlt sonst nichts aus der Zeile. */
  loeschen?: true;
}

export interface Liste {
  eintraege: Eintrag[];
  /** Was beim Lesen auffiel; die Zeile ist trotzdem dabei, nur ohne das Fehlerhafte. */
  hinweise: string[];
  /** Einheiten aus der Liste, die die App noch nicht kennt. */
  neueEinheiten: string[];
  /** Ordner aus der Liste, die es im Archiv noch nicht gibt. */
  neueOrdner: string[];
}

/** Kopfzeile erkennen — auch in Listen anderer Herkunft. */
type Art = 'name' | 'nummer' | 'einheit' | 'ordner' | 'codes' | 'art' | 'inhalt' | 'stueck' | 'loeschen';
const KEINE: Record<Art, number> = {
  name: -1, nummer: -1, einheit: -1, ordner: -1, codes: -1, art: -1, inhalt: -1, stueck: -1, loeschen: -1,
};

/** Fuer Vergleiche: klein, ohne Leer- und Satzzeichen. */
function wort(text: string): string {
  return text.toLowerCase().replace(/[^a-zäöüß0-9]/g, '');
}

function spaltenArt(titel: string): Art | null {
  const t = wort(titel).replace(/[0-9]/g, '');
  if (['etikett', 'etikettart', 'etikettenart', 'codeart', 'etikettcodeart'].includes(t)) return 'art';
  if (['etikettinhalt', 'etiketteninhalt', 'codeinhalt', 'inhaltdescodes'].includes(t)) return 'inhalt';
  if (['etikettenstück', 'etikettenstueck', 'etikettstück', 'etikettstueck', 'etikettenanzahl',
    'anzahletiketten'].includes(t)) return 'stueck';
  if (['löschen', 'loeschen', 'entfernen', 'artikellöschen', 'artikelloeschen'].includes(t)) return 'loeschen';
  // Vor dem Namen pruefen: "Artikelnummer" ist nicht "Artikel". Ein blosses
  // "Nr." bleibt aussen vor — oft ist das nur die laufende Zeilennummer.
  if (['artikelnummer', 'artikelnr', 'artnr', 'artikelno', 'nummer', 'materialnummer', 'materialnr',
    'matnr', 'bestellnummer', 'bestellnr', 'lieferantenartikelnummer', 'sku'].includes(t)) return 'nummer';
  if (['bezeichnung', 'artikel', 'artikelbezeichnung', 'artikelname', 'name', 'material',
    'materialbezeichnung', 'beschreibung', 'kurztext', 'text'].includes(t)) return 'name';
  if (['einheit', 'me', 'mengeneinheit', 'eh', 'unit', 'masseinheit', 'maßeinheit'].includes(t)) return 'einheit';
  if (['ordner', 'gruppe', 'kategorie', 'artikelgruppe', 'materialgruppe', 'bereich'].includes(t)) return 'ordner';
  if (['codes', 'code', 'ean', 'eancode', 'eannummer', 'gtin', 'eangtin', 'strichcode', 'barcode',
    'qr', 'qrcode', 'codesean'].includes(t)) return 'codes';
  return null;
}

/** Datei in Zeilen zerlegen — .xlsx oder CSV, egal wie sie heisst. */
async function zeilenAus(d: File): Promise<string[][]> {
  const bytes = new Uint8Array(await d.arrayBuffer());
  if (istZip(bytes)) return xlsxLesen(bytes, BLATT);
  // Altes .xls ist ein Binaerformat, das hier niemand lesen kann.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    throw new Error('Das ist eine alte Excel-Datei (.xls). Bitte in Excel als „Excel-Arbeitsmappe (.xlsx)“ speichern.');
  }
  return csvLesen(new TextDecoder().decode(bytes));
}

export async function listeLesen(d: File): Promise<Liste | { fehler: string }> {
  let zeilen: string[][];
  try {
    zeilen = await zeilenAus(d);
  } catch (e) {
    return { fehler: e instanceof Error && e.message ? e.message : 'Die Datei ließ sich nicht lesen.' };
  }

  // Die Kopfzeile muss nicht ganz oben stehen: Listen vom Grosshaendler
  // haben oft erst ein paar Zeilen Briefkopf.
  let kopf = -1;
  let sp: Record<Art, number> = { ...KEINE };
  for (let r = 0; r < Math.min(zeilen.length, 15) && kopf < 0; r++) {
    const s = { ...KEINE };
    (zeilen[r] ?? []).forEach((t, i) => {
      const art = spaltenArt(t);
      if (art && s[art] < 0) s[art] = i;
    });
    if (s.name >= 0) { kopf = r; sp = s; }
  }
  if (kopf < 0) {
    return { fehler: 'Keine Spalte „Bezeichnung“ gefunden. Am einfachsten die Vorlage verwenden – die erste Zeile trägt dort die Spaltenköpfe.' };
  }

  const [{ einheiten }, bestand] = await Promise.all([einstellungenLesen(), db.artikel.toArray()]);
  const bekannt = new Map(einheiten.map((u) => [u.toLowerCase(), u]));
  const neueEinheiten: string[] = [];
  const ordnerBekannt = ordnerListe(bestand);
  const bestandNamen = new Set(bestand.map((a) => a.name));
  const neueOrdner: string[] = [];
  const hinweise: string[] = [];
  const nachName = new Map<string, Eintrag>();
  const zeileVonName = new Map<string, number>();
  const zeileVonCode = new Map<string, number>();

  for (let r = kopf + 1; r < zeilen.length; r++) {
    const z = zeilen[r] ?? [];
    const nr = r + 1; // so, wie Excel die Zeile nummeriert
    const zelle = (i: number) => (i >= 0 ? (z[i] ?? '').trim() : '');
    const name = zelle(sp.name).replace(/\s+/g, ' ');
    const einheitRoh = zelle(sp.einheit);
    const codesRoh = zelle(sp.codes);
    const ordnerRoh = zelle(sp.ordner);
    const nummer = zelle(sp.nummer).replace(/\s+/g, ' ') || undefined;
    const artRoh = zelle(sp.art);
    const inhaltRoh = zelle(sp.inhalt);
    const stueckRoh = zelle(sp.stueck);
    const loeschenRoh = zelle(sp.loeschen);
    if (!name) {
      if (einheitRoh || codesRoh || ordnerRoh || nummer || artRoh || inhaltRoh || stueckRoh || loeschenRoh) {
        hinweise.push(`Zeile ${nr}: keine Bezeichnung – übergangen.`);
      }
      continue;
    }

    // Loeschen zuerst: dann zaehlt der Rest der Zeile nicht, auch kein Code
    // und keine neue Einheit.
    if (loeschenRoh) {
      const w = wort(loeschenRoh);
      if (['ja', 'j', 'x', 'löschen', 'loeschen', 'weg', 'entfernen', 'yes', '1'].includes(w)) {
        const da = nachName.get(name);
        if (da) {
          hinweise.push(`Zeile ${nr}: „${name}“ stand schon in Zeile ${zeileVonName.get(name)} – wird gelöscht.`);
          da.loeschen = true;
        } else if (!bestandNamen.has(name)) {
          hinweise.push(`Zeile ${nr}: „${name}“ steht nicht im Archiv – nichts zu löschen.`);
        } else {
          nachName.set(name, { name, codes: [], loeschen: true });
          zeileVonName.set(name, nr);
        }
        continue;
      }
      if (!['nein', 'n', '0', 'no'].includes(w)) {
        hinweise.push(`Zeile ${nr}: Löschen „${loeschenRoh}“ unbekannt – bitte „Ja“ oder leer. Der Artikel bleibt.`);
      }
    }

    let einheit: string | undefined;
    if (einheitRoh) {
      einheit = bekannt.get(einheitRoh.toLowerCase());
      if (!einheit) {
        einheit = einheitRoh;
        bekannt.set(einheitRoh.toLowerCase(), einheitRoh);
        neueEinheiten.push(einheitRoh);
      }
    }

    // Schreibweise angleichen: aus "kabel" in Zeile 40 wird kein zweiter Ordner.
    // Ein Strich oder „Ohne Ordner" nimmt den Artikel heraus.
    const ohne = ['ohneordner', 'ohne', 'kein', 'keiner', 'keinordner'].includes(wort(ordnerRoh))
      || /^[-–—]+$/.test(ordnerRoh);
    const ordner = ohne ? null : ordnerAngleichen(ordnerRoh, ordnerBekannt);
    if (ordner && !ordnerBekannt.includes(ordner)) {
      ordnerBekannt.push(ordner);
      neueOrdner.push(ordner);
    }

    const codes: string[] = [];
    for (const roh of codesRoh.split(/[,;|\n]+/).map((c) => c.trim()).filter(Boolean)) {
      const p = codePruefen(roh);
      if ('fehler' in p) { hinweise.push(`Zeile ${nr}: Code „${roh}“ übergangen. ${p.fehler}`); continue; }
      const schon = zeileVonCode.get(p.code);
      if (schon !== undefined && schon !== nr) {
        hinweise.push(`Zeile ${nr}: Code ${p.code} steht schon in Zeile ${schon} – hier übergangen.`);
        continue;
      }
      zeileVonCode.set(p.code, nr);
      if (!codes.includes(p.code)) codes.push(p.code);
    }

    // Etikett: was nicht zu deuten ist, bleibt weg — mit Hinweis.
    let etikettArt: EtikettArt | undefined;
    if (artRoh) {
      const w = wort(artRoh);
      if (['qr', 'qrcode'].includes(w)) etikettArt = 'qr';
      else if (['strichcode', 'strich', 'barcode', 'code128'].includes(w)) etikettArt = 'strich';
      else hinweise.push(`Zeile ${nr}: Etikett „${artRoh}“ unbekannt – bitte QR oder Strichcode.`);
    }
    let etikettInhalt: EtikettCode | null | undefined;
    if (inhaltRoh) {
      const w = wort(inhaltRoh);
      if (['wieeingestellt', 'standard', 'vorgabe'].includes(w)) etikettInhalt = null;
      else if (['eigenercode', 'eigener', 'eigen', 'mbcode'].includes(w)) etikettInhalt = 'eigen';
      else if (['artikelnummer', 'nummer', 'artnr', 'artikelnr'].includes(w)) etikettInhalt = 'nummer';
      else if (['bezeichnung', 'name', 'artikelbezeichnung'].includes(w)) etikettInhalt = 'name';
      else hinweise.push(`Zeile ${nr}: Etikett-Inhalt „${inhaltRoh}“ unbekannt – übergangen.`);
    }
    let etikettStueck: number | undefined;
    if (stueckRoh) {
      const n = Number(stueckRoh.replace(',', '.'));
      if (Number.isInteger(n) && n >= 1 && n <= 999) etikettStueck = n;
      else hinweise.push(`Zeile ${nr}: Etiketten Stück „${stueckRoh}“ – bitte eine ganze Zahl von 1 bis 999.`);
    }
    const etikett = {
      ...(etikettArt ? { etikettArt } : {}),
      ...(etikettInhalt !== undefined ? { etikettInhalt } : {}),
      ...(etikettStueck ? { etikettStueck } : {}),
    };

    const da = nachName.get(name);
    if (da?.loeschen) {
      hinweise.push(`Zeile ${nr}: „${name}“ wird laut Zeile ${zeileVonName.get(name)} gelöscht – hier übergangen.`);
      continue;
    }
    if (da) {
      hinweise.push(`Zeile ${nr}: „${name}“ stand schon in Zeile ${zeileVonName.get(name)} – zusammengefasst.`);
      if (einheit) da.einheit = einheit;
      if (ordner !== undefined) da.ordner = ordner;
      if (nummer) da.nummer = nummer;
      Object.assign(da, etikett);
      for (const c of codes) if (!da.codes.includes(c)) da.codes.push(c);
      continue;
    }
    nachName.set(name, { name, einheit, ordner, nummer, codes, ...etikett });
    zeileVonName.set(name, nr);
  }

  return { eintraege: [...nachName.values()], hinweise, neueEinheiten, neueOrdner };
}

// ------------------------------------------------------------ Einspielen

export interface Wirkung {
  neu: number;
  /** Artikel aus der Liste, die es schon gab und die sich aendern. */
  geaendert: number;
  /** Artikel aus der Liste, an denen sich nichts aendert. */
  gleich: number;
  /** Codes, die bisher an einem anderen Artikel hingen. */
  gewandert: number;
  /** Neu vergebene eigene Codes. */
  eigene: number;
  /** Bezeichnungen der Artikel, die aus dem Archiv kommen. */
  geloescht: string[];
}

/**
 * Die Liste auf einen Artikelbestand anwenden — im Speicher. Dieselbe
 * Rechnung liefert die Vorschau (auf einer Kopie) und das Einspielen, damit
 * die angekuendigten Zahlen auch eintreten.
 */
function anwenden(liste: Liste, bestand: Artikel[], eigeneCodes: boolean) {
  const nachName = new Map(bestand.map((a) => [a.name, a]));
  const nachCode = new Map<string, Artikel>();
  for (const a of bestand) for (const c of a.codes ?? []) nachCode.set(c, a);

  const neue: Artikel[] = [];
  const veraendert = new Set<Artikel>();
  const weg: Artikel[] = [];
  const wirkung: Wirkung = { neu: 0, geaendert: 0, gleich: 0, gewandert: 0, eigene: 0, geloescht: [] };

  // Erst loeschen: ihre Codes werden frei, und ein Code, der zu einem
  // anderen Artikel wandert, holt den geloeschten nicht als "veraendert" zurueck.
  for (const e of liste.eintraege) {
    const a = e.loeschen ? nachName.get(e.name) : undefined;
    if (!a) continue;
    nachName.delete(a.name);
    for (const c of a.codes ?? []) nachCode.delete(c);
    weg.push(a);
    wirkung.geloescht.push(a.name);
  }

  for (const e of liste.eintraege) {
    if (e.loeschen) continue;
    let a = nachName.get(e.name);
    const warNeu = !a;
    if (!a) {
      a = {
        name: e.name, einheit: e.einheit ?? 'Stk', anzahl: 0, codes: [],
        ...(e.ordner ? { ordner: e.ordner } : {}), ...(e.nummer ? { nummer: e.nummer } : {}),
      };
      nachName.set(e.name, a);
      neue.push(a);
    }
    let anders = false;
    if (!warNeu && e.einheit && e.einheit !== a.einheit) { a.einheit = e.einheit; anders = true; }
    if (!warNeu && e.ordner && e.ordner !== a.ordner) { a.ordner = e.ordner; anders = true; }
    if (!warNeu && e.ordner === null && a.ordner !== undefined) { delete a.ordner; anders = true; }
    if (!warNeu && e.nummer && e.nummer !== a.nummer) { a.nummer = e.nummer; anders = true; }

    // Etikett: die Vorgabe (QR, wie eingestellt, 1 Stueck) wird nicht
    // gespeichert, sondern das Feld entfernt — so bleibt der Artikel schlank.
    const etikett: Partial<Artikel> = {};
    if (e.etikettArt) etikett.etikettArt = e.etikettArt === 'strich' ? 'strich' : undefined;
    if (e.etikettInhalt !== undefined) etikett.etikettInhalt = e.etikettInhalt ?? undefined;
    if (e.etikettStueck !== undefined) etikett.etikettStueck = e.etikettStueck > 1 ? e.etikettStueck : undefined;
    for (const [feld, wert] of Object.entries(etikett) as Array<[keyof Artikel, unknown]>) {
      if (a[feld] === wert) continue;
      if (wert === undefined) delete a[feld];
      else (a as unknown as Record<string, unknown>)[feld] = wert;
      if (!warNeu) anders = true;
    }

    for (const c of e.codes) {
      const traeger = nachCode.get(c);
      if (traeger === a) continue;
      if (traeger) {
        // Ein Code gehoert hoechstens einem Artikel: beim bisherigen loesen.
        traeger.codes = (traeger.codes ?? []).filter((x) => x !== c);
        if (traeger.id !== undefined) veraendert.add(traeger);
        wirkung.gewandert++;
      }
      a.codes = [...(a.codes ?? []), c];
      nachCode.set(c, a);
      anders = true;
    }

    // Etiketten tragen immer den eigenen Code — wer gar keinen Code hat,
    // bekommt ihn auf Wunsch gleich jetzt statt erst beim Drucken.
    if (eigeneCodes && !a.codes?.length) {
      let c = eigenerCode();
      while (nachCode.has(c)) c = eigenerCode();
      a.codes = [c];
      nachCode.set(c, a);
      wirkung.eigene++;
      anders = true;
    }

    if (warNeu) wirkung.neu++;
    else if (anders) { veraendert.add(a); wirkung.geaendert++; }
    else wirkung.gleich++;
  }
  return { neue, veraendert: [...veraendert], weg, wirkung };
}

/** Was das Einlesen bewirken wuerde — ohne etwas zu schreiben. */
export async function vorschau(liste: Liste, eigeneCodes: boolean): Promise<Wirkung> {
  return anwenden(liste, structuredClone(await db.artikel.toArray()), eigeneCodes).wirkung;
}

/**
 * Einlesen. Zaehlt nicht als neue Artikel fuer die Sicherungs-Erinnerung:
 * die Liste ist selbst die Sicherung und laesst sich jederzeit wiederholen.
 */
export async function listeEinspielen(liste: Liste, eigeneCodes: boolean): Promise<Wirkung> {
  return db.transaction('rw', [db.artikel, db.einstellungen], async () => {
    const e = await einstellungenLesen();
    const fehlend = liste.neueEinheiten.filter((u) => !e.einheiten.includes(u));
    if (fehlend.length) await einstellungenSchreiben({ einheiten: [...e.einheiten, ...fehlend] });

    const { neue, veraendert, weg, wirkung } = anwenden(liste, await db.artikel.toArray(), eigeneCodes);
    if (weg.length) await db.artikel.bulkDelete(weg.map((a) => a.id!));
    if (veraendert.length) await db.artikel.bulkPut(veraendert);
    if (neue.length) {
      // Ohne Codes kein leeres Feld: so sehen sie aus wie von Hand angelegte.
      await db.artikel.bulkAdd(neue.map(({ codes, ...a }) => (codes?.length ? { ...a, codes } : a)));
    }
    return wirkung;
  });
}

