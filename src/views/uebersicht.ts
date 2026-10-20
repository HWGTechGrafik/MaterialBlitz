import { db, einstellungenLesen, einstellungenSchreiben } from '../db';
import { SICHERUNG_ARTIKEL, SICHERUNG_TAGE, projektTitel, projektUnter, type Baustelle, type Kunde } from '../model';
import { erstellerText, gehe, neu, zustand } from '../store';
import { blatt, h, ikon, kopfKnopf, kopfRechts, marke, melden, umschalter, wischbar, type NeuArt } from '../ui';
import { artikelBearbeiten, projektLoeschen } from './katalog';
import { einstellungenOeffnen } from './einstellungen';
import { tageSeit } from '../lib/format';
import { dateiWaehlen } from '../lib/share';
import { AM_PC, IM_BROWSER, IOS, installierbar, installieren } from '../lib/geraet';
import { verbinden as dropboxVerbinden } from '../lib/abgleich';
import { eingerichtet as dropboxEingerichtet, verbunden as dropboxVerbunden } from '../lib/dropbox';
import { katalogEinlesen, scheinUebernehmen, sicherungEinspielen, vorschau } from '../lib/transfer';
import {
  durchsuchen, suchAktiv, suchBegriffe, zerlegen, type Fund, type FundArt,
} from '../lib/suche';

/**
 * Der Suchbegriff bleibt stehen, bis er weggetippt wird — wer einen Fund
 * antippt und mit dem Pfeil zurueckkommt, findet die uebrigen Funde noch vor.
 */
let suche = '';

export async function uebersicht(): Promise<HTMLElement[]> {
  const kopf = kopfBauen();
  const rumpf = h('div', { class: 'rumpf' });
  const zeile = suchzeile(rumpf);
  await fuellen(rumpf);
  return [kopf, zeile, rumpf];
}

function kopfBauen(): HTMLElement {
  return h(
    'div',
    { class: 'kopf' },
    marke(),
    h(
      'div',
      { class: 'kopf-text' },
      h('div', { class: 'eyebrow', text: 'MaterialBlitz' }),
      h('h1', { text: 'Dashboard' }),
      // Wer hier arbeitet — aus der Lizenz, wie auf dem PDF.
      h('div', { class: 'unter', text: erstellerText(' · ') }),
    ),
    kopfRechts(
      null,
      // Das Einlesen gehoert hierher, nicht in das Projekt: wer einen Schein
      // empfaengt, hat das zugehoerige Projekt meist noch gar nicht.
      kopfKnopf({ ikon: 'einlesen', titel: 'Datei einlesen', tun: einlesen }),
      kopfKnopf({ ikon: 'plus', titel: 'Neu anlegen', art: 'haupt', tun: () => neuAnlegen() }),
    ),
  );
}

/**
 * Das Plus im Dashboard: zuerst ein Projekt, oben schaltet der Umschalter auf
 * Artikel um. Ein neues Projekt oeffnet danach gleich seinen Schein.
 */
function neuAnlegen(art: NeuArt = 'projekt'): void {
  if (art === 'artikel') void artikelBearbeiten(undefined, umschalter(art, neuAnlegen));
  else baustelleAnlegen(true, umschalter(art, neuAnlegen));
}

// -------------------------------------------------------------- Suchzeile

/**
 * Ein Feld fuer alles. Es steht fest ueber der Liste — versteckt hinter einer
 * Lupe wuerde es niemand suchen, der nicht weiss, dass es die Suche gibt.
 */
