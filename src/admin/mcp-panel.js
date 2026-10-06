/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MCP card under Control. Master switch stays collapsed until it is on.
   Modes render as soon as the switch is on. Listener status is a separate line. */
(function () {
  const P = function () { return window.SVPanel; };
  function tr(s) {
    return (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s) || s;
  }
  function tx(key) {
    const loc = window.SVI18n && window.SVI18n.locale;
    if (window.SVI18n && window.SVI18n.mcpText) return window.SVI18n.mcpText(key, loc);
    return tr(key);
  }
  let status = { running: false, port: 0, shell: '', script: '', phase: 'off' };
  let loaded = false;
  let polls = 0;

  function refresh() {
    if (!window.api || !window.api.mcpStatus) return;
    window.api.mcpStatus().then(function (s) {
      status = s || status;
      if (P()) P().rerender();
      const on = !!(P() && P().cfg && P().cfg().mcp && P().cfg().mcp.enabled);
      if (on && status && !status.running && !status.portBusy && polls < 15) {
        polls += 1;
        setTimeout(refresh, 400);
      } else {
        polls = 0;
      }
    }).catch(function () {
      status = Object.assign({}, status, { running: false, failed: true });
      if (P()) P().rerender();
    });
  }

  function ensure(cfg) {
    if (!cfg.mcp || typeof cfg.mcp !== 'object') cfg.mcp = { enabled: false, mode: 'read', port: 38471 };
    if (['read', 'apply', 'write', 'full', 'everything'].indexOf(cfg.mcp.mode) < 0) cfg.mcp.mode = 'read';
    const port = Number(cfg.mcp.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 8722) cfg.mcp.port = 38471;
    return cfg.mcp;
  }

  function setEnabled(on) {
    const mcp = ensure(P().cfg());
    mcp.enabled = !!on;
    polls = 0;
    status = Object.assign({}, status, { running: false, portBusy: false, failed: false, phase: on ? 'starting' : 'off' });
    if (P().rerender) P().rerender();
    P().push(true);
    refresh();
  }

  function setMode(mode) {
    const mcp = ensure(P().cfg());
    mcp.mode = mode;
    if (P().rerender) P().rerender();
    P().push(true);
  }

  function confirmPort(raw) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 65535 || n === 8722) {
      P().toast(tx('mcp.port.invalid'), 'warn');
      return;
    }
    const mcp = ensure(P().cfg());
    const apply = function () {
      mcp.port = n;
      polls = 0;
      status = Object.assign({}, status, { running: false, portBusy: false, failed: false, phase: 'starting' });
      if (P().rerender) P().rerender();
      P().push(true);
      refresh();
    };
    const msg = tx('mcp.port.confirm').split('{port}').join(String(n));
    if (P().confirm) P().confirm(msg).then(function (ok) { if (ok) apply(); });
    else apply();
  }

  function toggle(label, checked, onChange) {
    const el = P().el;
    const input = el('input', { type: 'checkbox', checked: !!checked, onchange: function (e) { onChange(e.target.checked); } });
    return el('div', { class: 'ctrl mcp-toggle' }, [
      el('div', { class: 'row' }, [
        el('label', { class: 'lbl', text: label }),
        el('label', { class: 'switch' }, [input, el('span', { class: 'track' })]),
      ]),
    ]);
  }

  function statusText() {
    if (status && status.running) return tx('mcp.card.listening') + ' 127.0.0.1:' + status.port;
    if (status && (status.portBusy || status.failed)) return tx('mcp.card.failed');
    return tx('mcp.card.starting');
  }

  function fallbackCopy(value) {
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        P().toast(tx('mcp.card.copied'), 'ok');
        return;
      }
    } catch (e) { /* try the toast below */ }
    P().toast(tx('mcp.card.copyFail'), 'warn');
  }

  function copy(text) {
    const value = text == null ? '' : String(text);
    if (!value) {
      P().toast(tx('mcp.card.copyFail'), 'warn');
      return;
    }
    if (window.api && typeof window.api.copyToClipboard === 'function' && window.api.copyToClipboard(value)) {
      P().toast(tx('mcp.card.copied'), 'ok');
      return;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(value).then(function () {
        P().toast(tx('mcp.card.copied'), 'ok');
      }, function () { fallbackCopy(value); });
      return;
    }
    fallbackCopy(value);
  }

  function openSetup() {
    const el = P().el;
    const M = window.SVMcp;
    const cfg = P().cfg();
    const model = M ? M.cardModel(cfg) : { port: 38471 };
    const script = (status && status.script) || 'mcp-stdio.js';
    const loc = window.SVI18n && window.SVI18n.locale;
    const sections = M ? M.clients(script, model.port) : [];
    const prompt = M && M.installPrompt ? M.installPrompt(script, loc, model.port) : '';
    const url = 'http://127.0.0.1:' + model.port + '/mcp';
    const body = sections.map(function (sec) {
      return el('section', { class: 'mcp-client' }, [
        el('h4', { text: sec.title }),
        el('ol', { class: 'mcp-steps' }, sec.steps.map(function (step) { return el('li', { text: tr(step) }); })),
        el('pre', { class: 'mcp-snippet', text: sec.snippet }),
        el('button', {
          class: 'btn ghost small', type: 'button', text: tx('mcp.card.copy'),
          onclick: function () { copy(sec.snippet); },
        }),
      ]);
    });
    const close = function () { backdrop.remove(); };
    const backdrop = el('div', { class: 'ask-backdrop mcp-backdrop' }, [
      el('div', { class: 'ask-panel mcp-setup', role: 'dialog', 'aria-modal': 'true' }, [
        el('div', { class: 'mcp-setup-head' }, [
          el('div', { class: 'ask-title', text: tx('mcp.setup.title') }),
          el('button', {
            class: 'btn ghost small mcp-setup-x', type: 'button', icon: 'x',
            title: tx('mcp.card.close'), 'aria-label': tx('mcp.card.close'),
            onclick: close,
          }),
        ]),
        el('div', { class: 'mcp-prompt-block' }, [
          el('div', { class: 'mcp-setup-note', text: tx('mcp.setup.easy') }),
          el('pre', { class: 'mcp-snippet', text: prompt }),
          el('button', {
            class: 'btn', type: 'button', text: tx('mcp.card.copyPrompt'),
            onclick: function () { copy(prompt); },
          }),
          el('div', { class: 'mcp-setup-note', text: tx('mcp.setup.http').split('{url}').join(url) }),
        ]),
        el('div', { class: 'mcp-manual' }, [
          el('h4', { class: 'mcp-manual-title', text: tx('mcp.setup.manual') }),
          el('div', { class: 'mcp-clients' }, body),
        ]),
        el('div', { class: 'ask-actions' }, [
          el('button', { class: 'btn', type: 'button', text: tx('mcp.card.close'), onclick: close }),
        ]),
      ]),
    ]);
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop) close(); });
    document.body.appendChild(backdrop);
  }

  function mcpCard() {
    if (!loaded) { loaded = true; refresh(); }
    const el = P().el;
    const cfg = P().cfg();
    const model = window.SVMcp ? window.SVMcp.cardModel(cfg) : { enabled: false, mode: 'read', port: 38471, setupVisible: false, modes: [] };
    const on = model.enabled === true;
    const nodes = [
      el('div', { class: 'studio-note dim-hint', text: tx('mcp.card.note') }),
      toggle(tx('mcp.card.master'), on, setEnabled),
    ];
    if (!on) return el('div', { class: 'mcp-card' }, nodes);
    nodes.push(el('div', { class: 'mcp-status', text: statusText() }));
    if (status && status.portBusy) {
      const busy = status.requestedPort || status.configuredPort || model.port;
      nodes.push(el('div', { class: 'studio-note', text: tx('mcp.port.busy').split('{port}').join(String(busy)) }));
    }
    const portInput = el('input', { type: 'number', min: '1', max: '65535', value: String(model.port || 38471) });
    nodes.push(el('div', { class: 'mcp-port' }, [
      el('label', { class: 'lbl', text: tx('mcp.port.label') }),
      portInput,
      el('button', {
        class: 'btn ghost small', type: 'button', text: tx('mcp.port.apply'),
        onclick: function () { confirmPort(portInput.value); },
      }),
    ]));
    nodes.push(el('div', { class: 'mcp-modes' }, (model.modes || []).map(function (id) {
      return el('button', {
        type: 'button',
        class: 'mcp-mode' + (model.mode === id ? ' on' : ''),
        onclick: function () { setMode(id); },
      }, [
        el('span', { class: 'mcp-mode-name', text: tx('mcp.mode.' + id + '.label') }),
        el('span', { class: 'mcp-mode-hint', text: tx('mcp.mode.' + id + '.hint') }),
      ]);
    })));
    if (model.setupVisible) {
      nodes.push(el('button', { class: 'btn', type: 'button', text: tx('mcp.card.setup'), onclick: openSetup }));
    }
    return el('div', { class: 'mcp-card' }, nodes);
  }

  window.SVMcpPanel = { panel: mcpCard, refresh: refresh };
})();
