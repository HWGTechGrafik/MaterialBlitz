import { artikelMitCode, db, einstellungenLesen } from '../db';
import { codeArt, codePruefen, eigenerCode, istEigenerCode } from '../lib/codes';
import { teilen } from '../lib/share';
import { neu } from '../store';
import { blatt, h, kopfKnopf, kopfRechts, melden, umschalter, wischbar, type NeuArt } from '../ui';
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
      h('h1', { text: imKatalog ? 'Archiv' : 'Projekte' }),
    ),
    kopfRechts(
      null,
      kopfKnopf({
        ikon: 'liste', titel: 'Register Archiv', art: imKatalog ? 'aktiv' : undefined,
        tun: () => { reiter = 'katalog'; neu(); },
      }),
      kopfKnopf({
        ikon: 'haus', titel: 'Register Projekte', art: imKatalog ? undefined : 'aktiv',
        tun: () => { reiter = 'baustellen'; neu(); },
      }),
      imKatalog
        ? kopfKnopf({ ikon: 'strichcode', titel: 'Etiketten drucken', tun: () => void etikettenDrucken() })
        : null,
      kopfKnopf({ ikon: 'plus', titel: 'Neu anlegen', art: 'haupt', tun: () => neuAnlegen() }),
    ),
  );

  const rumpf = h('div', { class: 'rumpf' });
  if (imKatalog) await katalogListe(rumpf);
  else await baustellenListe(rumpf);

  return [kopf, rumpf];
}

/**
 * Das Plus oeffnet gleich das Formular zum offenen Register; oben schaltet
 * ein Umschalter zwischen Projekt und Artikel um. Das Register wechselt mit,
 * damit das Neue danach gleich in der Liste steht.
 */
function neuAnlegen(art: NeuArt = reiter === 'katalog' ? 'artikel' : 'projekt'): void {
  const register = art === 'artikel' ? 'katalog' : 'baustellen';
  if (reiter !== register) { reiter = register; neu(); }
  if (art === 'artikel') void artikelBearbeiten(undefined, umschalter(art, neuAnlegen));
  else baustelleAnlegen(false, umschalter(art, neuAnlegen));
}

// ---------------------------------------------------------------- Katalog

