/**
 * Strich- und QR-Codes am Artikel. Sie dienen **nur zum Wiederfinden** in der
 * App und stehen nie auf PDF oder CSV — sonst waere die Artikelnummer durch
 * die Hintertuer doch da (spec §2, §5.6).
 */

/**
 * Wie ein Code gespeichert und verglichen wird: ohne Leerzeichen und
 * Steuerzeichen (GS1-Codes tragen welche), gross.
 */
export function codeNormalisieren(roh: string): string {
  return roh.replace(/[\s\x00-\x1f\x7f]+/g, '').toUpperCase();
}

// Ohne 0/O und 1/I: abgetippt verwechselt man sie.
const ZEICHEN = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Ein eigener Code fuer Material, das keinen mitbringt, etwa "MB-K7Q2XP".
 * Zufaellig statt fortlaufend: zwei Handys vergeben sonst dieselben Nummern.
 */
export function eigenerCode(): string {
  const zufall = crypto.getRandomValues(new Uint8Array(6));
  return 'MB-' + Array.from(zufall, (b) => ZEICHEN[b % ZEICHEN.length]).join('');
}

export function istEigenerCode(code: string): boolean {
  return /^MB-[2-9A-HJ-NP-Z]{6}$/.test(code);
}

/** Was fuer ein Code das ist — nur fuer die Anzeige im Register. */
export function codeArt(code: string): string {
  if (istEigenerCode(code)) return 'eigener Code';
  if (/^\d{13}$/.test(code)) return 'EAN-13';
  if (/^\d{8}$/.test(code)) return 'EAN-8';
  if (/^\d{12}$/.test(code)) return 'UPC-A';
  return 'Code';
}

/**
 * Pruefziffer von EAN-8, UPC-A, EAN-13 und GTIN-14. `null`, wenn der Code
 * keine dieser Laengen hat — dann gibt es nichts zu pruefen.
 */
export function pruefzifferStimmt(code: string): boolean | null {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return null;
  const ziffern = [...code].map(Number);
  const pruef = ziffern.pop();
  // Von rechts gezaehlt wechseln die Gewichte 3 und 1.
  const summe = ziffern.reverse().reduce((s, z, i) => s + z * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (summe % 10)) % 10 === pruef;
}

/** Einen abgetippten Code pruefen, bevor er am Artikel landet. */
export function codePruefen(roh: string): { code: string } | { fehler: string } {
  const code = codeNormalisieren(roh);
  if (!code) return { fehler: 'Bitte zuerst den Code eintippen.' };
  if (code.length < 4) return { fehler: 'Zu kurz für einen Code.' };
  if (code.length > 64) return { fehler: 'Zu lang für einen Code.' };
  // Mehr kann ein Strichcode nicht tragen; ein Umlaut ist sicher vertippt.
  if (!/^[\x21-\x7E]+$/.test(code)) {
    return { fehler: 'Nur Ziffern, Buchstaben ohne Umlaute und Satzzeichen.' };
  }
  if (pruefzifferStimmt(code) === false) {
    return { fehler: 'Die letzte Ziffer passt nicht zu den anderen – vermutlich vertippt.' };
  }
  return { code };
}

/**
 * Inhalt des eigenen QR-Etiketts: `MB1|<Code>|<Name>|<Einheit>`.
 *
 * Name und Einheit reisen mit, damit auch das Handy eines Kollegen, dessen
 * Katalog den Code nicht kennt, weiss, was gemeint ist. Der Code steht vorn,
 * weil der Name sich aendern darf — ein umbenannter Artikel wird ueber den
 * Code trotzdem gefunden.
 */
export function qrInhalt(code: string, name: string, einheit: string): string {
  return ['MB1', code, name, einheit].join('|');
}

/** Gegenstueck zu `qrInhalt` — null, wenn es kein eigenes Etikett ist. */
export function qrLesen(text: string): { code: string; name: string; einheit: string } | null {
  const teile = text.split('|');
  if (teile[0] !== 'MB1' || teile.length < 4) return null;
  // Ein "|" im Namen ist unwahrscheinlich, aber so bleibt er heil.
  return { code: codeNormalisieren(teile[1]!), name: teile.slice(2, -1).join('|'), einheit: teile.at(-1)! };
}
