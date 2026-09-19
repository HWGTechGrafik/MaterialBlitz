// Platzhalter fuer html2canvas, canvg und dompurify.
//
// jsPDF fuehrt die drei als optionale Abhaengigkeiten seines html()-Plugins.
// Wir erzeugen das PDF aus Daten, nicht aus HTML, brauchen sie also nie — ein
// naiver Import schleppt sie trotzdem mit, rund 110 KB gzip. In vite.config.ts
// zeigen die drei Namen deshalb hierher.
export default undefined;
