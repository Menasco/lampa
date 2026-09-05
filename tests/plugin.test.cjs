const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Evaluate the real helpers/component; omit registration and UI templates only.
const source = fs.readFileSync(require('node:path').join(__dirname, '../kas_plugin.js'), 'utf8');
const code = source.slice(0, source.indexOf('  function startPlugin')) +
  '\n globalThis.kas = {component, ouBackend, ouDefaultSources, ouPreferredSources, ouAnimeVideos, account, base: OU_BASE}; })();';

function harness(saved = {}, platform = 'browser') {
  const storage = {...saved};
  const calls = [], notices = [], activities = [], played = [], fields = new Map();
  function element(key = 'root') {
    if (fields.has(key)) return fields.get(key);
    const state = {value: '', events: {}, length: 0};
    const node = new Proxy(state, {get(target, name) {
      if (name in target) return target[name];
      if (name === 'find') return selector => element(selector);
      if (name === 'text') return value => { state.value = value; return node; };
      if (name === 'on') return (event, fn) => { state.events[event] = fn; return node; };
      return () => node;
    }});
    fields.set(key, node);
    return node;
  }
  function Widget() { return element(); }
  function Network() {
    this.timeout = () => {};
    this.clear = () => {};
    this.silent = this.native = (url, ok, fail, data, options) => calls.push({url, ok, fail, data, options});
  }
  const Lampa = {
    Storage: {get: (k, d) => k in storage ? storage[k] : d, set: (k, v) => storage[k] = v,
      cache: (k, n, d) => storage[k] || d, field: () => 'inner'},
    Utils: {uid: () => 'testuid', addUrlComponent: (u, p) => u + (u.includes('?') ? '&' : '?') + p},
    Platform: {is: name => name === platform}, Reguest: Network, Scroll: Widget, Explorer: Widget, Filter: Widget,
    Lang: {translate: s => s}, Arrays: {getKeys: Object.keys},
    Noty: {show: s => notices.push(s)}, Activity: {push: o => activities.push(o)},
    Template: {get: () => element()}, Controller: {enable() {}},
    Player: {play: item => played.push(item), playlist: items => played.push(items)},
  };
  const context = {window: {}, location: {host: 'lampa.mx'}, Lampa, console, setTimeout, clearTimeout,
    setInterval: () => { throw Error('Unexpected automatic switching timer'); }, clearInterval, $: element};
  vm.runInNewContext(code, context);
  const component = new context.kas.component({movie: {id: 603, title: 'Матрица', original_title: 'The Matrix',
    release_date: '1999-03-30', imdb_id: 'tt0133093', kinopoisk_id: 301}});
  component.activity = {loader() {}, toggle() {}};
  return {api: context.kas, component, storage, calls, notices, activities, played, fields, context, Lampa};
}
const plain = x => JSON.parse(JSON.stringify(x));

test('former default migrates once; explicit restoration and custom servers survive', () => {
  const a = harness({ou_backend: 'https://akter-black.com/'});
  assert.equal(a.api.base, 'http://wtch.ch/');
  assert.equal(a.storage.ou_backend_previous, 'https://akter-black.com/');
  assert.equal(harness({...a.storage, ou_backend: 'https://akter-black.com/'}).api.base, 'https://akter-black.com/');
  assert.equal(harness({ou_backend: 'https://own.example/base'}).api.base, 'https://own.example/base/');
  assert.equal(harness({ou_backend: 'javascript:bad'}).api.base, 'http://wtch.ch/');
});

test('default sources are available without backend discovery and start with Filmix', async () => {
  const h = harness();
  const rows = await h.component.createSource();
  assert.deepEqual(plain(rows.map(x => x.balanser)), ['fxapi', 'zetflix', 'zetflixdb', 'rutubemovie', 'vkmovie', 'kas_aniliberty', 'kas_torrents']);
  assert.equal(h.calls.length, 0);
  assert.equal(h.storage.kas_active_balanser, 'fxapi');
});

