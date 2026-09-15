'use strict';
/* AYAR DOSYASININ BEKÇİSİ (#564).

   İki kopya uyarısı yeni sürümler arasında çalışıyor; ama v3.1.4 ve öncesi
   kayıt defterine hiç yazmıyor, dosyayı bir metin düzenleyicide değiştiren
   kullanıcı da yazmıyor. Asıl zarar ise uyarıdan bağımsız: bu kopya
   settings.json'ı başkası değiştirdikten SONRA kendi eski yapılandırmasıyla
   ezer ve o değişiklik iz bırakmadan kaybolur.

   Bekçi bu kopyanın dosyayı en son hangi hâlde bıraktığını (okuduğu ya da
   yazdığı içerik) hatırlıyor. Diskteki içerik bundan farklıysa dosyayı
   başkası değiştirmiştir; bu kopya ÜSTÜNE YAZMAMALI ve kullanıcıya sormalı.

   Karşılaştırma İÇERİKLE: önce boyut ve değiştirilme zamanı (ucuz), yalnız
   onlar farklıysa içeriğin özeti. Böylece
     - dosyaya dokunup içeriği değiştirmeyen bir program (yedekleme,
       virüs tarayıcı) çakışma saydırmaz;
     - öz testin kapanışta dosyayı AYNI içerikle geri yazması çakışma
       saydırmaz — bu kopyanın bildiği hâle dönmüş olur.

   Karar vermeyen iki durum:
     - dosya YOK: yazmak onu yeniden kurar, kimsenin değişikliğini ezmez;
     - dosya OKUNAMIYOR (başka biri tam o an yazıyor): `null` döner, bir
       sonraki denetim karar verir. */

const fs = require('fs');
const crypto = require('crypto');

function digest(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function toBuffer(content) {
  if (Buffer.isBuffer(content)) return content;
  return Buffer.from(String(content), 'utf8');
}

class SettingsGuard {
  constructor(file, fsMod) {
    this.file = file;
    this.fs = fsMod || fs;
    /* null: henüz bilinen hâl yok, bekçi karar vermez. */
    this.known = null;
  }

  _stat() {
    try {
      const s = this.fs.statSync(this.file);
      return { exists: true, size: s.size, mtimeMs: s.mtimeMs };
    } catch (e) {
      return e && e.code === 'ENOENT' ? { exists: false } : null;
    }
  }

  /* Bu kopyanın dosyayı bıraktığı hâl. `content` okunan ya da yazılan bayt
     ya da metin; `null` dosyanın hiç olmadığı anlamına gelir. */
  remember(content) {
    if (content == null) {
      this.known = { exists: false };
      return;
    }
    const buf = toBuffer(content);
    const st = this._stat();
    this.known = {
      exists: true,
      hash: digest(buf),
      size: st && st.exists ? st.size : buf.length,
      mtimeMs: st && st.exists ? st.mtimeMs : 0,
    };
  }

  /* Diskteki ayar dosyasını çöz. BOM ayıklanıyor: dosya Not Defteri'nde
     kaydedildiyse JSON.parse patlar. */
  static parse(content) {
    const text = toBuffer(content).toString('utf8').replace(/^﻿/, '');
    const s = JSON.parse(text);
    if (s && s.audio && s.audio.source && !s.audio.sources) s.audio.sources = [s.audio.source];
    return s;
  }

  /* true  — dosya bu kopyanın bıraktığı hâlden farklı: başkası değiştirdi.
     false — aynı (ya da dosya yok, ya da bilinen hâl yok).
     null  — şu an okunamadı; karar verme. */
  changed() {
    if (!this.known) return false;
    const st = this._stat();
    if (!st) return null;
    if (!st.exists) return false;
    if (!this.known.exists) return true;
    if (st.size === this.known.size && st.mtimeMs === this.known.mtimeMs) return false;
    let buf;
    try {
      buf = this.fs.readFileSync(this.file);
    } catch {
      return null;
    }
    if (digest(buf) === this.known.hash) {
      /* İçerik aynı, yalnız zaman ya da boyut bilgisi eskimiş: bir sonraki
         denetim yeniden okumasın. */
      this.known.size = st.size;
      this.known.mtimeMs = st.mtimeMs;
      return false;
    }
    return true;
  }
}

module.exports = { SettingsGuard, digest };
