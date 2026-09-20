import { einstellungenSchreiben } from '../db';
import { neu, zustand } from '../store';
import { h, marke } from '../ui';
import { formatieren, pruefen } from '../lib/lizenz';

/**
 * Sperrbildschirm. Ohne gueltigen Schluessel laeuft nichts — kein Anlegen,
 * kein Erfassen, nichts.
 *
 * **Hier gibt es bewusst keinen Schluesselgenerator.** Ein Generator vor der
 * Sperre macht die Sperre wertlos — jeder tippt sich selbst einen Schluessel.
 * Schluessel gibt der Betrieb mit einer eigenen, nicht veroeffentlichten
 * Datei aus (schluessel-generator.html).
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
    ),
  );

  setTimeout(() => eingabe.focus(), 120);
  return [schirm];
}
