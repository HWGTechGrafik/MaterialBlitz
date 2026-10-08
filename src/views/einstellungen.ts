import { db, einstellungenLesen, einstellungenSchreiben } from '../db';
import { EINHEITEN_STANDARD, type Ausweis } from '../model';
import { neu, zustand } from '../store';
import { blatt, h, melden } from '../ui';
import { datum, zeit } from '../lib/format';
import { datumText, pruefen, saeubern } from '../lib/lizenz';
import { fassungsZeile } from '../lib/fassung';

import { dateiWaehlen, teilen } from '../lib/share';
import { AM_PC, NICHT_MOEGLICH } from '../lib/geraet';
import { archivPacken, sicherungPacken } from '../lib/transfer';
import * as dropbox from '../lib/dropbox';
import * as abgleich from '../lib/abgleich';

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

  // Traegt die Lizenz eine Firma, steht sie hier fest: sie haengt am
  // Schluessel, nicht an diesem Geraet.
  const lizenzFirma = zustand.lizenz?.firma;
  const name = feld('Firmenname', lizenzFirma ?? e.firma.name, 'Elektro Muster GmbH');
  if (lizenzFirma) {
    name.eingabe.disabled = true;
    name.knoten.append(h('small', { class: 'feld-hinweis', text: 'Kommt aus der Lizenz und lässt sich nicht ändern.' }));
  }
  const strasse = feld('Straße', e.firma.strasse, 'Gewerbepark 12');
  const ort = feld('PLZ und Ort', e.firma.ort, '4020 Linz');
  const telefon = feld('Telefon', e.firma.telefon, '+43 732 123456');

  const speichern = async () => {
    zustand.einstellungen = await einstellungenSchreiben({
      firma: {
        name: lizenzFirma ? e.firma.name : name.eingabe.value.trim(),
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
        ? AM_PC
          ? 'Beim Senden liegt die Adresse in der Zwischenablage: in der Mail ins An-Feld klicken, Strg+V.'
          : 'Beim Senden liegt die Adresse in der Zwischenablage: in der Mail auf das An-Feld tippen, lange drücken, einsetzen.'
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
        h('p', { text: AM_PC
          ? 'Am PC legt die App CSV und PDF im Download-Ordner ab; von dort kommen sie als Anhang in die Mail. Die Adresse liegt beim Senden in der Zwischenablage und ist im An-Feld nur noch einzufügen.'
          : 'Der Teilen-Dialog des Handys kennt kein Empfängerfeld — Anhänge und Adressfelder schließen einander aus. Darum legt die App die Adresse beim Senden in die Zwischenablage; in der Mail ist sie dann nur noch ins An-Feld einzusetzen. Ab der zweiten Mail schlägt das Handy sie ohnehin selbst vor.' }),
        buero.knoten,
        h('button', { class: 'knopf', type: 'button', text: 'Speichern', onclick: bueroSpeichern }),
      ),

      dropboxKarte(),
      await sicherungKarte(),
      archivKarte(),
      einheitenKarte(e.einheiten),
      await katalogLeerenKarte(),
      lizenzKarte(e.ausweis ?? 'beides'),

      // Ganz unten und leise: Man sucht sie nur, wenn man wissen will, ob
      // ein Update angekommen ist — und dann findet man sie dort.
      h('p', { class: 'fassung', text: fassungsZeile() }),
    ),
  );

  return [kopf, rumpf];
}

// --------------------------------------------------------------- Dropbox

/**
 * Wie bei BzzOps: verbinden, danach laeuft alles von selbst. Die Karte fehlt
 * ganz, solange die App ohne Dropbox-App-Key gebaut ist.
 */
