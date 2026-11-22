const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const jquery = require('jquery');

// Evaluate the real helpers/component; omit registration and UI templates only.
const source = fs.readFileSync(require('node:path').join(__dirname, '../kas_plugin.js'), 'utf8');
const code = source.slice(0, source.indexOf('  function startPlugin')) +
  '\n globalThis.kas = {component, ouBackend, ouDefaultSources, ouPreferredSources, ouAnimeVideos, ouUrl, ouStream, ouTorrentSearch, ouInstallTizenHls, ouSortItems, ouKodikParts, ouBwaStreams, account, base: OU_BASE}; })();';

function harness(saved = {}, platform = 'browser', movie) {
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
  const component = new context.kas.component({movie: movie || {id: 603, title: 'Матрица', original_title: 'The Matrix',
    release_date: '1999-03-30', imdb_id: 'tt0133093', kinopoisk_id: 301}});
  component.activity = {loader() {}, toggle() {}};
  return {api: context.kas, component, storage, calls, notices, activities, played, selections, settingsOpened, fields, context, Lampa};
}
const plain = x => JSON.parse(JSON.stringify(x));

function catalogRow(data, text = '', cls = 'videos__item', extra = '') {
  return `<div class="${cls}" data-json='${JSON.stringify(data).replace(/'/g, '&#39;')}' ${extra}>${text}</div>`;
}
function htmlHarness(saved, movie) {
  const h = harness(saved, 'browser', movie);
  const dom = new JSDOM('');
  h.context.$ = jquery(dom.window);
  return h;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('card discovery excludes empty, unrelated and failed providers, follows seasons, reuses catalog and removes old selection', async () => {
  const h = htmlHarness({kas_balanser: 'empty'});
  const rows = ['empty', 'found', 'unrelated', 'down'].map(balanser => ({balanser, name: balanser, url: 'https://example.com/' + balanser}));
  rows.push({balanser: 'kas_torrents', name: 'Торренты', url: 'kas:torrents'});
  await h.component.startSource(rows);
  const pending = h.component.checkSources(rows);
  assert.equal(h.calls.length, 3, 'bounded concurrency');
  h.calls[0].ok('');
  h.calls[2].ok(catalogRow({method: 'link', similar: true, title: 'Другая картина', year: 1999, url: 'https://example.com/wrong'}));
  h.calls[3].fail({status: 503});
  h.calls[1].ok(catalogRow({method: 'link', url: 'https://example.com/season'}, '1 сезон'));
  h.calls[4].ok(catalogRow({method: 'call', url: 'https://example.com/video'}, 'Серия 1'));
  assert.deepEqual(plain((await pending).map(row => row.balanser)), ['found']);
  assert.equal(h.storage.kas_active_balanser, 'found');
  let parsed;
  h.component.parse = data => parsed = data;
  h.component.find(); await tick();
  assert.match(parsed, /1 сезон/);
  assert.equal(h.calls.length, 5, 'selected catalog was not fetched again');
  const other = new h.api.component({movie: {id: 603, title: 'Матрица', original_title: 'The Matrix', release_date: '1999-03-30', imdb_id: 'tt0133093', kinopoisk_id: 301}});
  other.activity = {loader() {}, toggle() {}};
  assert.equal((await other.checkSources(rows)).length, 1);
  assert.equal(h.calls.length, 5, 'switching sources reuses card-specific discovery');
  const different = new h.api.component({movie: {id: 129, title: 'Унесённые призраками'}});
  different.activity = {loader() {}, toggle() {}};
  const newPending = different.checkSources(rows);
  assert.equal(h.calls.length, 8, 'another card must be checked separately');
  different.destroy(); await newPending;
  h.component.destroy(); other.destroy();
});

test('closing or refreshing discovery stops its queue and stale responses cannot restore sources', async () => {
  for (const action of ['reset', 'destroy']) {
    const h = htmlHarness();
    const rows = ['a','b','c','d'].map(balanser => ({balanser, url: 'https://example.com/' + balanser}));
    const pending = h.component.checkSources(rows);
    h.component[action]();
    h.calls.forEach(call => call.ok(catalogRow({method: 'play', url: 'https://cdn.example/video.mp4'})));
    assert.deepEqual(plain(await pending), []);
    assert.equal(h.calls.length, 3);
    assert.equal(h.storage.kas_active_balanser, undefined);
  }
});

test('the overall discovery deadline retains confirmed sources and stops further folder probes', async () => {
  const h = htmlHarness();
  let deadline;
  h.context.setTimeout = (callback, ms) => ms === 25000 ? (deadline = callback, null) : setTimeout(callback, ms);
  const rows = ['ready','slow','also-slow','queued'].map(balanser=>({balanser,url:'https://example.com/'+balanser}));
  const pending = h.component.checkSources(rows);
  h.calls[0].ok(catalogRow({method:'play',url:'https://cdn.example/ready.mp4'}));
  h.calls[1].ok(catalogRow({method:'link',url:'https://example.com/folder'},'1 сезон'));
  const count = h.calls.length;
  deadline();
  assert.deepEqual(plain((await pending).map(row=>row.balanser)),['ready']);
  assert.equal(h.calls.length,count,'timed out folders must not continue requesting more pages');
  h.component.destroy();
});

test('an empty season folder and an anime release without video are not available sources', async () => {
  const h = htmlHarness();
  const rows = [{balanser:'one',url:'https://example.com/catalog'}, {balanser:'kas_aniliberty',url:'kas:anime'}];
  const pending = h.component.checkSources(rows);
  h.calls[0].ok(catalogRow({method:'link',url:'https://example.com/empty'}, '1 сезон'));
  h.calls[2].ok('');
  h.calls[1].ok(JSON.stringify([{id:42,name:{main:'Матрица'},year:1999}]));
  h.calls[3].ok(JSON.stringify({id:42, episodes:[]}));
  assert.deepEqual(plain(await pending), []);
  h.component.destroy();
});

test('source titles ignore historical statistics and retain configured order', () => {
  const h = harness({'ou_stats_v2_https://beta.mitsu.tv/api': {a:{ok:1,ms:40000,fail:8},b:{ok:9,ms:10}}});
  const items = h.api.ouSortItems({a:{name:'Kodik'},b:{name:'Kinotochka'}}, ['a','b'],'a');
  assert.deepEqual(plain(items.map(x => x.title)), ['Kodik','Kinotochka']);
  assert.equal(items[0].selected, true);
  assert.doesNotMatch(source, /ou_stats_v2_|ouWatchPlayback|ouBadge/);
});

test('Explorer cannot replace a series search title with its movie placeholder or mutate the original card', () => {
  const h = harness();
  const Original = h.Lampa.Explorer;
  h.Lampa.Explorer = function(object) {
    object.movie.title = object.movie.title || 'Фильм не найден';
    object.movie.original_title = object.movie.original_title || '';
    return new Original(object);
  };
  const movie = {id:94664,name:'Реинкарнация безработного',original_name:'Mushoku Tensei'};
  const component = new h.api.component({movie});
  const url = new URL(component.requestParams('http://wtch.ch/lite/kodik'));
  assert.equal(url.searchParams.get('title'), movie.name);
  assert.equal(url.searchParams.get('original_title'), movie.original_name);
  assert.equal(movie.title, undefined);
  component.destroy();
});

test('manual refresh invalidates negative results and discovers a recovered provider', async () => {
  const h = htmlHarness();
  const rows = [{balanser:'recovered',name:'Recovered',url:'https://example.com/catalog'}];
  const pending = h.component.checkSources(rows);
  h.calls[0].fail({status:503});
  assert.equal((await pending).length,0);
  let found = false;
  h.component.search = () => found = true;
  h.component.refreshSources();
  h.calls[1].ok(catalogRow({method:'play',url:'https://cdn.example/video.mp4'}));
  await tick();
  assert.equal(found,true);
  assert.equal(h.storage.kas_active_balanser,'recovered');
  h.component.destroy();
});

test('Collaps series preserve the selected voice in lazy episode and playlist resolvers', async () => {
  const h = harness({kas_balanser:'collaps'},'tizen',{id:1396,name:'Во все тяжкие',original_name:'Breaking Bad',number_of_seasons:5});
  await h.component.startSource([h.api.ouDefaultSources().find(row=>row.balanser==='collaps')]);
  let videos;
  h.component.display = value => videos=value;
  h.component.request('https://api.bwa.ad/lite/collaps?season=2&episode=1');
  h.calls[0].ok({episodes:[1,2,3],streams:[{kind:'hls',voice:'LostFilm',url:'https://cdn.example/1.m3u8',quality:'720p'}]});
  assert.deepEqual(plain(videos.map(item=>item.episode)),[1,2,3]);
  assert.ok(videos.every(item=>item.season===2&&item.kas_bwa_voice==='LostFilm'));
  let stream;
  h.component.getFileUrl(videos[2],value=>stream=value);
  assert.equal(new URL(h.calls[1].url).searchParams.get('episode'),'3');
  h.calls[1].ok({streams:[{kind:'hls',voice:'Другой перевод',url:'https://cdn.example/wrong.m3u8'}]});
  assert.equal(stream,false,'do not silently switch a missing translation');
  h.component.destroy();
});

test('Kodik combines split cours into 24 actual episodes with shared voice and untouched resolver URLs', async () => {
  const movie = {id:94664,name:'Реинкарнация безработного: История о приключениях в другом мире', original_name:'Mushoku Tensei', first_air_date:'2021-01-11',imdb_id:'tt13293588',kinopoisk_id:1312253};
  const h = htmlHarness({kas_balanser:'kodik',online_choice_kodik:{94664:{season:1,voice_name:'AniLibria'}}}, movie);
  const rows = [{balanser:'kodik',name:'Kodik',url:'http://wtch.ch/lite/kodik'}];
  await h.component.startSource(rows);
  const pending = h.component.checkSources(rows);
  h.calls[0].ok([1,2].map(n => catalogRow({method:'link',url:'http://wtch.ch/base'+n},n+' сезон')).join(''));
  h.calls[1].ok(catalogRow({method:'call',url:'http://wtch.ch/video/base'},'Серия 1','videos__item','s="1" e="1"'));
  const parts = [1,2].map(part => catalogRow({method:'link',similar:true,title:`Реинкарнация безработного [ТВ-2, часть ${part}] / Mushoku Tensei II`,url:`http://wtch.ch/part${part}`}, 'Релиз'));
  parts.push(catalogRow({method:'link',similar:true,title:'Другое аниме [ТВ-2, часть 2]',url:'http://wtch.ch/wrong'}));
  h.calls[2].ok(parts.join(''));
  assert.equal((await pending).length,1);
  let displayed;
  h.component.display = videos => displayed = videos;
  h.component.find();
  const page = (part, active = 'AniLibria') => ['AniLibria', 'OnlyPart'+part].map(voice => catalogRow({method:'link',url:`http://wtch.ch/part${part}?voice=${voice}`},voice,'videos__button'+(voice===active?' active':''))).join('') +
    Array.from({length:12},(_,i) => catalogRow({method:'call',url:`http://wtch.ch/video/part${part}/${i+1}`},`${i+1} серия`,'videos__item',`s="2" e="${i+1}"`)).join('');
  h.calls[3].ok(page(1)); h.calls[4].ok(page(2)); await tick();
  assert.equal(displayed.length,24);
  assert.deepEqual(plain(displayed.map(x=>x.episode)),Array.from({length:24},(_,i)=>i+1));
  assert.equal(displayed[12].url,'http://wtch.ch/video/part2/1');
  assert.equal(displayed[23].url,'http://wtch.ch/video/part2/12');
  assert.ok(displayed.every(x=>x.season===2 && x.voice_name==='AniLibria'));
  let stream;
  h.component.getFileUrl(displayed[23],value=>stream=value);
  h.calls[5].ok({url:'https://cdn.example/actual-part2-12.m3u8',quality:{'720p':'https://cdn.example/actual-part2-12.m3u8'}});
  assert.equal(stream.url,'https://cdn.example/actual-part2-12.m3u8');
  h.component.destroy();
});

test('Collaps JSON resolves films and next episodes without sending account credentials to BWA', async () => {
  const h = harness({account_email:'private@example.com'});
  h.Lampa.Utils.hash = () => 'private-hash';
  const defaults = h.api.ouDefaultSources();
  assert.ok(defaults.some(row=>row.balanser==='kinotochka'));
  const row = defaults.find(row=>row.balanser==='collaps');
  await h.component.startSource([row]);
  const url = h.component.requestParams(row.url);
  assert.doesNotMatch(h.api.account(url), /private|cub_id|account_email/);
  let videos;
  h.component.display = value=>videos=value;
  h.component.request(url);
  h.calls[0].ok(JSON.stringify({streams:[{kind:'hls',voice:'Дубляж',quality:'720p',url:'https://cdn.example/720.m3u8'},{kind:'hls',voice:'Дубляж',quality:'480p',url:'https://cdn.example/480.m3u8'}]}));
  assert.equal(videos.length,1);
  assert.equal(videos[0].quality['480p'],'https://cdn.example/480.m3u8');
  let resolved;
  h.component.getFileUrl({method:'call',url:row.url+'?season=2&episode=24',kas_bwa_voice:'Дубляж'},data=>resolved=data);
  h.calls[1].ok({streams:[{kind:'hls',voice:'Дубляж',quality:'720p',url:'https://cdn.example/24.m3u8'}]});
  assert.equal(resolved.url,'https://cdn.example/24.m3u8');
  h.component.destroy();
});

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
  assert.deepEqual(plain(rows.map(x => x.balanser)), ['fxapi', 'phantom', 'zetflix', 'cdnvideohub', 'kodik', 'veoveo', 'collaps', 'kinotochka', 'rutubemovie', 'vkmovie', 'kas_aniliberty', 'kas_torrents']);
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
  assert.equal(h.Lampa.Manifest.plugins.version, '2.2.0');
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

function enableTizenHls(h) {
  h.context.window.Hls = {isSupported: () => true};
  h.Lampa.PlayerVideo = {registerTube() {}};
}
const fmp4 = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6\nsegment.m4s';

test('Tizen Phantom fMP4 uses the compatibility adapter and Full HD without changing player settings', async () => {
  const h = harness({kas_balanser: 'phantom', player: 'tizen', video_quality_default: 2160}, 'tizen');
  enableTizenHls(h);
  await h.component.createSource();
  const items = [{method: 'call', url: '/lite/phantom/video'}];
  captureDisplay(h, items)(items[0]);
  h.calls[0].ok({url: '/proxy/2160.m3u8', quality: {'2160p': '/proxy/2160.m3u8', '1080p': '/proxy/1080.m3u8', '720p': '/proxy/720.m3u8'}});
  assert.match(h.calls[1].url, /1080.m3u8$/);
  h.calls[1].ok('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n1080-child.m3u8');
  h.calls[2].ok(fmp4);
  assert.equal(h.played[0].kas_phantom_hls, true);
  assert.equal(h.played[0].card.id, 603);
  assert.deepEqual(Object.keys(h.played[0].quality), ['1080p', '720p']);
  assert.equal(h.storage.player, 'tizen');
  assert.equal(h.storage.video_quality_default, 2160);
});

test('Phantom adapter does not intercept TS, other sources, browsers or devices without MSE', async () => {
  for (const [platform, provider, supported, body] of [
    ['tizen', 'phantom', true, '#EXTM3U\n#EXTINF:6\nsegment.ts'],
    ['tizen', 'cdnvideohub', true, fmp4], ['browser', 'phantom', true, fmp4],
    ['tizen', 'phantom', false, fmp4]
  ]) {
    const h = harness({kas_balanser: provider}, platform);
    if (supported) enableTizenHls(h);
    await h.component.createSource();
    const items = [{method: 'play', url: '/proxy/video.m3u8'}];
    captureDisplay(h, items)(items[0]);
    h.calls[0].ok(body);
    assert.equal(h.played[0].kas_phantom_hls, false);
  }
});

test('next Phantom episode on Tizen resolves metadata instead of using the unchecked redirect', async () => {
  const h = harness({kas_balanser: 'phantom', player: 'tizen'}, 'tizen');
  enableTizenHls(h);
  await h.component.createSource();
  const items = [1, 2].map(episode => ({method: 'call', season: 1, episode,
    url: '/lite/phantom/video?id=' + episode, stream: '/lite/phantom/video.m3u8?play=true&id=' + episode}));
  captureDisplay(h, items)(items[0]);
  h.calls[0].ok({url: '/proxy/1.m3u8'});
  h.calls[1].ok(fmp4);
  const next = h.played[1][1];
  assert.equal(typeof next.url, 'function');
  let completed = false;
  next.url(() => completed = true);
  assert.match(h.calls[2].url, /\/lite\/phantom\/video\?id=2/);
  h.calls[2].ok({url: '/proxy/2.m3u8'});
  h.calls[3].ok(fmp4);
  assert.equal(completed, true);
  assert.equal(next.kas_phantom_hls, true);
});

function adapterHarness() {
  const h = harness({}, 'tizen');
  const dom = new JSDOM();
  h.context.window = dom.window;
  h.context.$ = jquery(dom.window);
  const instances = [], errors = [], timers = new Map();
  let timerId = 0, loads = 0, plays = 0, adapter;
  h.context.setTimeout = cb => { timers.set(++timerId, cb); return timerId; };
  h.context.clearTimeout = id => timers.delete(id);
  dom.window.HTMLMediaElement.prototype.load = () => loads++;
  dom.window.HTMLMediaElement.prototype.play = () => { plays++; return Promise.resolve(); };
  class Hls {
    static isSupported() { return true; }
    static Events = {MEDIA_ATTACHED: 'attached', MANIFEST_PARSED: 'parsed', ERROR: 'error'};
    constructor(options) { this.options = options; this.events = {}; instances.push(this); }
    on(event, callback) { this.events[event] = callback; }
    emit(event, data) { this.events[event]?.(event, data); }
    attachMedia(video) { this.video = video; video.src = 'blob:media-source'; video.load(); }
    loadSource(url) { this.source = url; }
    destroy() { this.destroyed = (this.destroyed || 0) + 1; }
  }
  dom.window.Hls = Hls;
  const data = {kas_phantom_hls: true, url: 'https://cdn.example/master.m3u8',
    quality: {'720p': 'https://cdn.example/720.m3u8'}, headers: {'X-Test': 'header'}};
  h.Lampa.Player.playdata = () => data;
  h.Lampa.PlayerVideo = {registerTube: a => adapter = a, listener: {send: (event, info) => errors.push(info)}};
  h.api.ouInstallTizenHls();
  let video;
  adapter.create(v => video = v);
  return {h, dom, instances, errors, timers, adapter, video, data, Hls,
    loads: () => loads, plays: () => plays, close() { video.destroy(); dom.window.close(); }};
}

test('Tizen adapter uses real video, preserves MediaSource and scopes itself to the active Phantom URLs', () => {
  const a = adapterHarness();
  try {
    assert.equal(a.adapter.verify(a.data.url), true);
    assert.equal(a.adapter.verify(a.data.quality['720p']), true);
    assert.equal(a.adapter.verify('https://other.example/video.m3u8'), false);
    a.data.kas_phantom_hls = false;
    assert.equal(a.adapter.verify(a.data.url), false);
    a.data.kas_phantom_hls = true;
    a.video.src = a.data.url;
    const hls = a.instances[0];
    assert.equal(a.video.tagName, 'VIDEO');
    assert.equal(a.video.src, 'blob:media-source');
    a.video.load();
    assert.equal(a.loads(), 0, 'Lampa load() must not detach MSE');
    hls.emit('attached');
    assert.equal(hls.source, a.data.url);
    const headers = {};
    hls.options.xhrSetup({setRequestHeader: (k, v) => headers[k] = v});
    assert.equal(headers['X-Test'], 'header');
    hls.emit('parsed');
    assert.equal(a.plays(), 1);
    a.video.dispatchEvent(new a.dom.window.Event('playing'));
    assert.equal(a.timers.size, 0);
    a.video.destroy();
    assert.equal(hls.destroyed, 1);
    assert.equal(a.loads(), 1);
    hls.emit('parsed');
    assert.equal(a.plays(), 1, 'late callbacks cannot restart a closed video');
  } finally { a.close(); }
});

test('Tizen adapter surfaces fatal HLS errors and stops loading instead of silently hanging', () => {
  const a = adapterHarness();
  try {
    a.video.src = a.data.url;
    a.instances[0].emit('error', {fatal: false, details: 'retryable'});
    assert.equal(a.errors.length, 0);
    a.instances[0].emit('error', {fatal: true, details: 'fragLoadError', url: 'https://secret.example/token'});
    assert.equal(a.errors.length, 1);
    assert.match(a.errors[0].error, /Phantom \(Tizen\).*fragLoadError/);
    assert.equal(a.errors[0].fatal, true);
    assert.ok(!a.errors[0].error.includes('secret'));
    assert.equal(a.timers.size, 0);
    assert.equal(a.instances[0].destroyed, 1);
    a.instances[0].emit('parsed');
    assert.equal(a.plays(), 0);
  } finally { a.close(); }
});

test('Tizen adapter times out a silent start and cancels the watchdog when closed', () => {
  const a = adapterHarness();
  try {
    a.video.src = a.data.url;
    [...a.timers.values()][0]();
    assert.match(a.errors[0].error, /startTimeout/);
    a.video.src = a.data.url;
    assert.equal(a.timers.size, 1);
    a.video.destroy();
    assert.equal(a.timers.size, 0);
    assert.equal(a.instances[1].destroyed, 1);
  } finally { a.close(); }
});

test('a synchronous Player failure is shown to the user', async () => {
  const h = harness({kas_balanser: 'phantom'});
  await h.component.createSource();
  h.Lampa.Player.play = () => { throw new Error('Player startup failed'); };
  const items = [{method: 'play', url: 'https://cdn.example/video.mp4'}];
  assert.doesNotThrow(() => captureDisplay(h, items)(items[0]));
  assert.match(h.notices[0], /Player startup failed/);
});

test('Kodik and VeoVeo are selectable defaults with their verified backends', async () => {
  for (const [provider, base] of [['kodik', 'http://wtch.ch/'], ['veoveo', 'https://beta.mitsu.tv/api/']]) {
    const h = harness({kas_balanser: provider});
    const rows = await h.component.createSource();
    assert.equal(rows.find(row => row.balanser === provider).url, base + 'lite/' + provider);
    assert.equal(h.storage.kas_active_balanser, provider);
    h.component.find();
    await Promise.resolve();
    assert.ok(h.calls[0].url.startsWith(base + 'lite/' + provider + '?'));
    assert.match(h.calls[0].url, /kinopoisk_id=301/);
    h.component.destroy();
  }
});

test('custom discovery keeps Kodik and VeoVeo on the configured server', () => {
  const h = harness({ou_backend: 'https://own.example'});
  const rows = h.api.ouPreferredSources([
    {balanser: 'veoveo', name: 'VeoVeo', url: 'https://own.example/lite/veoveo'},
    {balanser: 'kodik', name: 'Kodik', url: 'https://own.example/lite/kodik'}
  ]);
  assert.deepEqual(plain(rows.slice(0, 2).map(row => row.balanser)), ['kodik', 'veoveo']);
  assert.equal(rows[0].url, 'https://own.example/lite/kodik');
});

test('Kodik season and voice HTML resolves an episode with quality and timeout on Tizen', async () => {
  const h = harness({kas_balanser: 'kodik', player: 'tizen', video_quality_default: 720}, 'tizen');
  const dom = new JSDOM();
  h.context.$ = jquery(dom.window);
  await h.component.createSource();
  let items, enter;
  h.component.draw = (rows, handlers) => {
    items = rows; enter = handlers.onEnter;
    rows.forEach(row => { row.mark = () => {}; row.qualitys = row.quality; });
  };
  h.component.filter = () => {};
  h.component.parse(`<div class="videos__item" data-json='{"method":"link","url":"/lite/kodik?s=1"}'>1 сезон</div>`);
  assert.equal(h.calls[0].url, 'http://wtch.ch/lite/kodik?s=1&uid=testuid');
  h.calls[0].ok(`<div class="videos__button active" data-json='{"method":"link","url":"/lite/kodik?s=1&kid=serial-1"}'>Мега-Аниме</div>
    <div class="videos__item" s="1" e="1" data-json='{"method":"call","url":"/lite/kodik/video?episode=1","hls_manifest_timeout":30000}'>1 серия</div>`);
  assert.equal(items[0].season, 1);
  enter(items[0]);
  assert.equal(h.calls[1].url, 'http://wtch.ch/lite/kodik/video?episode=1&uid=testuid');
  h.calls[1].ok(JSON.stringify({method: 'play', url: 'https://cdn.example/720.m3u8',
    quality: {'720p': 'https://cdn.example/720.m3u8', '480p': 'https://cdn.example/480.m3u8'}, hls_manifest_timeout: 30000}));
  assert.equal(h.played[0].url, 'https://cdn.example/720.m3u8');
  assert.equal(h.played[0].quality['480p'], 'https://cdn.example/480.m3u8');
  assert.equal(h.played[0].hls_manifest_timeout, 30000);
  assert.equal(h.played[0].kas_phantom_hls, undefined);
  h.component.destroy(); dom.window.close();
});

test('VeoVeo keeps all seasons and passes direct episode playlists unchanged to Tizen', async () => {
  const h = harness({kas_balanser: 'veoveo', player: 'tizen'}, 'tizen');
  const dom = new JSDOM(); h.context.$ = jquery(dom.window);
  await h.component.createSource();
  let items, enter, filter;
  h.component.draw = (rows, handlers) => {
    items = rows; enter = handlers.onEnter;
    rows.forEach(row => { row.mark = () => {}; });
  };
  h.component.filter = data => filter = data;
  h.component.parse([1, 2].map(s => `<div class="videos__item" data-json='{"method":"link","url":"/lite/veoveo?s=${s}"}'>${s} сезон</div>`).join(''));
  h.calls[0].ok([1, 2].map(e => `<div class="videos__item" s="1" e="${e}" data-json='{"method":"play","url":"https://cdn.example/episode${e}.m3u8?pl=public-signature","hls_manifest_timeout":30000}'>${e} серия</div>`).join(''));
  assert.deepEqual(plain(filter.season), ['1 сезон', '2 сезон']);
  enter(items[0]);
  assert.equal(h.played[0].url, 'https://cdn.example/episode1.m3u8?pl=public-signature');
  assert.equal(h.played[1][1].url, 'https://cdn.example/episode2.m3u8?pl=public-signature');
  assert.equal(h.played[1][1].episode, 2);
  assert.equal(h.played[1][1].hls_manifest_timeout, 30000);
  assert.equal(h.calls.length, 1, 'direct playback does not repeat the API request');
  h.component.destroy(); dom.window.close();
});
