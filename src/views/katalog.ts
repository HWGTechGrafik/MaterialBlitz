import { artikelMitCode, db, einstellungenLesen, einstellungenSchreiben } from '../db';
import { projektTitel, projektUnter, type Artikel, type EtikettArt, type EtikettCode } from '../model';
import { alleBoegen, bogenFinden, raster, rasterText, strichcodeMoeglich } from '../lib/boegen';
import { codeArt, codePruefen, eigenerCode, istEigenerCode, qrInhalt } from '../lib/codes';
import type { Etikett } from '../lib/etiketten';
import { teilen } from '../lib/share';
import { AM_PC, NICHT_MOEGLICH } from '../lib/geraet';
import { neu } from '../store';
import { blatt, h, ikon, kopfKnopf, kopfRechts, melden, umschalter, wischbar, type NeuArt } from '../ui';
import { ordnerAngleichen, ordnerListe } from '../lib/ordner';
import { suchBegriffe, suchNorm } from '../lib/suche';
import { baustelleAnlegen } from './uebersicht';
import { verlaufZeigen } from './verlauf';

let reiter: 'katalog' | 'baustellen' = 'katalog';
/** Der im Archiv geoeffnete Ordner; null zeigt die Ordner und alles ohne Ordner. */
let offenerOrdner: string | null = null;

export async function katalogView(): Promise<HTMLElement[]> {
  const imKatalog = reiter === 'katalog';
  const imOrdner = imKatalog && offenerOrdner !== null;

  // Welches Register offen ist, steht als Überschrift da — die Sinnbilder
  // brauchen daneben keine Beschriftung mehr, nur einen sichtbar aktiven Zustand.
  const kopf = h(
    'div',
    { class: 'kopf' },
    imOrdner
      ? h('button', {
          class: 'zurueck', type: 'button', 'aria-label': 'Zurück zum Archiv',
          html: '&lsaquo;',
          onclick: () => { offenerOrdner = null; neu(); },
        })
      : null,
    h('div', { class: 'kopf-text' },
      h('div', { class: 'eyebrow', text: imOrdner ? 'Ordner' : 'Register' }),
      h('h1', { text: imOrdner ? offenerOrdner! : imKatalog ? 'Archiv' : 'Projekte' }),
    ),
    kopfRechts(
      null,
      kopfKnopf({
        ikon: 'liste', titel: 'Register Archiv', art: imKatalog ? 'aktiv' : undefined,
        tun: () => { reiter = 'katalog'; offenerOrdner = null; neu(); },
      }),
      kopfKnopf({
        ikon: 'haus', titel: 'Register Projekte', art: imKatalog ? undefined : 'aktiv',
        tun: () => { reiter = 'baustellen'; neu(); },
      }),
      imKatalog
        ? kopfKnopf({
            ikon: 'strichcode', titel: 'Etiketten drucken',
            // Im Ordner sind dessen Artikel gleich angekreuzt.
            tun: async () => void etikettenDrucken(imOrdner
              ? (await db.artikel.toArray()).filter((a) => a.ordner === offenerOrdner).map((a) => a.id!)
              : []),
          })
        : null,
      kopfKnopf({ ikon: 'plus', titel: 'Neu anlegen', art: 'haupt', tun: () => neuAnlegen() }),
    ),
  );

  const rumpf = h('div', { class: 'rumpf' });
  if (imKatalog) await katalogListe(rumpf);
  else await baustellenListe(rumpf);

  return [kopf, rumpf];
}

/**
 * Das Plus oeffnet gleich das Formular zum offenen Register; oben schaltet
 * ein Umschalter zwischen Projekt und Artikel um. Das Register wechselt mit,
 * damit das Neue danach gleich in der Liste steht.
 */
function neuAnlegen(art: NeuArt = reiter === 'katalog' ? 'artikel' : 'projekt'): void {
  const register = art === 'artikel' ? 'katalog' : 'baustellen';
  if (reiter !== register) { reiter = register; neu(); }
  // Im offenen Ordner landet der neue Artikel gleich darin.
  if (art === 'artikel') void artikelBearbeiten(undefined, umschalter(art, neuAnlegen), offenerOrdner ?? undefined);
  else baustelleAnlegen(false, umschalter(art, neuAnlegen));
}

// ---------------------------------------------------------------- Katalog

function artikelReihe(a: Artikel): HTMLElement {
  return h('button', { class: 'reihe', type: 'button', onclick: () => artikelBearbeiten(a.id) },
    h('div', {},
      h('div', { class: 'haupt', text: a.name }),
      h('div', { class: 'neben',
        text: `${a.nummer ? `Nr. ${a.nummer} · ` : ''}${a.einheit} · ${a.anzahl}× verwendet`
          + (a.codes?.length ? ` · ${a.codes.length === 1 ? '1 Code' : `${a.codes.length} Codes`}` : '') }),
    ),
    h('span', { class: 'pfeil', html: '&rsaquo;' }),
  );
}

