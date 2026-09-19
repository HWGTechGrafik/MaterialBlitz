import { einstellungenLesen, einstellungenSchreiben } from '../db';
import { EINHEITEN_STANDARD } from '../model';
import { neu, zustand } from '../store';
import { blatt, h, melden } from '../ui';
import { datum } from '../lib/format';
import { erzeugen, formatieren, pruefen } from '../lib/lizenz';
import { teilen } from '../lib/share';
import { sicherungPacken } from '../lib/transfer';

export async function einstellungenView(): Promise<HTMLElement[]> {
  const e = await einstellungenLesen();
  zustand.einstellungen = e;

  const kopf = h('div', { class: 'kopf' },
    h('div', { class: 'kopf-text' },
      h('div', { class: 'eyebrow', text: 'MaterialBlitz' }),
      h('h1', { text: 'Einstellungen' }),
    ),
  );

  const feld = (beschriftung: string, wert: string, platzhalter: string) => {
    const eingabe = h('input', { type: 'text', value: wert, placeholder: platzhalter });
    return { eingabe, knoten: h('label', { class: 'feld' }, h('span', { text: beschriftung }), eingabe) };
  };

  const name = feld('Firmenname', e.firma.name, 'Elektro Muster GmbH');
  const strasse = feld('Straße', e.firma.strasse, 'Gewerbepark 12');
  const ort = feld('PLZ und Ort', e.firma.ort, '4020 Linz');
  const telefon = feld('Telefon', e.firma.telefon, '+43 732 123456');

  const speichern = async () => {
    zustand.einstellungen = await einstellungenSchreiben({
      firma: {
        name: name.eingabe.value.trim(),
        strasse: strasse.eingabe.value.trim(),
        ort: ort.eingabe.value.trim(),
        telefon: telefon.eingabe.value.trim(),
      },
    });
    melden('Gespeichert', 'Der Firmenkopf erscheint ab sofort auf jedem PDF.');
  };

  const rumpf = h('div', { class: 'rumpf' },
    h('div', { class: 'polster' },

      h('div', { class: 'karte' },
        h('h2', { text: 'Firmenkopf' }),
        h('p', { text: 'Steht oben auf jedem PDF, das ins Büro geht.' }),
        name.knoten, strasse.knoten, ort.knoten, telefon.knoten,
        h('button', { class: 'knopf', type: 'button', text: 'Speichern', onclick: speichern }),
      ),

      await sicherungKarte(),
      einheitenKarte(e.einheiten),
      lizenzKarte(e.lizenz),
    ),
  );

  return [kopf, rumpf];
}

// ------------------------------------------------------------- Sicherung

async function sicherungKarte(): Promise<HTMLElement> {
  const e = await einstellungenLesen();
  return h('div', { class: 'karte' },
    h('h2', { text: 'Sicherung' }),
    h('p', {
      text: 'Enthält alles: Katalog, Kunden, Baustellen, Firmenkopf und die Historie. Dieselbe Datei richtet auch ein neues Handy ein.',
    }),
    h('div', { class: 'paar' },
      h('span', { class: 'k', text: 'Zuletzt gesichert' }),
      h('span', { class: 'v', text: e.letzteSicherung ? datum(e.letzteSicherung) : 'noch nie' }),
    ),
    h('div', { class: 'paar' },
      h('span', { class: 'k', text: 'Neue Artikel seither' }),
      h('span', { class: 'v', text: String(e.neueArtikel) }),
    ),
    h('button', {
      class: 'knopf', type: 'button', text: 'Sicherung erstellen', style: 'margin-top:10px',
      onclick: async () => {
        const datei = await sicherungPacken();
        const ergebnis = await teilen([datei]);
        if (ergebnis !== 'geteilt') return;
        zustand.einstellungen = await einstellungenSchreiben({ letzteSicherung: Date.now(), neueArtikel: 0 });
        neu();
      },
    }),
    h('p', { style: 'margin-top:8px',
      text: 'Einlesen geht über „Datei einlesen" in der Baustellen-Übersicht — dort, wo auch übergebene Scheine ankommen.' }),
  );
}

// -------------------------------------------------------------- Einheiten

