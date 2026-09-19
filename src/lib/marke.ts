// Die Bildmarke als PNG-Datenstring, fuer das PDF.
//
// Nachgezeichnet statt aus dem SVG geladen: jsPDF kann kein SVG, und ein
// Nachladen wuerde offline scheitern — genau dort, wo die App arbeitet.

const M_PFAD: Array<[number, number]> = [
  [73, 395], [73, 120], [150, 120], [256, 230], [362, 120],
  [430, 120], [320, 235], [256, 300], [150, 195], [150, 395],
];
const BLITZ_PFAD: Array<[number, number]> = [
  [362, 120], [278, 280], [345, 280], [270, 440],
  [438, 242], [367, 242], [426, 120],
];

let zwischengespeichert: string | null = null;

export function markeDataURL(): string {
  if (zwischengespeichert) return zwischengespeichert;

  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.scale(256 / 512, 256 / 512);

  const grund = ctx.createLinearGradient(0, 0, 512, 512);
  grund.addColorStop(0, '#173A63');
  grund.addColorStop(1, '#001B45');
  ctx.fillStyle = grund;
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 512, 107);
  ctx.fill();

  const zeichne = (punkte: Array<[number, number]>) => {
    ctx.beginPath();
    punkte.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  };

  ctx.fillStyle = '#FFFFFF';
  zeichne(M_PFAD);

  const blitz = ctx.createLinearGradient(270, 120, 438, 440);
  blitz.addColorStop(0, '#FFD21A');
  blitz.addColorStop(1, '#F5A400');
  ctx.fillStyle = blitz;
  zeichne(BLITZ_PFAD);

  zwischengespeichert = c.toDataURL('image/png');
  return zwischengespeichert;
}
