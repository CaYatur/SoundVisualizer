'use strict';
/* MİLKDROP PRESET DÜZENLEYİCİ — arayüz (#578). Metin tarafı: shared/milkdrop-edit.js.

   Ekrandaki preset açılıyor; kare ve piksel denklemleri, dört dalga, dört
   şekil, warp ve birleştirme shader'ı ayrı sekmelerde düzenleniyor. Her
   düzeltme ~0,4 sn sonra presetin yeni bir sürümü olarak KARIŞMADAN
   yükleniyor: sonuç çalışan görüntüde. Düzenlerken otomatik geçiş
   duraklatılıyor (kilit), kapatınca eski hâline dönüyor.

   HATALAR PRESETİN SATIRINDA. Denklem hataları her deyim ayrı ayrıştırılarak
   deyimin başladığı satıra bağlanıyor ve presetteki metniyle gösteriliyor —
   motorun ürettiği kod değil. Shader'lar bu pencerede ayrı bir WebGL
   bağlamında derleniyor; derleyicinin satırı presetin shader satırına en
   çok benzeyen satır üzerinden eşleniyor (çevirmen satırları yeniden
   yazıyor, numara birebir tutmuyor).

   ASIL PRESET HİÇ DEĞİŞMİYOR. "Yeni preset olarak kaydet" kütüphaneye yeni
   bir kimlikle yazıyor; ondan sonraki kayıtlar o kopyayı güncelliyor.
   Kaydetmeden kapatılırsa ekrana asıl preset geri geliyor.

   Durum modülde, ayarlarda değil (üretici gibi): yarım bir düzenleme bir
   sahnenin parçası değil. */
