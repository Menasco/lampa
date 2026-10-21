const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const jquery = require('jquery');

// Evaluate the real helpers/component; omit registration and UI templates only.
const source = fs.readFileSync(require('node:path').join(__dirname, '../kas_plugin.js'), 'utf8');
const code = source.slice(0, source.indexOf('  function startPlugin')) +
  '\n globalThis.kas = {component, ouBackend, ouDefaultSources, ouPreferredSources, ouAnimeVideos, ouUrl, ouStream, ouTorrentSearch, account, base: OU_BASE}; })();';

function harness(saved = {}, platform = 'browser') {
  const storage = {...saved};
  const calls = [], notices = [], activities = [], played = [], selections = [], settingsOpened = [], fields = new Map();
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
      cache: (k, n, d) => storage[k] || d, field: k => k in storage ? storage[k] : ({player: 'inner', parse_lang: 'df', parser_torrent_type: 'jackett', parser_use_link: 'one', torrserver_use_link: 'one'}[k] || '')},
    Utils: {uid: () => 'testuid', addUrlComponent: (u, p) => u + (u.includes('?') ? '&' : '?') + p},
    Platform: {is: name => name === platform}, Reguest: Network, Scroll: Widget, Explorer: Widget, Filter: Widget,
    Lang: {translate: s => s}, Arrays: {getKeys: Object.keys,
      decodeJson: (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } },
      isObject: v => !!v && typeof v === 'object' && !Array.isArray(v),
      extend: (to, from, replace) => Object.keys(from).forEach(k => { if (replace || !(k in to)) to[k] = from[k]; })},
    Loading: {start() {}, stop() {}}, Select: {show: o => selections.push(o), close() {}},
    Settings: {create: name => settingsOpened.push(name)},
    Noty: {show: s => notices.push(s)}, Activity: {push: o => activities.push(o)},
    Template: {get: () => element()}, Controller: {enable() {}, toggle() {}},
    Player: {play: item => played.push(item), playlist: items => played.push(items)},
  };
  const context = {window: {}, location: {host: 'lampa.mx'}, Lampa, console, setTimeout, clearTimeout,
    setInterval: () => { throw Error('Unexpected automatic switching timer'); }, clearInterval, $: element};
  vm.runInNewContext(code, context);
  const component = new context.kas.component({movie: {id: 603, title: 'Матрица', original_title: 'The Matrix',
    release_date: '1999-03-30', imdb_id: 'tt0133093', kinopoisk_id: 301}});
  component.activity = {loader() {}, toggle() {}};
  return {api: context.kas, component, storage, calls, notices, activities, played, selections, settingsOpened, fields, context, Lampa};
}
const plain = x => JSON.parse(JSON.stringify(x));

test('former default migrates once; explicit restoration and custom servers survive', () => {
  const a = harness({ou_backend: 'https://akter-black.com/'});
  assert.equal(a.api.base, 'https://beta.mitsu.tv/api/');
  assert.equal(a.storage.ou_backend_previous, 'https://akter-black.com/');
  assert.equal(harness({...a.storage, ou_backend: 'https://akter-black.com/'}).api.base, 'https://akter-black.com/');
  assert.equal(harness({ou_backend: 'https://own.example/base'}).api.base, 'https://own.example/base/');
  assert.equal(harness({ou_backend: 'javascript:bad'}).api.base, 'https://beta.mitsu.tv/api/');
});