/**
 * Oben die Ordner, darunter was in keinem liegt. Ein Ordner zeigt beim
 * Antippen nur seine Artikel. Ohne Ordner sieht das Archiv aus wie bisher —
 * bis auf die Zeile „Neuer Ordner".
 */
async function katalogListe(rumpf: HTMLElement): Promise<void> {
  const artikel = (await db.artikel.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'de'));

  if (!artikel.length) {
    offenerOrdner = null;
    rumpf.append(h('div', { class: 'leer', text: 'Das Archiv wächst von selbst: was du in einem Projekt aufschreibst, steht danach hier. Viele Artikel auf einmal kommen über eine Excel-Liste herein – Einstellungen › Archiv › Archiv als Excel.' }));
    return;
  }

  if (offenerOrdner !== null) {
    const drin = artikel.filter((a) => a.ordner === offenerOrdner);
    if (drin.length) {
      for (const a of drin) rumpf.append(artikelReihe(a));
      const name = offenerOrdner;
      rumpf.append(
        h('button', { class: 'reihe neuer-ordner', type: 'button', onclick: () => void ordnerBearbeiten(name) },
          h('span', { class: 'ordner-kopf' }, ikon('ordner'), 'Ordner bearbeiten…')),
        h('div', { class: 'hinweis', text: `${drin.length} Artikel in„${name}“. Das Plus legt einen neuen Artikel gleich in diesem Ordner an.` }),
      );
      return;
    }
    // Der Ordner ist leer geworden (letzter Artikel verschoben oder geloescht).
    offenerOrdner = null;
    // Die Ueberschrift steht schon - neu aufbauen, damit sie wieder "Archiv" heisst.
    queueMicrotask(neu);
    return;
  }

  const ordner = ordnerListe(artikel);
  for (const o of ordner) {
    const n = artikel.filter((a) => a.ordner === o).length;
    rumpf.append(
      h('button', { class: 'reihe', type: 'button', onclick: () => { offenerOrdner = o; neu(); } },
        h('div', { class: 'ordner-kopf' },
          ikon('ordner'),
          h('div', {},
            h('div', { class: 'haupt', text: o }),
            h('div', { class: 'neben', text: `${n} Artikel` }),
          ),
        ),
        h('span', { class: 'pfeil', html: '&rsaquo;' }),
      ),
    );
  }
  rumpf.append(
    h('button', { class: 'reihe neuer-ordner', type: 'button', onclick: () => void ordnerBearbeiten() },
      h('span', { class: 'ordner-kopf' }, ikon('ordner'), 'Neuer Ordner…')),
  );

  const ohne = artikel.filter((a) => !a.ordner);
  if (ordner.length && ohne.length) {
    rumpf.append(h('div', { class: 'abschnitt' }, 'Ohne Ordner', h('span', { class: 'neben', text: `${ohne.length} Artikel` })));
  }
  for (const a of ohne) rumpf.append(artikelReihe(a));

  rumpf.append(
    h('div', { class: 'hinweis',
      text: 'Umbenennen und Löschen sind hier gefahrlos: Positionen auf bestehenden Scheinen sind Abschriften und ändern sich nicht mit.' }),
  );
}

/**
 * Ordner anlegen oder bearbeiten: Name und welche Artikel darin liegen.
 * Ein Ordner besteht, solange ein Artikel darin liegt — angelegt wird er
 * deshalb gleich mit seinen Artikeln.
 */
