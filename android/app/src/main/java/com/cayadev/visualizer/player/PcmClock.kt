/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.player

import java.util.concurrent.ConcurrentLinkedQueue

/* ÇALARIN SESİ, DUYULDUĞU ANDA (docs/android/PLAN.md 2.3).

   Çözülen ses, oynatıcının ses çıkışına HOPARLÖRDEN ÖNCE gidiyor: çıkışın
   tamponu kadar (yüzlerce milisaniye) önde. Sesi geldiği anda sayfaya vermek
   görüntüyü sesin önüne geçirirdi. Bu yüzden ses burada bekletilir ve oynatma
   konumu (oynatıcının `currentPosition`'ı, gerçek çalma başına göre) o
   örneğe gelince bırakılır.

   İki iş parçacığı:
     - oynatma iş parçacığı: format() (her boşaltmada: başlangıç, atlama) ve push();
     - ana iş parçacığı: release(konum) — konum oynatıcıdan yalnız orada okunuyor.
   Her boşaltma yeni bir "parça" açar (gen). Ana iş parçacığı yeni parçayı ilk
   gördüğünde o anki konumu parçanın başı sayar; atlamadan sonra oynatıcı
   duraklayıp hedef konumdan başladığı için fark en çok bir tık (10 ms).

   Android çerçevesine bağlı değil, JVM birim testinde denetleniyor. */
class PcmClock(
    /** Bir blokta en çok bu kadar örnek (kanal başına); masaüstündeki yardımcıyla aynı blok. */
    private val block: Int = 512,
    /** Bekleyen sesin üst sınırı (saniye): konum ilerlemezse bellek dolmasın. */
    private val maxSeconds: Int = 4,
) {
    class Chunk(val gen: Int, val startFrame: Long, val sampleRate: Int, val channels: Int, val samples: ShortArray) {
        val frames: Int get() = samples.size / channels
    }

    @Volatile
    var gen = 0
        private set

    private val queue = ConcurrentLinkedQueue<Chunk>()

    // Oynatma iş parçacığı
    private var framesIn = 0L
    private var rate = 0
    private var ch = 0

    /** Yeni parça (oynatıcı boşalttı: başlangıç, atlama, yeni şarkı). */
    fun format(sampleRate: Int, channels: Int) {
        gen++
        framesIn = 0
        rate = sampleRate
        ch = channels
        queue.clear()
    }

    /** Aralıklı (interleaved) 16 bit örnekler; [block] örneklik bloklara bölünür. */
    fun push(samples: ShortArray, count: Int = samples.size) {
        if (rate <= 0 || ch <= 0) return
        val total = count - count % ch
        var at = 0
        while (at < total) {
            val n = minOf(block * ch, total - at)
            queue.add(Chunk(gen, framesIn, rate, ch, samples.copyOfRange(at, at + n)))
            framesIn += n / ch
            at += n
        }
        // Konum hiç ilerlemiyorsa (ör. çıkış takıldı) en eskiler atılır
        val limit = maxSeconds.toLong() * rate
        while (true) {
            val head = queue.peek() ?: break
            if (framesIn - head.startFrame <= limit) break
            queue.poll()
            dropped++
        }
    }

    // Ana iş parçacığı
    private var seenGen = -1
    private var segStartMs = 0L

    @Volatile
    var dropped = 0L
        private set

    /** En son bırakılan bloğun konuma göre gecikmesi (ms; artı: geç, eksi: erken). */
    var lastLagMs = 0.0
        private set

    /**
     * Oynatma konumu [positionMs]'ye kadar duyulmuş olan blokları [out]'a verir.
     * Dönen: bırakılan blok sayısı.
     */
    fun release(positionMs: Long, out: (Chunk) -> Unit): Int {
        val g = gen
        if (g != seenGen) {
            seenGen = g
            segStartMs = positionMs
        }
        var n = 0
        while (true) {
            val c = queue.peek() ?: break
            if (c.gen != g) {
                queue.poll()
                continue
            }
            val played = (positionMs - segStartMs) * c.sampleRate / 1000
            if (c.startFrame > played) break
            queue.poll()
            lastLagMs = (played - c.startFrame) * 1000.0 / c.sampleRate
            out(c)
            n++
        }
        return n
    }

    /** Bekleyen blok sayısı (ölçüm). */
    fun pending(): Int = queue.size
}
