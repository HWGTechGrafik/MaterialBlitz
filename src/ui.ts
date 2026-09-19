// Kleine DOM-Helfer. Kein Framework: die App ist zu klein dafuer, und jedes
// Kilobyte zaehlt auf einer Baustelle mit einem Balken Empfang.

type Kind = Node | string | null | undefined | false;

interface Eigenschaften {
  class?: string;
  text?: string;
  html?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  onclick?: (ev: MouseEvent) => void;
  oninput?: (ev: Event) => void;
  [key: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  eigenschaften: Eigenschaften = {},
  ...kinder: Kind[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(eigenschaften)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    else if (k === 'html') e.innerHTML = String(v);
    else if (k.startsWith('on')) (e as unknown as Record<string, unknown>)[k] = v;
    else if (k in e && k !== 'list') (e as unknown as Record<string, unknown>)[k] = v;
    else e.setAttribute(k, String(v));
  }
  for (const kind of kinder) {
    if (kind === null || kind === undefined || kind === false) continue;
    e.append(typeof kind === 'string' ? document.createTextNode(kind) : kind);
  }
  return e;
}

/** Die Bildmarke als SVG — fuer den Kopf der Uebersicht und den Sperrbildschirm. */
export function marke(klasse = 'marke'): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const id = 'm' + Math.random().toString(36).slice(2, 8);
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', klasse);
  svg.setAttribute('viewBox', '0 0 512 512');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    `<defs>` +
    `<linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="#173A63"/><stop offset="100%" stop-color="#001B45"/></linearGradient>` +
    `<linearGradient id="b${id}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="#FFD21A"/><stop offset="100%" stop-color="#F5A400"/></linearGradient>` +
    `</defs>` +
    `<rect width="512" height="512" rx="107" fill="url(#g${id})"/>` +
    `<path fill="#FFFFFF" d="M73 395 L73 120 L150 120 L256 230 L362 120 L430 120 L320 235 L256 300 L150 195 L150 395 Z"/>` +
    `<path fill="url(#b${id})" d="M362 120 L278 280 L345 280 L270 440 L438 242 L367 242 L426 120 Z"/>`;
  return svg;
}

/** Bestaetigung oder Hinweis als Blatt von unten. */
export function blatt(
  titel: string,
  inhalt: Kind[],
  knoepfe: Array<{ text: string; art?: 'haupt' | 'zweit' | 'gefahr'; tun?: () => void }>,
): void {
  const schliessen = () => schatten.remove();
  const schatten = h('div', {
    class: 'schatten',
    onclick: (ev: MouseEvent) => {
      if (ev.target === schatten) schliessen();
    },
  });
  const reihe = h(
    'div',
    { class: 'knopf-reihe' },
    ...knoepfe.map((k) =>
      h('button', {
        class: 'knopf' + (k.art === 'zweit' ? ' zweit' : k.art === 'gefahr' ? ' gefahr' : ''),
        type: 'button',
        text: k.text,
        onclick: () => {
          schliessen();
          k.tun?.();
        },
      }),
    ),
  );
  schatten.append(h('div', { class: 'blatt' }, h('h2', { text: titel }), ...inhalt, reihe));
  document.body.append(schatten);
}

export function melden(titel: string, text: string): void {
  blatt(titel, [h('p', { class: 'hinweis', text, style: 'padding:0' })], [{ text: 'Verstanden' }]);
}

/**
 * Langes Druecken auf einer Kachel. Loest **kein** Kontextmenue und keine
 * Textauswahl aus — sonst waere die Geste am Handy unbrauchbar.
 */
export function langDruck(knopf: HTMLElement, dauer: number, tun: () => void): void {
  let uhr: number | undefined;
  const start = () => {
    knopf.dataset.lang = '';
    uhr = window.setTimeout(() => {
      knopf.dataset.lang = 'ja';
      tun();
    }, dauer);
  };
  const ende = () => window.clearTimeout(uhr);
  knopf.addEventListener('pointerdown', start);
  knopf.addEventListener('pointerup', ende);
  knopf.addEventListener('pointerleave', ende);
  knopf.addEventListener('pointercancel', ende);
  knopf.addEventListener('contextmenu', (ev) => ev.preventDefault());
}
