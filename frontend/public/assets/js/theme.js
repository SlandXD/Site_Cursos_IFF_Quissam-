/* theme.js — Gerencia o toggle claro/escuro */
(function () {
  const STORAGE_KEY = 'ca_theme';

  function applyTheme(theme) {
    document.body.classList.remove('dark-mode', 'light-mode');
    document.body.classList.add(theme === 'light' ? 'light-mode' : 'dark-mode');
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.textContent = theme === 'light' ? '🌙 Escuro' : '☀️ Claro';
      btn.setAttribute('aria-label', theme === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro');
    });
  }

  function getPreferred() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  // Aplica imediatamente para evitar flash
  const initial = getPreferred();
  applyTheme(initial);

  window.toggleTheme = function () {
    const current = localStorage.getItem(STORAGE_KEY) || getPreferred();
    const next = current === 'light' ? 'dark' : 'light';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  };

  // Sincroniza botões assim que o DOM estiver pronto
  document.addEventListener('DOMContentLoaded', () => applyTheme(getPreferred()));
})();
