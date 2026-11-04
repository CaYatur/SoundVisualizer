/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Zaman çizelgesi tek tık seçimi ve hedef seçici (#957). Farklı parçalarda üst üste binen
// ve kimliği YİNELENEN klipler (eski oturumdan clip_1 + yeni eklenen clip_1): tek tık tek
// klip seçmeli; hedef listesinde her klip bir kez, okunur adla, parça başlığı altında.
const { sleep, startPanel } = require('./ui-lib');

(async () => {
  const s = await startPanel({ port: 9804 });
  const { a } = s;
  const fails = [];
  const q = (x) => a.ev(x);
  const click = async (p, mods) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await a.call('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: mods || 0 });
    }
    await sleep(150);
  };
  try {
    await sleep(1500);
    await q("window.SVPanel.setCategory('time'); 1");
    await sleep(800);
    await q(`(() => { const P = window.SVPanel, cfg = P.cfg();
      cfg.scenes = [{ id: 'sc_mtwap43geca5', name: 'Sahne 23', data: { layers: [] } }, { id: 'sc_b', name: 'Sahne 3', data: { layers: [] } }, { id: 'sc_c', name: 'Test Nokta', data: { layers: [] } }];
      cfg.timeline = cfg.timeline || {}; cfg.timeline.enabled = true;
      cfg.timeline.tracks = [
        { id: 'trk_1', kind: 'clip', name: 'Parça 1', clips: [{ id: 'clip_1', type: 'scene', ref: 'sc_mtwap43geca5', start: 0, dur: 4 }, { id: 'clip_2', type: 'scene', ref: 'sc_b', start: 4, dur: 4 }] },
        { id: 'trk_2', kind: 'clip', name: 'Parça 2', clips: [{ id: 'clip_1', type: 'scene', ref: 'sc_c', start: 1, dur: 5 }] },
        { id: 'trk_3', kind: 'automation', target: '', keys: [] },
      ];
      P.rerender && P.rerender(); return 1; })()`);
    await sleep(900);
    const ids = JSON.parse(await q("JSON.stringify(window.SVTimelinePanel.transport().tl.tracks.flatMap((t) => (t.clips || []).map((c) => c.id)))"));
    if (new Set(ids).size !== ids.length) fails.push('yinelenen klip kimliği kaldı: ' + ids.join(','));
    // Yeni klip mevcut sonekin üstünde kimlik almalı
    const fresh = await q("window.SVTimeline.makeClip({ type: 'scene', ref: 'sc_b', start: 9, dur: 1 }).id");
    if (ids.includes(fresh)) fails.push('yeni klip var olan kimliği aldı: ' + fresh);

    for (const [ti, ci] of [[0, 0], [1, 0], [0, 1]]) {
      const p = JSON.parse(await q(`JSON.stringify(window.SVTimelinePanel._clipPoint(${ti}, ${ci}))`));
      if (!p) { fails.push('klip noktası yok ' + ti + '/' + ci); continue; }
      await click(p);
      const picked = JSON.parse(await q('JSON.stringify(window.SVTimelinePanel._picked())'));
      const head = await q("(document.querySelector('.tl-insp-head') || {}).textContent || ''");
      if (picked.length !== 1) fails.push(`tek tık ${ti}/${ci}: ${picked.length} klip seçili (${picked.join(',')})`);
      if (/klip seçili|clips selected/.test(head)) fails.push(`tek tık ${ti}/${ci}: denetçi çoklu seçim gösteriyor`);
    }
    // Ctrl+tık ekler, sonra düz tık yine tek seçime döner
    const p0 = JSON.parse(await q('JSON.stringify(window.SVTimelinePanel._clipPoint(0, 0))'));
    const p1 = JSON.parse(await q('JSON.stringify(window.SVTimelinePanel._clipPoint(1, 0))'));
    await click(p0); await click(p1, 2);
    const two = JSON.parse(await q('JSON.stringify(window.SVTimelinePanel._picked())'));
    if (two.length !== 2) fails.push('Ctrl+tık seçime eklemedi: ' + two.length);
    await click(JSON.parse(await q('JSON.stringify(window.SVTimelinePanel._clipPoint(0, 1))')));
    const one = JSON.parse(await q('JSON.stringify(window.SVTimelinePanel._picked())'));
    if (one.length !== 1) fails.push('düz tık seçimi değiştirmedi: ' + one.length);

    // Hedef kataloğu: okunur ad, tekil yol
    const cat = JSON.parse(await q("JSON.stringify(window.SVTimelinePanel._catalog().filter((c) => /^tl\\.clip\\./.test(c.path)))"));
    const paths = cat.map((c) => c.path);
    if (new Set(paths).size !== paths.length) fails.push('hedef listesinde yinelenen yol');
    if (cat.length !== 3) fails.push('klip hedefi sayısı ' + cat.length);
    for (const c of cat) {
      if (/sc_|clip_/.test(c.label)) fails.push('ham kimlik etikette: ' + c.label);
      if (!/— Parça \d · \d+:\d\d–\d+:\d\d$/.test(c.label)) fails.push('etiket biçimi: ' + c.label);
    }
    const hit = JSON.parse(await q("JSON.stringify(window.SVTimeline && window.SVTimelineEdit ? window.SVTimelineEdit.filterTargets(window.SVTimelinePanel._catalog(), 'test nokta').map((c) => c.path) : null)"));
    if (hit && !hit.some((p) => /^tl\.clip\./.test(p))) fails.push('klip adıyla arama bulmadı');
  } catch (e) { fails.push(String(e && e.message || e)); }
  s.stop();
  if (fails.length) { console.error('FAIL\n' + fails.join('\n')); process.exit(1); }
  console.log('ui-tlselect: OK');
  process.exit(0);
})();
