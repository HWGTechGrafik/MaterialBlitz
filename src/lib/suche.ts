// Ein Feld fuer alles: Projekte, Kunden, Scheine, einzelne Positionen und den
// Katalog. Gesucht wird in dem, was auch auf dem Bildschirm steht — nicht in
// internen Kennungen. Dieses Modul liefert nur Daten; die Oberflaeche baut die
// Trefferliste daraus (src/views/uebersicht.ts).

import { db } from '../db';
import type { Schein } from '../model';
import { datum, menge as mengeText } from './format';

/** Ab zwei Zeichen wird gesucht — auf ein einziges passt fast alles. */
export const SUCHE_AB = 2;

export function suchAktiv(begriff: string): boolean {
  return begriff.trim().length >= SUCHE_AB;
}

/**
 * Klein, ohne Akzente, ss statt ß — damit „Strasse" auch „Straße" findet und
 * die Grossschreibung egal ist. Die Karte haelt fuer **jedes** Zeichen des
 * Ergebnisses fest, aus welchem Zeichen der Vorlage es stammt: nur so laesst
 * sich eine Fundstelle spaeter im Originaltext hervorheben, obwohl das ß
 * unterwegs zu zwei Zeichen geworden ist.
 */
function normMitKarte(text: string): { norm: string; karte: number[] } {
  let norm = '';
  const karte: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const zeichen = text[i]!
      .toLowerCase()
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    for (let k = 0; k < zeichen.length; k++) karte.push(i);
    norm += zeichen;
  }
  karte.push(text.length); // Waechter fuer das Ende der letzten Fundstelle
  return { norm, karte };
}

export function suchNorm(text: unknown): string {
  return normMitKarte(String(text ?? '')).norm;
}

/** Mehrere Woerter muessen **alle** vorkommen — „hauptstrasse kabel". */
export function suchBegriffe(begriff: string): string[] {
  return suchNorm(begriff).split(/\s+/).filter(Boolean);
}

/**
 * Text in Stuecke zerlegen, die gefundenen markiert. Die Oberflaeche macht
 * daraus Textknoten und <mark> — nichts wird als HTML zusammengesetzt, also
 * kann auch ein Artikelname mit spitzen Klammern nichts anrichten.
 */
export function zerlegen(
  text: string,
  begriffe: string[],
): Array<{ text: string; treffer: boolean }> {
  if (!text || !begriffe.length) return [{ text, treffer: false }];
  const { norm, karte } = normMitKarte(text);

  const stellen: Array<[number, number]> = [];
  for (const b of begriffe) {
    let i = norm.indexOf(b);
    while (i >= 0) {
      stellen.push([i, i + b.length]);
      i = norm.indexOf(b, i + 1);
    }
  }
  if (!stellen.length) return [{ text, treffer: false }];

  // Ueberlappende Fundstellen verschmelzen, sonst zerfaellt „kabelkanal" bei
  // der Suche nach „kabel kanal" in ineinandergeschachtelte Stuecke.
  stellen.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const gebiete: Array<[number, number]> = [];
  for (const [von, bis] of stellen) {
    const letzt = gebiete[gebiete.length - 1];
    if (letzt && von <= letzt[1]) letzt[1] = Math.max(letzt[1], bis);
    else gebiete.push([von, bis]);
  }

  const stuecke: Array<{ text: string; treffer: boolean }> = [];
  let gelesen = 0;
  for (const [von, bis] of gebiete) {
    const a = karte[von]!;
    const b = karte[bis]!;
    if (a > gelesen) stuecke.push({ text: text.slice(gelesen, a), treffer: false });
    stuecke.push({ text: text.slice(a, b), treffer: true });
    gelesen = b;
  }
  if (gelesen < text.length) stuecke.push({ text: text.slice(gelesen), treffer: false });
  return stuecke;
}

// ------------------------------------------------------------------- Funde

export type FundArt = 'projekt' | 'schein' | 'position' | 'artikel';

