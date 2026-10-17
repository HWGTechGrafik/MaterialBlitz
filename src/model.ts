// Die Begriffe dieses Projekts. Sie stehen so auch in der Oberflaeche.

/** Ein Eintrag im Katalog — Tippvorlage, nicht Inhalt eines Scheins. */
export interface Artikel {
  id?: number;
  name: string;
  einheit: string;
  /** Wie oft insgesamt verwendet. Bestimmt die Reihenfolge der Vorschlaege. */
  anzahl: number;
  /**
   * Strich- und QR-Codes, an denen die App den Artikel wiedererkennt —
   * normalisiert (lib/codes.ts). Ein Code gehoert hoechstens **einem**
   * Artikel. Nur zum Wiederfinden: nie auf PDF oder Excel des Scheins.
   */
  codes?: string[];
  /**
   * Ordner im Archiv, etwa "Kabel" oder "Loxone". Eine Ebene, kein Baum —
   * am Handy will niemand durch Unterordner tippen. Ein Ordner besteht,
   * solange ein Artikel darin liegt; eine eigene Liste gibt es nicht.
   */
  ordner?: string;
  /**
   * Artikelnummer, etwa die des Grosshaendlers oder der eigenen
   * Warenwirtschaft. Anders als die Codes steht sie auf PDF und Excel des
   * Scheins — damit das Buero ohne Nachschlagen bestellen und verrechnen kann.
   */
  nummer?: string;
  /** Welcher Code aufs Etikett kommt. Fehlt: QR. */
  etikettArt?: EtikettArt;
  /** Was der Code traegt. Fehlt: wie in den Einstellungen. */
  etikettInhalt?: EtikettCode;
  /** Wie viele Etiketten der Druck vorschlaegt — etwa eines je Fach. Fehlt: eines. */
  etikettStueck?: number;
}

export type EtikettArt = 'qr' | 'strich';

/**
 * Ein Etikettenformat auf einem A4-Blatt. Ohne feste Raender: der Block
 * sitzt mittig, so wie die Boegen geschnitten sind. Spalten und Zeilen
 * ergeben sich aus den Massen, wenn sie fehlen.
 */
export interface EtikettBogen {
  id: string;
  titel: string;
  /** Ein Etikett, in mm. */
  breite: number;
  hoehe: number;
  /** Luecke zwischen den Spalten bzw. Zeilen, in mm. */
  abstandX?: number;
  abstandY?: number;
  spalten?: number;
  zeilen?: number;
  /** Blatt quer. Im PDF gedreht, nicht erst im Druckdialog — der verkleinert sonst. */
  quer?: boolean;
  /** Normales Papier: duenne Linien zum Ausschneiden. */
  schnitt?: boolean;
}

/**
 * Was im Verlauf eines Projekts steht. Die Scheine zeigen nur den Stand —
 * der Verlauf zeigt, wann wie viel dazukam, geaendert oder geloescht wurde.
 */
export type VerlaufArt =
  /** Artikel erstmals auf den Schein */
  | 'neu'
  /** zu einer vorhandenen Position dazugezaehlt */
  | 'dazu'
  /** Menge von Hand geaendert */
  | 'geaendert'
  /** Position entfernt */
  | 'geloescht'
  | 'geteilt'
  | 'uebergeben'
  | 'uebernommen'
  | 'nachtrag';

export interface VerlaufEintrag {
  id?: number;
  baustelleId: number;
  zeit: number;
  art: VerlaufArt;
  /** Artikel — fehlt bei Ereignissen, die den ganzen Schein betreffen. */
  name?: string;
  einheit?: string;
  /** Die Veraenderung: +5 beim Dazuzaehlen, -40 beim Loeschen. */
  menge?: number;
  /** Menge der Position danach. */
  stand?: number;
  /** Positionen des Scheins, bei Ereignissen am ganzen Schein. */
  positionen?: number;
  /** Welcher Schein, wenn es nicht schlicht der eigene ist. */
  schein?: string;
  /** Wo es geschah — mit der Dropbox laeuft der Verlauf von Handy und PC zusammen. */
  geraet?: 'Handy' | 'PC';
}

