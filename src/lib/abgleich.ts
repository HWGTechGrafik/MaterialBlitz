/**
 * Abgleich ueber die Dropbox — wie bei BzzOps: eine Sync-Datei mit dem
 * **gesamten Bestand** im App-Ordner. Jede Aenderung wird nach kurzer Pause
 * hochgeladen; beim Start und beim Zurueckkehren in die App werden neuere
 * Daten anderer Geraete **angeboten**, nie still eingespielt.
 *
 * Eine Datei **je Lizenznummer**: Handy und Buero-PC derselben Person
 * gleichen miteinander ab. Haengen Kollegen an derselben Firmen-Dropbox,
 * ueberschreiben sie sich nicht gegenseitig.
 *
 * Gemerkt wird je Geraet (lokaler Speicher, nicht in der Datenbank):
 * - `basis`: der Stand der Sync-Datei beim letzten Abgleich. Steht dort
 *   etwas anderes, hat ein anderes Geraet hochgeladen.
 * - `offen`: hier gibt es Aenderungen, die noch nicht oben sind.
 * Damit wird nur gefragt, wenn wirklich ein anderes Geraet etwas Neues hat,
 * und nur gewarnt, wenn dabei hiesige Aenderungen verloren gingen.
 */
import { db, einstellungenLesen } from '../db';
import { neu, zustand } from '../store';
import { blatt, h, melden } from '../ui';
import { zeit } from './format';
import { AM_PC } from './geraet';
import * as dbx from './dropbox';
import { sicherungEinspielen, sicherungUmschlag, type Umschlag } from './transfer';

const K_BASIS = 'mb.sync.basis';
const K_OFFEN = 'mb.sync.offen';
const K_ZULETZT = 'mb.sync.zuletzt';

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
  /** Eine Rueckfrage ist offen — bis dahin wird nichts hochgeladen. */
  frage: false,
};

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
function basisSetzen(stand: number): void {
  setzen(K_BASIS, JSON.stringify({ datei: pfad(), stand }));
  setzen(K_OFFEN, null);
  setzen(K_ZULETZT, String(Date.now()));
}

const offen = (): boolean => lesen(K_OFFEN) === '1';
const aktiv = (): boolean => dbx.eingerichtet() && dbx.verbunden() && pfad() !== null;

// ------------------------------------------------------- Aenderungen merken

/** Waehrend Daten aus der Dropbox eingespielt werden, zaehlt nichts als Aenderung. */
let unterdrueckt = false;
let bereit = false;
let uhr: number | undefined;

/**
 * Hiesige Aenderung vermerken und das Hochladen planen. Laeuft ueber die
 * Datenbank-Haken unten; von Hand nur dort, wo ein clear() an ihnen
 * vorbeigeht.
 */
export function geaendert(): void {
  if (unterdrueckt) return;
  setzen(K_OFFEN, '1');
  if (!aktiv() || !bereit || status.frage) return;
  clearTimeout(uhr);
  uhr = window.setTimeout(() => void hochladen(), 3000);
}

/** Felder, die nur dieses Geraet betreffen oder sich von selbst aendern. */
const NUR_HIER = new Set(['lizenz', 'letzteSicherung', 'neueArtikel']);

function hakenSetzen(): void {
  for (const t of [db.artikel, db.kunden, db.baustellen, db.scheine]) {
    t.hook('creating', () => { geaendert(); });
    t.hook('updating', () => { geaendert(); });
    t.hook('deleting', () => { geaendert(); });
  }
  // Das Anlegen der Grundeinstellungen beim ersten Start ist keine Aenderung —
  // sonst hielte ein frisches Geraet seinen leeren Stand fuer neuer als die Dropbox.
  db.einstellungen.hook('updating', (aenderung) => {
    if (Object.keys(aenderung).some((k) => !NUR_HIER.has(k))) geaendert();
  });
}

// ------------------------------------------------------------ Hoch und runter

async function hochladen(): Promise<boolean> {
  clearTimeout(uhr);
  const p = pfad();
  if (!p || !aktiv() || status.frage) return false;
  try {
    const u = await sicherungUmschlag(zustand.lizenz?.name ?? zustand.lizenz?.firma ?? undefined);
    const ok = await dbx.dateiSchreiben(p, JSON.stringify(u));
    if (ok) basisSetzen(u.erzeugt);
    return ok;
  } catch {
    // Offline o. ae. — die naechste Aenderung oder „Jetzt abgleichen" versucht es wieder.
    return false;
  }
}

