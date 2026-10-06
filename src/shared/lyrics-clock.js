/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Elle yüklenen sözün saati.

   Ekranlar ayrı süreçlerdir. Süreyi her karede yollamak hem geciktirir hem
   pencereleri birbirinden kaydırır. Panel yalnızca oynat, duraklat veya
   durdur deyince bir çıpa yollar: { run, time, epoch }. Her pencere o
   andaki süreyi Date.now() ile hesaplar.

   Çalan parçayı izleme bu saati kullanmaz; orada süre medya oturumundadır.
   Dışa aktarma çıpa kurmaz ve kare zamanında kalır. */
(function () {
  function num(v, fallback) {
    v = Number(v);
    return isFinite(v) ? v : fallback;
  }

  function resolve(anchor, nowMs) {
    if (!anchor || anchor.run === 'stop') return 0;
    const time = Math.max(0, num(anchor.time, 0));
    if (anchor.run !== 'play') return time;
    const elapsed = Math.max(0, (num(nowMs, 0) - num(anchor.epoch, 0)) / 1000);
    return time + elapsed;
  }

  function holder() {
    if (typeof window !== 'undefined') {
      window.SVLyricsRun = window.SVLyricsRun || { anchor: null };
      return window.SVLyricsRun;
    }
    if (!holder.mem) holder.mem = { anchor: null };
    return holder.mem;
  }

  function current() {
    return holder().anchor;
  }

  /* Açık ekrana yeniden uygulamak durmuş sözü baştan oynatır.
     Duraklatma ve süren oynatma yerinde kalır. */
  function startsOnOutput(anchor) {
    return !anchor || anchor.run === 'stop';
  }

  const painters = new Set();
  function apply(anchor) {
    holder().anchor = anchor || null;
    painters.forEach((fn) => {
      try { fn(); } catch { /* düğme kopmuş olabilir */ }
    });
    return holder().anchor;
  }

  function make(run, time, nowMs) {
    return { run: run, time: Math.max(0, num(time, 0)), epoch: num(nowMs, 0) };
  }

  /* play: duraklatılmışsa kaldığı yerden, durmuşsa baştan.
     pause: o andaki sürede kalır. stop: başa alır ve tutar. */
  function command(action, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs;
    const a = current();
    let next;
    if (action === 'stop') next = make('stop', 0, now);
    else if (action === 'pause') next = make('pause', resolve(a, now), now);
    else if (a && a.run === 'pause') next = make('play', a.time, now);
    else if (a && a.run === 'play') next = a;
    else next = make('play', 0, now);
    return apply(next);
  }

  function publish(anchor) {
    apply(anchor);
    const api = typeof window !== 'undefined' ? window.api : null;
    if (api && typeof api.sendLyricsClock === 'function') api.sendLyricsClock(anchor);
    return anchor;
  }

  let installed = false;
  function install(api) {
    if (installed || !api || typeof api.onLyricsClock !== 'function') return;
    installed = true;
    api.onLyricsClock((a) => { apply(a); });
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(num(sec, 0)));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  let tick = 0;
  function controls(opts) {
    const el = opts && opts.el;
    if (!el) return null;
    const label = el('span', {
      class: 'txt-info lyr-clock-time',
      text: formatTime(resolve(current(), Date.now())),
    });
    const paint = () => {
      const run = (current() && current().run) || '';
      const mark = (btn, on, ghost) => {
        if (!btn || !btn.classList) return;
        btn.classList.toggle('primary', !!on);
        btn.classList.toggle('ghost', !!ghost);
      };
      mark(playBtn, run === 'play', false);
      mark(pauseBtn, run === 'pause', false);
      mark(stopBtn, run === 'stop', run !== 'stop');
      label.textContent = formatTime(resolve(current(), Date.now()));
    };
    const go = (action) => {
      publish(command(action, Date.now()));
      paint();
    };
    const playBtn = el('button', {
      class: 'btn small', type: 'button', icon: 'play', text: 'Oynat', onclick: () => go('play'),
    });
    const pauseBtn = el('button', {
      class: 'btn small', type: 'button', icon: 'pause', text: 'Duraklat', onclick: () => go('pause'),
    });
    const stopBtn = el('button', {
      class: 'btn ghost small', type: 'button', icon: 'stop', text: 'Durdur', onclick: () => go('stop'),
    });
    paint();
    const listener = () => {
      if (label.isConnected === false) {
        painters.delete(listener);
        return;
      }
      paint();
    };
    painters.add(listener);
    /* Tek sayaç bütün açık denetimleri boyar. Her denetim kendi sayacını
       kurup öncekini kapatıyordu: iki söz katmanı açıkken yalnız sonuncusunun
       süresi ilerliyordu (#695). */
    if (!tick && typeof document !== 'undefined') {
      tick = setInterval(() => {
        painters.forEach((fn) => {
          try { fn(); } catch { /* düğme kopmuş olabilir */ }
        });
        if (!painters.size) {
          clearInterval(tick);
          tick = 0;
        }
      }, 250);
      if (tick.unref) tick.unref();
    }
    return el('div', { class: 'lyr-clock' }, [
      el('div', { class: 'row' }, [playBtn, pauseBtn, stopBtn, label]),
      el('div', {
        class: 'studio-note dim-hint',
        text: 'Açık ekranlar bu saatle birlikte gider. Durdur başa alır.',
      }),
    ]);
  }

  const api = { resolve, current, apply, command, publish, install, formatTime, controls, startsOnOutput };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLyricsClock = api;
})();