export interface Kunde {
  id?: number;
  name: string;
  /** Ausgeblendet statt geloescht, wenn Historie daran haengt. */
  versteckt?: boolean;
}

export interface Baustelle {
  id?: number;
  /**
   * Leer bei einem reinen Kundenprojekt — manche Arbeit hat keine feste
   * Adresse, nur einen Auftraggeber. Ort oder Kunde muss aber da sein.
   */
  ort: string;
  /** Optional — Werkstatt, Lager und Eigenbedarf haben keinen Kunden. */
  kundeId?: number;
  /** Arbeit fertig: verschwindet aus dem Dashboard, bleibt auffindbar. */
  abgeschlossen?: boolean;
  versteckt?: boolean;
  /** Zeitstempel der letzten Benutzung — das Dashboard sortiert danach. */
  zuletzt: number;
}

/**
 * Wie ein Projekt in Listen, Kopfzeilen und Dateinamen heisst: der Ort,
 * bei einem reinen Kundenprojekt der Kunde.
 */
export function projektTitel(b: Pick<Baustelle, 'ort'>, kunde?: string): string {
  return b.ort || kunde || 'ohne Namen';
}

/** Die Zeile darunter — was der Titel nicht schon sagt. */
export function projektUnter(b: Pick<Baustelle, 'ort'>, kunde?: string): string {
  return b.ort ? kunde ?? 'ohne Kunden' : 'ohne Ort';
}

/**
 * Eine Zeile im Schein. **Abschrift, kein Verweis**: sie haelt fest, was zum
 * Zeitpunkt des Aufschreibens galt, und aendert sich nie wieder — auch nicht,
 * wenn der Artikel im Katalog umbenannt oder geloescht wird.
 */
export interface Position {
  name: string;
  menge: number;
  einheit: string;
  /** Artikelnummer beim Aufschreiben — fehlt, wenn der Artikel keine hatte. */
  nummer?: string;
}

/** Nur *offen* ist bearbeitbar; die anderen beiden sind Endzustaende. */
export type ScheinZustand = 'offen' | 'geteilt' | 'uebergeben';

export interface Schein {
  id?: number;
  baustelleId: number;
  /** Optionale Bezeichnung, etwa "Top 12". Leer ist der Normalfall. */
  bezeichnung?: string;
  zustand: ScheinZustand;
  erstellt: number;
  /** Zeitpunkt des Teilens bzw. Uebergebens. */
  beendet?: number;
  /** Gesetzt, wenn dieser Schein ein Nachtrag zu einem anderen ist. */
  nachtragVon?: number;
  /** Gesetzt, wenn der Schein von einem Kollegen uebernommen wurde. */
  herkunft?: string;
  positionen: Position[];
}

export interface Firma {
  name: string;
  strasse: string;
  ort: string;
  telefon: string;
}

/** Was aus der Lizenz auf Schein und Dashboard steht. */
export type Ausweis = 'beides' | 'name' | 'firma';

/**
 * Was der QR- oder Strichcode eines gedruckten Etiketts traegt: der eigene
 * Code der App ("MB-..."), die Artikelnummer oder die Bezeichnung. Mit
 * Nummer oder Bezeichnung lesen auch andere Scanner im Betrieb etwas
 * Brauchbares heraus.
 */
export type EtikettCode = 'eigen' | 'nummer' | 'name';

/** Ein Bild, verkleinert und als Datenstring — so passt es in Sicherung und Dropbox. */
export interface Logo {
  /** data:image/png oder data:image/jpeg */
  bild: string;
  /** Pixel, fuer das Seitenverhaeltnis auf PDF und Excel. */
  breite: number;
  hoehe: number;
}

