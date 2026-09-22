'use strict';
/* MILKDROP SPRITE'LARI (#577) — `milk_img.ini`.

   MilkDrop 2 gösteri sırasında elle çağrılan görseller çiziyor: her biri
   bir resim, bir kez çalışan başlatma kodu, her kare çalışan kodu ve bir
   renk anahtarıyla `milk_img.ini`de tanımlı; K + iki haneli numarayla
   başlatılıyor. Bu dosya işin saf kısmı — ini'yi okumak, en fazla 16
   sprite'ı yuvalarda tutmak, kodlarını çalıştırmak ve dörtgeni kurmak.
   Çizim motorda (modes/milkdrop.js), dosya ve komutlar ana süreçte.

   Davranış MilkDrop 2'nin kaynağından ve kendi belgesinden (örnek
   milk_img.ini'nin açıklamaları) önce kendi sözlerimizle yazıldı, kod o
   tariften kuruldu; kaynaktan satır alınmadı. Kaynağın belgeyle
   çeliştiği yerlerde kaynak geçerli, aşağıda tek tek yazıyor.

   Denklem dili presetlerinkiyle aynı derleyiciden geçiyor (shared/
   milkdrop.js): aynı işlevler, aynı güvenlik — preset metninden hiçbir
   dize kod olarak çalıştırılmıyor. */