function einheitenKarte(einheiten: string[]): HTMLElement {
  const liste = h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px' });
  for (const u of einheiten) {
    const fest = EINHEITEN_STANDARD.includes(u);
    liste.append(
      h('button', {
        type: 'button',
        class: 'knopf leise',
        style: 'flex:0 0 auto;padding:0 12px;min-height:38px;border:1px solid var(--line);border-radius:100px'
          + (fest ? ';color:var(--ink-muted)' : ''),
        text: fest ? u : `${u} ✕`,
        onclick: async () => {
          if (fest) {
            melden('Feste Einheit', `„${u}" gehört zur Grundausstattung und lässt sich nicht entfernen.`);
            return;
          }
          const e = await einstellungenLesen();
          zustand.einstellungen = await einstellungenSchreiben({
            einheiten: e.einheiten.filter((x) => x !== u),
          });
          neu();
        },
      }),
    );
  }

  return h('div', { class: 'karte' },
    h('h2', { text: 'Einheiten' }),
    h('p', { text: 'Die festen lassen sich nicht entfernen, eigene schon — antippen.' }),
    liste,
    h('button', {
      class: 'knopf zweit', type: 'button', text: 'Einheit hinzufügen',
      onclick: () => {
        const eingabe = h('input', { type: 'text', placeholder: 'z.B. Bund' });
        blatt('Neue Einheit', [h('label', { class: 'feld' }, eingabe)], [
          { text: 'Abbrechen', art: 'zweit' },
          {
            text: 'Hinzufügen',
            tun: async () => {
              const u = eingabe.value.trim();
              if (!u) return;
              const e = await einstellungenLesen();
              if (e.einheiten.includes(u)) return;
              zustand.einstellungen = await einstellungenSchreiben({ einheiten: [...e.einheiten, u] });
              neu();
            },
          },
        ]);
        setTimeout(() => eingabe.focus(), 50);
      },
    }),
  );
}

// ---------------------------------------------------------------- Lizenz

function lizenzKarte(lizenz?: string): HTMLElement {
  if (lizenz) {
    return h('div', { class: 'karte' },
      h('h2', { text: 'Lizenz' }),
      h('div', { class: 'paar' },
        h('span', { class: 'k', text: 'Status' }),
        h('span', { class: 'v', style: 'color:var(--blitz)', text: 'Freigeschaltet' }),
      ),
      h('div', { class: 'paar' },
        h('span', { class: 'k', text: 'Schlüssel' }),
        h('span', { class: 'v', text: lizenz }),
      ),
      h('button', {
        class: 'knopf gefahr', type: 'button', text: 'Lizenz von diesem Gerät entfernen',
        onclick: async () => {
          zustand.einstellungen = await einstellungenSchreiben({ lizenz: undefined });
          neu();
        },
      }),
      h('button', {
        class: 'knopf leise', type: 'button', text: 'Schlüssel für einen Kollegen erzeugen',
        onclick: schluesselErzeugen,
      }),
    );
  }

  const eingabe = h('input', { class: 'gross', type: 'text', placeholder: 'MB-XXXX-XXXX-XXXX', autocomplete: 'off', spellcheck: 'false' });
  const meldung = h('div', { class: 'meldung' });
  const knopf = h('button', { class: 'knopf', type: 'button', text: 'Freischalten', disabled: true });

  eingabe.addEventListener('input', () => {
    eingabe.value = formatieren(eingabe.value);
    eingabe.classList.remove('falsch');
    meldung.textContent = '';
    meldung.className = 'meldung';
    knopf.disabled = eingabe.value.replace(/[^A-Z0-9]/g, '').length < 14;
  });

  knopf.onclick = async () => {
    if (!pruefen(eingabe.value)) {
      eingabe.classList.add('falsch');
      meldung.textContent = 'Dieser Schlüssel stimmt nicht. Bitte Zeichen prüfen.';
      meldung.className = 'meldung fehler';
      return;
    }
    zustand.einstellungen = await einstellungenSchreiben({ lizenz: eingabe.value });
    neu();
  };

  return h('div', { class: 'karte' },
    h('h2', { text: 'Lizenz' }),
    h('p', { text: 'Ohne Schlüssel kannst du Material erfassen, aber nicht ans Büro senden oder übergeben.' }),
    h('label', { class: 'feld' }, h('span', { text: 'Lizenzschlüssel' }), eingabe),
    meldung,
    knopf,
    h('p', { style: 'margin-top:8px', text: 'Den Schlüssel bekommst du von deinem Betrieb.' }),
  );
}

function schluesselErzeugen(): void {
  const wer = h('input', { type: 'text', placeholder: 'Für wen? z.B. Andreas H.' });
  const ausgabe = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  blatt(
    'Schlüssel ausgeben',
    [
      h('p', { class: 'hinweis', style: 'padding:0',
        text: 'Der Name dient nur deiner eigenen Liste — im Schlüssel steckt er nicht.' }),
      h('label', { class: 'feld' }, wer),
      h('button', {
        class: 'knopf zweit', type: 'button', text: 'Erzeugen',
        onclick: () => {
          const k = erzeugen();
          ausgabe.prepend(
            h('div', { class: 'paar' },
              h('span', { class: 'v', style: 'font-weight:700', text: k }),
              h('span', { class: 'k', text: wer.value.trim() || 'ohne Namen' }),
            ),
          );
          wer.value = '';
        },
      }),
      ausgabe,
    ],
    [{ text: 'Schließen', art: 'zweit' }],
  );
}
