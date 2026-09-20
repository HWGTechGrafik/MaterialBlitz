import { db, einstellungenLesen } from '../db';
import { neu } from '../store';
import { blatt, h, kopfKnopf, kopfRechts, melden } from '../ui';
import { baustelleAnlegen } from './uebersicht';

let reiter: 'katalog' | 'baustellen' = 'katalog';

export async function katalogView(): Promise<HTMLElement[]> {
  const imKatalog = reiter === 'katalog';

  // Welches Register offen ist, steht als Überschrift da — die Sinnbilder
  // brauchen daneben keine Beschriftung mehr, nur einen sichtbar aktiven Zustand.
  const kopf = h(
    'div',
    { class: 'kopf' },
    h('div', { class: 'kopf-text' },
      h('div', { class: 'eyebrow', text: 'Register' }),
      h('h1', { text: imKatalog ? 'Katalog' : 'Projekte' }),
    ),
    kopfRechts(
      null,
      kopfKnopf({
        ikon: 'liste', titel: 'Register Katalog', art: imKatalog ? 'aktiv' : undefined,
        tun: () => { reiter = 'katalog'; neu(); },
      }),
      kopfKnopf({
        ikon: 'haus', titel: 'Register Projekte', art: imKatalog ? undefined : 'aktiv',
        tun: () => { reiter = 'baustellen'; neu(); },
      }),
      kopfKnopf({
        ikon: 'plus', titel: imKatalog ? 'Artikel anlegen' : 'Neues Projekt', art: 'haupt',
        tun: () => { if (imKatalog) void artikelBearbeiten(); else baustelleAnlegen(false); },
      }),
    ),
  );

  const rumpf = h('div', { class: 'rumpf' });
  if (imKatalog) await katalogListe(rumpf);
  else await baustellenListe(rumpf);

  return [kopf, rumpf];
}

// ---------------------------------------------------------------- Katalog

async function katalogListe(rumpf: HTMLElement): Promise<void> {
  const artikel = (await db.artikel.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'de'));

  if (!artikel.length) {
    rumpf.append(h('div', { class: 'leer', text: 'Der Katalog wächst von selbst: was du in einem Projekt aufschreibst, steht danach hier.' }));
    return;
  }

  for (const a of artikel) {
    rumpf.append(
      h('button', { class: 'reihe', type: 'button', onclick: () => artikelBearbeiten(a.id) },
        h('div', {},
          h('div', { class: 'haupt', text: a.name }),
          h('div', { class: 'neben', text: `${a.einheit} · ${a.anzahl}× verwendet` }),
        ),
        h('span', { class: 'pfeil', html: '&rsaquo;' }),
      ),
    );
  }

  rumpf.append(
    h('div', { class: 'hinweis',
      text: 'Umbenennen und Löschen sind hier gefahrlos: Positionen auf bestehenden Scheinen sind Abschriften und ändern sich nicht mit.' }),
  );
}

async function artikelBearbeiten(id?: number): Promise<void> {
  const vorhanden = id ? await db.artikel.get(id) : undefined;
  const e = await einstellungenLesen();
  const name = h('input', { type: 'text', value: vorhanden?.name ?? '', placeholder: 'z.B. NYM-J 3x1,5' });
  const einheit = h('select', {},
    ...e.einheiten.map((u) => h('option', { value: u, text: u, selected: u === vorhanden?.einheit })),
  );

  blatt(
    vorhanden ? 'Artikel bearbeiten' : 'Neuer Artikel',
    [
      h('label', { class: 'feld' }, h('span', { text: 'Bezeichnung' }), name),
      h('label', { class: 'feld' }, h('span', { text: 'Einheit' }), einheit),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      ...(vorhanden
        ? [{
            text: 'Löschen', art: 'gefahr' as const,
            tun: async () => { await db.artikel.delete(vorhanden.id!); neu(); },
          }]
        : []),
      {
        text: 'Speichern',
        tun: async () => {
          const n = name.value.trim();
          if (!n) return;
          const doppelt = await db.artikel.where('name').equals(n).first();
          if (doppelt && doppelt.id !== vorhanden?.id) {
            melden('Gibt es schon', `„${n}" steht bereits im Katalog.`);
            return;
          }
          if (vorhanden) await db.artikel.update(vorhanden.id!, { name: n, einheit: einheit.value });
          else await db.artikel.add({ name: n, einheit: einheit.value, anzahl: 0 });
          neu();
        },
      },
    ],
  );
  setTimeout(() => name.focus(), 50);
}