function suchzeile(rumpf: HTMLElement): HTMLElement {
  const feld = h('input', {
    type: 'search',
    value: suche,
    placeholder: 'Suchen — Projekt, Kunde, Material …',
    'aria-label': 'Projekte, Scheine, Positionen und Archiv nach Stichwörtern durchsuchen',
    autocomplete: 'off',
    enterkeyhint: 'search',
  });
  // Rechtschreibhilfe auf Artikelnamen wie „NYM-J" ist nur im Weg.
  feld.spellcheck = false;

  const weg = h('button', {
    class: 'suche-weg', type: 'button', html: '&times;',
    'aria-label': 'Suche zurücksetzen',
    hidden: !suche,
  });

  const setzen = (wert: string): void => {
    suche = wert;
    weg.hidden = !wert;
    void fuellen(rumpf);
  };

  feld.addEventListener('input', () => setzen(feld.value));
  feld.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !feld.value) return;
    ev.preventDefault();
    feld.value = '';
    setzen('');
  });
  weg.onclick = () => {
    feld.value = '';
    setzen('');
    feld.focus();
  };

  return h('div', { class: 'suchzeile' }, ikon('lupe'), feld, weg);
}

/**
 * Liste neu fuellen — **nur** den Rumpf, nicht den ganzen Bildschirm. Ein
 * vollstaendiger Neuaufbau wuerde das Suchfeld mitsamt Schreibmarke ersetzen,
 * und am Handy waere nach dem ersten Buchstaben die Tastatur wieder weg.
 */
let lauf = 0;
async function fuellen(rumpf: HTMLElement): Promise<void> {
  const meins = ++lauf;
  const teile = suchAktiv(suche) ? await fundListe() : await projektListe();
  // Ein neuerer Tastendruck ist schon unterwegs: dieses Ergebnis ist veraltet.
  if (meins !== lauf) return;
  rumpf.replaceChildren(...teile);
  rumpf.scrollTop = 0;
}

// ------------------------------------------------------------ Trefferliste

const ART_WORT: Record<FundArt, string> = {
  projekt: 'Projekt',
  schein: 'Schein',
  position: 'Position',
  artikel: 'Artikel',
};

/** Gefundene Woerter hervorheben — als Textknoten, nie als zusammengebautes HTML. */
function markiert(text: string, begriffe: string[]): Node[] {
  return zerlegen(text, begriffe).map((s) =>
    s.treffer ? h('mark', { text: s.text }) : document.createTextNode(s.text),
  );
}

function fundReihe(f: Fund, begriffe: string[]): HTMLElement {
  return h(
    'button',
    {
      class: 'reihe fund',
      type: 'button',
      onclick: () => {
        if (f.baustelleId !== undefined) gehe('schein', f.baustelleId);
        else gehe('katalog');
      },
    },
    h(
      'div',
      { style: 'min-width:0' },
      h('div', { class: 'haupt' }, ...markiert(f.titel, begriffe)),
      h('div', { class: 'neben' }, ...markiert(f.unter, begriffe)),
      ...f.treffer.map((t) =>
        h('div', { class: 'warum' }, h('i', { text: t.feld }), ...markiert(t.zeig, begriffe)),
      ),
    ),
    h('span', { class: 'plakette', text: ART_WORT[f.art] }),
    h('span', { class: 'pfeil', html: '&rsaquo;' }),
  );
}

async function fundListe(): Promise<HTMLElement[]> {
  const begriffe = suchBegriffe(suche);
  const gruppen = await durchsuchen(suche);
  const anzahl = gruppen.reduce((n, g) => n + g.funde.length, 0);

  const teile: HTMLElement[] = [
    h(
      'div',
      { class: 'fund-zahl' },
      h('b', { text: anzahl === 1 ? '1 Fund' : `${anzahl} Funde` }),
      ` für „${suche.trim()}"`,
    ),
  ];

  if (!anzahl) {
    teile.push(
      h('div', { class: 'leer', text:
        'Nichts gefunden. Versuch es mit einem Wort weniger — gesucht wird in Projekten, Kunden, Scheinen, einzelnen Positionen und im Archiv.' }),
    );
    return teile;
  }

  for (const g of gruppen) {
    // Ueberschrift weglassen, wenn die Gruppe nur aus dem Projekt selbst
    // besteht — sie wuerde Wort fuer Wort dasselbe sagen wie die Zeile darunter.
    const nurProjekt = g.funde.length === 1 && g.funde[0]!.art === 'projekt';
    if (!nurProjekt) {
      teile.push(
        h(
          'div',
          { class: 'abschnitt' },
          h('span', { text: g.titel }),
          g.unter ? h('span', { class: 'neben', text: g.unter }) : null,
        ),
      );
    }
    for (const f of g.funde) teile.push(fundReihe(f, begriffe));
  }
  return teile;
}

