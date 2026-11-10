// Logique du panneau : lit la sélection dans Premiere, détecte les silences, envoie le plan à host.jsx.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = { plan: null };

  var PRESETS = {
    talking:  { noise: -30, minDur: 0.5, pad: 0.10 },
    podcast:  { noise: -35, minDur: 0.8, pad: 0.20 },
    agressif: { noise: -28, minDur: 0.3, pad: 0.05 }
  };

  // ---------- utilitaires ----------
  function log(msg, cls) {
    var el = $('log');
    var line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  // host.jsx renvoie une chaîne JSON ; en cas d'erreur de script Premiere renvoie "EvalScript error."
  function callHost(script, cb) {
    window.__adobe_cep__.evalScript(script, function (raw) {
      var res;
      try { res = JSON.parse(raw); }
      catch (e) { res = { ok: false, message: 'Réponse inattendue de Premiere : ' + raw }; }
      cb(res);
    });
  }

  function extensionPath() {
    try {
      var u = decodeURI(window.__adobe_cep__.getSystemPath('extension'));
      return u.replace(/^file:\/\/\//, '');
    } catch (e) { return null; }
  }

  function resolveFfmpeg() {
    var typed = $('ffmpeg').value.replace(/^\s+|\s+$/g, '') || 'ffmpeg';
    if (typed !== 'ffmpeg') return typed;
    // un ffmpeg.exe posé dans le dossier "bin" du panneau a priorité
    try {
      var fs = require('fs');
      var local = extensionPath() + '/bin/ffmpeg.exe';
      if (fs.existsSync(local)) return local;
    } catch (e) {}
    return 'ffmpeg';
  }

  function fmt(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.round(sec - m * 60);
    if (s === 60) { m += 1; s = 0; }
    return m + ' min ' + (s < 10 ? '0' : '') + s + ' s';
  }

  function readStream() {
    var v = $('stream').value.replace(/^\s+|\s+$/g, '');
    if (v === '') return { ok: true, value: null };
    if (!/^\d+$/.test(v)) return { ok: false };
    return { ok: true, value: parseInt(v, 10) };
  }

  // ---------- réglages mémorisés ----------
  var FIELDS = ['noise', 'minDur', 'pad', 'ffmpeg', 'stream', 'preset', 'mode'];
  function loadSettings() {
    try {
      FIELDS.forEach(function (f) {
        var v = localStorage.getItem('silencecutter.' + f);
        if (v !== null) $(f).value = v;
      });
    } catch (e) {}
  }
  function saveSettings() {
    try { FIELDS.forEach(function (f) { localStorage.setItem('silencecutter.' + f, $(f).value); }); } catch (e) {}
  }

  function applyPreset(name) {
    var p = PRESETS[name];
    if (!p) return;
    $('noise').value = p.noise;
    $('minDur').value = p.minDur;
    $('pad').value = p.pad;
    saveSettings();
  }

  function updateButtonLabel() {
    $('btnCut').textContent = ($('mode').value === 'markers')
      ? '2. Poser les marqueurs « Silence »'
      : '2. Créer la séquence sans silences';
  }

  // ---------- étape 1 : analyse ----------
  // Analyse chaque fichier source une seule fois (même si plusieurs clips viennent du même fichier).
  function detectAll(paths, noise, minDur, stream, ffmpeg, done) {
    var cache = {};
    var i = 0;
    function next() {
      if (i >= paths.length) return done(null, cache);
      var p = paths[i++];
      log('Analyse audio ' + i + '/' + paths.length + '…');
      SilenceEngine.detectSilences(ffmpeg, p, noise, minDur, stream, function (err, r) {
        if (err) return done(err);
        cache[p] = r.silences;
        next();
      });
    }
    next();
  }

  function analyze() {
    saveSettings();
    $('btnCut').disabled = true;
    state.plan = null;

    var noise = parseFloat($('noise').value);
    var minDur = parseFloat($('minDur').value);
    var pad = parseFloat($('pad').value);
    var stream = readStream();
    if (isNaN(noise) || isNaN(minDur) || isNaN(pad)) { $('stats').textContent = 'Réglages invalides.'; return; }
    if (!stream.ok) { $('stats').textContent = 'Piste audio : mets un nombre (0, 1, 2…) ou laisse vide.'; return; }

    $('stats').textContent = 'Lecture de la sélection…';
    callHost('getSelectionInfo()', function (info) {
      if (!info.ok) { $('stats').textContent = info.message; log(info.message, 'err'); return; }

      var paths = [];
      info.clips.forEach(function (c) { if (paths.indexOf(c.path) < 0) paths.push(c.path); });
      log(info.clips.length + ' clip(s)' + (info.fromSelection ? ' sélectionné(s)' : ' (toute la piste V1)') +
          ', ' + paths.length + ' fichier(s).');
      if (info.skipped) log(info.skipped + ' élément(s) ignoré(s) (titres, séquences imbriquées…).');
      $('stats').textContent = 'Analyse audio en cours (ça peut prendre un moment)…';
      $('btnAnalyze').disabled = true;

      detectAll(paths, noise, minDur, stream.value, resolveFfmpeg(), function (err, cache) {
        $('btnAnalyze').disabled = false;
        if (err) { $('stats').textContent = "Erreur pendant l'analyse."; log(err.message, 'err'); return; }

        var plan = [];
        var total = 0, kept = 0, nCuts = 0, nSegs = 0;
        info.clips.forEach(function (c) {
          var segs = SilenceEngine.buildSegments(cache[c.path], c.inSec, c.outSec, pad, 0.05);
          segs.forEach(function (s) { kept += s[1] - s[0]; });
          nCuts += SilenceEngine.invert(segs, c.inSec, c.outSec).length;
          nSegs += segs.length;
          total += c.outSec - c.inSec;
          plan.push({ path: c.path, name: c.name, inSec: c.inSec, outSec: c.outSec, segments: segs });
        });
        var removed = total - kept;

        state.plan = plan;
        $('stats').innerHTML =
          '<b>' + info.clips.length + '</b> clip(s), <b>' + nCuts + '</b> silences à retirer<br>' +
          'Durée : ' + fmt(total) + ' → <b>' + fmt(kept) + '</b><br>' +
          'À retirer : ' + fmt(removed) + ' (' + Math.round(100 * removed / Math.max(total, 0.001)) + ' %)<br>' +
          nSegs + ' morceaux gardés';
        log('Analyse OK : ' + nSegs + ' morceaux.', 'ok');
        $('btnCut').disabled = nSegs === 0;
        if (nSegs === 0) log('Rien à garder : essaie un seuil plus bas (ex. -40 dB).', 'err');
      });
    });
  }

  // ---------- étape 2 : application dans Premiere ----------
  function apply() {
    if (!state.plan) return;
    var markers = ($('mode').value === 'markers');
    var payload, script;
    if (markers) {
      payload = { clips: state.plan.map(function (c) {
        return { path: c.path, gaps: SilenceEngine.invert(c.segments, c.inSec, c.outSec) };
      }) };
      script = 'applyMarkers(' + JSON.stringify(JSON.stringify(payload)) + ')';
      log('Pose des marqueurs…');
    } else {
      payload = { clips: state.plan.map(function (c) {
        return { path: c.path, segments: c.segments };
      }) };
      script = 'applyCuts(' + JSON.stringify(JSON.stringify(payload)) + ')';
      log('Création de la séquence… (ne touche pas à Premiere)');
    }

    $('btnCut').disabled = true;
    $('btnAnalyze').disabled = true;
    callHost(script, function (res) {
      $('btnAnalyze').disabled = false;
      log(res.message, res.ok ? 'ok' : 'err');
      if (res.ok) $('stats').textContent = markers ? 'Terminé. Regarde les marqueurs sur ta séquence.' : 'Terminé. Regarde la nouvelle séquence dans ton projet.';
      else $('btnCut').disabled = false;
    });
  }

  $('btnAnalyze').addEventListener('click', analyze);
  $('btnCut').addEventListener('click', apply);
  $('preset').addEventListener('change', function () { applyPreset($('preset').value); });
  ['noise', 'minDur', 'pad'].forEach(function (f) {
    $(f).addEventListener('input', function () { $('preset').value = 'perso'; });
  });
  $('mode').addEventListener('change', function () { updateButtonLabel(); saveSettings(); });

  loadSettings();
  updateButtonLabel();
  log('Prêt.');
})();
