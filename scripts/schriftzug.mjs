// Wandelt den Schriftzug im vollen Logo in Pfade um.
//
//   node scripts/schriftzug.mjs
//
// Ein SVG, das als Bild eingebunden ist, laedt **keine** Schriften nach. Auf
// jedem Geraet ohne installiertes Montserrat rendert "MaterialBlitz" in Arial
// — andere Breite, anderer Zeichenabstand, anderes Logo. Fuer eine Wortmarke
// muss der Text darum als Umriss vorliegen.
//
//   materialblitz-logo-schrift.svg   Quelle, Text ist noch Text und aenderbar
//   materialblitz-logo.svg           Ergebnis, Text als Pfade
//
// Umrissen wird mit der echten Schrift aus dem Systemordner: die Buchstaben
// werden nicht nachgezeichnet, sondern aus der Schriftdatei gelesen. Der
// Zeichenabstand und die Unterschneidung (Kerning aus GPOS) kommen mit, sonst
// saehe die Wortmarke anders aus als im Entwurf.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SCHRIFTEN = 'C:/Windows/Fonts/';
const ORDNER = 'assets/logo/';
const QUELLE = ORDNER + 'materialblitz-logo-schrift.svg';
const ZIEL = ORDNER + 'materialblitz-logo.svg';

// ---------------------------------------------------------- Schrift lesen

function schrift(datei) {
  const b = readFileSync(datei);
  const tabellen = new Map();
  for (let i = 0; i < b.readUInt16BE(4); i++) {
    const o = 12 + i * 16;
    tabellen.set(b.toString('ascii', o, o + 4), b.readUInt32BE(o + 8));
  }
  const t = (tag) => {
    const o = tabellen.get(tag);
    if (o === undefined) throw new Error(`Tabelle ${tag} fehlt in ${datei}`);
    return o;
  };

  const head = t('head');
  const proEm = b.readUInt16BE(head + 18);
  const langeOffsets = b.readInt16BE(head + 50) === 1;
  const anzahlBreiten = b.readUInt16BE(t('hhea') + 34);
  const loca = t('loca');
  const glyf = t('glyf');
  const hmtx = t('hmtx');

  // ----------------------------------------------- Zeichen -> Glyphnummer
  const zeichen = new Map();
  const cmap = t('cmap');
  let unter = 0;
  for (let i = 0; i < b.readUInt16BE(cmap + 2); i++) {
    const o = cmap + 4 + i * 8;
    const plattform = b.readUInt16BE(o);
    const kodierung = b.readUInt16BE(o + 2);
    if ((plattform === 3 && (kodierung === 1 || kodierung === 10)) || plattform === 0) {
      unter = cmap + b.readUInt32BE(o + 4);
    }
  }
  if (!unter || b.readUInt16BE(unter) !== 4) throw new Error('cmap Format 4 nicht gefunden');
  const segmente = b.readUInt16BE(unter + 6) / 2;
  const ende = unter + 14;
  const start = ende + segmente * 2 + 2;
  const delta = start + segmente * 2;
  const bereich = delta + segmente * 2;
  for (let s = 0; s < segmente; s++) {
    const von = b.readUInt16BE(start + s * 2);
    const bis = b.readUInt16BE(ende + s * 2);
    const d = b.readInt16BE(delta + s * 2);
    const r = b.readUInt16BE(bereich + s * 2);
    for (let c = von; c <= bis && c !== 0xffff; c++) {
      let g;
      if (r === 0) g = (c + d) & 0xffff;
      else {
        g = b.readUInt16BE(bereich + s * 2 + r + (c - von) * 2);
        if (g !== 0) g = (g + d) & 0xffff;
      }
      if (g) zeichen.set(c, g);
    }
  }

  const breite = (g) => b.readUInt16BE(hmtx + (g < anzahlBreiten ? g : anzahlBreiten - 1) * 4);

  const lage = (g) =>
    langeOffsets
      ? [b.readUInt32BE(loca + g * 4), b.readUInt32BE(loca + g * 4 + 4)]
      : [b.readUInt16BE(loca + g * 2) * 2, b.readUInt16BE(loca + g * 2 + 2) * 2];

  // ------------------------------------------------------ Umriss je Glyph
  function umriss(g, verschiebung = [0, 0]) {
    const [von, bis] = lage(g);
    if (von >= bis) return [];
    let o = glyf + von;
    const konturen = b.readInt16BE(o);
    o += 10;

    if (konturen < 0) {
      // Zusammengesetztes Glyph (Umlaute etwa) — die Teile einsammeln.
      const stuecke = [];
      for (;;) {
        const flaggen = b.readUInt16BE(o);
        const teil = b.readUInt16BE(o + 2);
        o += 4;
        let dx;
        let dy;
        if (flaggen & 1) {
          dx = b.readInt16BE(o);
          dy = b.readInt16BE(o + 2);
          o += 4;
        } else {
          dx = b.readInt8(o);
          dy = b.readInt8(o + 1);
          o += 2;
        }
        if (flaggen & 8) o += 2;
        else if (flaggen & 0x40) o += 4;
        else if (flaggen & 0x80) o += 8;
        stuecke.push(...umriss(teil, [verschiebung[0] + dx, verschiebung[1] + dy]));
        if (!(flaggen & 0x20)) break;
      }
      return stuecke;
    }

    const enden = [];
    for (let i = 0; i < konturen; i++) {
      enden.push(b.readUInt16BE(o));
      o += 2;
    }
    const punkte = enden[konturen - 1] + 1;
    o += 2 + b.readUInt16BE(o); // Anweisungen der Schrift ueberspringen

    const flaggen = [];
    while (flaggen.length < punkte) {
      const f = b.readUInt8(o++);
      flaggen.push(f);
      if (f & 8) {
        let n = b.readUInt8(o++);
        while (n--) flaggen.push(f);
      }
    }

    const lies = (kurzBit, gleichBit) => {
      const werte = [];
      let wert = 0;
      for (const f of flaggen) {
        if (f & kurzBit) {
          const d = b.readUInt8(o++);
          wert += f & gleichBit ? d : -d;
        } else if (!(f & gleichBit)) {
          wert += b.readInt16BE(o);
          o += 2;
        }
        werte.push(wert);
      }
      return werte;
    };
    const xs = lies(2, 16);
    const ys = lies(4, 32);

    const liste = [];
    let ab = 0;
    for (const bisIndex of enden) {
      const kontur = [];
      for (let i = ab; i <= bisIndex; i++) {
        kontur.push({
          x: xs[i] + verschiebung[0],
          y: ys[i] + verschiebung[1],
          auf: Boolean(flaggen[i] & 1),
        });
      }
      ab = bisIndex + 1;
      if (kontur.length) liste.push(kontur);
    }
    return liste;
  }

  const kern = new Map();
  if (tabellen.has('GPOS')) leseGPOS(b, t('GPOS'), kern);

  return {
    proEm,
    zeichen,
    breite,
    umriss,
    unterschneidung: (a, c) => kern.get(a * 65536 + c) ?? 0,
    paare: kern.size,
  };
}