// ------------------------------------------------------------ Projektliste

async function projektListe(): Promise<HTMLElement[]> {
  const [alle, kunden] = await Promise.all([db.baustellen.toArray(), db.kunden.toArray()]);
  const kundeVon = new Map(kunden.map((k) => [k.id!, k] as const));

  const offen = alle
    .filter((b) => !b.abgeschlossen && !b.versteckt)
    .sort((a, b) => b.zuletzt - a.zuletzt);

  const zahlen = new Map<number, number>();
  for (const b of offen) {
    const scheine = await db.scheine.where('baustelleId').equals(b.id!).toArray();
    const summe = scheine
      .filter((s) => s.zustand === 'offen')
      .reduce((n, s) => n + s.positionen.length, 0);
    zahlen.set(b.id!, summe);
  }

  const teile: HTMLElement[] = [];

  // Die Browser-Warnung sagt das Wichtigere — zwei Kaesten waeren einer zu viel.
  const erinnerung = browserWarnung() ?? await sicherungFaellig();
  if (erinnerung) teile.push(h('div', { class: 'polster' }, erinnerung));

  if (!offen.length) {
    teile.push(
      h('div', { class: 'leer', text: `Noch kein Projekt. Oben rechts mit dem Plus anlegen — danach ${AM_PC ? 'klickst' : 'tippst'} du es nur noch an.` }),
    );
  }

  for (const b of offen) {
    const kunde = b.kundeId ? kundeVon.get(b.kundeId) : undefined;
    const anzahl = zahlen.get(b.id!) ?? 0;
    teile.push(wischbar(
      h(
        'button',
        { class: 'reihe', type: 'button', onclick: () => gehe('schein', b.id!) },
        h(
          'div',
          {},
          h('div', { class: 'haupt', text: projektTitel(b, kunde?.name) }),
          h('div', { class: 'neben', text: projektUnter(b, kunde?.name) }),
        ),
        h('span', {
          class: 'zaehler',
          text: anzahl ? `${anzahl} Pos.` : 'leer',
          style: anzahl ? '' : 'background:none;color:var(--ink-muted)',
        }),
      ),
      { text: 'Löschen', tun: () => void projektLoeschen(b.id!) },
    ));
  }

  return teile;
}

/**
 * Nur im Browser offen und ohne Dropbox: Der Browser darf die Daten jederzeit
 * wegraeumen, und dann ist nichts mehr da. Das ist so einem Kunden passiert -
 * daher steht der Hinweis, bis die App installiert oder verbunden ist.
 */
function browserWarnung(): HTMLElement | null {
  if (!IM_BROWSER) return null;
  const dropbox = dropboxEingerichtet();
  if (dropbox && dropboxVerbunden()) return null;

  const knopf = (text: string, tun: () => void) => h('button', {
    class: 'knopf leise', type: 'button', text,
    style: 'text-align:left;padding:0;min-height:32px', onclick: tun,
  });

  // Am iPhone faengt die installierte App leer an — die Daten muessen vorher
  // in die Dropbox oder in eine Sicherung, sonst bleiben sie in Safari zurueck.
  const weg = IOS
    ? `Teilen-Symbol, dann „Zum Home-Bildschirm“. Vorher ${dropbox ? 'mit Dropbox verbinden' : 'eine Sicherung machen'} — die neue App fängt leer an und holt sich die Daten von dort.`
    : installierbar()
      ? 'Als App installieren, dann bleiben sie liegen.'
      : 'Im Browser-Menü „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen, dann bleiben sie liegen.';

  return h(
    'div',
    { class: 'merk warnung' },
    h('span', { text: '⚠️' }),
    h(
      'span',
      {},
      h('b', { text: 'Nur im Browser geöffnet. ' }),
      'Der Browser darf die Daten dieser Seite ohne Nachfrage löschen — dann sind Projekte und Archiv weg. ',
      weg,
      h('br'),
      dropbox
        ? knopf('Mit Dropbox verbinden', () => void dropboxVerbinden())
        : knopf('In den Einstellungen sichern', () => einstellungenOeffnen('daten')),
      !IOS && installierbar() ? h('br') : null,
      !IOS && installierbar() ? knopf('App installieren', () => void installieren().then(neu)) : null,
    ),
  );
}

