import {
  artikelMitCode, artikelMitText, artikelVerwenden, db, einstellungenLesen, kacheln, offenerSchein,
  scheineDerBaustelle, speicherSichern, suchen, verwendungHier,
} from '../db';
import { ordnerListe } from '../lib/ordner';
import {
  istZaehlbar, nummernErgaenzen, positionHinzufuegen, projektTitel, projektUnter, runden,
  type Artikel, type Baustelle, type Kunde, type Position, type Schein,
} from '../model';
import { ersteller, erstellerText, firmenkopf, gehe, neu, zustand } from '../store';
import { blatt, h, ikon, kopfKnopf, kopfRechts, langDruck, melden } from '../ui';
import { codeNormalisieren, qrLesen } from '../lib/codes';
import { datum, menge as mengeText, zahl, zeit } from '../lib/format';
import { kopfLogo } from '../lib/logo';
import { inZwischenablage, teilen } from '../lib/share';
import { AM_PC, NICHT_MOEGLICH } from '../lib/geraet';
import { scheinPacken } from '../lib/transfer';
import { scheinName, vermerken } from '../lib/verlauf';
import { verlaufZeigen } from './verlauf';

/** Welcher offene Schein gerade bearbeitet wird (eigener oder uebernommener). */
let gewaehlt: number | undefined;
/** Offene Eingabe: Artikel gewaehlt, Menge fehlt noch. */
let block: { name: string; einheit: string; bearbeitet?: number } | null = null;
let sucheOffen = false;
/** Ordner, der in der Suche gerade aufgeklappt ist. */
let ordnerAuf: string | null = null;

