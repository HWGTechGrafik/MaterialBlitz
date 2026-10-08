import { db, einstellungenLesen, einstellungenSchreiben } from '../db';
import type { Artikel, Baustelle, Einstellungen, Kunde, Position, Schein } from '../model';
import { dateinameTeil, datumSortierbar, zeit, zeitKompakt } from './format';

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
  };
  katalog?: {
    /** Wofuer der Grundstock gedacht ist, etwa "Elektro". */
    titel: string;
    /** Codes nur im weitergegebenen Archiv; der Grundstock hat keine. */
    artikel: Array<{ name: string; einheit: string; codes?: string[] }>;
    /** Einheiten, die die Artikel brauchen und die feste Liste nicht hat. */
    einheiten: string[];
    /**
     * Gesetzt, wenn ein Geraet sein Archiv weitergibt: Dann ist die Datei
     * der gepflegte Stand, und gleichnamige Artikel uebernehmen Einheit und
     * Codes. Ein Grundstock dagegen ergaenzt nur. Aeltere Fassungen der App
     * kennen das Feld nicht und ergaenzen ebenfalls nur - kein Schaden.
     */
    massgeblich?: true;
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
      positionen: schein.positionen,
      // Baustelle und Kunde wandern mit: ein Schein ohne sie laesst sich
      // beim Empfaenger nicht zuordnen.
      baustelle: { ort: baustelle.ort, kunde: kunde?.name },
    },
  };
  const name = [
    'MaterialBlitz', 'Uebergabe',
    datumSortierbar(umschlag.erzeugt), zeitKompakt(umschlag.erzeugt),
    dateinameTeil(baustelle.ort),
  ].join('_') + '.txt';
  return zuDatei(umschlag, name);
}

// ---------------------------------------------------------------- Sicherung

/** Der gesamte Bestand als Umschlag — fuer die Sicherungsdatei und die Dropbox. */
export async function sicherungUmschlag(absender?: string, mitLizenz = false): Promise<Umschlag> {
  const [artikel, kunden, baustellen, scheine, einstellungen] = await Promise.all([
    db.artikel.toArray(), db.kunden.toArray(), db.baustellen.toArray(),
    db.scheine.toArray(), einstellungenLesen(),
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
      artikel: artikel.map((a) => ({
        name: a.name,
        einheit: a.einheit,
        ...(a.codes?.length ? { codes: a.codes } : {}),
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
      ort: u.schein.baustelle.ort,
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

  let baustelle = await db.baustellen.where('ort').equals(daten.baustelle.ort).first();
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
    if (!vorhanden) await db.artikel.add({ name: p.name, einheit: p.einheit, anzahl: 1 });
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
  await db.transaction('rw', [db.artikel, db.kunden, db.baustellen, db.scheine, db.einstellungen], async () => {
    if (modus === 'ersetzen') {
      await Promise.all([db.artikel.clear(), db.kunden.clear(), db.baustellen.clear(), db.scheine.clear()]);
      await db.artikel.bulkAdd(s.artikel);
      await db.kunden.bulkAdd(s.kunden);
      await db.baustellen.bulkAdd(s.baustellen);
      await db.scheine.bulkAdd(s.scheine);
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
      if (da) await db.artikel.update(da.id!, { anzahl: Math.max(da.anzahl, a.anzahl), codes });
      else await db.artikel.add({ name: a.name, einheit: a.einheit, anzahl: a.anzahl, codes });
    }
    for (const k of s.kunden) {
      if (!(await db.kunden.where('name').equals(k.name).first())) {
        await db.kunden.add({ name: k.name, versteckt: k.versteckt });
      }
    }
    // Baustellen anlegen und dabei merken, welche alte Nummer zu welcher
    // neuen gehoert — die Scheine haengen daran.
    const nummern = new Map<number, number>();
    for (const b of s.baustellen) {
      const da = await db.baustellen.where('ort').equals(b.ort).first();
      const id = da?.id ?? (await db.baustellen.add({
        ort: b.ort, zuletzt: b.zuletzt, abgeschlossen: b.abgeschlossen,
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
  });
  await einstellungenSchreiben({ letzteSicherung: Date.now(), neueArtikel: 0 });
}

/**
 * Katalog-Grundstock einlesen. Kommt nur **dazu**: vorhandene Artikel bleiben,
 * wie sie sind - auch ihre Einheit, der eigene Stand geht vor. Fehlende
 * Einheiten kommen in die Liste, sonst waere die Einheit beim Bearbeiten des
 * Artikels nicht waehlbar und fiele still auf die erste zurueck.
 *
 * Ein weitergegebenes Archiv (`massgeblich`) gleicht ausserdem an:
 * gleichnamige Artikel uebernehmen Einheit und Codes der Datei. Geloescht
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
        await db.artikel.add({ name: a.name, einheit: a.einheit, anzahl: 0 });
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
        });
        neu++;
        continue;
      }
      const codes = [...new Set([...(da.codes ?? []), ...mitgebracht])];
      if (da.einheit !== a.einheit || codes.length !== (da.codes?.length ?? 0)) {
        await db.artikel.update(da.id!, { einheit: a.einheit, codes });
        angeglichen++;
      }
    }
  });
  return { neu, angeglichen, vorhanden: k.artikel.length - neu };
}
