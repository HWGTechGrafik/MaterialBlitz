/**
 * Dropbox-Anbindung — derselbe Weg wie bei BzzOps und Billy Ledger.
 *
 * Eine eigene Dropbox-App mit Zugriff **nur auf ihren App-Ordner**
 * (Dropbox › Apps › MaterialBlitz App), nicht auf den Rest der Dropbox.
 * Angemeldet wird per OAuth 2 mit PKCE, also ohne App-Secret — so sieht
 * Dropbox es fuer Browser-Apps vor. Der App-Key ist oeffentlich und kommt beim
 * Bauen aus `VITE_DROPBOX_APP_KEY` (Datei `.env`). Ohne ihn bleibt die
 * Anbindung ausgeblendet.
 *
 * Ablauf: Die App leitet zur Dropbox-Anmeldung weiter; Dropbox leitet mit
 * `?code=…&state=…` auf die Adresse der App zurueck. Der Refresh-Token bleibt
 * im lokalen Speicher **dieses Geraets** — nie in Sicherung oder Sync-Datei,
 * die liegen in der Datenbank.
 */
import { AM_PC } from './geraet';

export const DROPBOX_APP_KEY: string = import.meta.env.VITE_DROPBOX_APP_KEY ?? '';

export class DropboxFehler extends Error {}

const K = {
  refresh: 'mb.dbx.refresh',
  konto: 'mb.dbx.konto',
  verifier: 'mb.dbx.verifier',
  state: 'mb.dbx.state',
  anspruch: 'mb.dbx.anspruch',
  inArbeit: 'mb.dbx.inArbeit',
} as const;

function lesen(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function setzen(k: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // Privates Fenster o. ae. — dann haelt die Verbindung eben nur bis zum Schliessen nicht.
  }
}

let zugang: string | null = null;
let gueltigBis = 0;

export const eingerichtet = (): boolean => DROPBOX_APP_KEY.length > 0;
export const verbunden = (): boolean => (lesen(K.refresh) ?? '').length > 0;
/** Anzeigename des verbundenen Kontos, etwa „Max Muster · max@…". */
export const konto = (): string | null => lesen(K.konto);

/**
 * Ruecksprungadresse — genau sie muss in der Dropbox-App als Redirect URI
 * stehen. Im Browser der Ordner der App (auch wenn sie als …/index.html
 * geoeffnet wurde), im Windows-Programm die index.html selbst: dessen
 * virtueller Host liefert fuer einen Ordner keine Seite aus.
 */
export function rueckAdresse(): string {
  const { origin, pathname } = location;
  const ordner = pathname.endsWith('index.html') ? pathname.slice(0, -'index.html'.length) : pathname;
  return origin + ordner + (AM_PC ? 'index.html' : '');
}

function zufall(n: number): string {
  const z = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const r = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(r, (b) => z[b % z.length]).join('');
}

function base64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Zur Dropbox-Anmeldung weiterleiten — die App wird dabei verlassen. */
export async function anmeldenStarten(): Promise<void> {
  const verifier = zufall(64);
  const state = zufall(24);
  setzen(K.verifier, verifier);
  setzen(K.state, state);
  const challenge = base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const url = new URL('https://www.dropbox.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: DROPBOX_APP_KEY,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: rueckAdresse(),
    token_access_type: 'offline',
    state,
  }).toString();
  location.assign(url.toString());
}

function adresseBereinigen(): void {
  history.replaceState(null, '', location.pathname);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Rueckkehr von der Dropbox-Anmeldung auswerten. null = keine Rueckkehr,
 * true = verbunden; ein Fehler kommt als DropboxFehler.
 */
export async function rueckkehrVerarbeiten(): Promise<boolean | null> {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  const state = q.get('state');

  // Android oeffnet die Rueckkehr bei installierter App oft zweimal
  // (Browserfenster der Anmeldung + App). Beide teilen sich den Speicher;
  // nur eine Seite darf den Code einloesen — doppelt eingeloest antwortet
  // Dropbox mit einem Fehler. Darum wird der Code erst „beansprucht".
  if (!state || state !== lesen(K.state)) {
    if (!state || state !== lesen(K.inArbeit)) return null; // nicht unsere Anfrage
    adresseBereinigen();
    return aufAndereSeiteWarten();
  }
  adresseBereinigen();
  const ich = zufall(16);
  setzen(K.anspruch, ich);
  await pause(400);
  if (lesen(K.anspruch) !== ich) return aufAndereSeiteWarten();
  setzen(K.inArbeit, state);
  setzen(K.state, null);
  const verifier = lesen(K.verifier);
  setzen(K.verifier, null);

  try {
    if (q.has('error')) throw new DropboxFehler('Die Dropbox-Anmeldung wurde abgebrochen.');
    if (!verifier) throw new DropboxFehler('Die Anmeldung ist abgelaufen – bitte noch einmal verbinden.');
    const antwort = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        code: q.get('code')!,
        grant_type: 'authorization_code',
        code_verifier: verifier,
        client_id: DROPBOX_APP_KEY,
        redirect_uri: rueckAdresse(),
      }),
    });
    if (!antwort.ok) {
      throw new DropboxFehler(
        `Die Dropbox-Anmeldung ist fehlgeschlagen (${antwort.status}${await grund(antwort)}). `
        + 'Bitte noch einmal „Mit Dropbox verbinden" wählen.',
      );
    }
    const j = await antwort.json() as { refresh_token: string; access_token: string; expires_in?: number };
    setzen(K.refresh, j.refresh_token);
    zugangMerken(j);
    await kontoLaden();
    return true;
  } finally {
    setzen(K.inArbeit, null);
    setzen(K.anspruch, null);
  }
}