/**
 * Aus GPOS nur das eine holen, was hier gebraucht wird: die X-Weite aus den
 * Paaren des Merkmals "kern". Alles andere bleibt unangetastet.
 */
function leseGPOS(b, gpos, ziel) {
  const merkmale = gpos + b.readUInt16BE(gpos + 6);
  const nachschlag = gpos + b.readUInt16BE(gpos + 8);

  const gewollt = new Set();
  for (let i = 0; i < b.readUInt16BE(merkmale); i++) {
    const o = merkmale + 2 + i * 6;
    if (b.toString('ascii', o, o + 4) !== 'kern') continue;
    const eintrag = merkmale + b.readUInt16BE(o + 4);
    for (let k = 0; k < b.readUInt16BE(eintrag + 2); k++) {
      gewollt.add(b.readUInt16BE(eintrag + 4 + k * 2));
    }
  }

  const deckung = (o) => {
    const liste = [];
    const format = b.readUInt16BE(o);
    const anzahl = b.readUInt16BE(o + 2);
    if (format === 1) {
      for (let i = 0; i < anzahl; i++) liste.push(b.readUInt16BE(o + 4 + i * 2));
      return liste;
    }
    for (let i = 0; i < anzahl; i++) {
      const r = o + 4 + i * 6;
      const von = b.readUInt16BE(r);
      const bis = b.readUInt16BE(r + 2);
      const erst = b.readUInt16BE(r + 4);
      for (let g = von; g <= bis; g++) liste[erst + (g - von)] = g;
    }
    return liste;
  };

  const klassen = (o) => {
    const karte = new Map();
    if (b.readUInt16BE(o) === 1) {
      const erst = b.readUInt16BE(o + 2);
      for (let i = 0; i < b.readUInt16BE(o + 4); i++) {
        karte.set(erst + i, b.readUInt16BE(o + 6 + i * 2));
      }
      return karte;
    }
    for (let i = 0; i < b.readUInt16BE(o + 2); i++) {
      const r = o + 4 + i * 6;
      const von = b.readUInt16BE(r);
      const bis = b.readUInt16BE(r + 2);
      const k = b.readUInt16BE(r + 4);
      for (let g = von; g <= bis; g++) karte.set(g, k);
    }
    return karte;
  };

  const satzBreite = (format) => {
    let n = 0;
    for (let bit = 0; bit < 16; bit++) if (format & (1 << bit)) n++;
    return n * 2;
  };
  // Die X-Weite ist Bit 3 (0x0004) und steht hinter den beiden Bits davor.
  const xWeite = (o, format) => {
    if (!(format & 0x0004)) return 0;
    let vor = 0;
    if (format & 0x0001) vor += 2;
    if (format & 0x0002) vor += 2;
    return b.readInt16BE(o + vor);
  };

  const paare = (o) => {
    const format = b.readUInt16BE(o);
    const abdeckung = deckung(o + b.readUInt16BE(o + 2));
    const f1 = b.readUInt16BE(o + 4);
    const f2 = b.readUInt16BE(o + 6);

    if (format === 1) {
      for (let i = 0; i < b.readUInt16BE(o + 8); i++) {
        const satz = o + b.readUInt16BE(o + 10 + i * 2);
        const erst = abdeckung[i];
        let p = satz + 2;
        for (let k = 0; k < b.readUInt16BE(satz); k++) {
          const wert = xWeite(p + 2, f1);
          if (wert) ziel.set(erst * 65536 + b.readUInt16BE(p), wert);
          p += 2 + satzBreite(f1) + satzBreite(f2);
        }
      }
      return;
    }
    if (format !== 2) return;

    const k1 = klassen(o + b.readUInt16BE(o + 8));
    const k2 = klassen(o + b.readUInt16BE(o + 10));
    const anzahl1 = b.readUInt16BE(o + 12);
    const anzahl2 = b.readUInt16BE(o + 14);
    const breite = satzBreite(f1) + satzBreite(f2);
    for (const g of abdeckung) {
      if (g === undefined) continue;
      const klasse = k1.get(g) ?? 0;
      if (klasse >= anzahl1) continue;
      for (const [g2, klasse2] of k2) {
        if (klasse2 >= anzahl2) continue;
        const wert = xWeite(o + 16 + (klasse * anzahl2 + klasse2) * breite, f1);
        if (wert) ziel.set(g * 65536 + g2, wert);
      }
    }
  };

  for (let i = 0; i < b.readUInt16BE(nachschlag); i++) {
    if (!gewollt.has(i)) continue;
    const o = nachschlag + b.readUInt16BE(nachschlag + 2 + i * 2);
    const art = b.readUInt16BE(o);
    for (let s = 0; s < b.readUInt16BE(o + 4); s++) {
      let u = o + b.readUInt16BE(o + 6 + s * 2);
      if (art === 9) {
        if (b.readUInt16BE(u + 2) !== 2) continue;
        u += b.readUInt32BE(u + 4);
      } else if (art !== 2) continue;
      paare(u);
    }
  }
}

