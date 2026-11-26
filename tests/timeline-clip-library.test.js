'use strict';
/* Video klibinin kitaplık kimliği (docs/PHONE-LINK.md "Videos"). Klip modeli her çizimde
   yeniden kuruluyor; `libraryId` taşınmazsa telefonun yazdığı kimlik PC'ye varmadan siliniyor,
   PC telefonun adresini kendi dosyasına çeviremiyordu. */
const test = require('node:test');
const assert = require('node:assert');
const TL = require('../src/shared/timeline.js');
const { createLinkMedia } = require('../src/main/link-media.js');

test('video klibinin kitaplık kimliği model yeniden kurulunca kalır', () => {
  const c = TL.makeClip({ type: 'video', ref: 'https://appassets.androidplatform.net/files/lib-media/a.mp4', libraryId: 'vid_1', dur: 3 });
  assert.strictEqual(c.libraryId, 'vid_1');
  assert.strictEqual(TL.makeClip(JSON.parse(JSON.stringify(c))).libraryId, 'vid_1');
});

test('yalnız video klibinde ve güvenli biçimde', () => {
  assert.strictEqual(TL.makeClip({ type: 'image', ref: 'x', libraryId: 'vid_1' }).libraryId, undefined);
  assert.strictEqual(TL.makeClip({ type: 'video', ref: 'x', libraryId: '../etc' }).libraryId, undefined);
  assert.strictEqual(TL.makeClip({ type: 'video', ref: 'x', libraryId: 5 }).libraryId, undefined);
  assert.ok(!('libraryId' in JSON.parse(JSON.stringify(TL.makeClip({ type: 'video', ref: 'x' })))), 'kimliksiz klipte alan yazılmaz');
});

test('telefonun yazdığı klip PC kitaplığındaki dosyaya çevrilir', () => {
  const lm = createLinkMedia({
    library: { fileInfo: (dir, id) => (id === 'vid_1' ? { file: '/lib/vid_1.mp4', size: 10, name: 'a.mp4' } : null) },
    libDir: '/lib',
    mediaUrl: { toMediaUrl: (p) => 'sv-media://local/' + encodeURIComponent(p) },
  });
  const clip = TL.makeClip({ type: 'video', ref: 'https://appassets.androidplatform.net/files/lib-media/a.mp4', libraryId: 'vid_1' });
  const out = lm.rewritePatch({ timeline: { tracks: [{ clips: [clip] }] } });
  assert.strictEqual(out.changed, 1);
  assert.strictEqual(out.patch.timeline.tracks[0].clips[0].ref, 'sv-media://local/' + encodeURIComponent('/lib/vid_1.mp4'));
});