async function katalogListe(rumpf: HTMLElement): Promise<void> {
  const artikel = (await db.artikel.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'de'));

  if (!artikel.length) {
    rumpf.append(h('div', { class: 'leer', text: 'Das Archiv wächst von selbst: was du in einem Projekt aufschreibst, steht danach hier.' }));
    return;
  }

  for (const a of artikel) {
    rumpf.append(
      h('button', { class: 'reihe', type: 'button', onclick: () => artikelBearbeiten(a.id) },
        h('div', {},
          h('div', { class: 'haupt', text: a.name }),
          h('div', { class: 'neben',
            text: `${a.einheit} · ${a.anzahl}× verwendet`
              + (a.codes?.length ? ` · ${a.codes.length === 1 ? '1 Code' : `${a.codes.length} Codes`}` : '') }),
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

export async function artikelBearbeiten(id?: number, oben?: HTMLElement): Promise<void> {
  const vorhanden = id ? await db.artikel.get(id) : undefined;
  const e = await einstellungenLesen();
  const name = h('input', { type: 'text', value: vorhanden?.name ?? '', placeholder: 'z.B. NYM-J 3x1,5' });
  const einheit = h('select', {},
    ...e.einheiten.map((u) => h('option', { value: u, text: u, selected: u === vorhanden?.einheit })),
  );

  // Codes werden erst mit "Speichern" geschrieben: "Abbrechen" soll wirklich
  // nichts veraendert haben.
  const codes = [...(vorhanden?.codes ?? [])];
  const liste = h('div', { class: 'codes' });
  const hinweis = h('div', { class: 'code-hinweis' });
  const codeFeld = h('input', {
    type: 'text', placeholder: 'Ziffern unter dem Strichcode', autocomplete: 'off',
    autocapitalize: 'characters', enterKeyHint: 'done',
  });
  codeFeld.spellcheck = false;
  const eigenerKnopf = h('button', {
    class: 'knopf leise', type: 'button', text: 'Eigenen Code vergeben',
    onclick: () => { codes.push(eigenerCode()); melde(''); zeichneCodes(); },
  });

  const melde = (text: string, falsch = false) => {
    hinweis.textContent = text;
    hinweis.classList.toggle('falsch', falsch);
  };
  const zeichneCodes = () => {
    liste.replaceChildren(
      ...codes.map((c) =>
        h('div', { class: 'code-zeile' },
          h('span', { class: 'code-wert', text: c }),
          h('span', { class: 'code-art', text: codeArt(c) }),
          h('button', {
            class: 'knopf leise', type: 'button', text: 'Lösen',
            onclick: () => { codes.splice(codes.indexOf(c), 1); melde(''); zeichneCodes(); },
          }),
        ),
      ),
    );
    // Ein eigener Code je Artikel genuegt - Etiketten tragen immer denselben.
    eigenerKnopf.hidden = codes.some(istEigenerCode);
  };

  /** Den getippten Code uebernehmen. Liefert false, wenn er nicht taugt. */
  const uebernehmen = async (): Promise<boolean> => {
    const p = codePruefen(codeFeld.value);
    if ('fehler' in p) { melde(p.fehler, true); return false; }
    codeFeld.value = '';
    if (codes.includes(p.code)) { melde('Dieser Code steht schon da.'); return true; }
    codes.push(p.code);
    zeichneCodes();
    const traeger = await artikelMitCode(p.code);
    melde(traeger && traeger.id !== vorhanden?.id
      ? `Gehörte bisher zu „${traeger.name}" – beim Speichern wird er dort gelöst.`
      : '');
    return true;
  };
  codeFeld.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); void uebernehmen(); }
  });
  zeichneCodes();

  /** Schreibt den Artikel und liefert seine Nummer — oder null, wenn nicht. */
  const speichern = async (): Promise<number | null> => {
    const n = name.value.trim();
    if (!n) return null;
    // Getippt, aber "Hinzufügen" vergessen: trotzdem mitnehmen.
    if (codeFeld.value.trim() && !(await uebernehmen())) {
      melden('Code nicht gespeichert', hinweis.textContent ?? '');
      return null;
    }
    const doppelt = await db.artikel.where('name').equals(n).first();
    if (doppelt && doppelt.id !== vorhanden?.id) {
      melden('Gibt es schon', `„${n}" steht bereits im Archiv.`);
      return null;
    }
    return db.transaction('rw', db.artikel, async () => {
      // Ein Code gehoert hoechstens einem Artikel: beim bisherigen loesen.
      for (const c of codes) {
        for (const a of await db.artikel.where('codes').equals(c).toArray()) {
          if (a.id !== vorhanden?.id) await db.artikel.update(a.id!, { codes: a.codes!.filter((x) => x !== c) });
        }
      }
      if (vorhanden) {
        await db.artikel.update(vorhanden.id!, { name: n, einheit: einheit.value, codes });
        return vorhanden.id!;
      }
      return (await db.artikel.add({ name: n, einheit: einheit.value, anzahl: 0, codes })) ?? null;
    });
  };

  blatt(
    vorhanden ? 'Artikel bearbeiten' : 'Neuer Artikel',
    [
      oben ?? null,
      h('label', { class: 'feld' }, h('span', { text: 'Bezeichnung' }), name),
      h('label', { class: 'feld' }, h('span', { text: 'Einheit' }), einheit),
      h('div', { class: 'feld' },
        h('span', { text: 'Strich- und QR-Codes' }),
        liste,
        h('div', { class: 'code-eingabe' },
          codeFeld,
          h('button', { class: 'knopf zweit', type: 'button', text: 'Hinzufügen', onclick: () => void uebernehmen() }),
        ),
        hinweis,
        h('div', { class: 'code-taten' },
          eigenerKnopf,
          h('button', {
            class: 'knopf leise', type: 'button', text: 'Etikett drucken…',
            onclick: async () => {
              const nr = await speichern();
              if (nr === null) return;
              document.querySelector('.schatten')?.remove();
              neu();
              await etikettenDrucken([nr]);
            },
          }),
        ),
      ),
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
        tun: async () => { if ((await speichern()) !== null) neu(); },
      },
    ],
  );
  if (!vorhanden) setTimeout(() => name.focus(), 50);
}

