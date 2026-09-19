// Erzeugt die Icon-Dateien aus der Bildmarke.
//
//   node scripts/icons.mjs
//
// Die Marke wird hier mit Canvas nachgezeichnet statt aus dem SVG gerendert —
// so haengt der Bau nicht an einem SVG-Renderer, und die drei Fassungen lassen
// sich sauber auseinanderhalten:
//
//   icon-192 / icon-512        wie geliefert, mit eigenen runden Ecken
//   icon-maskable-512          randlos, Motiv auf 78 % — Android schneidet rund zu
//   apple-touch-icon           volles Quadrat, keine Rundung, keine Transparenz
//   favicon                    klein
//
// Warum getrennt: Android beschneidet Icons in Geraeteformen, dabei muss das
// Motiv in den inneren 80 % liegen. Und iOS legt hinter transparente Ecken
// Schwarz und rundet selbst nach — ein Icon mit eigener Rundung bekommt dort
// einen dunklen Rand.

import { mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';

const M_PFAD = [
  [73, 395], [73, 120], [150, 120], [256, 230], [362, 120],
  [430, 120], [320, 235], [256, 300], [150, 195], [150, 395],
];
const BLITZ_PFAD = [
  [362, 120], [278, 280], [345, 280], [270, 440],
  [438, 242], [367, 242], [426, 120],
];

function polygon(ctx, punkte) {
  ctx.beginPath();
  punkte.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

function zeichnen(groesse, { rundung, randlos, skalierung, deckend }) {
  const c = createCanvas(groesse, groesse);
  const ctx = c.getContext('2d');
  const f = groesse / 512;
  ctx.scale(f, f);

  const grund = ctx.createLinearGradient(0, 0, 512, 512);
  grund.addColorStop(0, '#173A63');
  grund.addColorStop(1, '#001B45');
  ctx.fillStyle = grund;

  if (randlos || deckend) {
    ctx.fillRect(0, 0, 512, 512);
  } else {
    ctx.beginPath();
    ctx.roundRect(0, 0, 512, 512, rundung);
    ctx.fill();
  }

  ctx.save();
  if (skalierung !== 1) {
    ctx.translate(256, 256);
    ctx.scale(skalierung, skalierung);
    ctx.translate(-256, -256);
  }

  ctx.fillStyle = '#FFFFFF';
  polygon(ctx, M_PFAD);

  const blitz = ctx.createLinearGradient(270, 120, 438, 440);
  blitz.addColorStop(0, '#FFD21A');
  blitz.addColorStop(1, '#F5A400');
  ctx.fillStyle = blitz;
  polygon(ctx, BLITZ_PFAD);

  ctx.restore();
  return c.toBuffer('image/png');
}

const ziel = new URL('../public/', import.meta.url);
mkdirSync(ziel, { recursive: true });

const dateien = [
  ['icon-192.png',          192, { rundung: 107, randlos: false, skalierung: 1,    deckend: false }],
  ['icon-512.png',          512, { rundung: 107, randlos: false, skalierung: 1,    deckend: false }],
  ['icon-maskable-512.png', 512, { rundung: 0,   randlos: true,  skalierung: 0.78, deckend: false }],
  ['apple-touch-icon.png',  180, { rundung: 0,   randlos: true,  skalierung: 1,    deckend: true  }],
  ['favicon.png',            64, { rundung: 13,  randlos: false, skalierung: 1,    deckend: false }],
];

for (const [name, groesse, opt] of dateien) {
  const daten = zeichnen(groesse, opt);
  writeFileSync(new URL(name, ziel), daten);
  console.log(`${name.padEnd(24)} ${groesse}x${groesse}  ${(daten.length / 1024).toFixed(1)} KB`);
}