test('unsupported saved source and another plugin selection do not select HDVB', async () => {
  const h = harness({kas_balanser: 'hdvb', online_balanser: 'hdvb'});
  await h.component.createSource();
  assert.equal(h.storage.kas_active_balanser, 'fxapi');
  assert.equal(h.storage.online_balanser, 'hdvb');
});

test('custom backend authorization failure leaves independent sources', async () => {
  const h = harness({ou_backend: 'https://custom.example'});
  const pending = h.component.createSource();
  h.calls[0].ok({accsdb: true, msg: 'Login required'});
  const rows = await pending;
  assert.deepEqual(plain(rows.map(x => x.balanser)), ['kas_aniliberty', 'kas_torrents']);
  assert.match(h.notices[0], /авторизац/);
});

test('custom backend timeout also leaves independent sources', async () => {
  const h = harness({ou_backend: 'https://custom.example'});
  const pending = h.component.createSource();
  h.calls[0].fail();
  assert.equal((await pending).length, 2);
});

test('only desired providers and HTTP URLs pass custom discovery', () => {
  const h = harness();
  const rows = h.api.ouPreferredSources([{balanser: 'hdvb', url: 'https://x/'},
    {balanser: 'filmix', url: 'javascript:bad'}, {balanser: 'zetflix', url: 'https://x/zet'},
    {balanser: 'fxapi', url: 'https://x/filmix'}]);
  assert.deepEqual(plain(rows.map(x => x.balanser)), ['fxapi', 'zetflix', 'kas_aniliberty', 'kas_torrents']);
});

test('AniLiberty bypasses external-ID and account services', async () => {
  const h = harness({kas_balanser: 'kas_aniliberty', account_email: 'private@example.com'});
  await h.component.createSource();
  h.component.find();
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].url, /^https:\/\/aniliberty.top\/api\/v1\/app\/search\/releases\?query=/);
  assert.ok(!h.calls[0].url.includes('account_email'));
  let folders;
  h.component.similars = x => folders = x;
  h.calls[0].ok([{id: 42, name: {main: '<img src=x>'}, year: 2020}]);
  assert.equal(folders[0].url, 'kas:anime/42');
  assert.equal(folders[0].text, '&lt;img src=x&gt;');
});

test('AniLiberty episodes sort numerically, preserve URLs and filter unplayable episodes', () => {
  const h = harness();
  const video = h.api.ouAnimeVideos({id: 42, episodes: [
    {ordinal: 10, hls_720: 'https://cdn/10.m3u8?isAuthorized=0&isWithVideoAds=1'},
    {ordinal: 2, hls_480: 'https://cdn/2.m3u8', hls_1080: 'javascript:bad'},
    {ordinal: 1, hls_480: null},
  ]});
  assert.deepEqual(plain(video.map(x => x.episode)), [2, 10]);
  assert.equal(video[1].url, 'https://cdn/10.m3u8?isAuthorized=0&isWithVideoAds=1');
  assert.equal(video[0].kas_release, 42);
});

test('release response reaches existing player UI with a quality map', () => {
  const h = harness();
  let videos;
  h.component.display = rows => videos = rows;
  h.component.request('kas:anime/42');
  h.calls[0].ok({id: 42, episodes: [{ordinal: 1, hls_720: 'https://cdn/1.m3u8'}]});
  assert.equal(videos[0].quality['720p'], 'https://cdn/1.m3u8');
});

test('stale anime responses cannot repaint after reset or destroy', () => {
  for (const action of ['reset', 'destroy']) {
    const h = harness();
    h.component.similars = () => assert.fail('Stale render');
    h.component.request('kas:anime');
    h.component[action]();
    h.calls[0].ok([{id: 42, name: {main: 'Old'}}]);
  }
});

test('malformed anime response produces a recoverable error', () => {
  const h = harness();
  let error;
  h.component.doesNotAnswer = e => error = e;
  h.component.request('kas:anime/42');
  h.calls[0].ok({error: 'bad'});
  assert.match(error.msg, /неожиданный/);
});