(function () {
  const P = () => window.SVPanel;
  const E = () => window.SVMdEdit;
  const MP = () => window.SVMilkdropPanel;
  const M = () => window.SVMilkdrop;
  const T = () => window.SVMilkdropShader;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  const LIVE_MS = 400;
  let S = null;
  let saving = false;
  let timer = 0;
  let gl = null;

  const TABS = [
    ['frame', 'Her Kare'], ['pixel', 'Piksel'], ['waves', 'Dalgalar'], ['shapes', 'Şekiller'],
    ['warp', 'Warp'], ['comp', 'Birleştirme'], ['values', 'Değerler'], ['text', 'Metin'],
  ];
  // Hangi blok hangi sekmede
  function tabOf(block) {
    if (block === 'per_frame_init' || block === 'per_frame') return 'frame';
    if (block === 'per_pixel') return 'pixel';
    if (block === 'warp' || block === 'comp') return block;
    if (block.indexOf('wave_') === 0) return 'waves';
    if (block.indexOf('shape_') === 0) return 'shapes';
    return 'frame';
  }
  const PART_LABELS = { init: 'Başlangıç (init)', per_frame: 'Her kare (per_frame)', per_point: 'Her nokta (per_point)' };
  function blockLabel(block) {
    if (block === 'per_frame_init') return tr('Kare denklemleri') + ' — ' + tr('Başlangıç (init)');
    if (block === 'per_frame') return tr('Kare denklemleri') + ' — ' + tr('Her kare (per_frame)');
    if (block === 'per_pixel') return tr('Piksel denklemleri');
    if (block === 'warp') return tr('Warp shader');
    if (block === 'comp') return tr('Birleştirme shader');
    const m = /^(wave|shape)_(\d)_(.*)$/.exec(block);
    if (m) return tr(m[1] === 'wave' ? 'Dalga' : 'Şekil') + ' ' + (+m[2] + 1) + ' — ' + tr(PART_LABELS[m[3]] || m[3]);
    return block;
  }
  // Presetteki anahtar: `per_frame_3`, `wave_0_per_point3`, `warp_7`
  function keyName(block, line) {
    const d = (E().BLOCKS || []).find((b) => b.id === block);
    return d ? d.prefix + (line + 1) : block;
  }

  const VALUE_LABELS = {
    zoom: 'Yakınlaşma (zoom)', warp: 'Bükülme (warp)', rot: 'Dönme (rot)',
    decay: 'Sönüm (decay)', echoZoom: 'Yankı yakınlaşması', echoAlpha: 'Yankı saydamlığı',
  };

  const md2 = () => {
    const c = P().cfg();
    return !(c && c.milkdrop && c.milkdrop.accurate === false);
  };
  const control = (cfg) => cfg.milkdropControl || (cfg.milkdropControl = { locked: false, cutTo: '' });

  // ------------------------------------------------------------------ oturum

  /* Kaç dalga/şekil yuvası (#567): preset MilkDrop 3 kurallarıyla mı
     okunuyor — motorun kararıyla aynı (biçim ayarı ve metin). */
  function slotsFor(source) {
    const m = M();
    const c = P().cfg();
    const fmt = (c && c.milkdrop && c.milkdrop.format) || 'auto';
    return m && m.isMd3 && m.isMd3(fmt, source) ? 16 : 4;
  }

  function start() {
    if (!E()) return;
    const cfg = P().cfg();
    const md = cfg.milkdrop || {};
    const panel = MP();
    const id = panel && panel.liveId ? panel.liveId(md) : md.presetId;
    const p = id && panel && panel.presetById ? panel.presetById(id) : null;
    const source = p && typeof p.source === 'string' ? p.source : (typeof md.source === 'string' ? md.source : '');
    if (!source.trim()) {
      P().toast(tr('Önce MilkDrop listesinden bir preset seçin.'), 'err');
      return;
    }
    const baseName = p ? tr(p.name || p.id) : (md.name || tr('Preset'));
    const slots = slotsFor(source);
    const r = E().read(source, slots);
    S = {
      baseId: p ? p.id : (md.presetId || ''),
      baseName,
      author: (p && p.author) || '',
      first: source, // en baştaki metin: "Baştan" ve kaydetmeden kapatma buna döner
      original: source, // blokların karşılaştırıldığı metin (ham metin düzenlenince o olur)
      source,
      blocks: r.blocks,
      values: r.values,
      slots,
      rev: 0,
      tab: 'frame',
      wave: 0,
      shape: 0,
      name: baseName + ' (' + tr('düzenlendi') + ')',
      savedId: '',
      wasLocked: !!control(cfg).locked,
      diag: [],
      shaderDiag: { warp: [], comp: [] },
      focus: null,
    };
    control(cfg).locked = true;
    check();
    P().apply();
  }

  // Kaydetmeden kapatılırsa ekrana asıl preset (ya da son kaydedilen) geri geliyor
  function close() {
    if (!S) return;
    if (timer) { clearTimeout(timer); timer = 0; }
    const cfg = P().cfg();
    control(cfg).locked = S.wasLocked;
    const panel = MP();
    const backId = S.savedId || S.baseId;
    const back = backId && panel && panel.presetById ? panel.presetById(backId) : null;
    if (back && panel.go) {
      S = null;
      panel.go(cfg, back);
    } else {
      S = null;
      P().apply();
    }
    dropGL();
  }

  function reset() {
    if (!S) return;
    S.slots = slotsFor(S.first);
    const r = E().read(S.first, S.slots);
    S.original = S.first;
    S.blocks = r.blocks;
    S.values = r.values;
    live(true);
    P().rerender();
  }

  // Düzenlenmiş metin: bloklar ve değerler asıl metnin üstüne
  function compose() {
    return E().write(S.original, S.blocks, S.values, S.slots);
  }

  /* Canlı uygulama. Presetin yeni bir sürümü, yeni bir kimlikle (motor
     seçimi kimlik ve metin uzunluğundan tanıyor; uzunluğu değişmeyen bir
     düzeltme aynı kimlikle hiç yüklenmezdi). */
  function live(now) {
    if (!S) return;
    if (timer) { clearTimeout(timer); timer = 0; }
    const run = () => {
      timer = 0;
      if (!S) return;
      S.source = compose();
      S.rev++;
      const panel = MP();
      if (panel && panel.previewEdit) {
        panel.previewEdit({ id: 'edit:' + (S.savedId || S.baseId || 'md') + ':' + S.rev, kind: 'milkdrop', name: S.name, source: S.source });
      }
      check();
      paintDiag();
    };
    if (now) run();
    else timer = setTimeout(run, LIVE_MS);
  }

  // ------------------------------------------------------------------ denetim

  function check() {
    if (!S) return;
    S.diag = E().diagnose(S.blocks, M(), md2());
    S.over = E().overrides(S.blocks, M(), md2());
    S.shaderDiag = { warp: shaderCheck('warp'), comp: shaderCheck('comp') };
    S.plan = null;
    try {
      const m = M();
      if (m && m.stagePlan && md2()) S.plan = m.stagePlan(m.parseMilkMd2(S.source));
    } catch (e) { S.plan = null; }
  }

  function ensureGL() {
    if (gl && !gl.isContextLost()) return gl;
    try {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      gl = c.getContext('webgl2');
    } catch (e) { gl = null; }
    return gl;
  }
  // Oturum bitince bağlam hemen bırakılıyor: Chromium'un etkin bağlam sınırı
  function dropGL() {
    if (!gl) return;
    try { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { /* zaten gitti */ }
    gl = null;
  }

  /* Bir shader aşamasının hataları: [{ line (0'dan, -1 bilinmiyor), message }].
     Önce çevirmen (desteklenmeyen yapılar), sonra GPU'nun derleyicisi. */
  function shaderCheck(stage) {
    const lines = S.blocks[stage] || [];
    const text = lines.join('\n');
    if (!text.trim() || !T()) return [];
    let r;
    try { r = T().translate(text, { stage }); } catch (e) { return [{ line: -1, message: tr('Çevrilemedi') }]; }
    if (!r || r.empty) return [];
    if (r.hard && r.hard.length) {
      return r.hard.map((h) => {
        const at = lines.findIndex((l) => l.indexOf(String(h).replace(/^#\s*/, '#')) >= 0);
        return { line: at, message: tr('Desteklenmiyor') + ': ' + h };
      });
    }
    const g = ensureGL();
    if (!g) return [];
    const sh = g.createShader(g.FRAGMENT_SHADER);
    g.shaderSource(sh, r.glsl);
    g.compileShader(sh);
    const ok = g.getShaderParameter(sh, g.COMPILE_STATUS);
    const log = ok ? '' : g.getShaderInfoLog(sh) || '';
    g.deleteShader(sh);
    if (ok) return [];
    const glslLines = r.glsl.split('\n');
    const errs = E().glslErrors(log);
    if (!errs.length) return [{ line: -1, message: tr('Shader derlenmedi') }];
    return errs.slice(0, 6).map((e) => ({
      line: e.line > 0 ? E().nearestLine(lines, glslLines[e.line - 1]) : -1,
      message: e.message,
    }));
  }

  // Hata satırı için açıklama: kod + ayrıntı
  function describe(d) {
    if (d.code === 'paren-open') return tr('Parantez kapanmamış');
    if (d.code === 'paren-close') return tr('Fazladan kapanan parantez');
    if (d.code === 'unknown-func') return tr('Bilinmeyen işlev') + ': ' + d.detail;
    if (d.code === 'dropped') return tr('Bu blokta hata var: MilkDrop bloğu bütünüyle atlar, hiçbir satırı çalışmaz.');
    return tr('Ayrıştırılamadı') + (d.detail ? ': ' + d.detail : '');
  }

  // Bütün hatalar tek listede: denklem + shader
  function allErrors() {
    if (!S) return [];
    const out = S.diag.map((d) => ({ block: d.block, line: d.line, text: describe(d), code: d.text || '' }));
    for (const st of ['warp', 'comp']) {
      for (const d of S.shaderDiag[st] || []) out.push({ block: st, line: d.line, text: d.message, code: '' });
    }
    return out;
  }

  // ------------------------------------------------------------------ çizim

  let diagBox = null;
  const gutters = new Map();

  // Hata listesi yerinde güncelleniyor: panel yeniden çizilmiyor
  function paintDiag() {
    if (diagBox && diagBox.isConnected) {
      diagBox.replaceChildren(...diagNodes());
    }
    for (const [block, g] of gutters) {
      if (!g.isConnected) { gutters.delete(block); continue; }
      g.paint();
    }
  }

  function diagNodes() {
    const el = P().el;
    const errs = allErrors();
    if (!errs.length) return [el('div', { class: 'mded-ok', text: '✓ Hata yok' })];
    return errs.map((d) => {
      const where = blockLabel(d.block) + (d.line >= 0 ? ', ' + tr('satır') + ' ' + (d.line + 1) + ' (' + keyName(d.block, d.line) + ')' : '');
      return el('button', {
        class: 'mded-err', type: 'button',
        onclick: () => jump(d.block, d.line),
      }, [
        el('span', { class: 'mded-where', text: where }),
        el('span', { class: 'mded-msg', text: d.text }),
        d.code ? el('code', { class: 'mded-code-snip', text: d.code }) : null,
      ]);
    });
  }

  // Hatanın satırına git: sekme, dalga/şekil seçimi, satır seçili
  function jump(block, line) {
    if (!S) return;
    S.tab = tabOf(block);
    const m = /^(wave|shape)_(\d)_/.exec(block);
    if (m) S[m[1]] = +m[2];
    S.focus = { block, line };
    P().rerender();
  }

  // Satır numaraları ve hatalı satırlar; metin kutusuyla birlikte kayıyor
  function codeArea(block, rows) {
    const el = P().el;
    const lines = S.blocks[block] || [];
    const gutter = el('div', { class: 'mded-gutter', 'aria-hidden': 'true' });
    const ta = el('textarea', {
      class: 'mded-input', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off',
      rows: String(rows || 10), 'data-block': block, 'aria-label': blockLabel(block),
    });
    ta.value = lines.join('\n');
    gutter.paint = () => {
      const n = Math.max(1, ta.value.split('\n').length);
      const bad = new Set(allErrors().filter((d) => d.block === block && d.line >= 0).map((d) => d.line));
      const kids = [];
      for (let i = 0; i < n; i++) kids.push(el('div', { class: bad.has(i) ? 'err' : '', text: String(i + 1) }));
      gutter.replaceChildren(...kids);
      gutter.scrollTop = ta.scrollTop;
    };
    gutters.set(block, gutter);
    ta.addEventListener('input', () => {
      S.blocks[block] = ta.value.split('\n');
      S.focus = { block, start: ta.selectionStart, end: ta.selectionEnd };
      gutter.paint();
      live(false);
    });
    ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
    // Sekme tuşu odağı değil girinti eklesin
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + 2;
      ta.dispatchEvent(new Event('input'));
    });
    gutter.paint();
    return el('div', { class: 'mded-code' }, [gutter, ta]);
  }

  /* Panel başka bir sebeple yeniden çizilirse yazılan kutu odağını geri
     alıyor; hataya tıklanınca o satır seçili geliyor. */
  function restoreFocus(root) {
    const f = S && S.focus;
    if (!f || !root) return;
    setTimeout(() => {
      const ta = root.querySelector && root.querySelector('textarea[data-block="' + f.block + '"]');
      if (!ta) return;
      ta.focus();
      if (typeof f.line === 'number') {
        const ls = ta.value.split('\n');
        let a = 0;
        for (let i = 0; i < f.line && i < ls.length; i++) a += ls[i].length + 1;
        const b = a + (ls[f.line] || '').length;
        ta.setSelectionRange(a, b);
        const lh = ta.scrollHeight / Math.max(1, ls.length);
        ta.scrollTop = Math.max(0, (f.line - 2) * lh);
        S.focus = { block: f.block, start: a, end: b };
      } else if (typeof f.start === 'number') {
        ta.setSelectionRange(f.start, f.end);
      }
    }, 0);
  }

  function slotPicker(kind) {
    const el = P().el;
    const label = kind === 'wave' ? 'Dalga' : 'Şekil';
    return el('div', { class: 'mded-slots' }, Array.from({ length: S.slots }, (_, i) => i).map((i) => {
      const parts = kind === 'wave' ? ['init', 'per_frame', 'per_point'] : ['init', 'per_frame'];
      const used = parts.some((p) => (S.blocks[kind + '_' + i + '_' + p] || []).some((l) => l.trim()));
      return el('button', {
        class: 'layer-tab' + (S[kind] === i ? ' active' : '') + (used ? '' : ' dim'), type: 'button',
        text: tr(label) + ' ' + (i + 1), 'aria-pressed': S[kind] === i ? 'true' : 'false',
        onclick: () => { S[kind] = i; S.focus = null; P().rerender(); },
      });
    }));
  }

  function field(block, rows) {
    const el = P().el;
    return el('div', { class: 'mded-field' }, [
      el('div', { class: 'mded-label', text: blockLabel(block) }),
      codeArea(block, rows),
    ]);
  }

  function shaderNote(stage) {
    const el = P().el;
    const plan = S.plan && S.plan[stage];
    if (plan !== 'fixed' || !(S.blocks[stage] || []).some((l) => l.trim())) return null;
    return el('div', {
      class: 'studio-note dim-hint',
      text: 'Bu presetin sürüm satırı bu aşamanın shader\'ını kullanmıyor: MilkDrop metni yok sayıyor ve sabit yolu çiziyor. Kullanmak için dosyanın MILKDROP_PRESET_VERSION ve PSVERSION satırlarını Metin sekmesinden düzeltin.',
    });
  }

  function valuesTab() {
    const el = P().el;
    const nodes = [];
    for (const v of E().VALUES) {
      const cur = S.values[v.id];
      const has = typeof cur === 'number' && isFinite(cur);
      const shown = has ? cur : v.dflt;
      const val = el('span', { class: 'val', text: has ? String(+shown.toFixed(4)) : tr('dosyada yok') });
      const input = el('input', {
        type: 'range', min: v.min, max: v.max, step: v.step, value: shown,
        'aria-label': tr(VALUE_LABELS[v.id]),
        oninput: (e) => { val.textContent = String(+Number(e.target.value).toFixed(4)); },
        onchange: (e) => {
          S.values[v.id] = Number(e.target.value);
          live(true);
          P().rerender();
        },
      });
      const kids = [el('div', { class: 'row' }, [el('label', { class: 'lbl', text: VALUE_LABELS[v.id] }), val]), input];
      const o = S.over && S.over[v.id];
      if (o) {
        kids.push(el('button', {
          class: 'mded-over', type: 'button',
          onclick: () => jump(o.block, o.line),
        }, [
          el('span', {
            text: o.relative
              ? 'Presetin denklemleri bu değeri her karede kendisinden yeniden hesaplıyor; kaydırıcı hesabın başladığı değeri değiştirir.'
              : 'Presetin denklemleri bu değeri her karede baştan yazıyor; kaydırıcının görüntüye etkisi olmaz.',
          }),
          el('span', { class: 'mded-where', text: blockLabel(o.block) + ', ' + tr('satır') + ' ' + (o.line + 1) + ' (' + keyName(o.block, o.line) + ')' }),
        ]));
      }
      nodes.push(el('div', { class: 'ctrl' }, kids));
    }
    return nodes;
  }

  function textTab() {
    const el = P().el;
    const ta = el('textarea', {
      class: 'mded-input mded-raw', spellcheck: 'false', autocomplete: 'off', rows: '18',
      'data-block': '__text', 'aria-label': tr('Presetin metni'),
    });
    ta.value = S.source;
    ta.addEventListener('input', () => {
      /* Ham metin yeni temel: bloklar ve değerler ondan yeniden okunuyor,
         öteki sekmeler bir sonraki çizimde onu gösteriyor. */
      S.original = ta.value;
      S.slots = slotsFor(ta.value);
      const r = E().read(ta.value, S.slots);
      S.blocks = r.blocks;
      S.values = r.values;
      S.focus = { block: '__text', start: ta.selectionStart, end: ta.selectionEnd };
      live(false);
    });
    return [
      el('div', { class: 'studio-note dim-hint', text: 'Presetin bütün metni. Burada yapılan değişiklik öteki sekmelere de geçer.' }),
      el('div', { class: 'mded-code' }, [ta]),
    ];
  }

  function tabBody() {
    const el = P().el;
    switch (S.tab) {
      case 'frame': return [field('per_frame_init', 6), field('per_frame', 14)];
      case 'pixel': return [field('per_pixel', 16)];
      case 'waves': {
        const i = S.wave;
        return [slotPicker('wave'), field('wave_' + i + '_init', 4), field('wave_' + i + '_per_frame', 7), field('wave_' + i + '_per_point', 9),
          el('div', { class: 'studio-note dim-hint', text: 'Dalganın rengi, nokta sayısı ve açık/kapalı hâli dosyadaki wavecode satırlarında; Metin sekmesinden değiştirilebilir.' })];
      }
      case 'shapes': {
        const i = S.shape;
        return [slotPicker('shape'), field('shape_' + i + '_init', 5), field('shape_' + i + '_per_frame', 12),
          el('div', { class: 'studio-note dim-hint', text: 'Şeklin kenar sayısı, konumu ve renkleri dosyadaki shapecode satırlarında; Metin sekmesinden değiştirilebilir.' })];
      }
      case 'warp': return [shaderNote('warp'), field('warp', 18)];
      case 'comp': return [shaderNote('comp'), field('comp', 18)];
      case 'values': return valuesTab();
      case 'text': return textTab();
      default: return [];
    }
  }

  async function save(asNew) {
    if (!S || saving) return;
    if (!window.api || !window.api.savePreset) {
      P().toast(tr('Kaydetme kullanılamıyor.'), 'err');
      return;
    }
    if (timer) { clearTimeout(timer); timer = 0; }
    S.source = compose();
    const id = !asNew && S.savedId ? S.savedId
      : 'md_ed_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    saving = true;
    P().rerender();
    let res = null;
    try {
      res = await window.api.savePreset({
        id, kind: 'milkdrop', name: (S.name || '').trim() || S.baseName, source: S.source,
        author: S.author || tr('Düzenleyici'),
      });
    } catch (e) {
      res = null;
    }
    saving = false;
    if (res && res.ok && S) {
      S.savedId = res.preset && res.preset.id ? res.preset.id : id;
      const panel = MP();
      if (panel && panel.adopt) panel.adopt(res.preset);
      P().toast(tr('Preset kütüphaneye kaydedildi. Asıl preset değişmedi.'), 'ok');
    } else {
      P().toast(tr('Kaydedilemedi.'), 'err');
    }
    P().rerender();
  }

  function panel() {
    const el = P().el;
    gutters.clear();
    diagBox = null;
    if (!E() || !M()) return el('div', { class: 'studio-note md-err', text: 'Düzenleyici yüklenemedi.' });
    if (!S) {
      return el('div', { class: 'mded-panel' }, [
        el('div', { class: 'gen-actions' }, [
          el('button', { class: 'btn primary', type: 'button', text: '✏️ Ekrandakini Düzenle', onclick: () => start() }),
        ]),
        el('div', {
          class: 'studio-note dim-hint',
          text: 'Ekrandaki MilkDrop presetini açar: denklemler, dalgalar, şekiller ve shader\'lar düzenlenir, sonuç çalışan görüntüde hemen görünür. Asıl preset hiç değişmez; beğendiğinizi yeni bir preset olarak kaydedin.',
        }),
      ]);
    }
    const counts = {};
    for (const d of allErrors()) counts[tabOf(d.block)] = (counts[tabOf(d.block)] || 0) + 1;
    const nameIn = el('input', {
      class: 'p-in', type: 'text', value: S.name, spellcheck: 'false', 'aria-label': tr('Ad'),
      oninput: (e) => { S.name = e.target.value; },
    });
    const head = [
      el('div', { class: 'gen-pair' }, [
        el('span', { class: 'dim-hint', text: 'Düzenlenen' }),
        // Presetin adı onun kendi adı, arayüz metni değil
        el('span', { class: 'md-cur mdgen-name', text: S.baseName }),
        el('span', { class: 'dim-hint', text: 'Durum' }),
        el('span', { class: S.savedId ? 'md-ok' : 'dim-hint', text: S.savedId ? '✓ Kütüphanede' : 'Önizleme — kaydedilmedi' }),
      ]),
      P().row('Ad', nameIn),
      el('div', { class: 'gen-actions' }, [
        el('button', {
          class: 'btn primary', type: 'button', disabled: saving,
          text: saving ? 'Kaydediliyor…' : (S.savedId ? '💾 Kaydedileni Güncelle' : '💾 Yeni Preset Olarak Kaydet'),
          onclick: () => save(false),
        }),
        S.savedId ? el('button', { class: 'btn', type: 'button', text: '📄 Yeni Kopya', disabled: saving, onclick: () => save(true) }) : null,
        el('button', { class: 'btn', type: 'button', text: '↺ Baştan', title: 'Bütün değişiklikleri geri alır', onclick: () => reset() }),
        el('button', { class: 'btn ghost', type: 'button', text: '✕ Kapat', title: 'Düzenleyiciyi kapatır; kaydedilmediyse asıl preset geri gelir', onclick: () => close() }),
      ]),
    ];
    const tabs = el('div', { class: 'layer-tabs mded-tabs', role: 'tablist' }, TABS.map(([id, label]) => el('button', {
      class: 'layer-tab' + (S.tab === id ? ' active' : ''), type: 'button', role: 'tab',
      'aria-selected': S.tab === id ? 'true' : 'false',
      onclick: () => { S.tab = id; S.focus = null; P().rerender(); },
    }, [
      el('span', { text: label }),
      counts[id] ? el('span', { class: 'mded-badge', text: String(counts[id]) }) : null,
    ])));
    diagBox = el('div', { class: 'mded-diag', 'aria-live': 'polite' }, diagNodes());
    const root = el('div', { class: 'mded-panel' }, head.concat([
      tabs,
      el('div', { class: 'mded-body' }, tabBody()),
      el('div', { class: 'mded-label', text: 'Hatalar' }),
      diagBox,
      el('div', {
        class: 'studio-note dim-hint',
        text: 'Değişiklik yazmayı bıraktıktan kısa süre sonra çalışan presete uygulanır. Düzenlerken otomatik geçiş duraklar. MilkDrop satırları araya bir şey koymadan birleştirir: deyimleri ; ile bitirin.',
      }),
    ]));
    restoreFocus(root);
    return root;
  }

  window.SVMdEditPanel = {
    panel, start, close, reset, save, live, check,
    state: () => S,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.SVMdEditPanel;
})();
