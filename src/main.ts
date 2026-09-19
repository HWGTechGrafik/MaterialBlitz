import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { einstellungenLesen } from './db';
import { freigeschaltet, gehe, neu, zeichnerSetzen, zustand, type Ansicht } from './store';
import { blatt, h } from './ui';
import { uebersicht } from './views/uebersicht';
import { katalogView } from './views/katalog';
import { einstellungenView } from './views/einstellungen';
import { scheinView, scheinZuruecksetzen } from './views/schein';
import { sperreView } from './views/sperre';

const wurzel = document.getElementById('app')!;

const REITER: Array<{ ansicht: Ansicht; zeichen: string; text: string }> = [
  { ansicht: 'uebersicht', zeichen: '🏗', text: 'Projekte' },
  { ansicht: 'katalog', zeichen: '📋', text: 'Katalog' },
  { ansicht: 'einstellungen', zeichen: '⚙', text: 'Einstellungen' },
];

function reiterleiste(): HTMLElement {
  return h(
    'nav',
    { class: 'reiter' },
    ...REITER.map((r) =>
      h(
        'button',
        {
          type: 'button',
          'aria-current': zustand.ansicht === r.ansicht ? 'page' : undefined,
          onclick: () => {
            if (r.ansicht === 'uebersicht') scheinZuruecksetzen();
            gehe(r.ansicht);
          },
        },
        h('span', { class: 'zeichen', text: r.zeichen }),
        h('span', { text: r.text }),
      ),
    ),
  );
}

let laeuft = false;
async function zeichnen(): Promise<void> {
  // Ein Neuaufbau nach dem anderen — sonst ueberholen sich zwei Datenbank-
  // abfragen und die Ansicht flackert.
  if (laeuft) return;
  laeuft = true;
  try {
    // Ohne gueltigen Schluessel kommt die App gar nicht erst hoch.
    const gesperrt = !freigeschaltet();

    const teile = gesperrt
      ? sperreView()
      : zustand.ansicht === 'schein'
        ? await scheinView()
        : zustand.ansicht === 'katalog'
          ? await katalogView()
          : zustand.ansicht === 'einstellungen'
            ? await einstellungenView()
            : await uebersicht();

    const schirm = h('div', { class: 'schirm' }, ...teile);
    // Im Schein zaehlt jeder Millimeter Hoehe: dort keine Reiterleiste,
    // der Pfeil oben links fuehrt zurueck. Im gesperrten Zustand ebenso wenig.
    if (!gesperrt && zustand.ansicht !== 'schein') schirm.append(reiterleiste());

    wurzel.replaceChildren(schirm);
  } finally {
    laeuft = false;
  }
}

zeichnerSetzen(() => {
  void zeichnen();
});

/**
 * Updates werden **angeboten**, nicht still eingespielt: automatisches
 * Neuladen verschluckt einen halb getippten Schein, und genau das darf auf
 * der Baustelle nicht passieren.
 */
const aktualisieren = registerSW({
  onNeedRefresh() {
    blatt(
      'Neue Version',
      [
        h('p', {
          class: 'hinweis',
          style: 'padding:0',
          text: 'Eine neuere Fassung von MaterialBlitz ist da. Beim Aktualisieren wird die App neu geladen — offene Eingaben sind vorher zu speichern.',
        }),
      ],
      [
        { text: 'Später', art: 'zweit' },
        { text: 'Jetzt aktualisieren', tun: () => void aktualisieren(true) },
      ],
    );
  },
});

async function start(): Promise<void> {
  zustand.einstellungen = await einstellungenLesen();
  neu();
}

void start();
