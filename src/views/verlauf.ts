import { db } from '../db';
import { projektTitel, type Baustelle, type VerlaufArt, type VerlaufEintrag } from '../model';
import { blatt, h, melden } from '../ui';
import { datum, datumSortierbar, dateinameTeil, menge as mengeText, zeit } from '../lib/format';
import { AM_PC, NICHT_MOEGLICH } from '../lib/geraet';
import { teilen } from '../lib/share';
import { suchNorm } from '../lib/suche';
import { verlaufDerBaustelle } from '../lib/verlauf';

const VORGANG: Record<VerlaufArt, string> = {
  neu: 'aufgeschrieben',
  dazu: 'dazugezählt',
  geaendert: 'geändert',
  geloescht: 'gelöscht',
  geteilt: 'Schein ans Büro geteilt',
  uebergeben: 'Schein übergeben',
  uebernommen: 'Schein übernommen',
  nachtrag: 'Nachtrag angelegt',
};

/** Mehr Zeilen baut das Blatt nicht auf — der Rest steht in der Excel-Ausgabe. */
const MAX_ZEILEN = 300;

/** "+25", "−10" — mit echtem Minuszeichen, das liest sich auf dem Handy besser. */
function veraenderung(n: number): string {
  return (n > 0 ? '+' : n < 0 ? '−' : '') + mengeText(Math.abs(n));
}

function zeileBauen(e: VerlaufEintrag): HTMLElement {
  const artikel = e.name !== undefined;
  const neben = [
    artikel ? VORGANG[e.art] : null,
    artikel && e.art !== 'geloescht' && e.stand !== undefined ? `jetzt ${mengeText(e.stand)} ${e.einheit ?? ''}`.trim() : null,
    e.positionen !== undefined ? `${e.positionen} ${e.positionen === 1 ? 'Position' : 'Positionen'}` : null,
    e.schein ? `Schein ${e.schein}` : null,
    e.geraet ?? null,
  ].filter(Boolean).join(' · ');
  return h('div', { class: 'verlauf-zeile' + (e.art === 'geloescht' ? ' weg' : '') },
    h('span', { class: 'vz-zeit', text: zeit(e.zeit) }),
    h('div', { class: 'vz-was' },
      h('div', { class: 'vz-name' + (artikel ? '' : ' ereignis'), text: e.name ?? VORGANG[e.art] }),
      h('div', { class: 'vz-neben', text: neben }),
    ),
    h('span', { class: 'vz-menge', text: artikel && e.menge !== undefined ? `${veraenderung(e.menge)} ${e.einheit ?? ''}`.trim() : '' }),
  );
}

/**
 * Der Verlauf eines Projekts: wann wie viel von was. Nach Tagen gruppiert,
 * das Neueste oben. Suchfeld und Ordner grenzen ein, wenn es viel wird.
 */
