'use strict';
/* YAYIN KATMANI TANI KARTI (#565).

   OBS'te boş kalan bir yayın katmanının sebebi sayfadan okunmuyordu: bağlandı
   mı, yapılandırma geldi mi, ses akıyor mu, ne patladı? #563'ün sebebini
   bulmak bir WebSocket yoklaması gerektirdi. Adrese `?debug=1` eklenince bu
   kart sayfanın köşesinde bu soruların cevabını gösteriyor.

   İki parça:
     - SAYAÇLAR web-shim.js'te ve her zaman açık (`window.SVOverlayStatus`):
       ileti başına bir artırma, bayrak olmadan da ucuz.
     - KART ve HATA DİNLEYİCİLERİ burada ve yalnız `?debug=1` ile kuruluyor.
       Bayrak yokken sayfanın davranışı değişmiyor.

   Betik i18n.js'ten hemen SONRA, öteki bütün betiklerden ÖNCE yükleniyor:
   yüklenemeyen bir betik (v3.1.3'teki aspect.js gibi) ancak o yüklenmeden
   önce kurulmuş bir dinleyiciyle yakalanır.

   Metin parçalı kuruluyor: sabit sözcükler bir düğümde, sayılar ayrı
   düğümlerde — çeviri sözlüğü tam dizeyle eşleşiyor. Kart saniyede dört kez
   tazeleniyor ve yalnız DEĞİŞEN düğüme yazıyor; her yazım i18n gözlemcisini
   tetikliyor ve çevrilmiş bir sözcüğü her tazelemede Türkçeye geri yazmak
   onu sonsuz bir çeviri döngüsüne sokardı. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document && root.location) {
    root.SVOverlayDiag = api;
    api.install(root);
  }
})(typeof window !== 'undefined' ? window : null, function () {
  /* Kartın gösterebileceği bütün sabit metinler. Test hepsinin sözlükte
     karşılığı olduğunu denetliyor. */
  const WORDS = {
    title: 'Yayın katmanı tanılaması',
    connection: 'Bağlantı',
    configuration: 'Yapılandırma',
    audio: 'Ses',
    rendering: 'Sayfa çizimi',
    transparency: 'Şeffaf Arkaplan',
    version: 'Sürüm',
    lastError: 'Son hata',
    connected: 'bağlı',
    connecting: 'bağlanıyor',
    closed: 'bağlantı yok',
    error: 'bağlantı hatası',
    attempts: 'deneme',
    received: 'geldi',
    notReceived: 'gelmedi',
    secondsAgo: 'sn önce',
    minutesAgo: 'dk önce',
    fps: 'kare/sn',
    lastFrame: 'son kare',
    noAudio: 'ses karesi gelmedi',
    appSetting: 'uygulama ayarı',
    on: 'Açık',
    off: 'Kapalı',
    blackout: 'karartma',
    none: 'yok',
    failedToLoad: 'yüklenemedi',
  };

  const REFRESH_MS = 250;
  /* Bu kadar süre ses karesi gelmezse satır uyarı rengine döner. */
  const AUDIO_STALE_MS = 2000;

  function enabled(search) {
    return /(?:^|[?&])debug=1(?:&|$)/.test(String(search || ''));
  }

  const SEP = { text: ' · ' };
  const SP = { text: ' ' };

  /* "0.4 sn önce", "12 sn önce", "4 dk önce" — sayı ve birim ayrı parça. */
  function ago(ms) {
    const s = Math.max(0, Number(ms) || 0) / 1000;
    if (s < 60) return [{ text: s < 10 ? s.toFixed(1) : String(Math.round(s)) }, SP, { text: WORDS.secondsAgo }];
    return [{ text: String(Math.round(s / 60)) }, SP, { text: WORDS.minutesAgo }];
  }

  /* İki sayaç örneği arasındaki saniyelik artış. */
  function rate(prev, cur) {
    if (!prev || !cur) return 0;
    const dt = (cur.at - prev.at) / 1000;
    if (!(dt > 0)) return 0;
    return Math.max(0, (cur.count - prev.count) / dt);
  }

  /* Kartın satırları. Saf fonksiyon: testler DOM'suz sınıyor.
       st — web-shim sayaçları (window.SVOverlayStatus)
       m  — sayfa ölçümleri: { now, audioFps, renderFps, canvasW, canvasH,
            error: { kind: 'load'|'error', text, at } | null }
     level: 'ok' | 'warn' | 'bad' — satırın rengi. */
  function describe(st, m) {
    const s = st || {};
    const me = m || {};
    const now = Number(me.now) || 0;
    const rows = [];

    const statusWord = { connected: WORDS.connected, closed: WORDS.closed, error: WORDS.error }[s.status] || WORDS.connecting;
    const conn = [{ text: statusWord }];
    if ((s.attempts || 0) > 1) conn.push(SEP, { text: String(s.attempts) }, SP, { text: WORDS.attempts });
    rows.push({
      key: 'connection', label: WORDS.connection, parts: conn,
      level: s.status === 'connected' ? 'ok' : s.status === 'closed' || s.status === 'error' ? 'bad' : 'warn',
    });

    const configs = s.configs || 0;
    rows.push({
      key: 'configuration', label: WORDS.configuration,
      parts: configs > 0 ? [{ text: WORDS.received }, SEP].concat(ago(now - s.lastConfigAt)) : [{ text: WORDS.notReceived }],
      level: configs > 0 ? 'ok' : 'bad',
    });

    let audio;
    const frames = s.audioFrames || 0;
    if (frames > 0) {
      audio = [{ text: String(Math.round(me.audioFps || 0)) }, SP, { text: WORDS.fps }, SEP, { text: WORDS.lastFrame }, SP]
        .concat(ago(now - s.lastAudioAt));
      if (s.sampleRate) audio.push(SEP, { text: s.sampleRate + ' Hz' });
    } else {
      audio = [{ text: WORDS.noAudio }];
    }
    rows.push({
      key: 'audio', label: WORDS.audio, parts: audio,
      level: frames > 0 && now - s.lastAudioAt <= AUDIO_STALE_MS ? 'ok' : 'warn',
    });

    const w = Math.max(0, me.canvasW | 0);
    const h = Math.max(0, me.canvasH | 0);
    rows.push({
      key: 'rendering', label: WORDS.rendering,
      parts: [{ text: String(Math.round(me.renderFps || 0)) }, SP, { text: WORDS.fps }, SEP, { text: w + '×' + h }],
      level: w > 16 && h > 16 ? 'ok' : 'bad',
    });

    let tr;
    if (s.blackout) tr = [{ text: WORDS.blackout }];
    else if (s.transparency === 'forced-opaque') tr = [{ text: '?transparent=0' }, SEP, { text: WORDS.off }];
    else if (s.transparency === 'forced-transparent') tr = [{ text: '?transparent=1' }, SEP, { text: WORDS.on }];
    else tr = [{ text: WORDS.appSetting }, SEP, { text: s.appTransparent ? WORDS.on : WORDS.off }];
    rows.push({ key: 'transparency', label: WORDS.transparency, parts: tr, level: 'ok' });

    rows.push({
      key: 'version', label: WORDS.version,
      parts: [{ text: s.version ? (s.app || 'CAYADEV Visualizer') + ' ' + s.version : '—' }],
      level: s.version ? 'ok' : 'warn',
    });

    let err;
    if (me.error) {
      err = me.error.kind === 'load'
        ? [{ text: WORDS.failedToLoad }, SP, { text: me.error.text }]
        : [{ text: me.error.text }];
      err = err.concat([SEP], ago(now - me.error.at));
    } else {
      err = [{ text: WORDS.none }];
    }
    rows.push({ key: 'lastError', label: WORDS.lastError, parts: err, level: me.error ? 'bad' : 'ok' });

    return rows;
  }

  const CSS =
    '#svDiag{position:fixed;z-index:40;left:12px;top:12px;min-width:280px;max-width:min(560px,92vw);' +
    'font:12px/1.5 ui-monospace,Consolas,Menlo,monospace;color:#e9e3f2;background:rgba(12,10,18,.86);' +
    'border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:10px 12px;pointer-events:none}' +
    '#svDiag .d-title{font-weight:700;color:#fff;margin-bottom:6px}' +
    /* Etiket sütunu en uzun İngilizce etikete ("Transparent Background")
       göre: daha dar olunca o satır ikiye bölünüyordu. */
    '#svDiag .d-row{display:grid;grid-template-columns:172px 1fr;gap:10px}' +
    '#svDiag .d-k{color:#a99cbb}' +
    '#svDiag .d-v{word-break:break-word}' +
    '#svDiag .ok .d-v{color:#8be3ae}#svDiag .warn .d-v{color:#ffd27a}#svDiag .bad .d-v{color:#ff8f8f}';

  function text(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (v && typeof v.message === 'string') return v.message;
    try { return JSON.stringify(v); } catch { return String(v); }
  }

  /* Düğüme yalnız bu kodun en son yazdığından farklıysa yaz. DOM'daki metinle
     karşılaştırmak YANLIŞ olurdu: i18n onu çevirmiş olabilir ("bağlı" →
     "connected") ve her tazeleme çeviriyi geri alırdı. */
  function setText(node, value) {
    if (node.__svText === value) return;
    node.__svText = value;
    node.textContent = value;
  }

  function install(win) {
    if (!win || !win.location || !enabled(win.location.search)) return null;
    const doc = win.document;

    /* HATALAR. Yakalama aşamasında dinleniyor: yüklenemeyen bir betiğin ya
       da görselin hata olayı pencereye kabarcıklanmaz. console.error da
       sarılıyor — görselleştirici başlatma hatasını oraya yazıyor. */
    let lastError = null;
    const note = (kind, detail) => {
      lastError = { kind, text: String(detail || '').slice(0, 300), at: Date.now() };
    };
    win.addEventListener('error', (e) => {
      const t = e && e.target;
      if (t && t !== win && (t.src || t.href)) note('load', t.src || t.href);
      else note('error', (e && (e.message || (e.error && e.error.message))) || 'error');
    }, true);
    win.addEventListener('unhandledrejection', (e) => note('error', text(e && e.reason)));
    const con = win.console;
    if (con && typeof con.error === 'function') {
      const original = con.error;
      con.error = function () {
        try { note('error', Array.prototype.map.call(arguments, text).join(' ')); } catch { /* not düşmesin */ }
        return original.apply(this, arguments);
      };
    }

    /* Sayfanın kendi kare hızı: görselleştiricinin döngüsüyle aynı saatten. */
    let rafCount = 0;
    const raf = () => { rafCount++; win.requestAnimationFrame(raf); };
    win.requestAnimationFrame(raf);

    let card = null;
    let titleEl = null;
    const rowEls = {};
    let audioSample = null;
    let rafSample = null;
    let audioFps = 0;
    let renderFps = 0;

    const build = () => {
      const style = doc.createElement('style');
      style.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(style);
      card = doc.createElement('div');
      card.id = 'svDiag';
      titleEl = doc.createElement('div');
      titleEl.className = 'd-title';
      setText(titleEl, WORDS.title);
      card.appendChild(titleEl);
      doc.body.appendChild(card);
    };

    const renderRow = (row) => {
      let el = rowEls[row.key];
      if (!el) {
        const r = doc.createElement('div');
        const k = doc.createElement('span');
        const v = doc.createElement('span');
        k.className = 'd-k';
        v.className = 'd-v';
        setText(k, row.label);
        r.appendChild(k);
        r.appendChild(v);
        card.appendChild(r);
        el = rowEls[row.key] = { r, v, spans: [] };
      }
      const cls = 'd-row ' + row.level;
      if (el.r.className !== cls) el.r.className = cls;
      if (el.spans.length !== row.parts.length) {
        el.v.textContent = '';
        el.spans = row.parts.map(() => {
          const sp = doc.createElement('span');
          el.v.appendChild(sp);
          return sp;
        });
      }
      row.parts.forEach((p, i) => setText(el.spans[i], p.text));
    };

    const update = () => {
      if (!doc.body) return;
      if (!card) build();
      const st = win.SVOverlayStatus || {};
      const now = Date.now();
      const a = { count: st.audioFrames || 0, at: now };
      const f = { count: rafCount, at: now };
      if (!audioSample) audioSample = a;
      else if (now - audioSample.at >= 1000) { audioFps = rate(audioSample, a); audioSample = a; }
      if (!rafSample) rafSample = f;
      else if (now - rafSample.at >= 1000) { renderFps = rate(rafSample, f); rafSample = f; }
      let cw = 0;
      let ch = 0;
      const canvases = doc.querySelectorAll('#stage canvas');
      for (let i = 0; i < canvases.length; i++) {
        cw = Math.max(cw, canvases[i].width || 0);
        ch = Math.max(ch, canvases[i].height || 0);
      }
      const rows = describe(st, { now, audioFps, renderFps, canvasW: cw, canvasH: ch, error: lastError });
      rows.forEach(renderRow);
      /* Otomasyon (öz test) için okunabilir özet — metin çevrilse de değişmez. */
      const d = card.dataset;
      d.status = st.status || '';
      d.configs = String(st.configs || 0);
      d.audioFrames = String(st.audioFrames || 0);
      d.audioFps = String(Math.round(audioFps));
      d.renderFps = String(Math.round(renderFps));
      d.canvas = cw + 'x' + ch;
      d.version = st.version || '';
      d.error = lastError ? lastError.text : '';
    };

    win.setInterval(update, REFRESH_MS);
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', update);
    else update();
    return { update };
  }

  return { WORDS, REFRESH_MS, AUDIO_STALE_MS, enabled, ago, rate, describe, install };
});
