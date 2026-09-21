import { einstellungenLesen, einstellungenSchreiben } from '../db';
import { EINHEITEN_STANDARD } from '../model';
import { neu, zustand } from '../store';
import { blatt, h, melden } from '../ui';
import { datum } from '../lib/format';
import { datumText } from '../lib/lizenz';
import { fassungsZeile } from '../lib/fassung';

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

  const buero = feld('Adresse des Büros', e.buero ?? '', 'buero@elektro-muster.at');
  buero.eingabe.type = 'email';
  buero.eingabe.autocapitalize = 'off';
  buero.eingabe.spellcheck = false;

  const bueroSpeichern = async () => {
    const adresse = buero.eingabe.value.trim();
    zustand.einstellungen = await einstellungenSchreiben({ buero: adresse || undefined });
    melden(
      'Gespeichert',
      adresse
        ? 'Beim Senden liegt die Adresse in der Zwischenablage: in der Mail auf das An-Feld tippen, lange drücken, einsetzen.'
        : 'Es wird keine Adresse mehr kopiert.',
    );
  };

  const rumpf = h('div', { class: 'rumpf' },
    h('div', { class: 'polster' },

      h('div', { class: 'karte' },
        h('h2', { text: 'Firmenkopf' }),
        h('p', { text: 'Steht oben auf jedem PDF, das ins Büro geht.' }),
        name.knoten, strasse.knoten, ort.knoten, telefon.knoten,
        h('button', { class: 'knopf', type: 'button', text: 'Speichern', onclick: speichern }),
      ),

      // Eigene Karte, nicht beim Firmenkopf: Die Adresse steht **nicht** auf
      // dem PDF, sie betrifft nur den Weg dorthin.
      h('div', { class: 'karte' },
        h('h2', { text: 'Ans Büro' }),
        h('p', { text: 'Der Teilen-Dialog des Handys kennt kein Empfängerfeld — Anhänge und Adressfelder schließen einander aus. Darum legt die App die Adresse beim Senden in die Zwischenablage; in der Mail ist sie dann nur noch ins An-Feld einzusetzen. Ab der zweiten Mail schlägt das Handy sie ohnehin selbst vor.' }),
        buero.knoten,
        h('button', { class: 'knopf', type: 'button', text: 'Speichern', onclick: bueroSpeichern }),
      ),

      await sicherungKarte(),
      einheitenKarte(e.einheiten),
      lizenzKarte(),

      // Ganz unten und leise: Man sucht sie nur, wenn man wissen will, ob
      // ein Update angekommen ist — und dann findet man sie dort.
      h('p', { class: 'fassung', text: fassungsZeile() }),
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
      text: 'Enthält alles: Katalog, Kunden, Projekte, Firmenkopf und die Historie. Dieselbe Datei richtet auch ein neues Handy ein.',
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
      text: 'Einlesen geht über „Datei einlesen" in der Projekt-Übersicht — dort, wo auch übergebene Scheine ankommen.' }),
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

/**
 * Hier ist immer eine gueltige Lizenz eingetragen — ohne kommt man gar nicht
 * so weit, der Sperrbildschirm steht davor.
 *
 * Gezeigt wird, **was im Schluessel steht**, nicht der Schluessel selbst: der
 * ist ueber 150 Zeichen lang und sagt niemandem etwas. Auf wen die Lizenz
 * ausgestellt ist, sagt dagegen genau das, was man wissen will.
 */
function lizenzKarte(): HTMLElement {
  const l = zustand.lizenz;
  return h('div', { class: 'karte' },
    h('h2', { text: 'Lizenz' }),
    h('div', { class: 'paar' },
      h('span', { class: 'k', text: 'Ausgestellt für' }),
      h('span', { class: 'v', style: 'color:var(--blitz)', text: l?.betrieb ?? '—' }),
    ),
    h('div', { class: 'paar' },
      h('span', { class: 'k', text: 'Lizenznummer' }),
      h('span', { class: 'v', text: l ? `Nr. ${l.nummer}` : '—' }),
    ),
    h('div', { class: 'paar' },
      h('span', { class: 'k', text: 'Ausgestellt am' }),
      h('span', { class: 'v', text: l ? datumText(l.ausgestellt) : '—' }),
    ),
    h('div', { class: 'paar' },
      h('span', { class: 'k', text: 'Laufzeit' }),
      h('span', { class: 'v', text: l?.laeuftAb ? `bis ${datumText(l.laeuftAb)}` : 'unbefristet' }),
    ),
    h('button', {
      class: 'knopf gefahr', type: 'button', text: 'Lizenz von diesem Gerät entfernen',
      onclick: () => {
        blatt(
          'Lizenz entfernen?',
          [h('p', { class: 'hinweis', style: 'padding:0',
            text: 'Danach ist die App gesperrt, bis wieder ein Schlüssel eingegeben wird. Deine Daten bleiben erhalten.' })],
          [
            { text: 'Abbrechen', art: 'zweit' },
            {
              text: 'Entfernen', art: 'gefahr',
              tun: async () => {
                zustand.einstellungen = await einstellungenSchreiben({ lizenz: undefined });
                zustand.lizenz = undefined;
                neu();
              },
            },
          ],
        );
      },
    }),
  );
}