async function sicherungFaellig(): Promise<HTMLElement | null> {
  // Mit Dropbox liegt alles ohnehin noch einmal ausser Haus.
  if (dropboxEingerichtet() && dropboxVerbunden()) return null;
  const e = zustand.einstellungen ?? (await einstellungenLesen());
  const tage = e.letzteSicherung ? tageSeit(e.letzteSicherung) : Infinity;
  const wegenZeit = tage >= SICHERUNG_TAGE;
  const wegenMenge = e.neueArtikel >= SICHERUNG_ARTIKEL;
  if (!wegenZeit && !wegenMenge) return null;

  const grund = !e.letzteSicherung
    ? 'Noch nie gesichert.'
    : wegenZeit
      ? `Letzte Sicherung vor ${tage} Tagen.`
      : `${e.neueArtikel} neue Artikel seit der letzten Sicherung.`;

  // Ruhiger Hinweis statt Pop-up: ein Pop-up wird weggetippt, ohne gelesen zu
  // werden — und ist dann schlechter als keine Erinnerung.
  return h(
    'div',
    { class: 'merk' },
    h('span', { text: '💾' }),
    h(
      'span',
      {},
      h('b', { text: 'Sicherung fällig. ' }),
      AM_PC
        ? `${grund} Das Archiv liegt nur auf diesem Rechner — ohne Sicherung ist es weg, wenn er ausfällt.`
        : `${grund} Das Handy sichert die App nicht von selbst — ohne Sicherung ist dein Archiv bei Geräteverlust weg.`,
      h('br'),
      h('button', {
        class: 'knopf leise',
        type: 'button',
        text: 'In den Einstellungen sichern',
        style: 'text-align:left;padding:0;min-height:32px',
        onclick: () => einstellungenOeffnen('daten'),
      }),
    ),
  );
}

/**
 * Neues Projekt anlegen. `oeffnen` springt danach in den Schein — aus dem
 * Register heraus bleibt man dagegen in der Liste stehen. `oben` steht ueber
 * den Feldern - dort sitzt im Archiv der Umschalter Projekt | Artikel.
 */
export function baustelleAnlegen(oeffnen = true, oben?: HTMLElement): void {
  const ort = h('input', { type: 'text', placeholder: 'z.B. Hauptstraße 5' });
  const kunde = h('input', { type: 'text', placeholder: 'z.B. Familie Huber' });
  blatt(
    'Neues Projekt',
    [
      oben ?? null,
      h('label', { class: 'feld' }, h('span', { text: 'Ort' }), ort),
      h('label', { class: 'feld' }, h('span', { text: 'Kunde' }), kunde),
      // Werkstatt und Lager haben keinen Kunden, manche Arbeit keine feste
      // Adresse — eines von beiden reicht.
      h('p', { class: 'hinweis', style: 'padding:0', text: 'Ort, Kunde oder beides – eines genügt.' }),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      {
        text: 'Anlegen',
        tun: async () => {
          const o = ort.value.trim();
          const kn = kunde.value.trim();
          if (!o && !kn) {
            melden('Nicht angelegt', 'Ort oder Kunde eintragen – eines genügt.');
            return;
          }
          let kundeId: number | undefined;
          if (kn) {
            const da = await db.kunden.where('name').equals(kn).first();
            kundeId = da?.id ?? (await db.kunden.add({ name: kn }));
          }
          const id = await db.baustellen.add({ ort: o, kundeId, zuletzt: Date.now() });
          if (oeffnen) gehe('schein', id);
          else neu();
        },
      },
    ],
  );
  setTimeout(() => ort.focus(), 50);
}