function dropboxKarte(): HTMLElement | null {
  if (!dropbox.eingerichtet()) return null;
  const geraete = AM_PC ? 'Büro-PC und Handy' : 'Handy und Büro-PC';

  if (!dropbox.verbunden()) {
    return h('div', { class: 'karte' },
      h('h2', { text: 'Dropbox-Abgleich' }),
      h('p', { text: `Damit ${geraete} dieselben Daten haben: Projekte, Scheine, Archiv und Kunden. Alle Geräte mit derselben Dropbox und derselben Lizenz gleichen automatisch miteinander ab.` }),
      h('p', { text: 'MaterialBlitz sieht dabei nur den eigenen Ordner (Dropbox › Apps › MaterialBlitz App), nicht den Rest der Dropbox.' }),
      h('button', {
        class: 'knopf', type: 'button', text: 'Mit Dropbox verbinden …', style: 'margin-top:10px',
        onclick: () => void abgleich.verbinden(),
      }),
    );
  }

  const konto = dropbox.konto();
  const zuletzt = abgleich.zuletzt();
  return h('div', { class: 'karte' },
    h('h2', { text: 'Dropbox-Abgleich' }),
    h('div', { class: 'paar' },
      h('span', { class: 'k', text: 'Verbunden mit' }),
      h('span', { class: 'v', style: 'color:var(--blitz)', text: konto ?? 'Dropbox' }),
    ),
    h('div', { class: 'paar' },
      h('span', { class: 'k', text: 'Zuletzt abgeglichen' }),
      h('span', { class: 'v', text: zuletzt ? `${datum(zuletzt)}, ${zeit(zuletzt)}` : '—' }),
    ),
    h('p', { style: 'margin-top:8px',
      text: 'Jede Änderung wird automatisch in die Dropbox geschrieben. Beim Start und beim Zurückkehren in die App werden neuere Daten anderer Geräte angeboten.' }),
    h('div', { class: 'knopf-reihe', style: 'margin-top:10px' },
      h('button', {
        class: 'knopf', type: 'button',
        text: abgleich.status.arbeitet ? 'Gleicht ab …' : 'Jetzt abgleichen',
        disabled: abgleich.status.arbeitet,
        onclick: () => void abgleich.abgleichen(),
      }),
      h('button', {
        class: 'knopf gefahr', type: 'button', text: 'Trennen',
        onclick: () => blatt(
          'Dropbox trennen?',
          [h('p', { class: 'hinweis', style: 'padding:0',
            text: `Nur ${AM_PC ? 'dieser Rechner' : 'dieses Gerät'} wird abgemeldet. Die Daten hier und die Sync-Datei in der Dropbox bleiben.` })],
          [
            { text: 'Abbrechen', art: 'zweit' },
            { text: 'Trennen', art: 'gefahr', tun: () => void abgleich.trennen() },
          ],
        ),
      }),
    ),
  );
}

// ------------------------------------------------------------- Sicherung

async function sicherungKarte(): Promise<HTMLElement> {
  const e = await einstellungenLesen();
  return h('div', { class: 'karte' },
    h('h2', { text: 'Sicherung' }),
    h('p', {
      text: `Enthält alles: Archiv, Kunden, Projekte, Firmenkopf und die Historie. Dieselbe Datei richtet auch ${AM_PC ? 'einen neuen Rechner' : 'ein neues Handy'} ein.`,
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
        if (AM_PC) {
          melden('Gesichert', 'Die Sicherung liegt im Download-Ordner. Am besten auf einen USB-Stick oder ein Netzlaufwerk kopieren – fällt der Rechner aus, ist sie sonst mit weg.');
        }
      },
    }),
    h('p', { style: 'margin-top:8px',
      text: 'Einlesen geht über „Datei einlesen" in der Projekt-Übersicht — dort, wo auch übergebene Scheine ankommen.' }),
  );
}

// -------------------------------------------------------- Archiv weitergeben

/**
 * Nur das Archiv an ein anderes Geraet: am PC gepflegt und Etiketten
 * gedruckt, dann aufs Handy - oder auf der Baustelle Angelegtes zurueck.
 * Anders als die Sicherung ohne Projekte und Scheine, damit beim Empfaenger
 * keine fremden Projekte auftauchen.
 */
