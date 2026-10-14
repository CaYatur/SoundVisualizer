'use strict';
/* MCP readers leave cover art out unless asked. A data URI of several
   hundred KB in sv_get_now_playing flooded a small local model's context and
   it answered about something unrelated. */

const test = require('node:test');
const assert = require('node:assert');
const mcp = require('../src/shared/mcp');

const ART = 'data:image/png;base64,' + Buffer.alloc(300000, 7).toString('base64');

function ctx(track) {
  const cfg = { mcp: { enabled: true, mode: 'read' }, scenes: [], autovj: {}, stream: {} };
  return {
    locale: function () { return 'en'; },
    getConfig: function () { return cfg; },
    setConfig: function () {},
    nowPlaying: function () { return track; },
  };
}

const TRACK = { title: 'Save Your Tears', artist: 'The Weeknd', artwork: ART };

test('sv_get_now_playing omits artwork by default and says whether there is one', async function () {
  const out = await mcp.callTool('sv_get_now_playing', {}, ctx(TRACK));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.nowPlaying.title, 'Save Your Tears');
  assert.strictEqual(out.nowPlaying.artist, 'The Weeknd');
  assert.strictEqual(out.nowPlaying.hasArtwork, true);
  assert.ok(!('artwork' in out.nowPlaying));
  assert.ok(JSON.stringify(out).length < 300);
});

test('includeArtwork: true returns the cover; anything but true does not', async function () {
  const full = await mcp.callTool('sv_get_now_playing', { includeArtwork: true }, ctx(TRACK));
  assert.strictEqual(full.nowPlaying.artwork, ART);
  assert.strictEqual(full.nowPlaying.hasArtwork, true);
  const str = await mcp.callTool('sv_get_now_playing', { includeArtwork: 'yes' }, ctx(TRACK));
  assert.ok(!('artwork' in str.nowPlaying));
});

test('a track without a cover reports hasArtwork false, and no track stays null', async function () {
  const bare = await mcp.callTool('sv_get_now_playing', {}, ctx({ title: 'A', artist: 'B' }));
  assert.strictEqual(bare.nowPlaying.hasArtwork, false);
  const none = await mcp.callTool('sv_get_now_playing', {}, ctx(null));
  assert.strictEqual(none.nowPlaying, null);
});

test('the source track is not mutated', async function () {
  const track = Object.assign({}, TRACK);
  await mcp.callTool('sv_get_now_playing', {}, ctx(track));
  assert.strictEqual(track.artwork, ART);
});

test('sv_get_state never carries the cover', async function () {
  const state = await mcp.callTool('sv_get_state', {}, ctx(TRACK));
  assert.strictEqual(state.ok, true);
  assert.strictEqual(state.nowPlaying.title, 'Save Your Tears');
  assert.strictEqual(state.nowPlaying.hasArtwork, true);
  assert.ok(!JSON.stringify(state).includes('base64,'));
});

test('the schema advertises includeArtwork as an optional boolean, with tr and en descriptions', function () {
  const tool = mcp.tools('en').find(function (t) { return t.name === 'sv_get_now_playing'; });
  const schema = tool.inputSchema;
  assert.strictEqual(schema.properties.includeArtwork.type, 'boolean');
  assert.ok(!(schema.required || []).includes('includeArtwork'));
  assert.match(tool.description, /includeArtwork/);
  const tr = mcp.tools('tr').find(function (t) { return t.name === 'sv_get_now_playing'; });
  assert.match(tr.description, /Kapak/);
});
