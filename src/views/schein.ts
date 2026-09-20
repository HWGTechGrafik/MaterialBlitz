import {
  artikelVerwenden, db, einstellungenLesen, kacheln, offenerSchein,
  scheineDerBaustelle, speicherSichern, suchen,
} from '../db';
import {
  istZaehlbar, positionHinzufuegen, runden,
  type Baustelle, type Kunde, type Position, type Schein,
} from '../model';
import { gehe, neu, zustand } from '../store';
import { blatt, h, kopfKnopf, kopfRechts, langDruck, melden } from '../ui';
import { datum, menge as mengeText, zahl, zeit } from '../lib/format';
import { csvDatei } from '../lib/csv';
import { teilen } from '../lib/share';
import { scheinPacken } from '../lib/transfer';

/** Welcher offene Schein gerade bearbeitet wird (eigener oder uebernommener). */
let gewaehlt: number | undefined;
/** Offene Eingabe: Artikel gewaehlt, Menge fehlt noch. */
let block: { name: string; einheit: string; bearbeitet?: number } | null = null;
let sucheOffen = false;

export function scheinZuruecksetzen(): void {
  gewaehlt = undefined;
  block = null;
  sucheOffen = false;
}

export async function scheinView(): Promise<HTMLElement[]> {
  const baustelleId = zustand.baustelleId!;
  const baustelle = await db.baustellen.get(baustelleId);
  if (!baustelle) {
    gehe('uebersicht');
    return [];
  }
  const kunde = baustelle.kundeId ? await db.kunden.get(baustelle.kundeId) : undefined;

  const alle = await scheineDerBaustelle(baustelleId);
  const offene = alle.filter((s) => s.zustand === 'offen');
  if (!offene.length) offene.push(await offenerSchein(baustelleId));
  // Voreingestellt ist der eigene Schein, nicht ein uebernommener: sonst
  // schreibt man versehentlich in die Arbeit eines Kollegen.
  const schein =
    offene.find((s) => s.id === gewaehlt) ?? offene.find((s) => !s.herkunft) ?? offene[0]!;
  gewaehlt = schein.id;

  const erledigt = alle.filter((s) => s.zustand !== 'offen');

  const teile = [
    kopfBauen(baustelle, kunde, schein),
    await rumpfBauen(baustelle, schein, offene, erledigt),
  ];
  // Der Fuss kommt nur, wenn er etwas zu zeigen hat. Sonst gehoert die
  // gesamte Hoehe den Positionen und den Kacheln.
  const fuss = await fussBauen(baustelle, schein);
  if (fuss) teile.push(fuss);
  return teile;
}

// ------------------------------------------------------------------- Kopf

function kopfBauen(baustelle: Baustelle, kunde: Kunde | undefined, schein: Schein): HTMLElement {
  return h(
    'div',
    { class: 'kopf' },
    h('button', {
      class: 'zurueck', type: 'button', 'aria-label': 'Zurück zu den Projekten',
      html: '&lsaquo;',
      onclick: () => { scheinZuruecksetzen(); gehe('uebersicht'); },
    }),
    h(
      'div',
      { class: 'kopf-text' },
      h('div', { class: 'eyebrow', text: schein.herkunft ? `Übernommen · ${schein.herkunft}` : 'Offener Schein' }),
      h('h1', { text: baustelle.ort + (schein.bezeichnung ? ` · ${schein.bezeichnung}` : '') }),
      h('div', { class: 'unter', text: kunde?.name ?? 'ohne Kunden' }),
    ),
    kopfRechts(
      h('span', { class: 'zaehler', text: `${schein.positionen.length} Pos.` }),
      kopfKnopf({
        ikon: 'mehr',
        titel: 'Übergeben, Bezeichnung, mehr',
        tun: () => mehr(baustelle, kunde, schein),
      }),
      kopfKnopf({
        ikon: 'senden',
        titel: 'Ans Büro senden',
        art: 'haupt',
        gesperrt: schein.positionen.length === 0,
        tun: () => senden(baustelle, kunde, schein),
      }),
    ),
  );
}