test('default sources are available without backend discovery and start with Filmix', async () => {
  const h = harness();
  const rows = await h.component.createSource();
  assert.deepEqual(plain(rows.map(x => x.balanser)), ['fxapi', 'phantom', 'zetflix', 'cdnvideohub', 'kinotochka', 'rutubemovie', 'vkmovie', 'kas_aniliberty', 'kas_torrents']);
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
  const rows = h.api.ouPreferredSources([{balanser: 'hdvb', url: 'https://x/', show: false},
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
  const h = harness({kas_balanser: 'fxapi', jackett_url: 'https://parser.example', torrserver_url: 'http://192.168.1.2:8090'});
  h.context.window.lampa_settings = {torrents_use: false, read_only: true};
  await h.component.createSource();
  h.component.changeBalanser('kas_torrents');
  assert.equal(h.activities[0].component, 'torrents');
  assert.equal(h.activities[0].search, 'The Matrix');
  assert.equal(h.storage.kas_balanser, 'fxapi');
  assert.equal(h.calls.length, 0);
  assert.equal(h.context.window.lampa_settings.torrents_use, true);
  assert.equal(h.context.window.lampa_settings.read_only, true);
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
  const registeredSettings = [];
  h.Lampa.SettingsApi = {addComponent() {}, addParam: data => { settings++; registeredSettings.push(data.param); }};
  vm.runInNewContext(source, h.context);
  assert.equal(registered, 1);
  assert.equal(settings, 1);
  assert.equal(h.Lampa.Manifest.plugins.version, '2.1.1');
  // Lampa Params.update treats a non-string values field as a lookup table.
  // Opening Settings crashed here when input registration omitted values.
  const input = registeredSettings.find(param => param.name === 'ou_backend');
  const stored = h.Lampa.Storage.get(input.name, input.default);
  const displayed = typeof input.values === 'string' ? stored : input.values[stored] || input.values[input.default];
  assert.equal(displayed, 'https://beta.mitsu.tv/api/');
  vm.runInNewContext(source, h.context);
  assert.equal(registered, 1);
  assert.equal(settings, 1);
});

test('Samsung Tizen requests identify the CORS transport', () => {
  const h = harness({}, 'tizen');
  assert.match(h.component.requestParams('http://wtch.ch/lite/fxapi'), /[?&]rchtype=cors(?:&|$)/);
});

test('WTCH migrates once, retaining Filmix there and custom settings unchanged', async () => {
  const h = harness({ou_backend: 'http://wtch.ch/'});
  assert.equal(h.api.base, 'https://beta.mitsu.tv/api/');
  assert.equal(h.storage.ou_backend_previous, 'http://wtch.ch/');
  assert.equal(harness({...h.storage, ou_backend: 'http://wtch.ch/'}).api.base, 'http://wtch.ch/');
  const rows = await h.component.createSource();
  assert.equal(rows.find(r => r.balanser === 'fxapi').url, 'http://wtch.ch/lite/fxapi');
  assert.equal(rows.find(r => r.balanser === 'phantom').url, 'https://beta.mitsu.tv/api/lite/phantom');
  const old = harness({kas_balanser: 'zetflixdb'});
  await old.component.createSource();
  assert.equal(old.storage.kas_active_balanser, 'zetflix');
});

test('relative API URLs and quality objects normalize without leaking account data to media', () => {
  const h = harness({account_email: 'private@example.com'});
  const stream = h.api.ouStream({url: '/lite/phantom/video',
    quality: {'720p': {url: '//cdn.example/video.m3u8'}, bad: 'javascript:alert(1)'},
    subtitles: [{url: 'http://127.0.0.1:9118/subs', label: 'RU'}]});
  assert.equal(stream.url, 'https://beta.mitsu.tv/api/lite/phantom/video');
  assert.deepEqual(plain(stream.quality), {'720p': 'https://cdn.example/video.m3u8'});
  assert.equal(stream.subtitles[0].url, 'https://beta.mitsu.tv/api/subs');
  assert.equal(h.api.ouUrl('/api/lite/phantom'), 'https://beta.mitsu.tv/api/lite/phantom');
  assert.ok(!h.api.account(stream.url).includes('account_email'));
  assert.equal(h.api.account('https://cdn.example/video.m3u8'), 'https://cdn.example/video.m3u8');
});

test('HTML parsing skips a malformed row and retains Phantom episodes and voice buttons', async () => {
  const h = harness({kas_balanser: 'phantom'});
  await h.component.createSource();
  const dom = new JSDOM();
  h.context.$ = jquery(dom.window);
  const html = `<div class="videos__item" data-json='broken'>broken</div>
    <div class="videos__button active" data-json='{"url":"/lite/phantom?s=1&t=3"}'>Дубляж</div>
    <div class="videos__item" s="1" e="2" data-json='{"method":"call","url":"/lite/phantom/video?id_file=2","stream":"/lite/phantom/video.m3u8?id_file=2&play=true"}'>2 серия</div>`;
  const rows = h.component.parseJsonDate(html, '.videos__item');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].season, 1);
  assert.equal(rows[0].episode, 2);
  assert.equal(rows[0].url, 'https://beta.mitsu.tv/api/lite/phantom/video?id_file=2');
  assert.equal(h.component.parseJsonDate(html, '.videos__button')[0].active, true);
  dom.window.close();
});

