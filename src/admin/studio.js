/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Studio — kullanıcının kendi görselleştirici/arkaplan presetlerini yaptığı editör.

   İki motor:
     • Varyasyon — hazır bir modun ayarlarının anlık görüntüsü. Kod yok; "şu an
       ekranda gördüğüm görünümü isimlendirip sakla" demek.
     • Shader    — WebGL2 fragment shader. Giriş noktası Shadertoy ile aynı
       (mainImage), üstüne ses uniform'ları ve kullanıcının kendi tanımladığı
       kaydırıcılar eklenir.

   Neden shader tercih edildi: GPU sürücüsü shader'ı zaten kumlar. İnternetten
   indirilen bir preset dosya sistemine, ağa veya uygulamanın belleğine
   erişemez — keyfi JavaScript çalıştıran bir eklenti sisteminin aksine. */
(function () {
  const P = () => window.SVPanel;
  const IS = () => window.SVPresets;
  const trStudio = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  let selectedId = null;
  let draft = null; // düzenlenen presetin çalışma kopyası
  let dirty = false;
  let sidebarScroll = 0;
  let host = null; // önizleme shader motoru
  let previewCanvas = null;
  let previewRaf = 0;
  let compileState = { ok: true, message: '', line: 0 };
  let compileTimer = null;

  const STARTER_SHADER = `// Kendi görselleştiricin.
// Kullanabileceklerin:
//   sv_resolution, sv_time, sv_level, sv_bass, sv_mid, sv_treble, sv_beat
//   sv_spec(x)   -> 0..1 konumundaki spektrum değeri
//   sv_waveAt(x) -> dalga formu (-1..1)
//   sv_col(x)    -> senin 5 renkli paletinden renk
//   sv_prev      -> bir önceki kare (geri besleme), sv_media -> kamera/video
// Aşağıya kendi kaydırıcılarını da ekleyebilirsin (Parametreler bölümü).

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * sv_resolution) / min(sv_resolution.x, sv_resolution.y);
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  float spec = sv_spec(clamp(r * 1.6, 0.0, 1.0));
  float ring = smoothstep(0.02, 0.0, abs(r - 0.25 - spec * 0.25));

  vec3 col = sv_col(fract(a / 6.2831853 + sv_time * 0.05)) * ring;
  col += sv_col(0.5) * exp(-r * 5.0) * sv_bass * 0.8;

  fragColor = vec4(col, clamp(ring + sv_bass * 0.2, 0.0, 1.0));
}`;

  // ==========================================================================
  // GLSL renklendirme
  //
  // Tam bir ayrıştırıcı gerekmiyor: metin önce HTML olarak kaçırılıyor, sonra
  // tek geçişte belirteçlere ayrılıyor. Öncelik sırası önemli — yorum ve sayı
  // önce yakalanmazsa anahtar kelime kuralı onların içine girer.
  // ==========================================================================
  const KEYWORDS = /\b(void|return|if|else|for|while|break|continue|discard|const|uniform|in|out|inout|struct|precision|highp|mediump|lowp|true|false)\b/g;
  const TYPES = /\b(float|int|bool|vec2|vec3|vec4|ivec2|ivec3|ivec4|bvec2|bvec3|bvec4|mat2|mat3|mat4|sampler2D)\b/g;
  const BUILTINS = /\b(sv_time|sv_resolution|sv_level|sv_bass|sv_mid|sv_treble|sv_beat|sv_spec|sv_waveAt|sv_col|sv_prev|sv_media|sv_palette|sv_hueRotate|sv_spectrum|sv_wave|iTime|iResolution|iMouse|iFrame|iTimeDelta|iChannel0|iChannel1|iChannel2|iChannel3|mainImage|gl_FragCoord|texture|mix|clamp|smoothstep|fract|floor|ceil|abs|sin|cos|tan|atan|pow|exp|log|sqrt|min|max|length|normalize|dot|cross|mod|step|sign|reflect)\b/g;

  function highlight(src) {
    let s = src
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // Yorumlar ve sayılar önce; sonrasında bunların içine girilmesin diye
    // yer tutucu kullanılıyor.
    const holds = [];
    const hold = (cls, text) => {
      holds.push('<span class="' + cls + '">' + text + '</span>');
      return '\u0000' + (holds.length - 1) + '\u0000';
    };
    s = s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => hold('c-com', m));
    s = s.replace(/^[ \t]*#[^\n]*/gm, (m) => hold('c-pre', m));
    s = s.replace(/\b\d+\.?\d*(e[-+]?\d+)?\b/gi, (m) => hold('c-num', m));
    s = s.replace(TYPES, '<span class="c-typ">$1</span>');
    s = s.replace(KEYWORDS, '<span class="c-kw">$1</span>');
    s = s.replace(BUILTINS, '<span class="c-fn">$1</span>');
    s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => holds[+i]);
    return s;
  }

  // ==========================================================================
  // Kod editörü — satır numarası, renklendirme, sekme, hata satırı
  // ==========================================================================
  function codeEditor(value, onChange) {
    const el = P().el;
    const gutter = el('div', { class: 'code-gutter' });
    const code = el('code');
    const pre = el('pre', { class: 'code-hl' }, [code]);
    const ta = el('textarea', {
      class: 'code-input',
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
    });
    ta.value = value || '';

    const sync = () => {
      code.innerHTML = highlight(ta.value) + '\n';
      const lines = ta.value.split('\n').length;
      let g = '';
      for (let i = 1; i <= lines; i++) g += i + '\n';
      gutter.textContent = g;
      markError();
    };
    const scroll = () => {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
      gutter.scrollTop = ta.scrollTop;
    };

    const errLine = el('div', { class: 'code-errline' });
    function markError() {
      if (compileState.ok || !compileState.line) {
        errLine.style.display = 'none';
        return;
      }
      const lineH = ta.scrollHeight / Math.max(1, ta.value.split('\n').length);
      errLine.style.display = 'block';
      errLine.style.top = (compileState.line - 1) * lineH - ta.scrollTop + 'px';
      errLine.style.height = lineH + 'px';
    }

    ta.addEventListener('input', () => { sync(); onChange(ta.value); });
    ta.addEventListener('scroll', () => { scroll(); markError(); });
    // Sekme tuşu odağı değil, girinti eklesin
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 2;
      sync();
      onChange(ta.value);
    });

    const wrap = el('div', { class: 'code-editor' }, [gutter, el('div', { class: 'code-body' }, [errLine, pre, ta])]);
    sync();
    wrap.refresh = sync;
    wrap.textarea = ta;
    return wrap;
  }

  // ==========================================================================
  // Önizleme
  // ==========================================================================
  function ensureHost() {
    if (host) return host;
    try { host = new window.SVShaderHost({ transparent: true }); } catch { host = null; }
    return host;
  }

  function startPreview() {
    stopPreview();
    if (!previewCanvas) return;
    const ctx = previewCanvas.getContext('2d');
    const h = ensureHost();
    if (!h) return;
    let last = 0;
    const loop = (now) => {
      previewRaf = requestAnimationFrame(loop);
      if (!previewCanvas.isConnected) { stopPreview(); return; }
      if (now - last < 22) return; // ~45 FPS
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      const rect = previewCanvas.getBoundingClientRect();
      const w = Math.max(2, Math.round(rect.width));
      const hh = Math.max(2, Math.round(rect.height));
      if (previewCanvas.width !== w || previewCanvas.height !== hh) {
        previewCanvas.width = w;
        previewCanvas.height = hh;
      }
      h.resize(w, hh);
      const audio = window.SVPreview && window.SVPreview.audioEngine ? window.SVPreview.audioEngine() : null;
      const cfg = P().cfg();
      ctx.clearRect(0, 0, w, hh);
      if (!compileState.ok || !draft) return;
      const values = valuesFor(draft);
      if (h.render(audio, cfg, now / 1000, dt, draft.controls, values)) {
        ctx.drawImage(h.canvas, 0, 0, w, hh);
      }
    };
    previewRaf = requestAnimationFrame(loop);
  }

  function stopPreview() {
    if (previewRaf) cancelAnimationFrame(previewRaf);
    previewRaf = 0;
  }

  function valuesFor(preset) {
    const out = {};
    for (const c of preset.controls || []) out[c.name] = c.value == null ? c.default : c.value;
    return out;
  }

  function compileNow() {
    if (!draft || draft.engine !== 'shader') { compileState = { ok: true, message: '', line: 0 }; return; }
    const h = ensureHost();
    if (!h) { compileState = { ok: false, message: 'WebGL2 kullanılamıyor.', line: 0, noGl: true }; return; }
    h.resize(64, 64);
    const r = h.setSource(draft.shader, draft.controls);
    compileState = r.ok
      ? { ok: true, message: 'Derlendi.', line: 0 }
      : { ok: false, message: r.error.message, line: r.error.line || 0 };
  }

  // ==========================================================================
  // Preset işlemleri
  // ==========================================================================
  function newShader(kind) {
    return IS().normalize({
      name: kind === 'background' ? 'Yeni Arkaplan' : 'Yeni Görselleştirici',
      kind,
      engine: 'shader',
      shader: STARTER_SHADER,
      controls: [
        { name: 'uAmount', label: 'Miktar', type: 'slider', min: 0, max: 2, step: 0.01, default: 1 },
      ],
    });
  }

  /* Şu anki görünüm. Yığın açıkken ekranı ilk canlı katman çiziyor ve
     klasik `visualizer.type` bilerek 'none'; varyasyon eskiden onu
     yakalıyordu (taban 'none', ayarlar katmanınki değil). */
  function currentLook(cfg, kind) {
    const L = window.SVLayers;
    const section = kind === 'background' ? 'background' : 'visualizer';
    if (L && L.stackOn && L.firstLayerIndex && L.layerConfig && L.stackOn(cfg)) {
      const i = L.firstLayerIndex(cfg, section);
      if (i >= 0) return L.layerConfig(cfg, cfg.layers[i]);
    }
    return cfg;
  }

  function newVariation(kind) {
    const look = currentLook(P().cfg(), kind);
    return IS().normalize({
      name: kind === 'background' ? 'Arkaplan Varyasyonum' : 'Görselleştiricim',
      kind,
      engine: 'variation',
      base: kind === 'background' ? look.background.type : look.visualizer.type,
      overrides:
        kind === 'background'
          ? { background: JSON.parse(JSON.stringify(look.background)) }
          : { visualizer: JSON.parse(JSON.stringify(look.visualizer)), feedback: JSON.parse(JSON.stringify(look.feedback || {})) },
    });
  }

  /* Kaydedilen/silinen hemen ortak listeye (#574). Değişiklik yayını da
     geliyor ama IPC yanıtından sonra gelebilir; ikisi aynı sonucu veriyor,
     yani iki kez uygulanması zararsız. */
  function adopt(delta) {
    const S = IS();
    if (S && typeof S.applyDelta === 'function') S.applyDelta(delta);
  }

  function selectPreset(id) {
    const p = IS().get(id);
    const sb = document.querySelector('.studio-sidebar');
    if (sb) sidebarScroll = sb.scrollTop;
    selectedId = id;
    draft = p ? JSON.parse(JSON.stringify(p)) : null;
    // Kaydedilmiş parametre değerlerini taslağa taşı (editörde canlı görünsün)
    if (draft) {
      const saved = (P().cfg().custom.params || {})[draft.id] || {};
      for (const c of draft.controls || []) if (c.name in saved) c.value = saved[c.name];
    }
    dirty = false;
    compileNow();
    P().rerender();
  }

  /* Kaydedildiyse true. Derlenmeyen shader de kaydedilebilir (yarım iş
     saklanır) ama kullanıcı uyarılır. */
  async function saveDraft() {
    if (!draft) return false;
    if (draft.builtin) {
      // Yerleşikler değiştirilemez: düzenleme kopya üzerinden sürer
      const baseName = trStudio(draft.name);
      draft = IS().normalize(Object.assign({}, draft, { id: null, builtin: false, name: baseName + ' (kopya)' }));
    }
    const toSave = JSON.parse(JSON.stringify(draft));
    // Parametre değerleri presetin içinde değil, yapılandırmada tutulur
    const values = {};
    for (const c of toSave.controls || []) {
      if (c.value != null) values[c.name] = c.value;
      delete c.value;
    }
    const r = await window.api.savePreset(toSave);
    if (!r.ok) {
      P().toast(r.error === 'TOO_LARGE' ? 'Preset çok büyük (512 KB üstü).' : 'Kaydedilemedi: ' + r.error, 'err');
      return false;
    }
    adopt({ upsert: [r.preset] });
    const cfg = P().cfg();
    cfg.custom.params = cfg.custom.params || {};
    if (Object.keys(values).length) cfg.custom.params[r.preset.id] = values;
    P().push(true);
    selectedId = r.preset.id;
    dirty = false;
    P().rerender();
    if (shaderBroken()) P().toast('“' + r.preset.name + '” kaydedildi, ama shader derlenmiyor.', 'warn');
    else P().toast('“' + r.preset.name + '” kaydedildi.', 'ok');
    return true;
  }

  // Taslak shader'ı şimdi derlenmiyor mu (WebGL yoksa bilinemez, engel sayılmaz)
  function shaderBroken() {
    if (!draft || draft.engine !== 'shader') return false;
    return !!(compileState && compileState.ok === false && !compileState.noGl);
  }

  /* Taslak kaydedilmemişse ne yapılsın? Değişiklik yoksa sormaz.
     Eskiden başka bir presete tıklamak düzenlemeyi uyarısız atıyordu. */
  async function confirmDiscard() {
    if (!dirty || !draft) return true;
    return P().confirm('“' + (draft.name || '') + '” üzerindeki kaydedilmemiş değişiklikler kaybolacak.', { danger: true, okText: 'Değişiklikleri At' });
  }

  async function guardedSelect(id) {
    if (id === selectedId && !dirty) return;
    if (!(await confirmDiscard())) return;
    selectPreset(id);
  }

  async function startDraft(make) {
    if (!(await confirmDiscard())) return;
    draft = make();
    selectedId = null;
    dirty = true;
    compileNow();
    P().rerender();
  }

  /* Ekran presetin KAYITLI hâlini kimliğiyle çizer; kaydedilmemiş kod
     sahneye gidemez. Eskiden düğme son kaydı uyguluyor, ekranda eski hâl
     kalıyordu; yeni (hiç kaydedilmemiş) taslakta da hiçbir şey olmuyordu.
     Derlenmeyen shader için de "uygulandı" deniyor, çıkış boş kalıyordu. */
  async function applyToScene() {
    if (!draft) return;
    if (draft.engine === 'shader') {
      clearTimeout(compileTimer);
      compileNow();
      if (shaderBroken()) {
        P().rerender();
        P().toast('Shader derlenmiyor; sahneye uygulanmadı. Önce hatayı düzeltin.', 'err');
        return;
      }
    }
    if (dirty || !selectedId) {
      const ok = await P().confirm(
        'Sahnede kullanmak için önce kaydedilmesi gerekiyor. ' + (draft.builtin ? 'Yerleşik preset değişmez; kendi kopyan kaydedilir.' : 'Değişiklikler kaydedilecek.'),
        { okText: 'Kaydet ve Uygula' }
      );
      if (!ok) return;
      if (!(await saveDraft())) return;
    }
    const cfg = P().cfg();
    const p = IS().get(selectedId) || draft;
    applyPresetToCfg(cfg, p);
    P().push(true);
    P().rerender();
    P().toast('“' + p.name + '” sahneye uygulandı.', 'ok');
  }

  // Presetin sahneye uygulanması (panelsiz sınanabilsin diye ayrı)
  function applyPresetToCfg(cfg, p) {
    const L = window.SVLayers;
    if (p.engine === 'variation') {
      // Varyasyon: kaydedilmiş ayar parçalarını doğrudan sahneye uygula
      for (const key of Object.keys(p.overrides || {})) {
        cfg[key] = window.SV.deepMerge(cfg[key] || {}, p.overrides[key]);
      }
      /* Yığın açıkken klasik tür 'none' olabilir; yığında yakalanmış eski
         bir varyasyon da 'none' taşıyabilir. Görünen bir tür seçilir. */
      const real = (x) => (x && x !== 'none' ? x : null);
      if (p.kind !== 'background' && L && L.adoptVisualizer) {
        L.adoptVisualizer(cfg, {
          type: real(p.overrides && p.overrides.visualizer && p.overrides.visualizer.type) || real(p.base)
            || real(cfg.visualizer && cfg.visualizer.type) || 'bars',
          visualizer: p.overrides && p.overrides.visualizer,
        });
      }
      // Arkaplan varyasyonu yığında ilk arkaplan katmanına (kopyası genel alanı eziyordu)
      if (p.kind === 'background' && L && L.adoptBackground) {
        L.adoptBackground(cfg, {
          type: (p.overrides && p.overrides.background && p.overrides.background.type) || p.base || cfg.background.type,
          background: p.overrides && p.overrides.background,
        });
      }
    } else if (p.kind === 'background') {
      cfg.background.type = 'custom';
      cfg.custom.backgroundId = p.id;
      if (L && L.adoptBackground) L.adoptBackground(cfg, { type: 'custom', presetId: p.id });
    } else {
      cfg.visualizer.type = 'custom';
      cfg.custom.visualizerId = p.id;
      if (L && L.adoptVisualizer) L.adoptVisualizer(cfg, { type: 'custom', presetId: p.id });
    }
  }

  async function exportPreset(asPack) {
    const list = asPack ? IS().user() : [draft];
    if (!list.length || !list[0]) { P().toast('Dışa aktarılacak preset yok.', 'err'); return; }
    /* Pakette MilkDrop presetlerinin favori, etiket ve puanları da gidiyor
       (#576); kayıt her presetin kendi `library` alanında. */
    const ML = window.SVMilkdropLibrary;
    const lib = P().cfg().milkdropLibrary;
    const libraryOf = ML ? (p) => ML.packEntry(lib, p.id) : null;
    const data = asPack ? IS().makePack(list, { name: 'CAYADEV Preset Paketi' }, libraryOf) : IS().normalize(list[0]);
    const name = asPack ? 'cayadev-presetler.svpack' : slug(list[0].name) + '.svpreset';
    const r = await window.api.exportJson(name, data);
    if (r && r.ok) P().toast('Dosyaya yazıldı.', 'ok');
  }

  function slug(s) {
    return String(s || 'preset').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'preset';
  }

  // İçe aktarma: hem kendi biçimimiz hem Shadertoy / ISF / MilkDrop
  async function importAny() {
    if (!(await confirmDiscard())) return;
    const r = await window.api.importShaderText();
    if (!r || !r.ok) {
      if (r && r.error === 'FILE_TOO_LARGE') P().toast('Dosya çok büyük (2 MB üstü).', 'err');
      return;
    }
    const ext = r.ext;
    let result = null;

    if (ext === '.json' || ext === '.svpreset' || ext === '.svpack') {
      let data;
      try { data = JSON.parse(r.text); } catch { P().toast('JSON çözümlenemedi.', 'err'); return; }
      const read = IS().readImported(data);
      if (!read.ok) { P().toast(read.error, 'err'); return; }
      const saved = await window.api.savePresets(read.presets);
      adopt({ upsert: (saved && saved.saved) || [] });
      // Paketle gelen favori, etiket ve puanlar yeni kimliklere (#576)
      const ML = window.SVMilkdropLibrary;
      const cfg = P().cfg();
      if (ML && read.library && Object.keys(read.library).length) {
        const lib = cfg.milkdropLibrary || (cfg.milkdropLibrary = {});
        if (ML.adopt(lib, read.library, (saved && saved.saved) || [])) P().push(true);
      }
      P().toast(read.presets.length + ' preset içe aktarıldı.', 'ok');
      if (saved.saved && saved.saved[0]) selectPreset(saved.saved[0].id);
      return;
    }

    if (ext === '.milk') result = IS().fromMilk(r.text, r.name);
    else if (/\/\*\s*\{/.test(r.text) && /INPUTS|ISFVSN/.test(r.text)) result = IS().fromISF(r.text, r.name);
    else result = IS().fromShadertoy(r.text, r.name);

    if (!result.ok) { P().toast(result.error, 'err'); return; }
    const saveRes = await window.api.savePreset(result.preset);
    if (!saveRes.ok) { P().toast('Kaydedilemedi: ' + saveRes.error, 'err'); return; }
    adopt({ upsert: [saveRes.preset] });
    selectPreset(saveRes.preset.id);
    const note = (result.notes || []).join(' ');
    P().toast('İçe aktarıldı.' + (note ? ' ' + note : ''), 'ok');
  }

  /* Bir sahne (ya da şimdiki görünüm) bu Studio presetini kullanıyor mu?
     Klasik kipte `custom.visualizerId/backgroundId` tür 'custom' iken,
     yığında katmanın `presetId`si ya da kimliksiz 'custom' katmanın
     devraldığı genel kimlik. */
  function usesPreset(data, id) {
    if (!data || !id) return false;
    const c = data.custom || {};
    const layers = Array.isArray(data.layers) ? data.layers : [];
    if (layers.some((l) => l && l.presetId === id)) return true;
    const inherits = (kind) => layers.some((l) => l && l.kind === kind && l.type === 'custom' && !l.presetId);
    if (c.visualizerId === id && ((data.visualizer && data.visualizer.type === 'custom') || inherits('visualizer'))) return true;
    if (c.backgroundId === id && ((data.background && data.background.type === 'custom') || inherits('background'))) return true;
    return false;
  }
  function presetUsers(cfg, id) {
    const scenes = (Array.isArray(cfg && cfg.scenes) ? cfg.scenes : [])
      .filter((sc) => sc && usesPreset(sc.data, id))
      .map((sc) => sc.name || sc.id);
    return { scenes, live: usesPreset(cfg, id) };
  }

  /* Silme onayı presetin nerede kullanıldığını söyler. Eskiden yalnız
     "kalıcı olarak silinecek" deniyordu; sahne sonra uygulanınca katman
     "Görselleştirici · Studio" olarak kalıyor, hiçbir şey çizmiyordu. */
  function deleteMessage(cfg, p) {
    const u = presetUsers(cfg, p.id);
    let msg = '“' + p.name + '” kalıcı olarak silinecek.';
    if (u.scenes.length) msg += ' Bu sahnelerde kullanılıyor: ' + u.scenes.join(', ') + '. O sahnelerde bu görsel boş kalır.';
    if (u.live) msg += ' Şu anki görünümde de kullanılıyor.';
    return msg;
  }

  async function deleteDraft() {
    if (!draft || draft.builtin) return;
    if (!(await P().confirm(deleteMessage(P().cfg(), draft), { danger: true, okText: 'Sil' }))) return;
    await window.api.deletePreset(draft.id);
    adopt({ remove: [draft.id] });
    selectedId = null;
    draft = null;
    P().rerender();
  }

  // ==========================================================================
  // Arayüz
  // ==========================================================================
  function presetList() {
    const el = P().el;
    const list = IS().all();
    const host = el('div', { class: 'studio-list' });
    const groups = [
      ['Görselleştirici', list.filter((p) => p.kind === 'visualizer')],
      ['Arkaplan', list.filter((p) => p.kind === 'background')],
    ];
    for (const [title, items] of groups) {
      host.appendChild(el('div', { class: 'studio-group', text: trStudio(title) }));
      if (!items.length) {
        host.appendChild(el('div', { class: 'studio-empty', text: 'Henüz yok.' }));
        continue;
      }
      for (const p of items) {
        host.appendChild(
          el(
            'button',
            {
              class: 'studio-item' + (p.id === selectedId ? ' active' : ''),
              type: 'button',
              title: trStudio(p.description || p.name),
              onclick: () => guardedSelect(p.id),
            },
            [
              el('span', { class: 'si-name', text: p.builtin ? trStudio(p.name) : p.name }),
              el('span', { class: 'si-tag', text: trStudio(p.builtin ? 'yerleşik' : p.engine === 'shader' ? 'shader' : 'varyasyon') }),
            ]
          )
        );
      }
    }
    return host;
  }

  function paramsEditor() {
    const el = P().el;
    const host = el('div', { class: 'studio-params' });
    (draft.controls || []).forEach((c, i) => {
      const nameIn = el('input', {
        class: 'p-in', type: 'text', value: c.name, placeholder: 'uAd',
        oninput: (e) => {
          const v = e.target.value.trim();
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) { c.name = v; markDirty(); scheduleCompile(); }
        },
      });
      const labelVal = draft.builtin ? trStudio(c.label || c.name) : (c.label || c.name);
      const labelIn = el('input', {
        class: 'p-in', type: 'text', value: labelVal, placeholder: trStudio('Etiket'),
        oninput: (e) => { c.label = e.target.value; markDirty(); },
      });
      const typeSel = el('select', {
        class: 'p-in',
        onchange: (e) => {
          c.type = e.target.value;
          c.default = c.type === 'color' ? '#3aa6ff' : c.type === 'toggle' ? true : 1;
          delete c.value;
          markDirty();
          scheduleCompile();
          P().rerender();
        },
      });
      [['slider', 'Kaydırıcı'], ['toggle', 'Anahtar'], ['color', 'Renk']].forEach(([v, t]) => {
        const o = el('option', { value: v, text: trStudio(t) });
        if (c.type === v) o.selected = true;
        typeSel.appendChild(o);
      });

      const extras = [];
      if (c.type === 'slider' || !c.type) {
        for (const [key, ph] of [['min', 'min'], ['max', 'max'], ['step', 'adım'], ['default', 'varsayılan']]) {
          extras.push(
            el('input', {
              class: 'p-in p-num', type: 'number', step: 'any', placeholder: trStudio(ph),
              value: c[key] == null ? '' : c[key],
              oninput: (e) => { c[key] = parseFloat(e.target.value); markDirty(); },
            })
          );
        }
      } else if (c.type === 'color') {
        extras.push(
          el('input', {
            class: 'p-in', type: 'color', value: c.default || '#3aa6ff',
            oninput: (e) => { c.default = e.target.value; markDirty(); },
          })
        );
      } else {
        const t = el('input', { type: 'checkbox', onchange: (e) => { c.default = e.target.checked; markDirty(); } });
        t.checked = !!c.default;
        extras.push(el('label', { class: 'switch small' }, [t, el('span', { class: 'track' })]));
      }

      const del = el('button', {
        class: 'btn ghost small', type: 'button', icon: 'x', title: 'Parametreyi kaldır',
        onclick: () => { draft.controls.splice(i, 1); markDirty(); scheduleCompile(); P().rerender(); },
      });

      host.appendChild(el('div', { class: 'studio-param' }, [nameIn, labelIn, typeSel, ...extras, del]));
    });

    host.appendChild(
      el('button', {
        class: 'btn ghost small', type: 'button', icon: 'plus', text: 'Parametre Ekle',
        onclick: () => {
          draft.controls = draft.controls || [];
          draft.controls.push({
            name: 'uParam' + (draft.controls.length + 1),
            label: 'Parametre ' + (draft.controls.length + 1),
            type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5,
          });
          markDirty();
          scheduleCompile();
          P().rerender();
        },
      })
    );
    return host;
  }

  function markDirty() {
    dirty = true;
    const b = document.getElementById('studioSave');
    if (b) b.classList.add('primary');
  }

  function scheduleCompile() {
    clearTimeout(compileTimer);
    compileTimer = setTimeout(() => {
      compileNow();
      const st = document.getElementById('studioStatus');
      if (st) {
        st.className = 'studio-status ' + (compileState.ok ? 'ok' : 'err');
        const msg = compileState.ok
          ? 'Derlendi'
          : (compileState.line ? 'Satır ' + compileState.line + ': ' : '') + compileState.message;
        if (window.SVIcons) window.SVIcons.set(st, compileState.ok ? 'check' : 'x', msg);
        else st.textContent = msg;
      }
      const ed = document.getElementById('studioCode');
      if (ed && ed.refresh) ed.refresh();
    }, 350);
  }

  function editor() {
    const el = P().el;
    if (!draft) {
      return el('div', { class: 'studio-hint' }, [
        el('p', { text: 'Soldan bir preset seç ya da yeni bir tane oluştur.' }),
        el('p', { class: 'dim', text: 'Varyasyon: şu anki görünümü isimlendirip saklar, kod gerektirmez. Shader: sıfırdan kendi efektini yazarsın.' }),
      ]);
    }

    const nameVal = draft.builtin ? trStudio(draft.name) : draft.name;
    const nameIn = el('input', {
      class: 'p-in wide', type: 'text', value: nameVal, placeholder: trStudio('Preset adı'),
      oninput: (e) => { draft.name = e.target.value.slice(0, 60); markDirty(); },
    });
    const descVal = draft.builtin ? trStudio(draft.description || '') : (draft.description || '');
    const descIn = el('input', {
      class: 'p-in wide', type: 'text', value: descVal, placeholder: trStudio('Kısa açıklama (isteğe bağlı)'),
      oninput: (e) => { draft.description = e.target.value.slice(0, 160); markDirty(); },
    });

    const kindSeg = el('div', { class: 'segment' });
    [['visualizer', 'Görselleştirici'], ['background', 'Arkaplan']].forEach(([v, t]) => {
      kindSeg.appendChild(
        el('button', {
          class: draft.kind === v ? 'active' : '', type: 'button', text: trStudio(t),
          onclick: () => { draft.kind = v; markDirty(); P().rerender(); },
        })
      );
    });

    const rows = [
      P().row('Ad', nameIn),
      P().row('Tür', kindSeg),
      P().row('Açıklama', descIn),
    ];

    if (draft.builtin) {
      rows.push(el('div', { class: 'studio-note', text: trStudio('Bu yerleşik bir preset. Kaydettiğinde kendi kopyan oluşturulur; orijinali korunur.') }));
    }

    if (draft.engine === 'variation') {
      rows.push(
        el('div', { class: 'studio-note' }, [
          el('span', { text: trStudio('Bu bir varyasyon presetidir: temel mod “' + (draft.base || '—') + '” ve o anki tüm ayarları saklanır. ') }),
        ])
      );
      rows.push(
        el('button', {
          class: 'btn ghost small', type: 'button', icon: 'refresh', text: trStudio('Şu Anki Görünümle Güncelle'),
          onclick: () => {
            const look = currentLook(P().cfg(), draft.kind);
            draft.base = draft.kind === 'background' ? look.background.type : look.visualizer.type;
            draft.overrides =
              draft.kind === 'background'
                ? { background: JSON.parse(JSON.stringify(look.background)) }
                : { visualizer: JSON.parse(JSON.stringify(look.visualizer)), feedback: JSON.parse(JSON.stringify(look.feedback || {})) };
            markDirty();
            P().toast(trStudio('Varyasyon güncel görünümle tazelendi.'), 'ok');
          },
        })
      );
    } else {
      // --- shader editörü ---
      const status = el('div', {
        id: 'studioStatus',
        class: 'studio-status ' + (compileState.ok ? 'ok' : 'err'),
        icon: compileState.ok ? 'check' : 'x',
        text: compileState.ok
          ? trStudio('Derlendi')
          : (compileState.line ? trStudio('Satır ') + compileState.line + ': ' : '') + trStudio(compileState.message),
      });
      const ed = codeEditor(draft.shader, (v) => { draft.shader = v; markDirty(); scheduleCompile(); });
      ed.id = 'studioCode';

      previewCanvas = el('canvas', { class: 'studio-preview-canvas' });
      const preview = el('div', { class: 'studio-preview' }, [previewCanvas, el('span', { class: 'sp-badge', text: trStudio('canlı') })]);

      rows.push(
        el('div', { class: 'studio-editor-grid' }, [
          el('div', { class: 'studio-code-col' }, [status, ed]),
          el('div', { class: 'studio-side-col' }, [preview, el('div', { class: 'studio-group', text: trStudio('Parametreler') }), paramsEditor()]),
        ])
      );
      setTimeout(startPreview, 0);
    }

    const actions = el('div', { class: 'studio-actions' }, [
      el('button', { id: 'studioSave', class: 'btn ' + (dirty ? 'primary' : ''), type: 'button', icon: 'save', text: 'Kaydet', onclick: saveDraft }),
      el('button', { class: 'btn', type: 'button', icon: 'play', text: 'Sahnede Kullan', onclick: applyToScene }),
      el('button', {
        class: 'btn ghost small', type: 'button', icon: 'copy', text: 'Çoğalt',
        onclick: () => {
          draft = IS().normalize(Object.assign({}, draft, { id: null, builtin: false, name: draft.name + ' 2' }));
          selectedId = null;
          markDirty();
          P().rerender();
        },
      }),
      el('button', { class: 'btn ghost small', type: 'button', icon: 'export', text: 'Dışa Aktar', onclick: () => exportPreset(false) }),
      draft.builtin
        ? null
        : el('button', { class: 'btn ghost small danger', type: 'button', icon: 'trash', text: 'Sil', onclick: deleteDraft }),
    ]);
    rows.push(actions);

    return el('div', { class: 'studio-editor' }, rows);
  }

  // Sahne kartında görünen kompakt preset seçici
  function picker(kind) {
    const el = P().el;
    const cfg = P().cfg();
    const items = IS().byKind(kind).filter((p) => p.engine === 'shader');
    const path = kind === 'background' ? 'custom.backgroundId' : 'custom.visualizerId';
    const current = P().get(path);

    if (!items.length) {
      return el('div', { class: 'ctrl studio-note', text: 'Henüz Studio preseti yok. Studio sekmesinden bir tane oluşturun.' });
    }

    const seg = el('div', { class: 'segment' });
    items.forEach((p) => {
      seg.appendChild(
        el('button', {
          class: p.id === current ? 'active' : '', type: 'button', text: p.name, title: p.description || '',
          onclick: () => { P().set(path, p.id); P().push(true); P().rerender(); },
        })
      );
    });

    const nodes = [el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [el('label', { class: 'lbl', text: 'Studio Preseti' })]), seg])];

    // Seçili presetin kendi kaydırıcıları
    const active = IS().get(current);
    if (active && active.controls && active.controls.length) {
      cfg.custom.params = cfg.custom.params || {};
      const store = (cfg.custom.params[active.id] = cfg.custom.params[active.id] || {});
      for (const c of active.controls) {
        const cur = c.name in store ? store[c.name] : c.default;
        if (c.type === 'color') {
          const inp = el('input', {
            type: 'color', value: cur || '#ffffff',
            oninput: (e) => { store[c.name] = e.target.value; P().push(false); },
          });
          nodes.push(P().row(trStudio(c.label || c.name), inp));
        } else if (c.type === 'toggle') {
          const inp = el('input', { type: 'checkbox', onchange: (e) => { store[c.name] = e.target.checked; P().push(false); } });
          inp.checked = !!cur;
          nodes.push(P().row(trStudio(c.label || c.name), el('label', { class: 'switch' }, [inp, el('span', { class: 'track' })])));
        } else {
          const val = el('span', { class: 'val', text: (+cur).toFixed(2) });
          const inp = el('input', {
            type: 'range',
            min: c.min == null ? 0 : c.min,
            max: c.max == null ? 1 : c.max,
            step: c.step == null ? 0.01 : c.step,
            value: cur,
            oninput: (e) => {
              const v = parseFloat(e.target.value);
              store[c.name] = v;
              val.textContent = v.toFixed(2);
              P().push(false);
            },
          });
          nodes.push(
            el('div', { class: 'ctrl' }, [
              el('div', { class: 'row' }, [el('label', { class: 'lbl', text: trStudio(c.label || c.name) }), val]),
              inp,
            ])
          );
        }
      }
    }
    return el('div', {}, nodes);
  }

  function panel() {
    const el = P().el;
    stopPreview();
    const toolbar = el('div', { class: 'studio-toolbar' }, [
      el('button', { class: 'btn small', type: 'button', icon: 'plus', text: trStudio('Shader'), title: trStudio('Sıfırdan GLSL shader'), onclick: () => startDraft(() => newShader('visualizer')) }),
      el('button', { class: 'btn small', type: 'button', icon: 'plus', text: trStudio('Varyasyon'), title: trStudio('Şu anki görünümü preset olarak sakla'), onclick: () => startDraft(() => newVariation('visualizer')) }),
      el('button', { class: 'btn ghost small', type: 'button', icon: 'import', text: trStudio('İçe Aktar'), title: trStudio('Shadertoy / ISF / MilkDrop / .svpreset / .svpack'), onclick: importAny }),
      el('button', { class: 'btn ghost small', type: 'button', icon: 'box', text: trStudio('Paket Dışa Aktar'), title: trStudio('Tüm kendi presetlerini tek dosyada paylaş'), onclick: () => exportPreset(true) }),
      el('button', { class: 'btn ghost small', type: 'button', icon: 'folder', text: trStudio('Klasör'), title: trStudio('Preset klasörünü aç'), onclick: () => window.api.openPresetsFolder() }),
    ]);

    const sidebar = el('div', {
      class: 'studio-sidebar',
      onscroll: (e) => { sidebarScroll = e.target.scrollTop; },
    }, [presetList()]);

    if (sidebarScroll > 0) {
      setTimeout(() => {
        sidebar.scrollTop = sidebarScroll;
        const active = sidebar.querySelector('.studio-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
      }, 0);
    }

    return el('div', { class: 'studio' }, [
      toolbar,
      el('div', { class: 'studio-body' }, [
        sidebar,
        el('div', { class: 'studio-main' }, [editor()]),
      ]),
    ]);
  }

  window.SVStudio = { panel, picker, selectPreset, currentLook, applyPresetToCfg, presetUsers, deleteMessage };
})();