export async function verlaufZeigen(baustelle: Baustelle): Promise<void> {
  // Gleich anstossen: am iPhone darf zwischen Fingertipp und Teilen-Dialog
  // nicht viel Zeit vergehen.
  const xlsx = import('../lib/xlsx');
  const [eintraege, artikel, kunde] = await Promise.all([
    verlaufDerBaustelle(baustelle.id!), db.artikel.toArray(),
    baustelle.kundeId ? db.kunden.get(baustelle.kundeId) : undefined,
  ]);
  const titel = projektTitel(baustelle, kunde?.name);
  if (!eintraege.length) {
    melden('Verlauf', 'Noch nichts mitgeschrieben. Ab jetzt steht hier jede Position mit Datum und Uhrzeit – aufgeschrieben, dazugezählt, geändert oder gelöscht.');
    return;
  }

  // Der Ordner steht am Artikel im Archiv, nicht im Verlauf: so gilt die
  // heutige Einteilung auch fuer fruehere Eintraege.
  const ordnerVon = new Map(artikel.map((a) => [a.name, a.ordner] as const));
  const ordnerHier = [...new Set(eintraege.map((e) => (e.name ? ordnerVon.get(e.name) : undefined)).filter((o): o is string => Boolean(o)))]
    .sort((a, b) => a.localeCompare(b, 'de'));

  const liste = h('div', { class: 'verlauf' });
  const suche = h('input', { type: 'search', placeholder: 'Artikel suchen…', autocomplete: 'off' });
  const ordner = h('select', { 'aria-label': 'Ordner' },
    h('option', { value: '', text: 'Alle Ordner' }),
    ...ordnerHier.map((o) => h('option', { value: o, text: o })),
  );

  const gefiltert = (): VerlaufEintrag[] => {
    const q = suchNorm(suche.value.trim());
    const o = ordner.value;
    if (!q && !o) return eintraege;
    return eintraege.filter((e) => e.name
      && (!q || suchNorm(e.name).includes(q))
      && (!o || ordnerVon.get(e.name) === o));
  };

  const zeichnen = () => {
    const auswahl = gefiltert();
    const teile: HTMLElement[] = [];
    let tag = '';
    for (const e of auswahl.slice(0, MAX_ZEILEN)) {
      const d = datum(e.zeit);
      if (d !== tag) {
        tag = d;
        teile.push(h('div', { class: 'abschnitt', text: d }));
      }
      teile.push(zeileBauen(e));
    }
    if (!auswahl.length) teile.push(h('div', { class: 'leer', text: 'Dazu steht nichts im Verlauf.' }));
    if (auswahl.length > MAX_ZEILEN) {
      teile.push(h('div', { class: 'hinweis', text: `Gezeigt sind die neuesten ${MAX_ZEILEN} von ${auswahl.length} Einträgen. Alle stehen in der Excel-Ausgabe.` }));
    }
    liste.replaceChildren(...teile);
  };
  suche.addEventListener('input', zeichnen);
  ordner.addEventListener('change', zeichnen);
  zeichnen();

  blatt(
    `Verlauf · ${titel}`,
    [
      h('div', { class: 'verlauf-filter' },
        h('label', { class: 'feld', style: 'margin:0' }, suche),
        ordnerHier.length ? ordner : null,
      ),
      liste,
    ],
    [
      { text: 'Als Excel', art: 'zweit', tun: () => void ausgeben(titel, gefiltert(), ordnerVon, xlsx) },
      { text: 'Schließen' },
    ],
  );
}

/** Der Verlauf als Excel-Liste, aelteste Zeile oben — so liest man ein Protokoll. */
async function ausgeben(
  titel: string,
  eintraege: VerlaufEintrag[],
  ordnerVon: Map<string, string | undefined>,
  modul: Promise<typeof import('../lib/xlsx')>,
): Promise<void> {
  const { xlsxDatei } = await modul;
  const zeilen = eintraege.slice().reverse().map((e) => [
    datum(e.zeit),
    zeit(e.zeit),
    VORGANG[e.art],
    e.name ?? '',
    (e.name && ordnerVon.get(e.name)) || '',
    e.menge !== undefined ? String(e.menge) : '',
    e.einheit ?? '',
    e.stand !== undefined ? String(e.stand) : '',
    e.positionen !== undefined ? String(e.positionen) : '',
    e.schein ?? '',
    e.geraet ?? '',
  ]);
  const datei = xlsxDatei([{
    name: 'Verlauf',
    kopf: true,
    spalten: [
      { titel: 'Datum', breite: 11 },
      { titel: 'Uhrzeit', breite: 8 },
      { titel: 'Vorgang', breite: 22 },
      { titel: 'Artikel', breite: 40 },
      { titel: 'Ordner', breite: 18 },
      { titel: 'Menge', breite: 9, zahl: true },
      { titel: 'Einheit', breite: 8 },
      { titel: 'Stand danach', breite: 12, zahl: true },
      { titel: 'Positionen', breite: 10, zahl: true },
      { titel: 'Schein', breite: 24 },
      { titel: 'Gerät', breite: 8 },
    ],
    zeilen,
  }], `${dateinameTeil(titel)}_Verlauf_${datumSortierbar(Date.now())}.xlsx`);
  const ergebnis = await teilen([datei]);
  if (ergebnis === 'nicht-moeglich') melden(...NICHT_MOEGLICH);
  if (ergebnis === 'geteilt' && AM_PC) melden('Gespeichert', 'Die Excel-Datei liegt im Download-Ordner.');
}