// ------------------------------------------------------------------ Rumpf

async function rumpfBauen(
  baustelle: Baustelle, schein: Schein, offene: Schein[], erledigt: Schein[],
): Promise<HTMLElement> {
  const rumpf = h('div', { class: 'rumpf' });

  // Mehrere offene Scheine gibt es nur, wenn einer uebernommen wurde.
  if (offene.length > 1) {
    const streifen = h('div', { class: 'hinweis', style: 'display:flex;gap:6px;flex-wrap:wrap' });
    for (const s of offene) {
      streifen.append(
        h('button', {
          class: 'knopf leise',
          type: 'button',
          style: `width:auto;flex:0 0 auto;padding:0 14px;min-height:38px;border:1px solid var(--line);border-radius:100px;${
            s.id === schein.id ? 'background:var(--ader);color:#fff' : ''
          }`,
          text: s.herkunft ?? 'eigener Schein',
          onclick: () => { gewaehlt = s.id; block = null; neu(); },
        }),
      );
    }
    rumpf.append(streifen);
  }

  if (!schein.positionen.length) {
    rumpf.append(h('div', { class: 'leer', text: 'Noch nichts aufgeschrieben. Kachel antippen genügt.' }));
  } else {
    schein.positionen.forEach((p, i) => {
      rumpf.append(
        h(
          'button',
          {
            class: 'pos' + (zustand.frisch === i ? ' frisch' : ''),
            type: 'button',
            onclick: () => { block = { name: p.name, einheit: p.einheit, bearbeitet: i }; neu(); },
          },
          h('span', { class: 'name', text: p.name }),
          h('span', { class: 'menge', text: mengeText(p.menge) }),
          h('span', { class: 'einheit', text: p.einheit }),
          h('span', { class: 'pfeil', html: '&rsaquo;' }),
        ),
      );
    });
    rumpf.append(h('div', { class: 'hinweis', text: 'Position antippen, um Menge zu ändern oder zu löschen.' }));
  }

  // Kacheln
  const liste = await kacheln(baustelle.id!, 10);
  if (liste.length) {
    const raster = h('div', { class: 'kacheln' });
    for (const a of liste) {
      const zaehlbar = istZaehlbar(a.einheit);
      const knopf = h(
        'button',
        { class: 'kachel', type: 'button' },
        h('span', { class: 'nm', text: a.name }),
        h('span', {
          class: 'meta',
          html: a.hier ? `${a.einheit} · <b>${a.hier}×</b> hier` : `${a.einheit} · allgemein häufig`,
        }),
        zaehlbar ? h('span', { class: 'lang', text: 'lang drücken = +1' }) : null,
      );
      knopf.onclick = () => {
        if (knopf.dataset.lang === 'ja') { knopf.dataset.lang = ''; return; }
        block = { name: a.name, einheit: a.einheit };
        neu();
      };
      if (zaehlbar) {
        langDruck(knopf, 420, async () => {
          await mengeUebernehmen(a.name, 1, a.einheit);
        });
      }
      raster.append(knopf);
    }
    rumpf.append(raster);
  } else {
    rumpf.append(h('div', { class: 'leer', text: 'Der Katalog ist noch leer. Über „Anderes Material suchen" den ersten Artikel anlegen.' }));
  }

  rumpf.append(
    h('div', { style: 'padding:0 16px 14px' },
      h('button', {
        class: 'knopf zweit', type: 'button', text: 'Anderes Material suchen…',
        onclick: () => { sucheOffen = true; block = null; neu(); },
      }),
    ),
  );

  if (erledigt.length) {
    rumpf.append(
      h('button', {
        class: 'reihe', type: 'button',
        onclick: () => historieZeigen(baustelle, erledigt),
        style: 'border-top:1px solid var(--line)',
      },
        h('div', {},
          h('div', { class: 'haupt', text: 'Frühere Scheine' }),
          h('div', { class: 'neben', text: `${erledigt.length} abgegeben` }),
        ),
        h('span', { class: 'pfeil', html: '&rsaquo;' }),
      ),
    );
  }

  return rumpf;
}