// ----------------------------------------------------------- Satz -> Pfad

/**
 * Einen Text setzen. Liefert je Abschnitt einen Pfad — so behalten
 * "Material" und "Blitz" ihre eigene Farbe, sitzen aber auf einer Linie.
 */
function setzen(font, abschnitte, { groesse, abstand, x, y }) {
  const s = groesse / font.proEm;
  const glyphen = [];
  let weite = 0;
  let vorher = null;

  abschnitte.forEach((abschnitt, i) => {
    for (const z of abschnitt) {
      const g = font.zeichen.get(z.codePointAt(0));
      if (g === undefined) throw new Error(`Zeichen "${z}" fehlt in der Schrift`);
      if (vorher !== null) weite += font.unterschneidung(vorher, g) * s;
      glyphen.push({ g, x: weite, abschnitt: i });
      weite += font.breite(g) * s + abstand;
      vorher = g;
    }
  });
  // Der Abstand hinter dem letzten Buchstaben zaehlt nicht zur Wortbreite,
  // sonst saesse die Marke um ein halbes Zeichen nach links versetzt.
  weite -= abstand;

  const links = x - weite / 2;
  const pfade = abschnitte.map(() => []);
  for (const { g, x: gx, abschnitt } of glyphen) {
    const d = pfad(font.umriss(g), links + gx, y, s);
    if (d) pfade[abschnitt].push(d);
  }
  return { pfade: pfade.map((p) => p.join('')), weite };
}