/** Ein Feld, in dem etwas gefunden wurde — die Begruendung unter dem Fund. */
export interface Treffer {
  feld: string;
  zeig: string;
}

export interface Fund {
  art: FundArt;
  titel: string;
  unter: string;
  /** Nur das, was nicht ohnehin in Titel oder Unterzeile steht. */
  treffer: Treffer[];
  /** Ziel beim Antippen; fehlt beim Katalogartikel. */
  baustelleId?: number;
  /** Zeitpunkt, nach dem innerhalb eines Projekts sortiert wird. */
  wann: number;
}

export interface Gruppe {
  titel: string;
  unter?: string;
  funde: Fund[];
}

/** Mehr Artikel als das zeigt kein Mensch durch — der Rest steht als Zahl da. */
const KATALOG_MAX = 12;

/**
 * Passt der Fund auf alle Begriffe? Der Kopf (Projekt, Kunde, Schein) haengt
 * an jedem Fund, damit „hauptstrasse kabel" die Position am richtigen Projekt
 * findet. Mindestens ein Begriff muss aber in den **eigenen** Feldern stecken,
 * sonst wirft die Suche nach „hauptstrasse" jede einzelne Position dieses
 * Projekts aus — und das Projekt selbst ginge darin unter.
 */
function trifft(
  kopf: string,
  felder: Array<Treffer | null>,
  begriffe: string[],
): Treffer[] | null {
  const echte = felder.filter((f): f is Treffer => Boolean(f && f.zeig));
  const eigenText = echte.map((f) => f.zeig).join(' ¦ ');
  const heu = suchNorm(kopf + ' ¦ ' + eigenText);
  if (!begriffe.every((b) => heu.includes(b))) return null;

  const eigen = suchNorm(eigenText);
  if (!begriffe.some((b) => eigen.includes(b))) return null;

  return echte.filter((f) => {
    const n = suchNorm(f.zeig);
    return begriffe.some((b) => n.includes(b));
  });
}

/** Begruendungen weglassen, die in Titel oder Unterzeile ohnehin dastehen. */
function begruendung(treffer: Treffer[], titel: string, unter: string): Treffer[] {
  const sichtbar = suchNorm(titel + ' ¦ ' + unter);
  return treffer.filter((t) => !sichtbar.includes(suchNorm(t.zeig))).slice(0, 3);
}

function standVon(s: Schein): string {
  return s.zustand === 'offen' ? 'offen' : s.zustand === 'geteilt' ? 'ans Büro geteilt' : 'übergeben';
}

