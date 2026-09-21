import { einstellungenSchreiben } from '../db';
import { neu, zustand } from '../store';
import { h, marke } from '../ui';
import { pruefen, saeubern } from '../lib/lizenz';
import { dateiWaehlen } from '../lib/share';

/**
 * Sperrbildschirm. Ohne gueltigen Schluessel laeuft nichts — kein Anlegen,
 * kein Erfassen, nichts.
 *
 * **Hier gibt es bewusst keinen Schluesselgenerator.** Ausstellen kann
 * Schluessel nur, wer den privaten Teil hat, und der liegt ausschliesslich im
 * Lizenzgenerator auf dem Rechner des Betriebs.
 *
 * Der Schluessel wird **eingefuegt, nicht getippt**: er traegt Betrieb,
 * Nummer, Datum und die Unterschrift und ist dafuer zu lang zum Abschreiben.
 * Am Handy kommt er ohnehin per Nachricht an.
 */
export function sperreView(): HTMLElement[] {
  const eingabe = h('textarea', {
    class: 'schluessel',
    rows: '3',
    autocomplete: 'off',
    autocapitalize: 'off',
    placeholder: 'MBL1.…',
    'aria-label': 'Lizenzschlüssel',
  });
  eingabe.spellcheck = false;

  const meldung = h('div', { class: 'meldung' });
  const knopf = h('button', { class: 'knopf', type: 'button', text: 'Freischalten', disabled: true });

  // Sobald etwas im Feld steht, ist der Knopf zu haben. Ihn erst ab einer
  // Mindestlaenge freizugeben waere schlechter: wer einen Schluessel der
  // ersten Fassung eintippt, saesse vor einem toten Knopf ohne Begruendung.
  const pruefenObTaugt = () => {
    knopf.disabled = saeubern(eingabe.value).length === 0;
  };
  eingabe.addEventListener('input', () => {
    eingabe.classList.remove('falsch');
    meldung.textContent = '';
    meldung.className = 'meldung';
    pruefenObTaugt();
  });

  /** Eine Eingabe pruefen und bei Erfolg freischalten. */
  const freischalten = async (text: string): Promise<void> => {
    knopf.disabled = true;
    const ergebnis = await pruefen(text);

    if (!ergebnis.ok) {
      eingabe.classList.add('falsch');
      meldung.textContent = ergebnis.text;
      meldung.className = 'meldung fehler';
      pruefenObTaugt();
      return;
    }

    meldung.textContent = `Freigeschaltet für ${ergebnis.lizenz.betrieb}.`;
    meldung.className = 'meldung gut';
    // Gespeichert wird der gesaeuberte Schluessel: ein Zeilenumbruch aus der
    // Nachricht wuerde beim naechsten Start noch einmal mitgeprueft werden.
    zustand.einstellungen = await einstellungenSchreiben({ lizenz: saeubern(text) });
    zustand.lizenz = ergebnis.lizenz;
    setTimeout(() => { zustand.ansicht = 'uebersicht'; neu(); }, 500);
  };

  knopf.onclick = () => void freischalten(eingabe.value);

  const einfuegen = h('button', {
    class: 'knopf zweit', type: 'button', text: 'Einfügen',
    onclick: async () => {
      try {
        eingabe.value = await navigator.clipboard.readText();
        pruefenObTaugt();
        eingabe.focus();
      } catch {
        // Kein Zugriff erlaubt oder nichts drin: dann wird von Hand
        // eingefuegt, das Feld steht ja da.
        meldung.textContent = 'Einfügen ging nicht — bitte lange auf das Feld drücken und „Einsetzen" wählen.';
        meldung.className = 'meldung';
      }
    },
  });

  // Der zweite Weg herein: der Schluessel kommt als Datei. Am Handy landet
  // ein Mailanhang oft in den Dateien, statt sich kopieren zu lassen.
  const ausDatei = h('button', {
    class: 'knopf zweit', type: 'button', text: 'Datei wählen…',
    onclick: async () => {
      const text = await dateiWaehlen();
      if (text === null) return;
      eingabe.value = saeubern(text);
      pruefenObTaugt();
      await freischalten(eingabe.value);
    },
  });

  const schirm = h(
    'div',
    { class: 'sperre' },
    marke('marke-gross'),
    h('h1', { text: 'MaterialBlitz' }),
    h('p', { class: 'lead', text: 'Bitte einmalig den Lizenzschlüssel einfügen. Danach fragt die App nicht mehr.' }),
    h('div', { class: 'feld' },
      eingabe,
      meldung,
      knopf,
      h('div', { class: 'knopf-reihe', style: 'margin-top:8px' }, einfuegen, ausDatei),
      h('p', { style: 'margin-top:14px;font-size:13px;color:var(--ink-muted)',
        text: 'Den Schlüssel bekommst du von dem, der dir die App gegeben hat — als Nachricht zum Einfügen oder als Datei.' }),
    ),
  );

  return [schirm];
}

