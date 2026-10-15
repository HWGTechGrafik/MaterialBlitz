import { db, einstellungenLesen, einstellungenSchreiben } from '../db';
import type { Artikel } from '../model';
import { codePruefen, eigenerCode } from './codes';
import { ordnerAngleichen, ordnerListe } from './ordner';
import { datumSortierbar } from './format';
import { csvLesen, istZip, xlsxDatei, xlsxLesen, type Tabelle } from './xlsx';

/**
 * Das Archiv als Excel-Liste: Vorlage zum Befuellen, Ausgabe des Bestands
 * und Einlesen. Gedacht fuers Buero, wo Artikel ohnehin in Listen stehen —
 * etwa vom Grosshaendler mit EAN.
 *
 * Anders als Schein-PDF und -Excel traegt diese Liste die Codes: sie ist ein
 * Pflegewerkzeug fuers Archiv, nichts, was zum Kunden geht.
 *
 * Einlesen kommt nur **dazu**, wie beim weitergegebenen Archiv: geloescht
 * wird nichts, Codes kommen zu den vorhandenen, Einheit und Ordner der Liste gelten.
 */

const BLATT = 'Artikel';

const SPALTEN: Tabelle['spalten'] = [
  { titel: 'Bezeichnung', breite: 46 },
  { titel: 'Einheit', breite: 10 },
  { titel: 'Ordner', breite: 20 },
  { titel: 'Codes', breite: 34, text: true },
];

// ------------------------------------------------------------- Ausgeben

const ANLEITUNG = [
  'So wird die Liste befüllt',
  'Im Blatt „Artikel“ steht je Zeile ein Artikel. Die erste Zeile mit den Spaltenköpfen bitte stehen lassen.',
  'Bezeichnung (Pflicht): so, wie sie auf dem Schein stehen soll, etwa „NYM-J 3x1,5“. Gibt es den Artikel im Archiv schon unter genau diesem Namen, wird er ergänzt statt doppelt angelegt.',
  'Einheit: aus der Auswahl wählen. Eine Einheit, die die App noch nicht kennt, wird beim Einlesen dazugenommen. Leer heißt bei neuen Artikeln „Stk“, bei vorhandenen bleibt die bisherige.',
  'Ordner (freiwillig): etwa „Kabel“, „Schaltermaterial“ oder „Loxone“. Im Archiv liegen die Artikel dann in diesen Ordnern, beim Aufschreiben findet man sie auch darüber. Ein neuer Name wird ein neuer Ordner; leer heißt bei vorhandenen Artikeln: der Ordner bleibt, wie er ist.',
  'Codes (freiwillig): die Nummer unter dem Strichcode (EAN) oder ein eigener Code „MB-…“. Mehrere Codes mit Komma trennen. Die Spalte ist als Text formatiert – bitte so lassen, sonst macht Excel aus einer EAN „4,00638E+12“ und streicht führende Nullen.',
  '',
  'Einlesen',
  'Als .xlsx speichern (CSV geht auch) und in MaterialBlitz unter Einstellungen › „Archiv als Excel“ › „Excel-Liste einlesen“ wählen. Vorher zeigt die App, was dazukommt und was sich ändert.',
  'Gelöscht wird dabei nichts: Artikel, die nicht in der Liste stehen, bleiben. Codes kommen zu den vorhandenen dazu. Ein Code gehört genau einem Artikel – hing er bisher an einem anderen, wandert er herüber.',
  'Weitere Spalten (Preis, Artikelnummer …) stören nicht, sie werden übergangen. Die Spalten werden auch erkannt, wenn sie „Artikel“, „Material“, „EAN“ oder „Strichcode“ heißen – eine Liste vom Großhändler lässt sich oft direkt einlesen.',
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
  const { einheiten } = await einstellungenLesen();
  const artikel: Tabelle = { name: BLATT, spalten: SPALTEN, zeilen: [], kopf: true, auswahl: { spalte: 1, werte: einheiten } };
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
    zeilen: alle.map((a) => [a.name, a.einheit, a.ordner ?? '', (a.codes ?? []).join(', '), String(a.anzahl)]),
    kopf: true,
    auswahl: { spalte: 1, werte: einheiten },
  };
  return xlsxDatei([artikel, anleitung()], `MaterialBlitz_Archiv_${datumSortierbar(Date.now())}.xlsx`);
}

// ---------------------------------------------------------------- Lesen

export interface Eintrag {
  name: string;
  /** Fehlt, wenn die Zelle leer war — dann bleibt die bisherige Einheit. */
  einheit?: string;
  /** Ebenso: leer laesst den bisherigen Ordner. */
  ordner?: string;
  codes: string[];
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
function spaltenArt(titel: string): 'name' | 'einheit' | 'ordner' | 'codes' | null {
  const t = titel.toLowerCase().replace(/[^a-zäöüß]/g, '');
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
  let sp: Record<'name' | 'einheit' | 'ordner' | 'codes', number> = { name: -1, einheit: -1, ordner: -1, codes: -1 };
  for (let r = 0; r < Math.min(zeilen.length, 15) && kopf < 0; r++) {
    const s = { name: -1, einheit: -1, ordner: -1, codes: -1 };
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
    if (!name) {
      if (einheitRoh || codesRoh || ordnerRoh) hinweise.push(`Zeile ${nr}: keine Bezeichnung – übergangen.`);
      continue;
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
    const ordner = ordnerAngleichen(ordnerRoh, ordnerBekannt);
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

    const da = nachName.get(name);
    if (da) {
      hinweise.push(`Zeile ${nr}: „${name}“ stand schon in Zeile ${zeileVonName.get(name)} – zusammengefasst.`);
      if (einheit) da.einheit = einheit;
      if (ordner) da.ordner = ordner;
      for (const c of codes) if (!da.codes.includes(c)) da.codes.push(c);
      continue;
    }
    nachName.set(name, { name, einheit, ordner, codes });
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
  const wirkung: Wirkung = { neu: 0, geaendert: 0, gleich: 0, gewandert: 0, eigene: 0 };

  for (const e of liste.eintraege) {
    let a = nachName.get(e.name);
    const warNeu = !a;
    if (!a) {
      a = { name: e.name, einheit: e.einheit ?? 'Stk', anzahl: 0, codes: [], ...(e.ordner ? { ordner: e.ordner } : {}) };
      nachName.set(e.name, a);
      neue.push(a);
    }
    let anders = false;
    if (!warNeu && e.einheit && e.einheit !== a.einheit) { a.einheit = e.einheit; anders = true; }
    if (!warNeu && e.ordner && e.ordner !== a.ordner) { a.ordner = e.ordner; anders = true; }

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
  return { neue, veraendert: [...veraendert], wirkung };
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

    const { neue, veraendert, wirkung } = anwenden(liste, await db.artikel.toArray(), eigeneCodes);
    if (veraendert.length) await db.artikel.bulkPut(veraendert);
    if (neue.length) {
      // Ohne Codes kein leeres Feld: so sehen sie aus wie von Hand angelegte.
      await db.artikel.bulkAdd(neue.map(({ codes, ...a }) => (codes?.length ? { ...a, codes } : a)));
    }
    return wirkung;
  });
}

