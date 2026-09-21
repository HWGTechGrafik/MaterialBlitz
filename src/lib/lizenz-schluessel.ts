/**
 * Oeffentlicher Schluessel, mit dem die App Lizenzen prueft.
 *
 * Er darf ausgeliefert werden — damit laesst sich **pruefen, aber nichts
 * erzeugen**. Der zugehoerige private Schluessel liegt ausschliesslich im
 * Lizenzgenerator unter `privat/lizenzgenerator/materialblitz-schluessel.json`
 * und wird nie mitgeliefert; `privat/` steht in der .gitignore.
 *
 * Dieser Schluessel gehoert zu dem Paar, das der Generator bei seinem ersten
 * Start angelegt hat. Wird dort „Neues Schluesselpaar" geklickt, muss der neue
 * oeffentliche Teil hier einziehen — sonst weist die App jede danach
 * ausgestellte Lizenz zurueck.
 */
export const LIZENZ_OEFFENTLICH: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'kIvDUbllLE5NqJD6rI2aRLdaZycEnHN2605mDOFrL9E',
  y: 'GEFFsXxQ4zfZKx8KMqm13ZbahXysXzzjE15Z5_oVTxg',
  ext: true,
};
