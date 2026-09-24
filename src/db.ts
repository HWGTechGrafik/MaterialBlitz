import Dexie, { type EntityTable } from 'dexie';
import { codeNormalisieren } from './lib/codes';
import {
  EINHEITEN_STANDARD,
  FIRMA_LEER,
  type Artikel,
  type Baustelle,
  type Einstellungen,
  type Kunde,
  type Schein,
} from './model';

class MaterialBlitzDB extends Dexie {
  artikel!: EntityTable<Artikel, 'id'>;
  kunden!: EntityTable<Kunde, 'id'>;
  baustellen!: EntityTable<Baustelle, 'id'>;
  scheine!: EntityTable<Schein, 'id'>;
  einstellungen!: EntityTable<Einstellungen, 'id'>;

  constructor() {
    super('materialblitz');
    // Schema-Aenderungen kommen als neue version() dazu, nie als Aenderung
    // dieser Zeile — sonst verlieren bestehende Geraete ihre Daten.
    this.version(1).stores({
      artikel: '++id, &name, anzahl',
      kunden: '++id, name',
      baustellen: '++id, ort, zuletzt, kundeId',
      scheine: '++id, baustelleId, zustand, erstellt',
      einstellungen: '++id',
    });
    // Codes am Artikel (spec §5.6). Mehrfach-Index: jeder Code eines
    // Artikels ist einzeln auffindbar. Eindeutig haelt ihn die App selbst -
    // ein eindeutiger Index liesse sonst das Wiederherstellen einer
    // Sicherung an einem einzigen doppelten Code scheitern.
    this.version(2).stores({
      artikel: '++id, &name, anzahl, *codes',
    });
  }
}

export const db = new MaterialBlitzDB();

/** Die Einstellungen liegen als einzelner Datensatz mit id 1. */
export async function einstellungenLesen(): Promise<Einstellungen> {
  const vorhanden = await db.einstellungen.get(1);
  if (vorhanden) return vorhanden;
  const neu: Einstellungen = {
    id: 1,
    firma: { ...FIRMA_LEER },
    einheiten: [...EINHEITEN_STANDARD],
    neueArtikel: 0,
  };
  await db.einstellungen.put(neu);
  return neu;
}

export async function einstellungenSchreiben(teil: Partial<Einstellungen>): Promise<Einstellungen> {
  const alt = await einstellungenLesen();
  const neu = { ...alt, ...teil, id: 1 };
  await db.einstellungen.put(neu);
  return neu;
}

/**
 * Dauerhaften Speicher anfordern — beim **ersten Speichern eines Scheins**,
 * nicht beim Start. Zu diesem Zeitpunkt hat der Nutzer die App benutzt, und
 * genau darauf achten die Browser beim Gewaehren.
 */
let persistVersucht = false;
export async function speicherSichern(): Promise<void> {
  if (persistVersucht || !navigator.storage?.persist) return;
  persistVersucht = true;
  try {
    if (await navigator.storage.persisted?.()) return;
    await navigator.storage.persist();
  } catch {
    // Nicht verfuegbar — kein Grund, den Schein nicht zu speichern.
  }
}

/** Artikel anlegen oder, wenn vorhanden, seinen Zaehler erhoehen. */
export async function artikelVerwenden(name: string, einheit: string): Promise<boolean> {
  const vorhanden = await db.artikel.where('name').equals(name).first();
  if (vorhanden) {
    await db.artikel.update(vorhanden.id!, { anzahl: vorhanden.anzahl + 1 });
    return false;
  }
  await db.artikel.add({ name, einheit, anzahl: 1 });
  const e = await einstellungenLesen();
  await einstellungenSchreiben({ neueArtikel: e.neueArtikel + 1 });
  return true;
}

/** Der offene Schein einer Baustelle. Er wird nie "angelegt" — er ist da. */
export async function offenerSchein(baustelleId: number): Promise<Schein> {
  const alle = await db.scheine.where('baustelleId').equals(baustelleId).toArray();
  // Der selbst begonnene offene Schein ist der ohne Herkunft.
  const eigener = alle.find((s) => s.zustand === 'offen' && !s.herkunft);
  if (eigener) return eigener;
  const neu: Schein = {
    baustelleId,
    zustand: 'offen',
    erstellt: Date.now(),
    positionen: [],
  };
  neu.id = await db.scheine.add(neu);
  return neu;
}

export async function scheineDerBaustelle(baustelleId: number): Promise<Schein[]> {
  const alle = await db.scheine.where('baustelleId').equals(baustelleId).toArray();
  return alle.sort((a, b) => b.erstellt - a.erstellt);
}

/** Wie oft ein Artikel auf dieser Baustelle schon verbaut wurde. */
export async function verwendungHier(baustelleId: number): Promise<Map<string, number>> {
  const scheine = await db.scheine.where('baustelleId').equals(baustelleId).toArray();
  const zaehler = new Map<string, number>();
  for (const s of scheine) {
    for (const p of s.positionen) {
      zaehler.set(p.name, (zaehler.get(p.name) ?? 0) + 1);
    }
  }
  return zaehler;
}

/**
 * Die acht Kacheln: erst was auf **dieser** Baustelle verbaut wurde, dann mit
 * allgemein Haeufigem aufgefuellt. Ohne das Auffuellen zeigt eine neue
 * Baustelle ein leeres Raster — ausgerechnet beim ersten Eindruck.
 */
export async function kacheln(
  baustelleId: number,
  anzahl = 8,
): Promise<Array<Artikel & { hier: number }>> {
  const [alle, hier] = await Promise.all([db.artikel.toArray(), verwendungHier(baustelleId)]);
  const mitHier = alle.map((a) => ({ ...a, hier: hier.get(a.name) ?? 0 }));
  const vonHier = mitHier.filter((a) => a.hier > 0).sort((a, b) => b.hier - a.hier);
  const rest = mitHier.filter((a) => a.hier === 0).sort((a, b) => b.anzahl - a.anzahl);
  return [...vonHier, ...rest].slice(0, anzahl);
}

/** Der Artikel, der diesen (normalisierten) Code traegt — oder keiner. */
export async function artikelMitCode(code: string): Promise<Artikel | undefined> {
  return db.artikel.where('codes').equals(code).first();
}

/**
 * Vorschlaege ab zwei Buchstaben, hier Verwendetes zuerst. Ein abgetippter
 * Code, der genau passt, steht vor allem anderen.
 */
export async function suchen(
  begriff: string,
  baustelleId?: number,
): Promise<Array<Artikel & { hier: number; perCode?: boolean }>> {
  const q = begriff.trim().toLowerCase();
  if (q.length < 2) return [];
  const [alle, hier] = await Promise.all([
    db.artikel.toArray(),
    baustelleId ? verwendungHier(baustelleId) : Promise.resolve(new Map<string, number>()),
  ]);
  const code = codeNormalisieren(begriff);
  const perCode = alle.filter((a) => a.codes?.includes(code));
  const perName = alle
    .filter((a) => !perCode.includes(a) && a.name.toLowerCase().includes(q))
    .map((a) => ({ ...a, hier: hier.get(a.name) ?? 0 }))
    .sort((a, b) => b.hier - a.hier || b.anzahl - a.anzahl);
  return [
    ...perCode.map((a) => ({ ...a, hier: hier.get(a.name) ?? 0, perCode: true })),
    ...perName,
  ].slice(0, 8);
}
