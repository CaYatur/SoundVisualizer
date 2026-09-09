'use strict';
/* WARP TİTREŞİMİ.
 *
 * Ağın son adımı: düğümün örnek noktasına sinüs/kosinüs toplamıyla küçük
 * bir kayma ekleniyor. MilkDrop'ta bu desenin dört frekansı SABİT DEĞİL —
 * dördü de kendi hızında salınan birer kosinüsle sürülüyor, yani desen
 * zamanla kendini yeniden dokuyor. Motorda dört sabit sayı (5, 3, 4, 2)
 * duruyordu; çıkan şey duran tek bir dalgaydı.
 *
 * Ayrıca preset dosyasındaki iki ayar hiç okunmuyordu: `fWarpScale` desenin
 * boyutunu, `fWarpAnimSpeed` de zamanını veriyor. Korpusta 8.265 preset
 * (%79,9) varsayılandan farklı bir ölçek, 4.556'sı (%44,0) farklı bir hız
 * yazıyor.
 *
 * Sabitler yuvarlanırsa desen gözle görülür şekilde kayar, bu yüzden tek
 * tek sabitleniyorlar. Katsayıların ARİTMETİĞİ de gerçekten çalıştırılıyor:
 * satırı kaynaktan çıkarıp değerlendirmek, "yazılmış mı" ile "doğru hesap
 * ediyor mu" arasındaki farkı kapatıyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
const BODY = CODE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const MESH = /_buildWarpMesh\(\) \{[\s\S]*?\n    \}/.exec(BODY);

test('warp: iki preset ayarı okunuyor', () => {
  assert.ok(MESH, '_buildWarpMesh bulunamadı');
  assert.match(MESH[0], /this\.preset\.get\('warpanimspeed'\)/);
  assert.match(MESH[0], /this\.preset\.get\('warpscale'\)/);
  // Hız zamanı çarpıyor, ölçek tersiyle giriyor
  assert.match(MESH[0], /const warpTime = this\.time \* wSpeed;/);
  assert.match(MESH[0], /const wsi = 1 \/ wScale;/);
});

/* `fWarpScale = 0` yazan bir preset var olabilir; sonsuz bir frekans bütün
   ağı katlar ve kare tamamen bozulur. Aynı koruma blur ölçeğinde de var. */
test('warp: sıfır ölçek sonsuz frekansa çevrilmiyor', () => {
  assert.match(MESH[0], /Math\.abs\(wScaleRaw\) < 1e-4 \? 1e-4 : wScaleRaw/);
});

/* Katsayı satırlarını kaynaktan çıkarıp GERÇEKTEN hesaplıyoruz. Yalnızca
   metne bakan bir test, sayı doğru yazılıp yanlış yerde kullanıldığında
   sessiz kalırdı. */
function coeffs(t) {
  const lines = MESH[0].match(/const wf\d = [^;]+;/g);
  assert.ok(lines && lines.length === 4, 'dört katsayı satırı bulunamadı');
  const fn = new Function('warpTime', 'Math',
    lines.join('\n') + '\nreturn [wf0, wf1, wf2, wf3];');
  return fn(t, Math);
}
const close = (a, b, eps) => Math.abs(a - b) < (eps || 1e-9);

test('warp: katsayılar MilkDrop değerlerinde ve zamanla değişiyor', () => {
  const at0 = coeffs(0);
  assert.ok(close(at0[0], 11.68 + 4.0 * Math.cos(10)), 'wf0');
  assert.ok(close(at0[1], 8.77 + 3.0 * Math.cos(7)), 'wf1');
  assert.ok(close(at0[2], 10.54 + 3.0 * Math.cos(3)), 'wf2');
  assert.ok(close(at0[3], 11.49 + 4.0 * Math.cos(5)), 'wf3');

  /* Asıl korunan şey bu: katsayılar SABİT DEĞİL. Dördü de zamanla
     oynamazsa desen donar ve eski davranışa geri dönülmüş olur. */
  const at3 = coeffs(3);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(at3[i] - at0[i]) > 1e-3, 'wf' + i + ' zamanla değişmiyor');
  }
});

test('warp: katsayılar kendi genlik aralığında kalıyor', () => {
  /* 11,68 ± 4 ve 8,77 ± 3 gibi: ortalamalar birbirine yakın ama genlikler
     farklı. Hepsini aynı genlikle yazmak deseni tekdüze yapardı. */
  for (const t of [0, 0.7, 2.5, 11, 40]) {
    const c = coeffs(t);
    assert.ok(c[0] >= 11.68 - 4 - 1e-9 && c[0] <= 11.68 + 4 + 1e-9);
    assert.ok(c[1] >= 8.77 - 3 - 1e-9 && c[1] <= 8.77 + 3 + 1e-9);
    assert.ok(c[2] >= 10.54 - 3 - 1e-9 && c[2] <= 10.54 + 3 + 1e-9);
    assert.ok(c[3] >= 11.49 - 4 - 1e-9 && c[3] <= 11.49 + 4 + 1e-9);
  }
});

test('warp: dört terim ağın kendi koordinatını kullanıyor', () => {
  /* Terimler MilkDrop uzayındaki düğüm koordinatını (cx0, cy0) alıyor.
     Ağ artık o uzayda çalıştığı için işaret çevirmeye gerek yok — çevirme
     eklenirse desen aynadan çıkar. */
  assert.match(MESH[0], /su \+= wr \* Math\.sin\(warpTime \* 0\.333 \+ wsi \* \(cx0 \* wf0 - cy0 \* wf3\)\);/);
  assert.match(MESH[0], /sv \+= wr \* Math\.cos\(warpTime \* 0\.375 - wsi \* \(cx0 \* wf2 \+ cy0 \* wf1\)\);/);
  assert.match(MESH[0], /su \+= wr \* Math\.cos\(warpTime \* 0\.753 - wsi \* \(cx0 \* wf1 - cy0 \* wf2\)\);/);
  assert.match(MESH[0], /sv \+= wr \* Math\.sin\(warpTime \* 0\.825 \+ wsi \* \(cx0 \* wf0 \+ cy0 \* wf3\)\);/);
});

test('warp: genlik çarpanı 0.0035 değişmedi', () => {
  /* MilkDrop\'un kendi ölçeği. Presetin `warp` değeri bunun üstüne biniyor;
     çarpan değişirse korpusun tamamında titreşimin şiddeti kayar. */
  assert.match(MESH[0], /const wr = p\.warp \* 0\.0035;/);
});

test('warp: anahtar kapalıyken eski desen ve eski hız duruyor', () => {
  /* Eski davranış bir uyum değil ama kullanıcıların izlediği görüntü.
     Kapalıyken hız ve ölçek 1, terimler de eski sabitleriyle. */
  assert.match(MESH[0], /const wSpeed = acc \? \(this\.preset\.get\('warpanimspeed'\) \|\| 1\) : 1;/);
  assert.match(MESH[0], /const wScaleRaw = acc \? \(this\.preset\.get\('warpscale'\) \|\| 1\) : 1;/);
  /* Eski desen artık ayrı bir kod yolunda duruyor (dönüşümün sırası da
     farklı olduğu için tek bir `if` ile ayrılamıyordu). */
  assert.match(MESH[0], /su \+= wr \* Math\.sin\(warpTime \* 0\.333 \+ cx0 \* 5 \+ cy0 \* 3\);/);
});