// -------------------------------------------------------------- Etiketten

/** Zuletzt gewaehlter Bogen - fuer die Dauer der Sitzung. */
let bogenWahl = 'z3474';

/**
 * Etiketten fuer Material ohne eigenen Code. Jedes Etikett traegt den
 * **eigenen** Code des Artikels; wer noch keinen hat, bekommt ihn hier.
 */
async function etikettenDrucken(vorauswahl: number[] = []): Promise<void> {
  const artikel = (await db.artikel.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  if (!artikel.length) {
    melden('Archiv leer', 'Etiketten gibt es für Artikel im Archiv – das ist noch leer.');
    return;
  }
  // Schon beim Oeffnen nachladen, nicht erst beim Erzeugen: am iPhone darf
  // zwischen Fingertipp und Teilen-Dialog nicht viel Zeit vergehen, sonst
  // verweigert Safari den Dialog.
  const { BOEGEN, etikettenPdf } = await import('../lib/etiketten');

  const zeilen = artikel.map((a) => {
    const an = h('input', { type: 'checkbox', checked: vorauswahl.includes(a.id!) });
    const art = h('select', { 'aria-label': `Codeart für ${a.name}` },
      h('option', { value: 'qr', text: 'QR' }),
      h('option', { value: 'strich', text: 'Strichcode' }),
    );
    return { a, an, art, el: h('label', { class: 'etikett-zeile' }, an, h('span', { class: 'nm', text: a.name }), art) };
  });
  const bogen = h('select', {},
    ...BOEGEN.map((b) => h('option', { value: b.id, text: b.titel, selected: b.id === bogenWahl })),
  );
  const erstes = h('input', { type: 'number', value: '1', min: '1', inputMode: 'numeric' });

  blatt(
    'Etiketten drucken',
    [
      h('p', { class: 'hinweis', style: 'padding:0',
        text: 'Für Material ohne eigenen Code. Das Etikett trägt den eigenen Code des Artikels – fehlt er, wird er jetzt vergeben.' }),
      h('div', { class: 'etiketten-liste' }, ...zeilen.map((z) => z.el)),
      h('label', { class: 'feld' }, h('span', { text: 'Papier' }), bogen),
      h('label', { class: 'feld' }, h('span', { text: 'Beginnen bei Etikett Nr. (angebrochener Bogen)' }), erstes),
    ],
    [
      { text: 'Abbrechen', art: 'zweit' },
      {
        text: 'PDF erzeugen',
        tun: async () => {
          const gewaehlt = zeilen.filter((z) => z.an.checked);
          if (!gewaehlt.length) {
            melden('Nichts gewählt', 'Bitte mindestens einen Artikel ankreuzen.');
            return;
          }
          bogenWahl = bogen.value;
          const etiketten = [];
          for (const z of gewaehlt) {
            let code = z.a.codes?.find(istEigenerCode);
            if (!code) {
              code = eigenerCode();
              await db.artikel.update(z.a.id!, { codes: [...(z.a.codes ?? []), code] });
            }
            etiketten.push({ name: z.a.name, einheit: z.a.einheit, code, art: z.art.value as 'qr' | 'strich' });
          }
          const b = BOEGEN.find((x) => x.id === bogen.value) ?? BOEGEN[0]!;
          const ergebnis = await teilen([etikettenPdf(etiketten, b, Number(erstes.value) || 1)]);
          if (ergebnis === 'nicht-moeglich') {
            melden('Teilen nicht möglich', 'Dieses Gerät bietet keinen Teilen-Dialog für Dateien an.');
          }
          neu();
        },
      },
    ],
  );
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
    rumpf.append(wischbar(
      h('button', { class: 'reihe', type: 'button', onclick: () => baustelleBearbeiten(b.id!) },
        h('div', {},
          h('div', { class: 'haupt', text: b.ort }),
          h('div', { class: 'neben',
            text: (b.kundeId ? kundeVon.get(b.kundeId)?.name ?? 'ohne Kunden' : 'ohne Kunden')
              + (b.abgeschlossen ? ' · abgeschlossen' : '') }),
        ),
        h('span', { class: 'pfeil', html: '&rsaquo;' }),
      ),
      { text: 'Löschen', tun: () => void projektLoeschen(b.id!) },
    ));
  }
}

