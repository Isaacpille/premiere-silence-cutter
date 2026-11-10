// Moteur de détection des silences (FFmpeg) + calcul des segments à garder.
// Fonctionne dans le panneau CEP (Node activé) et dans Node tout seul (pour les tests).
(function (root) {
  // Lit la sortie texte de ffmpeg (silencedetect) -> durée du fichier + liste de silences [début, fin] en secondes.
  function parseFfmpegOutput(text) {
    var duration = null;
    var d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
    if (d) duration = (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]);

    var silences = [];
    var start = null;
    var re = /silence_(start|end):\s*(-?[\d.]+)/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var v = parseFloat(m[2]);
      if (m[1] === 'start') {
        start = Math.max(0, v);
      } else if (start !== null) {
        silences.push([start, v]);
        start = null;
      }
    }
    // Fichier qui se termine par un silence : ffmpeg n'écrit pas de "silence_end"
    if (start !== null && duration !== null) silences.push([start, duration]);
    return { duration: duration, silences: silences };
  }

  // Transforme les silences en segments à GARDER dans [rangeStart, rangeEnd].
  // pad : secondes de silence conservées autour de la parole (pour que ça reste naturel)
  // minSegment : les bouts de parole plus courts que ça (clics, bruits) sont supprimés
  function buildSegments(silences, rangeStart, rangeEnd, pad, minSegment) {
    var EPS = 1e-6;
    var cuts = [];
    var sorted = silences.slice().sort(function (a, b) { return a[0] - b[0]; });
    for (var i = 0; i < sorted.length; i++) {
      var s = sorted[i][0];
      var e = sorted[i][1];
      if (e <= rangeStart || s >= rangeEnd) continue;
      // pas de marge côté "bord du clip" : on coupe franchement le début/la fin
      var s2 = (s <= rangeStart + EPS) ? rangeStart : s + pad;
      var e2 = (e >= rangeEnd - EPS) ? rangeEnd : e - pad;
      s2 = Math.max(s2, rangeStart);
      e2 = Math.min(e2, rangeEnd);
      if (e2 - s2 > 0.001) cuts.push([s2, e2]);
    }

    var keep = [];
    var cur = rangeStart;
    for (var j = 0; j < cuts.length; j++) {
      if (cuts[j][0] - cur > minSegment) keep.push([cur, cuts[j][0]]);
      cur = Math.max(cur, cuts[j][1]);
    }
    if (rangeEnd - cur > minSegment) keep.push([cur, rangeEnd]);
    return keep;
  }

  // Les "trous" entre les segments gardés = les silences réellement retirés (pour les marqueurs).
  function invert(segments, rangeStart, rangeEnd) {
    var gaps = [];
    var cur = rangeStart;
    for (var i = 0; i < segments.length; i++) {
      if (segments[i][0] - cur > 0.001) gaps.push([cur, segments[i][0]]);
      cur = Math.max(cur, segments[i][1]);
    }
    if (rangeEnd - cur > 0.001) gaps.push([cur, rangeEnd]);
    return gaps;
  }

  // Lance ffmpeg silencedetect sur un fichier. cb(err, {duration, silences})
  // stream : numéro de la piste audio du fichier (0 = première) ou null pour la piste par défaut
  function detectSilences(ffmpegPath, file, noiseDb, minDuration, stream, cb) {
    var req = (typeof require === 'function') ? require : (root.cep_node && root.cep_node.require);
    var cp = req('child_process');
    var args = ['-hide_banner', '-nostats', '-i', file, '-vn', '-sn'];
    if (stream !== null && stream !== undefined && stream !== '') args.push('-map', '0:a:' + stream);
    args.push('-af', 'silencedetect=noise=' + noiseDb + 'dB:d=' + minDuration, '-f', 'null', '-');
    var done = false;
    function finish(err, res) { if (!done) { done = true; cb(err, res); } }

    var p;
    try {
      p = cp.spawn(ffmpegPath, args, { windowsHide: true });
    } catch (e) {
      return finish(e);
    }
    var out = '';
    p.stderr.on('data', function (chunk) { out += chunk.toString(); });
    p.on('error', function (err) {
      finish(new Error("Impossible de lancer ffmpeg (" + ffmpegPath + "). Est-il installé ? " + err.message));
    });
    p.on('close', function (code) {
      if (code !== 0) {
        var tail = out.split('\n').slice(-6).join('\n');
        return finish(new Error('ffmpeg a échoué (code ' + code + ') :\n' + tail));
      }
      finish(null, parseFfmpegOutput(out));
    });
  }

  var api = {
    parseFfmpegOutput: parseFfmpegOutput,
    buildSegments: buildSegments,
    invert: invert,
    detectSilences: detectSilences
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SilenceEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
