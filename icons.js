/**
 * HubbleNest Icon System
 *
 * ONE reusable, local SVG icon set for the whole interface — sidebar, mobile
 * navigation, buttons, cards, menus, notifications and the public website.
 *
 * Visual language (matches the HubbleNest reference style):
 *   - rounded silhouettes and joins, 2px stroke weight, 24×24 grid
 *   - the signature blue → violet gradient on every glyph
 *   - consistent optical weight so icons mix cleanly at any size
 *
 * Usage:
 *   import { hnIcon, installIconSystem } from './icons.js';
 *   hnIcon('home', 18)                    → inline SVG string
 *   installIconSystem()                   → upgrades every [data-hn-icon]
 *                                           element and installs the shared
 *                                           gradient defs once per document
 *
 * Every icon is decorative/graphical only — interactive controls carry their
 * own aria-labels or visible text next to the icon.
 */

const ICONS = {
  logo: '<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19Z"/><path d="M9.5 20.5v-5a2.5 2.5 0 0 1 5 0v5"/><path d="M4 10.5 12 17l8-6.5"/>',
  home: '<path d="m4.5 9.5 7.5-6 7.5 6V19a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4.5 19Z"/><path d="M9.5 20.5V14a2.5 2.5 0 0 1 5 0v6.5"/>',
  spaces: '<rect width="7" height="7" x="3.5" y="3.5" rx="2"/><rect width="7" height="7" x="13.5" y="3.5" rx="2"/><rect width="7" height="7" x="13.5" y="13.5" rx="2"/><rect width="7" height="7" x="3.5" y="13.5" rx="2"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M3.5 20v-1.5A4.5 4.5 0 0 1 8 14h2a4.5 4.5 0 0 1 4.5 4.5V20"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M17.5 14.2a4.5 4.5 0 0 1 3 4.3V20"/>',
  chat: '<path d="M21 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-4.5 4V6A2.5 2.5 0 0 1 6 3.5h12.5A2.5 2.5 0 0 1 21 6Z"/><path d="M8 9h8"/><path d="M8 12.5h5"/>',
  bell: '<path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 6 2.5 7.5 2.5 7.5H4S6.5 15 6.5 9"/><path d="M10.4 20.5a1.9 1.9 0 0 0 3.2 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.2-4.2"/>',
  share: '<circle cx="17.5" cy="5.5" r="2.8"/><circle cx="6.5" cy="12" r="2.8"/><circle cx="17.5" cy="18.5" r="2.8"/><path d="m9 13.5 6 3.8"/><path d="m15 6.7-6 3.8"/>',
  game: '<rect x="2.5" y="6.5" width="19" height="11" rx="4.5"/><path d="M6.5 12h4"/><path d="M8.5 10v4"/><circle cx="15.6" cy="13.4" r=".6"/><circle cx="17.9" cy="10.9" r=".6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"/>',
  shield: '<path d="M12 3 5 6v5c0 5 3.2 8.4 7 10 3.8-1.6 7-5 7-10V6Z"/><path d="m9.2 11.8 2 2 3.6-3.6"/>',
  devices: '<rect x="2.5" y="5" width="13" height="10" rx="2"/><path d="M6.5 19h5"/><path d="M9 15v4"/><rect x="17.5" y="8" width="4" height="11" rx="1.6"/>',
  plus: '<path d="M12 5.5v13"/><path d="M5.5 12h13"/>',
  send: '<path d="m21 3-9.5 18-2.6-7.9L1 10.5Z"/><path d="M21 3 8.9 13.1"/>',
  download: '<path d="M20.5 14.5v4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-4"/><path d="m7.5 11 4.5 4.5L16.5 11"/><path d="M12 3v12.5"/>',
  attach: '<path d="m20.5 11.5-7.8 7.8a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.3-7.3"/>',
  heart: '<path d="M19 14c1.5-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.5 4.04 3 5.5l7 7Z"/>',
  folder: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/>',
  logout: '<path d="M9 20.5H5.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2H9"/><path d="m15 16.5 4.5-4.5L15 7.5"/><path d="M19.5 12H9"/>'
};

const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<linearGradient id="hnIg" x1="0%" y1="0%" x2="100%" y2="100%">
  <stop offset="0%" stop-color="#60a5fa"/>
  <stop offset="55%" stop-color="#818cf8"/>
  <stop offset="100%" stop-color="#a78bfa"/>
</linearGradient>
</defs></svg>`;

let defsInstalled = false;

/**
 * Render one icon as inline SVG using the shared gradient stroke.
 * @param {string} name   icon name (see ICONS)
 * @param {number} size   rendered square size in px (default 20)
 * @param {string} cls    optional extra class on the <svg>
 */
export function hnIcon(name, size = 20, cls = '') {
  const body = ICONS[name];
  if (!body) return '';
  ensureDefs();
  return `<svg ${cls ? `class="${cls}" ` : ''}width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="url(#hnIg)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Install the shared gradient defs exactly once per document. */
function ensureDefs() {
  if (defsInstalled || document.getElementById('hnIg')) { defsInstalled = true; return; }
  document.body.insertAdjacentHTML('afterbegin', DEFS);
  defsInstalled = true;
}

/**
 * Upgrade every [data-hn-icon] placeholder in the document.
 * The placeholder's own markup is REPLACED by the icon; sibling labels
 * (e.g. <span>Home</span> inside a nav item) are left untouched.
 * Safe to call repeatedly — upgraded nodes are marked with hn-ic-done.
 */
export function installIconSystem(root = document) {
  ensureDefs();
  root.querySelectorAll('[data-hn-icon]:not(.hn-ic-done)').forEach((el) => {
    const name = el.getAttribute('data-hn-icon');
    const size = Number(el.getAttribute('data-hn-icon-size') || 20);
    el.innerHTML = hnIcon(name, size);
    el.classList.add('hn-ic-done');
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.flexShrink = '0';
  });
}
