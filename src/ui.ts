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

export type NeuArt = 'projekt' | 'artikel';

/**
 * Umschalter Projekt | Artikel oben im Anlege-Blatt (Dashboard und Archiv).
 * Die andere Seite schliesst das Blatt und uebergibt an `wechseln`, das das
 * passende Formular oeffnet.
 */
export function umschalter(aktiv: NeuArt, wechseln: (art: NeuArt) => void): HTMLElement {
  const wahl = (art: NeuArt, text: string) =>
    h('button', {
      type: 'button', text, 'aria-pressed': String(art === aktiv),
      onclick: () => {
        if (art === aktiv) return;
        document.querySelector('.schatten')?.remove();
        wechseln(art);
      },
    });
  return h('div', { class: 'umschalter', role: 'group', 'aria-label': 'Was anlegen' },
    wahl('projekt', 'Projekt'), wahl('artikel', 'Artikel'));
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

// ------------------------------------------------------------- Sinnbilder

/**
 * Strichzeichnungen fuer die Knoepfe im Kopf. Einfarbig und ohne Fuellung —
 * sie erben die Schriftfarbe und stimmen damit auch im dunklen Modus.
 */
const IKONEN = {
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  einlesen:
    '<path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/><path d="M12 3v11"/><path d="M8 10l4 4 4-4"/>',
  senden:
    '<path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/><path d="M12 14V3"/><path d="M8 7l4-4 4 4"/>',
  mehr:
    '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/>' +
    '<circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>' +
    '<circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  liste: '<path d="M5 7h14"/><path d="M5 12h14"/><path d="M5 17h9"/>',
  lupe: '<circle cx="10.6" cy="10.6" r="6.4"/><path d="m15.4 15.4 4.2 4.2"/>',
  haus: '<path d="M4 20V8l8-4.5 8 4.5v12"/><path d="M3 20h18"/><path d="M10 20v-6h4v6"/>',
  // Vier Felder: das Dashboard zeigt, was es zu tun gibt, nicht einen Ort.
  raster:
    '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/>' +
    '<rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  // Striche wie auf einem Etikett: fuer den Etikettendruck im Katalog.
  strichcode:
    '<path d="M4 6v12"/><path d="M7.5 6v12"/><path d="M10.5 6v12"/><path d="M14.5 6v12"/>' +
    '<path d="M17 6v12"/><path d="M20 6v12"/>',
  regler:
    '<path d="M4 8h9"/><circle cx="16" cy="8" r="2.3"/><path d="M18.3 8H20"/>' +
    '<path d="M4 16h2.5"/><circle cx="9" cy="16" r="2.3"/><path d="M11.3 16H20"/>',
} as const;

export type IkonName = keyof typeof IKONEN;

export function ikon(name: IkonName): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ikon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = IKONEN[name];
  return svg;
}

/**
 * Knopf mit Sinnbild rechts oben im Kopf. Er traegt keine Beschriftung,
 * deshalb immer aria-label **und** title: wer unsicher ist, haelt den Finger
 * drauf und liest nach.
 */
export function kopfKnopf(o: {
  ikon: IkonName;
  titel: string;
  tun: () => void;
  art?: 'haupt' | 'aktiv';
  gesperrt?: boolean;
}): HTMLButtonElement {
  return h(
    'button',
    {
      class: 'kopf-tat' + (o.art === 'haupt' ? ' haupt' : ''),
      type: 'button',
      'aria-label': o.titel,
      title: o.titel,
      'aria-current': o.art === 'aktiv' ? 'true' : undefined,
      disabled: o.gesperrt,
      onclick: o.tun,
    },
    ikon(o.ikon),
  );
}

/** Die Knopfgruppe rechts oben, bei Bedarf mit dem Zaehler darueber. */
export function kopfRechts(zaehler: Kind, ...knoepfe: Kind[]): HTMLElement {
  return h('div', { class: 'kopf-rechts' }, zaehler, h('div', { class: 'kopf-taten' }, ...knoepfe));
}