test('torrent shortcut uses native search and does not change preferred source', async () => {
  const h = harness({kas_balanser: 'fxapi'});
  await h.component.createSource();
  h.component.changeBalanser('kas_torrents');
  assert.equal(h.activities[0].component, 'torrents');
  assert.equal(h.activities[0].search, 'Матрица');
  assert.equal(h.storage.kas_balanser, 'fxapi');
  assert.equal(h.calls.length, 0);
});

test('backend errors and authorization messages render without auto-switch timers', () => {
  const h = harness();
  h.component.noConnectToServer({accsdb: true, msg: '<b>Authorization required</b>'});
  assert.equal(h.fields.get('.online-empty__title').value, 'Authorization required');
  assert.ok(h.fields.get('.cancel').events['hover:enter']);
});

test('direct resources do not receive backend credentials and no-quality streams are valid', () => {
  const h = harness({account_email: 'private@example.com'});
  assert.equal(h.api.account('https://cdn.example/video'), 'https://cdn.example/video');
  assert.doesNotThrow(() => h.component.setDefaultQuality({url: 'https://cdn/video'}));
});


test('AniLiberty hands the selected episode and complete playlist to Lampa.Player', async () => {
  const h = harness({kas_balanser: 'kas_aniliberty'});
  await h.component.createSource();
  let enter;
  h.component.draw = (items, events) => {
    items.forEach(item => { item.qualitys = item.quality; item.title = item.text; item.mark = () => {}; });
    enter = events.onEnter;
  };
  h.component.filter = () => {};
  h.component.getChoice = () => ({});
  const videos = h.api.ouAnimeVideos({id: 42, episodes: [
    {ordinal: 1, hls_720: 'https://cdn/1.m3u8'},
    {ordinal: 2, hls_480: 'https://cdn/2-480.m3u8', hls_1080: 'https://cdn/2.m3u8'}
  ]});
  h.component.display(videos);
  enter(videos[1]);
  assert.equal(h.played[0].url, 'https://cdn/2.m3u8');
  assert.equal(h.played[0].quality['480p'], 'https://cdn/2-480.m3u8');
  assert.equal(h.played[1].length, 2);
  assert.equal(h.played[1][0].url, 'https://cdn/1.m3u8');
  assert.equal(h.calls.length, 0);
});

test('retry keeps the selected anime release instead of returning to search', () => {
  const h = harness();
  h.component.request('kas:anime/42');
  h.calls[0].fail();
  h.fields.get('.cancel').events['hover:enter']();
  assert.equal(h.calls[1].url, 'https://aniliberty.top/api/v1/anime/releases/42');
});

test('full plugin registers alongside Lampac and duplicate loading is harmless', () => {
  const h = harness();
  let registered = 0, settings = 0;
  h.context.window.lampac_plugin = true;
  h.context.window.Lampa = h.Lampa;
  h.Lampa.Manifest = {app_digital: 177};
  h.Lampa.Lang.add = () => {};
  h.Lampa.Template.add = () => {};
  h.Lampa.Component = {add: () => registered++};
  h.Lampa.Listener = {follow() {}};
  h.Lampa.Storage.sync = () => {};
  h.Lampa.SettingsApi = {addComponent() {}, addParam: () => settings++};
  vm.runInNewContext(source, h.context);
  assert.equal(registered, 1);
  assert.equal(settings, 1);
  assert.equal(h.Lampa.Manifest.plugins.version, '2.0.0');
  vm.runInNewContext(source, h.context);
  assert.equal(registered, 1);
  assert.equal(settings, 1);
});

test('Samsung Tizen requests identify the CORS transport', () => {
  const h = harness({}, 'tizen');
  assert.match(h.component.requestParams('http://wtch.ch/lite/fxapi'), /[?&]rchtype=cors(?:&|$)/);
});