async function baustelleBearbeiten(id: number): Promise<void> {
  const b = await db.baustellen.get(id);
  if (!b) return;
  const kunde = b.kundeId ? await db.kunden.get(b.kundeId) : undefined;

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
      h('button', {
        class: 'knopf gefahr', type: 'button', text: 'Projekt löschen…',
        onclick: () => {
          document.querySelector('.schatten')?.remove();
          void projektLoeschen(id, () => void baustelleBearbeiten(id));
        },
      }),
    ],
    knoepfe,
  );
}

/**
 * Rueckfrage vor dem Loeschen eines Projekts - aus dem Projekt-Blatt und vom
 * Wischen in den Listen. Ein Handschuh trifft den roten Knopf leicht aus
 * Versehen: eine zufaellige Zahl zum Abtippen zwingt zum Hinsehen und geht mit
 * dem Ziffernblock auch mit Handschuhen. Die Scheine gehen mit - die Rueckfrage
 * nennt deshalb, wie viele Positionen verloren gehen. `zurueck` fuehrt beim
 * Abbrechen dorthin, woher man kam.
 */
export async function projektLoeschen(id: number, zurueck?: () => void): Promise<void> {
  const b = await db.baustellen.get(id);
  if (!b) return;
  const kunde = b.kundeId ? await db.kunden.get(b.kundeId) : undefined;
  const scheine = await db.scheine.where('baustelleId').equals(id).toArray();
  const positionen = scheine.reduce((n, s) => n + s.positionen.length, 0);

  const zahl = String(100 + Math.floor(Math.random() * 900));
  const eingabe = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', placeholder: zahl });
  blatt(
    'Projekt löschen?',
    [
      h('p', { class: 'hinweis', style: 'padding:0',
        text: `„${b.ort}“${kunde ? ` (${kunde.name})` : ''} wird gelöscht. Das lässt sich nicht rückgängig machen.` }),
      // Leere Scheine entstehen beim blossen Oeffnen - die sind keine Warnung wert.
      positionen
        ? h('div', { class: 'merk warnung' },
            h('span', { text: '⚠️' }),
            h('span', { text: `Mit ${scheine.length === 1 ? 'dem Schein' : `${scheine.length} Scheinen`} gehen ${positionen === 1 ? '1 Position' : `${positionen} Positionen`} verloren.` }),
          )
        : null,
      h('p', { class: 'hinweis', style: 'padding:0', text: `Zum Löschen diese Zahl eintippen: ${zahl}` }),
      h('label', { class: 'feld' }, eingabe),
    ],
    [
      { text: 'Abbrechen', art: 'zweit', tun: zurueck },
      {
        text: 'Löschen', art: 'gefahr',
        tun: async () => {
          if (eingabe.value.trim() !== zahl) {
            melden('Nicht gelöscht', 'Die Zahl stimmte nicht. Das Projekt ist unverändert.');
            return;
          }
          await db.transaction('rw', db.baustellen, db.scheine, async () => {
            await db.scheine.where('baustelleId').equals(id).delete();
            await db.baustellen.delete(id);
          });
          neu();
        },
      },
    ],
  );
  setTimeout(() => eingabe.focus(), 50);
}