const rund = (n) => Number(n.toFixed(2));

/** Die quadratischen Umrisse der Schrift als SVG-Pfad, y dabei umgedreht. */
function pfad(konturen, x0, y0, s) {
  const X = (p) => rund(x0 + p.x * s);
  const Y = (p) => rund(y0 - p.y * s);
  const mitte = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, auf: true });
  const teile = [];

  for (const kontur of konturen) {
    let punkte = kontur;
    const ersterAuf = punkte.findIndex((p) => p.auf);
    // Der Anfang muss auf der Kurve liegen, sonst die Mitte zweier Steuerpunkte.
    if (ersterAuf > 0) punkte = punkte.slice(ersterAuf).concat(punkte.slice(0, ersterAuf));
    else if (ersterAuf === -1) punkte = [mitte(punkte[0], punkte[punkte.length - 1]), ...punkte];

    teile.push(`M${X(punkte[0])} ${Y(punkte[0])}`);
    for (let i = 1; i <= punkte.length; i++) {
      const p = punkte[i % punkte.length];
      if (p.auf) {
        teile.push(`L${X(p)} ${Y(p)}`);
        continue;
      }
      const naechst = punkte[(i + 1) % punkte.length];
      const ziel = naechst.auf ? naechst : mitte(p, naechst);
      teile.push(`Q${X(p)} ${Y(p)} ${X(ziel)} ${Y(ziel)}`);
      if (naechst.auf) i++;
    }
    teile.push('Z');
  }
  return teile.join('');
}

// -------------------------------------------------------------------- Bau

const bold = SCHRIFTEN + 'Montserrat-Bold.ttf';
const regular = SCHRIFTEN + 'Montserrat-Regular.ttf';
for (const f of [bold, regular]) {
  if (!existsSync(f)) {
    console.error(`Schrift fehlt: ${f}`);
    console.error('Montserrat installieren oder SCHRIFTEN oben anpassen.');
    process.exit(1);
  }
}

const fett = schrift(bold);
const mager = schrift(regular);

const wort = setzen(fett, ['Material', 'Blitz'], {
  groesse: 116,
  abstand: -5,
  x: 600,
  y: 755,
});
const zeile = setzen(mager, ['DIGITALER MATERIALSCHEIN'], {
  groesse: 28,
  abstand: 10,
  x: 600,
  y: 825,
});

let svg = readFileSync(QUELLE, 'utf8');
const ersetze = (kennung, neu) => {
  const muster = new RegExp(`  <!-- ${kennung} -->\\n  <text[\\s\\S]*?</text>`);
  if (!muster.test(svg)) throw new Error(`Textblock ${kennung} nicht gefunden`);
  svg = svg.replace(muster, neu);
};

ersetze(
  'WORDMARK',
  '  <!-- WORDMARK - Montserrat Bold 700, Zeichenabstand -5, als Umriss -->\n' +
    `  <path fill="#102B49" d="${wort.pfade[0]}"/>\n` +
    `  <path fill="url(#wordBlitz)" d="${wort.pfade[1]}"/>`,
);
ersetze(
  'TAGLINE',
  '  <!-- TAGLINE - Montserrat Regular, Zeichenabstand 10, als Umriss -->\n' +
    `  <path fill="#27415F" d="${zeile.pfade[0]}"/>`,
);

writeFileSync(ZIEL, svg);
console.log(`${ZIEL} geschrieben`);
console.log(`  Wortmarke ${rund(wort.weite)} breit (${fett.paare} Kernpaare gelesen)`);
console.log(`  Zeile     ${rund(zeile.weite)} breit (${mager.paare} Kernpaare gelesen)`);
