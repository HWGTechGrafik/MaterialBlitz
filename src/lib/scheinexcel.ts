import { projektTitel, type Baustelle, type Firma, type Kunde, type Logo, type Schein } from '../model';
import type { Ersteller } from '../store';
import { datum, scheinDateiname, zeit } from './format';
import { eingepasst, logoBytes, logoTyp } from './logo';
import { xlsxDatei, type Bild, type Spalte, type Tabelle, type Vorspann } from './xlsx';

// Der Schein als Excel-Datei fuers Buero. Frueher eine CSV — die war reiner
// Text, ohne Logo und ohne Kopf. Die Spalten sind dieselben geblieben, damit
// Vorlagen und Gewohnheiten im Buero weiter passen.

// Das Buero bekommt weiterhin "Baustelle" — dort haengen Vorlagen und
// Gewohnheiten daran. In der App heisst dasselbe Ding "Projekt".
const SPALTEN: Spalte[] = [
  { titel: 'Datum', breite: 11 },
  { titel: 'Zeit', breite: 7 },
  { titel: 'Kunde', breite: 22 },
  { titel: 'Baustelle', breite: 24 },
  { titel: 'Bereich', breite: 12 },
  { titel: 'Material', breite: 42 },
  // Als Zahl: das Buero soll summieren koennen, ohne Komma-Text umzuwandeln.
  { titel: 'Menge', breite: 9, zahl: true },
  { titel: 'Einheit', breite: 8 },
  { titel: 'Nachtrag', breite: 9 },
  { titel: 'Erstellt von', breite: 24 },
];

/** Hoechstens so gross steht das Logo oben links, in Pixeln. */
const LOGO_BREITE = 220;
const LOGO_HOEHE = 64;

export function scheinTabelle(
  schein: Schein, baustelle: Baustelle, firma: Firma, kunde?: Kunde,
  ersteller: Ersteller = { name: null, firma: null }, logo?: Logo | null,
): Tabelle {
  const stand = schein.beendet ?? Date.now();
  const wer = [ersteller.name, ersteller.firma].filter(Boolean).join(', ');
  const kopf = [
    datum(stand),
    zeit(stand),
    // Leer, wenn kein Kunde da ist. Ein Text wie "ohne Kunden" reihte sich
    // beim Sortieren zwischen die echten Kundennamen.
    kunde?.name ?? '',
    baustelle.ort,
    schein.bezeichnung ?? '',
  ];
  const nachtrag = schein.nachtragVon ? 'Ja' : '';

  // Der Briefkopf wie auf dem PDF. Die Tabelle darunter wiederholt die
  // Kopfdaten in jeder Zeile, damit das Buero mehrere Scheine
  // untereinanderkopieren, filtern und summieren kann. Keine Summenzeile —
  // die zerstoert jeden Filter.
  const vorspann: Vorspann[] = [];
  let bild: Bild | undefined;
  if (logo) {
    const g = eingepasst(logo, LOGO_BREITE, LOGO_HOEHE);
    bild = { daten: logoBytes(logo), typ: logoTyp(logo), breite: g.breite, hoehe: g.hoehe };
    // Punkt statt Pixel (3:4), dazu etwas Luft unter dem Bild.
    vorspann.push({ werte: [], hoehe: Math.ceil(g.hoehe * 0.75) + 8 });
  }
  vorspann.push({ werte: [firma.name || 'MaterialBlitz'], stil: 'fett' });
  const anschrift = [firma.strasse, firma.ort, firma.telefon && `Tel. ${firma.telefon}`].filter(Boolean).join(' · ');
  if (anschrift) vorspann.push({ werte: [anschrift], stil: 'grau' });
  vorspann.push({ werte: [] });
  vorspann.push({ werte: [schein.nachtragVon ? 'Materialschein – Nachtrag' : 'Materialschein'], stil: 'titel', hoehe: 22 });
  vorspann.push({ werte: ['Kunde', kunde?.name ?? 'ohne Kunden'], stil: 'paar' });
  vorspann.push({ werte: ['Baustelle', baustelle.ort || '—'], stil: 'paar' });
  if (schein.bezeichnung) vorspann.push({ werte: ['Bereich', schein.bezeichnung], stil: 'paar' });
  vorspann.push({ werte: ['Datum', `${datum(stand)}, ${zeit(stand)}`], stil: 'paar' });
  if (wer) vorspann.push({ werte: ['Erstellt von', wer], stil: 'paar' });
  vorspann.push({ werte: [] });

  return {
    name: 'Materialschein',
    spalten: SPALTEN,
    kopf: true,
    vorspann,
    bild,
    zeilen: schein.positionen.map((p) => [
      // Menge mit Punkt: so erkennt die Datei sie als Zahl; Excel zeigt
      // sie dann mit Komma.
      ...kopf, p.name, String(p.menge), p.einheit, nachtrag, wer,
    ]),
  };
}

export function scheinExcelDatei(
  schein: Schein, baustelle: Baustelle, firma: Firma, kunde?: Kunde,
  ersteller?: Ersteller, logo?: Logo | null,
): File {
  const stand = schein.beendet ?? Date.now();
  return xlsxDatei(
    [scheinTabelle(schein, baustelle, firma, kunde, ersteller, logo)],
    scheinDateiname(projektTitel(baustelle, kunde?.name), schein.bezeichnung, stand, 'xlsx'),
  );
}
