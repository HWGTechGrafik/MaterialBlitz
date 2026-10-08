/**
 * Abgleich ueber die Dropbox — angelehnt an BzzOps: eine Sync-Datei mit dem
 * **gesamten Bestand** im App-Ordner, dazu der Lizenzschluessel.
 *
 * Es laeuft von selbst:
 * - Jede Aenderung geht nach drei Sekunden hinauf, beim Wechsel in den
 *   Hintergrund sofort.
 * - Beim Start, beim Zurueckkehren und jede Minute, solange die App offen
 *   ist, wird nachgesehen. Das kostet eine kleine Abfrage (rev); geladen
 *   wird nur, wenn sich oben etwas geaendert hat.
 * - Neueres von einem anderen Geraet wird **ohne Rueckfrage** uebernommen,
 *   wenn es hier nichts Ungesichertes gibt. Gefragt wird nur, wenn auf
 *   beiden Seiten geaendert wurde — dann ginge sonst etwas verloren.
 * - Mitten in einer Eingabe (Zifferblock, Dialog, Suchfeld) wird nichts
 *   ausgetauscht; das holt der naechste Durchgang nach.
 * - Ein besserer Schluessel derselben Lizenznummer (etwa mit ergaenzter
 *   Firma) wird ebenfalls uebernommen.
 *
 * **Nie blind ueberschreiben:** Hochgeladen wird nur auf den Stand, der hier
 * zuletzt gesehen wurde (Dropbox-rev). Hat ein anderes Geraet inzwischen
 * etwas hochgeladen, lehnt die Dropbox ab — dann wird erst abgeglichen.
 * Ueberschreiben gibt es nur auf ausdrueckliche Wahl („Hier behalten").
 *
 * Eine Datei **je Lizenznummer**: Handy und Buero-PC derselben Person
 * gleichen miteinander ab.
 *
 * Gemerkt wird je Geraet (lokaler Speicher, nicht in der Datenbank):
 * - `basis`: der Stand der Sync-Datei beim letzten Abgleich.
 * - `rev`: Dropbox-Kennung dieses Stands.
 * - `offen`: hier gibt es Aenderungen, die noch nicht oben sind.
 */
import { db, einstellungenLesen, einstellungenSchreiben } from '../db';
import { neu, zustand } from '../store';
import { blatt, h, melden } from '../ui';
import { zeit } from './format';
import { AM_PC } from './geraet';
import { pruefen, type Lizenz } from './lizenz';
import * as dbx from './dropbox';
import { sicherungEinspielen, sicherungUmschlag, type Umschlag } from './transfer';

const K_BASIS = 'mb.sync.basis';
const K_REV = 'mb.sync.rev';
const K_OFFEN = 'mb.sync.offen';
const K_ZULETZT = 'mb.sync.zuletzt';
/** rev der Datei oben und hiesiger Schluessel beim letzten vollstaendigen Vergleich. */
const K_GEPRUEFT = 'mb.sync.geprueft';
const MINUTE = 60_000;

