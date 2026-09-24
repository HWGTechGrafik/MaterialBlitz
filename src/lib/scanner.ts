import { prepareZXingModule, readBarcodes, type ReadInputBarcodeFormat } from 'zxing-wasm/reader';
import wasmAdresse from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { h } from '../ui';

/**
 * Strich- und QR-Codes mit der Kamera lesen. Safari bringt keinen
 * eingebauten Leser mit (kein BarcodeDetector), darum zxing als wasm.
 *
 * Nachgeladen wie jsPDF: erst beim ersten Scannen. Der wasm-Teil (~1 MB,
 * ~400 KB gzip) liegt **neben der App im Precache**, nicht auf einem CDN —
 * vom CDN geladen scheiterte er am iPhone (Scan-Probe 2026-09-23), und auf
 * der Baustelle ohne Netz ginge er so ohnehin nicht.
 */

const FORMATE: ReadInputBarcodeFormat[] = [
  'EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'ITF', 'QRCode', 'DataMatrix',
];

let leser: Promise<unknown> | null = null;

/**
 * Den wasm-Teil selbst holen und erst dann an zxing geben. Laedt zxing ihn
 * selbst, heisst jeder Fehler nur "both async and sync fetching of the wasm
 * failed" — ob das Laden oder das Ausfuehren scheiterte, sagt das nicht.
 */
function leserVorbereiten(): Promise<unknown> {
  leser ??= (async () => {
    if (typeof WebAssembly !== 'object') {
      throw new Error('WebAssembly ist auf diesem Gerät abgeschaltet (Blockierungsmodus?).');
    }
    let bytes: ArrayBuffer;
    try {
      const antwort = await fetch(wasmAdresse);
      if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
      bytes = await antwort.arrayBuffer();
    } catch (e) {
      throw new Error(`Leser nicht geladen: ${(e as Error).message}`);
    }
    try {
      return await prepareZXingModule({ overrides: { wasmBinary: bytes }, fireImmediately: true });
    } catch (e) {
      throw new Error(`Leser startet nicht: ${(e as Error).message}`);
    }
  })();
  // Ein Fehlschlag soll beim naechsten Versuch neu probiert werden.
  leser.catch(() => { leser = null; });
  return leser;
}

/**
 * Vollbild mit Kamera. Liefert den Inhalt des ersten gelesenen Codes
 * unveraendert (ein QR darf Gross/klein und Umlaute tragen) — oder null,
 * wenn abgebrochen wurde.
 */
export function scannen(): Promise<string | null> {
  return new Promise((fertig) => {
    let aktiv = true;
    let strom: MediaStream | null = null;
    let licht = false;

    const video = h('video', { playsInline: true, muted: true, autoplay: true });
    const ziel = h('div', { class: 'scanner-ziel' });
    const status = h('div', { class: 'scanner-status', text: 'Kamera startet …' });
    const lichtKnopf = h('button', {
      class: 'scanner-knopf', type: 'button', text: 'Licht', hidden: true,
      onclick: async () => {
        const spur = strom?.getVideoTracks()[0];
        if (!spur) return;
        try {
          // torch fehlt in den DOM-Typen, am iPhone gibt es ihn aber.
          await spur.applyConstraints({ advanced: [{ torch: !licht } as MediaTrackConstraintSet] });
          licht = !licht;
          lichtKnopf.classList.toggle('an', licht);
        } catch {
          lichtKnopf.hidden = true;
        }
      },
    });
    const flaeche = h('div', { class: 'scanner' },
      video,
      ziel,
      h('div', { class: 'scanner-unten' },
        status,
        h('div', { class: 'scanner-knoepfe' },
          lichtKnopf,
          h('button', { class: 'scanner-knopf', type: 'button', text: 'Abbrechen', onclick: () => ende(null) }),
        ),
      ),
    );

    const ende = (ergebnis: string | null) => {
      if (!aktiv) return;
      aktiv = false;
      strom?.getTracks().forEach((s) => s.stop());
      document.removeEventListener('visibilitychange', wegGewechselt);
      flaeche.remove();
      fertig(ergebnis);
    };
    // iOS nimmt die Kamera beim Wegwechseln ohnehin weg.
    const wegGewechselt = () => { if (document.hidden) ende(null); };
    document.addEventListener('visibilitychange', wegGewechselt);

    const fehler = (text: string) => {
      status.textContent = text;
      status.classList.add('fehler');
    };

    document.body.append(flaeche);

    void (async () => {
      const bereit = leserVorbereiten();
      bereit.catch(() => {});
      try {
        strom = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } catch (e) {
        const name = (e as DOMException).name;
        fehler(name === 'NotAllowedError'
          ? 'Kamera nicht erlaubt. In den iPhone-Einstellungen unter Safari › Kamera freigeben – oder den Code im Katalog abtippen.'
          : `Kamera nicht verfügbar (${name}). Den Code im Katalog abtippen.`);
        return;
      }
      if (!aktiv) { strom.getTracks().forEach((s) => s.stop()); return; }
      video.srcObject = strom;
      await video.play().catch(() => {});

      const faehig = strom.getVideoTracks()[0]?.getCapabilities?.() as { torch?: boolean } | undefined;
      lichtKnopf.hidden = !faehig?.torch;

      try {
        await bereit;
      } catch (e) {
        fehler(`${(e as Error).message} Den Code bitte im Katalog abtippen.`);
        return;
      }
      status.textContent = 'Code in den Rahmen halten';
      await auswerten(video, ziel, () => aktiv, ende);
    })();
  });
}

/** Bild fuer Bild nur den Rahmen auswerten, bis ein Code gelesen ist. */
async function auswerten(
  video: HTMLVideoElement,
  ziel: HTMLElement,
  laeuft: () => boolean,
  ende: (text: string) => void,
): Promise<void> {
  const leinwand = document.createElement('canvas');
  const pinsel = leinwand.getContext('2d', { willReadFrequently: true })!;
  while (laeuft()) {
    const a = ausschnitt(video, ziel);
    if (a) {
      leinwand.width = a.w;
      leinwand.height = a.h;
      pinsel.drawImage(video, a.x, a.y, a.w, a.h, 0, 0, a.w, a.h);
      const funde = await readBarcodes(pinsel.getImageData(0, 0, a.w, a.h), {
        formats: FORMATE, tryHarder: true, maxNumberOfSymbols: 1,
      }).catch(() => []);
      const fund = funde.find((f) => f.isValid && f.text);
      if (fund && laeuft()) { ende(fund.text); return; }
    }
    await new Promise<void>((weiter) =>
      video.requestVideoFrameCallback
        ? video.requestVideoFrameCallback(() => weiter())
        : requestAnimationFrame(() => weiter()),
    );
  }
}

/** Den Rahmen in Kamera-Pixel umrechnen (Video mit object-fit: cover). */
function ausschnitt(video: HTMLVideoElement, ziel: HTMLElement): { x: number; y: number; w: number; h: number } | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const el = video.getBoundingClientRect();
  const z = ziel.getBoundingClientRect();
  const m = Math.max(el.width / vw, el.height / vh);
  const ox = (vw * m - el.width) / 2;
  const oy = (vh * m - el.height) / 2;
  const x = Math.max(0, Math.round((z.left - el.left + ox) / m));
  const y = Math.max(0, Math.round((z.top - el.top + oy) / m));
  const w = Math.min(vw - x, Math.round(z.width / m));
  const hh = Math.min(vh - y, Math.round(z.height / m));
  return w > 0 && hh > 0 ? { x, y, w, h: hh } : null;
}
