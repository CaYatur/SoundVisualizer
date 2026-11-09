/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Bitfocus Companion modülü. SoundVisualizer'ın OSC girişine (Kontrol →
   OSC) UDP ile yazar; istenirse uygulamanın OSC çıkışını dinleyip
   değişken ve geri bildirimleri günceller. */
const dgram = require('dgram');
const { InstanceBase, InstanceStatus, runEntrypoint, combineRgb } = require('@companion-module/base');
const osc = require('./osc');
const A = require('./actions');

class SoundVisualizerInstance extends InstanceBase {
  async init(config) {
    this.config = config;
    this.state = { blackout: false, autovj: false, track: '', bpm: 0, opacity: 1, layers: {} };
    this.tx = null;
    this.rx = null;
    this.setActionDefinitions(this.actionDefs());
    this.setFeedbackDefinitions(this.feedbackDefs());
    this.setVariableDefinitions([
      { variableId: 'blackout', name: 'Blackout (on/off)' },
      { variableId: 'autovj', name: 'Auto VJ (on/off)' },
      { variableId: 'track', name: 'Now playing' },
      { variableId: 'bpm', name: 'Tempo (BPM)' },
      { variableId: 'opacity', name: 'Master opacity' },
    ]);
    this.setPresetDefinitions(this.presetDefs());
    this.open();
  }

  async destroy() { this.close(); }

  async configUpdated(config) {
    this.config = config;
    this.close();
    this.open();
  }

  getConfigFields() {
    return [
      { type: 'textinput', id: 'host', label: 'SoundVisualizer IP', width: 6, default: '127.0.0.1' },
      { type: 'number', id: 'port', label: 'OSC input port (Control → OSC)', width: 3, default: 9000, min: 1, max: 65535 },
      { type: 'textinput', id: 'prefix', label: 'OSC prefix', width: 3, default: A.DEFAULT_PREFIX },
      { type: 'number', id: 'feedbackPort', label: 'Listen for OSC output on port (0 = off)', width: 6, default: 0, min: 0, max: 65535 },
    ];
  }

  open() {
    const c = this.config || {};
    try {
      this.tx = dgram.createSocket('udp4');
      this.tx.on('error', (e) => this.updateStatus(InstanceStatus.UnknownError, e.message));
    } catch (e) {
      this.updateStatus(InstanceStatus.UnknownError, e.message);
      return;
    }
    const fport = Number(c.feedbackPort) || 0;
    if (fport > 0 && fport < 65536) {
      this.rx = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.rx.on('error', (e) => this.updateStatus(InstanceStatus.UnknownError, 'Feedback port: ' + e.message));
      this.rx.on('message', (buf) => this.onFeedback(buf));
      this.rx.bind(fport);
    }
    this.updateStatus(c.host ? InstanceStatus.Ok : InstanceStatus.BadConfig);
    this.pushVariables();
  }

  close() {
    for (const s of [this.tx, this.rx]) { try { if (s) s.close(); } catch (e) { /* kapalı */ } }
    this.tx = null;
    this.rx = null;
  }

  send(actionId, options) {
    const c = this.config || {};
    if (!this.tx || !c.host) return;
    for (const m of A.messages(actionId, options, c.prefix, this.state)) {
      this.tx.send(osc.encode(m.address, m.args), Number(c.port) || 9000, String(c.host));
    }
  }

  onFeedback(buf) {
    const changed = [];
    for (const m of osc.decode(buf)) changed.push(...A.applyFeedback(this.state, m, (this.config || {}).prefix));
    if (!changed.length) return;
    this.pushVariables();
    this.checkFeedbacks('blackout', 'autovj');
  }

  pushVariables() {
    const s = this.state;
    this.setVariableValues({ blackout: s.blackout ? 'on' : 'off', autovj: s.autovj ? 'on' : 'off', track: s.track, bpm: s.bpm, opacity: s.opacity });
  }

  actionDefs() {
    const out = {};
    for (const [id, a] of Object.entries(A.ACTIONS)) {
      out[id] = { name: a.name, options: a.options, callback: (ev) => this.send(id, ev.options) };
    }
    return out;
  }

  feedbackDefs() {
    const red = { bgcolor: combineRgb(200, 0, 0), color: combineRgb(255, 255, 255) };
    return {
      blackout: { type: 'boolean', name: 'Blackout is on', defaultStyle: red, options: [], callback: () => !!this.state.blackout },
      autovj: { type: 'boolean', name: 'Auto VJ is on', defaultStyle: { bgcolor: combineRgb(0, 120, 200), color: combineRgb(255, 255, 255) }, options: [], callback: () => !!this.state.autovj },
    };
  }

  presetDefs() {
    const btn = (name, text, actionId, options, feedbackId) => ({
      type: 'button', category: 'Show', name,
      style: { text, size: '14', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
      steps: [{ down: [{ actionId, options }], up: [] }],
      feedbacks: feedbackId ? [{ feedbackId, options: {}, style: { bgcolor: combineRgb(200, 0, 0) } }] : [],
    });
    return {
      blackout: btn('Blackout toggle', 'BLACK\\nOUT', 'blackout', { state: 'toggle' }, 'blackout'),
      autovj: btn('Auto VJ toggle', 'AUTO\\nVJ', 'autovj', { state: 'toggle' }, 'autovj'),
      deckStop: btn('Stop clips', 'STOP\\nCLIPS', 'deck_stop', {}),
      tlPlay: btn('Timeline play', 'TL\\nPLAY', 'timeline_play', { state: 'play' }),
      tlStop: btn('Timeline stop', 'TL\\nSTOP', 'timeline_stop', {}),
    };
  }
}

runEntrypoint(SoundVisualizerInstance, []);