// -------------------------------------------------------------------- Fuss

async function fussBauen(baustelle: Baustelle, schein: Schein): Promise<HTMLElement | null> {
  if (block) return h('div', { class: 'fuss' }, zifferblock(schein));
  if (sucheOffen) return h('div', { class: 'fuss' }, await suchfeld(baustelle));
  return null;
}

// ------------------------------------------------------------ Zifferblock

function zifferblock(schein: Schein): HTMLElement {
  const b = block!;
  const bearbeitung = b.bearbeitet !== undefined;
  const start = bearbeitung ? mengeText(schein.positionen[b.bearbeitet!]!.menge) : '';
  let wert = start;
  // Beim Aendern steht die alte Menge schon da: die erste Ziffer ersetzt sie.
  let ersteTaste = bearbeitung;

  const anzeige = h('span', { class: 'block-wert', text: wert || '0' });
  const tasten = h('div', { class: 'tasten' });

  for (const t of ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫']) {
    tasten.append(
      h('button', {
        type: 'button', text: t,
        onclick: () => {
          if (ersteTaste && t !== '⌫') wert = '';
          ersteTaste = false;
          if (t === '⌫') wert = wert.slice(0, -1);
          else if (t === ',' && wert.includes(',')) return;
          else wert += t;
          anzeige.textContent = wert || '0';
        },
      }),
    );
  }

  tasten.append(
    h('button', { class: 'ab', type: 'button', text: 'Zurück', onclick: () => { block = null; neu(); } }),
    h('button', {
      class: 'ok', type: 'button', text: bearbeitung ? 'Ändern' : 'Übernehmen',
      onclick: async () => {
        const n = runden(zahl(wert));
        if (!n) { block = null; neu(); return; }
        if (bearbeitung) await positionAendern(b.bearbeitet!, n);
        else await mengeUebernehmen(b.name, n, b.einheit);
      },
    }),
  );

  return h('div', { class: 'block' },
    h('div', { class: 'block-kopf' },
      h('span', { class: 'block-artikel', text: b.name }),
      h('span', {}, anzeige, ' ', h('span', { class: 'block-eh', text: b.einheit })),
      // Weit weg vom Ziffernweg des Daumens — ein Loeschknopf neben der 0
      // waere mit Arbeitshandschuhen eine Falle.
      bearbeitung
        ? h('button', {
            class: 'block-loeschen', type: 'button', text: 'Löschen',
            onclick: () => positionLoeschen(b.bearbeitet!),
          })
        : null,
    ),
    tasten,
  );
}

// ---------------------------------------------------------------- Suche

async function suchfeld(baustelle: Baustelle): Promise<HTMLElement> {
  const treffer = h('div', { class: 'treffer' });
  const eingabe = h('input', { type: 'text', placeholder: 'Zwei Buchstaben genügen…', autocomplete: 'off' });

  const aktualisieren = async () => {
    treffer.replaceChildren();
    const q = eingabe.value.trim();
    const gefunden = await suchen(q, baustelle.id);
    for (const a of gefunden) {
      treffer.append(
        h('button', { type: 'button', onclick: () => { sucheOffen = false; block = { name: a.name, einheit: a.einheit }; neu(); } },
          h('span', { class: 'nm', text: a.name }),
          a.hier ? h('span', { class: 'plakette', text: 'hier' }) : null,
          h('span', { class: 'eh', text: a.einheit }),
        ),
      );
    }
    if (q.length >= 2 && !gefunden.some((a) => a.name.toLowerCase() === q.toLowerCase())) {
      treffer.append(
        h('button', { type: 'button', onclick: () => neuerArtikel(q) },
          h('span', { class: 'nm neu', text: `„${q}" neu anlegen` }),
          h('span', { class: 'eh', text: 'Einheit wählen' }),
        ),
      );
    }
  };
  eingabe.addEventListener('input', aktualisieren);

  const kasten = h('div', {},
    treffer,
    h('div', { class: 'suchfeld' },
      h('label', { class: 'feld', style: 'margin:0' }, eingabe),
      h('button', { class: 'knopf leise', type: 'button', text: 'Abbrechen', onclick: () => { sucheOffen = false; neu(); } }),
    ),
  );
  setTimeout(() => eingabe.focus(), 60);
  return kasten;
}

