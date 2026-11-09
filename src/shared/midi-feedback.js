/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MIDI çıkışı / denetleyici LED geri bildirimi.

   Eşlenmiş her denetimin hedefindeki güncel değeri denetleyiciye geri
   yollar: CC eşlemesi için CC değeri (motorlu fader, LED halkası), nota
   eşlemesi için nota (düğme ışığı açık/kapalı).

   Saf mantık; Web MIDI çıkışı çağıran tarafta (control.js). Yalnız DEĞİŞEN
   değer gider (aynı değeri her karede yollamak MIDI hattını doldurur) ve
   denetleyicinin az önce yolladığı değer geri yankılanmaz (motorlu fader
   kullanıcının elinin altında kıpırdamasın). */
(function () {
  function clampByte(v) {
    const n = Math.round(Number(v) || 0);
    return Math.max(0, Math.min(127, n));
  }

  // Eşlemenin kanalı: 0 (= her kanal) çıkışta 1. kanal olur
  function channelOf(map) {
    const c = (map && map.channel) | 0;
    return c >= 1 && c <= 16 ? c : 1;
  }

  /* Tek ileti baytları. Nota: açıkken onVelocity (renkli düğmelerde renk
     kodu), kapalıyken offVelocity ile Note On (çoğu denetleyici Note Off
     yerine sıfır hızlı Note On bekler). */
  function encode(map, value01, opts) {
    const o = opts || {};
    if (!map || !(map.cc >= 0 && map.cc <= 127)) return null;
    const ch = channelOf(map) - 1;
    if (map.relative) return null;
    if (map.feedback) return [(map.kind === 'note' ? 0x90 : 0xb0) | ch, map.cc | 0, clampByte(value01 >= 0.5 ? map.feedback.on : map.feedback.off)];
    const v = Math.max(0, Math.min(1, Number(value01) || 0));
    if (map.kind === 'note') {
      const on = v >= 0.5;
      return [0x90 | ch, map.cc | 0, clampByte(on ? (o.onVelocity == null ? 127 : o.onVelocity) : (o.offVelocity || 0))];
    }
    return [0xb0 | ch, map.cc | 0, clampByte(v * 127)];
  }

  function keyOf(kind, channel, num) {
    return (kind === 'note' ? 'n' : 'c') + ':' + (channel | 0) + ':' + (num | 0);
  }

  /* Gönderici. `send(bytes)` çağıranın; durum burada tutulur. */
  function create(opts) {
    const o = opts || {};
    const echoes = new Map();
    const now = o.now || Date.now;
    const last = new Map(); // anahtar -> son gönderilen bayt değeri
    return {
      /* items: [{ map, value01 }]. Dönüş: yollanan ileti sayısı. */
      update(items) {
        let n = 0;
        for (const [k, t] of echoes) if (now() - t >= 100) echoes.delete(k);
        for (const it of items || []) {
          const bytes = encode(it && it.map, it && it.value01, o);
          if (!bytes) continue;
          const k = keyOf(it.map.kind, channelOf(it.map), it.map.cc);
          if (last.get(k) === bytes[2]) continue;
          last.set(k, bytes[2]);
          try {
            // Senkron geri döngü de bu kaydı görmeli. Yalnız yollanan TAM ileti yankıdır.
            echoes.set(bytes.join(','), now());
            o.send(bytes); n++;
          } catch { /* çıkış kapandı; bir sonraki taramada yeniden denenir */ last.delete(k); echoes.delete(bytes.join(',')); }
        }
        return n;
      },
      /* Denetleyiciden gelen değer: aynı değeri geri yollama. */
      noteIncoming(kind, channel, num, raw) {
        const val = kind === 'note' ? (raw > 0 ? clampByte(o.onVelocity == null ? 127 : o.onVelocity) : clampByte(o.offVelocity || 0)) : clampByte(raw);
        last.set(keyOf(kind, channel, num), val);
      },
      isEcho(bytes) {
        const key = Array.from(bytes || []).join(',');
        const t = echoes.get(key);
        if (t == null || now() - t < 0 || now() - t >= 100) return false;
        echoes.delete(key);
        return true;
      },
      // Çıkış değişince her şey yeniden yollansın
      reset() { last.clear(); echoes.clear(); },
      size() { return last.size; },
    };
  }

  /* Hedefin güncel değerini 0..1'e çevirir. `t`: hedef tanımı (min/max,
     steps), `v`: güncel değer, `map`: eşlemenin kendi min/max'ı. */
  function normalize(t, map, v) {
    if (!t || v == null || typeof v === 'boolean') return v ? 1 : 0;
    if (Array.isArray(t.steps) && t.steps.length) {
      const i = t.steps.indexOf(v);
      if (i < 0) return 0;
      return t.steps.length > 1 ? i / (t.steps.length - 1) : 0;
    }
    const lo = map && map.min != null ? map.min : t.min;
    const hi = map && map.max != null ? map.max : t.max;
    const n = Number(v);
    if (!Number.isFinite(n) || !(hi !== lo)) return 0;
    return Math.max(0, Math.min(1, (n - lo) / (hi - lo)));
  }

  /* Çıkış seçimi. 'auto': seçili giriş aygıtıyla AYNI adlı çıkış(lar) —
     denetleyiciler giriş ve çıkışı aynı adla sunar. Giriş 'all' ise adı bir
     girişle eşleşen bütün çıkışlar. Belirli kimlik verilirse yalnız o. */
  function pickOutputs(outputs, inputs, outputId, inputId) {
    const outs = Array.from(outputs || []);
    if (outputId && outputId !== 'auto') return outs.filter((x) => x.id === outputId && x.state !== 'disconnected');
    const ins = Array.from(inputs || []).filter((x) => !inputId || inputId === 'all' || x.id === inputId);
    const names = new Set(ins.map((x) => String(x.name || '').trim().toLowerCase()).filter(Boolean));
    const C = typeof window !== 'undefined' ? window.SVControllerMaps : require('./controller-maps.js');
    return outs.filter((x) => x.state !== 'disconnected' && (names.has(String(x.name || '').trim().toLowerCase())
      || (C && ins.some((i) => C.paired(i.name, x.name)))));
  }

  const api = { encode, create, normalize, pickOutputs, channelOf };
  if (typeof window !== 'undefined') window.SVMidiFeedback = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
