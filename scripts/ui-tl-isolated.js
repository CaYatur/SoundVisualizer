/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Gerçek panelde "Timeline kullan" + klip düzenleme hedefi.
   - Anahtar görünür, varsayılan kapalı; açınca kafa yerinde, oynatma başlamaz.
   - 0'da görselleştirici yok → ileri (5 sn, Görselleştirici klibi) → Durdur → 0: fazladan katman yok.
   - Sahne klibini tıkla → Sahne sayfası: hedef bandı + normal katman listesi klibin kopyası.
   - "Ekle" menüsünden gerçek katman ekle → yalnız klibin alt katmanı; kaynak sahne ve elle ayar aynı.
   - Hedef değiştir, Geri al/İleri al kapsamı, kapat → elle ayar birebir.
   - Otomatik klip adları arayüz dilinde.
   Kullanım: xvfb-run -a node scripts/ui-tl-isolated.js --lang=en-US --out=DIR */
const fs = require('fs');
const path = require('path');
const { sleep, startPanel } = require('./ui-lib');

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const LANG = arg('lang', 'en-US');
const OUT = arg('out', '');
const PORT = Number(arg('port', LANG.startsWith('tr') ? 9852 : 9851));

(async () => {
  const s = await startPanel({ port: PORT, lang: LANG });
  const { a } = s;
  const q = (x) => a.ev(x);
  const J = async (x) => JSON.parse(await q('JSON.stringify(' + x + ')'));
  const fails = [];
  const log = {};
  const tag = LANG.slice(0, 2);
  async function shot(name, sel, vw) {
    if (!OUT) return;
    const r = await J(`(() => { const n = ${sel}; if (!n) return null; const b = n.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
    if (!r || r.w < 4 || r.h < 4) { fails.push(name + ': öğe görünmüyor'); return; }
    const c = { x: Math.max(0, Math.floor(r.x - 6)), y: Math.max(0, Math.floor(r.y - 6)), width: Math.ceil(Math.min(r.w + 12, vw)), height: Math.ceil(Math.min(r.h + 12, 900)) };
    const res = await a.call('Page.captureScreenshot', { format: 'png', clip: Object.assign({ scale: 1 }, c) });
    fs.writeFileSync(path.join(OUT, `${name}-${tag}-${vw}.png`), Buffer.from(res.result.data, 'base64'));
  }
  const click = async (p) => {
    for (const type of ['mousePressed', 'mouseReleased']) await a.call('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await sleep(250);
  };
  const manualSig = "JSON.stringify(window.SVSchema.SCENE_KEYS.map((k) => [k, window.SVPanel.cfg()[k]]))";
  try {
    await sleep(1500);
    await a.call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await q("window.SVPanel.setCategory('time'); 1");
    await sleep(800);
    await q(`(() => { const P = window.SVPanel, cfg = P.cfg();
      cfg.layerStack = { enabled: true };
      cfg.layers = [window.SVLayers.normalizeLayer({ id: 'man_vis', name: 'Manual', kind: 'visualizer', type: 'circular' })];
      cfg.scenes = (cfg.scenes || []).filter((x) => x.id !== 'sc_sad').concat([{ id: 'sc_sad', name: 'Sad', data: { layerStack: { enabled: true }, layers: [
        window.SVLayers.normalizeLayer({ id: 's_bg', name: 'BG', kind: 'background', type: 'gradient' }) ] } }]);
      Object.assign(cfg.timeline, { enabled: true, loop: { enabled: false, start: 0, end: 0 }, tracks: [
        { id: 'trV', kind: 'clip', name: 'V', clips: [{ id: 'cVis', type: 'visualizer', ref: 'wave', start: 4, dur: 2 }] },
        { id: 'trP', kind: 'clip', name: 'P', clips: [{ id: 'cPal', type: 'palette', ref: 'Orman', start: 6.5, dur: 1 }] },
        { id: 'trS', kind: 'clip', name: 'S', clips: [{ id: 'cS1', type: 'scene', ref: 'sc_sad', start: 0, dur: 8 }, { id: 'cS2', type: 'scene', ref: 'sc_sad', start: 10, dur: 2 }] },
      ] });
      delete cfg.timeline.useTimeline;
      P.apply(); P.rerender && P.rerender(); return 1; })()`);
    await sleep(900);
    const manual0 = await q(manualSig);
    // 1) anahtar
    const sw = await J(`(() => { const b = document.querySelector('.tl-toolbar .tl-use'); return b && { text: b.textContent.trim(), checked: b.getAttribute('aria-checked'), role: b.getAttribute('role') }; })()`);
    log.switch = sw;
    if (!sw) fails.push('Timeline kullan anahtarı yok');
    else {
      if (sw.checked !== 'false') fails.push('anahtar varsayılan kapalı değil');
      if (tag === 'en' && sw.text !== 'Use Timeline') fails.push('EN anahtar metni: ' + sw.text);
      if (tag === 'tr' && sw.text !== 'Timeline kullan') fails.push('TR anahtar metni: ' + sw.text);
    }
    if (await q("!!document.querySelector('.tl-toolbar .tl-liveedit')")) fails.push('Anında Uygula düğmesi hâlâ var');
    for (const vw of [1400, 900]) {
      await a.call('Emulation.setDeviceMetricsOverride', { width: vw, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(500);
      await shot('toolbar-off', "document.querySelector('.tl-toolbar')", vw);
    }
    await a.call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    // OFF: klip seçimi çıkışa/elle ayara dokunmaz
    let p = await J('window.SVTimelinePanel._clipPoint(2, 0)');
    await click(p);
    await sleep(300);
    if (await q(manualSig) !== manual0) fails.push('OFF: klip seçimi elle ayarı değiştirdi');
    if (await q('!!window.SVPanel.cfg().timeline.editTarget')) fails.push('OFF: düzenleme hedefi açıldı');
    // 2) aç: kafa yerinde, oynatma yok
    await q('window.SVTimelinePanel._select(null); window.SVTimelinePanel.seek(0); 1');
    await sleep(200);
    await q("document.querySelector('.tl-toolbar .tl-use').click(); 1");
    await sleep(400);
    const on = await J("({ on: window.SVPanel.cfg().timeline.useTimeline, playing: window.SVTimelinePanel.transport().playing, t: window.SVTimelinePanel.transport().time, aria: document.querySelector('.tl-toolbar .tl-use').getAttribute('aria-checked') })");
    log.on = on;
    if (on.on !== true || on.playing || on.t !== 0 || on.aria !== 'true') fails.push('açma: ' + JSON.stringify(on));
    for (const vw of [1400, 900]) {
      await a.call('Emulation.setDeviceMetricsOverride', { width: vw, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(500);
      await shot('toolbar-on', "document.querySelector('.tl-toolbar')", vw);
    }
    await a.call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    // 3) geri sarma (gerçek oynatma, sonra Durdur)
    const vis = "window.SVTimelinePanel.composeNow().cfg.layers.filter((l) => l.kind === 'visualizer').map((l) => l.type)";
    log.t0 = await J(vis);
    await q('window.SVTimelinePanel.seek(3.8); window.SVTimelinePanel.play(); 1');
    await sleep(900);
    log.playing = await J(vis);
    await q("window.SVTimelinePanel.stop(); 1");
    await sleep(300);
    log.afterStop = await J(vis);
    log.timeAfterStop = await J('window.SVTimelinePanel.transport().time');
    if (log.t0.length) fails.push('0 sn: görselleştirici olmamalı ' + log.t0);
    if (!log.playing.includes('wave')) fails.push('oynarken Görselleştirici klibi yok: ' + log.playing);
    if (log.afterStop.length) fails.push('durdur+başa: fazladan görselleştirici kaldı ' + log.afterStop);
    log.previewDebug = await J('window.SVShowDebug || null');
    if (await q(manualSig) !== manual0) fails.push('ON oynatma elle ayarı değiştirdi');
    // 4) gelecekteki klibi seç (10–12): hedef, çıkışta görünmez
    p = await J('window.SVTimelinePanel._clipPoint(2, 1)');
    if (!p || p.x > 1390) { await q("window.SVTimelinePanel._select({ kind: 'clip', trackId: 'trS', clipId: 'cS2' }); window.SVTimelinePanel._followTarget(); 1"); }
    else await click(p);
    await sleep(500);
    log.target = await J('window.SVPanel.cfg().timeline.editTarget || null');
    if (!log.target || log.target.clipId !== 'cS2') fails.push('hedef cS2 değil: ' + JSON.stringify(log.target));
    if ((await J(vis)).length) fails.push('seçim çıkışa sızdı');
    // 5) Sahne sayfası: bant + normal katman listesi
    await q("window.SVPanel.setCategory('scene'); 1");
    await sleep(900);
    const banner = await J("(() => { const b = document.getElementById('tlEditBanner'); return b && !b.hidden ? b.textContent : null; })()");
    log.banner = banner;
    if (!banner) fails.push('hedef bandı görünmüyor');
    const rows = await J("[...document.querySelectorAll('.sv-lt')].map((r) => r.getAttribute('data-id'))");
    log.rowsBefore = rows;
    if (!rows.includes('s_bg') || rows.includes('man_vis')) fails.push('katman listesi klibin kopyası değil: ' + rows);
    for (const vw of [1400, 900]) {
      await a.call('Emulation.setDeviceMetricsOverride', { width: vw, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(600);
      await shot('banner', "document.getElementById('tlEditBanner')", vw);
      await shot('scene-page', "document.querySelector('.workspace')", vw);
    }
    await a.call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    // 6) gerçek "Ekle" menüsü → ilk katman türü
    const addBtn = await J("(() => { const b = [...document.querySelectorAll('.sv-chead button')].find((x) => x.offsetParent && /^(Ekle|Add)$/.test(x.textContent.trim())); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
    if (!addBtn) fails.push('Ekle düğmesi yok');
    else {
      await click(addBtn);
      await sleep(400);
      const item = await J("(() => { const m = document.querySelector('.sv-menu.sv-add'); const b = m && [...m.querySelectorAll('button')].find((x) => x.offsetParent); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: b.textContent.trim() }; })()");
      log.addItem = item && item.t;
      if (!item) fails.push('Katman Ekle menüsü boş');
      else { await click(item); await sleep(700); }
    }
    const after = await J("(() => { const c = window.SVPanel.cfg(); const cl = c.timeline.tracks[2].clips.find((x) => x.id === 'cS2'); return { panel: c.layers.map((l) => l.id), local: cl.local && cl.local.data.layers.map((l) => l.id), source: c.scenes.find((s) => s.id === 'sc_sad').data.layers.map((l) => l.id), tracks: c.timeline.tracks.length }; })()");
    log.afterAdd = after;
    const child = after.panel.find((id) => id !== 's_bg');
    if (!child) fails.push('panelden katman eklenmedi');
    if (!after.local || !after.local.includes(child)) fails.push('yeni katman klibin kopyasında değil');
    if (after.source.length !== 1) fails.push('kaynak sahne değişti: ' + after.source);
    if (after.tracks !== 3) fails.push('ilgisiz çizelge parçası eklendi');
    await shot('scene-page-added', "document.querySelector('.workspace')", 1400);
    // alt katman yalnız klip aralığında
    const at = async (t) => { await q(`window.SVTimelinePanel.seek(${t}); 1`); return J("window.SVTimelinePanel.composeNow().cfg.layers.map((l) => l.id)"); };
    const in11 = await at(11); const in2 = await at(2); const in12 = await at(12.5);
    log.child = { in11, in2, in12 };
    if (!in11.some((id) => id.endsWith(child))) fails.push('alt katman klip aralığında yok');
    if (in2.some((id) => id.endsWith(child))) fails.push('alt katman aynı kaynağın diğer klibine sızdı');
    if (in12.length) fails.push('klip bitince siyah değil');
    // 7) geri al kapsamı
    await q('window.SVUndoHistory.settleNow(); 1');
    await q("document.getElementById('undoBtn').click(); 1"); await sleep(400);
    const undone = await J("window.SVPanel.cfg().timeline.tracks[2].clips.find((x) => x.id === 'cS2').local.data.layers.length");
    await q("document.getElementById('redoBtn').click(); 1"); await sleep(400);
    const redone = await J("window.SVPanel.cfg().timeline.tracks[2].clips.find((x) => x.id === 'cS2').local.data.layers.length");
    log.undo = { undone, redone };
    if (undone !== 1 || redone !== 2) fails.push('geri al/ileri al klip kopyasında: ' + JSON.stringify(log.undo));
    // 8) hedef değiştir → cS1 (kendi kopyası), sonra bitir → elle ayar birebir
    await q("window.SVPanel.setCategory('time'); 1"); await sleep(600);
    await q("window.SVTimelinePanel._select({ kind: 'clip', trackId: 'trS', clipId: 'cS1' }); window.SVTimelinePanel._followTarget(); 1"); await sleep(300);
    const s1 = await J('window.SVPanel.cfg().layers.map((l) => l.id)');
    if (s1.length !== 1 || s1[0] !== 's_bg') fails.push('cS1 hedefinde cS2 alt katmanı göründü: ' + s1);
    if (await q('window.SVUndoHistory.canUndo()')) fails.push('cS1 kapsamında cS2 geri al adımı var');
    await q("document.querySelector('#tlEditBanner .btn').click(); 1"); await sleep(400);
    if (await q(manualSig) !== manual0) fails.push('Bitir sonrası elle ayar birebir değil');
    // 9) kapat: kafa korunur, duraklar, elle ayar birebir; kaydet/yükle
    await q("window.SVTimelinePanel.seek(5.25); window.SVTimelinePanel.play(); 1"); await sleep(300);
    await q("document.querySelector('.tl-toolbar .tl-use').click(); 1"); await sleep(400);
    const off = await J("({ on: window.SVPanel.cfg().timeline.useTimeline, playing: window.SVTimelinePanel.transport().playing, t: window.SVTimelinePanel.transport().time })");
    log.off = off;
    if (off.on !== false || off.playing || off.t < 5.25) fails.push('kapatma: ' + JSON.stringify(off));
    if (await q(manualSig) !== manual0) fails.push('kapatınca elle ayar birebir değil');
    await sleep(2500); // ana süreç kaydı (birleştirme gecikmesi)
    // Diskteki ayar dosyası: alt katman klibin kopyasıyla kalıcı, elle ayar birebir
    let disk = null;
    try { disk = JSON.parse(fs.readFileSync(path.join(s.work, 'ud', 'settings.json'), 'utf8')); } catch (e) { disk = null; }
    const dc = disk && disk.timeline && disk.timeline.tracks && disk.timeline.tracks[2] && disk.timeline.tracks[2].clips.find((x) => x.id === 'cS2');
    log.savedHasChild = !!(dc && dc.local && dc.local.data.layers.length === 2);
    log.savedManual = disk ? (disk.layers || []).map((l) => l.id) : null;
    log.savedNoSession = disk ? !disk.timeline.editTarget && !disk.timeline.manualBaseline : null;
    if (disk && JSON.stringify(log.savedManual) !== '["man_vis"]') fails.push('kayıtlı elle katmanlar değişti: ' + log.savedManual);
    if (!log.savedHasChild) fails.push('alt katman kayda geçmedi');
    // 10) otomatik etiketler arayüz dilinde
    log.labels = await J("window.SVPanel.cfg().timeline.tracks.flatMap((t) => t.clips.map((c) => window.SVTimelinePanel._clipLabel(Object.assign({}, c, { name: '' }))))");
    if (tag === 'en' && log.labels.some((x) => /Orman|Dalga|Sahne/.test(x))) fails.push('EN etiketlerde Türkçe: ' + log.labels);
  } catch (e) { fails.push(String(e && e.stack || e)); }
  await s.stop();
  console.log(JSON.stringify(log, null, 1));
  if (fails.length) { console.error('FAIL\n' + fails.join('\n')); process.exit(1); }
  console.log('ui-tl-isolated: OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
