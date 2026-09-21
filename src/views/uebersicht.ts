import { db, einstellungenLesen, einstellungenSchreiben } from '../db';
import { SICHERUNG_ARTIKEL, SICHERUNG_TAGE, type Baustelle, type Kunde } from '../model';
import { gehe, neu, zustand } from '../store';
import { blatt, h, ikon, kopfKnopf, kopfRechts, marke, melden } from '../ui';
import { tageSeit } from '../lib/format';
import { dateiWaehlen } from '../lib/share';
import { scheinUebernehmen, sicherungEinspielen, vorschau } from '../lib/transfer';
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
    ),
    kopfRechts(
      null,
      // Das Einlesen gehoert hierher, nicht in das Projekt: wer einen Schein
      // empfaengt, hat das zugehoerige Projekt meist noch gar nicht.
      kopfKnopf({ ikon: 'einlesen', titel: 'Datei einlesen', tun: einlesen }),
      kopfKnopf({ ikon: 'plus', titel: 'Neues Projekt', art: 'haupt', tun: () => baustelleAnlegen() }),
    ),
  );
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
    'aria-label': 'Projekte, Scheine, Positionen und Katalog nach Stichwörtern durchsuchen',
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
        'Nichts gefunden. Versuch es mit einem Wort weniger — gesucht wird in Projekten, Kunden, Scheinen, einzelnen Positionen und im Katalog.' }),
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

  const erinnerung = await sicherungFaellig();
  if (erinnerung) teile.push(h('div', { class: 'polster' }, erinnerung));

  if (!offen.length) {
    teile.push(
      h('div', { class: 'leer', text: 'Noch kein Projekt. Oben rechts mit dem Plus anlegen — danach tippst du es nur noch an.' }),
    );
  }

  for (const b of offen) {
    const kunde = b.kundeId ? kundeVon.get(b.kundeId) : undefined;
    const anzahl = zahlen.get(b.id!) ?? 0;
    teile.push(
      h(
        'button',
        { class: 'reihe', type: 'button', onclick: () => gehe('schein', b.id!) },
        h(
          'div',
          {},
          h('div', { class: 'haupt', text: b.ort }),
          h('div', { class: 'neben', text: kunde?.name ?? 'ohne Kunden' }),
        ),
        h('span', {
          class: 'zaehler',
          text: anzahl ? `${anzahl} Pos.` : 'leer',
          style: anzahl ? '' : 'background:none;color:var(--ink-muted)',
        }),
      ),
    );
  }

  return teile;
}

async function sicherungFaellig(): Promise<HTMLElement | null> {
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
      `${grund} Das Handy sichert die App nicht von selbst — ohne Sicherung ist dein Katalog bei Geräteverlust weg.`,
      h('br'),
      h('button', {
        class: 'knopf leise',
        type: 'button',
        text: 'In den Einstellungen sichern',
        style: 'text-align:left;padding:0;min-height:32px',
        onclick: () => gehe('einstellungen'),
      }),
    ),
  );
}

/**
 * Neues Projekt anlegen. `oeffnen` springt danach in den Schein — aus dem
 * Register heraus bleibt man dagegen in der Liste stehen.
 */
export function baustelleAnlegen(oeffnen = true): void {
  const ort = h('input', { type: 'text', placeholder: 'z.B. Hauptstraße 5' });
  const kunde = h('input', { type: 'text', placeholder: 'leer lassen für Werkstatt o.ä.' });
  blatt(
    'Neues Projekt',
    [
      h('label', { class: 'feld' }, h('span', { text: 'Ort' }), ort),
      h('label', { class: 'feld' }, h('span', { text: 'Kunde (optional)' }), kunde),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      {
        text: 'Anlegen',
        tun: async () => {
          const o = ort.value.trim();
          if (!o) return;
          let kundeId: number | undefined;
          const kn = kunde.value.trim();
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
