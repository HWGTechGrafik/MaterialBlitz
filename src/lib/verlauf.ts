import { db } from '../db';
import type { Schein, VerlaufEintrag } from '../model';
import { AM_PC } from './geraet';

/**
 * Der Verlauf eines Projekts: wann wie viel von welchem Artikel dazukam,
 * geaendert oder geloescht wurde. Er wird nebenher mitgeschrieben und nie
 * bearbeitet — nur mit dem Projekt geloescht.
 *
 * Ein fehlgeschlagener Eintrag darf das Aufschreiben nie aufhalten: die
 * Position auf dem Schein ist das, was zaehlt.
 */
export async function vermerken(
  e: Omit<VerlaufEintrag, 'id' | 'zeit' | 'geraet'>,
): Promise<void> {
  try {
    await db.verlauf.add({ ...e, zeit: Date.now(), geraet: AM_PC ? 'PC' : 'Handy' });
  } catch {
    // Siehe oben.
  }
}

/**
 * Wie der Schein im Verlauf heisst — nur, wenn es nicht der eigene ist.
 * Sonst stuende an jeder Zeile dasselbe.
 */
export function scheinName(s: Schein): string | undefined {
  if (s.bezeichnung) return s.bezeichnung;
  if (s.herkunft) return `übernommen ${s.herkunft}`;
  if (s.nachtragVon) return 'Nachtrag';
  return undefined;
}

/** Neueste Eintraege zuerst. */
export async function verlaufDerBaustelle(baustelleId: number): Promise<VerlaufEintrag[]> {
  const alle = await db.verlauf.where('baustelleId').equals(baustelleId).toArray();
  return alle.sort((a, b) => b.zeit - a.zeit || (b.id ?? 0) - (a.id ?? 0));
}