async function ordnerBearbeiten(alt?: string): Promise<void> {
  const artikel = (await db.artikel.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const vorhandene = ordnerListe(artikel);
  const name = h('input', { type: 'text', value: alt ?? '', placeholder: 'z.B. Kabel, Schaltermaterial, Loxone' });
  const filter = h('input', { type: 'search', placeholder: 'Artikel suchen…', autocomplete: 'off' });

  // Die eigenen zuerst, dann was noch in keinem Ordner liegt, dann der Rest.
  const rang = (a: Artikel) => (alt !== undefined && a.ordner === alt ? 0 : !a.ordner ? 1 : 2);
  const zeilen = artikel
    .slice()
    .sort((a, b) => rang(a) - rang(b))
    .map((a) => {
      const an = h('input', { type: 'checkbox', checked: alt !== undefined && a.ordner === alt });
      const el = h('label', { class: 'etikett-zeile' }, an,
        h('span', { class: 'nm', text: a.name }),
        a.ordner && a.ordner !== alt ? h('span', { class: 'wo', text: a.ordner }) : null,
      );
      // Wie die Suche sonst: Umlaute und Grossschreibung egal, auch die Artikelnummer.
      return { a, an, el, text: suchNorm(`${a.name} ${a.nummer ?? ''}`) };
    });
  const liste = h('div', { class: 'etiketten-liste' }, ...zeilen.map((z) => z.el));
  filter.addEventListener('input', () => {
    // Die Liste behaelt ihre Hoehe: Wuerde sie beim Filtern schrumpfen,
    // sackte das Blatt nach unten und das Suchfeld unter die Tastatur.
    if (!liste.style.minHeight) liste.style.minHeight = `${liste.offsetHeight}px`;
    const begriffe = suchBegriffe(filter.value);
    for (const z of zeilen) z.el.hidden = !begriffe.every((b) => z.text.includes(b));
  });

  const knoepfe: Array<{ text: string; art?: 'haupt' | 'zweit' | 'gefahr'; tun?: () => void }> = [
    { text: 'Abbrechen', art: 'zweit' },
  ];
  if (alt !== undefined) {
    knoepfe.push({ text: 'Auflösen', art: 'gefahr', tun: () => ordnerAufloesen(alt) });
  }
  knoepfe.push({
    text: 'Speichern',
    tun: async () => {
      const neuName = ordnerAngleichen(name.value, vorhandene.filter((o) => o !== alt));
      if (!neuName) {
        melden('Name fehlt', 'Bitte dem Ordner einen Namen geben, etwa „Kabel“.');
        return;
      }
      const gewaehlt = new Set(zeilen.filter((z) => z.an.checked).map((z) => z.a.id!));
      if (!gewaehlt.size) {
        melden('Kein Artikel gewählt', 'Ein Ordner besteht, solange ein Artikel darin liegt – bitte mindestens einen ankreuzen.');
        return;
      }
      await db.transaction('rw', db.artikel, async () => {
        for (const a of artikel) {
          if (gewaehlt.has(a.id!)) {
            if (a.ordner !== neuName) await db.artikel.update(a.id!, { ordner: neuName });
          } else if (alt !== undefined && a.ordner === alt) {
            await db.artikel.update(a.id!, { ordner: undefined });
          }
        }
      });
      offenerOrdner = neuName;
      neu();
    },
  });

  blatt(
    alt === undefined ? 'Neuer Ordner' : 'Ordner bearbeiten',
    [
      h('label', { class: 'feld' }, h('span', { text: 'Name' }), name),
      h('div', { class: 'feld ordner-suche' },
        h('span', { text: 'Artikel in diesem Ordner' }),
        h('label', { class: 'feld', style: 'margin-bottom:6px' }, filter),
      ),
      liste,
      h('p', { class: 'hinweis', style: 'padding:0',
        text: 'Ein Artikel liegt in höchstens einem Ordner – steht rechts schon einer, wird er verschoben.' }),
    ],
    knoepfe,
  );
  if (alt === undefined) setTimeout(() => name.focus(), 50);
}

function ordnerAufloesen(name: string): void {
  blatt(
    'Ordner auflösen?',
    [h('p', { class: 'hinweis', style: 'padding:0',
      text: `Der Ordner „${name}“ verschwindet. Seine Artikel bleiben im Archiv, nur ohne Ordner.` })],
    [
      { text: 'Abbrechen', art: 'zweit', tun: () => void ordnerBearbeiten(name) },
      {
        text: 'Auflösen', art: 'gefahr',
        tun: async () => {
          await db.artikel.where('id').anyOf(
            (await db.artikel.toArray()).filter((a) => a.ordner === name).map((a) => a.id!),
          ).modify((a) => { delete a.ordner; });
          offenerOrdner = null;
          neu();
        },
      },
    ],
  );
}

export async function artikelBearbeiten(id?: number, oben?: HTMLElement, ordnerVorgabe?: string): Promise<void> {
  const vorhanden = id ? await db.artikel.get(id) : undefined;
  const [e, alle] = await Promise.all([einstellungenLesen(), db.artikel.toArray()]);
  const name = h('input', { type: 'text', value: vorhanden?.name ?? '', placeholder: 'z.B. NYM-J 3x1,5' });
  const einheit = h('select', {},
    ...e.einheiten.map((u) => h('option', { value: u, text: u, selected: u === vorhanden?.einheit })),
  );
  const nummer = h('input', {
    type: 'text', value: vorhanden?.nummer ?? '', placeholder: 'freiwillig, steht auf PDF und Excel',
    autocomplete: 'off', autocapitalize: 'characters',
  });
  nummer.spellcheck = false;

  // Etikett: leer gelassen gilt die Vorgabe (QR, Inhalt wie eingestellt, 1 Stueck).
  const etikettArt = h('select', { 'aria-label': 'Codeart' },
    h('option', { value: 'qr', text: 'QR' }),
    h('option', { value: 'strich', text: 'Strichcode', selected: vorhanden?.etikettArt === 'strich' }),
  );
  const etikettInhalt = h('select', { 'aria-label': 'Inhalt des Codes' },
    h('option', { value: '', text: 'Inhalt wie eingestellt' }),
    ...(Object.entries(INHALT_WAHL) as Array<[EtikettCode, string]>).map(([wert, text]) =>
      h('option', { value: wert, text, selected: vorhanden?.etikettInhalt === wert })),
  );
  const etikettStueck = h('input', {
    type: 'number', class: 'stueck', min: '1', max: '999', inputMode: 'numeric',
    value: String(vorhanden?.etikettStueck ?? 1), 'aria-label': 'Stück je Druck',
  });

  // Auswahl statt Freitext: mit Handschuhen vertippt man sich leicht, und
  // aus "Kabel" und "Kabl" wuerden zwei Ordner.
  const vorhandeneOrdner = ordnerListe(alle);
  const ordnerJetzt = vorhanden ? vorhanden.ordner : ordnerVorgabe;
  const NEU = '\u0000neu';
  const ordnerWahl = h('select', {},
    h('option', { value: '', text: '– ohne Ordner –' }),
    ...vorhandeneOrdner.map((o) => h('option', { value: o, text: o, selected: o === ordnerJetzt })),
    h('option', { value: NEU, text: 'Neuer Ordner…' }),
  );
  const ordnerNeu = h('input', { type: 'text', placeholder: 'Name des neuen Ordners', hidden: true, style: 'margin-top:6px' });
  ordnerWahl.addEventListener('change', () => {
    ordnerNeu.hidden = ordnerWahl.value !== NEU;
    if (!ordnerNeu.hidden) ordnerNeu.focus();
  });
  const ordnerGewaehlt = (): string | undefined =>
    ordnerWahl.value === NEU ? ordnerAngleichen(ordnerNeu.value, vorhandeneOrdner) : ordnerWahl.value || undefined;

  // Codes werden erst mit "Speichern" geschrieben: "Abbrechen" soll wirklich
  // nichts veraendert haben.
  const codes = [...(vorhanden?.codes ?? [])];
  const liste = h('div', { class: 'codes' });
  const hinweis = h('div', { class: 'code-hinweis' });
  const codeFeld = h('input', {
    type: 'text', placeholder: 'Ziffern unter dem Strichcode', autocomplete: 'off',
    autocapitalize: 'characters', enterKeyHint: 'done',
  });
  codeFeld.spellcheck = false;
  const eigenerKnopf = h('button', {
    class: 'knopf leise', type: 'button', text: 'Eigenen Code vergeben',
    onclick: () => { codes.push(eigenerCode()); melde(''); zeichneCodes(); },
  });

  const melde = (text: string, falsch = false) => {
    hinweis.textContent = text;
    hinweis.classList.toggle('falsch', falsch);
  };
  const zeichneCodes = () => {
    liste.replaceChildren(
      ...codes.map((c) =>
        h('div', { class: 'code-zeile' },
          h('span', { class: 'code-wert', text: c }),
          h('span', { class: 'code-art', text: codeArt(c) }),
          h('button', {
            class: 'knopf leise', type: 'button', text: 'Lösen',
            onclick: () => { codes.splice(codes.indexOf(c), 1); melde(''); zeichneCodes(); },
          }),
        ),
      ),
    );
    // Ein eigener Code je Artikel genuegt - Etiketten tragen immer denselben.
    eigenerKnopf.hidden = codes.some(istEigenerCode);
  };

  /** Den getippten Code uebernehmen. Liefert false, wenn er nicht taugt. */
  const uebernehmen = async (): Promise<boolean> => {
    const p = codePruefen(codeFeld.value);
    if ('fehler' in p) { melde(p.fehler, true); return false; }
    codeFeld.value = '';
    if (codes.includes(p.code)) { melde('Dieser Code steht schon da.'); return true; }
    codes.push(p.code);
    zeichneCodes();
    const traeger = await artikelMitCode(p.code);
    melde(traeger && traeger.id !== vorhanden?.id
      ? `Gehörte bisher zu „${traeger.name}" – beim Speichern wird er dort gelöst.`
      : '');
    return true;
  };
  codeFeld.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); void uebernehmen(); }
  });
  zeichneCodes();

  /** Schreibt den Artikel und liefert seine Nummer — oder null, wenn nicht. */
  const speichern = async (): Promise<number | null> => {
    const n = name.value.trim();
    if (!n) return null;
    // Getippt, aber "Hinzufügen" vergessen: trotzdem mitnehmen.
    if (codeFeld.value.trim() && !(await uebernehmen())) {
      melden('Code nicht gespeichert', hinweis.textContent ?? '');
      return null;
    }
    const doppelt = await db.artikel.where('name').equals(n).first();
    if (doppelt && doppelt.id !== vorhanden?.id) {
      melden('Gibt es schon', `„${n}" steht bereits im Archiv.`);
      return null;
    }
    return db.transaction('rw', db.artikel, async () => {
      // Ein Code gehoert hoechstens einem Artikel: beim bisherigen loesen.
      for (const c of codes) {
        for (const a of await db.artikel.where('codes').equals(c).toArray()) {
          if (a.id !== vorhanden?.id) await db.artikel.update(a.id!, { codes: a.codes!.filter((x) => x !== c) });
        }
      }
      const ordner = ordnerGewaehlt();
      const nr = nummer.value.trim() || undefined;
      const stueck = stueckVon(etikettStueck.value);
      const etikett = {
        etikettArt: etikettArt.value === 'strich' ? 'strich' as const : undefined,
        etikettInhalt: (etikettInhalt.value || undefined) as EtikettCode | undefined,
        etikettStueck: stueck > 1 ? stueck : undefined,
      };
      if (vorhanden) {
        await db.artikel.update(vorhanden.id!, { name: n, einheit: einheit.value, codes, ordner, nummer: nr, ...etikett });
        return vorhanden.id!;
      }
      // Leere Felder gar nicht erst anlegen: so sieht der Artikel aus wie bisher.
      const neuer: Artikel = { name: n, einheit: einheit.value, anzahl: 0, codes, ordner, nummer: nr, ...etikett };
      for (const f of Object.keys(neuer) as Array<keyof Artikel>) if (neuer[f] === undefined) delete neuer[f];
      return (await db.artikel.add(neuer)) ?? null;
    });
  };

  blatt(
    vorhanden ? 'Artikel bearbeiten' : 'Neuer Artikel',
    [
      oben ?? null,
      h('label', { class: 'feld' }, h('span', { text: 'Bezeichnung' }), name),
      h('label', { class: 'feld' }, h('span', { text: 'Einheit' }), einheit),
      h('label', { class: 'feld' }, h('span', { text: 'Artikelnummer' }), nummer),
      h('div', { class: 'feld' },
        h('span', { text: 'Ordner' }),
        ordnerWahl,
        ordnerNeu,
      ),
      h('div', { class: 'feld' },
        h('span', { text: 'Strich- und QR-Codes' }),
        liste,
        h('div', { class: 'code-eingabe' },
          codeFeld,
          h('button', { class: 'knopf zweit', type: 'button', text: 'Hinzufügen', onclick: () => void uebernehmen() }),
        ),
        hinweis,
        h('div', { class: 'etikett-wahl' }, etikettArt, etikettInhalt, etikettStueck),
        h('small', { class: 'feld-hinweis', text: 'Etikett: Codeart, was der Code trägt, und wie viele der Druck vorschlägt.' }),
        h('div', { class: 'code-taten' },
          eigenerKnopf,
          h('button', {
            class: 'knopf leise', type: 'button', text: 'Etikett drucken…',
            onclick: async () => {
              const nr = await speichern();
              if (nr === null) return;
              document.querySelector('.schatten')?.remove();
              neu();
              await etikettenDrucken([nr]);
            },
          }),
        ),
      ),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      ...(vorhanden
        ? [{
            text: 'Löschen', art: 'gefahr' as const,
            tun: async () => { await db.artikel.delete(vorhanden.id!); neu(); },
          }]
        : []),
      {
        text: 'Speichern',
        tun: async () => { if ((await speichern()) !== null) neu(); },
      },
    ],
  );
  if (!vorhanden) setTimeout(() => name.focus(), 50);
}

