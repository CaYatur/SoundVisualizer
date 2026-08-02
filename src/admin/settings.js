'use strict';

(() => {
  const button = document.getElementById('settingsBtn');
  const backdrop = document.getElementById('settingsBackdrop');
  const closeButton = document.getElementById('settingsClose');
  const languageSelect = document.getElementById('languageSelect');

  if (!button || !backdrop || !closeButton || !languageSelect) return;

  const savedLanguage = localStorage.getItem('sv-language') || 'auto';
  languageSelect.value = ['auto', 'tr', 'en'].includes(savedLanguage) ? savedLanguage : 'auto';

  function openSettings() {
    backdrop.classList.remove('hidden');
    backdrop.setAttribute('aria-hidden', 'false');
    languageSelect.focus();
  }

  function closeSettings() {
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
    button.focus();
  }

  button.addEventListener('click', openSettings);
  closeButton.addEventListener('click', closeSettings);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeSettings();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !backdrop.classList.contains('hidden')) closeSettings();
  });

  languageSelect.addEventListener('change', () => {
    const value = languageSelect.value;
    if (value === 'auto') localStorage.removeItem('sv-language');
    else localStorage.setItem('sv-language', value);
    window.location.reload();
  });
})();
