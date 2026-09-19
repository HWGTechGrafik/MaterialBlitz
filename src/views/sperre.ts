import { einstellungenSchreiben } from '../db';
import { neu, zustand } from '../store';
import { blatt, h, marke } from '../ui';
import { erzeugen, formatieren, pruefen } from '../lib/lizenz';

/**
 * Sperrbildschirm. Ohne gueltigen Schluessel laeuft nichts — kein Anlegen,
 * kein Erfassen, nichts.
 *
 * Der Schluesselgenerator bleibt trotzdem erreichbar: sonst kaeme der Betrieb
 * nie an den ersten Schluessel, weil der Generator hinter genau der Lizenz
 * laege, die er erzeugt.
 */
export function sperreView(): HTMLElement[] {
  const eingabe = h('input', {
    class: 'gross',
    type: 'text',
    placeholder: 'MB-XXXX-XXXX-XXXX',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Lizenzschlüssel',
  });
  const meldung = h('div', { class: 'meldung' });
  const knopf = h('button', { class: 'knopf', type: 'button', text: 'Freischalten', disabled: true });

  eingabe.addEventListener('input', () => {
    eingabe.value = formatieren(eingabe.value);
    eingabe.classList.remove('falsch');
    meldung.textContent = '';
    meldung.className = 'meldung';
    knopf.disabled = eingabe.value.replace(/[^A-Z0-9]/g, '').length < 14;
  });
  eingabe.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter' && !knopf.disabled) knopf.click();
  });

  knopf.onclick = async () => {
    if (!pruefen(eingabe.value)) {
      eingabe.classList.add('falsch');
      meldung.textContent = 'Dieser Schlüssel stimmt nicht. Bitte Zeichen prüfen.';
      meldung.className = 'meldung fehler';
      return;
    }
    meldung.textContent = 'Freigeschaltet.';
    meldung.className = 'meldung gut';
    zustand.einstellungen = await einstellungenSchreiben({ lizenz: eingabe.value });
    setTimeout(() => { zustand.ansicht = 'uebersicht'; neu(); }, 400);
  };

  const schirm = h(
    'div',
    { class: 'sperre' },
    marke('marke-gross'),
    h('h1', { text: 'MaterialBlitz' }),
    h('p', { class: 'lead', text: 'Bitte einmalig den Lizenzschlüssel eingeben. Danach fragt die App nicht mehr.' }),
    h('div', { class: 'feld' },
      eingabe,
      meldung,
      knopf,
      h('p', { style: 'margin-top:14px;font-size:13px;color:var(--ink-muted)',
        text: 'Den Schlüssel bekommst du von deinem Betrieb.' }),
      h('button', {
        class: 'knopf leise', type: 'button', text: 'Ich bin der Betrieb: Schlüssel erzeugen',
        onclick: schluesselErzeugen,
      }),
    ),
  );

  setTimeout(() => eingabe.focus(), 120);
  return [schirm];
}

export function schluesselErzeugen(): void {
  const wer = h('input', { type: 'text', placeholder: 'Für wen? z.B. Andreas H.' });
  const ausgabe = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  blatt(
    'Schlüssel ausgeben',
    [
      h('p', { class: 'hinweis', style: 'padding:0',
        text: 'Der Name dient nur deiner eigenen Liste — im Schlüssel steckt er nicht. Notiere dir, wer welchen bekommen hat.' }),
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
