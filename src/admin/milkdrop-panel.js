'use strict';
/* MilkDrop preset paneli.

   Presetler ayar dosyasında değil, Studio presetleriyle aynı depoda
   (userData/presets) tutulur: bir `.milk` dosyası onlarca kilobayt olabiliyor
   ve settings.json her kaydırıcı hareketinde baştan yazılıyor.

   Panelin asıl işi paketleri içeri almak. MilkDrop preset paketleri yüzlerce
   dosyadan oluşur; tek tek eklemek kullanılmaz olurdu, o yüzden çoklu seçim
   destekleniyor ve derleme hataları içe aktarma sırasında toplanıp
   gösteriliyor — bozuk bir preset sessizce boş ekran vermemeli. */
(function () {
  const P = () => window.SVPanel;
  const SP = () => window.SVScenePanels;

  let loaded = false;
  let loading = false;
  let presets = [];
  let filter = '';
  let busy = '';

  function refresh(cb) {
    if (!window.api || !window.api.listPresets || loading) return;
    loading = true;
    window.api.listPresets().then((list) => {
      loading = false;
      loaded = true;
      presets = (list || []).filter((p) => p.kind === 'milkdrop');
      if (cb) cb();
    }).catch(() => {
      loading = false;
      loaded = true;
    });
  }

  function visible() {
    const f = filter.trim().toLowerCase();
    if (!f) return presets;
    return presets.filter((p) => (p.name || '').toLowerCase().includes(f));
  }

  function load(cfg, p) {
    cfg.milkdrop = cfg.milkdrop || window.SV.defaultConfig().milkdrop;
    cfg.milkdrop.presetId = p ? p.id : '';
    cfg.milkdrop.name = p ? p.name : '';
    cfg.milkdrop.source = p ? p.source : '';
    // Sahne MilkDrop motoruna geçsin, yoksa yükleme görünmez olur
    cfg.visualizer.type = 'milkdrop';
  }

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const md = cfg.milkdrop || (cfg.milkdrop = window.SV.defaultConfig().milkdrop);
    const rerender = () => P().apply();
    const nodes = [];

    if (!loaded && !loading) {
      refresh(() => P().rerender());
    }

    // Durum
    const current = md.name || (md.source ? 'Adsız' : 'Yerleşik varsayılan');
    nodes.push(P().row('Yüklü Preset', el('span', { class: 'md-cur', text: current })));

    // Doğrulama: yüklü presetin derleme durumu
    if (md.source && window.SVMilkdrop) {
      try {
        const p = new window.SVMilkdrop.Preset(md.source);
        const stat = p.errors.length
          ? '⚠ ' + p.errors.length + ' hata'
          : '✓ ' + (p.cFrame.statements + p.cPixel.statements + p.cInit.statements) + ' deyim derlendi';
        nodes.push(P().row('Derleme', el('span', {
          class: p.errors.length ? 'md-err' : 'md-ok', text: stat,
        })));
        if (p.errors.length) {
          nodes.push(el('div', { class: 'studio-note md-errbox', text: p.errors.join('\n') }));
        }
      } catch (e) {
        nodes.push(P().row('Derleme', el('span', { class: 'md-err', text: String(e.message || e) })));
      }
    }

    // İçe aktarma
    nodes.push(el('div', { class: 'row' }, [
      el('button', {
        class: 'btn', type: 'button', text: busy || '📂 .milk Dosyaları Ekle',
        disabled: !!busy,
        onclick: async () => {
          if (!window.api || !window.api.importMilk) { P().toast('İçe aktarma kullanılamıyor.'); return; }
          busy = 'Okunuyor…';
          P().rerender();
          try {
            const r = await window.api.importMilk();
            if (!r || !r.ok) { busy = ''; P().rerender(); return; }
            const M = window.SVMilkdrop;
            const items = [];
            let bad = 0;
            for (const f of r.files) {
              const parsed = M ? new M.Preset(f.text, { name: f.name }) : null;
              if (parsed && parsed.errors.length) bad++;
              items.push({
                id: 'md_' + Math.random().toString(36).slice(2, 10),
                kind: 'milkdrop',
                name: f.name,
                source: f.text,
                updatedAt: Date.now(),
              });
            }
            if (items.length && window.api.savePresets) {
              await window.api.savePresets(items);
            }
            busy = '';
            refresh(() => {
              P().rerender();
              P().toast(items.length + ' preset eklendi' +
                (bad ? ' (' + bad + ' tanesinde derleme uyarısı var)' : '') +
                (r.skipped ? ' — ' + r.skipped + ' dosya atlandı' : ''));
            });
          } catch (e) {
            busy = '';
            P().rerender();
            P().toast('İçe aktarılamadı: ' + (e.message || e));
          }
        },
      }),
      el('button', {
        class: 'btn ghost', type: 'button', text: 'Varsayılana Dön',
        onclick: () => { load(cfg, null); rerender(); },
      }),
    ]));

    // Arama
    if (presets.length > 6) {
      nodes.push(P().row('Ara', el('input', {
        class: 'p-in', type: 'search', value: filter,
        placeholder: 'preset adı',
        oninput: (e) => { filter = e.target.value; P().rerender(); },
      })));
    }

    // Liste
    const list = el('div', { class: 'md-list' });
    const vis = visible();
    if (!vis.length) {
      list.appendChild(el('div', {
        class: 'studio-note',
        text: presets.length
          ? 'Aramaya uyan preset yok.'
          : 'Henüz preset yok. Bir MilkDrop paketindeki .milk dosyalarını ekleyin; hepsi bir kerede seçilebilir.',
      }));
    }
    vis.slice(0, 400).forEach((p) => {
      const active = md.presetId === p.id;
      list.appendChild(el('div', { class: 'md-item' + (active ? ' active' : '') }, [
        el('button', {
          class: 'md-name', type: 'button', text: p.name || p.id,
          onclick: () => { load(cfg, p); rerender(); },
        }),
        el('button', {
          class: 'btn ghost tiny danger', type: 'button', text: '✕', title: 'Sil',
          onclick: async () => {
            if (!(await P().confirm('"' + (p.name || p.id) + '" silinsin mi?'))) return;
            if (window.api.deletePreset) await window.api.deletePreset(p.id);
            if (md.presetId === p.id) load(cfg, null);
            refresh(() => rerender());
          },
        }),
      ]));
    });
    nodes.push(list);
    if (vis.length > 400) {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: vis.length + ' presetten ilk 400 gösteriliyor; aramayı daraltın.' }));
    }

    // Gezinme ve otomatik geçiş
    if (presets.length > 1) {
      const step = (dir) => {
        const i = presets.findIndex((p) => p.id === md.presetId);
        const j = ((i < 0 ? 0 : i + dir) % presets.length + presets.length) % presets.length;
        load(cfg, presets[j]);
        rerender();
      };
      nodes.push(el('div', { class: 'row' }, [
        el('button', { class: 'btn ghost', type: 'button', text: '◀ Önceki', onclick: () => step(-1) }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Sonraki ▶', onclick: () => step(1) }),
        el('button', {
          class: 'btn ghost', type: 'button', text: '🎲 Rastgele',
          onclick: () => { load(cfg, presets[(Math.random() * presets.length) | 0]); rerender(); },
        }),
      ]));
      nodes.push(SP().miniSlider('Otomatik Geçiş', () => md.autoNext || 0, (v) => { md.autoNext = Math.round(v); }, {
        min: 0, max: 120, step: 1, fmt: (v) => (v > 0 ? Math.round(v) + ' sn' : 'kapalı'),
      }));
    }

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Denklem blokları (per_frame, per_pixel) gerçekten çalıştırılır. MilkDrop 2 presetlerindeki HLSL warp ve composite shaderları henüz çevrilmiyor; o presetler denklem hareketiyle çalışır, shader katmanı olmadan.',
    }));

    return el('div', { class: 'md-panel' }, nodes);
  }

  function init() { refresh(); }

  window.SVMilkdropPanel = { panel, init, refresh };
})();
