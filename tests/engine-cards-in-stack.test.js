'use strict';
/* MOTOR KARTLARI KATMAN YIĞININDA (#881). 3B Geometri ve Geri Besleme
 * Motoru kartları yığın açıkken hiç görünmüyordu; motorlar ayarlarını
 * sahneden okuduğu için katmandaki geometrinin ailesi ve formülü hiçbir
 * yerden seçilemiyordu. Üç motor kartı da aynı kuralı kullanıyor:
 * yığın açıkken o türde bir görselleştirici katmanı varsa görünür. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf-8');

test('#881: motor kartları engineInUse kuralıyla görünüyor', () => {
  for (const [id, type] of [['milkdrop', 'milkdrop'], ['geometry', 'geometry'], ['feedbackengine', 'feedback']]) {
    const at = src.indexOf("id: '" + id + "'");
    assert.ok(at > 0, id + ' bölümü yok');
    // bölüm, bir sonraki bölümün kimliğine kadar
    const next = src.indexOf("id: '", at + 5);
    const block = src.slice(at, next > at ? next : at + 1500);
    assert.ok(block.includes("show: () => engineInUse('" + type + "')"), id + ' engineInUse kullanmıyor');
  }
});

test('#881: engineInUse yığın açıkken katmana, kapalıyken klasik türe bakıyor', () => {
  const m = src.match(/const engineInUse = \(type\) => \{[\s\S]*?\n {4}\};/);
  assert.ok(m, 'engineInUse bulunamadı');
  const make = (cfg, stack) => vm.runInNewContext('(' + m[0].replace('const engineInUse = ', '').replace(/;$/, '') + ')',
    { cfg, v: cfg.visualizer, isStackOn: () => stack });
  const layers = [{ kind: 'background', type: 'gradient' }, { kind: 'visualizer', type: 'geometry' }];
  const onStack = make({ visualizer: { type: 'bars' }, layers }, true);
  assert.strictEqual(onStack('geometry'), true);
  assert.strictEqual(onStack('feedback'), false);
  const classic = make({ visualizer: { type: 'feedback' }, layers }, false);
  assert.strictEqual(classic('feedback'), true);
  assert.strictEqual(classic('geometry'), false, 'yığın kapalıyken katman listesi sayılmaz');
});