export interface Einstellungen {
  id?: number;
  firma: Firma;
  /** Firmenlogo fuer PDF und Excel. Fehlt es, steht dort das MaterialBlitz-Zeichen. */
  logo?: Logo;
  /** Feste Liste plus selbst ergaenzte. */
  einheiten: string[];
  lizenz?: string;
  /**
   * Wann der Schluessel auf diesem Geraet eingesetzt wurde. Daran erkennt der
   * Dropbox-Abgleich, welcher von zwei Schluesseln derselben Nummer neuer ist.
   */
  lizenzGesetzt?: number;
  /** Fehlt bei aelteren Daten — gilt dann als 'beides'. */
  ausweis?: Ausweis;
  /** Fehlt bei aelteren Daten — gilt dann als 'eigen', wie bisher. */
  etikettCode?: EtikettCode;
  /** Zuletzt gewaehltes Etikettenformat (id). */
  etikettBogen?: string;
  /** Selbst angelegte Etikettenformate, zusaetzlich zu den Vorlagen. */
  etikettBoegen?: EtikettBogen[];
  /**
   * Adresse des Bueros. Steht **nicht** auf dem PDF — sie liegt beim Senden
   * in der Zwischenablage, damit sie in der Mail nur noch einzusetzen ist.
   * Der Teilen-Dialog kennt kein Empfaengerfeld, das ist der naechste Weg.
   */
  buero?: string;
  letzteSicherung?: number;
  /** Artikel seit der letzten Sicherung — loest die Erinnerung mit aus. */
  neueArtikel: number;
}

export const EINHEITEN_STANDARD = ['Stk', 'm', 'lfm', 'kg', 'Rolle', 'Pkg', 'Satz'];

/**
 * Einheiten, bei denen "+1" eine sinnvolle Eingabe ist. Bei Metern nicht —
 * und ein Druckpunkt, der je nach Artikel etwas anderes tut, waere schlimmer
 * als keiner.
 */
// Sack ist keine feste Einheit, kommt aber mit dem Bau-Katalog - und dort
// wird sackweise gezaehlt.
export const ZAEHLBAR = ['Stk', 'Pkg', 'Satz', 'Rolle', 'Sack'];

export function istZaehlbar(einheit: string): boolean {
  return ZAEHLBAR.includes(einheit);
}

export const FIRMA_LEER: Firma = { name: '', strasse: '', ort: '', telefon: '' };

/** Erinnerung an die Sicherung: was zuerst eintritt. */
export const SICHERUNG_TAGE = 30;
export const SICHERUNG_ARTIKEL = 20;

/**
 * Menge zu einem Schein hinzufuegen. Derselbe Artikel steht nur **einmal**
 * auf einem Schein — erneutes Aufschreiben zaehlt zusammen.
 */
export function positionHinzufuegen(
  positionen: Position[],
  name: string,
  menge: number,
  einheit: string,
  nummer?: string,
): { positionen: Position[]; index: number } {
  const i = positionen.findIndex((p) => p.name === name && p.einheit === einheit);
  if (i >= 0) {
    const kopie = positionen.slice();
    const alt = kopie[i]!;
    // Eine inzwischen nachgetragene Nummer kommt dazu; eine vorhandene bleibt.
    kopie[i] = { ...alt, menge: runden(alt.menge + menge), ...(!alt.nummer && nummer ? { nummer } : {}) };
    return { positionen: kopie, index: i };
  }
  return { positionen: [...positionen, { name, menge, einheit, ...(nummer ? { nummer } : {}) }], index: positionen.length };
}

/**
 * Positionen fuer PDF und Excel: wer ohne Nummer aufgeschrieben wurde, weil
 * sie im Archiv erst spaeter dazukam, bekommt sie von dort. Eine
 * mitgeschriebene Nummer bleibt — die Position ist eine Abschrift.
 */
export function nummernErgaenzen(positionen: Position[], archiv: Artikel[]): Position[] {
  // Der Name ist im Archiv eindeutig; die Einheit kann sich seither geaendert haben.
  const nachName = new Map(archiv.filter((a) => a.nummer).map((a) => [a.name, a.nummer!]));
  return positionen.map((p) => {
    if (p.nummer) return p;
    const nummer = nachName.get(p.name);
    return nummer ? { ...p, nummer } : p;
  });
}

/** Gegen Rundungsfehler beim Addieren von Kommazahlen (0,1 + 0,2). */
export function runden(n: number): number {
  return Math.round(n * 1000) / 1000;
}
