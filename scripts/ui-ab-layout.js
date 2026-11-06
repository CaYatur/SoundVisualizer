/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* A/B fader kutusu ve Timeline "Timeline kullan" düğmesi için gerçek yerleşim denetimi.
   Ölçüm getBoundingClientRect ile yapılır: etiket satırı, sürgü ve A/Orta/B satırı
   ayrı satırlarda, kutu içinde ve birbirine değmeden durmalı. Sürgü uçları ve Orta
   düğmesi değeri gerçekten değiştirmeli. Ekran görüntüsü görünür alan dışındaysa HATA.
   Kullanım: xvfb-run -a node scripts/ui-ab-layout.js [--lang=tr-TR] [--out=dir] [--themes=all] */
const fs = require('fs');
const path = require('path');
const { sleep, startPanel } = require('./ui-lib');

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const LANG = arg('lang', 'en-US');
const OUT = arg('out', '');
const THEMES = arg('themes', 'all') === 'all' ? require('../src/shared/ui-themes.js').THEMES.map((t) => t.id) : arg('themes').split(',');
const WIDTHS = [260, 340, 480];
const VW = 1600, VH = 900;
const tag = LANG.slice(0, 2);
if (OUT) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const s = await startPanel({ port: 9831 + (tag === 'tr' ? 1 : 0), lang: LANG });
  const { a } = s;
  const q = (x) => a.ev(x);
  const fails = [];
  const rows = [];
  let shots = 0;
  // Görünür alan içinde değilse ya da boşsa başarısız say
  async function shot(name, r) {
    if (!OUT) return;
    const c = { x: Math.max(0, Math.floor(r.x - 10)), y: Math.max(0, Math.floor(r.y - 10)), width: Math.ceil(r.w + 20), height: Math.ceil(r.h + 20) };
    // Öğenin kendisi görünür alanda olmalı; yalnız kenar payı kırpılır
    if (r.w < 4 || r.h < 4 || r.x < 0 || r.y < 0 || r.x + r.w > VW + 0.5 || r.y + r.h > VH + 0.5) { fails.push(`${name}: kırpma görünür alan dışında ${JSON.stringify(c)}`); return; }
    c.width = Math.min(c.width, VW - c.x); c.height = Math.min(c.height, VH - c.y);
    const res = await a.call('Page.captureScreenshot', { format: 'png', clip: Object.assign({ scale: 1 }, c) });
    const buf = Buffer.from(res.result.data, 'base64');
    if (buf.length < 1500) { fails.push(`${name}: görüntü boş görünüyor (${buf.length} B)`); return; }
    fs.writeFileSync(path.join(OUT, name + '.png'), buf); shots++;
  }
  const MEASURE = `(() => {
    const box = window.__xfHost.querySelector('.xf-box');
    if (!box) return { missing: true };
    box.scrollIntoView({ block: 'center' });
    const R = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
    const lab = box.querySelector(':scope > .row:not(.xf-btns)');
    const tags = [...lab.children].map(R);
    const btns = [...box.querySelectorAll('.xf-btns > button')].map((b) => Object.assign(R(b), { sw: b.scrollWidth, cw: b.clientWidth }));
    return { box: R(box), disp: getComputedStyle(box).display, sw: box.scrollWidth, cw: box.clientWidth,
      lab: R(lab), tags, grp: [...window.__xfHost.querySelectorAll('.grp-item > .row')].map((r) => [...r.children].map(R)), slider: R(box.querySelector('.xf-slider')), btnRow: R(box.querySelector('.xf-btns')), btns };
  })()`;
  const ov = (p, r) => p.x < r.r - 0.5 && r.x < p.r - 0.5 && p.y < r.b - 0.5 && r.y < p.b - 0.5;
  const inside = (p, o) => p.x >= o.x - 0.5 && p.r <= o.r + 0.5 && p.y >= o.y - 0.5 && p.b <= o.b + 0.5;
  function check(id, m) {
    const f = [];
    if (m.missing) { fails.push(id + ': xf-box yok'); return; }
    if (m.disp !== 'flex') f.push('display=' + m.disp);
    if (m.sw > m.cw + 1) f.push(`yatay taşma ${m.sw}>${m.cw}`);
    const parts = [['etiket', m.lab], ['sürgü', m.slider], ['düğmeler', m.btnRow]];
    for (const [n, r] of parts) if (!inside(r, m.box)) f.push(n + ' kutu dışında');
    if (!(m.lab.b <= m.slider.y + 0.5)) f.push('etiket satırı sürgüyle aynı satırda/üst üste');
    if (!(m.slider.b + 2 <= m.btnRow.y)) f.push(`sürgü ile düğmeler arası boşluk yok (${(m.btnRow.y - m.slider.b).toFixed(1)})`);
    // İç boşluk: A/B etiketleri ve sürgü kutu kenarına yapışmamalı
    if (m.tags[0].x - m.box.x < 5 || m.box.r - m.tags[m.tags.length - 1].r < 5) f.push('etiketler kenara yapışık');
    if (m.slider.x - m.box.x < 5 || m.box.r - m.slider.r < 5) f.push('sürgü kenara yapışık');
    const inner = m.cw - 18;
    if (m.slider.w < inner * 0.95) f.push(`sürgü dar ${m.slider.w.toFixed(0)}/${inner}`);
    for (let i = 0; i < m.tags.length; i++) for (let j = i + 1; j < m.tags.length; j++) if (ov(m.tags[i], m.tags[j])) f.push('etiketler çakışıyor');
    for (let i = 0; i < m.btns.length; i++) {
      if (m.btns[i].w < 24) f.push('düğme çok dar ' + m.btns[i].w);
      if (m.btns[i].sw > m.btns[i].cw + 1) f.push('düğme yazısı kesik');
      if (ov(m.btns[i], m.slider)) f.push('düğme sürgüye biniyor');
      for (let j = i + 1; j < m.btns.length; j++) if (ov(m.btns[i], m.btns[j])) f.push('düğmeler çakışıyor');
    }
    for (const g of m.grp || []) for (let i = 0; i + 1 < g.length; i++) if (g[i + 1].x - g[i].r < 4) f.push('grup satırı öğeleri yapışık/çakışık');
    rows.push({ id, boxW: +m.box.w.toFixed(1), sliderW: +m.slider.w.toFixed(1), rowGap: +(m.btnRow.y - m.slider.b).toFixed(1), labToSlider: +(m.slider.y - m.lab.b).toFixed(1), btnW: m.btns.map((b) => +b.w.toFixed(1)), ok: !f.length });
    if (f.length) fails.push(id + ': ' + [...new Set(f)].join('; '));
  }
  try {
    await sleep(1200);
    await a.call('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
    await q("window.SVPanel.setCategory('scene'); 1");
    await sleep(800);
    await q(`(() => { const cfg = window.SVPanel.cfg(); cfg.crossfade = cfg.crossfade || {}; cfg.crossfade.enabled = true; cfg.crossfade.value = 0.35;
      const L = cfg.layers || (cfg.layers = []);
      for (const g of ['A', 'B']) if (!L.some((l) => l && l.group === g)) { const l = window.SVLayers.normalizeLayer({ kind: 'visualizer', type: 'bars', name: 'Grp ' + g }); l.group = g; L.push(l); }
      window.SVSceneShell.select(''); window.SVPanel.apply(); return 1; })()`);
    await sleep(900);
    const st = "(() => { let s = document.getElementById('__w'); if (!s) { s = document.createElement('style'); s.id = '__w'; document.head.appendChild(s); } return s; })()";
    for (const host of ['insp', 'shelf']) {
      if (host === 'shelf') { await q("window.SVSceneShell.setShelf('groups'); 1"); await sleep(900); }
      for (const w of WIDTHS) {
        for (const th of THEMES) {
          await q(`(() => { window.SVUiThemes.apply(document, '${th}'); const s = ${st};
            s.textContent = '${host === 'insp' ? '#svInspector{width:' + w + 'px!important;min-width:' + w + 'px!important;max-width:' + w + 'px!important;flex:none!important}' : '#svShelf .grp-panel{width:' + (w - 54) + 'px!important;max-width:' + (w - 54) + 'px!important}'}';
            window.__xfHost = document.getElementById('${host === 'insp' ? 'svInspector' : 'svShelf'}'); return 1; })()`);
          await sleep(120);
          const m = JSON.parse(await q('JSON.stringify(' + MEASURE + ')'));
          const id = `${tag}/${host}/${w}/${th}`;
          check(id, m);
          if (th === THEMES[0] && !m.missing) await shot(`ab-${tag}-${host}-${w}`, { x: m.box.x, y: m.lab.y - 30, w: m.box.w, h: m.box.b - m.lab.y + 30 });
        }
      }
      // Etkileşim: sürgü uçları ve Orta düğmesi (yalnız ilk tema, 260px)
      await q(`(() => { window.SVUiThemes.apply(document, '${THEMES[0]}'); ${st}.textContent = '${host === 'insp' ? '#svInspector{width:260px!important;min-width:260px!important;max-width:260px!important;flex:none!important}' : '#svShelf .grp-panel{width:206px!important}'}'; return 1; })()`);
      await sleep(150);
      const m = JSON.parse(await q('JSON.stringify(' + MEASURE + ')'));
      const val = () => q('window.SVPanel.cfg().crossfade.value');
      const drag = async (x) => {
        const y = m.slider.y + m.slider.h / 2;
        await a.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: m.slider.x + m.slider.w / 2, y, button: 'left', clickCount: 1 });
        await a.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' });
        await a.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        await sleep(150);
      };
      await drag(m.slider.x - 30); const v0 = await val();
      await drag(m.slider.r + 30); const v1 = await val();
      const clickBtn = async (i) => {
        const b = JSON.parse(await q(`JSON.stringify((() => { const r = window.__xfHost.querySelectorAll('.xf-btns > button')[${i}].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })())`));
        for (const type of ['mousePressed', 'mouseReleased']) await a.call('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 });
        await sleep(400);
      };
      await clickBtn(1); const vm = await val();
      await clickBtn(0); const va = await val();
      await clickBtn(2); const vb = await val();
      const inter = { host, v0, v1, vm, va, vb };
      rows.push({ id: `${tag}/${host}/interaction`, ...inter });
      if (!(v0 <= 0.01 && v1 >= 0.99 && Math.abs(vm - 0.5) < 0.01 && va === 0 && vb === 1)) fails.push(`${tag}/${host} etkileşim: ${JSON.stringify(inter)}`);
    }
    await q(`(() => { document.getElementById('__w').textContent = ''; window.SVUiThemes.apply(document, '${THEMES[0]}'); return 1; })()`);

    // Timeline araç çubuğu: "Timeline kullan" düğmesi yazısı içinde kalmalı, komşuya binmemeli
    await q("window.SVPanel.setCategory('time'); 1");
    await sleep(1200);
    for (const vw of [900, 1100, 1400]) {
      await a.call('Emulation.setDeviceMetricsOverride', { width: vw, height: VH, deviceScaleFactor: 1, mobile: false });
      await sleep(400);
      const t = JSON.parse(await q(`JSON.stringify((() => {
        const b = document.querySelector('.tl-toolbar .tl-use');
        if (!b) return { missing: true };
        const R = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
        const rg = document.createRange(); rg.selectNodeContents(b); const tr = rg.getBoundingClientRect();
        const ctrls = [...document.querySelectorAll('.tl-toolbar button, .tl-toolbar select, .tl-toolbar input, .tl-toolbar .tl-time, .tl-toolbar .tl-bars')].filter((n) => n !== b && !b.contains(n) && n.offsetParent).map(R);
        return { btn: R(b), text: { x: tr.x, y: tr.y, w: tr.width, h: tr.height, r: tr.right, b: tr.bottom }, ctrls, label: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), on: b.classList.contains('on'), tb: R(document.querySelector('.tl-toolbar')) };
      })())`));
      const id = `${tag}/timeline/${vw}`;
      if (t.missing) { fails.push(id + ': Timeline kullan anahtarı yok'); continue; }
      const f = [];
      if (!inside(t.text, t.btn)) f.push(`yazı düğme dışında (yazı ${t.text.w.toFixed(0)} / düğme ${t.btn.w.toFixed(0)})`);
      const hit = t.ctrls.filter((c) => ov(t.btn, c) || ov(t.text, c));
      if (hit.length) f.push(hit.length + ' komşu denetimle çakışıyor');
      if (t.on) f.push('varsayılan açık');
      rows.push({ id, label: t.label, btnW: +t.btn.w.toFixed(1), textW: +t.text.w.toFixed(1), neighbors: t.ctrls.length, overlaps: hit.length, ok: !f.length });
      if (f.length) fails.push(id + ': ' + f.join('; '));
      if (vw === 1400 || vw === 900) await shot(`tl-use-${tag}-${vw}`, { x: Math.max(t.btn.x - 220, t.tb.x), y: t.btn.y - 6, w: Math.min(520, t.tb.r - Math.max(t.btn.x - 220, t.tb.x)), h: t.btn.h + 12 });
    }
  } catch (e) { fails.push(String(e && e.stack || e)); }
  await s.stop();
  if (OUT) fs.writeFileSync(path.join(OUT, `ab-layout-${tag}.json`), JSON.stringify({ rows, fails, shots }, null, 2));
  const okN = rows.filter((r) => r.ok !== false).length;
  if (fails.length) { console.error(`ui-ab-layout ${tag}: FAIL ${fails.length} (${okN}/${rows.length} ok)\n` + fails.join('\n')); process.exit(1); }
  console.log(`ui-ab-layout ${tag}: OK ${rows.length} durum, ${shots} görüntü`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
