// Bruker kontaktadressen fra js/config.js hvis den er satt, så den bare må endres ett sted.
import { config } from './config.js';

const c = config.contactEmail;
if (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(c || '')) {
  for (const a of document.querySelectorAll('[data-contact]')) { a.href = `mailto:${c}`; a.textContent = c; }
}