/** Eine andere Seite loest den Code ein — auf ihr Ergebnis warten (bis 20 s). */
async function aufAndereSeiteWarten(): Promise<boolean | null> {
  for (let i = 0; i < 40; i++) {
    if (verbunden()) return true;
    if (lesen(K.inArbeit) === null && lesen(K.anspruch) === null) break;
    await pause(500);
  }
  return verbunden() ? true : null;
}

async function grund(antwort: Response): Promise<string> {
  try {
    const j = await antwort.json() as { error_description?: string; error?: unknown };
    const t = j.error_description ?? (typeof j.error === 'string' ? j.error : '');
    return t ? `: ${t}` : '';
  } catch {
    return '';
  }
}

function zugangMerken(j: { access_token: string; expires_in?: number }): void {
  zugang = j.access_token;
  gueltigBis = Date.now() + ((j.expires_in ?? 14400) - 120) * 1000;
}

async function token(): Promise<string> {
  if (zugang && Date.now() < gueltigBis) return zugang;
  const refresh = lesen(K.refresh);
  if (!refresh) throw new DropboxFehler('Nicht mit Dropbox verbunden.');
  const antwort = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: DROPBOX_APP_KEY }),
  });
  if (antwort.status === 400 || antwort.status === 401) {
    lokalTrennen();
    throw new DropboxFehler('Die Dropbox-Verbindung ist nicht mehr gültig – bitte neu verbinden.');
  }
  if (!antwort.ok) throw new DropboxFehler(`Dropbox ist nicht erreichbar (${antwort.status}).`);
  zugangMerken(await antwort.json());
  return zugang!;
}

async function kontoLaden(): Promise<void> {
  try {
    const antwort = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token()}` },
    });
    if (!antwort.ok) return;
    const j = await antwort.json() as { name?: { display_name?: string }; email?: string };
    setzen(K.konto, [j.name?.display_name, j.email].filter(Boolean).join(' · '));
  } catch {
    // Die Anzeige ist Kuer.
  }
}

/**
 * Dropbox-API-Arg muss reines ASCII sein — Umlaute im Pfad als \uXXXX.
 */
function apiArg(wert: object): string {
  return JSON.stringify(wert).replace(/[\u007f-￿]/g, (z) => `\\u${z.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Inhalt einer Datei im App-Ordner, oder null, wenn es sie noch nicht gibt. */
export async function dateiLesen(pfad: string): Promise<string | null> {
  const antwort = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Dropbox-API-Arg': apiArg({ path: pfad }) },
  });
  if (antwort.status === 409) return null; // path/not_found
  if (!antwort.ok) throw new DropboxFehler(`Lesen aus der Dropbox ist fehlgeschlagen (${antwort.status}).`);
  return antwort.text();
}

export async function dateiSchreiben(pfad: string, inhalt: string): Promise<boolean> {
  const antwort = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Dropbox-API-Arg': apiArg({ path: pfad, mode: 'overwrite', mute: true }),
      'Content-Type': 'application/octet-stream',
    },
    body: new TextEncoder().encode(inhalt),
  });
  return antwort.ok;
}

/** Nur dieses Geraet abmelden — die Sync-Datei bleibt in der Dropbox. */
export async function trennen(): Promise<void> {
  try {
    await fetch('https://api.dropboxapi.com/2/auth/token/revoke', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token()}` },
    });
  } catch {
    // Token womoeglich schon ungueltig — lokal trotzdem trennen.
  }
  lokalTrennen();
}

function lokalTrennen(): void {
  zugang = null;
  setzen(K.refresh, null);
  setzen(K.konto, null);
}