function captureDisplay(h, videos) {
  let enter;
  h.component.draw = (items, events) => {
    items.forEach(item => { item.qualitys = item.quality; item.quality = Object.keys(item.quality || {})[0] || ''; item.title = item.text; item.mark = () => {}; });
    enter = events.onEnter;
  };
  h.component.filter = () => {};
  h.component.display(videos);
  return enter;
}

test('Phantom call resolves text JSON and every episode keeps stream headers, qualities and subtitles', async () => {
  const h = harness({kas_balanser: 'phantom', video_quality_default: '720'});
  await h.component.createSource();
  const videos = [1, 2].map(episode => ({method: 'call', season: 1, episode,
    url: '/lite/phantom/video?id_file=' + episode,
    quality: {'720p': 'https://listing.example/placeholder'}, text: 'Серия ' + episode}));
  const enter = captureDisplay(h, videos);
  enter(videos[0]);
  assert.equal(h.calls[0].options.dataType, 'text');
  h.calls[0].ok(JSON.stringify({url: 'https://cdn.example/master.m3u8', quality: {'720p': 'https://cdn.example/720.m3u8'},
    headers: {Referer: 'https://provider.example'}, subtitles: [{url: 'https://cdn.example/ru.vtt'}], hls_manifest_timeout: 30000}));
  assert.equal(h.played[0].url, 'https://cdn.example/720.m3u8');
  const playlist = h.played[1];
  assert.deepEqual(plain(playlist[0].headers), {Referer: 'https://provider.example'});
  assert.equal(playlist[0].subtitles[0].url, 'https://cdn.example/ru.vtt');
  assert.equal(playlist[0].hls_manifest_timeout, 30000);
  assert.equal(typeof playlist[1].url, 'function');
  let called = false;
  playlist[1].url(() => called = true);
  h.calls[1].ok({url: 'https://cdn.example/episode2.m3u8', headers: {Referer: 'https://second.example'},
    subtitles: [{url: '/subs/2.vtt'}], hls_manifest_timeout: 45000});
  assert.equal(called, true);
  assert.equal(playlist[1].url, 'https://cdn.example/episode2.m3u8');
  assert.equal(playlist[1].headers.Referer, 'https://second.example');
  assert.equal(playlist[1].hls_manifest_timeout, 45000);
  assert.equal(playlist[1].subtitles[0].url, 'https://beta.mitsu.tv/api/subs/2.vtt');
});

test('failed next-episode resolve completes the callback without a TypeError', async () => {
  const h = harness({kas_balanser: 'phantom'});
  await h.component.createSource();
  const videos = [{method: 'play', url: 'https://cdn/one', season: 1, episode: 1},
    {method: 'call', url: '/lite/phantom/video', season: 1, episode: 2}];
  captureDisplay(h, videos)(videos[0]);
  let done = false;
  const second = h.played[1][1];
  second.url(() => done = true);
  h.calls[0].fail();
  assert.equal(done, true);
  assert.equal(second.url, '');
});

test('stale catalog and stream callbacks cannot replace the active screen or start playback', () => {
  for (const action of ['reset', 'destroy']) {
    const h = harness();
    h.component.parse = () => assert.fail('Stale catalog');
    h.component.request('https://beta.mitsu.tv/api/lite/phantom');
    h.component[action]();
    h.calls[0].ok('<div>Old</div>');
    const other = harness();
    other.component.getFileUrl({method: 'call', url: '/lite/phantom/video'}, () => assert.fail('Stale stream'));
    other.component[action]();
    other.calls[0].ok({url: 'https://cdn/old'});
  }
});

