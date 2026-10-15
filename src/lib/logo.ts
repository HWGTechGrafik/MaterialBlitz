import type { Logo } from '../model';
import { markeDataURL } from './marke';

// Das Firmenlogo fuer PDF und Excel.
//
// Beim Einlesen verkleinert: ein Logo vom Grafiker hat gern mehrere MB, und
// es reist mit jeder Sicherung und jedem Dropbox-Abgleich mit. Auf dem PDF ist
// es keine zwei Zentimeter hoch — 600 Pixel Breite sind dafuer reichlich.

const MAX_BREITE = 600;
const MAX_HOEHE = 300;
/** Darueber wird es ein JPEG — ein Foto als Logo waere als PNG zu schwer. */
const MAX_PNG = 300_000;

/** Bilddatei einlesen und verkleinern. `null`, wenn sie sich nicht lesen laesst. */
export async function logoEinlesen(datei: File): Promise<Logo | null> {
  const url = URL.createObjectURL(datei);
  try {
    const bild = await new Promise<HTMLImageElement>((fertig, fehler) => {
      const b = new Image();
      b.onload = () => fertig(b);
      b.onerror = fehler;
      b.src = url;
    });
    // SVG ohne feste Groesse meldet 0 — dann gilt die Hoechstbreite.
    const w0 = bild.naturalWidth || MAX_BREITE;
    const h0 = bild.naturalHeight || MAX_HOEHE;
    const faktor = Math.min(1, MAX_BREITE / w0, MAX_HOEHE / h0);
    const breite = Math.max(1, Math.round(w0 * faktor));
    const hoehe = Math.max(1, Math.round(h0 * faktor));

    const c = document.createElement('canvas');
    c.width = breite;
    c.height = hoehe;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bild, 0, 0, breite, hoehe);
    let daten = c.toDataURL('image/png');
    if (daten.length > MAX_PNG) {
      // JPEG kennt keine Transparenz — sonst wuerde der Hintergrund schwarz.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, breite, hoehe);
      daten = c.toDataURL('image/jpeg', 0.9);
    }
    return { bild: daten, breite, hoehe };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Was oben auf PDF und Excel steht: das eigene Logo, sonst das MaterialBlitz-Zeichen. */
export function kopfLogo(logo?: Logo): Logo | null {
  if (logo?.bild) return logo;
  const marke = markeDataURL();
  return marke ? { bild: marke, breite: 256, hoehe: 256 } : null;
}

export function logoTyp(logo: Logo): 'png' | 'jpeg' {
  return logo.bild.startsWith('data:image/jpeg') ? 'jpeg' : 'png';
}

/** Die Bytes hinter dem Datenstring — fuer die Excel-Datei. */
export function logoBytes(logo: Logo): Uint8Array {
  const roh = atob(logo.bild.slice(logo.bild.indexOf(',') + 1));
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
  return bytes;
}

/** Breite und Hoehe innerhalb eines Rahmens, Seitenverhaeltnis bleibt. */
export function eingepasst(logo: Logo, maxBreite: number, maxHoehe: number): { breite: number; hoehe: number } {
  const faktor = Math.min(maxBreite / logo.breite, maxHoehe / logo.hoehe);
  return { breite: logo.breite * faktor, hoehe: logo.hoehe * faktor };
}