function lesen(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function setzen(k: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch { /* siehe dropbox.ts */ }
}

/** Was die Einstellungen-Karte anzeigt. */
export const status = {
  arbeitet: false,
  /** Die Rueckfrage steht gerade auf dem Schirm. */
  frage: false,
};

/**
 * Rueckfrage mit „Spaeter" (oder Wegklicken) beantwortet: Bis zur
 * Entscheidung wird nichts hochgeladen — sonst ueberschriebe die naechste
 * Aenderung still das andere Geraet. Beim Start, beim Zurueckkehren und auf
 * „Jetzt abgleichen" kommt die Frage wieder, nicht aber jede Minute.
 */
let zurueckgestellt = false;

export const zuletzt = (): number | null => Number(lesen(K_ZULETZT)) || null;

function pfad(): string | null {
  const nr = zustand.lizenz?.nummer;
  return nr ? `/MaterialBlitz_Sync_${nr}.json` : null;
}

/** Stand der zuletzt abgeglichenen Datei — nur gueltig fuer dieselbe Datei. */
function basis(): number | null {
  try {
    const b = JSON.parse(lesen(K_BASIS) ?? 'null') as { datei: string; stand: number } | null;
    return b && b.datei === pfad() ? b.stand : null;
  } catch {
    return null;
  }
}
/**
 * Merkmal fuer die Minutenpruefung: dieselbe Datei oben (rev) **und**
 * derselbe Schluessel hier. Aendert sich eines davon, wird wieder ganz
 * verglichen — sonst bliebe unbemerkt, dass oben ein schlechterer
 * Schluessel liegt als hier.
 */
const merkmal = (rev: string): string => `${rev}|${zustand.einstellungen?.lizenz ?? ''}`;

function basisSetzen(stand: number, rev: string | null): void {
  setzen(K_BASIS, JSON.stringify({ datei: pfad(), stand }));
  setzen(K_REV, rev);
  setzen(K_GEPRUEFT, rev ? merkmal(rev) : null);
  setzen(K_ZULETZT, String(Date.now()));
}

const offen = (): boolean => lesen(K_OFFEN) === '1';
const aktiv = (): boolean => dbx.eingerichtet() && dbx.verbunden() && pfad() !== null;
const gesperrt = (): boolean => status.frage || zurueckgestellt;

/**
 * Gerade mitten in einer Eingabe? Dann nichts austauschen — ein Neuaufbau
 * wuerde die halb getippte Menge oder den Suchbegriff verschlucken.
 */
function beschaeftigt(): boolean {
  const fokus = document.activeElement;
  return Boolean(document.querySelector('.schatten, .block, .suchfeld, .scanner'))
    || (fokus instanceof HTMLElement && fokus.matches('input, textarea, select'));
}

// ------------------------------------------------------- Aenderungen merken

/** Waehrend Daten aus der Dropbox eingespielt werden, zaehlt nichts als Aenderung. */
let unterdrueckt = false;
let bereit = false;
let uhr: number | undefined;
/** Zaehlt hiesige Aenderungen — so geht keine verloren, die waehrend eines Uploads passiert. */
let aenderungen = 0;

function hochladenPlanen(): void {
  if (!aktiv() || !bereit || gesperrt()) return;
  clearTimeout(uhr);
  uhr = window.setTimeout(() => void hochladen(), 3000);
}

/**
 * Hiesige Aenderung vermerken und das Hochladen planen. Laeuft ueber die
 * Datenbank-Haken unten.
 */
export function geaendert(): void {
  if (unterdrueckt) return;
  aenderungen++;
  setzen(K_OFFEN, '1');
  hochladenPlanen();
}

/** Felder, die sich von selbst aendern und keinen Abgleich wert sind. */
const NUR_HIER = new Set(['letzteSicherung', 'neueArtikel']);

function hakenSetzen(): void {
  for (const t of [db.artikel, db.kunden, db.baustellen, db.scheine]) {
    t.hook('creating', () => { geaendert(); });
    t.hook('updating', () => { geaendert(); });
    t.hook('deleting', () => { geaendert(); });
  }
  // Das Anlegen der Grundeinstellungen beim ersten Start ist keine Aenderung —
  // sonst hielte ein frisches Geraet seinen leeren Stand fuer neuer als die Dropbox.
  // Ein neuer Lizenzschluessel dagegen schon: er soll auf das andere Geraet.
  db.einstellungen.hook('updating', (aenderung) => {
    if (Object.keys(aenderung).some((k) => !NUR_HIER.has(k))) geaendert();
  });
}

// ------------------------------------------------------------ Hoch und runter

let laedtHoch = false;
let nochmal = false;
/** Ein Upload wurde abgelehnt, weil oben Neueres liegt: nach dem laufenden Abgleich nachsehen. */
let nachsehen = false;

/**
 * Den hiesigen Stand hochladen — nur auf den zuletzt gesehenen Stand oben
 * (bzw. als neue Datei). `ueberschreiben` allein fuer „Hier behalten".
 */
async function hochladen(ueberschreiben = false): Promise<boolean> {
  clearTimeout(uhr);
  const p = pfad();
  if (!p || !aktiv() || (!ueberschreiben && gesperrt())) return false;
  if (laedtHoch) { nochmal = true; return false; }
  laedtHoch = true;
  try {
    const vorher = aenderungen;
    const u = await sicherungUmschlag(zustand.lizenz?.name ?? zustand.lizenz?.firma ?? undefined, true);
    const rev = lesen(K_REV);
    const modus: dbx.Schreibart = ueberschreiben ? { art: 'ueberschreiben' }
      : rev && basis() !== null ? { art: 'auf', rev }
      : { art: 'neu' };
    const ergebnis = await dbx.dateiSchreiben(p, JSON.stringify(u), modus);
    if (ergebnis === 'konflikt') {
      // Ein anderes Geraet war schneller. Nichts ueberschreiben, erst abgleichen.
      nachsehen = true;
      if (!status.arbeitet) setTimeout(() => void abgleichen(true), 0);
      return false;
    }
    if (ergebnis === null) return false;
    basisSetzen(u.erzeugt, ergebnis.rev);
    // Nur als erledigt vermerken, wenn waehrenddessen nichts dazukam.
    if (aenderungen === vorher) setzen(K_OFFEN, null);
    else hochladenPlanen();
    return true;
  } catch {
    // Offline o. ae. — die naechste Aenderung oder „Jetzt abgleichen" versucht es wieder.
    return false;
  } finally {
    laedtHoch = false;
    if (nochmal) { nochmal = false; hochladenPlanen(); }
  }
}

/** Den Stand aus der Dropbox einspielen; `zusammen` fuegt hinzu statt zu ersetzen. */
async function einspielen(u: Umschlag, rev: string | null, zusammen = false, schluesselHinauf = false): Promise<void> {
  unterdrueckt = true;
  try {
    await sicherungEinspielen(u, zusammen ? 'zusammenfuehren' : 'ersetzen');
  } finally {
    unterdrueckt = false;
  }
  basisSetzen(u.erzeugt, rev);
  if (zusammen || schluesselHinauf) {
    // Hier steht jetzt beides bzw. der bessere Schluessel — das gehoert wieder hinauf.
    aenderungen++;
    setzen(K_OFFEN, '1');
  } else {
    setzen(K_OFFEN, null);
  }
  zustand.einstellungen = await einstellungenLesen();
  neu();
  // Zusammengefuehrtes gehoert wieder hinauf — ebenso der eigene Schluessel,
  // wenn er besser ist als der oben (die Daten wurden ersetzt, er nicht).
  if (zusammen || schluesselHinauf) await hochladen();
}

/**
 * Welcher Schluessel ist besser, der hiesige oder der in der Sync-Datei?
 * Firma schlaegt Zeitpunkt: einer mit Firma gewinnt immer gegen einen ohne,
 * auch wenn der alte spaeter eingegeben wurde. Sonst gewinnt der spaeter
 * eingesetzte. Ein fehlender, ungueltiger oder fremder Schluessel oben
 * zaehlt nicht — dann ist der hiesige besser.
 *
 * Die Reihenfolge ist auf beiden Geraeten dieselbe: Was das eine als
 * „hier besser" hinaufschiebt, sieht das andere als „dort besser" und
 * uebernimmt es. Bei echtem Gleichstand passiert nichts.
 */
async function lizenzVergleichen(u: Umschlag): Promise<
  { wer: 'hier' | 'gleich' } | { wer: 'dort'; schluessel: string; gesetzt: number; lizenz: Lizenz }
> {
  const e = zustand.einstellungen ?? await einstellungenLesen();
  if (!zustand.lizenz || !e.lizenz) return { wer: 'gleich' };
  const fremd = u.lizenz;
  if (!fremd?.schluessel) return { wer: 'hier' };
  if (fremd.schluessel === e.lizenz) return { wer: 'gleich' };
  const ergebnis = await pruefen(fremd.schluessel);
  if (!ergebnis.ok || ergebnis.lizenz.nummer !== zustand.lizenz.nummer) return { wer: 'hier' };
  const dort = { wer: 'dort' as const, schluessel: fremd.schluessel, gesetzt: fremd.gesetzt ?? 0, lizenz: ergebnis.lizenz };
  const hierFirma = Boolean(zustand.lizenz.firma);
  const dortFirma = Boolean(ergebnis.lizenz.firma);
  if (hierFirma !== dortFirma) return dortFirma ? dort : { wer: 'hier' };
  const hierZeit = e.lizenzGesetzt ?? 0;
  if (dort.gesetzt > hierZeit) return dort;
  if (hierZeit > dort.gesetzt) return { wer: 'hier' };
  return { wer: 'gleich' };
}

/**
 * Schluessel abgleichen: einen besseren von oben uebernehmen. Liefert, ob
 * stattdessen der hiesige der bessere ist und hinauf muss.
 */
async function lizenzAbgleichen(u: Umschlag): Promise<{ uebernommen: boolean; hinauf: boolean }> {
  const v = await lizenzVergleichen(u);
  if (v.wer !== 'dort') return { uebernommen: false, hinauf: v.wer === 'hier' };
  const { schluessel: fremd, gesetzt: dort, lizenz } = v;
  unterdrueckt = true;
  try {
    zustand.einstellungen = await einstellungenSchreiben({ lizenz: fremd, lizenzGesetzt: dort });
  } finally {
    unterdrueckt = false;
  }
  zustand.lizenz = lizenz;
  return { uebernommen: true, hinauf: false };
}

async function lokalLeer(): Promise<boolean> {
  const zahlen = await Promise.all([db.artikel.count(), db.kunden.count(), db.baustellen.count(), db.scheine.count()]);
  return zahlen.every((n) => n === 0);
}

/**
 * Mit der Sync-Datei vergleichen. `still`: von selbst ausgeloest — dann
 * keine Erfolgsmeldung, keine Meldung, wenn nur das Netz fehlt, und kein
 * Neuaufbau, wenn sich nichts geaendert hat. `minute`: aus der
 * Minutenpruefung — dann wird eine zurueckgestellte Frage nicht erneut gestellt.
 */
export async function abgleichen(still = false, minute = false): Promise<void> {
  const p = pfad();
  if (!p || !aktiv() || status.arbeitet || status.frage) return;
  if (minute && zurueckgestellt) return;
  if (!still) zurueckgestellt = false;
  status.arbeitet = true;
  if (!still) neu();
  let neuZeichnen = !still;
  try {
    const rev = await dbx.dateiStand(p);
    // Oben unveraendert seit dem letzten Abgleich: nur Hiesiges hinauf.
    if (rev !== null && lesen(K_GEPRUEFT) === merkmal(rev) && basis() !== null && !zurueckgestellt) {
      if (offen()) await hochladen();
      else setzen(K_ZULETZT, String(Date.now()));
      if (!still) melden('Abgeglichen', 'Die Daten in der Dropbox sind auf dem neuesten Stand.');
      return;
    }

    const text = rev === null ? null : await dbx.dateiLesen(p);
    let u: Umschlag | null = null;
    try {
      u = text ? JSON.parse(text) as Umschlag : null;
    } catch {
      u = null;
    }
    const gueltig = u?.mblitz === 1 && u.typ === 'sicherung' && u.sicherung ? u : null;
    const schluessel = gueltig ? await lizenzAbgleichen(gueltig) : { uebernommen: false, hinauf: false };
    if (schluessel.uebernommen) neuZeichnen = true;

    if (!gueltig) {
      // Noch keine (brauchbare) Datei oben: den hiesigen Stand als erste hinauf.
      if (rev === null) setzen(K_REV, null);
      if (rev === null || basis() !== null) await hochladen(rev !== null);
    } else if (gueltig.erzeugt === basis()) {
      // Oben nichts Neues. Hiesiges hinauf — ebenso, wenn der Schluessel
      // hier besser ist als der oben, sonst kaeme er erst mit der naechsten
      // Aenderung hinueber.
      zurueckgestellt = false;
      if (offen() || schluessel.hinauf) {
        // Als offen vermerkt, damit ein misslungener Upload wiederholt wird.
        if (schluessel.hinauf) { aenderungen++; setzen(K_OFFEN, '1'); }
        setzen(K_REV, rev);
        await hochladen();
      } else {
        basisSetzen(gueltig.erzeugt, rev);
      }
      if (!still) melden('Abgeglichen', 'Die Daten in der Dropbox sind auf dem neuesten Stand.');
    } else if (basis() === null && await lokalLeer()) {
      // Frisches Geraet: nichts, was verloren gehen koennte.
      await einspielen(gueltig, rev, false, schluessel.hinauf);
      melden('Aus der Dropbox übernommen', beschreibung(gueltig));
    } else if (basis() !== null && !offen()) {
      // Nur das andere Geraet hat geaendert: still uebernehmen — ausser
      // mitten in einer Eingabe, dann beim naechsten Durchgang.
      if (!beschaeftigt() || !still) await einspielen(gueltig, rev, false, schluessel.hinauf);
    } else if (minute && zurueckgestellt) {
      // Bleibt zurueckgestellt bis zum Start, Zurueckkehren oder „Jetzt abgleichen".
    } else {
      fragen(gueltig, rev, schluessel.hinauf);
    }
  } catch (f) {
    if (!still || !dbx.verbunden()) {
      melden('Dropbox', f instanceof dbx.DropboxFehler ? f.message : 'Die Dropbox ist nicht erreichbar – bitte die Internetverbindung prüfen.');
    }
  } finally {
    status.arbeitet = false;
    bereit = true;
    if (neuZeichnen) neu();
    if (nachsehen) {
      nachsehen = false;
      setTimeout(() => void abgleichen(true), 0);
    }
  }
}

function beschreibung(u: Umschlag): string {
  const s = u.sicherung!;
  const wann = `${new Date(u.erzeugt).toLocaleDateString('de-AT')}, ${zeit(u.erzeugt)} Uhr`;
  return `Stand vom ${wann}${u.absender ? ` (${u.absender})` : ''}: `
    + `${anzahl(s.baustellen.length, 'Projekt', 'Projekte')}, ${anzahl(s.scheine.length, 'Schein', 'Scheine')}, `
    + `${anzahl(s.artikel.length, 'Artikel', 'Artikel')}.`;
}

const anzahl = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele}`;

/**
 * Nur noch, wenn auf beiden Seiten geaendert wurde — oder beim ersten
 * Verbinden eines Geraets, das schon eigene Daten hat. Dort gibt es statt
 * „Hier behalten" das Zusammenfuehren: Ein ganzer Bestand soll nicht von
 * einem Probelauf ueberschrieben werden.
 */
function fragen(u: Umschlag, rev: string | null, schluesselHinauf: boolean): void {
  if (status.frage) return;
  status.frage = true;
  const erstes = basis() === null;
  const wo = AM_PC ? 'diesem Rechner' : 'diesem Gerät';
  let entschieden = false;
  const entscheiden = (tun: () => Promise<unknown>) => () => {
    entschieden = true;
    status.frage = false;
    zurueckgestellt = false;
    tun().catch(() => melden('Dropbox', 'Das hat nicht geklappt – bitte „Jetzt abgleichen" in den Einstellungen wählen.'));
  };
  const spaeter = () => {
    if (entschieden) return;
    status.frage = false;
    zurueckgestellt = true;
  };
  blatt(
    erstes ? 'Daten hier und in der Dropbox' : 'Geändert auf beiden Geräten',
    [
      h('p', { class: 'hinweis', style: 'padding:0',
        text: `In der Dropbox liegen Daten eines anderen Geräts. ${beschreibung(u)}` }),
      h('p', { class: 'hinweis', style: 'padding:0;color:var(--warn)',
        text: erstes
          ? `Auf ${wo} gibt es schon eigene Daten. „Zusammenführen" behält beides; „Übernehmen" ersetzt die Daten hier durch die aus der Dropbox.`
          : `Auf ${wo} gibt es Änderungen, die noch nicht in der Dropbox sind. „Übernehmen" holt den Stand aus der Dropbox, die Änderungen hier gehen verloren. „Hier behalten" schreibt stattdessen diesen Stand in die Dropbox.` }),
    ],
    [
      { text: 'Später', art: 'zweit', tun: spaeter },
      erstes
        ? { text: 'Übernehmen', art: 'zweit', tun: entscheiden(() => einspielen(u, rev, false, schluesselHinauf)) }
        : { text: 'Hier behalten', art: 'zweit', tun: entscheiden(() => hochladen(true).then(() => neu())) },
      erstes
        ? { text: 'Zusammenführen', tun: entscheiden(() => einspielen(u, rev, true)) }
        : { text: 'Übernehmen', tun: entscheiden(() => einspielen(u, rev, false, schluesselHinauf)) },
    ],
    // Wegklicken neben dem Blatt zaehlt wie „Spaeter".
    spaeter,
  );
}

// ------------------------------------------------------------------ Start

/**
 * Beim Start einmal aufrufen, nachdem die Lizenz geprueft ist. Wertet eine
 * Rueckkehr von der Dropbox-Anmeldung aus und gleicht dann still ab.
 */
export async function abgleichStarten(): Promise<void> {
  if (!dbx.eingerichtet()) return;
  hakenSetzen();

  try {
    if (await dbx.rueckkehrVerarbeiten()) {
      const k = dbx.konto();
      melden('Dropbox verbunden', `${k ? `Verbunden mit ${k}. ` : ''}Ab jetzt gleicht ${AM_PC ? 'dieser Rechner' : 'dieses Gerät'} automatisch über die Dropbox ab.`);
    }
  } catch (f) {
    melden('Dropbox', f instanceof dbx.DropboxFehler ? f.message : 'Die Dropbox-Anmeldung ist fehlgeschlagen – bitte die Internetverbindung prüfen.');
  }

  document.addEventListener('visibilitychange', () => {
    if (!aktiv() || !bereit) return;
    if (document.visibilityState === 'hidden') {
      // Handy in den Hintergrund: Ausstehendes sofort hinauf.
      if (offen()) void hochladen();
    } else {
      // Zurueck in der App: neuere Daten anderer Geraete holen.
      void abgleichen(true);
    }
  });

  // Solange die App offen ist, jede Minute nachsehen.
  window.setInterval(() => {
    if (document.visibilityState === 'visible' && aktiv() && bereit) void abgleichen(true, true);
  }, MINUTE);

  if (aktiv()) await abgleichen(true);
  else bereit = true;
}

export async function verbinden(): Promise<void> {
  await dbx.anmeldenStarten();
}

export async function trennen(): Promise<void> {
  await dbx.trennen();
  setzen(K_BASIS, null);
  setzen(K_REV, null);
  setzen(K_GEPRUEFT, null);
  setzen(K_ZULETZT, null);
  zurueckgestellt = false;
  neu();
  melden('Dropbox getrennt', 'Nur dieses Gerät ist abgemeldet. Die Sync-Datei bleibt in der Dropbox (Apps › MaterialBlitz App).');
}
