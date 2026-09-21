/**
 * Lizenzschluessel — Format `MBL1.<Inhalt>.<Signatur>`.
 *
 * Der Schluessel ist mit **ECDSA P-256** unterschrieben. Die App traegt nur
 * den oeffentlichen Teil; ausstellen kann Schluessel ausschliesslich, wer den
 * privaten hat. Anders als bei einer Pruefsumme nuetzt es also nichts, den
 * Quelltext zu lesen: pruefen kann damit jeder, faelschen niemand. Genau das
 * war der Mangel der ersten Fassung — dort stand das Salz im oeffentlichen
 * Quelltext, und wer es fand, konnte sich selbst Schluessel ausstellen.
 *
 * P-256 und nicht Ed25519, weil P-256 in jedem Browser mit WebCrypto
 * funktioniert — Ed25519 kam dort erst spaet dazu.
 *
 * Im Inhalt steht, **fuer welchen Betrieb** die Lizenz ausgestellt ist. Damit
 * ist der Merkzettel aus Ticket 12 im Schluessel selbst und nicht in einer
 * Liste daneben.
 *
 * **Die Grenze ehrlich benannt:** Die App laeuft vollstaendig am Geraet. Wer
 * den Quelltext aendert, haengt die Pruefung ab — bei einer Browser-App ist
 * das nicht zu verhindern. Die Unterschrift verhindert *erfundene*
 * Schluessel, nicht das Umgehen der Abfrage.
 */
import { LIZENZ_OEFFENTLICH } from './lizenz-schluessel';

export interface Lizenz {
  /** Auf welchen Betrieb die Lizenz ausgestellt ist. */
  betrieb: string;
  /** Ausstellungsdatum, ISO (JJJJ-MM-TT). */
  ausgestellt: string;
  /** Ablaufdatum, ISO — oder null fuer unbefristet. */
  laeuftAb: string | null;
  /** Fortlaufende Nummer, damit sich eine Lizenz zuordnen laesst. */
  nummer: string;
}

export type Ergebnis =
  | { ok: true; lizenz: Lizenz }
  | { ok: false; grund: 'form' | 'signatur' | 'abgelaufen'; text: string };

const PRAEFIX = 'MBL1';

/** Roher Inhalt eines Schluessels, absichtlich kurze Feldnamen. */
interface Inhalt {
  v: number;
  b: string;
  a: string;
  e?: string;
  n: string;
}

function vonBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const gefuellt = text.replace(/-/g, '+').replace(/_/g, '/');
  const roh = atob(gefuellt + '='.repeat((4 - (gefuellt.length % 4)) % 4));
  return Uint8Array.from(roh, (z) => z.charCodeAt(0));
}

/**
 * Leerzeichen und Zeilenumbrueche weg. Schluessel werden aus Nachrichten
 * kopiert, und dabei haengt haeufig ein Umbruch mit drin.
 */
export function saeubern(eingabe: string): string {
  return eingabe.replace(/\s+/g, '');
}

let gemerkt: CryptoKey | null = null;

async function oeffentlich(jwk: JsonWebKey): Promise<CryptoKey> {
  const einlesen = () =>
    crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'verify',
    ]);
  // Nur der ausgelieferte Schluessel wird gemerkt; ein mitgegebener kommt aus
  // einer Pruefung und waere im Zwischenspeicher nur im Weg.
  if (jwk !== LIZENZ_OEFFENTLICH) return einlesen();
  if (!gemerkt) gemerkt = await einlesen();
  return gemerkt;
}

/**
 * Prueft einen Schluessel. Ein abgelaufener wird eigens gemeldet —
 * „ungueltig" waere irrefuehrend, der Betrieb hatte ja einmal eine Lizenz.
 */
export async function pruefen(
  eingabe: string,
  heute: Date = new Date(),
  schluessel: JsonWebKey = LIZENZ_OEFFENTLICH,
): Promise<Ergebnis> {
  const teile = saeubern(eingabe).split('.');
  if (teile.length !== 3 || teile[0] !== PRAEFIX) {
    return { ok: false, grund: 'form', text: 'Das sieht nicht nach einem MaterialBlitz-Schlüssel aus.' };
  }
  const [, koerper, unterschrift] = teile as [string, string, string];

  let inhalt: Inhalt;
  let unterschrieben: Uint8Array<ArrayBuffer>;
  let signatur: Uint8Array<ArrayBuffer>;
  try {
    unterschrieben = new TextEncoder().encode(koerper);
    signatur = vonBase64Url(unterschrift);
    inhalt = JSON.parse(new TextDecoder().decode(vonBase64Url(koerper))) as Inhalt;
  } catch {
    return { ok: false, grund: 'form', text: 'Der Schlüssel ist unvollständig oder beschädigt.' };
  }

  let gueltig = false;
  try {
    gueltig = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await oeffentlich(schluessel),
      signatur,
      unterschrieben,
    );
  } catch {
    gueltig = false;
  }
  if (!gueltig || inhalt.v !== 1 || !inhalt.b) {
    return { ok: false, grund: 'signatur', text: 'Dieser Schlüssel ist nicht gültig.' };
  }

  // Vergleich als Text: ISO-Datumsangaben sortieren sich richtig, und es gibt
  // keine Ueberraschungen durch Zeitzonen.
  const heuteIso = heute.toISOString().slice(0, 10);
  if (inhalt.e && inhalt.e < heuteIso) {
    return {
      ok: false,
      grund: 'abgelaufen',
      text: `Diese Lizenz ist am ${datumText(inhalt.e)} abgelaufen.`,
    };
  }

  return {
    ok: true,
    lizenz: {
      betrieb: inhalt.b,
      ausgestellt: inhalt.a,
      laeuftAb: inhalt.e ?? null,
      nummer: inhalt.n,
    },
  };
}

export function datumText(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('de-AT');
}
