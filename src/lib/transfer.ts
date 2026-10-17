import { db, einstellungenLesen, einstellungenSchreiben } from '../db';
import {
  nummernErgaenzen, projektTitel,
  type Artikel, type Baustelle, type Einstellungen, type Kunde, type Position, type Schein, type VerlaufEintrag,
} from '../model';
import { dateinameTeil, datumSortierbar, zeit, zeitKompakt } from './format';
import { vermerken } from './verlauf';

/**
 * Ein Format fuer drei Anlaesse: Uebergabe eines Scheins an einen Kollegen,
 * Sicherung des gesamten Bestands und ein Katalog-Grundstock, der mit der App
 * ausgeliefert wird. Die Kopfzeile sagt, was drinsteht, der Import-Knopf
 * erkennt es selbst.
 *
 * **Endung `.txt`, auch wenn JSON drinsteht.** Der Teilen-Dialog erlaubt kein
 * `application/json`, und eine eigene Endung ist am iPhone ebenfalls schlecht
 * (undeklarierter Dateityp).
 */
export interface Umschlag {
  mblitz: 1;
  typ: 'schein' | 'sicherung' | 'katalog';
  erzeugt: number;
  absender?: string;
  /**
   * Nur in der Dropbox-Sync-Datei, nie in einer Sicherungsdatei: der
   * Lizenzschluessel des hochladenden Geraets, damit ein neuer Schluessel
   * (etwa mit ergaenzter Firma) auf das andere Geraet wandert.
   */
  lizenz?: { schluessel: string; gesetzt: number };
  schein?: {
    bezeichnung?: string;
    positionen: Position[];
    baustelle: { ort: string; kunde?: string };
  };
  sicherung?: {
    artikel: Artikel[];
    kunden: Kunde[];
    baustellen: Baustelle[];
    scheine: Schein[];
    einstellungen: Einstellungen;
    /** Fehlt in Sicherungen aelterer Fassungen. */
    verlauf?: VerlaufEintrag[];
  };
  katalog?: {
    /** Wofuer der Grundstock gedacht ist, etwa "Elektro". */
    titel: string;
    /** Codes nur im weitergegebenen Archiv; der Grundstock hat keine. */
    artikel: Array<{ name: string; einheit: string; codes?: string[]; ordner?: string; nummer?: string } & EtikettFelder>;
    /** Einheiten, die die Artikel brauchen und die feste Liste nicht hat. */
    einheiten: string[];
    /**
     * Gesetzt, wenn ein Geraet sein Archiv weitergibt: Dann ist die Datei
     * der gepflegte Stand, und gleichnamige Artikel uebernehmen Einheit und
     * Codes. Ein Grundstock dagegen ergaenzt nur. Aeltere Fassungen der App
     * kennen das Feld nicht und ergaenzen ebenfalls nur - kein Schaden.
     */
    massgeblich?: true;
    /**
     * Die Datei traegt die Ordner. Erst dann heisst ein Artikel ohne Ordner
     * wirklich "ohne Ordner" — in Dateien aelterer Fassungen fehlt das Feld
     * einfach, und die eigene Einteilung bleibt.
     */
    mitOrdner?: true;
    /** Ebenso fuer die Etikett-Felder: fehlt eines, gilt dort die Vorgabe. */
    mitEtikett?: true;
  };
}

type EtikettFelder = Pick<Artikel, 'etikettArt' | 'etikettInhalt' | 'etikettStueck'>;

/** Nur die gesetzten Etikett-Felder — die Vorgabe steht nicht in der Datei. */
function etikettFelder(a: EtikettFelder): EtikettFelder {
  return {
    ...(a.etikettArt ? { etikettArt: a.etikettArt } : {}),
    ...(a.etikettInhalt ? { etikettInhalt: a.etikettInhalt } : {}),
    ...(a.etikettStueck ? { etikettStueck: a.etikettStueck } : {}),
  };
}

const TYP = 'text/plain';

function zuDatei(umschlag: Umschlag, name: string): File {
  return new File([JSON.stringify(umschlag, null, 1)], name, { type: TYP });
}

// ---------------------------------------------------------------- Uebergabe

