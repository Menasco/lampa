/**
 * ╔════════════════════════════════════════════════════════════════════╗
 * ║                 ONLINE ULTRA · plugin for Lampa (v4)               ║
 * ║                                                                    ║
 * ║  Lampac-клиент: источники берутся с сервера-агрегатора (бэкенда),  ║
 * ║  который сам обходит 20+ балансеров (Rezka, Kodik, Filmix,         ║
 * ║  Alloha, Collaps, KinoPub, HDVB, VK, Rutube и др.).               ║
 * ║                                                                    ║
 * ║   • Много источников, и показываются только те, где фильм есть.    ║
 * ║   • HDRezka без «требуется авторизация» (её решает сервер).        ║
 * ║   • Кнопка на карточке открывает сайдбар источников → выбор        ║
 * ║     озвучки / сезона / серии.                                      ║
 * ║   • Бэкенд настраивается (Настройки → Online Ultra).               ║
 * ║                                                                    ║
 * ║  Установка: Lampa → Настройки → Расширения → добавить URL файла.   ║
 * ╚════════════════════════════════════════════════════════════════════╝
 */
(function () {
  'use strict';

  var OU = {
    version: '4.0',
    title: 'Online Ultra',
    // Lampac-бэкенд по умолчанию (тот же движок, что делает akter-black таким полным).
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

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function nav() {
    try { if (typeof Navigator !== 'undefined' && Navigator && Navigator.move) return Navigator; } catch (e) {}
    if (window.Lampa && Lampa.Navigator && Lampa.Navigator.move) return Lampa.Navigator;
    return null;
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

  // Resolve imdb_id / kinopoisk_id if the card lacks them — many balancers need them.
  function externalids(m, cb) {
    if (m.imdb_id && m.kinopoisk_id) return cb();
    var url = backend() + 'externalids?id=' + (m.id || '') + '&serial=' + (isSerial(m) ? 1 : 0) +
      (m.imdb_id ? '&imdb_id=' + m.imdb_id : '') + (m.kinopoisk_id ? '&kinopoisk_id=' + m.kinopoisk_id : '');
    api(url, function (j) {
      if (j && typeof j === 'object') for (var k in j) if (j[k]) m[k] = j[k];
      cb();
    }, cb);
  }

  // The source list ("sidebar") — only balancers that have this title.
  // NB: no life=true — that switches Lampac to async memkey-polling mode; we want the full list at once.
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

  // A data item is playable if it carries a stream (any method).
  function playable(d) { return !!(d && (d.stream || (d.method === 'play' && d.url))); }
  function streamOf(d) { return d.stream || d.url; }

  /* ═══════════════ styles ═══════════════ */

  function injectCSS() {
    if (document.getElementById('ou-style')) return;
    var s = el('style');
    s.id = 'ou-style';
    s.textContent = [
      '.ou{padding:1.5em 2em;color:#fff;font-family:inherit;max-width:1100px}',
      '.ou-head{display:flex;align-items:center;gap:.7em;margin-bottom:.4em}',
      '.ou-logo{display:inline-flex;align-items:center;justify-content:center;width:1.9em;height:1.9em;border-radius:.5em;background:linear-gradient(135deg,#e8a838,#f5c842);color:#111;font-weight:900;font-size:.9em;flex:none}',
      '.ou-h-title{font-size:1.05em;font-weight:800}',
      '.ou-crumb{font-size:.8em;color:rgba(255,255,255,.45);margin:.1em 0 1.1em;min-height:1.2em}',
      '.ou-crumb b{color:#e8a838}',
      '.ou-row{display:flex;align-items:center;gap:.9em;padding:.85em 1.1em;margin-bottom:.5em;border-radius:.6em;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06);cursor:pointer;transition:all .14s;outline:none}',
      '.ou-row.focus,.ou-row:hover,.ou-row:focus{background:rgba(232,168,56,.14);border-color:#e8a838}',
      '.ou-row-ic{width:1.9em;height:1.9em;flex:none;display:flex;align-items:center;justify-content:center;border-radius:.4em;background:rgba(255,255,255,.08);font-size:.95em}',
      '.ou-row.play .ou-row-ic{background:linear-gradient(135deg,#e8a838,#f5c842);color:#111}',
      '.ou-row-body{flex:1;min-width:0}',
      '.ou-row-title{font-size:.96em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ou-row-sub{font-size:.76em;color:rgba(255,255,255,.5);margin-top:.15em}',
      '.ou-row-badge{font-size:.68em;color:#0b0b0b;background:#5ad17a;border-radius:.35em;padding:.15em .5em;font-weight:800;flex:none}',
      '.ou-state{text-align:center;padding:3em 1em;color:rgba(255,255,255,.55)}',
      '.ou-spin{display:block;width:2.3em;height:2.3em;margin:0 auto 1em;border:.22em solid rgba(255,255,255,.15);border-top-color:#e8a838;border-radius:50%;animation:ou-rot .8s linear infinite}',
      '.ou-err-ic{font-size:2em;display:block;margin-bottom:.4em}',
      '.online-ultra-btn .ou-ic{width:1.5em;height:1.5em;margin-right:.5em}',
      '@keyframes ou-rot{to{transform:rotate(360deg)}}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ═══════════════ component ═══════════════ */

  function OnlineUltraComponent(object) {
    var movie = object.movie || object;
    var scroll, content, crumb, listbox, started = false;
    var stack = []; // navigation levels: {title, rows}

    this.create = function () {
      injectCSS();
      scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
      content = el('div', 'ou');

      var head = el('div', 'ou-head');
      head.appendChild(el('span', 'ou-logo', 'OU'));
      head.appendChild(el('span', 'ou-h-title', OU.title));
      content.appendChild(head);

      crumb = el('div', 'ou-crumb', esc(movie.title || movie.name || ''));
      content.appendChild(crumb);

      listbox = el('div');
      content.appendChild(listbox);
      scroll.append(content);

      loader('Ищу источники…');
      externalids(movie, loadSources);
      return this.render();
    };

    this.render = function () { return scroll.render(); };
    this.start = function () { started = true; setController(); };
    this.pause = function () {};
    this.stop = function () {};
    this.destroy = function () { try { scroll.destroy(); } catch (e) {} stack = []; };

    function setController() {
      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(scroll.render());
          Lampa.Controller.collectionFocus(false, scroll.render());
        },
        up: function () { var N = nav(); if (N && N.canmove('up')) N.move('up'); else Lampa.Controller.toggle('head'); },
        down: function () { var N = nav(); if (N) N.move('down'); },
        left: function () { var N = nav(); if (N && N.canmove('left')) N.move('left'); else Lampa.Controller.toggle('menu'); },
        right: function () { var N = nav(); if (N) N.move('right'); },
        back: goBack
      });
      Lampa.Controller.toggle('content');
    }

    function goBack() {
      if (stack.length > 1) { stack.pop(); render(stack[stack.length - 1]); }
      else Lampa.Activity.backward();
    }

    function refocus() {
      if (!started) return;
      try {
        if (Lampa.Controller.enabled && Lampa.Controller.enabled().name !== 'content') return;
        Lampa.Controller.collectionSet(scroll.render());
        Lampa.Controller.collectionFocus(false, scroll.render());
      } catch (e) {}
    }

    function loader(msg) {
      listbox.innerHTML = '<div class="ou-state"><span class="ou-spin"></span>' + esc(msg) + '</div>';
    }

    function errorState(msg) {
      listbox.innerHTML = '<div class="ou-state"><span class="ou-err-ic">⚠️</span>' + esc(msg) + '</div>';
    }

    function setCrumb() {
      var names = stack.map(function (l) { return l.title; });
      crumb.innerHTML = esc(movie.title || movie.name || '') +
        (names.length ? ' · <b>' + names.map(esc).join('</b> › <b>') + '</b>' : '');
    }

    /* ---- level 0: sources ---- */
    function loadSources() {
      loader('Ищу источники…');
      events(movie, function (list) {
        if (!list.length) return errorState('Ни один источник не нашёл этот фильм. Попробуйте сменить бэкенд в настройках.');
        var rows = list.map(function (src) {
          return {
            play: false,
            title: src.name || src.balanser,
            sub: 'источник',
            onSelect: function () { openUrl(sourceUrl(src.url, movie), src.name || src.balanser); }
          };
        });
        push({ title: null, rows: rows, header: 'Источники' });
      }, function () {
        errorState('Бэкенд недоступен. Проверьте интернет или смените бэкенд в настройках.');
      });
    }

    /* ---- drill into a source / folder ---- */
    function openUrl(url, title) {
      loader('Загружаю «' + esc(title) + '»…');
      pushPending(title);
      openLampac(url, function (res) {
        if (!res.data.length) return dropPending('В этом источнике пусто — вернитесь назад и выберите другой.');
        var rows = res.data.map(function (d) { return rowFromData(d); });
        replacePending(rows);
      }, function () {
        dropPending('Источник не ответил — вернитесь назад и выберите другой.');
      });
    }

    function rowFromData(d) {
      var isPlay = playable(d);
      var title = d.title || d.name || d.translate || d.voice_name || 'Смотреть';
      var subParts = [];
      if (d.translate && d.translate !== title) subParts.push(d.translate);
      if (d.voice_name && d.voice_name !== title) subParts.push(d.voice_name);
      var q = d.maxquality || d.quality;
      if (q && typeof q === 'string') subParts.push(q);
      return {
        play: isPlay,
        title: title,
        sub: subParts.join(' · '),
        badge: (isPlay && q && typeof q === 'string') ? q : null,
        data: d,
        onSelect: function () {
          if (isPlay) doPlay(d);
          else if (d.url) openUrl(withRjson(absolute(d.url)), d.name || d.title || title);
        }
      };
    }

    // Deeper urls from Lampac are absolute; keep as-is.
    function absolute(url) { return url; }

    /* ---- play ---- */
    function doPlay(d) {
      var url = streamOf(d);
      if (!url) return;
      var lvl = stack[stack.length - 1];
      var siblings = (lvl ? lvl.rows : []).filter(function (r) { return r.play && r.data; });
      var playlist = siblings.map(function (r) {
        return { url: streamOf(r.data), title: r.title, quality: qualityObj(r.data) };
      });
      var element = {
        url: url,
        title: playTitle(d),
        quality: qualityObj(d),
        isonline: true
      };
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

    function qualityObj(d) {
      // Lampac may provide a {quality:url} map; pass through if object, else let player auto-pick.
      if (d && d.quality && typeof d.quality === 'object') return d.quality;
      return false;
    }

    function playTitle(d) {
      var t = movie.title || movie.name || '';
      var v = d.translate || d.voice_name;
      if (v && String(t).indexOf(v) < 0) t += ' · ' + v;
      return t;
    }

    /* ---- level stack + render ---- */
    function push(level) { stack.push(level); render(level); }

    // pending = show a level immediately (loader already up); filled by replacePending.
    var pendingTitle = null;
    function pushPending(title) { pendingTitle = title; }
    function replacePending(rows) {
      stack.push({ title: pendingTitle, rows: rows });
      pendingTitle = null;
      render(stack[stack.length - 1]);
    }
    function dropPending(msg) { pendingTitle = null; errorState(msg); }

    function render(level) {
      setCrumb();
      listbox.innerHTML = '';
      level.rows.forEach(function (r) { listbox.appendChild(makeRow(r)); });
      refocus();
    }

    function makeRow(r) {
      var row = el('div', 'ou-row selector' + (r.play ? ' play' : ''));
      row.tabIndex = 0;
      var ic = r.play
        ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
      row.appendChild(el('div', 'ou-row-ic', ic));
      var body = el('div', 'ou-row-body');
      body.appendChild(el('div', 'ou-row-title', esc(r.title)));
      if (r.sub) body.appendChild(el('div', 'ou-row-sub', esc(r.sub)));
      row.appendChild(body);
      if (r.badge) row.appendChild(el('div', 'ou-row-badge', esc(r.badge)));

      var busy = false;
      var run = function () { if (busy) return; busy = true; setTimeout(function () { busy = false; }, 700); r.onSelect(); };
      if (window.$) { try { window.$(row).on('hover:enter', run); } catch (e) { row.addEventListener('click', run); } }
      else row.addEventListener('click', run);
      return row;
    }
  }

  /* ═══════════════ card button (clean, native-styled) ═══════════════ */

  function addButton(e) {
    if (e.type !== 'complite' || !e.object) return;
    var render = e.object.activity.render();
    var $ = window.$;
    if (!$ || !render || !render.find) return;
    if (render.find('.online-ultra-btn').length) return;

    var svg = '<svg class="ou-ic" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    var btn = $('<div class="full-start__button selector view--online online-ultra-btn">' + svg + 'Online Ultra</div>');

    btn.on('hover:enter', function () { openUltra(e.data.movie); });

    var box = render.find('.full-start-new__buttons').first();
    if (!box.length) box = render.find('.full-start__buttons').first();
    if (box.length) box.append(btn);
    else { var t = render.find('.view--torrent'); if (t.length) t.after(btn); }
  }

  function openUltra(card) {
    try {
      L().Activity.push({ url: '', title: OU.title, component: 'online_ultra', movie: card, page: 1 });
    } catch (e) { notify('Не удалось открыть Online Ultra'); }
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
    try { La.Component.add('online_ultra', OnlineUltraComponent); } catch (e) {}
    addSettings();
    La.Listener.follow('full', addButton);
    notify('✅ ' + OU.title + ' ' + OU.version + ' готов');
  }

  function waitLampa() {
    if (window.Lampa && Lampa.Listener && Lampa.Component && Lampa.Activity && Lampa.Storage && Lampa.Scroll) {
      try { boot(); } catch (e) { console.error('[OnlineUltra] boot error', e); }
    } else setTimeout(waitLampa, 200);
  }

  waitLampa();
})();
