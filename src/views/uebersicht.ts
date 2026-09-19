import { db, einstellungenLesen, einstellungenSchreiben } from '../db';
import { SICHERUNG_ARTIKEL, SICHERUNG_TAGE, type Baustelle, type Kunde } from '../model';
import { gehe, neu, zustand } from '../store';
import { blatt, h, marke, melden } from '../ui';
import { tageSeit } from '../lib/format';
import { dateiWaehlen } from '../lib/share';
import { scheinUebernehmen, sicherungEinspielen, vorschau } from '../lib/transfer';

export async function uebersicht(): Promise<HTMLElement[]> {
  const [alle, kunden] = await Promise.all([db.baustellen.toArray(), db.kunden.toArray()]);
  const kundeVon = new Map(kunden.map((k) => [k.id!, k] as const));

  const offen = alle
    .filter((b) => !b.abgeschlossen && !b.versteckt)
    .sort((a, b) => b.zuletzt - a.zuletzt);

  const zahlen = new Map<number, number>();
  for (const b of offen) {
    const scheine = await db.scheine.where('baustelleId').equals(b.id!).toArray();
    const summe = scheine
      .filter((s) => s.zustand === 'offen')
      .reduce((n, s) => n + s.positionen.length, 0);
    zahlen.set(b.id!, summe);
  }

  const kopf = h(
    'div',
    { class: 'kopf' },
    marke(),
    h(
      'div',
      { class: 'kopf-text' },
      h('div', { class: 'eyebrow', text: 'MaterialBlitz' }),
      h('h1', { text: 'Baustellen' }),
    ),
  );

  const liste = h('div', { class: 'rumpf' });

  const erinnerung = await sicherungFaellig();
  if (erinnerung) liste.append(h('div', { class: 'polster' }, erinnerung));

  if (!offen.length) {
    liste.append(
      h('div', { class: 'leer', text: 'Noch keine Baustelle. Unten anlegen — danach tippst du sie nur noch an.' }),
    );
  }

  for (const b of offen) {
    const kunde = b.kundeId ? kundeVon.get(b.kundeId) : undefined;
    const anzahl = zahlen.get(b.id!) ?? 0;
    liste.append(
      h(
        'button',
        { class: 'reihe', type: 'button', onclick: () => gehe('schein', b.id!) },
        h(
          'div',
          {},
          h('div', { class: 'haupt', text: b.ort }),
          h('div', { class: 'neben', text: kunde?.name ?? 'ohne Kunden' }),
        ),
        h('span', {
          class: 'zaehler',
          text: anzahl ? `${anzahl} Pos.` : 'leer',
          style: anzahl ? '' : 'background:none;color:var(--ink-muted)',
        }),
      ),
    );
  }

  const fuss = h(
    'div',
    { class: 'fuss' },
    h(
      'div',
      { class: 'polster' },
      h('button', { class: 'knopf', type: 'button', text: 'Neue Baustelle', onclick: baustelleAnlegen }),
      // Der Import gehoert hierher, nicht in die Baustelle: wer einen Schein
      // empfaengt, hat die zugehoerige Baustelle meist noch gar nicht.
      h('button', { class: 'knopf leise', type: 'button', text: 'Datei einlesen', onclick: einlesen }),
    ),
  );

  return [kopf, liste, fuss];
}

async function sicherungFaellig(): Promise<HTMLElement | null> {
  const e = zustand.einstellungen ?? (await einstellungenLesen());
  const tage = e.letzteSicherung ? tageSeit(e.letzteSicherung) : Infinity;
  const wegenZeit = tage >= SICHERUNG_TAGE;
  const wegenMenge = e.neueArtikel >= SICHERUNG_ARTIKEL;
  if (!wegenZeit && !wegenMenge) return null;

  const grund = !e.letzteSicherung
    ? 'Noch nie gesichert.'
    : wegenZeit
      ? `Letzte Sicherung vor ${tage} Tagen.`
      : `${e.neueArtikel} neue Artikel seit der letzten Sicherung.`;

  // Ruhiger Hinweis statt Pop-up: ein Pop-up wird weggetippt, ohne gelesen zu
  // werden — und ist dann schlechter als keine Erinnerung.
  return h(
    'div',
    { class: 'merk' },
    h('span', { text: '💾' }),
    h(
      'span',
      {},
      h('b', { text: 'Sicherung fällig. ' }),
      `${grund} Das Handy sichert die App nicht von selbst — ohne Sicherung ist dein Katalog bei Geräteverlust weg.`,
      h('br'),
      h('button', {
        class: 'knopf leise',
        type: 'button',
        text: 'In den Einstellungen sichern',
        style: 'text-align:left;padding:0;min-height:32px',
        onclick: () => gehe('einstellungen'),
      }),
    ),
  );
}