/** Neuen Artikel im Fluss anlegen — ohne den Bildschirm zu verlassen. */
async function neuerArtikel(name: string): Promise<void> {
  const e = await einstellungenLesen();
  const auswahl = h('select', {}, ...e.einheiten.map((u) => h('option', { value: u, text: u })));
  blatt(
    'Neuer Artikel',
    [
      h('p', { class: 'hinweis', style: 'padding:0', text: `„${name}" landet im Katalog und ist in jedem Projekt wieder da.` }),
      h('label', { class: 'feld' }, h('span', { text: 'Einheit' }), auswahl),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      {
        text: 'Anlegen',
        tun: () => {
          sucheOffen = false;
          block = { name, einheit: auswahl.value };
          neu();
        },
      },
    ],
  );
}

// ------------------------------------------------------------ Positionen

async function mengeUebernehmen(name: string, n: number, einheit: string): Promise<void> {
  const schein = await db.scheine.get(gewaehlt!);
  if (!schein) return;
  const { positionen, index } = positionHinzufuegen(schein.positionen, name, n, einheit);
  await db.scheine.update(schein.id!, { positionen });
  await db.baustellen.update(schein.baustelleId, { zuletzt: Date.now() });
  await artikelVerwenden(name, einheit);
  await speicherSichern();
  block = null;
  zustand.frisch = index;
  neu();
}

async function positionAendern(index: number, n: number): Promise<void> {
  const schein = await db.scheine.get(gewaehlt!);
  if (!schein) return;
  const positionen = schein.positionen.slice();
  positionen[index] = { ...positionen[index]!, menge: n };
  await db.scheine.update(schein.id!, { positionen });
  block = null;
  zustand.frisch = index;
  neu();
}

async function positionLoeschen(index: number): Promise<void> {
  const schein = await db.scheine.get(gewaehlt!);
  if (!schein) return;
  const positionen = schein.positionen.filter((_, i) => i !== index);
  await db.scheine.update(schein.id!, { positionen });
  block = null;
  zustand.frisch = undefined;
  neu();
}

// -------------------------------------------------------------- Abgeben

async function senden(baustelle: Baustelle, kunde: Kunde | undefined, schein: Schein): Promise<void> {
  const e = await einstellungenLesen();
  const stand: Schein = { ...schein, beendet: Date.now() };
  // jsPDF ist der groesste Brocken und wird erst hier gebraucht. Nachladen
  // statt mitschleppen: der Start auf der Baustelle bleibt leicht, und der
  // Service Worker hat die Datei trotzdem im Vorrat.
  const { pdfDatei } = await import('../lib/pdf');
  const dateien = [csvDatei(stand, baustelle, kunde), pdfDatei(stand, baustelle, e.firma, kunde)];

  const ergebnis = await teilen(dateien);
  if (ergebnis === 'abgebrochen') return;
  if (ergebnis === 'nicht-moeglich') {
    melden('Teilen nicht möglich', 'Dieses Gerät bietet keinen Teilen-Dialog für Dateien an.');
    return;
  }

  // "Geteilt", nicht "gesendet": ob die Mail wirklich abging, erfaehrt die App
  // nicht. Sie behauptet nur, was sie weiss.
  await db.scheine.update(schein.id!, { zustand: 'geteilt', beendet: stand.beendet });
  scheinZuruecksetzen();
  neu();
}