/** Uebergabe und Sicherung kommen durch dieselbe Tuer. */
async function einlesen(): Promise<void> {
  const text = await dateiWaehlen();
  if (text === null) return;
  const v = vorschau(text);

  if (v.art === 'fehler') {
    melden('Das klappt nicht', v.text);
    return;
  }

  if (v.art === 'schein') {
    blatt(
      'Schein übernehmen?',
      [
        h('div', { class: 'karte' },
          zeile('Projekt', v.ort),
          zeile('Positionen', String(v.positionen)),
          zeile('Von', v.absender),
          zeile('Erstellt', v.zeitpunkt),
        ),
        h('p', { class: 'hinweis', style: 'padding:0',
          text: 'Der Schein kommt als eigener offener Schein dazu und behält den Vermerk, von wem er stammt.' }),
      ],
      [
        { text: 'Abbrechen', art: 'zweit' },
        {
          text: 'Übernehmen',
          tun: async () => {
            await scheinUebernehmen(v.umschlag);
            neu();
          },
        },
      ],
    );
    return;
  }

  if (v.art === 'katalog') {
    blatt(
      'Ins Archiv übernehmen?',
      [
        h('div', { class: 'karte' },
          v.massgeblich ? zeile('Archiv von', v.absender) : zeile('Grundstock', v.titel),
          zeile('Artikel', String(v.artikel)),
          zeile('Erstellt', v.zeitpunkt),
        ),
        h('p', { class: 'hinweis', style: 'padding:0',
          text: v.massgeblich
            ? 'Fehlende Artikel kommen dazu. Gleichnamige übernehmen Einheit, Ordner und Codes aus der Datei. Was nur hier steht, bleibt – nichts wird gelöscht.'
            : 'Fehlende Artikel kommen ins Archiv dazu. Was schon da ist, bleibt, wie es ist – nichts wird gelöscht.' }),
      ],
      [
        { text: 'Abbrechen', art: 'zweit' },
        {
          text: 'Übernehmen',
          tun: async () => {
            const r = await katalogEinlesen(v.umschlag);
            zustand.einstellungen = await einstellungenLesen();
            neu();
            const teile = [`${r.neu} Artikel neu im Archiv`];
            if (r.angeglichen) teile.push(`${r.angeglichen} angeglichen`);
            const gleich = r.vorhanden - r.angeglichen;
            if (gleich) teile.push(v.massgeblich ? `${gleich} unverändert` : `${gleich} waren schon da`);
            melden('Ins Archiv übernommen', `${teile.join(', ')}.`);
          },
        },
      ],
    );
    return;
  }

  blatt(
    'Sicherung einspielen',
    [
      h('div', { class: 'karte' },
        zeile('Erstellt', v.zeitpunkt),
        zeile('Artikel', String(v.artikel)),
        zeile('Projekte', String(v.baustellen)),
        zeile('Scheine', String(v.scheine)),
      ),
      h('div', { class: 'merk warnung' },
        h('span', { text: '⚠️' }),
        h('span', { html: '<b>Ersetzen löscht alles,</b> was jetzt auf diesem Gerät ist. Zusammenführen kann nichts vernichten.' }),
      ),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      {
        text: 'Ersetzen',
        art: 'gefahr',
        tun: async () => {
          await sicherungEinspielen(v.umschlag, 'ersetzen');
          zustand.einstellungen = await einstellungenLesen();
          neu();
        },
      },
      {
        text: 'Zusammenführen',
        tun: async () => {
          await sicherungEinspielen(v.umschlag, 'zusammenfuehren');
          zustand.einstellungen = await einstellungenSchreiben({});
          neu();
        },
      },
    ],
  );
}

function zeile(k: string, v: string): HTMLElement {
  return h('div', { class: 'paar' }, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v }));
}

export type { Baustelle, Kunde };