test('RCH starts once when a resolver requests it, then retries only once', () => {
  const h = harness();
  let handshake = 0, result;
  h.component.rch = (data, done) => { handshake++; done(); };
  h.component.getFileUrl({method: 'call', url: '/lite/phantom/video'}, value => result = value);
  h.calls[0].ok({rch: true});
  h.calls[1].ok({rch: true});
  assert.equal(handshake, 1);
  assert.equal(result, false);
});

test('empty torrent configuration gets a parser and a TorrServer setup action', () => {
  const h = harness();
  h.component.openTorrents();
  assert.equal(h.storage.jackett_url, 'https://jacred.su');
  assert.equal(h.activities.length, 0);
  assert.equal(h.selections[0].items[0].settings, 'server');
  h.selections[0].onSelect(h.selections[0].items[0]);
  assert.deepEqual(h.settingsOpened, ['server']);
  h.selections[0].onSelect(h.selections[0].items[1]);
  assert.equal(h.activities[0].component, 'torrents');
});

test('torrent setup respects secondary parsers, Prowlarr, API keys and configured servers', () => {
  const h = harness({parser_torrent_type: 'prowlarr', parser_use_link: 'two', prowlarr_url_two: 'https://private.example',
    prowlarr_key_two: 'private', torrserver_use_link: 'two', torrserver_url_two: 'http://192.168.1.2:8090'});
  h.component.openTorrents();
  assert.equal(h.activities.length, 1);
  assert.equal(h.storage.prowlarr_key_two, 'private');
  assert.equal(h.storage.jackett_url, undefined);
  const missing = harness({parser_torrent_type: 'prowlarr'});
  missing.component.openTorrents();
  assert.equal(missing.storage.jackett_url, undefined);
  assert.equal(missing.selections[0].items[0].settings, 'parser');
  const keyOnly = harness({jackett_key: 'private'});
  keyOnly.component.openTorrents();
  assert.equal(keyOnly.storage.jackett_url, undefined);
});

test('native torrent query honors language/year and series names', () => {
  const h = harness({parse_lang: 'lg_df_year'});
  const query = h.api.ouTorrentSearch({name: 'Во все тяжкие', original_name: 'Breaking Bad', first_air_date: '2008-01-20'});
  assert.equal(query.search, 'Во все тяжкие Breaking Bad 2008');
  assert.equal(query.search_one, 'Во все тяжкие');
  assert.equal(query.search_two, 'Breaking Bad');
  assert.equal(query.movie.title, 'Во все тяжкие');
  assert.equal(query.movie.original_title, 'Breaking Bad');
  assert.equal(query.movie.original_name, 'Breaking Bad');
  assert.deepEqual(plain(query.movie.genres), []);
});

test('catalog → season → voice → resolved episode reaches Player through real HTML parsing', async () => {
  const h = harness({kas_balanser: 'phantom'});
  await h.component.createSource();
  const dom = new JSDOM();
  h.context.$ = jquery(dom.window);
  let videos, enter;
  h.component.draw = (items, events) => {
    videos = items; enter = events.onEnter;
    items.forEach(item => { item.mark = () => {}; item.qualitys = item.quality; });
  };
  h.component.filter = () => {};
  h.component.find();
  await Promise.resolve();
  h.calls[0].ok(`<div class="videos__item" data-json='{"method":"link","url":"/lite/phantom?s=1"}'>1 сезон</div>`);
  assert.ok(h.calls[1].url.startsWith('https://beta.mitsu.tv/api/lite/phantom?s=1'));
  h.calls[1].ok(`<div class="videos__button active" data-json='{"url":"/lite/phantom?s=1&t=4"}'>Дубляж</div>
    <div class="videos__item" s="1" e="1" data-json='{"method":"call","url":"/lite/phantom/video?id_file=123"}'>1 серия</div>`);
  assert.equal(videos[0].episode, 1);
  enter(videos[0]);
  assert.ok(h.calls[2].url.startsWith('https://beta.mitsu.tv/api/lite/phantom/video?id_file=123'));
  h.calls[2].ok('{"method":"play","url":"/proxy/episode.m3u8"}');
  assert.equal(h.played.length, 0);
  h.calls[3].ok('#EXTM3U\n#EXTINF:6\nsegment.ts');
  assert.equal(h.played[0].url, 'https://beta.mitsu.tv/api/proxy/episode.m3u8');
  assert.equal(h.played[1][0].episode, 1);
  h.component.destroy();
  dom.window.close();
});

