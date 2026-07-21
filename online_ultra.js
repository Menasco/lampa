/**
 * ╔════════════════════════════════════════════════════════════════════╗
 * ║                    ONLINE ULTRA · plugin for Lampa                 ║
 * ║                                                                    ║
 * ║  Умный фронт над проверенным движком онлайн-балансеров.            ║
 * ║                                                                    ║
 * ║   • Свой быстрый источник Collaps — фильмы играются напрямую       ║
 * ║     (прямой .m3u8, все озвучки как аудиодорожки в плеере).         ║
 * ║   • Сериалы и «все источники» — через движок online_mod           ║
 * ║     (21 балансер, сам обновляется, корректные сезоны/серии).       ║
 * ║   • Нерабочие источники не показываются: если Collaps ничего       ║
 * ║     не нашёл — вкладка просто не появится.                         ║
 * ║   • Прокси настраивается (по умолчанию: прямой + авто-фолбэк).     ║
 * ║                                                                    ║
 * ║  Установка: Lampa → Настройки → Расширения → добавить URL этого    ║
 * ║  файла. Плагин сам подтянет движок при первом запуске.            ║
 * ╚════════════════════════════════════════════════════════════════════╝
 */
(function () {
  'use strict';

  var OU = {
    version: '3.0',
    title: 'Online Ultra',
    // Проверенный движок online_mod (nb557) — 21 балансер, авто-обновляется.
    engine_url_default: 'https://nb557.github.io/plugins/online_mod.js',
    // Собственный источник Collaps (bhcesh) — прямой поток, проверено рабочий.
    collaps_api: 'https://api.bhcesh.me/franchise/details',
    collaps_token_default: 'eedefb541aeba871dcfc756e6b31c02e',
    // CORS-прокси (используются как фолбэк на web, где прямой запрос режет CORS).
    proxies: [
      'https://cors.nb557.workers.dev/?url=',
      'https://cors557.deno.dev/?url=',
      'https://api.apbugall.org/?url='
    ]
  };

  /* ═══════════════ storage / helpers ═══════════════ */

  function L() { return window.Lampa; }
  function get(k, d) { try { return L().Storage.get(k, d); } catch (e) { return d; } }
  function set(k, v) { try { L().Storage.set(k, v); } catch (e) {} }
  function token() { return get('ou_collaps_token', OU.collaps_token_default) || OU.collaps_token_default; }
  function engineUrl() { return get('ou_engine_url', OU.engine_url_default) || OU.engine_url_default; }

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

  function notify(msg) { try { L().Noty.show(msg); } catch (e) {} }

  /* ═══════════════ networking (native on TV, fetch/proxy fallback on web) ═══════════════ */

  function proxied(url, index) {
    var p = OU.proxies[index] || OU.proxies[0];
    return p + encodeURIComponent(url);
  }

  // Build the ordered list of URLs to try for one logical request.
  function attempts(url) {
    var mode = get('ou_proxy', '0'); // 0 = direct first, 1..3 = proxy N first
    var list = [];
    if (mode === '0') {
      list.push(url);
      list.push(proxied(url, 0)); // auto-fallback through a proxy if direct is blocked / CORS
    } else {
      var idx = parseInt(mode, 10) - 1;
      list.push(proxied(url, idx));
      list.push(url); // then direct
    }
    return list;
  }

  function requestOnce(url, asText, ok, err) {
    // Prefer Lampa's native request layer — on Android TV it bypasses browser CORS.
    if (window.Lampa && Lampa.Reguest) {
      try {
        var net = new Lampa.Reguest();
        if (net.timeout) net.timeout(20000);
        net.native(url, function (r) { ok(r); }, function () { fetchFallback(); }, false, asText ? { dataType: 'text' } : {});
        return;
      } catch (e) { /* fall through */ }
    }
    fetchFallback();

    function fetchFallback() {
      try {
        fetch(url).then(function (r) { return asText ? r.text() : r.json(); }).then(ok).catch(function () { err(); });
      } catch (e) { err(); }
    }
  }

  function request(url, asText, done, fail) {
    var urls = attempts(url);
    var i = 0;
    (function next() {
      if (i >= urls.length) return fail && fail('net');
      requestOnce(urls[i++], asText, function (r) { done(r); }, next);
    })();
  }

  /* ═══════════════ Collaps (bhcesh) — verified working source ═══════════════ */

  var Collaps = {
    // Build the id query Collaps accepts: imdb_id WITHOUT tt, or kinopoisk_id.
    idParam: function (card) {
      if (card.imdb_id) return 'imdb_id=' + String(card.imdb_id).replace(/^tt/i, '');
      if (card.kinopoisk_id) return 'kinopoisk_id=' + card.kinopoisk_id;
      if (card.kp_id) return 'kinopoisk_id=' + card.kp_id;
      return '';
    },

    lookup: function (card, done, fail) {
      var idp = this.idParam(card);
      if (!idp) return fail('noid');
      var url = OU.collaps_api + '?token=' + encodeURIComponent(token()) + '&' + idp;
      request(url, false, function (d) {
        if (d && d.id && d.type && d.name && d.name !== 'Not Found' && d.name !== 'Bad Request') done(d);
        else fail('notfound');
      }, function () { fail('net'); });
    },

    // Extract the direct .m3u8 from a movie embed page (all dubs are audio tracks inside it).
    movieStream: function (data, done, fail) {
      var embed = data.iframe_url;
      if (!embed) return fail('noembed');
      request(embed, true, function (html) {
        var m = /hls\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i.exec(html) ||
                /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i.exec(html);
        if (m && m[1]) done(m[1]);
        else fail('nostream');
      }, function () { fail('net'); });
    }
  };

  /* ═══════════════ Engine (online_mod) auto-loader ═══════════════ */

  var Engine = {
    requested: false,

    present: function () {
      if (window.__ou_engine_ready) return true;
      // The engine keeps a "last balancer" key and registers its own online button.
      try {
        if (L().Storage.get('online_mod_balanser', false)) return true;
        if (L().Storage.get('online_mod_last_balanser', false)) return true;
      } catch (e) {}
      return !!document.querySelector('script[src*="online_mod"]');
    },

    load: function (cb) {
      if (this.present()) { window.__ou_engine_ready = true; return cb && cb(true); }
      if (get('ou_engine', '1') !== '1') return cb && cb(false);
      if (this.requested) { // already loading — poll briefly
        var tries = 0, self = this;
        var iv = setInterval(function () {
          if (self.present() || ++tries > 40) { clearInterval(iv); cb && cb(self.present()); }
        }, 250);
        return;
      }
      this.requested = true;
      var s = document.createElement('script');
      s.src = engineUrl();
      s.async = true;
      s.onload = function () { window.__ou_engine_ready = true; setTimeout(function () { cb && cb(true); }, 400); };
      s.onerror = function () { cb && cb(false); };
      (document.body || document.head).appendChild(s);
    },

    open: function (card) {
      this.load(function (ok) {
        if (!ok) { notify('Не удалось загрузить движок источников. Проверьте интернет/прокси.'); return; }
        try {
          L().Activity.push({
            url: '',
            title: 'Online',
            component: 'online_mod',
            search: card.title || card.name,
            search_one: card.title || card.name,
            search_two: card.original_title || card.original_name,
            movie: card,
            page: 1
          });
        } catch (e) {
          notify('Движок загружается, попробуйте ещё раз через пару секунд.');
        }
      });
    },

    // One-time, non-destructive defaults tuned for "abroad, no VPN".
    tune: function () {
      if (get('ou_tuned', '') === OU.version) return;
      try {
        if (get('online_mod_save_last_balanser', null) === null) set('online_mod_save_last_balanser', true);
        if (!get('online_mod_balanser', '')) set('online_mod_balanser', 'collaps');
        set('ou_tuned', OU.version);
      } catch (e) {}
    }
  };

  /* ═══════════════ styles ═══════════════ */

  function injectCSS() {
    if (document.getElementById('ou-style')) return;
    var s = el('style');
    s.id = 'ou-style';
    s.textContent = [
      '.ou{padding:2em 2.4em;color:#fff;font-family:inherit;max-width:1100px}',
      '.ou-head{display:flex;align-items:center;gap:.7em;margin-bottom:1.5em;padding-bottom:1em;border-bottom:1px solid rgba(255,255,255,.08)}',
      '.ou-logo{display:inline-flex;align-items:center;justify-content:center;width:2.1em;height:2.1em;border-radius:.55em;background:linear-gradient(135deg,#e8a838,#f5c842);color:#111;font-weight:900;flex:none;box-shadow:0 4px 18px rgba(232,168,56,.35)}',
      '.ou-h-title{font-size:1.15em;font-weight:800;letter-spacing:.02em}',
      '.ou-h-sub{font-size:.72em;color:rgba(255,255,255,.45);margin-top:.15em}',
      '.ou-card{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:.8em;padding:1.3em 1.4em;margin-bottom:1.1em}',
      '.ou-src{display:flex;align-items:center;gap:.7em;margin-bottom:.2em}',
      '.ou-src-name{font-weight:700;font-size:1em}',
      '.ou-ok{font-size:.66em;font-weight:800;color:#0b0b0b;background:#5ad17a;border-radius:.4em;padding:.2em .55em;letter-spacing:.04em}',
      '.ou-badge{font-size:.66em;color:rgba(255,255,255,.75);background:rgba(255,255,255,.08);border-radius:.4em;padding:.2em .55em}',
      '.ou-lbl{font-size:.7em;text-transform:uppercase;letter-spacing:.14em;color:rgba(255,255,255,.4);margin:1.1em 0 .55em}',
      '.ou-chips{display:flex;flex-wrap:wrap;gap:.45em}',
      '.ou-chip{padding:.4em 1em;border-radius:.5em;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#dcdcdc;font-size:.84em;cursor:pointer;transition:all .15s;outline:none}',
      '.ou-chip:hover,.ou-chip:focus{border-color:#e8a838;color:#fff;background:rgba(232,168,56,.12)}',
      '.ou-chip.on{background:#e8a838;border-color:#e8a838;color:#111;font-weight:700}',
      '.ou-eps{display:flex;flex-wrap:wrap;gap:.4em}',
      '.ou-ep{width:2.9em;height:2.9em;display:flex;align-items:center;justify-content:center;border-radius:.5em;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#dcdcdc;font-size:.86em;cursor:pointer;transition:all .15s;outline:none}',
      '.ou-ep:hover,.ou-ep:focus{border-color:#e8a838;color:#fff}',
      '.ou-ep.on{background:#e8a838;border-color:#e8a838;color:#111;font-weight:700}',
      '.ou-actions{display:flex;flex-wrap:wrap;gap:.7em;margin-top:1.4em}',
      '.ou-btn{display:inline-flex;align-items:center;gap:.5em;padding:.75em 1.7em;border-radius:.6em;font-size:.92em;font-weight:800;cursor:pointer;transition:transform .1s,box-shadow .1s,background .15s;outline:none;border:1px solid transparent}',
      '.ou-btn.primary{background:linear-gradient(135deg,#e8a838,#f5c842);color:#111;box-shadow:0 4px 18px rgba(232,168,56,.32)}',
      '.ou-btn.primary:hover,.ou-btn.primary:focus{transform:translateY(-1px);box-shadow:0 7px 24px rgba(232,168,56,.45)}',
      '.ou-btn.ghost{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.14);color:#eaeaea}',
      '.ou-btn.ghost:hover,.ou-btn.ghost:focus{border-color:#e8a838;color:#fff;background:rgba(232,168,56,.1)}',
      '.ou-note{font-size:.78em;color:rgba(255,255,255,.5);line-height:1.55;margin-top:1em}',
      '.ou-note b{color:#e8a838}',
      '.ou-state{text-align:center;padding:3em 1em;color:rgba(255,255,255,.55)}',
      '.ou-spin{display:block;width:2.4em;height:2.4em;margin:0 auto 1em;border:.22em solid rgba(255,255,255,.15);border-top-color:#e8a838;border-radius:50%;animation:ou-rot .8s linear infinite}',
      '.ou-err-ic{font-size:2.2em;display:block;margin-bottom:.4em}',
      '.online-ultra-btn .ou-ic{width:1.4em;height:1.4em;margin-right:.45em}',
      '@keyframes ou-rot{to{transform:rotate(360deg)}}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ═══════════════ main component (my UI) ═══════════════ */

  function nav() {
    try { if (typeof Navigator !== 'undefined' && Navigator && Navigator.move) return Navigator; } catch (e) {}
    if (window.Lampa && Lampa.Navigator && Lampa.Navigator.move) return Lampa.Navigator;
    return null;
  }

  function OnlineUltraComponent(object) {
    var card = object.movie || object;
    var state = { data: null };
    var scroll, content, started = false;
    var comp = this;

    this.create = function () {
      injectCSS();
      scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
      try { scroll.render().addClass && scroll.render().addClass('ou-scroll'); } catch (e) {}
      content = el('div', 'ou');
      content.appendChild(header());
      var b = el('div');
      b.id = 'ou-body';
      content.appendChild(b);
      scroll.append(content);
      showLoader('Проверяю источники…');
      lookup();
      return this.render();
    };

    this.render = function () { return scroll.render(); };

    this.start = function () {
      started = true;
      setController();
    };

    this.pause = function () {};
    this.stop = function () {};
    this.destroy = function () {
      state.data = null;
      try { scroll.destroy(); } catch (e) {}
    };

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
        back: function () { Lampa.Activity.backward(); }
      });
      Lampa.Controller.toggle('content');
    }

    function header() {
      var h = el('div', 'ou-head');
      var name = esc(card.title || card.name || '');
      h.appendChild(el('span', 'ou-logo', 'OU'));
      var box = el('div');
      box.appendChild(el('div', 'ou-h-title', OU.title));
      box.appendChild(el('div', 'ou-h-sub', name + (card.year ? ' · ' + card.year : '')));
      h.appendChild(box);
      return h;
    }

    function body() { return content.querySelector('#ou-body'); }

    function setBody(node) {
      var b = body();
      b.innerHTML = '';
      if (typeof node === 'string') b.innerHTML = node;
      else b.appendChild(node);
      refocus();
    }

    function refocus() {
      if (!started) return;
      try {
        // Don't steal focus while another screen (e.g. the player) is active.
        if (Lampa.Controller.enabled && Lampa.Controller.enabled().name !== 'content') return;
        Lampa.Controller.collectionSet(scroll.render());
        Lampa.Controller.collectionFocus(false, scroll.render());
      } catch (e) {}
    }

    // One button helper — binds Lampa's hover:enter (remote + mouse) once, guarded against double-fire.
    function mkBtn(cls, label, cb) {
      var b = el('div', 'ou-btn ' + cls + ' selector');
      b.tabIndex = 0;
      b.innerHTML = esc(label);
      var busy = false;
      var run = function () {
        if (busy) return;
        busy = true;
        setTimeout(function () { busy = false; }, 700);
        cb();
      };
      if (window.$) { try { window.$(b).on('hover:enter', run); } catch (e) { b.addEventListener('click', run); } }
      else b.addEventListener('click', run);
      return b;
    }

    function showLoader(msg) {
      setBody('<div class="ou-state"><span class="ou-spin"></span>' + esc(msg) + '</div>');
    }

    function showEngineOnly(msg) {
      var wrap = el('div');
      wrap.appendChild(el('div', 'ou-state', '<span class="ou-err-ic">🔎</span>' + esc(msg)));
      var act = el('div', 'ou-actions');
      act.style.justifyContent = 'center';
      act.appendChild(engineButton('🎬 Открыть все источники (движок)'));
      wrap.appendChild(act);
      setBody(wrap);
    }

    function engineButton(label) {
      return mkBtn('ghost', label, function () { Engine.open(card); });
    }

    /* ---- lookup ---- */
    function lookup() {
      Collaps.lookup(card, function (data) {
        state.data = data;
        if (data.type === 'film' || data.type === 'movie') buildMovie(data);
        else buildSeries(data);
      }, function (reason) {
        // Health-filter: Collaps has nothing → don't show a broken source, offer the engine.
        showEngineOnly(reason === 'noid'
          ? 'Не удалось определить ID фильма. Откройте полный движок источников.'
          : 'В быстром источнике (Collaps) не найдено. Полный движок проверит остальные 20 балансеров.');
      });
    }

    /* ---- movie UI ---- */
    function buildMovie(data) {
      var wrap = el('div');

      var srcCard = el('div', 'ou-card');
      var src = el('div', 'ou-src');
      src.appendChild(el('span', 'ou-src-name', 'Collaps'));
      src.appendChild(el('span', 'ou-ok', '✓ РАБОТАЕТ'));
      if (data.quality) src.appendChild(el('span', 'ou-badge', esc(data.quality)));
      srcCard.appendChild(src);

      var voices = data.voiceActing || [];
      if (voices.length) {
        srcCard.appendChild(el('div', 'ou-lbl', 'Озвучки в этом файле (' + voices.length + ')'));
        var chips = el('div', 'ou-chips');
        voices.slice(0, 24).forEach(function (v) {
          chips.appendChild(el('span', 'ou-chip', esc(v)));
        });
        srcCard.appendChild(chips);
        srcCard.appendChild(el('div', 'ou-note', 'Все дорожки уже внутри потока — <b>переключаются в плеере</b> кнопкой «Аудио».'));
      }
      wrap.appendChild(srcCard);

      var act = el('div', 'ou-actions');
      act.appendChild(mkBtn('primary', '▶ Смотреть', function () { playMovie(data); }));
      act.appendChild(engineButton('🎬 Другие источники'));
      wrap.appendChild(act);

      setBody(wrap);
    }

    function playMovie(data) {
      showLoader('Получаю поток…');
      Collaps.movieStream(data, function (url) {
        var title = card.title || card.name || data.name;
        var play = { url: url, title: title, quality: false, id: card.id };
        try {
          var hash = L().Utils.hash(card.id + '_' + (card.original_title || card.title || data.name));
          if (L().Timeline) play.timeline = L().Timeline.view(hash);
        } catch (e) {}
        try { L().Player.play(play); }
        catch (e) { try { L().Player.play({ url: url, title: title }); } catch (e2) {} }
        buildMovie(data); // restore UI behind the player
      }, function () {
        // Extraction failed (e.g. balancer changed) — never show a broken source, hand to engine.
        var wrap = el('div');
        wrap.appendChild(el('div', 'ou-state', '<span class="ou-err-ic">⚠️</span>Быстрый поток недоступен для этого фильма.'));
        var act = el('div', 'ou-actions'); act.style.justifyContent = 'center';
        act.appendChild(engineButton('🎬 Открыть все источники (движок)'));
        wrap.appendChild(act);
        setBody(wrap);
      });
    }

    /* ---- series UI (browse from Collaps, play via engine) ---- */
    function buildSeries(data) {
      var wrap = el('div');
      var seasons = (data.seasons || []).filter(function (s) { return s && s.season; });

      var srcCard = el('div', 'ou-card');
      var src = el('div', 'ou-src');
      src.appendChild(el('span', 'ou-src-name', 'Сериал'));
      src.appendChild(el('span', 'ou-badge', seasons.length + ' ' + plural(seasons.length, 'сезон', 'сезона', 'сезонов')));
      if (data.quality) src.appendChild(el('span', 'ou-badge', esc(data.quality)));
      srcCard.appendChild(src);

      var voices = data.voiceActing || [];
      if (voices.length) {
        srcCard.appendChild(el('div', 'ou-lbl', 'Доступные озвучки (' + voices.length + ')'));
        var vc = el('div', 'ou-chips');
        voices.slice(0, 20).forEach(function (v) { vc.appendChild(el('span', 'ou-chip', esc(v))); });
        srcCard.appendChild(vc);
      }
      wrap.appendChild(srcCard);

      srcCard.appendChild(el('div', 'ou-note',
        'Для сериалов выбор <b>сезона, серии и озвучки</b> — в полном движке: он корректно подбирает поток по каждой серии и сам обновляется.'));

      var act = el('div', 'ou-actions');
      act.appendChild(mkBtn('primary', '▶ Смотреть (сезоны и озвучки)', function () { Engine.open(card); }));
      wrap.appendChild(act);

      setBody(wrap);
    }

    function plural(n, one, few, many) {
      var m10 = n % 10, m100 = n % 100;
      if (m10 === 1 && m100 !== 11) return one;
      if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
      return many;
    }
  }

  /* ═══════════════ card button ═══════════════ */

  function addButton(e) {
    if (e.type !== 'complite' || !e.object) return;
    var render = e.object.activity.render();
    var $ = window.$;
    if (!$ || !render || !render.find) return;
    if (render.find('.online-ultra-btn').length) return;

    var svg = '<svg class="ou-ic" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    var btn = $('<div class="full-start__button selector online-ultra-btn" ' +
      'style="background:linear-gradient(135deg,#e8a838,#f5c842);color:#111;font-weight:800;display:inline-flex;align-items:center;border-radius:20px;">' +
      svg + 'Online Ultra</div>');

    btn.on('hover:enter', function () {
      openUltra(e.data.movie);
    });

    var box = render.find('.full-start-new__buttons').first();
    if (!box.length) box = render.find('.full-start__buttons').first();
    if (box.length) box.append(btn);
    else {
      var torrent = render.find('.view--torrent');
      if (torrent.length) torrent.after(btn);
    }
  }

  function openUltra(card) {
    try {
      L().Activity.push({
        url: '',
        title: OU.title,
        component: 'online_ultra',
        movie: card,
        page: 1
      });
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

    param('ou_proxy', 'select', '0',
      { '0': 'Прямой + авто-фолбэк (рекоменд.)', '1': 'Прокси 1 (Cloudflare)', '2': 'Прокси 2 (Deno)', '3': 'Прокси 3' },
      'Прокси для источников', 'За границей без VPN: если прямой не открывает — переключите на прокси.');

    param('ou_engine', 'select', '1',
      { '1': 'Загружать автоматически', '0': 'Не загружать' },
      'Движок 21 балансера', 'Подтягивает online_mod (сериалы и все источники). Оставьте включённым.');

    param('ou_engine_url', 'input', OU.engine_url_default, null,
      'URL движка', 'Можно заменить на своё зеркало online_mod.');

    param('ou_collaps_token', 'input', OU.collaps_token_default, null,
      'Токен Collaps', 'Если быстрый источник перестал искать — обновите токен.');
  }

  function param(name, type, def, values, fieldName, fieldDesc) {
    try {
      L().SettingsApi.addParam({
        component: 'online_ultra',
        param: { name: name, type: type, values: values || undefined, default: def },
        field: { name: fieldName, description: fieldDesc || '' }
      });
    } catch (e) {}
  }

  /* ═══════════════ boot ═══════════════ */

  function boot() {
    var La = L();
    try { La.Component.add('online_ultra', OnlineUltraComponent); } catch (e) {}
    addSettings();
    Engine.tune();
    Engine.load(function () {}); // warm the engine so series / "all sources" open instantly

    La.Listener.follow('full', addButton);

    notify('✅ ' + OU.title + ' ' + OU.version + ' готов');
  }

  function waitLampa() {
    if (window.Lampa && Lampa.Listener && Lampa.Component && Lampa.Activity && Lampa.Storage) {
      try { boot(); } catch (e) { console.error('[OnlineUltra] boot error', e); }
    } else {
      setTimeout(waitLampa, 200);
    }
  }

  waitLampa();
})();
