'use strict';
/* MilkDrop korpusunun ölçüm listesi — ölçüm betiklerinin ORTAK kesiti.
 *
 * Render oranı (milkdrop-render-rate.js) ve preset değişiminin maliyeti
 * (milkdrop-switch-cost.js) aynı presetleri ölçmeli: iki sayı ancak aynı
 * presetler üzerinden yan yana konabilir. Liste bu yüzden tek yerde; iki
 * kopyası olsaydı biri değiştiğinde öteki sessizce başka bir kesit ölçerdi.
 *
 * Aritmetik OLDUĞU GİBİ duruyor: `s * 1103515245` 2^53'ü aşıyor ve kayan
 * noktada yuvarlanıyor. Kusursuz bir üreteç değil, ama yayınlanmış bütün
 * oranların ölçüldüğü 900'lük kesiti bu üretiyor; "düzeltmek" başka 900
 * preset seçer ve önceki bütün koşularla karşılaştırmayı bozar.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* `limit`: alfabetik ilk N (yanlı, hızlı deneme için). `sample`: tohumlu
   N'lik kesit. İkisi de yoksa tekilleştirilmiş korpusun tamamı. */
function listPresets(dir, opts) {
  const limit = (opts && opts.limit) || 0;
  const sample = (opts && opts.sample) || 0;
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.milk')) out.push(p);
    }
  };
  walk(dir);
  out.sort();
  // Aynı preset iki kez ölçülmesin (paketlerde iç içe kopya klasörler var).
  const seen = new Set();
  const uniq = [];
  for (const p of out) {
    let h;
    try { h = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex'); }
    catch (e) { continue; }
    if (seen.has(h)) continue;
    seen.add(h);
    uniq.push(p);
  }
  if (limit) return uniq.slice(0, limit);
  /* Tohumlu örnekleme. `limit` alfabetik ilk N'i alıyor ve bu YANLI: aynı
     yazarın peş peşe duran presetleri seçiliyor. 10.000 presetin tamamını
     render etmek saatler sürdüğü için temsili bir kesit gerekiyor; tohum
     sabit olduğu için kesit koşudan koşuya AYNI kalıyor ve iki ölçüm
     karşılaştırılabilir oluyor. */
  if (sample && sample < uniq.length) {
    let s = 20260908;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const a = uniq.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a.slice(0, sample).sort();
  }
  return uniq;
}

module.exports = { listPresets };
