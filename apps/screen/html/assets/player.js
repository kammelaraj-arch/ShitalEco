/* ============================================================
   Shital Temple Smart Screen Player
   jQuery + HTML5 — works on any TV browser
   ============================================================ */

var Player = (function ($) {
  'use strict';

  /* ── Config ─────────────────────────────────────────────── */
  var cfg = {
    apiUrl: '/api/v1',
    profileId: 'default',
    refreshMs: 30000,       // poll for new content every 30s
    templeSlideMs: 12000,   // rotate temple slides every 12s
    playlist: [],
    currentIdx: 0,
    timer: null,
    pollTimer: null,
    hlsInstances: {},
    mode: 'temple',
  };

  /* ── Aarti schedule ─────────────────────────────────────── */
  var AARTI = [
    { name: 'Mangala',  time: '06:30', icon: '🌅' },
    { name: 'Shangar',  time: '08:00', icon: '🌸' },
    { name: 'Raj Bhog', time: '11:45', icon: '☀️' },
    { name: 'Utthapan', time: '16:00', icon: '🌤️' },
    { name: 'Sandhya',  time: '18:30', icon: '🌆' },
    { name: 'Shayan',   time: '21:00', icon: '🌙' },
  ];

  var JAI = [
    'जय श्री कृष्ण', 'Jai Shri Krishna', 'જય શ્રી કૃષ્ણ',
    'ॐ नमः शिवाय', 'Har Har Mahadev', 'Jai Mata Di',
    'जय श्री राम', 'Jai Shri Ram',
  ];
  var jaiIdx = 0;

  var TICKER_DEFAULTS = [
    '🙏 Thank you to all our generous donors',
    '🪔 Your seva supports the temple community',
    '💛 Every donation makes a difference',
    '🌸 May your blessings multiply a thousandfold',
    '🕉 Jai Shri Krishna — thank you for your generosity',
    '🇬🇧 Gift Aid eligible — we claim 25p per £1',
  ];

  /* ── localStorage helpers ───────────────────────────────── */
  var LS_KEY = 'shital_screen_cfg';

  function lsLoad() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch(e) { return {}; }
  }

  function lsSave(obj) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch(e) {}
  }

  function lsClear() {
    try { localStorage.removeItem(LS_KEY); } catch(e) {}
  }

  /* ── URL query param handling ───────────────────────────── */
  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  /* ── Setup mode (?setup=1) ──────────────────────────────── */
  function handleSetupMode(params) {
    /* ?setup=1 — show setup overlay on the TV to configure it directly */
    if (params.get('setup') === '1') {
      showSetupOverlay();
      return true;
    }
    /* ?profile=ID&save=1 — save this profile to localStorage then remove param */
    if (params.get('save') === '1' && params.get('profile')) {
      lsSave({ profileId: params.get('profile'), apiUrl: params.get('api') || cfg.apiUrl });
      /* Strip query params and reload cleanly */
      window.location.replace(window.location.pathname);
      return true;
    }
    /* ?clear=1 — clear localStorage config */
    if (params.get('clear') === '1') {
      lsClear();
      window.location.replace(window.location.pathname);
      return true;
    }
    return false;
  }

  function showSetupOverlay() {
    var saved = lsLoad();
    var overlay = $('<div id="setup-overlay"></div>').css({
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, fontFamily: 'monospace',
    });
    overlay.html(
      '<div style="max-width:600px;width:90%;text-align:center;color:#fff;padding:40px">' +
        '<div style="font-size:60px;margin-bottom:20px">📺</div>' +
        '<h1 style="font-size:32px;font-weight:900;margin-bottom:12px">Screen Setup</h1>' +
        '<p style="color:rgba(255,255,255,.5);margin-bottom:32px;font-size:16px">' +
          'Configure this screen by entering a Profile ID below, or use the Admin portal to create profiles.' +
        '</p>' +
        '<input id="setup-pid" type="text" placeholder="Profile ID (from admin portal)" value="' + (saved.profileId || '') + '" ' +
          'style="width:100%;padding:16px;font-size:18px;border-radius:12px;border:1px solid rgba(255,153,51,.4);' +
          'background:rgba(255,255,255,.06);color:#fff;outline:none;margin-bottom:12px">' +
        '<input id="setup-api" type="text" placeholder="API URL (default: /api/v1)" value="' + (saved.apiUrl || '') + '" ' +
          'style="width:100%;padding:12px;font-size:14px;border-radius:12px;border:1px solid rgba(255,255,255,.1);' +
          'background:rgba(255,255,255,.04);color:#fff;outline:none;margin-bottom:20px">' +
        '<div style="display:flex;gap:12px;justify-content:center">' +
          '<button id="setup-save" style="padding:14px 36px;border-radius:12px;background:linear-gradient(135deg,#b91c1c,#991b1b);' +
            'color:#fff;font-size:16px;font-weight:900;border:none;cursor:pointer">💾 Save & Start</button>' +
          '<button id="setup-cancel" style="padding:14px 36px;border-radius:12px;background:rgba(255,255,255,.08);' +
            'color:rgba(255,255,255,.6);font-size:16px;font-weight:600;border:1px solid rgba(255,255,255,.1);cursor:pointer">Cancel</button>' +
        '</div>' +
        '<p style="color:rgba(255,255,255,.25);font-size:12px;margin-top:24px">' +
          'Visit <strong>?setup=1</strong> on this page to open setup · <strong>?clear=1</strong> to reset' +
        '</p>' +
      '</div>'
    );
    $('body').append(overlay);
    $('#setup-pid').focus();

    overlay.on('click', '#setup-save', function() {
      var pid = $('#setup-pid').val().trim();
      var api = $('#setup-api').val().trim();
      if (!pid) { alert('Please enter a Profile ID'); return; }
      lsSave({ profileId: pid, apiUrl: api || cfg.apiUrl });
      overlay.remove();
      window.location.reload();
    });
    overlay.on('click', '#setup-cancel', function() {
      overlay.remove();
      init_player();
    });
  }

  /* ── Init ───────────────────────────────────────────────── */
  function init() {
    var params = new URLSearchParams(window.location.search);

    /* Handle special setup modes first */
    if (handleSetupMode(params)) return;

    /* Resolve profile ID: URL param → localStorage → 'default' */
    var saved = lsLoad();
    cfg.profileId = params.get('profile') || params.get('p') || saved.profileId || 'default';
    if (saved.apiUrl) cfg.apiUrl = saved.apiUrl;

    init_player();
  }

  function init_player() {
    buildParticles();
    buildAartiGrid();
    startClocks();
    startJaiRotation();
    buildTicker(TICKER_DEFAULTS);
    showSlide('temple');

    loadProfile();
    cfg.pollTimer = setInterval(loadProfile, cfg.refreshMs);
  }

  /* ── Load profile from API ──────────────────────────────── */
  function loadProfile() {
    $.getJSON(cfg.apiUrl + '/screen/profiles/' + cfg.profileId + '/current')
      .done(function (data) {
        var profile = data.profile || {};
        var name = profile.name || 'Shital Hindu Temple';
        $('#temple-name').text(name);
        $('#bottom-name').text('🕉 ' + name);

        if (data.mode === 'live') {
          playLive(data.live_url, data.live_type);
        } else if (data.mode === 'playlist' && data.items && data.items.length > 0) {
          var newHash = JSON.stringify(data.items.map(function(i){ return i.id; }));
          var oldHash = JSON.stringify(cfg.playlist.map(function(i){ return i.id; }));
          if (newHash !== oldHash) {
            cfg.playlist = data.items;
            cfg.currentIdx = 0;
            clearTimeout(cfg.timer);
            playNext();
          }
        } else {
          /* temple mode or empty — show built-in temple slides */
          if (cfg.mode !== 'temple') {
            cfg.mode = 'temple';
            cfg.playlist = [];
            showSlide('temple');
          }
        }
      })
      .fail(function () {
        if (cfg.playlist.length === 0) showSlide('temple');
      });
  }

  /* ── Playlist playback ──────────────────────────────────── */
  function playNext() {
    if (!cfg.playlist || cfg.playlist.length === 0) {
      showSlide('temple');
      return;
    }
    cfg.mode = 'playlist';
    var item = cfg.playlist[cfg.currentIdx];
    updateDots(cfg.currentIdx, cfg.playlist.length);
    renderItem(item);
  }

  function advance() {
    cfg.currentIdx = (cfg.currentIdx + 1) % cfg.playlist.length;
    playNext();
  }

  /* ── Render a content item ──────────────────────────────── */
  function renderItem(item) {
    clearTimeout(cfg.timer);
    destroyHls();

    var dur = (item.duration_secs || 10) * 1000;
    var type = (item.content_type || 'IMAGE').toUpperCase();

    switch (type) {
      case 'IMAGE':
        renderImage(item, dur);
        break;
      case 'VIDEO':
        renderVideo(item, dur);
        break;
      case 'AUDIO':
        renderAudio(item, dur);
        break;
      case 'IMAGE_AUDIO':
        renderImageAudio(item, dur);
        break;
      case 'YOUTUBE':
        renderYouTube(item, dur);
        break;
      case 'WEBSITE':
        renderWebsite(item, dur);
        break;
      case 'STREAM':
      case 'BROADCAST':
        renderStream(item, dur);
        break;
      default:
        renderImage(item, dur);
    }
  }

  /* ── IMAGE ──────────────────────────────────────────────── */
  function renderImage(item, dur) {
    var $img = $('#img-el');
    $img.attr('src', item.media_url || '');
    $('#img-caption').text(item.title || '');
    showSlide('image');
    if (dur > 0) cfg.timer = setTimeout(advance, dur);
  }

  /* ── VIDEO ──────────────────────────────────────────────── */
  function renderVideo(item, dur) {
    var $vid = $('#video-el');
    $vid[0].pause();
    $vid.attr('src', '');
    $('#video-caption').text(item.title || '');
    showSlide('video');
    loadVideoSrc($vid[0], item.media_url, false);
    $vid.on('ended.player', function () {
      $vid.off('ended.player');
      advance();
    });
    if (dur > 0) cfg.timer = setTimeout(function () {
      $vid.off('ended.player');
      advance();
    }, dur);
  }

  /* ── AUDIO ──────────────────────────────────────────────── */
  function renderAudio(item, dur) {
    var $aud = $('#audio-el');
    $aud[0].pause();
    $aud.attr('src', item.audio_url || item.media_url || '');
    $('#audio-title').text(item.title || '');
    showSlide('audio');
    $aud[0].play().catch(function(){});
    $aud.on('ended.player', function () {
      $aud.off('ended.player');
      advance();
    });
    if (dur > 0) cfg.timer = setTimeout(function () {
      $aud.off('ended.player');
      advance();
    }, dur);
  }

  /* ── IMAGE + AUDIO parallel ─────────────────────────────── */
  function renderImageAudio(item, dur) {
    $('#img-audio-el').attr('src', item.media_url || '');
    $('#img-audio-caption').text(item.title || '');
    var $aud2 = $('#audio2-el');
    $aud2[0].pause();
    $aud2.attr('src', item.audio_url || '');
    showSlide('image-audio');
    $aud2[0].play().catch(function(){});
    if (dur > 0) cfg.timer = setTimeout(advance, dur);
  }

  /* ── YOUTUBE ────────────────────────────────────────────── */
  function renderYouTube(item, dur) {
    var ytId = item.youtube_id || extractYouTubeId(item.media_url || item.website_url || '');
    if (!ytId) { advance(); return; }
    var src = 'https://www.youtube.com/embed/' + ytId +
      '?autoplay=1&mute=0&controls=0&modestbranding=1&rel=0&iv_load_policy=3' +
      '&enablejsapi=1&loop=' + (item.is_live ? '0' : '1') +
      '&playlist=' + ytId;
    $('#yt-el').attr('src', src);
    showSlide('youtube');
    if (dur > 0) cfg.timer = setTimeout(advance, dur);
  }

  function extractYouTubeId(url) {
    var m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    return m ? m[1] : '';
  }

  /* ── WEBSITE iframe ─────────────────────────────────────── */
  function renderWebsite(item, dur) {
    var url = item.website_url || item.media_url || '';
    $('#web-el').attr('src', url);
    showSlide('website');
    if (dur > 0) cfg.timer = setTimeout(advance, dur);
  }

  /* ── HLS STREAM / BROADCAST ─────────────────────────────── */
  function renderStream(item, dur) {
    var url = item.media_url || item.live_url || '';
    var $vid = $('#video-el');
    $vid[0].pause();
    $vid.attr('src', '');
    $('#video-caption').text(item.title || '');
    showSlide('video');
    loadVideoSrc($vid[0], url, true);
    /* streams don't auto-advance unless duration set */
    if (dur > 0 && !item.is_live) cfg.timer = setTimeout(advance, dur);
  }

  /* ── LIVE (from profile) ────────────────────────────────── */
  function playLive(url, type) {
    if (!url) { showSlide('temple'); return; }
    var fakeItem = { title: 'Live', content_type: 'STREAM', media_url: url, is_live: true, duration_secs: 0 };
    renderStream(fakeItem, 0);
    clearDots();
  }

  /* ── HLS / direct video loader ──────────────────────────── */
  function loadVideoSrc(videoEl, url, isLive) {
    if (!url) return;
    var isHls = url.indexOf('.m3u8') !== -1;
    if (isHls && window.Hls && Hls.isSupported()) {
      var hls = new Hls({ liveSyncDurationCount: 3 });
      cfg.hlsInstances['video'] = hls;
      hls.loadSource(url);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, function () { videoEl.play().catch(function(){}); });
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = url;
      videoEl.play().catch(function(){});
    } else {
      videoEl.src = url;
      videoEl.play().catch(function(){});
    }
  }

  function destroyHls() {
    $.each(cfg.hlsInstances, function (key, hls) { try { hls.destroy(); } catch(e){} });
    cfg.hlsInstances = {};
    var $vid = $('#video-el');
    $vid.off('ended.player');
    $vid[0].pause();
    var $aud = $('#audio-el');
    $aud.off('ended.player');
    $aud[0].pause();
    /* reset iframes */
    $('#yt-el').attr('src', '');
    $('#web-el').attr('src', 'about:blank');
  }

  /* ── Show/hide slides ───────────────────────────────────── */
  function showSlide(name) {
    $('.slide').removeClass('active');
    $('#slide-' + name).addClass('active');
  }

  /* ── Slide dots ─────────────────────────────────────────── */
  function updateDots(idx, total) {
    var $dots = $('#slide-dots').empty();
    for (var i = 0; i < total && i < 20; i++) {
      $('<div class="dot' + (i === idx ? ' active' : '') + '"></div>').appendTo($dots);
    }
  }
  function clearDots() { $('#slide-dots').empty(); }

  /* ── Ticker ─────────────────────────────────────────────── */
  function buildTicker(msgs) {
    var doubled = msgs.concat(msgs);
    var html = doubled.map(function (m) {
      return '<span>' + escHtml(m) + '</span><span class="sep">✦</span>';
    }).join('');
    $('#ticker-inner').html(html);
  }

  /* ── Clocks ─────────────────────────────────────────────── */
  function startClocks() {
    function tick() {
      var now = new Date();
      var t = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
      var d = now.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
      $('#temple-clock').text(t);
      $('#bottom-clock2').text(t);
      $('#temple-date').text(d);
      updateAartiHighlight(now);
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ── Jai message rotation ───────────────────────────────── */
  function startJaiRotation() {
    function rotate() {
      $('#temple-jai').fadeOut(400, function() {
        $(this).text(JAI[jaiIdx]).fadeIn(500);
        jaiIdx = (jaiIdx + 1) % JAI.length;
      });
    }
    rotate();
    setInterval(rotate, 3500);
  }

  /* ── Aarti grid ─────────────────────────────────────────── */
  function buildAartiGrid() {
    var html = AARTI.map(function (a) {
      return '<div class="aarti-card" data-time="' + a.time + '">' +
        '<div class="aarti-icon">' + a.icon + '</div>' +
        '<div class="aarti-name">' + a.name + '</div>' +
        '<div class="aarti-time">' + a.time + '</div>' +
        '<div class="aarti-badge" style="display:none">NOW</div>' +
      '</div>';
    }).join('');
    $('#aarti-grid').html(html);
  }

  function updateAartiHighlight(now) {
    var nowMins = now.getHours() * 60 + now.getMinutes();
    var nextSet = false;
    $('.aarti-card').each(function () {
      var parts = $(this).data('time').split(':');
      var slotMins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
      var diff = slotMins - nowMins;
      $(this).removeClass('now next');
      $(this).find('.aarti-badge').hide().text('NOW');
      if (Math.abs(diff) < 30) {
        $(this).addClass('now');
        $(this).find('.aarti-badge').text('NOW').show();
      } else if (!nextSet && diff > 0 && diff < 120) {
        $(this).addClass('next');
        $(this).find('.aarti-badge').text('NEXT').show();
        nextSet = true;
      }
    });
  }

  /* ── Ambient particles ──────────────────────────────────── */
  function buildParticles() {
    var colors = ['rgba(255,153,51,0.55)', 'rgba(185,28,28,0.45)', 'rgba(255,215,0,0.4)'];
    for (var i = 0; i < 18; i++) {
      var size = 2 + (i % 3);
      var left = (i * 137.5) % 100;
      var delay = (i * 0.7) % 8;
      var dur = 15 + (i % 10);
      $('<div class="particle"></div>').css({
        width: size, height: size,
        left: left + '%',
        bottom: '-10px',
        background: colors[i % 3],
        animationDuration: dur + 's',
        animationDelay: delay + 's',
      }).appendTo('body');
    }
  }

  /* ── Helpers ────────────────────────────────────────────── */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── Public ─────────────────────────────────────────────── */
  return { init: init };

})(jQuery);

/* ── Boot ───────────────────────────────────────────────────────────────── */
$(document).ready(function () {
  Player.init();

  /* Prevent screen sleep on TV browsers that support it */
  if ('wakeLock' in navigator) {
    navigator.wakeLock.request('screen').catch(function(){});
  }
});