async function uebernehmen(u: Umschlag): Promise<void> {
  unterdrueckt = true;
  try {
    await sicherungEinspielen(u, 'ersetzen');
  } finally {
    unterdrueckt = false;
  }
  basisSetzen(u.erzeugt);
  zustand.einstellungen = await einstellungenLesen();
  neu();
}

async function lokalLeer(): Promise<boolean> {
  const [a, b, s] = await Promise.all([db.artikel.count(), db.baustellen.count(), db.scheine.count()]);
  return a + b + s === 0;
}

/**
 * Mit der Sync-Datei vergleichen. `still`: beim Start und beim Zurueckkehren
 * — dann keine Erfolgsmeldung und keine Meldung, wenn nur das Netz fehlt.
 */
export async function abgleichen(still = false): Promise<void> {
  const p = pfad();
  if (!p || !aktiv() || status.arbeitet) return;
  status.arbeitet = true;
  if (!still) neu();
  try {
    const text = await dbx.dateiLesen(p);
    let u: Umschlag | null = null;
    try {
      u = text ? JSON.parse(text) as Umschlag : null;
    } catch {
      u = null;
    }
    const gueltig = u?.mblitz === 1 && u.typ === 'sicherung' && u.sicherung ? u : null;

    if (!gueltig || gueltig.erzeugt === basis()) {
      // Oben nichts Neues: hiesige Aenderungen (oder ueberhaupt erst eine Datei) hinauf.
      if (!gueltig || offen()) await hochladen();
      else setzen(K_ZULETZT, String(Date.now()));
      if (!still) melden('Abgeglichen', 'Die Daten in der Dropbox sind auf dem neuesten Stand.');
    } else if (basis() === null && await lokalLeer()) {
      // Frisches Geraet: nichts, was verloren gehen koennte.
      await uebernehmen(gueltig);
      melden('Aus der Dropbox übernommen', beschreibung(gueltig));
    } else {
      fragen(gueltig);
    }
  } catch (f) {
    if (!still || !dbx.verbunden()) {
      melden('Dropbox', f instanceof dbx.DropboxFehler ? f.message : 'Die Dropbox ist nicht erreichbar – bitte die Internetverbindung prüfen.');
    }
  } finally {
    status.arbeitet = false;
    bereit = true;
    neu();
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

function fragen(u: Umschlag): void {
  if (status.frage) return;
  status.frage = true;
  const fertig = () => { status.frage = false; };
  const hierGeaendert = offen() || basis() === null;
  blatt(
    'Neuere Daten in der Dropbox',
    [
      h('p', { class: 'hinweis', style: 'padding:0',
        text: `Ein anderes Gerät hat Daten hochgeladen. ${beschreibung(u)}` }),
      hierGeaendert
        ? h('p', { class: 'hinweis', style: 'padding:0;color:var(--warn)',
          text: `Achtung: Auf ${AM_PC ? 'diesem Rechner' : 'diesem Gerät'} gibt es Änderungen, die noch nicht in der Dropbox sind. Beim Übernehmen gehen sie verloren; „Hier behalten" überschreibt stattdessen die Dropbox.` })
        : null,
    ],
    [
      { text: 'Später', art: 'zweit', tun: fertig },
      ...(hierGeaendert
        ? [{ text: 'Hier behalten', art: 'zweit' as const, tun: () => { fertig(); void hochladen().then(() => neu()); } }]
        : []),
      { text: 'Übernehmen', tun: () => { fertig(); void uebernehmen(u); } },
    ],
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
      if (offen() && !status.frage) void hochladen();
    } else if (!status.frage) {
      // Zurueck in der App: neuere Daten anderer Geraete holen.
      void abgleichen(true);
    }
  });

  if (aktiv()) await abgleichen(true);
  else bereit = true;
}

export async function verbinden(): Promise<void> {
  await dbx.anmeldenStarten();
}

export async function trennen(): Promise<void> {
  await dbx.trennen();
  setzen(K_BASIS, null);
  setzen(K_ZULETZT, null);
  neu();
  melden('Dropbox getrennt', 'Nur dieses Gerät ist abgemeldet. Die Sync-Datei bleibt in der Dropbox (Apps › MaterialBlitz App).');
}