export async function scheinPacken(
  schein: Schein,
  baustelle: Baustelle,
  kunde: Kunde | undefined,
  absender: string,
): Promise<File> {
  const umschlag: Umschlag = {
    mblitz: 1,
    typ: 'schein',
    erzeugt: Date.now(),
    absender,
    schein: {
      bezeichnung: schein.bezeichnung,
      // Fehlende Artikelnummern aus dem eigenen Archiv: beim Kollegen fehlen
      // sie womoeglich ganz.
      positionen: nummernErgaenzen(schein.positionen, await db.artikel.toArray()),
      // Baustelle und Kunde wandern mit: ein Schein ohne sie laesst sich
      // beim Empfaenger nicht zuordnen.
      baustelle: { ort: baustelle.ort, kunde: kunde?.name },
    },
  };
  const name = [
    'MaterialBlitz', 'Uebergabe',
    datumSortierbar(umschlag.erzeugt), zeitKompakt(umschlag.erzeugt),
    dateinameTeil(projektTitel(baustelle, kunde?.name)),
  ].join('_') + '.txt';
  return zuDatei(umschlag, name);
}

// ---------------------------------------------------------------- Sicherung

/** Der gesamte Bestand als Umschlag — fuer die Sicherungsdatei und die Dropbox. */
export async function sicherungUmschlag(absender?: string, mitLizenz = false): Promise<Umschlag> {
  const [artikel, kunden, baustellen, scheine, einstellungen, verlauf] = await Promise.all([
    db.artikel.toArray(), db.kunden.toArray(), db.baustellen.toArray(),
    db.scheine.toArray(), einstellungenLesen(), db.verlauf.toArray(),
  ]);
  return {
    mblitz: 1,
    typ: 'sicherung',
    erzeugt: Date.now(),
    absender,
    // Die Lizenz bleibt draussen: eine Sicherungsdatei waere sonst ein
    // Generalschluessel, den jeder weitergeben koennte. Nach einem
    // Geraetewechsel wird der Schluessel neu eingegeben. Nur die Sync-Datei
    // im eigenen Dropbox-Ordner traegt ihn (mitLizenz).
    lizenz: mitLizenz && einstellungen.lizenz
      ? { schluessel: einstellungen.lizenz, gesetzt: einstellungen.lizenzGesetzt ?? 0 }
      : undefined,
    sicherung: {
      artikel, kunden, baustellen, scheine,
      einstellungen: { ...einstellungen, lizenz: undefined, lizenzGesetzt: undefined },
      verlauf,
    },
  };
}

export async function sicherungPacken(): Promise<File> {
  const umschlag = await sicherungUmschlag();
  const name = `MaterialBlitz_Sicherung_${datumSortierbar(umschlag.erzeugt)}.txt`;
  return zuDatei(umschlag, name);
}

// ------------------------------------------------------------------- Archiv

/**
 * Nur das Archiv weitergeben: Artikel mit Einheit und Codes, ohne Projekte,
 * Kunden und Einstellungen. Gedacht fuer den Weg PC -> Handy (am PC wird
 * gepflegt und werden Etiketten gedruckt) und zurueck (auf der Baustelle
 * neu angelegte Artikel). Die Codes muessen mit, sonst erkennt das andere
 * Geraet die gedruckten Etiketten nicht.
 */
export async function archivPacken(absender: string | undefined): Promise<File> {
  const artikel = await db.artikel.orderBy('name').toArray();
  const umschlag: Umschlag = {
    mblitz: 1,
    typ: 'katalog',
    erzeugt: Date.now(),
    absender,
    katalog: {
      titel: 'Archiv',
      massgeblich: true,
      mitOrdner: true,
      mitEtikett: true,
      artikel: artikel.map((a) => ({
        name: a.name,
        einheit: a.einheit,
        ...(a.codes?.length ? { codes: a.codes } : {}),
        ...(a.ordner ? { ordner: a.ordner } : {}),
        ...(a.nummer ? { nummer: a.nummer } : {}),
        ...etikettFelder(a),
      })),
      einheiten: [...new Set(artikel.map((a) => a.einheit))],
    },
  };
  const name = `MaterialBlitz_Archiv_${datumSortierbar(umschlag.erzeugt)}.txt`;
  return zuDatei(umschlag, name);
}

// ------------------------------------------------------------------- Lesen

export type Vorschau =
  | { art: 'fehler'; text: string }
  | { art: 'schein'; umschlag: Umschlag; ort: string; positionen: number; absender: string; zeitpunkt: string }
  | { art: 'sicherung'; umschlag: Umschlag; artikel: number; baustellen: number; scheine: number; zeitpunkt: string }
  | {
    art: 'katalog'; umschlag: Umschlag; titel: string; artikel: number; zeitpunkt: string;
    /** Weitergegebenes Archiv statt Grundstock, samt Absender. */
    massgeblich: boolean; absender: string;
  };