function baustelleAnlegen(): void {
  const ort = h('input', { type: 'text', placeholder: 'z.B. Hauptstraße 5' });
  const kunde = h('input', { type: 'text', placeholder: 'leer lassen für Werkstatt o.ä.' });
  blatt(
    'Neue Baustelle',
    [
      h('label', { class: 'feld' }, h('span', { text: 'Ort' }), ort),
      h('label', { class: 'feld' }, h('span', { text: 'Kunde (optional)' }), kunde),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      {
        text: 'Anlegen',
        tun: async () => {
          const o = ort.value.trim();
          if (!o) return;
          let kundeId: number | undefined;
          const kn = kunde.value.trim();
          if (kn) {
            const da = await db.kunden.where('name').equals(kn).first();
            kundeId = da?.id ?? (await db.kunden.add({ name: kn }));
          }
          const id = await db.baustellen.add({ ort: o, kundeId, zuletzt: Date.now() });
          gehe('schein', id);
        },
      },
    ],
  );
  setTimeout(() => ort.focus(), 50);
}

/** Uebergabe und Sicherung kommen durch dieselbe Tuer. */
async function einlesen(): Promise<void> {
  const text = await dateiWaehlen();
  if (text === null) return;
  const v = vorschau(text);

  if (v.art === 'fehler') {
    melden('Das klappt nicht', v.text);
    return;
  }

  if (v.art === 'schein') {
    blatt(
      'Schein übernehmen?',
      [
        h('div', { class: 'karte' },
          zeile('Baustelle', v.ort),
          zeile('Positionen', String(v.positionen)),
          zeile('Von', v.absender),
          zeile('Erstellt', v.zeitpunkt),
        ),
        h('p', { class: 'hinweis', style: 'padding:0',
          text: 'Der Schein kommt als eigener offener Schein dazu und behält den Vermerk, von wem er stammt.' }),
      ],
      [
        { text: 'Abbrechen', art: 'zweit' },
        {
          text: 'Übernehmen',
          tun: async () => {
            await scheinUebernehmen(v.umschlag);
            neu();
          },
        },
      ],
    );
    return;
  }

  blatt(
    'Sicherung einspielen',
    [
      h('div', { class: 'karte' },
        zeile('Erstellt', v.zeitpunkt),
        zeile('Artikel', String(v.artikel)),
        zeile('Baustellen', String(v.baustellen)),
        zeile('Scheine', String(v.scheine)),
      ),
      h('div', { class: 'merk warnung' },
        h('span', { text: '⚠️' }),
        h('span', { html: '<b>Ersetzen löscht alles,</b> was jetzt auf diesem Gerät ist. Zusammenführen kann nichts vernichten.' }),
      ),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      {
        text: 'Ersetzen',
        art: 'gefahr',
        tun: async () => {
          await sicherungEinspielen(v.umschlag, 'ersetzen');
          zustand.einstellungen = await einstellungenLesen();
          neu();
        },
      },
      {
        text: 'Zusammenführen',
        tun: async () => {
          await sicherungEinspielen(v.umschlag, 'zusammenfuehren');
          zustand.einstellungen = await einstellungenSchreiben({});
          neu();
        },
      },
    ],
  );
}

function zeile(k: string, v: string): HTMLElement {
  return h('div', { class: 'paar' }, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v }));
}

export type { Baustelle, Kunde };
