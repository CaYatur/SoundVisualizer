'use strict';
/* Katman kartındaki segmentler (ör. Bar "Dolgu": Düz / Dikey Degrade)
 * tıklanınca seçili düğme hemen değişmeli. onAfter (yeniden çizim)
 * verilmeyenlerde eski active sınıfı kategori değiştirip dönene kadar
 * takılı kalıyordu.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'scene-panels.js'), 'utf8');
const slice = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
const attachSrc = slice('function attachDefault', 'function moveItem');
const segSrc = slice('function miniSegment', 'function isWindowsPlatform');

function fakeEl(tag, props, kids) {
  const cls = new Set(String((props && props.class) || '').split(/\s+/).filter(Boolean));
  const node = {
    tag, props: props || {}, children: [], attrs: {},
    classList: {
      add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
      toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; },
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
    querySelector(sel) {
      const walk = (n) => {
        for (const c of n.children || []) {
          if (sel === 'label.lbl' && c.tag === 'label') return c;
          const r = walk(c); if (r) return r;
        }
        return null;
      };
      return walk(this);
    },
    click() { if (this.props.onclick) this.props.onclick({ preventDefault() {}, stopPropagation() {} }); },
  };
  for (const k of kids || []) node.children.push(k);
  return node;
}

function build(onAfter, def) {
  const state = { val: 'flat', pushes: 0, ctrls: [] };
  const P = () => ({ el: fakeEl, push: () => { state.pushes++; for (const c of state.ctrls) if (c._svSyncModified) c._svSyncModified(); } });
  // eslint-disable-next-line no-new-func
  const make = new Function('P', 'window', attachSrc + '\n' + segSrc + '\nreturn miniSegment;')(P, {});
  const ctrl = make('Dolgu', [['flat', 'Düz'], ['gradient', 'Dikey Degrade']],
    () => state.val, (v) => { state.val = v; }, onAfter, def);
  state.ctrls.push(ctrl);
  const seg = ctrl.children.find((c) => c.props.class === 'segment');
  return { state, ctrl, btns: seg.children };
}

test('miniSegment: onAfter olmadan seçili düğme anında değişir', () => {
  const { state, btns } = build(null, 'flat');
  assert.ok(btns[0].classList.contains('active'));
  btns[1].click();
  assert.strictEqual(state.val, 'gradient');
  assert.ok(btns[1].classList.contains('active'), 'Dikey Degrade seçili görünmeli');
  assert.ok(!btns[0].classList.contains('active'), 'Düz artık seçili görünmemeli');
  btns[0].click();
  assert.ok(btns[0].classList.contains('active'));
  assert.ok(!btns[1].classList.contains('active'), 'Dikey Degrade takılı kalmamalı');
  assert.strictEqual(state.pushes, 2);
});

test('miniSegment: değer dışarıdan değişince push sonrası seçim eşitlenir', () => {
  const { state, btns, ctrl } = build(null, 'flat');
  state.val = 'gradient';
  ctrl._svSyncModified();
  assert.ok(btns[1].classList.contains('active'));
  assert.ok(!btns[0].classList.contains('active'));
});

test('miniSegment: varsayılansız segment de anında güncellenir', () => {
  const { btns } = build(null, undefined);
  btns[1].click();
  assert.ok(btns[1].classList.contains('active') && !btns[0].classList.contains('active'));
});

/* Yeni katman: defaults.js bar yerleşimini null bırakır (barSpan,
 * barCenterX, barHeight, baseline). Panel bunu %0 gösterip sıfırlama
 * rozeti çıkarıyordu; çizici ise kendi varsayılanıyla çiziyordu. */
test('katman paneli: null değer etkili varsayılana düşer, %0 olmaz', () => {
  const getters = src.match(/const getV = \(k, fallback\) => [^\n]+/g) || [];
  assert.ok(getters.length >= 3);
  for (const g of getters) assert.doesNotMatch(g, /!== undefined/, 'getV null değeri değer saymamalı');
  // eslint-disable-next-line no-new-func
  const mk = (vs, defVis) => new Function('vs', 'defVis', getters[0] + '; return getV;')(vs, defVis);
  const getV = mk({}, { barSpan: null, barCenterX: null, barHeight: null, baseline: null });
  assert.strictEqual(getV('barSpan', 1), 1);
  assert.strictEqual(getV('barCenterX', 0.5), 0.5);
  assert.strictEqual(getV('baseline', 1), 1);
  assert.strictEqual(mk({ barSpan: 0.4 }, { barSpan: null })('barSpan', 1), 0.4);
  // Yükseklik ve taban çizgisi çizicideki yerleşime bağlı varsayılanla aynı
  const bars = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'bars.js'), 'utf8');
  assert.match(bars, /'center' \? 0\.46 : v\.position === 'full' \? 0\.95 : 0\.92/);
  assert.match(src, /const defBarH = barPos === 'center' \? 0\.46 : barPos === 'full' \? 0\.95 : 0\.92/);
  assert.match(src, /getV\('barHeight', defBarH\)[^\n]*def: defBarH/);
  assert.match(src, /getV\('baseline', defBase\)[^\n]*def: defBase/);
});
