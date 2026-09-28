/**
 * HubbleNest Settings & Theme Management
 */

import { showToast } from './utils.js';

export function initializeTheme() {
  const saved = localStorage.getItem('hubblenest_theme') || 'dark';
  applyTheme(saved);
  return saved;
}

export function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.classList.add('light-theme');
    document.documentElement.classList.remove('dark-theme');
    localStorage.setItem('hubblenest_theme', 'light');
  } else {
    document.documentElement.classList.add('dark-theme');
    document.documentElement.classList.remove('light-theme');
    localStorage.setItem('hubblenest_theme', 'dark');
  }
}

export function toggleTheme() {
  const current = localStorage.getItem('hubblenest_theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  showToast(`Switched to ${next} theme`, 'info', 1800);
  return next;
}