/**
 * Datei ansehen, **bevor** etwas uebernommen wird. Nie still einlesen — sonst
 * liest sich irgendwann jemand einen alten Stand ueber den aktuellen, und
 * niemand merkt es.
 */
export function vorschau(text: string): Vorschau {
  let u: Umschlag;
  try {
    u = JSON.parse(text) as Umschlag;
  } catch {
    return { art: 'fehler', text: 'Die Datei ist beschädigt oder gehört nicht zu MaterialBlitz.' };
  }
  if (u?.mblitz !== 1) {
    return { art: 'fehler', text: 'Das ist keine MaterialBlitz-Datei.' };
  }
  const zeitpunkt = `${new Date(u.erzeugt).toLocaleDateString('de-AT')}, ${zeit(u.erzeugt)} Uhr`;

  if (u.typ === 'schein' && u.schein) {
    return {
      art: 'schein', umschlag: u,
      ort: projektTitel(u.schein.baustelle, u.schein.baustelle.kunde),
      positionen: u.schein.positionen.length,
      absender: u.absender || 'unbekannt',
      zeitpunkt,
    };
  }
  if (u.typ === 'sicherung' && u.sicherung) {
    return {
      art: 'sicherung', umschlag: u,
      artikel: u.sicherung.artikel.length,
      baustellen: u.sicherung.baustellen.length,
      scheine: u.sicherung.scheine.length,
      zeitpunkt,
    };
  }
  if (u.typ === 'katalog' && u.katalog) {
    return {
      art: 'katalog', umschlag: u,
      titel: u.katalog.titel,
      artikel: u.katalog.artikel.length,
      zeitpunkt,
      massgeblich: u.katalog.massgeblich === true,
      absender: u.absender || 'unbekannt',
    };
  }
  return { art: 'fehler', text: 'Der Inhalt der Datei ist unvollständig.' };
}

// ---------------------------------------------------------------- Uebernehmen

/**
 * Einen uebergebenen Schein uebernehmen.
 *
 * Kennt der Empfaenger die Baustelle schon und hat dort einen eigenen offenen
 * Schein, kommt der uebernommene **dazu** — nicht zusammengefuehrt (das
 * vermischte still zwei Arbeitsstaende) und nicht ersetzend (das vernichtete
 * Arbeit). Er traegt sichtbar seine Herkunft.
 */
export async function scheinUebernehmen(u: Umschlag): Promise<void> {
  const daten = u.schein!;
  let kundeId: number | undefined;
  if (daten.baustelle.kunde) {
    const vorhanden = await db.kunden.where('name').equals(daten.baustelle.kunde).first();
    kundeId = vorhanden?.id ?? (await db.kunden.add({ name: daten.baustelle.kunde }));
  }

  let baustelle = await projektFinden(daten.baustelle.ort, kundeId);
  if (baustelle) {
    await db.baustellen.update(baustelle.id!, { zuletzt: Date.now(), abgeschlossen: false });
  } else {
    const id = await db.baustellen.add({ ort: daten.baustelle.ort, kundeId, zuletzt: Date.now() });
    baustelle = await db.baustellen.get(id);
  }

  // Die Artikel still in den Katalog: sonst versagt die Zwei-Buchstaben-Suche
  // ausgerechnet fuer das Material, an dem weitergearbeitet wird.
  for (const p of daten.positionen) {
    const vorhanden = await db.artikel.where('name').equals(p.name).first();
    if (!vorhanden) await db.artikel.add({ name: p.name, einheit: p.einheit, anzahl: 1, ...(p.nummer ? { nummer: p.nummer } : {}) });
    else if (!vorhanden.nummer && p.nummer) await db.artikel.update(vorhanden.id!, { nummer: p.nummer });
  }

  const herkunft = `von ${u.absender || 'unbekannt'}, ${zeit(u.erzeugt)}`;
  await db.scheine.add({
    baustelleId: baustelle!.id!,
    bezeichnung: daten.bezeichnung,
    zustand: 'offen',
    erstellt: Date.now(),
    herkunft,
    positionen: daten.positionen,
  });
  await vermerken({
    baustelleId: baustelle!.id!, art: 'uebernommen',
    positionen: daten.positionen.length, schein: daten.bezeichnung ?? herkunft,
  });
}