function archivKarte(): HTMLElement {
  return h('div', { class: 'karte' },
    h('h2', { text: 'Archiv weitergeben' }),
    h('p', {
      text: `Nur das Archiv – Artikel mit Einheit und Codes, ohne Projekte. ${AM_PC ? 'Am Handy' : 'Am anderen Gerät'} über „Datei einlesen" im Dashboard übernehmen: Neue Artikel kommen dazu, gleichnamige übernehmen Einheit und Codes, gelöscht wird nichts.`,
    }),
    h('button', {
      class: 'knopf zweit', type: 'button', text: 'Archiv weitergeben', style: 'margin-top:10px',
      onclick: async () => {
        if (!(await db.artikel.count())) {
          melden('Archiv leer', 'Im Archiv steht noch kein Artikel.');
          return;
        }
        const e = await einstellungenLesen();
        const ergebnis = await teilen([await archivPacken(e.firma.name || undefined)]);
        if (ergebnis === 'nicht-moeglich') melden(...NICHT_MOEGLICH);
        if (ergebnis === 'geteilt' && AM_PC) {
          melden('Gespeichert', 'Die Datei liegt im Download-Ordner. Ans Handy schicken (Mail, WhatsApp …) und dort über „Datei einlesen" im Dashboard übernehmen.');
        }
      },
    }),
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
    h('p', { text: `Die festen lassen sich nicht entfernen, eigene schon — ${AM_PC ? 'anklicken' : 'antippen'}.` }),
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

// --------------------------------------------------------- Katalog leeren

/**
 * Den ganzen Katalog loeschen - etwa wenn ein Grundstock fuer das falsche
 * Gewerk eingelesen wurde. Drei Schritte, und der letzte verlangt die Anzahl
 * der Artikel als Eingabe: zwei Blaetter lassen sich blind durchtippen, weil
 * der Knopf des naechsten dort erscheint, wo der Finger gerade war. Die Zahl
 * zwingt zum Hinsehen und geht mit dem Ziffernblock auch mit Handschuhen.
 */
async function katalogLeerenKarte(): Promise<HTMLElement> {
  const anzahl = await db.artikel.count();
  const karte = h('div', { class: 'karte' },
    h('h2', { text: 'Archiv leeren' }),
    h('p', { text: anzahl
      ? `Löscht alle ${anzahl} Artikel des Archivs samt ihrer Codes. Projekte und Scheine bleiben, wie sie sind.`
      : 'Das Archiv ist leer.' }),
  );
  if (!anzahl) return karte;

  const schritt3 = () => {
    const eingabe = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', placeholder: String(anzahl) });
    blatt('Letzte Bestätigung', [
      h('p', { class: 'hinweis', style: 'padding:0', text: `Zum Löschen die Anzahl der Artikel eintippen: ${anzahl}` }),
      h('label', { class: 'feld' }, eingabe),
    ], [
      { text: 'Abbrechen', art: 'zweit' },
      {
        text: 'Archiv löschen',
        art: 'gefahr',
        tun: async () => {
          if (eingabe.value.trim() !== String(anzahl)) {
            melden('Nicht gelöscht', 'Die Zahl stimmte nicht. Das Archiv ist unverändert.');
            return;
          }
          await db.artikel.clear();
          // clear() laeuft an den Datenbank-Haken vorbei.
          abgleich.geaendert();
          // Nichts Neues mehr, das in die naechste Sicherung gehoert.
          zustand.einstellungen = await einstellungenSchreiben({ neueArtikel: 0 });
          neu();
          melden('Archiv geleert', `${anzahl} Artikel gelöscht. Selbst angelegte Einheiten bleiben – sie lassen sich oben unter „Einheiten“ entfernen.`);
        },
      },
    ]);
    setTimeout(() => eingabe.focus(), 50);
  };

  const schritt2 = () => {
    blatt('Wirklich alles löschen?', [
      h('p', { class: 'hinweis', style: 'padding:0',
        text: 'Das lässt sich nicht rückgängig machen – außer mit einer Sicherung von vorher. Etiketten mit Codes erkennt die App danach nicht mehr.' }),
    ], [
      { text: 'Abbrechen', art: 'zweit' },
      { text: 'Ja, weiter', art: 'gefahr', tun: schritt3 },
    ]);
  };

  const schritt1 = async () => {
    const mitCode = await db.artikel.filter((a) => !!a.codes?.length).count();
    const e = await einstellungenLesen();
    blatt('Archiv leeren?', [
      h('div', { class: 'karte' },
        h('div', { class: 'paar' }, h('span', { class: 'k', text: 'Artikel' }), h('span', { class: 'v', text: String(anzahl) })),
        h('div', { class: 'paar' }, h('span', { class: 'k', text: 'davon mit Code' }), h('span', { class: 'v', text: String(mitCode) })),
        h('div', { class: 'paar' }, h('span', { class: 'k', text: 'Zuletzt gesichert' }),
          h('span', { class: 'v', text: e.letzteSicherung ? datum(e.letzteSicherung) : 'noch nie' })),
      ),
      h('div', { class: 'merk warnung' },
        h('span', { text: '⚠️' }),
        h('span', { text: 'Projekte und Scheine bleiben – was dort steht, ist eine Abschrift. Vorher eine Sicherung erstellen, dann lässt sich das Archiv zurückholen.' }),
      ),
    ], [
      { text: 'Abbrechen', art: 'zweit' },
      { text: 'Weiter', art: 'gefahr', tun: schritt2 },
    ]);
  };

  karte.append(h('button', { class: 'knopf gefahr', type: 'button', text: 'Ganzes Archiv löschen…', onclick: () => void schritt1() }));
  return karte;
}

// ---------------------------------------------------------------- Lizenz

/**
 * Einen neuen Schluessel ueber den alten legen — etwa denselben mit
 * nachgetragener Firma. Anders als beim Entfernen ist die App dazwischen nie
 * gesperrt, und ein ungueltiger Schluessel aendert nichts: die bisherige
 * Lizenz bleibt dann einfach stehen.
 */
function schluesselErfragen(): void {
  const eingabe = h('textarea', {
    class: 'schluessel', rows: '3', autocomplete: 'off', autocapitalize: 'off',
    placeholder: 'MBL1.…', 'aria-label': 'Neuer Lizenzschlüssel',
  });
  eingabe.spellcheck = false;
  blatt(
    'Neuen Schlüssel einsetzen',
    [
      h('p', { class: 'hinweis', style: 'padding:0',
        text: AM_PC
          ? 'Den neuen Schlüssel ins Feld einfügen (Strg+V). Die Daten bleiben, wie sie sind.'
          : 'Den neuen Schlüssel ins Feld einfügen (lange drücken, „Einsetzen"). Die Daten bleiben, wie sie sind.' }),
      h('label', { class: 'feld' }, eingabe),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      {
        text: 'Aus Datei…', art: 'zweit',
        tun: async () => {
          const text = await dateiWaehlen();
          if (text !== null) await schluesselEinsetzen(text);
        },
      },
      { text: 'Einsetzen', tun: () => void schluesselEinsetzen(eingabe.value) },
    ],
  );
}

async function schluesselEinsetzen(text: string): Promise<void> {
  if (!saeubern(text)) return;
  const ergebnis = await pruefen(text);
  if (!ergebnis.ok) {
    melden('Nicht übernommen', `${ergebnis.text} Die bisherige Lizenz bleibt.`);
    return;
  }
  zustand.einstellungen = await einstellungenSchreiben({ lizenz: saeubern(text) });
  zustand.lizenz = ergebnis.lizenz;
  neu();
  const { name, firma, nummer } = ergebnis.lizenz;
  melden('Lizenz eingesetzt', `Nr. ${nummer}, ausgestellt für ${[name, firma].filter(Boolean).join(', ')}.`);
}

/**
 * Hier ist immer eine gueltige Lizenz eingetragen — ohne kommt man gar nicht
 * so weit, der Sperrbildschirm steht davor.
 *
 * Gezeigt wird, **was im Schluessel steht**, nicht der Schluessel selbst: der
 * ist ueber 150 Zeichen lang und sagt niemandem etwas. Auf wen die Lizenz
 * ausgestellt ist, sagt dagegen genau das, was man wissen will.
 */
function lizenzKarte(ausweis: Ausweis): HTMLElement {
  const l = zustand.lizenz;

  // Die Wahl gibt es nur, wenn die Lizenz beides traegt — aeltere Schluessel
  // kennen nur den Namen.
  let wahl: HTMLElement | null = null;
  if (l?.name && l.firma) {
    const auswahl = h('select', { 'aria-label': 'Was auf Schein und Dashboard steht' },
      ...([
        ['beides', `Name und Firma — ${l.name}, ${l.firma}`],
        ['name', `nur Name — ${l.name}`],
        ['firma', `nur Firma — ${l.firma}`],
      ] as const).map(([wert, text]) =>
        h('option', { value: wert, text, selected: wert === ausweis })),
    );
    auswahl.onchange = async () => {
      zustand.einstellungen = await einstellungenSchreiben({ ausweis: auswahl.value as Ausweis });
      melden('Gespeichert', 'Gilt ab dem nächsten Schein, der ans Büro geht.');
    };
    wahl = h('label', { class: 'feld', style: 'margin-top:12px' },
      h('span', { text: 'Auf Schein und Dashboard steht' }), auswahl);
  }

  return h('div', { class: 'karte' },
    h('h2', { text: 'Lizenz' }),
    h('div', { class: 'paar' },
      h('span', { class: 'k', text: 'Ausgestellt für' }),
      h('span', { class: 'v', style: 'color:var(--blitz)', text: l?.name ?? l?.firma ?? '—' }),
    ),
    // Eine eigene Zeile nur, wenn beides drinsteht — sonst stuende dieselbe
    // Firma zweimal da.
    l?.name && l.firma
      ? h('div', { class: 'paar' },
        h('span', { class: 'k', text: 'Firma' }),
        h('span', { class: 'v', text: l.firma }),
      )
      : null,
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
    wahl,
    h('button', {
      class: 'knopf zweit', type: 'button', text: 'Neuen Schlüssel einsetzen',
      style: 'margin-bottom:8px',
      onclick: schluesselErfragen,
    }),
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
