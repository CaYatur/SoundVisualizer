/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * SPDX-License-Identifier: MIT
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('../src/shared/defaults');
require('../src/shared/schema');
require('../src/visualizer/layers');
const SV = window.SV;
const T = require('../src/shared/timeline');
const C = require('../src/shared/timeline-compose');
const M = require('../src/main/export-media');
test('yeni boş klip: yerel çocuk, tür/kaynak değişimi ve silinmiş kaynak ayrımı', () => {
  const cfg=SV.defaultConfig(), before=JSON.stringify(cfg);
  for(const type of ['scene','preset','palette','visualizer','video','image','shader']) {
    const clip=T.makeClip({type,ref:''});
    const local=C.ensureLocal(cfg,clip);
    assert.ok(local,type); assert.deepEqual(local.data.layers,[]);
    local.data.layers.push({id:'child',kind:'visualizer',type:'bars'});
    assert.equal(C.composeAt(cfg,T.makeTimeline({tracks:[{kind:'clip',clips:[clip]}]}),0).cfg.layers.length,type==='palette'?0:1);
    clip.type='scene';clip.ref='deleted-scene';assert.equal(C.ensureLocal(cfg,clip),null);assert.equal(clip.local,undefined);
  }
  assert.equal(JSON.stringify(cfg),before);
});
test('dışa aktarım açıkça seçilir; canlı mod/hedef ve pasif çizelge tercihleri bozmaz', () => {
  for(const pref of [undefined,false,true]) for(const live of [false,true]) for(const passive of [false,true]) {
    const cfg=SV.defaultConfig();cfg.export.includeTimeline=pref;cfg.timeline.useTimeline=live;cfg.timeline.itemEnabled=!passive;
    cfg.layers=[{id:'draft',kind:'visualizer',type:'wave'}];
    cfg.timeline.manualBaseline={layers:[{id:'manual',kind:'visualizer',type:'bars'}],layerStack:{enabled:true},postfx:[]};
    cfg.timeline.editTarget={trackId:'t',clipId:'a'};
    cfg.timeline.tracks=[{id:'t',kind:'clip',clips:[{id:'a',type:'video',ref:'/tmp/clip.mp4',start:1,dur:2,inPoint:4,speed:2}]}];
    const before=JSON.stringify(cfg), job=C.exportConfig(cfg);
    assert.equal(C.exportEnabled(job),pref===true&&!passive);
    assert.equal(job.timeline.useTimeline,live);assert.equal(job.layers[0].id,'manual');
    assert.equal(job.timeline.manualBaseline,undefined);assert.equal(job.timeline.editTarget,undefined);
    if(C.exportEnabled(job)) {
      const tl=T.makeTimeline(job.timeline), frame=C.composeAt(job,tl,1.5);
      assert.equal(frame.cfg.timelineComposition.units[0].localTime,5);
      assert.equal(C.composeAt(job,tl,3).black,true);
      assert.deepEqual(M.jobMediaFiles(job),['/tmp/clip.mp4']);
    } else assert.deepEqual(M.jobMediaFiles(job),[]);
    assert.equal(JSON.stringify(cfg),before);
  }
  assert.equal(SV.defaultConfig().export.includeTimeline,false);
});
