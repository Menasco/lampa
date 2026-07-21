/**
 * ╔════════════════════════════════════════════════════════════════════╗
 * ║                 ONLINE ULTRA · plugin for Lampa (v5)               ║
 * ║                                                                    ║
 * ║  Lampac-клиент с нативным интерфейсом Lampa:                       ║
 * ║   • Кнопка на карточке открывает нативный сайдбар «Источник»       ║
 * ║     (Lampa.Select) — как у online_mod / BwaRC.                     ║
 * ║   • Выбор источника → сезон/серия → озвучка идёт нативными         ║
 * ║     боковыми меню (справа), без кривых папок и своего скролла.     ║
 * ║   • Источники берутся с Lampac-бэкенда (по умолчанию akter-black), ║
 * ║     20+ балансеров, только те, где фильм реально есть.             ║
 * ║                                                                    ║
 * ║  Настройка бэкенда: Настройки → Online Ultra.                     ║
 * ╚════════════════════════════════════════════════════════════════════╝
 */
(function () {
  'use strict';

  var OU = {
    version: '5.0',
    title: 'Online Ultra',
    backend_default: 'https://akter-black.com/'
  };

  /* ═══════════════ helpers ═══════════════ */

  function L() { return window.Lampa; }
  function get(k, d) { try { return L().Storage.get(k, d); } catch (e) { return d; } }
  function notify(m) { try { L().Noty.show(m); } catch (e) {} }

  function backend() {
    var b = (get('ou_backend', OU.backend_default) || OU.backend_default).trim();
    if (b.slice(-1) !== '/') b += '/';
    return b;
  }

  /* ═══════════════ networking (JSON) ═══════════════ */

  function api(url, done, fail) {
    if (window.Lampa && Lampa.Reguest) {
      try {
        var n = new Lampa.Reguest();
        if (n.timeout) n.timeout(20000);
        n.native(url, function (j) {
          if (typeof j === 'string') { try { j = JSON.parse(j); } catch (e) {} }
          done(j);
        }, function () { fetchApi(url, done, fail); }, false, { dataType: 'json' });
        return;
      } catch (e) {}
    }
    fetchApi(url, done, fail);
  }

  function fetchApi(url, done, fail) {
    try {
      fetch(url).then(function (r) { return r.json(); }).then(done).catch(function () { fail && fail(); });
    } catch (e) { fail && fail(); }
  }

  /* ═══════════════ Lampac API ═══════════════ */

  function isSerial(m) { return !!(m.name || m.number_of_seasons || m.first_air_date || m.seasons); }

  function yearOf(m) {
    var d = m.release_date || m.first_air_date || '';
    if (d) return String(d).slice(0, 4);
    return m.year || '';
  }

  function baseQuery(m) {
    var q = ['id=' + (m.id || '')];
    q.push('serial=' + (isSerial(m) ? 1 : 0));
    if (m.imdb_id) q.push('imdb_id=' + m.imdb_id);
    if (m.kinopoisk_id) q.push('kinopoisk_id=' + m.kinopoisk_id);
    q.push('title=' + encodeURIComponent(m.title || m.name || ''));
    q.push('original_title=' + encodeURIComponent(m.original_title || m.original_name || ''));
    var y = yearOf(m);
    if (y) q.push('year=' + y);
    if (m.original_language) q.push('original_language=' + m.original_language);
    return q.join('&');
  }

  function externalids(m, cb) {
    if (m.imdb_id && m.kinopoisk_id) return cb();
    var url = backend() + 'externalids?id=' + (m.id || '') + '&serial=' + (isSerial(m) ? 1 : 0) +
      (m.imdb_id ? '&imdb_id=' + m.imdb_id : '') + (m.kinopoisk_id ? '&kinopoisk_id=' + m.kinopoisk_id : '');
    api(url, function (j) {
      if (j && typeof j === 'object') for (var k in j) if (j[k]) m[k] = j[k];
      cb();
    }, cb);
  }

  function events(m, done, fail) {
    api(backend() + 'lite/events?' + baseQuery(m), function (list) {
      done(Array.isArray(list) ? list : []);
    }, fail);
  }

  function withRjson(url) {
    if (/rjson=/i.test(url)) return url;
    return url + (url.indexOf('?') > -1 ? '&' : '?') + 'rjson=true';
  }
  function sourceUrl(baseUrl, m) {
    return baseUrl + (baseUrl.indexOf('?') > -1 ? '&' : '?') + baseQuery(m) + '&rjson=true';
  }
  function openLampac(url, done, fail) {
    api(withRjson(url), function (res) {
      var data = res && (res.data || (Array.isArray(res) ? res : null));
      done({ type: (res && res.type) || '', data: Array.isArray(data) ? data : [] });
    }, fail);
  }

  function playable(d) { return !!(d && (d.stream || (d.method === 'play' && d.url))); }
  function streamOf(d) { return d.stream || d.url; }

  function levelTitle(res, fallback) {
    var t = res.type || '';
    if (t === 'season') return 'Сезон';
    if (t === 'episode' || t === 'serial') return 'Серия';
    if (t === 'movie' || t === 'voice') return 'Озвучка';
    return fallback || 'Выбор';
  }

  /* ═══════════════ navigation flow (native Lampa.Select menus) ═══════════════ */

  function OnlineUltraFlow(movie) {
    var rootController = 'full_start';
    try { rootController = L().Controller.enabled().name; } catch (e) {}
    var backstack = [];

    function play(d, siblings) {
      var url = streamOf(d);
      if (!url) return notify('Нет потока');
      var playlist = (siblings || []).filter(playable).map(function (s) {
        return { url: streamOf(s), title: playTitle(s) };
      });
      var element = { url: url, title: playTitle(d), isonline: true };
      if (playlist.length > 1) element.playlist = playlist;
      try {
        var hash = L().Utils.hash(movie.id + '_' + (movie.original_title || movie.title || movie.name || ''));
        if (L().Timeline) element.timeline = L().Timeline.view(hash);
      } catch (e) {}
      try {
        L().Player.play(element);
        if (playlist.length > 1) L().Player.playlist(playlist);
      } catch (e) {
        try { L().Player.play({ url: url, title: playTitle(d) }); } catch (e2) {}
      }
    }

    function playTitle(d) {
      var t = movie.title || movie.name || '';
      var v = d.translate || d.voice_name;
      if (v && String(t).indexOf(v) < 0) t += ' · ' + v;
      return t;
    }

    function itemTitle(d) {
      if (playable(d)) return d.translate || d.voice_name || d.title || d.name || 'Смотреть';
      return d.name || d.title || d.translate || 'Открыть';
    }
    function itemSub(d) {
      var parts = [];
      var q = d.maxquality || d.quality;
      if (q && typeof q === 'string') parts.push(q);
      if (playable(d) && d.voice_name && d.voice_name !== itemTitle(d)) parts.push(d.voice_name);
      return parts.join(' · ');
    }

    // Show one Select level. `items` = raw Lampac data objects (or synthetic source items with _url).
    function showLevel(title, items) {
      var siblings = items.filter(function (d) { return !d._source; });
      var menu = items.map(function (d) {
        return {
          title: d._source ? d._source : itemTitle(d),
          subtitle: d._source ? 'источник' : itemSub(d),
          _data: d
        };
      });
      var reopen = function () {
        L().Select.show({
          title: title,
          items: menu,
          onBack: onBackLevel,
          onSelect: function (chosen) {
            var d = chosen._data;
            if (d._url) return drill(d._url, d._source || itemTitle(d));
            if (playable(d)) return play(d, siblings);
            if (d.url) return drill(d.url, itemTitle(d));
            notify('Нечего открыть');
          }
        });
      };
      backstack.push(reopen);
      reopen();
    }

    function onBackLevel() {
      backstack.pop();
      if (backstack.length) backstack[backstack.length - 1]();
      else { try { L().Controller.toggle(rootController); } catch (e) {} }
    }

    function drill(url, fallbackTitle) {
      notify('Загрузка…');
      openLampac(url, function (res) {
        if (!res.data.length) return notify('В этом источнике пусто — назад и выберите другой');
        showLevel(levelTitle(res, fallbackTitle), res.data);
      }, function () { notify('Источник не ответил — назад и выберите другой'); });
    }

    this.open = function () {
      notify('Ищу источники…');
      externalids(movie, function () {
        events(movie, function (list) {
          if (!list.length) return notify('Ни один источник не нашёл этот фильм');
          var items = list.map(function (s) {
            return { _source: s.name || s.balanser, _url: sourceUrl(s.url, movie) };
          });
          showLevel('Источник', items);
        }, function () { notify('Бэкенд недоступен — проверьте адрес в настройках'); });
      });
    };
  }

  /* ═══════════════ card button ═══════════════ */

  function addButton(e) {
    if (e.type !== 'complite' || !e.object) return;
    var render = e.object.activity.render();
    var $ = window.$;
    if (!$ || !render || !render.find) return;
    if (render.find('.online-ultra-btn').length) return;

    // data-subtitle makes Lampa's card fold this into the native «Источник» menu
    // (like online_mod / BwaRC), instead of showing it as a separate inline button.
    var btn = $('<div class="full-start__button selector view--online online-ultra-btn" data-subtitle="' + OU.title + ' ' + OU.version + '">' +
      '<svg class="ou-ic" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="margin-right:.5em"><path d="M8 5v14l11-7z"/></svg>' +
      '<span>' + OU.title + '</span></div>');

    btn.on('hover:enter', function () {
      try { new OnlineUltraFlow(e.data.movie).open(); }
      catch (err) { notify('Ошибка Online Ultra'); console.error(err); }
    });

    var box = render.find('.full-start-new__buttons').first();
    if (!box.length) box = render.find('.full-start__buttons').first();
    if (box.length) box.append(btn);
    else { var t = render.find('.view--torrent'); if (t.length) t.after(btn); }
  }

  /* ═══════════════ settings ═══════════════ */

  function addSettings() {
    var La = L();
    if (!La.SettingsApi) return;
    try {
      La.SettingsApi.addComponent({
        component: 'online_ultra',
        name: OU.title,
        icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
      });
    } catch (e) {}
    try {
      La.SettingsApi.addParam({
        component: 'online_ultra',
        param: { name: 'ou_backend', type: 'input', default: OU.backend_default },
        field: { name: 'Бэкенд источников (Lampac)', description: 'Сервер-агрегатор балансеров. По умолчанию akter-black. Можно указать свой Lampac.' }
      });
    } catch (e) {}
  }

  /* ═══════════════ boot ═══════════════ */

  function boot() {
    var La = L();
    addSettings();
    La.Listener.follow('full', addButton);
    notify('✅ ' + OU.title + ' ' + OU.version + ' готов');
  }

  function waitLampa() {
    if (window.Lampa && Lampa.Listener && Lampa.Activity && Lampa.Storage && Lampa.Select && Lampa.Controller) {
      try { boot(); } catch (e) { console.error('[OnlineUltra] boot error', e); }
    } else setTimeout(waitLampa, 200);
  }

  waitLampa();
})();