(function () {
  /* Aynı anda en fazla 16 sprite; numaralar 00..99. */
  const SLOTS = 16;

  // Okunur değişkenler: her kare kod çalışmadan ÖNCE yazılıyor.
  const INPUTS = ['time', 'frame', 'fps', 'progress', 'bass', 'mid', 'treb',
    'bass_att', 'mid_att', 'treb_att'];

  /* Okunur/yazılır değişkenlerin başlangıcı. Kareden kareye KALICI: her
     kare sıfırlanmıyor, kod bir kez yazdığını sonraki karede yine görüyor.
     `burn` 1'den başlıyor: sprite varsayılan olarak geri beslemeye iz
     bırakıyor. */
  const DEFAULTS = {
    x: 0.5, y: 0.5, sx: 1, sy: 1, repeatx: 1, repeaty: 1,
    rot: 0, flipx: 0, flipy: 0,
    r: 1, g: 1, b: 1, a: 1,
    blendmode: 0, done: 0, burn: 1,
  };

  // ==========================================================================
  // milk_img.ini
  // ==========================================================================
  /* Numara "07" biçiminde iki haneli dize; 0..99 dışı ya da sayı olmayan
     null. */
  function spriteNum(n) {
    const v = typeof n === 'string' && /^\s*\d{1,2}\s*$/.test(n) ? parseInt(n, 10)
      : (Number.isInteger(n) ? n : NaN);
    if (!(v >= 0 && v <= 99)) return null;
    return v < 10 ? '0' + v : String(v);
  }

  /* INI tamsayısı. Windows'un okuyucusu `0x` önekiyle onaltılık, yoksa
     onluk okuyor ve sayının bittiği yerde duruyor; değer yoksa ya da
     okunamıyorsa varsayılan. Renk anahtarı belgede `0xRRGGBB` diye
     yazılıyor. */
  function iniInt(v, def) {
    if (typeof v !== 'string') return def;
    const s = v.trim();
    let m = /^0x([0-9a-f]+)/i.exec(s);
    if (m) return parseInt(m[1], 16) >>> 0;
    m = /^[+-]?\d+/.exec(s);
    return m ? parseInt(m[0], 10) : def;
  }

  /* Satırdaki yorum: `//` ya da `\\` sonrası, satır sonuna kadar. MilkDrop
     ikisini de yorum sayıyor; derleyici yalnız ilkini tanıyor. */
  function stripComment(line) {
    const a = line.indexOf('//');
    const b = line.indexOf('\\\\');
    const cut = a < 0 ? b : (b < 0 ? a : Math.min(a, b));
    return cut < 0 ? line : line.slice(0, cut);
  }

  /* `milk_img.ini`yi okur.

     Dönüş: { defs: Map<"07", tanım>, errors: [] }. Tanım:
       { num, img, colorkey, init, code, desc }

     Kurallar:
       - bölüm adı `[img07]`, büyük/küçük harf fark etmiyor; ilk başlıktan
         önceki her şey (örnek dosyanın uzun açıklaması) yok sayılıyor;
       - anahtarlar da harf duyarsız; aynı anahtar iki kez yazılmışsa İLKİ
         geçerli (Windows'un okuyucusu da öyle);
       - `;` ile başlayan satır yorum; değer çift tırnak içindeyse tırnak
         atılıyor;
       - `init_1`, `init_2`, ... ve `code_1`, `code_2`, ... 1'den başlayıp
         İLK EKSİK numaraya kadar okunuyor — arada boşluk bırakan dosyada
         sonrası okunmuyor, MilkDrop'ta da. Boş bir satır "eksik" değil;
       - renk anahtarı önce eski adıyla `colorkey_lo`, sonra `colorkey`:
         ikisi de varsa yenisi geçerli. Varsayılan 0 (siyah);
       - `img` boşsa tanım yine listeleniyor ama başlatılamıyor. */
  function parseImgIni(text) {
    const defs = new Map();
    const errors = [];
    const sections = new Map();
    let cur = null;
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const t = raw.trim();
      if (!t || t[0] === ';') continue;
      const h = /^\[\s*([^\]]*?)\s*\]/.exec(t);
      if (h) {
        const m = /^img(\d{1,2})$/i.exec(h[1]);
        const num = m ? spriteNum(m[1]) : null;
        if (num) {
          cur = sections.get(num);
          if (!cur) { cur = new Map(); sections.set(num, cur); }
        } else {
          cur = null;
        }
        continue;
      }
      if (!cur) continue;
      const eq = raw.indexOf('=');
      if (eq <= 0) continue;
      const key = raw.slice(0, eq).trim().toLowerCase();
      if (!key || cur.has(key)) continue;
      let val = raw.slice(eq + 1).trim();
      if (val.length >= 2 && val[0] === '"' && val[val.length - 1] === '"') val = val.slice(1, -1);
      cur.set(key, val);
    }
    const block = (s, prefix) => {
      const out = [];
      for (let n = 1; s.has(prefix + n); n++) out.push(stripComment(s.get(prefix + n)));
      return out.join('\n');
    };
    for (const [num, s] of sections) {
      let ck = iniInt(s.get('colorkey_lo'), 0);
      ck = iniInt(s.get('colorkey'), ck);
      const def = {
        num,
        img: s.get('img') || '',
        colorkey: (ck >>> 0) & 0xFFFFFF,
        init: block(s, 'init_'),
        code: block(s, 'code_'),
        desc: s.get('desc') || '',
      };
      if (!def.img) errors.push(num + ': img yok');
      defs.set(num, def);
    }
    return { defs, errors };
  }

  // ==========================================================================
  // Yuvalar ve kod
  // ==========================================================================
  class SpriteSet {
    /* M: shared/milkdrop.js'in dışa verdiği api (compile, Pool). */
    constructor(M) {
      this.M = M;
      this.slots = new Array(SLOTS).fill(null);
      this.launches = 0; // başlatma sırası: en yeni / en eski buradan
    }

    count() { return this.slots.reduce((n, s) => n + (s ? 1 : 0), 0); }

    /* Sprite'ı başlatır, yuvasını döndürür (-1: başlatılamadı).

       o: { seed, time, frame, key? }
         seed  — `rand`ın tohumu. Birden çok ekranda aynı sprite aynı
                 rastgele sayıları görsün diye başlatma komutuyla geliyor.
         time, frame — motorun o anki saati ve karesi; sprite'ın `time`ı ve
                 `frame`i bunlara göre sayılıyor.
         key   — resmin kimliği (motor dokuyu buna göre paylaşıyor).

       Yuva: ilk boş yuva; boş yoksa EN ESKİ başlatılan atılıp yerine
       geçiliyor (MilkDrop'ta "başlama karesi en küçük olan"; aynı karede
       başlatılmışlarsa düşük numaralı yuva). */
    launch(def, o) {
      if (!def || !def.img) return -1;
      const opt = o || {};
      let slot = this.slots.indexOf(null);
      if (slot < 0) {
        slot = 0;
        for (let i = 1; i < SLOTS; i++) {
          if (this.slots[i].startFrame < this.slots[slot].startFrame) slot = i;
        }
      }
      const M = this.M;
      const pool = new M.Pool();
      /* Sıra: bütün değişkenler sıfır (yeni havuz), çıktılar varsayılana,
         sonra başlatma kodu BİR KEZ. Okunur değişkenler o sırada sıfır —
         MilkDrop'ta da başlatma kodu kare girdilerini görmüyor. */
      for (const k of INPUTS) pool.set(k, 0);
      for (const k of Object.keys(DEFAULTS)) pool.set(k, DEFAULTS[k]);
      const seed = (Number(opt.seed) >>> 0) || 1;
      const init = M.compile(def.init || '', pool, { seed });
      const code = M.compile(def.code || '', pool, { seed: (seed ^ 0x9e3779b9) >>> 0 || 1 });
      init.run(pool.values);
      this.slots[slot] = {
        num: def.num,
        key: opt.key || def.img,
        colorkey: (Number(def.colorkey) >>> 0) & 0xFFFFFF,
        pool,
        code,
        startTime: Number(opt.time) || 0,
        startFrame: Number(opt.frame) || 0,
        order: ++this.launches,
        warn: [init.error, code.error].filter(Boolean).join(' · '),
      };
      return slot;
    }

    kill(slot) { if (slot >= 0 && slot < SLOTS) this.slots[slot] = null; }

    // Numarası `num` olan BÜTÜN sprite'lar (MilkDrop: SHIFT+K + iki hane)
    killNum(num) {
      const n = spriteNum(num);
      for (let i = 0; i < SLOTS; i++) if (this.slots[i] && this.slots[i].num === n) this.slots[i] = null;
    }

    killAll() { this.slots.fill(null); }

    // DELETE: en son başlatılan; SHIFT+DELETE: en önce başlatılan
    killNewest() { this._killBy((a, b) => a.order > b.order); }
    killOldest() { this._killBy((a, b) => a.order < b.order); }
    _killBy(better) {
      let pick = -1;
      for (let i = 0; i < SLOTS; i++) {
        const s = this.slots[i];
        if (s && (pick < 0 || better(s, this.slots[pick]))) pick = i;
      }
      if (pick >= 0) this.slots[pick] = null;
    }

    /* Bir kare: her sprite'ın kodunu yuva sırasıyla çalıştırır ve çizim
       listesini döndürür. `done` yazan sprite bu karenin listesinde YER
       ALIYOR (son kez çiziliyor, istenirse basılıyor) ve sonra atılıyor.

       inp: { time, frame, fps, progress, bass, mid, treb, bass_att,
              mid_att, treb_att } — motorun o karesi. */
    step(inp) {
      const out = [];
      for (let i = 0; i < SLOTS; i++) {
        const s = this.slots[i];
        if (!s) continue;
        const P = s.pool;
        P.set('time', (Number(inp.time) || 0) - s.startTime);
        P.set('frame', (Number(inp.frame) || 0) - s.startFrame);
        for (const k of ['fps', 'progress', 'bass', 'mid', 'treb', 'bass_att', 'mid_att', 'treb_att']) {
          P.set(k, Number(inp[k]) || 0);
        }
        s.code.run(P.values);
        const d = readOutputs(P);
        d.slot = i;
        d.num = s.num;
        d.key = s.key;
        d.colorkey = s.colorkey;
        out.push(d);
        if (d.done) this.slots[i] = null;
      }
      return out;
    }
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const fin = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  /* Çıktıların çizime giden hâli: MilkDrop'un sınırlarıyla kenetlenmiş.
     Konum ve boyut ±1000, tekrar 0,01..100, renk ve alfa 0..1, karışım
     kipi tamsayı 0..4 (kesiliyor, yuvarlanmıyor). */
  function readOutputs(P) {
    const g = (k) => fin(P.get(k), DEFAULTS[k]);
    return {
      x: clamp(g('x'), -1000, 1000), y: clamp(g('y'), -1000, 1000),
      sx: clamp(g('sx'), -1000, 1000), sy: clamp(g('sy'), -1000, 1000),
      rot: g('rot'),
      flipx: g('flipx') !== 0, flipy: g('flipy') !== 0,
      repeatx: clamp(g('repeatx'), 0.01, 100), repeaty: clamp(g('repeaty'), 0.01, 100),
      blendmode: clamp(Math.trunc(g('blendmode')), 0, 4),
      r: clamp(g('r'), 0, 1), g: clamp(g('g'), 0, 1), b: clamp(g('b'), 0, 1), a: clamp(g('a'), 0, 1),
      done: g('done') !== 0,
      burn: g('burn') !== 0,
    };
  }

  // ==========================================================================
  // Dörtgen
  // ==========================================================================
  /* Sprite'ın dört köşesi, GL kırpma uzayında (y YUKARI): sol üst, sağ üst,
     sol alt, sağ alt — TRIANGLE_STRIP sırası. Her köşe [x, y, u, v].

     Hesap MilkDrop'un ekran düzleminde yapılıyor: x soldan sağa, y
     YUKARIDAN aşağı -1..1 (belge: "x 0 solda, y 0 üstte"). Sonda y
     çevrilip GL'e geçiliyor.

       1. köşeler (±sx, ±sy); flipx x'leri, flipy satırları takas ediyor;
       2. resmin en-boyu: geniş resimde y'ler h/w ile çarpılıyor, uzun
          resimde x'ler h/w'ye bölünüyor;
       3. döndürme (x cos − y sin, x sin + y cos) — bu düzlemde pozitif açı
          ekranda SAAT YÖNÜNDE. Belge "π/2 saat yönünün tersine 90°"
          diyor; kaynağın formülü, resmin düz göründüğü tek yönlenmede saat
          yönünü veriyor. Kaynak geçerli;
       4. öteleme: merkez (2x − 1, 2y − 1);
       5. ekranın en-boyu, ötelemeden SONRA: geniş ekranda y'ler W/H ile
          çarpılıyor, dar ekranda x'ler W/H'ye bölünüyor — boyut ekran
          GENİŞLİĞİNE göre, pikselde kare kare kalıyor. Konum da
          ölçekleniyor: geniş ekranda görünen dikey aralık
          y ∈ [0,5 − 0,5·H/W, 0,5 + 0,5·H/W], 16:9'da 0,22..0,78. Belgenin
          "y 0 üstte, 1 altta"sı yalnız kare ekranda tam doğru; 4:3'te bile
          y = 0 ekranın üstünden taşıyor. Kaynak geçerli.

     BİLİNÇLİ SAPMA: MilkDrop burada 4:3'lük bir geri besleme dokusu
     varsayan üçüncü bir düzeltme yapıyor ve geri alıyor, ama geri almayı
     her karede, uygulamayı yalnız son karede yapıyor. Geniş ekranda sprite
     dikeyde (W/H)/(4/3) kat geriliyor, geri beslemedeki izi gerilmiyordu.
     Geri besleme tamponu pencereyle aynı en-boyda; ikisi de uygulanmıyor.

     Doku: köşelerin (0,0) (1,0) (0,1) (1,1)'i, resmin üst satırı dörtgenin
     üst kenarında. Tekrar merkezden: u = (u0 − 0,5)·repeatx + 0,5. */
  function spriteQuad(d, imgW, imgH, W, H) {
    const X = [-d.sx, d.sx, -d.sx, d.sx];
    const Y = [-d.sy, -d.sy, d.sy, d.sy];
    if (d.flipx) { X[0] = d.sx; X[1] = -d.sx; X[2] = d.sx; X[3] = -d.sx; }
    if (d.flipy) { Y[0] = d.sy; Y[1] = d.sy; Y[2] = -d.sy; Y[3] = -d.sy; }
    const ar = imgW > 0 && imgH > 0 ? imgH / imgW : 1;
    for (let k = 0; k < 4; k++) {
      if (ar < 1) Y[k] *= ar; else X[k] /= ar;
    }
    const c = Math.cos(d.rot), s = Math.sin(d.rot);
    const cx = d.x * 2 - 1, cy = d.y * 2 - 1;
    const A = W > 0 && H > 0 ? W / H : 1;
    const U = [0, 1, 0, 1], V = [0, 0, 1, 1];
    const out = new Float32Array(16);
    for (let k = 0; k < 4; k++) {
      let x = X[k] * c - Y[k] * s + cx;
      let y = X[k] * s + Y[k] * c + cy;
      if (A > 1) y *= A; else x /= A;
      out[k * 4] = x;
      out[k * 4 + 1] = -y;
      out[k * 4 + 2] = (U[k] - 0.5) * d.repeatx + 0.5;
      out[k * 4 + 3] = (V[k] - 0.5) * d.repeaty + 0.5;
    }
    return out;
  }

  /* Karışım kiplerinin köşe rengi ve karışımı. Renk = doku × köşe rengi.

       0 blend    köşe (r,g,b), alfa a — dokunun ALFASI yok sayılıyor;
                  src·α + dst·(1−α)
       1 decal    köşe (r·a, g·a, b·a), karışım yok: hedefin yerine geçiyor
       2 additive köşe (r·a, g·a, b·a); src + dst
       3 srccolor köşe beyaz, r/g/b/a etkisiz; src·src + dst·(1−src)
       4 colorkey köşe (r,g,b), alfa dokunun alfası × a; src·α + dst·(1−α)

     Köşe rengi 8 bite MilkDrop'un yuvarlamasıyla (kesme) iniyor; değerler
     zaten 0..1'e kenetli. `texAlpha`: gölgelendirici doku alfasını
     kullansın mı. */
  function spriteColor(d, M) {
    const cn = M && M.colorNorm ? M.colorNorm : (v) => v;
    switch (d.blendmode) {
      case 1:
        return { mode: 1, color: [cn(d.r * d.a), cn(d.g * d.a), cn(d.b * d.a), 1], blend: null, texAlpha: false };
      case 2:
        return { mode: 2, color: [cn(d.r * d.a), cn(d.g * d.a), cn(d.b * d.a), 1], blend: 'add', texAlpha: false };
      case 3:
        return { mode: 3, color: [1, 1, 1, 1], blend: 'srccolor', texAlpha: false };
      case 4:
        return { mode: 4, color: [cn(d.r), cn(d.g), cn(d.b), cn(d.a)], blend: 'alpha', texAlpha: true };
      default:
        return { mode: 0, color: [cn(d.r), cn(d.g), cn(d.b), cn(d.a)], blend: 'alpha', texAlpha: false };
    }
  }

  /* Renk anahtarı: resim yüklenirken rengi anahtara TAM eşit pikseller
     saydam siyah oluyor (0,0,0,0). Anahtar HER kipte uygulanıyor — MilkDrop
     anahtarı yüklemede veriyor, kipte değil; varsayılan anahtar siyah
     olduğu için 0-3 kiplerinde görünür bir fark yok. Resmin kendi alfası
     (PNG) yerinde kalıyor. `px`: RGBA baytları, yerinde değişiyor.
     Döndürdüğü: saydamlaşan piksel sayısı. */
  function applyColorKey(px, key) {
    const kr = (key >>> 16) & 0xFF, kg = (key >>> 8) & 0xFF, kb = key & 0xFF;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] === kr && px[i + 1] === kg && px[i + 2] === kb) {
        px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0;
        n++;
      }
    }
    return n;
  }

  // ==========================================================================
  // Sayfanın komut kuyruğu
  // ==========================================================================
  /* Ana süreç başlatma/silme komutlarını sayfaya yolluyor; sayfadaki her
     MilkDrop motoru (bir sayfada birden fazla MilkDrop katmanı olabilir)
     aynı kuyruktan, kendi kaldığı yerden okuyor. Kuyruk kısa tutuluyor:
     bir motor uzun süre çizmezse (bağlam kaybı) en eski komutları
     kaçırabilir — sprite'lar gösterinin anlık parçası, geçmişi değil.
     `SVMdSpriteSeq` son komutun numarası: yeni kurulan motor oradan
     başlıyor, eskileri oynatmıyor. */
  const QUEUE_MAX = 64;

  function enqueue(cmd) {
    if (typeof window === 'undefined' || !cmd || !(cmd.id > 0)) return false;
    const q = window.SVMdSpriteQueue || (window.SVMdSpriteQueue = []);
    if (cmd.id <= (window.SVMdSpriteSeq || 0)) return false;
    q.push(cmd);
    if (q.length > QUEUE_MAX) q.splice(0, q.length - QUEUE_MAX);
    window.SVMdSpriteSeq = cmd.id;
    return true;
  }

  function listen(bridge) {
    if (typeof window === 'undefined' || !bridge || typeof bridge.onMdSprite !== 'function') return false;
    if (window.__svMdSpriteListen) return true;
    window.__svMdSpriteListen = true;
    bridge.onMdSprite((cmd) => enqueue(cmd));
    return true;
  }

  // ==========================================================================
  // MilkDrop'un tuşları
  // ==========================================================================
  /* Görselleştirici penceresinde MilkDrop'un sprite tuşları:
       K            sprite kipi; iki hane o numarayı BAŞLATIR
       SHIFT+K      silme kipi; iki hane o numaranın hepsini SİLER
       *            girilen haneleri temizler
       DELETE       (sprite kipinde) en yeniyi siler
       SHIFT+DELETE (sprite kipinde) en eskiyi siler
       CTRL+SHIFT+DELETE (sprite kipinde) hepsini siler
       CTRL+K       hepsini siler
       ESC          kipten çıkar
     MilkDrop hane için yalnız üst sıradaki rakamları kabul ediyordu; burada
     sayı tuş takımı da geçiyor (tuşun adı aynı).

     Saf: durum ve tuş girer, yeni durum ve (varsa) komut çıkar.
     st: { mode: '' | 'launch' | 'kill', digits: '' }
     k:  { key, shift, ctrl }
     Dönüş: { st, cmd, used } — `used` tuşun tüketildiği (pencerenin kendi
     kısayolu, ör. ESC ile kapanma, o zaman çalışmamalı). */
  function spriteKey(st, k) {
    const s = st && st.mode ? { mode: st.mode, digits: st.digits || '' } : { mode: '', digits: '' };
    const key = String((k && k.key) || '');
    const lower = key.toLowerCase();
    const shift = !!(k && k.shift), ctrl = !!(k && k.ctrl);
    const idle = { mode: '', digits: '' };
    if (lower === 'k') {
      if (ctrl) return { st: idle, cmd: { op: 'all' }, used: true };
      return { st: { mode: shift ? 'kill' : 'launch', digits: '' }, cmd: null, used: true };
    }
    if (!s.mode) return { st: s, cmd: null, used: false };
    if (key === 'Escape') return { st: idle, cmd: null, used: true };
    if (key === '*') return { st: { mode: s.mode, digits: '' }, cmd: null, used: true };
    if (key === 'Delete' && s.mode === 'launch') {
      const op = ctrl && shift ? 'all' : shift ? 'oldest' : 'newest';
      return { st: { mode: s.mode, digits: '' }, cmd: { op }, used: true };
    }
    if (/^[0-9]$/.test(key)) {
      const digits = s.digits + key;
      if (digits.length < 2) return { st: { mode: s.mode, digits }, cmd: null, used: true };
      return { st: idle, cmd: { op: s.mode === 'kill' ? 'kill' : 'launch', num: digits }, used: true };
    }
    return { st: s, cmd: null, used: false };
  }

  const api = { SLOTS, INPUTS, DEFAULTS, spriteNum, iniInt, stripComment, parseImgIni, SpriteSet,
    readOutputs, spriteQuad, spriteColor, applyColorKey, QUEUE_MAX, enqueue, listen, spriteKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMilkdropSprites = api;
})();