// -------------------------------------------------------------- Etiketten

/** Mehr Etiketten auf einmal sind fast sicher vertippt — 2000 sind 84 volle Boegen 3474. */
const ETIKETTEN_MAX = 2000;

/** Stueckzahl aus dem Feld: leer oder Unsinn heisst 1, mehr als 999 druckt niemand. */
function stueckVon(wert: string): number {
  const n = Math.round(Number(wert.replace(',', '.')));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 999) : 1;
}

/** Fuer Auswahllisten — dieselben Worte wie in Einstellungen und Excel-Liste. */
const INHALT_WAHL: Record<EtikettCode, string> = {
  eigen: 'Eigener Code (MB-…)',
  nummer: 'Artikelnummer',
  name: 'Bezeichnung',
};

const INHALT_TEXT: Record<EtikettCode, string> = {
  eigen: 'den eigenen Code der App',
  nummer: 'die Artikelnummer',
  name: 'die Bezeichnung',
};

/**
 * Etiketten fuer Material ohne Strichcode. Was der Code traegt und ob QR
 * oder Strichcode, steht beim Artikel oder in den Einstellungen; die
 * Codeart laesst sich hier noch je Zeile umstellen, ebenso die Stueckzahl.
 */
async function etikettenDrucken(vorauswahl: number[] = []): Promise<void> {
  const artikel = (await db.artikel.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  if (!artikel.length) {
    melden('Archiv leer', 'Etiketten gibt es für Artikel im Archiv – das ist noch leer.');
    return;
  }
  // Schon beim Oeffnen nachladen, nicht erst beim Erzeugen: am iPhone darf
  // zwischen Fingertipp und Teilen-Dialog nicht viel Zeit vergehen, sonst
  // verweigert Safari den Dialog.
  const [{ etikettenPdf, probeblattPdf }, e] = await Promise.all([import('../lib/etiketten'), einstellungenLesen()]);
  const wahl = e.etikettCode ?? 'eigen';
  const boegen = alleBoegen(e.etikettBoegen);

  const ordner = ordnerListe(artikel);
  const zeilen = artikel.map((a) => {
    const an = h('input', { type: 'checkbox', checked: vorauswahl.includes(a.id!) });
    const stueck = h('input', {
      type: 'number', class: 'stueck', min: '1', max: '999', inputMode: 'numeric',
      value: String(a.etikettStueck ?? 1), 'aria-label': `Stück für ${a.name}`,
    });
    // Wer eine Stueckzahl tippt, will das Etikett auch.
    stueck.addEventListener('input', () => { an.checked = true; });
    const art = h('select', { 'aria-label': `Codeart für ${a.name}` },
      h('option', { value: 'qr', text: 'QR', selected: (a.etikettArt ?? 'qr') === 'qr' }),
      h('option', { value: 'strich', text: 'Strichcode', selected: a.etikettArt === 'strich' }),
    );
    return { a, an, stueck, art, el: h('label', { class: 'etikett-zeile' }, an, h('span', { class: 'nm', text: a.name }), stueck, art) };
  });
  // Bei hundert Artikeln aus einer Excel-Liste kreuzt niemand einzeln an.
  const ankreuzen = (wer: (a: Artikel) => boolean) => { for (const z of zeilen) z.an.checked = wer(z.a); };
  const schnell = h('div', { class: 'etikett-schnell' },
    h('button', { class: 'knopf leise', type: 'button', text: 'Alle', onclick: () => ankreuzen(() => true) }),
    // Wer eine EAN hat, braucht kein Etikett: der Strichcode klebt schon am Material.
    h('button', { class: 'knopf leise', type: 'button', text: 'Ohne Strichcode', onclick: () => ankreuzen((a) => !(a.codes ?? []).some((c) => !istEigenerCode(c))) }),
    h('button', { class: 'knopf leise', type: 'button', text: 'Keine', onclick: () => ankreuzen(() => false) }),
    // Ganze Ordner auf einmal - etwa alle Loxone-Teile fuer die Werkstatt.
    ordner.length
      ? h('select', {
          'aria-label': 'Ordner ankreuzen',
          onchange: (ev: Event) => {
            const wert = (ev.target as HTMLSelectElement).value;
            if (wert) ankreuzen((a) => a.ordner === wert);
            (ev.target as HTMLSelectElement).value = '';
          },
        },
          h('option', { value: '', text: 'Ordner …' }),
          ...ordner.map((o) => h('option', { value: o, text: o })),
        )
      : null,
    h('select', {
      'aria-label': 'Codeart für alle',
      onchange: (ev: Event) => {
        const wert = (ev.target as HTMLSelectElement).value;
        if (wert) for (const z of zeilen) z.art.value = wert;
        (ev.target as HTMLSelectElement).value = '';
      },
    },
      h('option', { value: '', text: 'Alle als …' }),
      h('option', { value: 'qr', text: 'QR' }),
      h('option', { value: 'strich', text: 'Strichcode' }),
    ),
  );

  const bogen = h('select', {},
    ...boegen.map((b) => h('option', { value: b.id, text: b.titel, selected: b.id === bogenFinden(e.etikettBogen, e.etikettBoegen).id })),
  );
  const gewaehlterBogen = () => bogenFinden(bogen.value, e.etikettBoegen);
  const rasterZeile = h('small', { class: 'feld-hinweis' });
  const erstes = h('input', { type: 'number', value: '1', min: '1', inputMode: 'numeric' });
  const bogenGeaendert = () => {
    rasterZeile.textContent = rasterText(gewaehlterBogen());
    erstes.max = String(raster(gewaehlterBogen()).jeBlatt);
  };
  bogen.addEventListener('change', bogenGeaendert);
  bogenGeaendert();

  blatt(
    'Etiketten drucken',
    [
      h('p', { class: 'hinweis', style: 'padding:0',
        text: `Der Code trägt ${INHALT_TEXT[wahl]}${wahl === 'nummer' ? ' – wer keine hat, den eigenen Code' : ''}, außer beim Artikel ist anderes eingestellt. Die Zahl je Zeile ist die Stückzahl.` }),
      schnell,
      h('div', { class: 'etiketten-liste' }, ...zeilen.map((z) => z.el)),
      h('div', { class: 'feld' },
        h('span', { text: 'Papier' }),
        bogen,
        rasterZeile,
        h('button', {
          class: 'knopf leise', type: 'button', text: 'Probeblatt (nur Umrisse)', style: 'margin-top:6px;width:auto',
          onclick: async () => {
            const ergebnis = await teilen([probeblattPdf(gewaehlterBogen())]);
            if (ergebnis === 'nicht-moeglich') melden(...NICHT_MOEGLICH);
          },
        }),
      ),
      h('label', { class: 'feld' }, h('span', { text: 'Beginnen bei Etikett Nr. (angebrochener Bogen)' }), erstes),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      {
        text: 'PDF erzeugen',
        tun: async () => {
          const gewaehlt = zeilen.filter((z) => z.an.checked);
          if (!gewaehlt.length) {
            melden('Nichts gewählt', 'Bitte mindestens einen Artikel ankreuzen.');
            return;
          }
          const b = gewaehlterBogen();
          // Eine vertippte Null zu viel in mehreren Zeilen ergaebe ein PDF,
          // an dem das Handy minutenlang rechnet.
          const summe = gewaehlt.reduce((s, z) => s + stueckVon(z.stueck.value), 0);
          if (summe > ETIKETTEN_MAX) {
            melden('Zu viele Etiketten', `${summe} Etiketten auf einmal – höchstens ${ETIKETTEN_MAX}. Bitte die Stückzahlen prüfen oder in mehreren Durchgängen drucken.`);
            return;
          }
          const etiketten: Etikett[] = [];
          // Was nicht ging wie gewaehlt — hinterher sagen, statt still anders zu drucken.
          let ohneNummer = 0;
          let alsQr = 0;
          for (const z of gewaehlt) {
            let art = z.art.value as EtikettArt;
            let quelle = z.a.etikettInhalt ?? wahl;
            if (quelle === 'nummer' && !z.a.nummer) { quelle = 'eigen'; ohneNummer++; }
            let inhalt: string;
            let klartext: string;
            if (quelle === 'eigen') {
              let code = z.a.codes?.find(istEigenerCode);
              if (!code) {
                code = eigenerCode();
                await db.artikel.update(z.a.id!, { codes: [...(z.a.codes ?? []), code] });
              }
              if (art === 'strich' && !strichcodeMoeglich(code, b)) { art = 'qr'; alsQr++; }
              inhalt = art === 'qr' ? qrInhalt(code, z.a.name, z.a.einheit) : code;
              klartext = code;
            } else {
              // Nummer oder Bezeichnung schlicht als Text: so liest auch ein
              // Scanner ausserhalb der App etwas Brauchbares heraus.
              inhalt = quelle === 'nummer' ? z.a.nummer! : z.a.name;
              if (art === 'strich' && !strichcodeMoeglich(inhalt, b)) { art = 'qr'; alsQr++; }
              klartext = quelle === 'nummer' ? `Art.-Nr. ${inhalt}` : '';
            }
            const etikett = { name: z.a.name, einheit: z.a.einheit, inhalt, klartext, art };
            for (let i = stueckVon(z.stueck.value); i > 0; i--) etiketten.push(etikett);
          }
          const ergebnis = await teilen([etikettenPdf(etiketten, b, Number(erstes.value) || 1)]);
          if (ergebnis === 'nicht-moeglich') {
            melden(...NICHT_MOEGLICH);
          }
          // Erst nach dem Teilen: am iPhone darf vor dem Teilen-Dialog nichts
          // Vermeidbares mehr warten.
          if (b.id !== e.etikettBogen) await einstellungenSchreiben({ etikettBogen: b.id });
          neu();
          const anders = [
            ohneNummer ? `${ohneNummer === 1 ? '1 Artikel hat' : `${ohneNummer} Artikel haben`} keine Artikelnummer und ${ohneNummer === 1 ? 'trägt' : 'tragen'} den eigenen Code.` : '',
            alsQr ? `${alsQr === 1 ? '1 Artikel bekommt' : `${alsQr} Artikel bekommen`} QR statt Strichcode: für einen Strichcode ist das Etikett zu klein, der Text zu lang oder er hat Umlaute.` : '',
          ].filter(Boolean).join(' ');
          // Skaliert der Drucker die Seite, sitzen die Etiketten neben den
          // Feldern des Bogens.
          if (ergebnis === 'geteilt' && AM_PC) {
            melden('Gespeichert', `${etiketten.length} Etiketten. Das PDF liegt im Download-Ordner. Beim Drucken „Tatsächliche Größe" (100 %) wählen, nicht „An Seite anpassen" – sonst sitzen die Etiketten neben den Feldern.${anders ? ` ${anders}` : ''}`);
          } else if (ergebnis === 'geteilt' && anders) {
            melden('Etiketten erzeugt', anders);
          }
        },
      },
    ],
  );
}

// ------------------------------------------------------------- Baustellen

async function baustellenListe(rumpf: HTMLElement): Promise<void> {
  const [alle, kunden] = await Promise.all([db.baustellen.toArray(), db.kunden.toArray()]);
  const kundeVon = new Map(kunden.map((k) => [k.id!, k] as const));
  const sortiert = alle.filter((b) => !b.versteckt).sort((a, b) => b.zuletzt - a.zuletzt);

  if (!sortiert.length) {
    rumpf.append(h('div', { class: 'leer', text: 'Noch kein Projekt angelegt.' }));
    return;
  }

  for (const b of sortiert) {
    const kunde = b.kundeId ? kundeVon.get(b.kundeId)?.name : undefined;
    rumpf.append(wischbar(
      h('button', { class: 'reihe', type: 'button', onclick: () => baustelleBearbeiten(b.id!) },
        h('div', {},
          h('div', { class: 'haupt', text: projektTitel(b, kunde) }),
          h('div', { class: 'neben',
            text: projektUnter(b, kunde)
              + (b.abgeschlossen ? ' · abgeschlossen' : '') }),
        ),
        h('span', { class: 'pfeil', html: '&rsaquo;' }),
      ),
      { text: 'Löschen', tun: () => void projektLoeschen(b.id!) },
    ));
  }
}

async function baustelleBearbeiten(id: number): Promise<void> {
  const b = await db.baustellen.get(id);
  if (!b) return;
  const kunde = b.kundeId ? await db.kunden.get(b.kundeId) : undefined;

  const ort = h('input', { type: 'text', value: b.ort });
  const kundeFeld = h('input', { type: 'text', value: kunde?.name ?? '', placeholder: 'leer = ohne Kunden' });
  ort.placeholder = 'leer = ohne Ort';

  const knoepfe: Array<{ text: string; art?: 'haupt' | 'zweit' | 'gefahr'; tun?: () => void }> = [
    { text: 'Abbrechen', art: 'zweit' },
    {
      text: b.abgeschlossen ? 'Wieder öffnen' : 'Abschließen',
      art: 'zweit',
      tun: async () => { await db.baustellen.update(id, { abgeschlossen: !b.abgeschlossen }); neu(); },
    },
    {
      text: 'Speichern',
      tun: async () => {
        const o = ort.value.trim();
        const kn = kundeFeld.value.trim();
        // Eines von beiden muss bleiben — sonst haette das Projekt keinen Namen.
        if (!o && !kn) {
          melden('Nicht gespeichert', 'Ort oder Kunde eintragen – eines genügt.');
          return;
        }
        let kundeId: number | undefined;
        if (kn) {
          const da = await db.kunden.where('name').equals(kn).first();
          kundeId = da?.id ?? (await db.kunden.add({ name: kn }));
        }
        await db.baustellen.update(id, { ort: o, kundeId });
        neu();
      },
    },
  ];

  blatt(
    'Projekt',
    [
      h('label', { class: 'feld' }, h('span', { text: 'Ort' }), ort),
      h('label', { class: 'feld' }, h('span', { text: 'Kunde' }), kundeFeld),
      // Auch fuer abgeschlossene Projekte, die im Dashboard nicht mehr stehen.
      h('button', {
        class: 'knopf zweit', type: 'button', text: 'Verlauf ansehen…',
        onclick: () => {
          document.querySelector('.schatten')?.remove();
          void verlaufZeigen(b);
        },
      }),
      h('button', {
        class: 'knopf gefahr', type: 'button', text: 'Projekt löschen…',
        onclick: () => {
          document.querySelector('.schatten')?.remove();
          void projektLoeschen(id, () => void baustelleBearbeiten(id));
        },
      }),
    ],
    knoepfe,
  );
}

/**
 * Rueckfrage vor dem Loeschen eines Projekts - aus dem Projekt-Blatt und vom
 * Wischen in den Listen. Ein Handschuh trifft den roten Knopf leicht aus
 * Versehen: eine zufaellige Zahl zum Abtippen zwingt zum Hinsehen und geht mit
 * dem Ziffernblock auch mit Handschuhen. Die Scheine gehen mit - die Rueckfrage
 * nennt deshalb, wie viele Positionen verloren gehen. `zurueck` fuehrt beim
 * Abbrechen dorthin, woher man kam.
 */
export async function projektLoeschen(id: number, zurueck?: () => void): Promise<void> {
  const b = await db.baustellen.get(id);
  if (!b) return;
  const kunde = b.kundeId ? await db.kunden.get(b.kundeId) : undefined;
  const scheine = await db.scheine.where('baustelleId').equals(id).toArray();
  const positionen = scheine.reduce((n, s) => n + s.positionen.length, 0);

  const zahl = String(100 + Math.floor(Math.random() * 900));
  const eingabe = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', placeholder: zahl });
  blatt(
    'Projekt löschen?',
    [
      h('p', { class: 'hinweis', style: 'padding:0',
        text: `„${projektTitel(b, kunde?.name)}“${kunde && b.ort ? ` (${kunde.name})` : ''} wird gelöscht. Das lässt sich nicht rückgängig machen.` }),
      // Leere Scheine entstehen beim blossen Oeffnen - die sind keine Warnung wert.
      positionen
        ? h('div', { class: 'merk warnung' },
            h('span', { text: '⚠️' }),
            h('span', { text: `Mit ${scheine.length === 1 ? 'dem Schein' : `${scheine.length} Scheinen`} gehen ${positionen === 1 ? '1 Position' : `${positionen} Positionen`} verloren.` }),
          )
        : null,
      h('p', { class: 'hinweis', style: 'padding:0', text: `Zum Löschen diese Zahl eintippen: ${zahl}` }),
      h('label', { class: 'feld' }, eingabe),
    ],
    [
      { text: 'Abbrechen', art: 'zweit', tun: zurueck },
      {
        text: 'Löschen', art: 'gefahr',
        tun: async () => {
          if (eingabe.value.trim() !== zahl) {
            melden('Nicht gelöscht', 'Die Zahl stimmte nicht. Das Projekt ist unverändert.');
            return;
          }
          await db.transaction('rw', db.baustellen, db.scheine, db.verlauf, async () => {
            await db.scheine.where('baustelleId').equals(id).delete();
            await db.verlauf.where('baustelleId').equals(id).delete();
            await db.baustellen.delete(id);
          });
          neu();
        },
      },
    ],
  );
  setTimeout(() => eingabe.focus(), 50);
}
