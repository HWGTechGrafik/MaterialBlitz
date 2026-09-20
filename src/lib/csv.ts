import type { Baustelle, Kunde, Schein } from '../model';
import { datum, dateinameTeil, datumSortierbar, menge, zeit, zeitKompakt } from './format';

// Das Buero bekommt weiterhin "Baustelle" — dort haengen Vorlagen und
// Gewohnheiten daran. In der App heisst dasselbe Ding "Projekt".
const SPALTEN = [
  'Datum', 'Zeit', 'Kunde', 'Baustelle', 'Bereich',
  'Material', 'Menge', 'Einheit', 'Nachtrag',
] as const;

/**
 * RFC 4180: Felder mit Trennzeichen, Anfuehrungszeichen oder Zeilenumbruch
 * werden eingefasst, innere Anfuehrungszeichen verdoppelt.
 */
function feld(wert: string): string {
  return /[;"\r\n]/.test(wert) ? `"${wert.replace(/"/g, '""')}"` : wert;
}

export function csvErzeugen(schein: Schein, baustelle: Baustelle, kunde?: Kunde): string {
  const stand = schein.beendet ?? Date.now();
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

  const zeilen = [
    SPALTEN.join(';'),
    // Kopfdaten in jeder Zeile wiederholt, damit das Buero mehrere Scheine
    // untereinanderkopieren, filtern und summieren kann. Keine Summenzeile —
    // die zerstoert jeden Filter.
    ...schein.positionen.map((p) =>
      [...kopf, p.name, menge(p.menge), p.einheit, nachtrag].map(feld).join(';'),
    ),
  ];

  // CRLF als Zeilenende, UTF-8-BOM davor: ohne BOM zerlegt deutsches Excel
  // die Umlaute, ohne Semikolon wirft es alles in eine Spalte.
  return '﻿' + zeilen.join('\r\n') + '\r\n';
}

export function csvDateiname(schein: Schein, baustelle: Baustelle): string {
  const stand = schein.beendet ?? Date.now();
  const teile = [
    'MaterialBlitz',
    datumSortierbar(stand),
    zeitKompakt(stand),
    dateinameTeil(baustelle.ort),
  ];
  if (schein.bezeichnung) teile.push(dateinameTeil(schein.bezeichnung));
  return teile.join('_') + '.csv';
}

export function csvDatei(schein: Schein, baustelle: Baustelle, kunde?: Kunde): File {
  return new File([csvErzeugen(schein, baustelle, kunde)], csvDateiname(schein, baustelle), {
    type: 'text/csv',
  });
}