/**
 * Sicherung einspielen.
 *
 * `zusammenfuehren` ist die Voreinstellung, weil sie nichts vernichten kann.
 * `ersetzen` nur auf ausdrueckliche Wahl.
 */
export async function sicherungEinspielen(
  u: Umschlag,
  modus: 'zusammenfuehren' | 'ersetzen',
): Promise<void> {
  const s = u.sicherung!;
  await db.transaction('rw', [db.artikel, db.kunden, db.baustellen, db.scheine, db.einstellungen, db.verlauf], async () => {
    if (modus === 'ersetzen') {
      await Promise.all([db.artikel.clear(), db.kunden.clear(), db.baustellen.clear(), db.scheine.clear()]);
      await db.artikel.bulkAdd(s.artikel);
      await db.kunden.bulkAdd(s.kunden);
      await db.baustellen.bulkAdd(s.baustellen);
      await db.scheine.bulkAdd(s.scheine);
      // Eine Datei ohne Verlauf (aeltere Fassung) loescht den hiesigen nicht:
      // die Baustellen behalten beim Ersetzen ihre Nummern, er passt weiter.
      if (s.verlauf) {
        await db.verlauf.clear();
        await db.verlauf.bulkAdd(s.verlauf);
      }
      const eigene = await einstellungenLesen();
      await db.einstellungen.put({
        ...s.einstellungen, id: 1, lizenz: eigene.lizenz, lizenzGesetzt: eigene.lizenzGesetzt,
      });
      return;
    }

    for (const a of s.artikel) {
      const da = await db.artikel.where('name').equals(a.name).first();
      // Codes vereinen - aber keinen, der hier schon an einem anderen
      // Artikel haengt: ein Code gehoert hoechstens einem.
      const codes = [...(da?.codes ?? [])];
      for (const c of a.codes ?? []) {
        if (codes.includes(c)) continue;
        const traeger = await db.artikel.where('codes').equals(c).first();
        if (!traeger || traeger.id === da?.id) codes.push(c);
      }
      // Der eigene Ordner geht vor; fehlt er, kommt der aus der Sicherung.
      const ordner = da?.ordner ?? a.ordner;
      // Ebenso die Artikelnummer.
      const nummer = da?.nummer ?? a.nummer;
      // Und die Etikett-Einstellungen, Feld fuer Feld.
      const etikett = etikettFelder({
        etikettArt: da?.etikettArt ?? a.etikettArt,
        etikettInhalt: da?.etikettInhalt ?? a.etikettInhalt,
        etikettStueck: da?.etikettStueck ?? a.etikettStueck,
      });
      if (da) await db.artikel.update(da.id!, { anzahl: Math.max(da.anzahl, a.anzahl), codes, ordner, nummer, ...etikett });
      else {
        await db.artikel.add({
          name: a.name, einheit: a.einheit, anzahl: a.anzahl, codes,
          ...(ordner ? { ordner } : {}), ...(nummer ? { nummer } : {}), ...etikett,
        });
      }
    }
    // Kunden ueber den Namen zusammenfuehren und merken, welche alte Nummer
    // zu welcher neuen gehoert — die Projekte haengen daran.
    const kundenNummern = new Map<number, number>();
    for (const k of s.kunden) {
      const da = await db.kunden.where('name').equals(k.name).first();
      const id = da?.id ?? (await db.kunden.add({ name: k.name, versteckt: k.versteckt }));
      if (k.id !== undefined) kundenNummern.set(k.id, id as number);
    }
    // Baustellen anlegen und dabei merken, welche alte Nummer zu welcher
    // neuen gehoert — die Scheine haengen daran.
    const nummern = new Map<number, number>();
    for (const b of s.baustellen) {
      const kundeId = b.kundeId !== undefined ? kundenNummern.get(b.kundeId) : undefined;
      const da = await projektFinden(b.ort, kundeId);
      // Mit Kunde: ein neues Projekt kam bisher ohne ihn an — und ein
      // reines Kundenprojekt haette dann gar keinen Namen mehr.
      const id = da?.id ?? (await db.baustellen.add({
        ort: b.ort, zuletzt: b.zuletzt, abgeschlossen: b.abgeschlossen,
        ...(kundeId !== undefined ? { kundeId } : {}),
      }));
      if (b.id !== undefined) nummern.set(b.id, id as number);
    }

    // Scheine wurden beim Zusammenfuehren vorher gar nicht uebernommen — nach
    // einem Geraeteverlust waere die gesamte Historie verloren gewesen.
    const vorhanden = await db.scheine.toArray();
    for (const sch of s.scheine) {
      const zielId = sch.baustelleId !== undefined ? nummern.get(sch.baustelleId) : undefined;
      if (zielId === undefined) continue;
      const doppelt = vorhanden.some(
        (v) => v.baustelleId === zielId && v.erstellt === sch.erstellt,
      );
      if (doppelt) continue;
      const { id: _weg, ...rest } = sch;
      await db.scheine.add({ ...rest, baustelleId: zielId });
    }

    // Verlauf ebenso — ohne Eintraege doppelt aufzunehmen, die schon da sind.
    const schonDa = new Set((await db.verlauf.toArray()).map(verlaufSchluessel));
    for (const v of s.verlauf ?? []) {
      const zielId = nummern.get(v.baustelleId);
      if (zielId === undefined) continue;
      const { id: _weg, ...rest } = v;
      const neuer = { ...rest, baustelleId: zielId };
      if (schonDa.has(verlaufSchluessel(neuer))) continue;
      schonDa.add(verlaufSchluessel(neuer));
      await db.verlauf.add(neuer);
    }

    if (s.einstellungen) await einstellungenSchreiben(einstellungenVereinen(await einstellungenLesen(), s.einstellungen));
  });
  await einstellungenSchreiben({ letzteSicherung: Date.now(), neueArtikel: 0 });
}

