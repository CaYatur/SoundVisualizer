'use strict';
/* Üst sağ dişli → tek Ayarlar kategorisi.

   Eski modal (settingsBackdrop) kaldırıldı; dil / koruma / geniş aralık /
   güncellemeler sol raydaki Ayarlar kategorisinde. admin.js SVPanel.openSettings
   kaydeder; bu dosya yalnızca tıklamayı oraya iletir. */
(() => {
  const button = document.getElementById('settingsBtn');
  if (!button) return;

  function openUnifiedSettings() {
    if (window.SVPanel && typeof window.SVPanel.openSettings === 'function') {
      window.SVPanel.openSettings();
      return;
    }
    /* admin.js henüz yüklenmediyse bir kez ertelenir. */
    setTimeout(openUnifiedSettings, 0);
  }

  button.addEventListener('click', openUnifiedSettings);
})();