function mehr(baustelle: Baustelle, kunde: Kunde | undefined, schein: Schein): void {
  blatt(
    'Weitere Möglichkeiten',
    [
      h('p', { class: 'hinweis', style: 'padding:0',
        text: 'Übergeben sperrt diesen Schein — danach schreibt nur noch der Kollege weiter.' }),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      { text: 'Bezeichnung', art: 'zweit', tun: () => bezeichnen(schein) },
      { text: 'Übergeben', tun: () => uebergeben(baustelle, kunde, schein) },
    ],
  );
}

function bezeichnen(schein: Schein): void {
  const feld = h('input', { type: 'text', value: schein.bezeichnung ?? '', placeholder: 'z.B. Top 12' });
  blatt(
    'Bezeichnung',
    [
      h('p', { class: 'hinweis', style: 'padding:0',
        text: 'Hilft, mehrere Scheine desselben Projekts auseinanderzuhalten. Leer lassen ist der Normalfall.' }),
      h('label', { class: 'feld' }, feld),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      {
        text: 'Speichern',
        tun: async () => {
          await db.scheine.update(schein.id!, { bezeichnung: feld.value.trim() || undefined });
          neu();
        },
      },
    ],
  );
}

async function uebergeben(baustelle: Baustelle, kunde: Kunde | undefined, schein: Schein): Promise<void> {
  const e = await einstellungenLesen();
  const absender = e.firma.name || 'MaterialBlitz';
  const datei = await scheinPacken(schein, baustelle, kunde, absender);

  const ergebnis = await teilen([datei]);
  if (ergebnis !== 'geteilt') return;

  await db.scheine.update(schein.id!, { zustand: 'uebergeben', beendet: Date.now() });
  scheinZuruecksetzen();
  neu();
}

// ------------------------------------------------------------- Historie

function historieZeigen(baustelle: Baustelle, erledigt: Schein[]): void {
  const liste = erledigt.map((s) =>
    h('button', {
      class: 'reihe', type: 'button',
      onclick: () => nachtragAnbieten(baustelle, s),
    },
      h('div', {},
        h('div', { class: 'haupt', text: `${datum(s.beendet ?? s.erstellt)}, ${zeit(s.beendet ?? s.erstellt)}` }),
        h('div', { class: 'neben',
          text: `${s.positionen.length} Positionen · ${s.zustand === 'geteilt' ? 'ans Büro geteilt' : 'übergeben'}` }),
      ),
      h('span', { class: 'pfeil', html: '&rsaquo;' }),
    ),
  );
  blatt('Frühere Scheine', liste, [{ text: 'Schließen', art: 'zweit' }]);
}

/**
 * Ein abgegebener Schein wird nie veraendert — das Buero koennte die Aenderung
 * nicht bemerken. Korrekturen laufen ueber einen Nachtrag.
 */
function nachtragAnbieten(baustelle: Baustelle, alt: Schein): void {
  blatt(
    'Nachtrag',
    [
      h('p', { class: 'hinweis', style: 'padding:0',
        text: 'Dieser Schein ist abgegeben und bleibt unverändert. Fehlendes Material kommt als Nachtrag dazu — ein neuer Schein, vorbefüllt aus diesem.' }),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      {
        text: 'Nachtrag anlegen',
        tun: async () => {
          const positionen: Position[] = alt.positionen.map((p) => ({ ...p }));
          const id = await db.scheine.add({
            baustelleId: baustelle.id!,
            bezeichnung: alt.bezeichnung,
            zustand: 'offen',
            erstellt: Date.now(),
            nachtragVon: alt.id,
            positionen,
          });
          gewaehlt = id;
          neu();
        },
      },
    ],
  );
}