/**
 * Die Einstellungen beim Zusammenfuehren. Frueher blieben sie ganz aussen
 * vor: Firmenkopf, Logo und eigene Etikettengroessen vom anderen Geraet
 * gingen verloren, und das Zusammengefuehrte wurde ohne sie wieder in die
 * Dropbox geschrieben.
 *
 * Die Regel ist dieselbe wie bei den Artikeln: was hier schon gesetzt ist,
 * gilt; was fehlt, kommt aus der Sicherung. Listen werden vereint. Lizenz
 * und Sicherungsstand gehoeren zum Geraet und bleiben unberuehrt.
 */
export function einstellungenVereinen(hier: Einstellungen, dort: Partial<Einstellungen>): Partial<Einstellungen> {
  const feld = (wert: string | undefined, sonst: string | undefined) => (wert?.trim() ? wert : sonst?.trim() ? sonst : wert);
  const f = dort.firma;
  const einheiten = [...hier.einheiten];
  for (const u of dort.einheiten ?? []) if (!einheiten.includes(u)) einheiten.push(u);
  const boegen = [...(hier.etikettBoegen ?? [])];
  for (const b of dort.etikettBoegen ?? []) if (!boegen.some((x) => x.id === b.id)) boegen.push(b);
  return {
    // Feld fuer Feld: hier nur der Name, dort die Anschrift — dann beides.
    firma: {
      name: feld(hier.firma.name, f?.name) ?? '',
      strasse: feld(hier.firma.strasse, f?.strasse) ?? '',
      ort: feld(hier.firma.ort, f?.ort) ?? '',
      telefon: feld(hier.firma.telefon, f?.telefon) ?? '',
    },
    logo: hier.logo ?? dort.logo,
    einheiten,
    ausweis: hier.ausweis ?? dort.ausweis,
    buero: feld(hier.buero, dort.buero),
    etikettCode: hier.etikettCode ?? dort.etikettCode,
    etikettBogen: hier.etikettBogen ?? dort.etikettBogen,
    ...(boegen.length ? { etikettBoegen: boegen } : {}),
  };
}

/**
 * Dasselbe Projekt auf diesem Geraet. Mit Ort zaehlt der Ort, wie bisher;
 * ein reines Kundenprojekt hat keinen und wird am Kunden erkannt — sonst
 * fielen alle Kundenprojekte in eines zusammen.
 */
async function projektFinden(ort: string, kundeId?: number): Promise<Baustelle | undefined> {
  if (ort) return db.baustellen.where('ort').equals(ort).first();
  if (kundeId === undefined) return undefined;
  return db.baustellen.where('ort').equals('').filter((b) => b.kundeId === kundeId).first();
}