// ------------------------------------------------------------- Baustellen

async function baustellenListe(rumpf: HTMLElement): Promise<void> {
  const [alle, kunden] = await Promise.all([db.baustellen.toArray(), db.kunden.toArray()]);
  const kundeVon = new Map(kunden.map((k) => [k.id!, k] as const));
  const sortiert = alle.filter((b) => !b.versteckt).sort((a, b) => b.zuletzt - a.zuletzt);

  if (!sortiert.length) {
    rumpf.append(h('div', { class: 'leer', text: 'Noch kein Projekt angelegt.' }));
    return;
  }

  for (const b of sortiert) {
    rumpf.append(
      h('button', { class: 'reihe', type: 'button', onclick: () => baustelleBearbeiten(b.id!) },
        h('div', {},
          h('div', { class: 'haupt', text: b.ort }),
          h('div', { class: 'neben',
            text: (b.kundeId ? kundeVon.get(b.kundeId)?.name ?? 'ohne Kunden' : 'ohne Kunden')
              + (b.abgeschlossen ? ' · abgeschlossen' : '') }),
        ),
        h('span', { class: 'pfeil', html: '&rsaquo;' }),
      ),
    );
  }
}

async function baustelleBearbeiten(id: number): Promise<void> {
  const b = await db.baustellen.get(id);
  if (!b) return;
  const kunde = b.kundeId ? await db.kunden.get(b.kundeId) : undefined;
  const scheine = await db.scheine.where('baustelleId').equals(id).count();

  const ort = h('input', { type: 'text', value: b.ort });
  const kundeFeld = h('input', { type: 'text', value: kunde?.name ?? '', placeholder: 'leer = ohne Kunden' });

  const knoepfe: Array<{ text: string; art?: 'haupt' | 'zweit' | 'gefahr'; tun?: () => void }> = [
    { text: 'Abbrechen', art: 'zweit' },
    {
      text: b.abgeschlossen ? 'Wieder öffnen' : 'Abschließen',
      art: 'zweit',
      tun: async () => { await db.baustellen.update(id, { abgeschlossen: !b.abgeschlossen }); neu(); },
    },
    {
      text: 'Speichern',
      tun: async () => {
        const o = ort.value.trim();
        if (!o) return;
        let kundeId: number | undefined;
        const kn = kundeFeld.value.trim();
        if (kn) {
          const da = await db.kunden.where('name').equals(kn).first();
          kundeId = da?.id ?? (await db.kunden.add({ name: kn }));
        }
        await db.baustellen.update(id, { ort: o, kundeId });
        neu();
      },
    },
  ];

  blatt(
    'Projekt',
    [
      h('label', { class: 'feld' }, h('span', { text: 'Ort' }), ort),
      h('label', { class: 'feld' }, h('span', { text: 'Kunde' }), kundeFeld),
      // Ausblenden statt Loeschen, sobald Historie daranhaengt: ein Schein
      // ohne Baustelle waere ein Zettel ohne Absender.
      scheine
        ? h('div', { class: 'merk' },
            h('span', { text: 'ℹ️' }),
            h('span', { text: `${scheine} Schein(e) hängen daran. Löschen ist deshalb nicht möglich — „Abschließen" nimmt das Projekt aus der Übersicht, die Historie bleibt.` }),
          )
        : h('button', {
            class: 'knopf gefahr', type: 'button', text: 'Projekt löschen',
            onclick: async () => {
              await db.baustellen.delete(id);
              document.querySelector('.schatten')?.remove();
              neu();
            },
          }),
    ],
    knoepfe,
  );
}
