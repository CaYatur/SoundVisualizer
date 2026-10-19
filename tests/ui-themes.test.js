/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ARAYÜZ TEMALARI (#770).

   Bu testler yeni bir panel eklenince DÜŞMEK için var:
     - admin.css / studio.css'e :root dışında bir renk yazılırsa,
     - tanımsız bir değişken kullanılırsa,
     - panel betiğine (src/admin/*.js) yeni bir renk dizesi girerse,
     - bir temada yazı ile zemini arasındaki karşıtlık eşiğin altına inerse,
     - aynı kuralda yazı ve zemin olarak eşlenen iki değişken bir temada
       okunmaz olursa.
   Renk gerçekten kullanıcı içeriğiyse (palet varsayılanı, klip rengi) aşağıdaki
   JS_CONTENT listesine gerekçesiyle girer. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const T = require('../src/shared/ui-themes');
const C = require('../src/shared/ui-theme-contrast');
const S = require('./helpers/theme-scan');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const CSS_FILES = ['src/admin/admin.css', 'src/admin/studio.css'];

// ---------------------------------------------------------------------------
// Tablo
// ---------------------------------------------------------------------------
test('tema tablosu: istenen temalar ve seçimler var', () => {
  const ids = T.THEMES.map((t) => t.id);
  ['cayadev', 'dark', 'light', 'contrast'].forEach((id) => assert.ok(ids.includes(id), id));
  assert.ok(ids.length >= 6, 'birkaç farklı tarz: ' + ids.join(', '));
  assert.strictEqual(new Set(ids).size, ids.length, 'kimlikler tekil');
  assert.strictEqual(T.DEFAULT_ID, 'cayadev');
  const choices = T.CHOICES.map((c) => c.id);
  assert.deepStrictEqual(choices.filter((c) => c !== T.SYSTEM_ID).sort(), ids.slice().sort(), 'her tema seçilebilir');
  assert.ok(choices.includes(T.SYSTEM_ID), 'Cihaz varsayılanı seçilebilir');
  assert.strictEqual(T.DEFAULT_CHOICE, T.SYSTEM_ID, 'varsayılan: cihazın tercihi');
  assert.strictEqual(choices[0], T.DEFAULT_CHOICE, 'ilk seçenek varsayılan');
  T.THEMES.forEach((t) => {
    assert.ok(t.scheme === 'dark' || t.scheme === 'light', t.id + ' scheme');
    assert.ok(typeof t.name === 'string' && t.name.trim(), t.id + ' adı');
  });
  assert.ok(T.THEMES.some((t) => t.scheme === 'light') && T.THEMES.some((t) => t.scheme === 'dark'));
  assert.strictEqual(T.byId('contrast').aaa, true, 'Yüksek Karşıtlık AAA eşiğiyle ölçülür');
});

test('her tema bütün değişkenleri tanımlıyor, fazlasını değil', () => {
  T.THEMES.forEach((t) => {
    const keys = Object.keys(t.tokens).sort();
    assert.deepStrictEqual(keys, T.TOKEN_NAMES.slice().sort(), t.id);
    T.TOKEN_NAMES.forEach((n) => {
      const v = t.tokens[n];
      const c = T.parseColor(v);
      assert.ok(c, t.id + ' ' + n + ' çözülemedi: ' + v);
      if (T.TOKENS[n] === 'rgb') assert.match(v, /^\d{1,3} \d{1,3} \d{1,3}$/, t.id + ' ' + n + ' kanal biçimi');
      else assert.match(v, /^#[0-9a-f]{6}$|^rgba\(/, t.id + ' ' + n + ' renk biçimi');
      c.slice(0, 3).forEach((x) => assert.ok(x >= 0 && x <= 255, t.id + ' ' + n));
    });
  });
});

test('medya zemini her temada aynı ve koyu (üstünde görüntü durur)', () => {
  const ref = T.byId('cayadev').tokens;
  T.THEMES.forEach((t) => {
    ['--media-bg', '--media-scrim', '--on-media-rgb'].forEach((n) => assert.strictEqual(t.tokens[n], ref[n], t.id + ' ' + n));
  });
  assert.ok(T.luminance(T.parseColor(ref['--media-bg'])) < 0.02);
});

test('aydınlık temalar aydınlık, koyu temalar koyu', () => {
  T.THEMES.forEach((t) => {
    const bg = T.luminance(T.solid(t, '--bg'));
    const tx = T.luminance(T.solid(t, '--text'));
    if (t.scheme === 'light') assert.ok(bg > tx, t.id + ': zemin yazıdan açık');
    else assert.ok(bg < tx, t.id + ': zemin yazıdan koyu');
  });
});

// ---------------------------------------------------------------------------
// Karşıtlık
// ---------------------------------------------------------------------------
test('karşıtlık: her temada her kural eşiğin üstünde', () => {
  const all = [];
  T.THEMES.forEach((t) => all.push(...C.check(t).fails));
  assert.deepStrictEqual(all, [], all.map((f) => f.theme + ': ' + f.why + ' ' + f.ratio + ' < ' + f.min).join('\n'));
});

test('karşıtlık hesabı WCAG değerlerini veriyor', () => {
  assert.strictEqual(Math.round(T.contrast('#000000', '#ffffff') * 100) / 100, 21);
  assert.strictEqual(T.contrast('#777777', '#777777'), 1);
  // WCAG örneği: #767676 beyazda 4.54
  assert.strictEqual(Math.round(T.contrast('#767676', '#ffffff') * 100) / 100, 4.54);
  // Yarı saydam beyaz siyahın üstünde gri olur
  const g = T.over([255, 255, 255, 0.5], [0, 0, 0, 1]);
  assert.deepStrictEqual(g.map(Math.round), [128, 128, 128, 1]);
});

test('karşıtlık kuralları: yazı, düğme, kod ve odak halkası kapsanıyor', () => {
  const rules = C.rules();
  const has = (fg, on) => rules.some((r) => r.fg === fg && (typeof r.on === 'string' ? r.on === on : true));
  ['--text', '--muted', '--muted2'].forEach((fg) => C.SURFACES.forEach((s) => assert.ok(has(fg, s), fg + '/' + s)));
  assert.ok(has('--on-accent', '--accent'));
  assert.ok(rules.some((r) => r.on && r.on.mix), 'geçişin ortası ölçülüyor');
  ['--syn-kw', '--syn-type', '--syn-fn', '--syn-num', '--syn-com', '--syn-pre', '--code-fg'].forEach((fg) => assert.ok(has(fg, '--code-bg'), fg));
  assert.ok(rules.some((r) => r.fg === '--accent' && r.min === C.UI), 'odak halkası 3:1');
  assert.strictEqual(C.TEXT, 4.5);
  assert.strictEqual(C.AAA, 7);
});

/* Kullanıcının seçebileceği uç yuva renkleri: zemin bunlarla boyandığında
   da yazı okunmalı (#770). */
const SLOT_EXTREMES = ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#808080'];

function mixVars(value) {
  const m = /^color-mix\(in srgb,\s*var\((--[\w-]+)(?:,\s*var\((--[\w-]+)\))?\)\s+([\d.]+)%,\s*var\((--[\w-]+)\)\)$/.exec(String(value).trim());
  return m ? { top: m[1], fallback: m[2] || null, p: parseFloat(m[3]) / 100, base: m[4] } : null;
}

function mixBases(t, mx) {
  const base = T.solid(t, mx.base);
  const tops = mx.top === '--slot'
    ? SLOT_EXTREMES.map((h) => T.parseColor(h)).concat([T.solid(t, '--slot-default')])
    : [T.solid(t, mx.top)];
  return tops.map((c) => [0, 1, 2].map((i) => c[i] * mx.p + base[i] * (1 - mx.p)).concat(1));
}

/* Aynı kuralda yazı rengi ve düz zemin değişkenle verilmişse o ikili her
   temada okunmalı. Yeni bir kart kendi zeminini ve yazısını seçtiğinde
   bunu ayrıca listeye yazmak gerekmiyor. */
test('CSS kuralları: aynı kuraldaki yazı ve zemin her temada okunuyor', () => {
  const fails = [];
  const solidVar = (v) => {
    const m = /^var\((--[\w-]+)\)$/.exec(v.trim());
    return m && T.TOKENS[m[1]] === 'color' ? m[1] : null;
  };
  const gradVars = (v) => {
    const m = /^linear-gradient\(\s*[\d.]+deg\s*,\s*var\((--[\w-]+)\)\s*,\s*var\((--[\w-]+)\)\s*\)$/.exec(v.trim());
    return m ? [m[1], m[2]] : null;
  };
  let pairs = 0;
  CSS_FILES.forEach((file) => {
    S.cssRules(read(file)).forEach((r) => {
      const color = r.decls.find((d) => d.prop === 'color');
      const bg = r.decls.find((d) => d.prop === 'background' || d.prop === 'background-color');
      if (!color || !bg) return;
      const fg = solidVar(color.value);
      if (!fg || fg === '--media-bg') return;
      const b = solidVar(bg.value);
      const g = b ? null : gradVars(bg.value);
      // Örtülü zemin: rgb(var(--x-rgb) / a), kartların ve rayın üstünde
      const tm = b || g ? null : /^rgb\(var\((--[\w-]+)\) \/ ([\d.]+)\)$/.exec(bg.value.trim());
      // color-mix(in srgb, var(--a) N%, var(--b)); --slot kullanıcının rengi
      const mx = b || g || tm ? null : mixVars(bg.value);
      if (!b && !g && !tm && !mx) return;
      pairs++;
      T.THEMES.forEach((t) => {
        const min = t.aaa ? C.AAA : C.TEXT;
        const bases = [];
        if (b) bases.push(T.solid(t, b));
        else if (g) {
          const a = T.solid(t, g[0]);
          const c = T.solid(t, g[1]);
          bases.push([0, 1, 2].map((i) => (a[i] + c[i]) / 2).concat(1));
        } else if (mx) {
          mixBases(t, mx).forEach((x) => bases.push(x));
        } else {
          ['--bg2', '--card', '--card2'].forEach((s) => bases.push(T.tint(t, tm[1], parseFloat(tm[2]), s)));
        }
        bases.forEach((base) => {
          const ratio = T.contrast(T.solid(t, fg, base), base);
          if (ratio < min) fails.push(t.id + ' ' + file + ' "' + r.sel + '" ' + fg + ' on ' + (b || (g && g.join('→')) || bg.value) + ' = ' + ratio.toFixed(2));
        });
      });
    });
  });
  assert.ok(pairs >= 10, 'denetlenen ikili sayısı: ' + pairs);
  assert.deepStrictEqual(fails, []);
});

/* Klip hücresindeki yazılar rengini kendi kuralından, zemini hücrenin
   kuralından alıyor; yukarıdaki aynı-kural taraması bunları eşleştiremez.
   Zemin kullanıcının yuva rengiyle boyalı: beyaz yuvada üzerine gelince
   ikincil yazı 3.3:1'e, Aydınlık'ta geri sayım 3.5:1'e düşüyordu (#770). */
test('klip hücreleri: içindeki yazılar her yuva renginde ve her durumda okunuyor', () => {
  const rules = S.cssRules(read('src/admin/admin.css'));
  const prop = (sel, name) => {
    const hit = rules.filter((r) => r.sel.split(',').map((x) => x.trim()).includes(sel))
      .map((r) => r.decls.find((d) => d.prop === name)).filter(Boolean).pop();
    assert.ok(hit, sel + ' { ' + name + ' }');
    return hit.value;
  };
  const token = (sel) => {
    const m = /^var\((--[\w-]+)\)$/.exec(prop(sel, 'color'));
    assert.ok(m && T.TOKENS[m[1]] === 'color', sel + ' yazı rengi bir tema değişkeni');
    return m[1];
  };
  const cases = [
    { bg: ['.cd-cell.filled', '.cd-cell.filled:hover'], fg: ['.cd-cell.filled', '.cd-meta', '.cd-count'] },
    { bg: ['.perf-cell.filled'], fg: ['.perf-cell.filled'] },
    { bg: ['.perf-cell.armed'], fg: ['.perf-cell.filled', '.perf-count'] },
    { bg: ['.perf-cell.active'], fg: ['.perf-cell.active', '.perf-count'] },
    { bg: ['.cd-cell.filled.noref'], fg: ['.cd-cell.filled.noref', '.cd-meta', '.cd-count'] },
    // Önizlemeli hücre: yazı sahnenin resminin değil kendi zemininin üstünde
    {
      bg: ['.cd-cell:has(> .cd-thumb) > .cd-name', '.cd-cell:has(> .cd-thumb) > .cd-meta', '.cd-cell:has(> .cd-thumb) > .cd-count:not(:empty)'],
      fg: ['.cd-cell.filled', '.cd-meta', '.cd-count'],
    },
    {
      bg: ['.perf-cell:has(> .perf-thumb) > .perf-name', '.perf-cell:has(> .perf-thumb) > .perf-count:not(:empty)'],
      fg: ['.perf-cell.filled', '.perf-cell.active', '.perf-count'],
    },
  ];
  const fails = [];
  let checked = 0;
  cases.forEach((c) => c.bg.forEach((bgSel) => {
    const bgValue = prop(bgSel, 'background');
    const solid = /^var\((--[\w-]+)\)$/.exec(bgValue);
    const mx = solid ? { top: solid[1], p: 0, base: solid[1] } : mixVars(bgValue);
    assert.ok(mx, bgSel + ' zemini düz değişken ya da color-mix(in srgb, var(--a) N%, var(--b))');
    c.fg.forEach((fgSel) => {
      const fg = token(fgSel);
      T.THEMES.forEach((t) => {
        const min = t.aaa ? C.AAA : C.TEXT;
        mixBases(t, mx).forEach((base) => {
          checked++;
          const ratio = T.contrast(T.solid(t, fg, base), base);
          if (ratio < min) fails.push(t.id + ' ' + fgSel + ' (' + fg + ') on ' + bgSel + ' = ' + ratio.toFixed(2));
        });
      });
    });
  }));
  assert.ok(checked > 300, 'ölçülen: ' + checked);
  // Soluk gösterim opaklıkla değil renkle: opaklık yazıyı da soldurur
  rules.filter((r) => r.sel.split(',').some((x) => /\.(cd|perf)-cell[\w.:-]*$/.test(x.trim())) && r.decls.some((d) => d.prop === 'opacity'))
    .forEach((r) => fails.push(r.sel + ' { opacity }'));
  /* Önizleme konumlu ve yazıların üstüne çizilir: yazı konumlu değilse
     önizlemenin altında kalır (.cd-meta öyleydi). */
  ['.cd-name', '.cd-meta', '.perf-name'].forEach((sel) => {
    if (prop(sel, 'position') !== 'relative') fails.push(sel + ' önizlemenin altında kalıyor');
  });
  // Tarama önizlemeli hücreleri artık atlamıyor
  assert.doesNotMatch(read('src/shared/ui-contrast-audit.js'), /(cd|perf)-(thumb|cell)/);
  assert.deepStrictEqual(fails, []);
});

// ---------------------------------------------------------------------------
// CSS koruması
// ---------------------------------------------------------------------------
test('admin.css :root CaYaDev temasının aynısı', () => {
  const vars = S.rootVars(read('src/admin/admin.css'));
  const cay = T.byId('cayadev').tokens;
  T.TOKEN_NAMES.forEach((n) => assert.strictEqual(vars[n], cay[n], n));
  // :root'ta temanın dışında yalnız düzen ve türetilmiş değişkenler
  const extra = Object.keys(vars).filter((n) => !(n in cay)).sort();
  assert.deepStrictEqual(extra, ['--accent-soft', '--dock-w', '--radius', '--radius-sm', '--rail-w']);
  assert.match(vars['--accent-soft'], /^rgb\(var\(--accent-rgb\) \/ [\d.]+\)$/);
});

CSS_FILES.forEach((file) => {
  test(file + ': :root dışında renk sabiti yok', () => {
    const lits = S.cssLiterals(read(file));
    assert.deepStrictEqual(lits.map((l) => file + ':' + l.line + ' ' + l.sel + ' { ' + l.prop + ': ' + l.literal + ' }'), [],
      'renk yerine bir tema değişkeni kullanın (src/shared/ui-themes.js)');
  });

  test(file + ': kullanılan her değişken tanımlı', () => {
    const local = new Set([...S.cssLocalVars(read('src/admin/admin.css')), ...S.cssLocalVars(read('src/admin/studio.css'))]);
    // Betiğin satır içi yazdığı düzen değişkenleri (renk değil)
    const fromJs = ['--cols'];
    const known = new Set([...T.TOKEN_NAMES, ...Object.keys(S.rootVars(read('src/admin/admin.css'))), ...local, ...fromJs]);
    const missing = S.cssVarUses(read(file)).filter((u) => !known.has(u.name));
    assert.deepStrictEqual(missing.map((u) => file + ':' + u.line + ' ' + u.name), []);
  });

  test(file + ': rgb(var(--x) / a) yalnız kanal değişkenleriyle', () => {
    const bad = S.cssChannelUses(read(file)).filter((u) => T.TOKENS[u.name] !== 'rgb');
    assert.deepStrictEqual(bad.map((u) => file + ':' + u.line + ' ' + u.name), []);
  });
});

test('tarayıcı: koruma gerçekten yakalıyor', () => {
  const css = ':root { --bg: #000; }\n.a { color: #fff; }\n.b { background: rgba(0,0,0,.5); }\n' +
    '.c { border: 1px solid white; }\n/* .d { color: #123456 } */\n.e { background: url("data:x,%23fff rgba(1,2,3,.4)"); }\n' +
    '.f { background: rgb(var(--fg-rgb) / .1); color: var(--text); white-space: nowrap; }';
  const lits = S.cssLiterals(css).map((l) => l.sel + ' ' + l.literal);
  assert.deepStrictEqual(lits, ['.a #fff', '.b rgba(0', '.c white']);
  const js = "const a = '#ff0000'; // '#00ff00'\n/* '#0000ff' */ const b = x / 2 / 3; const r = /#[0-9]/; const c = `rgba(1,2,3,.5)`;";
  assert.deepStrictEqual(S.jsStringColors(js).map((x) => x.literal), ['#ff0000', 'rgba(1']);
});

// ---------------------------------------------------------------------------
// Panel betikleri
// ---------------------------------------------------------------------------
/* Panel betiklerindeki renk dizeleri: hepsi KULLANICI İÇERİĞİ. Panelin kendi
   rengi buraya girmez; SVUiTheme.color / SVUiTheme.alpha kullanılır. */
const JS_CONTENT = {
  'admin.js': {
    '#000000': [4, 'karartma ve palet: görüntünün kendi siyahı'],
    '#2a1f2e': [2, 'arkaplanı olmayan sahnenin küçük resmi'],
    '#161013': [2, 'arkaplanı olmayan sahnenin küçük resmi'],
    '#08080f': [1, 'düz arkaplanlı sahnenin küçük resmi, renk yoksa'],
    '#3aa6ff': [3, 'görselleştirici renginin varsayılanı'],
    '#d24bff': [3, 'görselleştirici ikinci renginin varsayılanı'],
    '#5b4be0': [1, 'dinamik tema paleti, kapak yokken'],
    '#37e0c8': [1, 'dinamik tema paleti, kapak yokken'],
    '#7be07b': [1, 'dinamik tema paleti, kapak yokken'],
  },
  'clipdeck-panel.js': { '#4f8cff': [1, 'klip türü renginin yedeği'] },
  'record-panel.js': { '#000': [1, 'kaydın kendi karesi: görüntüden boş kalan kenar'] },
  'scene-panels.js': {
    '#ff0055': [1, 'renk seçicinin yedeği'], '#ffffff': [3, 'metin ve Now Playing varsayılanı'],
    '#ffd23f': [2, 'şarkı sözü vurgu varsayılanı'], '#c8c8d0': [1, 'Now Playing ikincil yazı varsayılanı'],
    '#3aa6ff': [2, 'görselleştirici rengi varsayılanı'], '#ff2d3a': [1, 'görselleştirici rengi varsayılanı'],
    '#0a0a12': [3, 'düz arkaplan varsayılanı'],
  },
  'studio.js': { '#3aa6ff': [2, 'Studio renk parametresinin varsayılanı'], '#ffffff': [1, 'Studio renk parametresi'] },
  'template-panel.js': { '#333': [1, 'paleti olmayan şablonun şeridi'], '#777': [1, 'paleti olmayan şablonun şeridi'] },
  'timeline-panel.js': { '#4f8cff': [1, 'yeni klip parçasının rengi'], '#e11d2a': [1, 'yeni otomasyon parçasının rengi'] },
};

test('panel betiklerinde tema dışı renk yok (yalnız kullanıcı içeriği)', () => {
  const dir = path.join(root, 'src', 'admin');
  const got = {};
  fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((f) => {
    S.jsStringColors(fs.readFileSync(path.join(dir, f), 'utf8')).forEach((x) => {
      got[f] = got[f] || {};
      got[f][x.literal] = (got[f][x.literal] || 0) + 1;
    });
  });
  const extra = [];
  Object.keys(got).forEach((f) => Object.keys(got[f]).forEach((lit) => {
    const allow = JS_CONTENT[f] && JS_CONTENT[f][lit];
    if (!allow || got[f][lit] > allow[0]) extra.push(f + ': ' + lit + ' x' + got[f][lit]);
  }));
  assert.deepStrictEqual(extra, [], 'panelin rengi için SVUiTheme.color/alpha kullanın; kullanıcı içeriğiyse JS_CONTENT\'e gerekçesiyle ekleyin');
  // Liste bayatlamasın: kalkan bir renk listeden de çıkmalı
  const stale = [];
  Object.keys(JS_CONTENT).forEach((f) => Object.keys(JS_CONTENT[f]).forEach((lit) => {
    if (!got[f] || got[f][lit] !== JS_CONTENT[f][lit][0]) stale.push(f + ': ' + lit + ' bekleniyor x' + JS_CONTENT[f][lit][0] + ', bulundu x' + ((got[f] && got[f][lit]) || 0));
  }));
  assert.deepStrictEqual(stale, []);
});

test('tuvaller rengi temadan alıyor ve tema değişince yeniden çiziyor', () => {
  ['src/admin/timeline-panel.js', 'src/admin/mapping-panel.js'].forEach((f) => {
    const s = read(f);
    assert.match(s, /SVUiTheme/, f);
    assert.match(s, /SVUiTheme\.onChange\(/, f + ' yeniden çizim');
    assert.doesNotMatch(s, /(fillStyle|strokeStyle)\s*=\s*[^;]*['"](#|rgba?\()/, f + ' tuvale sabit renk');
  });
});

test('index.html: renk yalnız logo çiziminde; tema betikleri <head> içinde', () => {
  const html = read('src/admin/index.html');
  const noLogo = html.replace(/<svg class="brand-logo"[\s\S]*?<\/svg>/, '');
  const lits = (noLogo.match(/#[0-9a-fA-F]{3,8}\b(?![^<]*-->)|rgba?\(\s*\d/g) || [])
    .filter((l) => !/^#\d{3,4}$/.test(l)); // yorumlardaki issue numaraları değil
  assert.deepStrictEqual(lits, []);
  const head = html.slice(0, html.indexOf('</head>'));
  const a = head.indexOf('src="../shared/ui-themes.js"');
  const b = head.indexOf('src="theme-boot.js"');
  assert.ok(a > 0 && b > a, 'ui-themes.js ve sonra theme-boot.js <head> içinde');
});

// ---------------------------------------------------------------------------
// Seçim ve uygulama
// ---------------------------------------------------------------------------
test('normalizeId ve resolve', () => {
  assert.strictEqual(T.normalizeId('light'), 'light');
  assert.strictEqual(T.normalizeId('system'), 'system');
  ['', null, undefined, 'yok', '__proto__', 'constructor', 42].forEach((v) => assert.strictEqual(T.normalizeId(v), 'system', String(v)));
  assert.strictEqual(T.resolve('system', true).id, 'dark');
  assert.strictEqual(T.resolve('system', false).id, 'light');
  assert.strictEqual(T.resolve('system').id, 'dark', 'tercih bilinmiyorsa koyu');
  assert.strictEqual(T.resolve('neon', false).id, 'neon', 'somut tema tercihe bakmaz');
  assert.strictEqual(T.resolve('bilinmeyen', false).id, 'light', 'tanınmayan ayar cihazın tercihine düşer');
  assert.strictEqual(T.resolve('bilinmeyen', true).id, 'dark');
});

function fakeDom(search, prefersDarkInit) {
  const props = new Map();
  const attrs = {};
  const mqListeners = [];
  const mq = {
    matches: prefersDarkInit,
    addEventListener: (ev, fn) => mqListeners.push(fn),
  };
  const replaced = [];
  const docEl = {
    style: {
      setProperty: (k, v) => props.set(k, v),
      removeProperty: (k) => props.delete(k),
      colorScheme: '',
    },
    setAttribute: (k, v) => { attrs[k] = v; },
  };
  const win = {
    location: { search, href: 'file:///x/index.html' + search },
    history: { state: null, replaceState: (s, t, u) => replaced.push(u) },
    matchMedia: () => mq,
    console,
  };
  win.window = win;
  const ctx = vm.createContext({ window: win, document: { documentElement: docEl }, URL, URLSearchParams, console });
  vm.runInContext(read('src/shared/ui-themes.js'), ctx);
  vm.runInContext(read('src/admin/theme-boot.js'), ctx);
  return {
    win, props, attrs, docEl, replaced,
    flipScheme: (dark) => { mq.matches = dark; mqListeners.forEach((fn) => fn()); },
  };
}

test('theme-boot: adresteki tema gövdeden önce uygulanıyor', () => {
  const d = fakeDom('?uiTheme=light', true);
  assert.strictEqual(d.win.SVUiTheme.choice(), 'light');
  assert.strictEqual(d.props.get('--bg'), T.byId('light').tokens['--bg']);
  assert.strictEqual(d.docEl.style.colorScheme, 'light');
  assert.strictEqual(d.attrs['data-ui-theme'], 'light');
  assert.strictEqual(d.props.size, T.TOKEN_NAMES.length, 'bütün değişkenler yazıldı');
});

test('theme-boot: CaYaDev satır içi değerleri siler (admin.css :root geçerli)', () => {
  const d = fakeDom('?uiTheme=neon', true);
  assert.ok(d.props.size > 0);
  d.win.SVUiTheme.set('cayadev');
  assert.strictEqual(d.props.size, 0);
  assert.strictEqual(d.docEl.style.colorScheme, 'dark');
  assert.ok(d.replaced.some((u) => /uiTheme=cayadev/.test(u)), 'adres güncellendi (yeniden yükleme aynı temayla)');
});

test('theme-boot: bilinmeyen tema ve sorgusuz açılış cihazın tercihini izler', () => {
  assert.strictEqual(fakeDom('?uiTheme=<script>', true).win.SVUiTheme.choice(), 'system');
  const d = fakeDom('', false);
  assert.strictEqual(d.win.SVUiTheme.choice(), 'system');
  assert.strictEqual(d.win.SVUiTheme.current().id, 'light');
  assert.strictEqual(fakeDom('?uiTheme=cayadev', false).win.SVUiTheme.current().id, 'cayadev', 'seçilen tema cihaza bakmaz');
});

test('theme-boot: Cihaz varsayılanı sistemi canlı izliyor ve tuvallere haber veriyor', () => {
  const d = fakeDom('?uiTheme=system', true);
  assert.strictEqual(d.win.SVUiTheme.current().id, 'dark');
  const seen = [];
  d.win.SVUiTheme.onChange((t) => seen.push(t.id));
  d.flipScheme(false);
  assert.strictEqual(d.win.SVUiTheme.current().id, 'light');
  assert.strictEqual(d.props.get('--bg'), T.byId('light').tokens['--bg']);
  assert.deepStrictEqual(seen, ['light']);
  // Somut bir tema seçiliyken sistem değişikliği bir şey yapmaz
  d.win.SVUiTheme.set('midnight');
  d.flipScheme(true);
  assert.strictEqual(d.win.SVUiTheme.current().id, 'midnight');
});

test('theme-boot: tuval yardımcıları temanın rengini veriyor', () => {
  const d = fakeDom('?uiTheme=light', true);
  assert.strictEqual(d.win.SVUiTheme.color('--text'), T.byId('light').tokens['--text']);
  assert.strictEqual(d.win.SVUiTheme.alpha('--fg-rgb', 0.5), 'rgba(20,24,36,0.5)');
  assert.strictEqual(d.win.SVUiTheme.alpha('--accent', 0.25), 'rgba(200,16,46,0.25)');
  assert.strictEqual(d.win.SVUiTheme.alpha('--yok', 0.25), 'transparent');
});

// ---------------------------------------------------------------------------
// Ayar, panel, ana süreç
// ---------------------------------------------------------------------------
test('varsayılan ayar Cihaz varsayılanı; seçilmiş tema korunur', () => {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  const SV = global.window.SV;
  assert.strictEqual(SV.defaultConfig().ui.theme, T.DEFAULT_CHOICE);
  // Eski ayar dosyasında ui yoksa birleştirme varsayılanı verir
  assert.strictEqual(SV.deepMerge(SV.defaultConfig(), { power: {} }).ui.theme, 'system');
  // Kullanıcının seçtiği tema varsayılanla ezilmez
  assert.strictEqual(SV.deepMerge(SV.defaultConfig(), { ui: { theme: 'cayadev' } }).ui.theme, 'cayadev');
});

test('panel: Ayarlar kartında tema seçici; sıfırlama temayı koruyor', () => {
  const s = read('src/admin/admin.js');
  assert.match(s, /\{ type: 'uitheme', group: 'Arayüz Teması' \}/);
  assert.match(s, /roots: \['ui\.theme',/);
  assert.match(s, /role: 'radiogroup'/);
  assert.match(s, /role: 'radio'/);
  const reset = s.slice(s.indexOf("$('resetBtn').addEventListener"), s.indexOf("$('resetBtn').addEventListener") + 1200);
  assert.match(reset, /const uiTheme = cfg\.ui && cfg\.ui\.theme;/);
  assert.match(reset, /if \(uiTheme\) cfg\.ui\.theme = uiTheme;/);
  // MCP, yedek ve sıfırlama render() ile gelir; tema orada uygulanıyor
  assert.match(s, /function render\(\) \{\s*renderWanted = false;\s*syncUiTheme\(\);/);
});

test('çeviri: tema adları ve metinleri İngilizce', () => {
  const I = read('src/shared/i18n.js');
  const names = T.CHOICES.map((c) => c.name).filter((n) => n !== 'CaYaDev' && n !== 'Neon');
  names.concat(['Arayüz Teması',
    'Cihazınız şu an {0} kullanıyor; değişince panel de değişir.',
    'Yalnız paneli değiştirir; görselleştirici çıktısı, yayın katmanı ve kendi renkleriniz etkilenmez.',
    'Dil, arayüz teması, pencere koruması, genişletilmiş aralıklar ve güncellemeler.']).forEach((k) => {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(I, new RegExp("'" + esc + "': '[^']+'"), k);
  });
});

test('ana süreç: pencere zemini temadan, README görüntüleri CaYaDev, themeSource değişmiyor', () => {
  const m = read('src/main/main.js');
  const create = m.slice(m.indexOf('function createAdminWindow()'), m.indexOf('function createAdminWindow()') + 2500);
  assert.match(create, /backgroundColor: adminBgShown/);
  assert.doesNotMatch(create, /backgroundColor: '#/);
  assert.match(create, /query: \{ uiTheme: adminUiTheme\(startCfg\) \}/);
  assert.match(m, /if \(SHOTS\) return uiThemes\.DEFAULT_ID;/);
  assert.match(m, /nativeTheme\.on\('updated', syncAdminBackground\)/);
  assert.doesNotMatch(m, /themeSource\s*=/);
});

// ---------------------------------------------------------------------------
// Öz testteki ekran taraması
// ---------------------------------------------------------------------------
test('ekran taraması: renk çözme, geçiş ortalaması, katman bindirme, eşik', () => {
  const A = require('../src/shared/ui-contrast-audit');
  assert.deepStrictEqual(A.parse('rgb(1, 2, 3)'), [1, 2, 3, 1]);
  assert.deepStrictEqual(A.parse('rgba(1, 2, 3, 0.5)'), [1, 2, 3, 0.5]);
  assert.deepStrictEqual(A.parse('rgb(1 2 3 / 25%)'), [1, 2, 3, 0.25]);
  assert.strictEqual(A.parse('transparent'), null);
  // `transparent` durağı rengi karartmaz, yalnız örtüyü inceltir
  const m = A.mean([[200, 100, 50, 1], [0, 0, 0, 0]]);
  assert.deepStrictEqual(m.slice(0, 3), [200, 100, 50]);
  assert.strictEqual(m[3], 0.5);
  // color-mix() sonucu color(srgb …) olarak gelir; çözülmezse zemin atlanırdı
  assert.deepStrictEqual(A.parse('color(srgb 1 0.5 0)'), [255, 127.5, 0, 1]);
  assert.deepStrictEqual(A.parse('color(srgb 0 0 1 / 0.25)'), [0, 0, 255, 0.25]);
  assert.strictEqual(A.gradientStops('linear-gradient(color(srgb 0 0 0), rgb(1, 2, 3))').length, 2);
  assert.strictEqual(A.gradientStops('url(x.png)'), null);
  assert.strictEqual(A.gradientStops('none'), null);
  assert.strictEqual(A.gradientStops('linear-gradient(rgb(1, 2, 3), rgba(4, 5, 6, 0.5))').length, 2);
  // [0] yazının hemen arkası; ilk opak katman taban
  const b = A.backdrop([[255, 255, 255, 0.5], [0, 0, 0, 1], [255, 0, 0, 1]], [9, 9, 9, 1]);
  assert.deepStrictEqual(b.map(Math.round), [128, 128, 128, 1]);
  assert.deepStrictEqual(A.backdrop([], [9, 9, 9, 1]), [9, 9, 9, 1]);
  assert.strictEqual(A.threshold(12, 400, false), 4.5);
  assert.strictEqual(A.threshold(24, 400, false), 3);
  assert.strictEqual(A.threshold(19, 700, false), 3);
  assert.strictEqual(A.threshold(12, 400, true), 7);
  assert.strictEqual(A.threshold(24, 400, true), 4.5);
});

test('öz test her temayı panelin seçicisinden tarıyor ve kullanıcının temasına dönüyor', () => {
  const m = read('src/main/main.js');
  const i = m.indexOf('Arayüz temaları: ekrandaki yazıların karşıtlığı (#770)');
  assert.ok(i > 0, 'öz test adımı');
  const step = m.slice(i, i + 5000);
  assert.match(step, /ui-contrast-audit\.js/);
  assert.match(step, /for \(const t of UT\.THEMES\)/);
  assert.match(step, /\.ui-theme-opt\[data-theme=/);
  assert.match(step, /failCount\) errors\.push/);
  assert.match(step, /restored/);
});

test('süs ayraçları ekran okuyucudan ve ölçümden gizli', () => {
  const dir = path.join(root, 'src', 'admin');
  fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((f) => {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    const bad = (s.match(/\{ class: 'st-sep'[^}]*\}/g) || []).filter((x) => !/'aria-hidden': 'true'/.test(x));
    assert.deepStrictEqual(bad, [], f);
  });
});

/* Yazı rengi olarak kullanılan her değişkenin bir karşıtlık kuralı olmalı.
   Kural yoksa o değişken yalnız çizgi ya da süs için ayarlanmıştır ve
   bir temada yazı olarak okunmayabilir (ör. --cue-armed aydınlık temada
   3.1:1'di). Büyük yazı olan logo 3:1 kuralıyla kapsanır. */
test('yazı rengi olarak kullanılan her değişkenin karşıtlık kuralı var', () => {
  const fgs = new Set(C.rules().map((r) => r.fg));
  const missing = [];
  CSS_FILES.forEach((file) => {
    S.cssRules(read(file)).forEach((r) => r.decls.forEach((d) => {
      if (!/^(color|caret-color|fill|-webkit-text-fill-color)$/.test(d.prop)) return;
      const re = /var\((--[\w-]+)\)/g;
      let m;
      while ((m = re.exec(d.value))) {
        if (T.TOKENS[m[1]] && !fgs.has(m[1])) missing.push(file + ' "' + r.sel + '" ' + d.prop + ': ' + m[1]);
      }
    }));
  });
  assert.deepStrictEqual(missing, [], 'src/shared/ui-theme-contrast.js içine bu değişken için bir kural ekleyin');
});