/** Woran ein Verlaufseintrag beim Zusammenfuehren wiedererkannt wird. */
function verlaufSchluessel(v: VerlaufEintrag): string {
  return [v.baustelleId, v.zeit, v.art, v.name ?? '', v.menge ?? ''].join('|');
}

/**
 * Katalog-Grundstock einlesen. Kommt nur **dazu**: vorhandene Artikel bleiben,
 * wie sie sind - auch ihre Einheit, der eigene Stand geht vor. Fehlende
 * Einheiten kommen in die Liste, sonst waere die Einheit beim Bearbeiten des
 * Artikels nicht waehlbar und fiele still auf die erste zurueck.
 *
 * Ein weitergegebenes Archiv (`massgeblich`) gleicht ausserdem an:
 * gleichnamige Artikel uebernehmen Einheit, Codes und Ordner der Datei. Geloescht
 * wird auch dann nichts - was nur hier steht, bleibt. Codes kommen zu den
 * eigenen dazu; haengt einer hier an einem anderen Artikel, wandert er
 * herueber, denn ein Code gehoert hoechstens einem.
 *
 * Bestehende Scheine beruehrt das nicht: ihre Positionen sind Abschriften.
 *
 * Zaehlt nicht als Sicherung und nicht als neue Artikel fuer die Erinnerung:
 * der Grundstock laesst sich jederzeit aus derselben Datei wiederholen.
 */
export async function katalogEinlesen(
  u: Umschlag,
): Promise<{ neu: number; angeglichen: number; vorhanden: number }> {
  const k = u.katalog!;
  let neu = 0;
  let angeglichen = 0;
  await db.transaction('rw', [db.artikel, db.einstellungen], async () => {
    const e = await einstellungenLesen();
    const fehlend = k.einheiten.filter((x) => !e.einheiten.includes(x));
    if (fehlend.length) await einstellungenSchreiben({ einheiten: [...e.einheiten, ...fehlend] });

    for (const a of k.artikel) {
      const da = await db.artikel.where('name').equals(a.name).first();
      if (!k.massgeblich) {
        if (da) continue;
        await db.artikel.add({
          name: a.name, einheit: a.einheit, anzahl: 0,
          ...(a.ordner ? { ordner: a.ordner } : {}), ...(a.nummer ? { nummer: a.nummer } : {}),
        });
        neu++;
        continue;
      }

      const mitgebracht = a.codes ?? [];
      for (const c of mitgebracht) {
        const traeger = await db.artikel.where('codes').equals(c).first();
        if (traeger && traeger.id !== da?.id) {
          await db.artikel.update(traeger.id!, { codes: (traeger.codes ?? []).filter((x) => x !== c) });
        }
      }
      if (!da) {
        await db.artikel.add({
          name: a.name, einheit: a.einheit, anzahl: 0,
          ...(mitgebracht.length ? { codes: [...mitgebracht] } : {}),
          ...(a.ordner ? { ordner: a.ordner } : {}),
          ...(a.nummer ? { nummer: a.nummer } : {}),
          ...etikettFelder(a),
        });
        neu++;
        continue;
      }
      const codes = [...new Set([...(da.codes ?? []), ...mitgebracht])];
      const ordner = k.mitOrdner ? a.ordner : da.ordner;
      // Eine Nummer der Datei gilt; fehlt sie dort, bleibt die eigene —
      // aeltere Fassungen kennen das Feld nicht.
      const nummer = a.nummer ?? da.nummer;
      // Die Datei kennt die Etikett-Felder: dann gilt sie, auch wo sie
      // nichts sagt (= Vorgabe). Aeltere Dateien lassen die eigenen stehen.
      const quelle = k.mitEtikett ? a : da;
      const etikett = {
        etikettArt: quelle.etikettArt, etikettInhalt: quelle.etikettInhalt, etikettStueck: quelle.etikettStueck,
      };
      const etikettAnders = etikett.etikettArt !== da.etikettArt || etikett.etikettInhalt !== da.etikettInhalt
        || etikett.etikettStueck !== da.etikettStueck;
      if (da.einheit !== a.einheit || codes.length !== (da.codes?.length ?? 0) || ordner !== da.ordner
        || nummer !== da.nummer || etikettAnders) {
        await db.artikel.update(da.id!, { einheit: a.einheit, codes, ordner, nummer, ...etikett });
        angeglichen++;
      }
    }
  });
  return { neu, angeglichen, vorhanden: k.artikel.length - neu };
}