export function scheinZuruecksetzen(): void {
  gewaehlt = undefined;
  block = null;
  sucheOffen = false;
  ordnerAuf = null;
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
      class: 'zurueck', type: 'button', 'aria-label': 'Zurück zum Dashboard',
      html: '&lsaquo;',
      onclick: () => { scheinZuruecksetzen(); gehe('uebersicht'); },
    }),
    h(
      'div',
      { class: 'kopf-text' },
      h('div', { class: 'eyebrow', text: schein.herkunft ? `Übernommen · ${schein.herkunft}` : 'Offener Schein' }),
      h('h1', { text: projektTitel(baustelle, kunde?.name) + (schein.bezeichnung ? ` · ${schein.bezeichnung}` : '') }),
      h('div', { class: 'unter', text: projektUnter(baustelle, kunde?.name) }),
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
  // Am PC zwei Spalten: links was aufgeschrieben ist, rechts womit man
  // aufschreibt. Am Handy loesen sich beide auf (display: contents) und
  // alles steht untereinander wie bisher.
  const links = h('div', { class: 'schein-spalte' });
  const rechts = h('div', { class: 'schein-spalte' });
  const raster = h('div', { class: 'schein-raster' }, links, rechts);

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
    links.append(streifen);
  }

  if (!schein.positionen.length) {
    links.append(h('div', { class: 'leer', text: `Noch nichts aufgeschrieben. Kachel ${AM_PC ? 'anklicken' : 'antippen'} genügt.` }));
  } else {
    schein.positionen.forEach((p, i) => {
      links.append(
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
    links.append(h('div', { class: 'hinweis', text: `Position ${AM_PC ? 'anklicken' : 'antippen'}, um Menge zu ändern oder zu löschen.` }));
  }

  // Kacheln
  const liste = await kacheln(baustelle.id!, 10);
  if (liste.length) {
    const kachelRaster = h('div', { class: 'kacheln' });
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
        zaehlbar ? h('span', { class: 'lang', text: AM_PC ? 'gedrückt halten = +1' : 'lang drücken = +1' }) : null,
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
      kachelRaster.append(knopf);
    }
    rechts.append(kachelRaster);
  } else {
    rechts.append(h('div', { class: 'leer', text: 'Das Archiv ist noch leer. Über „Anderes Material suchen" den ersten Artikel anlegen.' }));
  }

  rechts.append(
    h('div', { class: 'such-reihe' },
      h('button', {
        class: 'knopf zweit scan-knopf', type: 'button', 'aria-label': 'Code scannen',
        onclick: () => void scannenUndWaehlen(baustelle),
      }, ikon('strichcode'), 'Code scannen'),
      h('button', {
        class: 'knopf zweit', type: 'button', text: 'Anderes Material suchen…',
        onclick: () => { sucheOffen = true; block = null; neu(); },
      }),
    ),
  );

  if (erledigt.length) {
    rechts.append(
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

  const eintraege = await db.verlauf.where('baustelleId').equals(baustelle.id!).count();
  rechts.append(
    h('button', {
      class: 'reihe', type: 'button',
      onclick: () => void verlaufZeigen(baustelle),
      style: erledigt.length ? '' : 'border-top:1px solid var(--line)',
    },
      h('div', {},
        h('div', { class: 'haupt', text: 'Verlauf' }),
        h('div', { class: 'neben', text: eintraege ? `${eintraege} Einträge mit Datum und Uhrzeit` : 'Wann wie viel von was – wird ab jetzt mitgeschrieben' }),
      ),
      h('span', { class: 'pfeil', html: '&rsaquo;' }),
    ),
  );

  rumpf.append(raster);
  return rumpf;
}

// -------------------------------------------------------------------- Fuss

/**
 * Am PC tippt man die Menge lieber: Ziffern, Komma oder Punkt, Ruecktaste,
 * Enter zum Uebernehmen, Esc zum Schliessen. Gilt, solange der Zifferblock
 * offen ist und kein Eingabefeld den Fokus hat.
 */
let tastenHorcher: ((ev: KeyboardEvent) => void) | null = null;

function tastaturLoesen(): void {
  if (tastenHorcher) document.removeEventListener('keydown', tastenHorcher);
  tastenHorcher = null;
}

function tastaturBinden(tasten: HTMLElement): void {
  tastaturLoesen();
  tastenHorcher = (ev) => {
    // Schein verlassen, ohne den Block zu schliessen: dann nichts mehr tun —
    // sonst uebernaehme Enter im Dashboard noch eine Menge.
    if (!tasten.isConnected) { tastaturLoesen(); return; }
    // Gehaltene Taste und Tastenkuerzel (Strg+C …) zaehlen nicht.
    if (ev.repeat || ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const ziel = ev.target;
    if ((ziel instanceof Element && ziel.closest('input, textarea, select')) || document.querySelector('.schatten')) return;
    const text = /^[0-9]$/.test(ev.key) ? ev.key
      : ev.key === ',' || ev.key === '.' ? ','
      : ev.key === 'Backspace' ? '⌫'
      : null;
    let knopf: HTMLButtonElement | null | undefined = null;
    if (text) knopf = [...tasten.querySelectorAll('button')].find((b) => b.textContent === text);
    else if (ev.key === 'Enter') knopf = tasten.querySelector<HTMLButtonElement>('.ok');
    else if (ev.key === 'Escape') knopf = tasten.querySelector<HTMLButtonElement>('.ab');
    if (!knopf) return;
    ev.preventDefault();
    // Enter und Esc schliessen den Block — ein zweites Enter darf nicht noch
    // einmal uebernehmen, bevor er weg ist.
    if (ev.key === 'Enter' || ev.key === 'Escape') tastaturLoesen();
    knopf.click();
  };
  document.addEventListener('keydown', tastenHorcher);
}

async function fussBauen(baustelle: Baustelle, schein: Schein): Promise<HTMLElement | null> {
  tastaturLoesen();
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
  tastaturBinden(tasten);

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

  const waehlen = (a: Artikel) => { sucheOffen = false; block = { name: a.name, einheit: a.einheit }; neu(); };

  /**
   * Ohne Suchbegriff die Ordner des Archivs: wer nicht weiss, wie der
   * Artikel genau heisst, findet ihn so unter „Kabel" oder „Loxone".
   */
  const ordnerZeigen = async () => {
    const alle = await db.artikel.toArray();
    if (eingabe.value.trim().length >= 2) return;
    const ordner = ordnerListe(alle);
    if (ordnerAuf !== null && ordner.includes(ordnerAuf)) {
      const hier = await verwendungHier(baustelle.id!);
      const drin = alle
        .filter((a) => a.ordner === ordnerAuf)
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
      treffer.replaceChildren(
        h('button', { type: 'button', onclick: () => { ordnerAuf = null; void ordnerZeigen(); } },
          h('span', { class: 'nm neu', text: `‹ ${ordnerAuf}` }),
          h('span', { class: 'eh', text: 'alle Ordner' }),
        ),
        ...drin.map((a) =>
          h('button', { type: 'button', onclick: () => waehlen(a) },
            h('span', { class: 'nm', text: a.name }),
            hier.get(a.name) ? h('span', { class: 'plakette', text: 'hier' }) : null,
            h('span', { class: 'eh', text: a.einheit }),
          )),
      );
      treffer.scrollTop = 0;
      return;
    }
    ordnerAuf = null;
    treffer.replaceChildren(
      ...ordner.map((o) =>
        h('button', { type: 'button', onclick: () => { ordnerAuf = o; void ordnerZeigen(); } },
          ikon('ordner'),
          h('span', { class: 'nm', text: o }),
          h('span', { class: 'eh', text: `${alle.filter((a) => a.ordner === o).length} Artikel` }),
        )),
    );
  };

  const aktualisieren = async () => {
    const q = eingabe.value.trim();
    if (q.length < 2) {
      await ordnerZeigen();
      return;
    }
    treffer.replaceChildren();
    const gefunden = await suchen(q, baustelle.id);
    for (const a of gefunden) {
      treffer.append(
        h('button', { type: 'button', onclick: () => waehlen(a) },
          h('span', { class: 'nm', text: a.name }),
          a.perCode ? h('span', { class: 'plakette', text: 'Code' }) : null,
          a.perNummer ? h('span', { class: 'plakette', text: 'Nr.' }) : null,
          a.hier ? h('span', { class: 'plakette', text: 'hier' }) : null,
          h('span', { class: 'eh', text: a.einheit }),
        ),
      );
    }
    // Ein Code, der passt, ist die Antwort - daraus einen Artikel namens
    // "4006381333931" anzulegen, waere nur ein Stolperstein.
    if (q.length >= 2 && !gefunden.some((a) => a.perCode || a.perNummer || a.name.toLowerCase() === q.toLowerCase())) {
      treffer.append(
        h('button', { type: 'button', onclick: () => neuerArtikel(q) },
          h('span', { class: 'nm neu', text: `„${q}" neu anlegen` }),
          h('span', { class: 'eh', text: 'Einheit wählen' }),
        ),
      );
    }
  };
  eingabe.addEventListener('input', aktualisieren);
  await ordnerZeigen();

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

// ---------------------------------------------------------------- Scannen

/**
 * Scannen fuehrt an dieselbe Stelle wie eine Kachel: Artikel gewaehlt, nur
 * noch die Menge fehlt. Ein unbekannter Code wird einmal zugeordnet und ist
 * ab dann bekannt.
 */
async function scannenUndWaehlen(baustelle: Baustelle): Promise<void> {
  const { scannen } = await import('../lib/scanner');
  const text = await scannen();
  if (!text) return;

  const etikett = qrLesen(text);
  const code = etikett ? etikett.code : codeNormalisieren(text);
  let artikel = await artikelMitCode(code);
  // Etikett mit Artikelnummer oder Bezeichnung statt eigenem Code.
  if (!artikel && !etikett) artikel = await artikelMitText(text);

  // Etikett eines Kollegen: der Code ist hier neu, Name und Einheit reisen
  // aber mit. Ueber den Namen finden oder anlegen, den Code dranhaengen.
  if (!artikel && etikett) {
    artikel = await db.artikel.where('name').equals(etikett.name).first();
    if (artikel) {
      await db.artikel.update(artikel.id!, { codes: [...(artikel.codes ?? []), code] });
    } else {
      await db.artikel.add({ name: etikett.name, einheit: etikett.einheit, anzahl: 0, codes: [code] });
      artikel = { name: etikett.name, einheit: etikett.einheit, anzahl: 0 };
    }
  }

  if (artikel) {
    sucheOffen = false;
    block = { name: artikel.name, einheit: artikel.einheit };
    neu();
    return;
  }
  await codeZuordnen(code, baustelle);
}

/** Ein unbekannter Code: welcher Artikel ist das? */
async function codeZuordnen(code: string, baustelle: Baustelle): Promise<void> {
  const e = await einstellungenLesen();
  const treffer = h('div', { class: 'treffer' });
  const feld = h('input', { type: 'text', placeholder: 'Artikel suchen oder neu benennen', autocomplete: 'off' });
  const einheit = h('select', {}, ...e.einheiten.map((u) => h('option', { value: u, text: u })));

  const weiter = (name: string, eh: string) => {
    document.querySelector('.schatten')?.remove();
    sucheOffen = false;
    block = { name, einheit: eh };
    neu();
  };
  const zuweisen = async (a: Artikel) => {
    await db.artikel.update(a.id!, { codes: [...(a.codes ?? []), code] });
    weiter(a.name, a.einheit);
  };

  // Ohne Suchbegriff die Kacheln dieses Projekts - meist ist es eines davon.
  const zeichnen = async () => {
    const q = feld.value.trim();
    const liste = q.length >= 2 ? await suchen(q, baustelle.id) : await kacheln(baustelle.id!, 8);
    treffer.replaceChildren(
      ...liste.map((a) =>
        h('button', { type: 'button', onclick: () => void zuweisen(a) },
          h('span', { class: 'nm', text: a.name }),
          h('span', { class: 'eh', text: a.einheit }),
        ),
      ),
    );
  };
  feld.addEventListener('input', () => void zeichnen());
  await zeichnen();

  blatt(
    'Unbekannter Code',
    [
      h('p', { class: 'hinweis', style: 'padding:0',
        text: `${code} kennt das Archiv noch nicht. Welcher Artikel ist das? Ab dem nächsten Scan weiß es die App.` }),
      h('label', { class: 'feld', style: 'margin:0' }, feld),
      treffer,
      h('label', { class: 'feld' }, h('span', { text: 'Einheit, falls neu' }), einheit),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      {
        text: 'Neu anlegen',
        tun: async () => {
          const name = feld.value.trim();
          if (!name) {
            melden('Name fehlt', 'Für einen neuen Artikel oben die Bezeichnung eintippen.');
            return;
          }
          const da = await db.artikel.where('name').equals(name).first();
          if (da) return zuweisen(da);
          await db.artikel.add({ name, einheit: einheit.value, anzahl: 0, codes: [code] });
          weiter(name, einheit.value);
        },
      },
    ],
  );
}

/** Neuen Artikel im Fluss anlegen — ohne den Bildschirm zu verlassen. */
async function neuerArtikel(name: string): Promise<void> {
  const e = await einstellungenLesen();
  const auswahl = h('select', {}, ...e.einheiten.map((u) => h('option', { value: u, text: u })));
  blatt(
    'Neuer Artikel',
    [
      h('p', { class: 'hinweis', style: 'padding:0', text: `„${name}" landet im Archiv und ist in jedem Projekt wieder da.` }),
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
  // Die Artikelnummer wird mit abgeschrieben, wie Name und Einheit.
  const artikel = await db.artikel.where('name').equals(name).first();
  const { positionen, index } = positionHinzufuegen(schein.positionen, name, n, einheit, artikel?.nummer);
  await db.scheine.update(schein.id!, { positionen });
  await vermerken({
    baustelleId: schein.baustelleId,
    art: index < schein.positionen.length ? 'dazu' : 'neu',
    name, einheit, menge: n, stand: positionen[index]!.menge, schein: scheinName(schein),
  });
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
  const alt = positionen[index]!;
  positionen[index] = { ...alt, menge: n };
  await db.scheine.update(schein.id!, { positionen });
  if (alt.menge !== n) {
    await vermerken({
      baustelleId: schein.baustelleId, art: 'geaendert',
      name: alt.name, einheit: alt.einheit, menge: runden(n - alt.menge), stand: n, schein: scheinName(schein),
    });
  }
  block = null;
  zustand.frisch = index;
  neu();
}

async function positionLoeschen(index: number): Promise<void> {
  const schein = await db.scheine.get(gewaehlt!);
  if (!schein) return;
  const weg = schein.positionen[index];
  const positionen = schein.positionen.filter((_, i) => i !== index);
  await db.scheine.update(schein.id!, { positionen });
  if (weg) {
    await vermerken({
      baustelleId: schein.baustelleId, art: 'geloescht',
      name: weg.name, einheit: weg.einheit, menge: -weg.menge, stand: 0, schein: scheinName(schein),
    });
  }
  block = null;
  zustand.frisch = undefined;
  neu();
}

// -------------------------------------------------------------- Abgeben

async function senden(baustelle: Baustelle, kunde: Kunde | undefined, schein: Schein): Promise<void> {
  // **Als Erstes**, noch im Druckpunkt: Der Teilen-Dialog kennt kein
  // Empfaengerfeld — ein mailto koennte eines, traegt dafuer keine Anhaenge.
  // Also legt die App die Adresse in die Zwischenablage, damit sie in der
  // Mail nur noch einzusetzen ist. Nach dem Nachladen von jsPDF weiter unten
  // gewaehrt iOS den Zugriff nicht mehr verlaesslich.
  const buero = zustand.einstellungen?.buero?.trim();
  if (buero) await inZwischenablage(buero);

  const [e, archiv] = await Promise.all([einstellungenLesen(), db.artikel.toArray()]);
  const stand: Schein = { ...schein, beendet: Date.now(), positionen: nummernErgaenzen(schein.positionen, archiv) };
  // jsPDF ist der groesste Brocken und wird erst hier gebraucht. Nachladen
  // statt mitschleppen: der Start auf der Baustelle bleibt leicht, und der
  // Service Worker hat die Datei trotzdem im Vorrat.
  const [{ pdfDatei }, { scheinExcelDatei }] = await Promise.all([
    import('../lib/pdf'), import('../lib/scheinexcel'),
  ]);
  const firma = firmenkopf(e.firma);
  const logo = kopfLogo(e.logo);
  const dateien = [
    scheinExcelDatei(stand, baustelle, firma, kunde, ersteller(), logo),
    pdfDatei(stand, baustelle, firma, kunde, ersteller(), logo),
  ];

  const ergebnis = await teilen(dateien);
  if (ergebnis === 'abgebrochen') return;
  if (ergebnis === 'nicht-moeglich') {
    melden(...NICHT_MOEGLICH);
    return;
  }

  // "Geteilt", nicht "gesendet": ob die Mail wirklich abging, erfaehrt die App
  // nicht. Sie behauptet nur, was sie weiss.
  await db.scheine.update(schein.id!, { zustand: 'geteilt', beendet: stand.beendet });
  await vermerken({
    baustelleId: baustelle.id!, art: 'geteilt', positionen: schein.positionen.length, schein: scheinName(schein),
  });
  scheinZuruecksetzen();
  neu();
  // Am PC gibt es keinen Teilen-Dialog, der die Mail gleich oeffnet - also
  // sagen, wo die Dateien liegen und wie es weitergeht.
  if (AM_PC) {
    melden('Gespeichert', 'Excel und PDF liegen im Download-Ordner – beide an die Mail ans Büro anhängen.'
      + (buero ? ' Die Adresse des Büros ist in der Zwischenablage: in der Mail ins An-Feld klicken, Strg+V.' : ''));
  }
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
  // Der Name aus der Lizenz sagt dem Kollegen mehr als der Firmenname, den
  // im Betrieb alle gleich eingetragen haben — sofern er gewaehlt ist.
  const absender = erstellerText() || e.firma.name || 'MaterialBlitz';
  const datei = await scheinPacken(schein, baustelle, kunde, absender);

  const ergebnis = await teilen([datei]);
  if (ergebnis !== 'geteilt') return;

  await db.scheine.update(schein.id!, { zustand: 'uebergeben', beendet: Date.now() });
  await vermerken({
    baustelleId: baustelle.id!, art: 'uebergeben', positionen: schein.positionen.length, schein: scheinName(schein),
  });
  scheinZuruecksetzen();
  neu();
  if (AM_PC) {
    melden('Gespeichert', 'Die Datei liegt im Download-Ordner. Dem Kollegen per Mail schicken – er liest sie über „Datei einlesen" ein.');
  }
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
          await vermerken({
            baustelleId: baustelle.id!, art: 'nachtrag', positionen: positionen.length,
            schein: alt.bezeichnung ?? `vom ${datum(alt.beendet ?? alt.erstellt)}`,
          });
          gewaehlt = id;
          neu();
        },
      },
    ],
  );
}