export async function durchsuchen(begriff: string): Promise<Gruppe[]> {
  const begriffe = suchBegriffe(begriff);
  if (!begriffe.length) return [];

  const [baustellen, kunden, scheine, artikel] = await Promise.all([
    db.baustellen.toArray(),
    db.kunden.toArray(),
    db.scheine.toArray(),
    db.artikel.toArray(),
  ]);
  const kundeVon = new Map(kunden.map((k) => [k.id!, k.name] as const));
  const scheineVon = new Map<number, Schein[]>();
  for (const s of scheine) {
    const liste = scheineVon.get(s.baustelleId);
    if (liste) liste.push(s);
    else scheineVon.set(s.baustelleId, [s]);
  }

  const gruppen: Gruppe[] = [];

  // Offene Projekte zuerst, innerhalb davon das zuletzt benutzte oben — die
  // Reihenfolge, die man von der Liste her kennt.
  const sortiert = baustellen
    .filter((b) => !b.versteckt)
    .sort(
      (a, b) =>
        Number(Boolean(a.abgeschlossen)) - Number(Boolean(b.abgeschlossen)) ||
        b.zuletzt - a.zuletzt,
    );

  for (const b of sortiert) {
    const kunde = b.kundeId ? kundeVon.get(b.kundeId) : undefined;
    const kopf = [b.ort, kunde ?? 'ohne Kunden'].join(' ');
    const funde: Fund[] = [];

    const projektTreffer = trifft(
      kopf,
      [
        { feld: 'Ort', zeig: b.ort },
        kunde ? { feld: 'Kunde', zeig: kunde } : null,
        b.abgeschlossen ? { feld: 'Stand', zeig: 'abgeschlossen' } : null,
      ],
      begriffe,
    );
    if (projektTreffer) {
      const unter = kunde ?? 'ohne Kunden';
      funde.push({
        art: 'projekt',
        titel: b.ort,
        unter: b.abgeschlossen ? `${unter} · abgeschlossen` : unter,
        treffer: begruendung(projektTreffer, b.ort, unter),
        baustelleId: b.id!,
        wann: Number.MAX_SAFE_INTEGER, // das Projekt steht in seiner Gruppe oben
      });
    }

    for (const s of scheineVon.get(b.id!) ?? []) {
      const wann = s.beendet ?? s.erstellt;
      const stand = standVon(s);
      const name = s.bezeichnung ? `Schein „${s.bezeichnung}"` : `Schein vom ${datum(wann)}`;
      const scheinKopf = `${kopf} ${name} ${stand}`;

      const scheinTreffer = trifft(
        kopf,
        [
          s.bezeichnung ? { feld: 'Bezeichnung', zeig: s.bezeichnung } : null,
          s.herkunft ? { feld: 'Übernommen von', zeig: s.herkunft } : null,
          { feld: 'Datum', zeig: datum(wann) },
          { feld: 'Stand', zeig: stand },
          s.nachtragVon ? { feld: 'Art', zeig: 'Nachtrag' } : null,
        ],
        begriffe,
      );
      if (scheinTreffer) {
        const unter = `${s.positionen.length} Positionen · ${stand}`;
        funde.push({
          art: 'schein',
          titel: name,
          unter,
          treffer: begruendung(scheinTreffer, name, unter),
          baustelleId: b.id!,
          wann,
        });
      }

      for (const p of s.positionen) {
        const posTreffer = trifft(
          scheinKopf,
          [
            { feld: 'Material', zeig: p.name },
            { feld: 'Menge', zeig: `${mengeText(p.menge)} ${p.einheit}` },
          ],
          begriffe,
        );
        if (!posTreffer) continue;
        const unter = `${mengeText(p.menge)} ${p.einheit} · ${name}`;
        funde.push({
          art: 'position',
          titel: p.name,
          unter,
          treffer: begruendung(posTreffer, p.name, unter),
          baustelleId: b.id!,
          wann,
        });
      }
    }

    if (funde.length) {
      // Stabil: der Schein bleibt vor seinen eigenen Positionen stehen.
      funde.sort((x, y) => y.wann - x.wann);
      gruppen.push({ titel: b.ort, unter: kunde ?? 'ohne Kunden', funde });
    }
  }

  // Der Katalog zuletzt: er sagt nur, dass es den Artikel gibt — nicht, wo er
  // verbaut wurde.
  const katalog = artikel
    .map((a): Fund | null => {
      const treffer = trifft(
        `Katalog ${a.name}`,
        [
          { feld: 'Artikel', zeig: a.name },
          { feld: 'Einheit', zeig: a.einheit },
        ],
        begriffe,
      );
      if (!treffer) return null;
      const unter = `${a.einheit} · ${a.anzahl}× verwendet`;
      return {
        art: 'artikel',
        titel: a.name,
        unter,
        treffer: begruendung(treffer, a.name, unter),
        wann: a.anzahl,
      };
    })
    .filter((f): f is Fund => f !== null)
    .sort((x, y) => y.wann - x.wann);

  if (katalog.length) {
    const zuviel = katalog.length - KATALOG_MAX;
    gruppen.push({
      titel: 'Katalog',
      unter: zuviel > 0 ? `${katalog.length} Artikel · ${zuviel} weitere nicht gezeigt` : undefined,
      funde: katalog.slice(0, KATALOG_MAX),
    });
  }

  return gruppen;
}
