/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GÖRSEL / ZEMİN KÜÇÜK RESİMLERİ (#957).

   Kütüphanedeki Görsel ve Zemin kartları yalnız genel bir simge gösteriyordu.
   Her modun küçük resmi uygulamanın KENDİ motoruyla (LayerStack, dışa
   aktarıcıyla aynı yol) gizli bir pencerede çiziliyor. MilkDrop küçük
   resimlerinin boru hattı ortak: kuyruk (ThumbQueue — tek iş, başarısız
   kümesi), atomik yazma, `sv-thumb:` protokolü.

   İKİ KATMANLI ÖNBELLEK:
     1. UYGULAMAYLA GELEN: `assets/mode-thumbs/<anahtar>.webp`, geliştirmede
        `scripts/gen-mode-thumbs.js` üretiyor (yalnız eksik ya da eskimiş
        anahtarlar). Kullanıcı ilk açılışta hiçbir şey çizmiyor.
     2. ÇALIŞMA ANI YEDEĞİ: gelen dosya yoksa ya da anahtarı tutmuyorsa
        (geliştirme sırasında mod değişti) kullanıcı verisinde
        `mode-thumbs/<anahtar>.webp`; tek tek, boşta, küçük çözünürlükte.

   ANAHTAR içeriğe bağlı: reçete + ortak motor dosyalarının baytları + tür +
   modun tanımlandığı dosyanın baytları. Bir modu değiştirmek yalnız o
   dosyadaki modların küçük resmini eskitir; katman motoru değişirse hepsi
   eskir. Sahibi bulunamayan türde bütün mod dosyaları anahtara giriyor
   (yanlış pozitif yeniden çizim, asla eski resim). */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const md = require('./milkdrop-thumbs');

const RECIPE = Object.freeze({
  renderW: 480,
  renderH: 270,
  frames: 45,
  fps: 30,
  thumbW: 240,
  thumbH: 135,
  quality: 0.75,
});

const PAGE = 'src/thumbs/modes.html';
const SHIPPED_DIR = 'assets/mode-thumbs';
const MODE_DIR = 'src/visualizer/modes/';
const KINDS = Object.freeze(['vis', 'bg']);
/* ANAHTARA GİRMEYEN DOSYALAR. Çeviri sözlüğü sayfada yükleniyor ama resmi değiştirmiyor;
   buna karşılık arayüze eklenen her metinle değişiyor. Anahtara girdiği sürece her arayüz
   değişikliği yüzü aşkın resmin hepsini eskitiyor, her seferinde yeniden üretilip depoya
   yazılıyordu (ölçüldü: art arda sekiz birleştirmede ~550 KB'lık klasör baştan yazıldı).
   Bedeli: bir modun tuvale çizdiği varsayılan metnin çevirisi değişirse (metin, çalan parça)
   o resim eski kalır; `node scripts/gen-mode-thumbs.js --force` yeniler. */
/* Gömülü MilkDrop paketi de öyle: her preset eklemesi bütün mod resimlerini eskitiyordu. */
const KEY_SKIP = Object.freeze(['src/shared/i18n.js', 'src/shared/presets-milkdrop-pack.js']);
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

/* Sayfanın yüklediği dosyalar, sırasıyla — HTML'den okunuyor; liste iki
   yerde tutulmuyor. */
function pageFiles(root) {
  const html = fs.readFileSync(path.join(root, PAGE), 'utf8');
  const out = [PAGE];
  const re = /<script\s+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push(path.posix.normalize(path.posix.join('src/thumbs', m[1])));
  return out;
}

/* Türün tanımlandığı mod dosyası: `SVModes.tür =` ya da kayıt tablosunda
   `tür: Sınıf`. */
function ownerOf(texts, type) {
  const esc = String(type).replace(/[^A-Za-z0-9_$]/g, '');
  if (!esc) return null;
  const re = new RegExp('SVModes\\.' + esc + '\\s*=|(^|[\\s{,])' + esc + '\\s*:\\s*[A-Z][A-Za-z0-9_$]*\\s*[,}\\n]', 'm');
  for (const [rel, txt] of texts) if (re.test(txt)) return rel;
  return null;
}

/* Bir kez hesaplanan bağlam: ortak özet + mod dosyalarının özetleri. */
function context(root) {
  const files = pageFiles(root);
  const core = crypto.createHash('sha1');
  core.update(JSON.stringify(RECIPE));
  const modeTexts = new Map();
  const modeHash = new Map();
  for (const rel of files) {
    if (KEY_SKIP.indexOf(rel) >= 0) continue;
    // Satır sonu normalize: Windows'ta CRLF ile alınan depo aynı anahtarları versin
    const buf = Buffer.from(fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n'), 'utf8');
    if (rel.startsWith(MODE_DIR)) {
      modeTexts.set(rel, buf.toString('utf8'));
      modeHash.set(rel, sha1(buf));
    } else {
      core.update('\n' + rel + '\n');
      core.update(buf);
    }
  }
  const all = Array.from(modeHash.values()).join(',');
  return { core: core.digest('hex'), modeTexts, modeHash, all };
}

function keyOf(ctx, kind, type) {
  if (KINDS.indexOf(kind) < 0 || !type) return '';
  const owner = ownerOf(ctx.modeTexts, type);
  const modePart = owner ? owner + '@' + ctx.modeHash.get(owner) : '*@' + ctx.all;
  return sha1(ctx.core + '\n' + kind + ':' + type + '\n' + modePart);
}

/* `sv-thumb://m/<anahtar>.webp`: önce uygulamayla gelen klasör, sonra
   kullanıcı verisi. Yine yalnız 40 haneli anahtar. */
function fileForModeUrl(shippedDir, userDir, url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return null; }
  if (u.protocol !== 'sv-thumb:' || u.hostname !== 'm') return null;
  const m = /^\/([0-9a-f]{40})\.webp$/.exec(u.pathname || '');
  if (!m) return null;
  for (const d of [shippedDir, userDir]) {
    const f = path.join(d, m[1] + '.webp');
    try { if (fs.statSync(f).isFile()) return f; } catch { /* sonraki */ }
  }
  return null;
}

const urlOf = (key) => 'sv-thumb://m/' + key + '.webp';

/* Çalışma anı kuyruğu: MilkDrop'unkiyle aynı sınıf. Uygulamayla gelen dosya
   varsa iş hiç kuyruğa girmiyor. items: [{ id, kind, type }] → { id: url|'' }
   (yoksa onReady ile gelir). */
class ModeThumbs {
  constructor(opts) {
    const o = opts || {};
    this.root = o.root;
    this.shippedDir = o.shippedDir || path.join(o.root, SHIPPED_DIR);
    this.dir = o.dir;
    this._ctx = null;
    // Anahtar → { kind, type }: ThumbQueue işi yalnız anahtarla tutuyor
    this.metas = new Map();
    const onReady = typeof o.onReady === 'function' ? o.onReady : () => {};
    this.queue = new md.ThumbQueue({
      dir: o.dir,
      max: 200,
      render: (job) => {
        const meta = this.metas.get(job.key);
        this.metas.delete(job.key);
        return meta ? o.render(meta) : Promise.resolve(null);
      },
      onReady: (id, key, ok) => onReady(id, ok ? urlOf(key) : ''),
    });
  }

  ctx() { return this._ctx || (this._ctx = context(this.root)); }

  shipped(key) {
    try { return fs.statSync(path.join(this.shippedDir, key + '.webp')).isFile(); } catch { return false; }
  }

  request(items) {
    const ready = {};
    const jobs = [];
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || typeof it.id !== 'string') continue;
      const key = keyOf(this.ctx(), it.kind, String(it.type || ''));
      if (!key) { ready[it.id] = ''; continue; }
      if (this.shipped(key)) { ready[it.id] = urlOf(key); continue; }
      this.metas.set(key, { key, kind: it.kind, type: String(it.type), recipe: RECIPE });
      jobs.push({ id: it.id, key });
    }
    const got = this.queue.request(jobs);
    for (const id of Object.keys(got)) ready[id] = got[id] ? urlOf(got[id]) : '';
    return ready;
  }
}

module.exports = { KEY_SKIP,
  RECIPE, PAGE, SHIPPED_DIR, KINDS, KEY_RE: md.KEY_RE, pageFiles, ownerOf, context, keyOf, fileForModeUrl, urlOf, ModeThumbs,
};
