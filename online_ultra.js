/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║            ONLINE ULTRA — Plugin for Lampa               ║
 * ║  12 источников: RU + ENG | Голос | Сезон | Субтитры     ║
 * ║  Установка: Настройки → Плагины → вставить URL          ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 *  RU источники:
 *    VideoCDN, Collaps, HDVB, Kodik, Alloha, Rezka/Voidboost
 *
 *  ENG источники (с субтитрами):
 *    VidSrc, AutoEmbed, 2Embed, SmashyStream, VidLink, VidSrc.nl
 *
 *  Функции:
 *    ✓ Выбор источника
 *    ✓ Выбор озвучки (для RU источников)
 *    ✓ Выбор сезона и эпизода
 *    ✓ Выбор качества
 *    ✓ ENG субтитры (автоматически через embedded плееры)
 *    ✓ Отметка просмотренных эпизодов
 *    ✓ Запоминание выбора источника
 *    ✓ Настройки прокси в разделе настроек Lampa
 */
(function () {
'use strict';

/* ════════════════════════════════════════════════════════════
   КОНФИГУРАЦИЯ ИСТОЧНИКОВ
════════════════════════════════════════════════════════════ */
var SOURCES = {

  /* ── Российские источники ─────────────────────────────── */

  videocdn: {
    name: 'VideoCDN', lang: 'RU', icon: '🎬',
    hasVoice: true, hasSubs: true, hasQuality: true,
    proxy_key: 'ou_proxy_videocdn',
    api: 'https://videocdn.tv/api/short',
    token: '3i40G5TSECmLF77oAqnEgbx61ZWaOYaE',

    search: function (card, done, fail) {
      var p   = getProxy(this.proxy_key);
      var url = p + this.api + '?api_token=' + this.token +
        (card.imdb_id ? '&imdb_id=' + card.imdb_id : '&kinopoisk_id=' + card.id) +
        '&with_episodes=true';
      ajax(url, function (d) {
        if (d && d.data && d.data.length) done(d.data[0]);
        else fail('Не найдено');
      }, function () { fail('Ошибка соединения'); });
    },

    getInfo: function (item) {
      var voices = [], seasons = [];
      if (item.episodes) {
        var byS = {};
        item.episodes.forEach(function (e) {
          var v = e.translation || 'Дубляж';
          var s = parseInt(e.season || 1);
          if (voices.indexOf(v) < 0) voices.push(v);
          if (seasons.indexOf(s) < 0) seasons.push(s);
          var key = v + '|' + s;
          if (!byS[key]) byS[key] = [];
          byS[key].push(e);
        });
        return { voices: voices, seasons: seasons.sort(function(a,b){return a-b;}), _byS: byS };
      }
      return { voices: [], seasons: [], _byS: {} };
    },

    getEpisodeCount: function (item, info, season, voice) {
      var key = (voice || (info.voices[0] || 'Дубляж')) + '|' + season;
      return (info._byS[key] || []).length || 0;
    },

    getStreams: function (item, info, season, ep, voice, done, fail) {
      var key = (voice || (info.voices[0] || '')) + '|' + (season || 1);
      var eps = (info._byS || {})[key] || [];
      var e   = null;
      eps.forEach(function (x) { if (parseInt(x.episode) === parseInt(ep)) e = x; });

      if (item.type === 'movie' || !season) {
        // Фильм
        if (item.iframe_src) {
          done([{ url: item.iframe_src, quality: 'Auto', iframe: true, voice: 'Дубляж', subs: null }]);
        } else fail('Нет iframe');
      } else {
        if (!e) return fail('Эпизод не найден');
        var streams = [];
        (e.qualities || []).forEach(function (q) {
          streams.push({ url: q.url, quality: q.quality, iframe: false, voice: voice || 'Дубляж', subs: null });
        });
        if (!streams.length && e.hls) streams.push({ url: e.hls, quality: '1080p', iframe: false, voice: voice || 'Дубляж', subs: null });
        if (streams.length) done(streams);
        else fail('Потоки не найдены');
      }
    },
  },

  collaps: {
    name: 'Collaps', lang: 'RU', icon: '📺',
    hasVoice: true, hasSubs: false, hasQuality: true,
    proxy_key: 'ou_proxy_collaps',

    search: function (card, done, fail) {
      var p   = getProxy(this.proxy_key);
      var url = p + 'https://api.bhcesh.me/franchise/details?token=eedefb541aeba871dcfc756e6b31c02e&' +
        (card.imdb_id ? 'imdb_id=' + card.imdb_id.replace('tt','') : 'kinopoisk_id=' + card.id);
      ajax(url, function (d) {
        if (d && d.id) done(d);
        else fail('Не найдено');
      }, function () { fail('Ошибка соединения'); });
    },

    getInfo: function (item) {
      var seasons = [];
      if (item.seasons) {
        item.seasons.forEach(function (s) { seasons.push(parseInt(s.id || s)); });
      }
      return { voices: ['Дубляж', 'Оригинал'], seasons: seasons.sort(function(a,b){return a-b;}), _item: item };
    },

    getEpisodeCount: function (item, info, season, voice) {
      var s = (item.seasons || []).find ? (item.seasons||[]).find(function(x){return parseInt(x.id||x)===parseInt(season);}) : null;
      return s ? (s.episodes_count || s.count || 12) : 12;
    },

    getStreams: function (item, info, season, ep, voice, done, fail) {
      var p   = getProxy(this.proxy_key);
      var url = p + 'https://api.bhcesh.me/episode/details?token=eedefb541aeba871dcfc756e6b31c02e&id=' +
        item.id + '&season=' + (season||1) + '&episode=' + (ep||1);
      ajax(url, function (d) {
        if (!d || (!d.hls && !d.url)) return fail('Нет потока');
        done([{ url: d.hls || d.url, quality: d.quality || '1080p', iframe: false, voice: voice || 'Дубляж', subs: null }]);
      }, function () { fail('Ошибка стрима'); });
    },
  },

  hdvb: {
    name: 'HDVB', lang: 'RU', icon: '🎥',
    hasVoice: false, hasSubs: false, hasQuality: true,
    proxy_key: 'ou_proxy_hdvb',

    search: function (card, done, fail) {
      if (!card.imdb_id) return fail('Нет IMDB ID');
      var p   = getProxy(this.proxy_key);
      var url = p + 'https://apivb.info/api/videos.json?token=&imdb_id=' + card.imdb_id;
      ajax(url, function (d) {
        if (d && d.length) done(d[0]);
        else fail('Не найдено');
      }, function () { fail('Ошибка соединения'); });
    },

    getInfo: function (item) {
      return { voices: [], seasons: item.seasons || [], _item: item };
    },

    getEpisodeCount: function (item, info, season, voice) {
      return 20;
    },

    getStreams: function (item, info, season, ep, voice, done, fail) {
      var p   = getProxy(this.proxy_key);
      var url = p + 'https://apivb.info/api/videos.json?token=&id=' + item.id;
      if (season) url += '&s=' + season + '&e=' + ep;
      ajax(url, function (d) {
        if (!d || !d.length) return fail('Нет потока');
        var streams = [];
        (d[0].files || []).forEach(function (f) {
          streams.push({ url: f.url, quality: f.quality || '720p', iframe: false, voice: 'Дубляж', subs: null });
        });
        if (!streams.length && d[0].hls) streams.push({ url: d[0].hls, quality: '720p', iframe: false, voice: 'Оригинал', subs: null });
        if (streams.length) done(streams); else fail('Файлы не найдены');
      }, function () { fail('Ошибка стрима'); });
    },
  },

  kodik: {
    name: 'Kodik', lang: 'RU', icon: '🔮',
    hasVoice: true, hasSubs: false, hasQuality: false,
    proxy_key: 'ou_proxy_kodik',

    search: function (card, done, fail) {
      var p   = getProxy(this.proxy_key);
      var url = p + 'https://kodikapi.com/search?token=447d179e875efe37769f60cf92a2b405&with_material_data=true&limit=5&' +
        (card.imdb_id ? 'imdb_id=' + card.imdb_id : 'title=' + encodeURIComponent(card.original_title || card.title || card.name || ''));
      ajax(url, function (d) {
        if (d && d.results && d.results.length) done(d.results);
        else fail('Не найдено');
      }, function () { fail('Ошибка соединения'); });
    },

    getInfo: function (items) {
      var voices = [];
      items.forEach(function (r) {
        var t = r.translation && r.translation.title || 'Дубляж';
        if (voices.indexOf(t) < 0) voices.push(t);
      });
      return { voices: voices, seasons: [], _items: items };
    },

    getEpisodeCount: function (item, info, season, voice) { return 24; },

    getStreams: function (item, info, season, ep, voice, done, fail) {
      // Find matching translation
      var chosen = (info._items || []).find ? (info._items||[]).find(function(r){return r.translation&&r.translation.title===voice;}) : (info._items||[])[0];
      if (!chosen) chosen = (info._items||[])[0];
      if (!chosen) return fail('Нет результата');
      var url = chosen.link ? ('https:' + chosen.link) : '';
      if (season) url += (url.indexOf('?')>-1?'&':'?') + 'season=' + season + '&episode=' + ep;
      done([{ url: url, quality: '720p', iframe: true, voice: voice || 'Дубляж', subs: null }]);
    },
  },

  alloha: {
    name: 'Alloha', lang: 'RU', icon: '🌟',
    hasVoice: true, hasSubs: false, hasQuality: false,
    proxy_key: 'ou_proxy_alloha',

    search: function (card, done, fail) {
      var p   = getProxy(this.proxy_key);
      var url = p + 'https://api.alloha.tv/?token=04941a9a3ca3993f4d56d1aed7cdf93d&' +
        (card.imdb_id ? 'imdb=' + card.imdb_id : 'kp=' + card.id);
      ajax(url, function (d) {
        if (d && d.data) done(d.data);
        else fail('Не найдено');
      }, function () { fail('Ошибка соединения'); });
    },

    getInfo: function (item) {
      var voices = [];
      if (item.translations) {
        Object.keys(item.translations).forEach(function(k){ voices.push(k); });
      }
      return { voices: voices, seasons: [], _item: item };
    },

    getEpisodeCount: function (item, info, season, voice) { return 24; },

    getStreams: function (item, info, season, ep, voice, done, fail) {
      var url = item.iframe;
      if (!url) return fail('Нет ссылки');
      if (season) url += (url.indexOf('?')>-1?'&':'?') + 's=' + season + '&e=' + ep;
      if (voice && item.translations && item.translations[voice]) {
        url += '&t=' + encodeURIComponent(item.translations[voice]);
      }
      done([{ url: url, quality: 'Auto', iframe: true, voice: voice || 'Дубляж', subs: null }]);
    },
  },

  rezka: {
    name: 'Rezka', lang: 'RU', icon: '🎞',
    hasVoice: true, hasSubs: true, hasQuality: true,
    proxy_key: 'ou_proxy_rezka',

    search: function (card, done, fail) {
      if (!card.imdb_id) return fail('Нет IMDB ID');
      done({ imdb: card.imdb_id, proxy: getProxy(this.proxy_key) });
    },

    getInfo: function (item) {
      return { voices: ['Дубляж', 'Оригинал', 'Многоголосый', 'Одноголосый'], seasons: [], _item: item };
    },

    getEpisodeCount: function () { return 24; },

    getStreams: function (item, info, season, ep, voice, done, fail) {
      var url = (item.proxy || '') + 'https://voidboost.net/embed/' + item.imdb + '?ref=lampa&ui=1';
      if (season) url += '&s=' + season + '&e=' + ep;
      if (voice) url += '&t=' + encodeURIComponent(voice);
      done([{ url: url, quality: 'Auto', iframe: true, voice: voice || 'Оригинал', subs: 'Multi' }]);
    },
  },

  /* ── Английские источники ─────────────────────────────── */

  vidsrc: {
    name: 'VidSrc', lang: 'ENG', icon: '🌐',
    hasVoice: false, hasSubs: true, hasQuality: false,
    search: function (card, done) { done({ tmdb: card.id, imdb: card.imdb_id }); },
    getInfo: function () { return { voices: [], seasons: [] }; },
    getEpisodeCount: function () { return 24; },
    getStreams: function (item, info, season, ep, voice, done) {
      var base = 'https://vidsrc.to/embed/';
      var url  = season ? base+'tv/'+(item.imdb||item.tmdb)+'/'+season+'/'+ep : base+'movie/'+(item.imdb||item.tmdb);
      done([{ url: url, quality: 'Auto', iframe: true, voice: 'ENG', subs: 'ENG+RU' }]);
    },
  },

  autoembed: {
    name: 'AutoEmbed', lang: 'ENG', icon: '🔁',
    hasVoice: false, hasSubs: true, hasQuality: false,
    search: function (card, done) { done({ tmdb: card.id }); },
    getInfo: function () { return { voices: [], seasons: [] }; },
    getEpisodeCount: function () { return 24; },
    getStreams: function (item, info, season, ep, voice, done) {
      var base = 'https://player.autoembed.cc/embed/';
      var url  = season ? base+'tv/'+item.tmdb+'/'+season+'/'+ep : base+'movie/'+item.tmdb;
      done([{ url: url, quality: 'Auto', iframe: true, voice: 'ENG', subs: 'Multi' }]);
    },
  },

  embed2: {
    name: '2Embed', lang: 'ENG', icon: '📡',
    hasVoice: false, hasSubs: true, hasQuality: false,
    search: function (card, done) { done({ tmdb: card.id }); },
    getInfo: function () { return { voices: [], seasons: [] }; },
    getEpisodeCount: function () { return 24; },
    getStreams: function (item, info, season, ep, voice, done) {
      var url = season
        ? 'https://www.2embed.cc/embedtv/'+item.tmdb+'&s='+season+'&e='+ep
        : 'https://www.2embed.cc/embed/'+item.tmdb;
      done([{ url: url, quality: 'Auto', iframe: true, voice: 'ENG', subs: 'Multi' }]);
    },
  },

  smashystream: {
    name: 'SmashyStream', lang: 'ENG', icon: '💥',
    hasVoice: false, hasSubs: true, hasQuality: false,
    search: function (card, done) { done({ tmdb: card.id }); },
    getInfo: function () { return { voices: [], seasons: [] }; },
    getEpisodeCount: function () { return 24; },
    getStreams: function (item, info, season, ep, voice, done) {
      var url = season
        ? 'https://player.smashy.stream/tv/'+item.tmdb+'?s='+season+'&e='+ep
        : 'https://player.smashy.stream/movie/'+item.tmdb;
      done([{ url: url, quality: 'Auto', iframe: true, voice: 'ENG', subs: 'Multi' }]);
    },
  },

  vidlink: {
    name: 'VidLink', lang: 'ENG', icon: '🔗',
    hasVoice: false, hasSubs: true, hasQuality: false,
    search: function (card, done) { done({ tmdb: card.id }); },
    getInfo: function () { return { voices: [], seasons: [] }; },
    getEpisodeCount: function () { return 24; },
    getStreams: function (item, info, season, ep, voice, done) {
      var c = 'primaryColor=e8a838&secondaryColor=f5c842&autoplay=true&poster=true';
      var url = season
        ? 'https://vidlink.pro/tv/'+item.tmdb+'/'+season+'/'+ep+'?'+c
        : 'https://vidlink.pro/movie/'+item.tmdb+'?'+c;
      done([{ url: url, quality: 'Auto', iframe: true, voice: 'ENG', subs: 'Multi' }]);
    },
  },

  vidsrcnl: {
    name: 'VidSrc.nl', lang: 'ENG', icon: '🌍',
    hasVoice: false, hasSubs: true, hasQuality: false,
    search: function (card, done) { done({ tmdb: card.id }); },
    getInfo: function () { return { voices: [], seasons: [] }; },
    getEpisodeCount: function () { return 24; },
    getStreams: function (item, info, season, ep, voice, done) {
      var url = season
        ? 'https://vidsrc.nl/embed/tv/'+item.tmdb+'/'+season+'/'+ep
        : 'https://vidsrc.nl/embed/movie/'+item.tmdb;
      done([{ url: url, quality: 'Auto', iframe: true, voice: 'ENG', subs: 'Multi' }]);
    },
  },
};

/* ════════════════════════════════════════════════════════════
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
════════════════════════════════════════════════════════════ */

function getProxy(key) {
  var v = Lampa.Storage.get(key, '') || Lampa.Storage.get('ou_proxy_all', '');
  if (v && v.slice(-1) !== '/') v += '/';
  return v;
}

function ajax(url, done, fail) {
  Lampa.Api.get(url, done, fail);
}

function c(tag, cls, html) {
  var el = document.createElement(tag);
  if (cls)  el.className = cls;
  if (html) el.innerHTML = html;
  return el;
}

function isSeries(card) {
  return !!(card.number_of_seasons || card.seasons || card.episode_run_time || card.name);
}

function storeKey(card) {
  return 'ou_' + (card.id || 0);
}

function saveState(card, obj) {
  try { Lampa.Storage.set(storeKey(card), JSON.stringify(obj)); } catch(e){}
}

function loadState(card) {
  try { return JSON.parse(Lampa.Storage.get(storeKey(card), 'null')) || {}; } catch(e){ return {}; }
}

function watchedKey(card, s, e, voice) {
  return 'w_' + (card.id||0) + '_' + s + '_' + e + '_' + (voice||'');
}

function markWatched(card, s, e, voice) {
  try { Lampa.Storage.set(watchedKey(card, s, e, voice), '1'); } catch(e){}
}

function isWatched(card, s, e, voice) {
  return !!Lampa.Storage.get(watchedKey(card, s, e, voice), '');
}

/* ════════════════════════════════════════════════════════════
   CSS
════════════════════════════════════════════════════════════ */
function injectCSS() {
  if (document.getElementById('ou-style')) return;
  var s = document.createElement('style');
  s.id  = 'ou-style';
  s.textContent = `
  .ou{padding:1.8em 2.2em;color:#fff;font-family:inherit}
  .ou-head{display:flex;align-items:center;gap:.8em;margin-bottom:1.4em;border-bottom:1px solid rgba(232,168,56,.2);padding-bottom:.9em}
  .ou-title{font-size:1.1em;font-weight:800;color:#e8a838;letter-spacing:.04em}
  .ou-count{font-size:.62em;background:#e8a838;color:#000;border-radius:3px;padding:2px 7px;font-weight:900;vertical-align:middle}
  .ou-tabs{display:flex;flex-wrap:wrap;gap:.4em;margin-bottom:1.2em;align-items:center}
  .ou-tab{padding:.38em 1em;border-radius:5px;border:1px solid rgba(255,255,255,.15);cursor:pointer;font-size:.82em;background:rgba(255,255,255,.04);transition:all .18s;color:#ccc}
  .ou-tab:focus,.ou-tab:hover{border-color:#e8a838;color:#e8a838;outline:none}
  .ou-tab.on{background:#e8a838;border-color:#e8a838;color:#000;font-weight:700}
  .ou-tab.eng{border-color:rgba(77,184,255,.3);color:#9dd4f5}
  .ou-tab.eng.on{background:#4db8ff;border-color:#4db8ff;color:#000}
  .ou-sep{font-size:.68em;color:rgba(255,255,255,.35);padding:0 .3em;letter-spacing:.1em}
  .ou-sec{margin-bottom:1.1em}
  .ou-sec-lbl{font-size:.72em;text-transform:uppercase;letter-spacing:.14em;color:rgba(255,255,255,.4);margin-bottom:.45em}
  .ou-row{display:flex;flex-wrap:wrap;gap:.4em}
  .ou-btn{padding:.34em .9em;border-radius:4px;border:1px solid rgba(255,255,255,.13);cursor:pointer;font-size:.8em;background:rgba(255,255,255,.05);color:#ccc;transition:all .14s}
  .ou-btn:hover,.ou-btn:focus{border-color:#e8a838;color:#e8a838;outline:none}
  .ou-btn.on{background:#e8a838;border-color:#e8a838;color:#000;font-weight:700}
  .ou-eps{display:flex;flex-wrap:wrap;gap:.35em}
  .ou-ep{width:2.7em;height:2.7em;display:flex;align-items:center;justify-content:center;border-radius:4px;border:1px solid rgba(255,255,255,.13);cursor:pointer;font-size:.82em;color:#ccc;transition:all .14s;position:relative}
  .ou-ep:hover,.ou-ep:focus{border-color:#e8a838;color:#e8a838;outline:none}
  .ou-ep.on{background:#e8a838;border-color:#e8a838;color:#000;font-weight:700}
  .ou-ep.seen{opacity:.28}
  .ou-ep.seen::after{content:'✓';position:absolute;font-size:.55em;top:1px;right:2px;color:#e8a838}
  .ou-play{display:inline-flex;align-items:center;gap:.55em;padding:.65em 1.8em;background:#e8a838;color:#000;border-radius:7px;font-weight:800;font-size:.92em;cursor:pointer;margin-top:1.1em;transition:transform .1s,box-shadow .1s;box-shadow:0 3px 16px rgba(232,168,56,.3)}
  .ou-play:hover{transform:scale(1.04);box-shadow:0 4px 24px rgba(232,168,56,.45)}
  .ou-play.eng{background:#4db8ff;box-shadow:0 3px 16px rgba(77,184,255,.3)}
  .ou-play.eng:hover{box-shadow:0 4px 24px rgba(77,184,255,.45)}
  .ou-qbadge{font-size:.63em;background:rgba(0,0,0,.25);border-radius:3px;padding:1px 5px;margin-left:.3em}
  .ou-info{font-size:.78em;color:rgba(255,255,255,.45);margin-top:.6em;line-height:1.5}
  .ou-info b{color:rgba(77,184,255,.9)}
  .ou-loader{text-align:center;padding:2.5em 1em;color:rgba(255,255,255,.4);font-size:.9em}
  .ou-spin{display:inline-block;animation:ou-spin 1s linear infinite;font-size:1.6em;margin-bottom:.4em;display:block}
  .ou-err{padding:1em 1.4em;background:rgba(255,60,60,.08);border-left:3px solid rgba(255,80,80,.6);border-radius:4px;font-size:.85em;color:#ff9999;line-height:1.5}
  .ou-subs-info{display:inline-flex;align-items:center;gap:.35em;font-size:.72em;padding:.25em .7em;border-radius:3px;background:rgba(77,184,255,.12);border:1px solid rgba(77,184,255,.3);color:#4db8ff;margin-top:.5em}
  @keyframes ou-spin{to{transform:rotate(360deg)}}
  `;
  document.head.appendChild(s);
}

/* ════════════════════════════════════════════════════════════
   КОМПОНЕНТ
════════════════════════════════════════════════════════════ */
function OnlineUltraComponent(object) {
  var card   = object.movie || object;
  var serial = isSeries(card);

  /* UI state */
  var ui = {
    srcKey:  null,
    srcData: null,
    srcInfo: null,
    season:  1,
    episode: 1,
    voice:   null,
    quality: '1080p',
    epCount: 0,
  };

  /* Restore previous choice */
  var saved = loadState(card);
  ui.srcKey = saved.srcKey || Object.keys(SOURCES)[0];
  ui.season  = saved.season  || 1;
  ui.voice   = saved.voice   || null;
  ui.quality = saved.quality || '1080p';

  /* Root element */
  var root = c('div','ou');

  this.create = function () {
    injectCSS();
    this.activity.loader(true);
    root.innerHTML = '';
    buildHeader();
    buildTabs();
    root.appendChild(c('div','','<div id="ou-body"></div>'));
    this.activity.loader(false);
    this.activity.toggle();
    startSearch(ui.srcKey);
    return root;
  };

  this.start = function () {
    var f = root.querySelector('[tabindex="0"]');
    if (f) f.focus();
  };

  this.pause   = function () {};
  this.stop    = function () {};
  this.destroy = function () { ui.srcData = null; };

  /* ── Header ─────────────────────────────────────────────── */
  function buildHeader() {
    var h = c('div','ou-head');
    h.innerHTML = '<span class="ou-title">▶ Online Ultra</span><span class="ou-count">12 источников</span>';
    root.appendChild(h);
  }

  /* ── Source tabs ─────────────────────────────────────────── */
  function buildTabs() {
    var wrap = c('div','ou-tabs');
    wrap.id  = 'ou-tabs';

    var ruKeys  = Object.keys(SOURCES).filter(function(k){return SOURCES[k].lang==='RU';});
    var engKeys = Object.keys(SOURCES).filter(function(k){return SOURCES[k].lang==='ENG';});

    ruKeys.forEach(function(k){ wrap.appendChild(makeTab(k, wrap)); });
    var sep = c('span','ou-sep','│ ENG');
    wrap.appendChild(sep);
    engKeys.forEach(function(k){ wrap.appendChild(makeTab(k, wrap)); });

    root.appendChild(wrap);
  }

  function makeTab(key, wrap) {
    var src = SOURCES[key];
    var btn = c('button', 'ou-tab' + (src.lang==='ENG'?' eng':'') + (key===ui.srcKey?' on':''));
    btn.textContent = src.icon + ' ' + src.name;
    btn.tabIndex = 0;
    btn.addEventListener('click', function () {
      ui.srcKey = key;
      wrap.querySelectorAll('.ou-tab').forEach(function(b){b.classList.remove('on');});
      btn.classList.add('on');
      startSearch(key);
      saveState(card, { srcKey: key, season: ui.season, voice: ui.voice, quality: ui.quality });
    });
    return btn;
  }

  /* ── Body area ──────────────────────────────────────────── */
  function body() { return root.querySelector('#ou-body') || root; }

  function setBody(node) {
    var b = body();
    b.innerHTML = '';
    if (typeof node === 'string') b.innerHTML = node;
    else b.appendChild(node);
  }

  function showLoader(msg) {
    setBody('<div class="ou-loader"><span class="ou-spin">⟳</span>' + (msg||'Поиск...') + '</div>');
  }

  function showError(msg) {
    setBody('<div class="ou-err">❌ ' + msg + '<br><small>Попробуйте другой источник.</small></div>');
  }

  /* ── Search ─────────────────────────────────────────────── */
  function startSearch(key) {
    var src = SOURCES[key];
    if (!src) return showError('Источник не найден');
    showLoader('Поиск в ' + src.name + '...');

    src.search(card, function (data) {
      ui.srcData = data;
      ui.srcInfo = src.getInfo(data);

      // Reset voice to first available
      if (!ui.voice || ui.srcInfo.voices.indexOf(ui.voice) < 0) {
        ui.voice = ui.srcInfo.voices[0] || null;
      }

      // Update episode count
      ui.epCount = src.getEpisodeCount(data, ui.srcInfo, ui.season, ui.voice) || 24;

      buildBody();
    }, function (err) {
      showError(src.name + ': ' + err);
    });
  }

  /* ── Build body UI ──────────────────────────────────────── */
  function buildBody() {
    var wrap  = c('div');
    var src   = SOURCES[ui.srcKey];

    /* Voice selector */
    if (src.hasVoice && ui.srcInfo.voices && ui.srcInfo.voices.length > 1) {
      wrap.appendChild(buildSection('Озвучка', buildVoiceRow()));
    }

    /* Season + Episodes (series only) */
    if (serial) {
      var nSeasons = card.number_of_seasons || (ui.srcInfo.seasons && ui.srcInfo.seasons.length) || 3;
      if (nSeasons > 1) {
        wrap.appendChild(buildSection('Сезон', buildSeasonRow(nSeasons)));
      }
      wrap.appendChild(buildSection('Серия', buildEpisodeGrid()));
    }

    /* Quality */
    if (src.hasQuality) {
      wrap.appendChild(buildSection('Качество', buildQualityRow()));
    }

    /* Subtitles info (ENG) */
    if (src.lang === 'ENG') {
      var info = c('div');
      info.innerHTML = '<div class="ou-subs-info">💬 Встроенные субтитры: <b>ENG / RU / Multi</b> (зависит от плеера)</div>';
      wrap.appendChild(info);
    }

    /* Play button */
    var playBtn = c('button', 'ou-play' + (src.lang==='ENG'?' eng':''));
    playBtn.innerHTML = '▶ Смотреть' + (src.lang==='ENG' ? '<span class="ou-qbadge">ENG</span>' : '');
    playBtn.tabIndex = 0;
    playBtn.addEventListener('click', function () { doPlay(); });
    wrap.appendChild(playBtn);

    /* Info line */
    var infoLine = c('div','ou-info');
    infoLine.innerHTML = 'Источник: <b>' + src.name + '</b>';
    if (ui.voice) infoLine.innerHTML += ' · Голос: <b>' + ui.voice + '</b>';
    if (serial) infoLine.innerHTML += ' · С' + ui.season + 'Э' + ui.episode;
    wrap.appendChild(infoLine);

    setBody(wrap);
  }

  function buildSection(label, content) {
    var s = c('div','ou-sec');
    s.appendChild(c('div','ou-sec-lbl', label));
    s.appendChild(content);
    return s;
  }

  function buildVoiceRow() {
    var row = c('div','ou-row');
    ui.srcInfo.voices.forEach(function(v) {
      var btn = c('button','ou-btn' + (v===ui.voice?' on':''), v);
      btn.tabIndex = 0;
      btn.addEventListener('click', function() {
        ui.voice = v;
        row.querySelectorAll('.ou-btn').forEach(function(b){b.classList.remove('on');});
        btn.classList.add('on');
        saveState(card, { srcKey: ui.srcKey, season: ui.season, voice: ui.voice, quality: ui.quality });
        // Refresh episode count
        var src = SOURCES[ui.srcKey];
        ui.epCount = src.getEpisodeCount(ui.srcData, ui.srcInfo, ui.season, ui.voice) || 24;
        var grid = root.querySelector('#ou-ep-grid');
        if (grid) { var newGrid = buildEpisodeGrid(); grid.innerHTML = newGrid.innerHTML; }
      });
      row.appendChild(btn);
    });
    return row;
  }

  function buildSeasonRow(n) {
    var row = c('div','ou-row');
    for (var s = 1; s <= n; s++) {
      (function(sn){
        var btn = c('button','ou-btn' + (sn===ui.season?' on':''), 'Сезон ' + sn);
        btn.tabIndex = 0;
        btn.addEventListener('click', function() {
          ui.season = sn;
          row.querySelectorAll('.ou-btn').forEach(function(b){b.classList.remove('on');});
          btn.classList.add('on');
          ui.episode = 1;
          var src = SOURCES[ui.srcKey];
          ui.epCount = src.getEpisodeCount(ui.srcData, ui.srcInfo, sn, ui.voice) || 24;
          var grid = root.querySelector('#ou-ep-grid');
          if (grid) { var ng = buildEpisodeGrid(); grid.parentNode.replaceChild(ng, grid); }
          saveState(card, { srcKey: ui.srcKey, season: ui.season, voice: ui.voice, quality: ui.quality });
        });
        row.appendChild(btn);
      })(s);
    }
    return row;
  }

  function buildEpisodeGrid() {
    var grid = c('div','ou-eps');
    grid.id  = 'ou-ep-grid';
    var count = Math.max(ui.epCount, 1);
    for (var ep = 1; ep <= count; ep++) {
      (function(epn){
        var w   = isWatched(card, ui.season, epn, ui.voice);
        var btn = c('button', 'ou-ep' + (epn===ui.episode?' on':'') + (w?' seen':''), String(epn));
        btn.tabIndex = 0;
        btn.title = 'Серия ' + epn + (w ? ' (просмотрено)':'');
        btn.addEventListener('click', function() {
          ui.episode = epn;
          grid.querySelectorAll('.ou-ep').forEach(function(b){b.classList.remove('on');});
          btn.classList.add('on');
        });
        grid.appendChild(btn);
      })(ep);
    }
    return grid;
  }

  function buildQualityRow() {
    var row = c('div','ou-row');
    ['4K','1080p','720p','480p'].forEach(function(q){
      var btn = c('button','ou-btn' + (q===ui.quality?' on':''), q);
      btn.tabIndex = 0;
      btn.addEventListener('click', function() {
        ui.quality = q;
        row.querySelectorAll('.ou-btn').forEach(function(b){b.classList.remove('on');});
        btn.classList.add('on');
        saveState(card, { srcKey: ui.srcKey, season: ui.season, voice: ui.voice, quality: q });
      });
      row.appendChild(btn);
    });
    return row;
  }

  /* ── Play ───────────────────────────────────────────────── */
  function doPlay() {
    var src    = SOURCES[ui.srcKey];
    var season = serial ? ui.season : null;
    var ep     = serial ? ui.episode : null;

    showLoader('Загрузка потока...');

    src.getStreams(ui.srcData, ui.srcInfo, season, ep, ui.voice, function (streams) {
      if (!streams || !streams.length) return showError('Потоки не найдены');

      if (serial) markWatched(card, ui.season, ui.episode, ui.voice);

      // Pick best quality
      var stream = streams[0];
      if (ui.quality && !stream.iframe) {
        streams.forEach(function(s){ if (s.quality === ui.quality) stream = s; });
      }

      var title = card.original_title || card.title || card.name || '';
      if (serial) title += ' — С' + ui.season + 'Э' + ui.episode;

      var playlist = streams.map(function(s){
        return { url: s.url, title: title + (s.quality ? ' ['+s.quality+']' : '') };
      });

      Lampa.Player.play({
        url:      stream.url,
        title:    title,
        id:       card.id,
        season:   season,
        episode:  ep,
        playlist: playlist,
      });

      // Rebuild UI after returning
      setTimeout(buildBody, 600);

    }, function (err) {
      showError(err);
    });
  }
}

/* ════════════════════════════════════════════════════════════
   РЕГИСТРАЦИЯ В LAMPA
════════════════════════════════════════════════════════════ */
function boot() {
  if (typeof Lampa === 'undefined') { setTimeout(boot, 300); return; }

  /* Компонент */
  Lampa.Component.add('online_ultra', OnlineUltraComponent);

  /* Кнопка на карточке фильма */
  Lampa.Listener.follow('full', function (e) {
    if (e.type !== 'complite') return;

    var btn = document.createElement('div');
    btn.className = 'full-start__button selector';
    btn.style.cssText = [
      'background:linear-gradient(135deg,#e8a838,#f5c842)',
      'color:#000',
      'font-weight:800',
      'display:flex',
      'align-items:center',
      'gap:.4em',
      'border-radius:6px',
    ].join(';');

    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Online Ultra';

    btn.addEventListener('click', function () {
      Lampa.Activity.push({
        url:       '',
        title:     (e.data.movie||e.data).original_title || (e.data.movie||e.data).title || (e.data.movie||e.data).name || 'Online Ultra',
        component: 'online_ultra',
        movie:     e.data.movie || e.data,
        page:      1,
      });
    });

    var container = e.object.activity.render().querySelector('.full-start__buttons');
    if (container) container.insertBefore(btn, container.firstChild);
  });

  /* Настройки */
  var proxyFields = [
    { key: 'ou_proxy_all',       name: 'Прокси — Все источники',       desc: 'Глобальный прокси (если нет специфичного)' },
    { key: 'ou_proxy_videocdn',  name: 'Прокси — VideoCDN',             desc: '' },
    { key: 'ou_proxy_collaps',   name: 'Прокси — Collaps',              desc: '' },
    { key: 'ou_proxy_hdvb',      name: 'Прокси — HDVB',                 desc: '' },
    { key: 'ou_proxy_kodik',     name: 'Прокси — Kodik',                desc: '' },
    { key: 'ou_proxy_alloha',    name: 'Прокси — Alloha',               desc: '' },
    { key: 'ou_proxy_rezka',     name: 'Прокси — Rezka/Voidboost',     desc: 'Нужен если Voidboost заблокирован' },
  ];

  proxyFields.forEach(function (f) {
    try {
      Lampa.SettingsApi.addParam({
        component: 'online_ultra',
        param: { name: f.key, type: 'input', default: '', placeholder: 'https://proxy.example.com/' },
        field: { name: f.name, description: f.desc },
        onChange: function () {},
      });
    } catch(e) {}
  });

  Lampa.Noty.show('✅ Online Ultra 2.0 готов (12 источников)');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