test('direct VK streams retain headers; Apple external player uses the provider stream endpoint', async () => {
  const h = harness({kas_balanser: 'vkmovie'});
  await h.component.createSource();
  const items = [{method: 'play', url: 'https://cdn/video', headers: {Referer: 'https://vkvideo.ru/'}, hls_manifest_timeout: 30000}];
  captureDisplay(h, items)(items[0]);
  assert.equal(h.played[0].headers.Referer, 'https://vkvideo.ru/');
  const apple = harness({player: 'vlc'}, 'apple');
  let resolved;
  apple.component.getFileUrl({method: 'call', url: '/lite/phantom/video', stream: '/lite/phantom/video.m3u8?play=true'}, r => resolved = r);
  assert.equal(resolved.url, 'https://beta.mitsu.tv/api/lite/phantom/video.m3u8?play=true');
  assert.equal(apple.calls.length, 0);
});

test('empty or HTML proxy manifests never start the player and leave the voice selectable', async () => {
  for (const body of ['', '<html>upstream error</html>', '#EXTM3U\n#EXT-X-ENDLIST']) {
    const h = harness({kas_balanser: 'phantom'});
    await h.component.createSource();
    const rows = [{method: 'call', url: '/lite/phantom/video'}];
    captureDisplay(h, rows)(rows[0]);
    h.calls[0].ok({url: '/proxy/empty.m3u8'});
    h.calls[1].ok(body);
    assert.equal(h.played.length, 0);
    assert.match(h.notices[0], /другую озвучку/);
    assert.equal(h.storage.kas_balanser, 'phantom');
  }
});

test('Phantom checks the media playlist and falls back within the selected voice', async () => {
  const h = harness({kas_balanser: 'phantom', video_quality_default: 1080});
  await h.component.createSource();
  const rows = [{method: 'call', url: '/lite/phantom/video', voice_name: 'Дубляж'}];
  captureDisplay(h, rows)(rows[0]);
  h.calls[0].ok({url: '/proxy/2160.m3u8', quality: {'2160p': '/proxy/2160.m3u8', '1440p': '/proxy/1440.m3u8', '1080p': '/proxy/1080.m3u8', '720p': '/proxy/720.m3u8', '480p': '/proxy/480.m3u8'}});
  h.calls[1].ok('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n/api/proxy/1080-child.m3u8');
  assert.equal(h.calls[2].url, 'https://beta.mitsu.tv/api/proxy/1080-child.m3u8');
  h.calls[2].fail({status: 401});
  assert.equal(h.played.length, 0);
  assert.equal(h.calls[3].url, 'https://beta.mitsu.tv/api/proxy/720.m3u8');
  h.calls[3].ok('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n720-child.m3u8');
  h.calls[4].ok('#EXTM3U\n#EXTINF:6\nsegment.ts');
  assert.equal(h.played[0].url, 'https://beta.mitsu.tv/api/proxy/720.m3u8');
  assert.equal(h.played[0].quality['1080p'], undefined);
  assert.equal(h.played[0].voice_name, 'Дубляж');
  assert.equal(h.storage.kas_balanser, 'phantom');
  assert.match(h.notices[0], /той же озвучки/);
});

test('stale manifest callbacks cannot retry another quality or start playback', async () => {
  const h = harness({kas_balanser: 'phantom'});
  await h.component.createSource();
  const rows = [{method: 'play', url: '/proxy/a.m3u8', quality: {'720p': '/proxy/b.m3u8'}}];
  captureDisplay(h, rows)(rows[0]);
  h.component.reset();
  h.calls[0].ok('');
  assert.equal(h.calls.length, 1);
  assert.equal(h.played.length, 0);
});
