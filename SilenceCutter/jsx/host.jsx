// host.jsx : s'exécute DANS Premiere Pro (ExtendScript = vieux JavaScript ES3).
// Pas de JSON, pas de let/const, pas de forEach ici.
//
// Deux modes :
//  - applyCuts    : crée une NOUVELLE séquence avec uniquement les morceaux "parlés" (multi-clips)
//  - applyMarkers : pose des marqueurs "Silence" sur la séquence active (aperçu, rien n'est coupé)
// La séquence d'origine n'est jamais coupée.

var TICKS_PER_SECOND = 254016000000;

function esc(s) {
  s = String(s);
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function res(ok, msg, extra) {
  return '{"ok":' + (ok ? 'true' : 'false') + ',"message":"' + esc(msg) + '"' + (extra ? extra : '') + '}';
}

function stamp() {
  var d = new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(d.getHours()) + 'h' + p(d.getMinutes()) + p(d.getSeconds());
}

// ---------- sélection ----------
// Clips à traiter : la sélection (vidéo en priorité), sinon toute la piste V1 (ou A1 s'il n'y a pas de vidéo).
function collectClips() {
  var seq = app.project.activeSequence;
  if (!seq) return null;
  var raw = [];
  var sel = seq.getSelection();
  var fromSel = !!(sel && sel.length > 0);
  var i, tr;
  if (fromSel) {
    var hasVideo = false;
    for (i = 0; i < sel.length; i++) {
      if (sel[i].mediaType === 'Video') hasVideo = true;
    }
    for (i = 0; i < sel.length; i++) {
      if (hasVideo && sel[i].mediaType !== 'Video') continue;
      raw.push(sel[i]);
    }
  } else {
    tr = null;
    if (seq.videoTracks.numTracks > 0 && seq.videoTracks[0].clips.numItems > 0) tr = seq.videoTracks[0];
    else if (seq.audioTracks.numTracks > 0 && seq.audioTracks[0].clips.numItems > 0) tr = seq.audioTracks[0];
    if (tr) {
      for (i = 0; i < tr.clips.numItems; i++) raw.push(tr.clips[i]);
    }
  }
  raw.sort(function (a, b) { return a.start.seconds - b.start.seconds; });

  var items = [];
  var skipped = 0;
  var pi, path;
  for (i = 0; i < raw.length; i++) {
    pi = raw[i].projectItem;
    path = null;
    try { path = pi ? pi.getMediaPath() : null; } catch (e) {}
    if (!path) { skipped++; continue; }
    items.push({ item: raw[i], pi: pi, path: path });
  }
  return {
    items: items,
    skipped: skipped,
    fromSelection: fromSel,
    isAudio: (items.length > 0 && items[0].item.mediaType !== 'Video')
  };
}

// Appelé par le panneau (étape 1)
function getSelectionInfo() {
  try {
    if (!app.project.activeSequence) return res(false, 'Aucune séquence active.');
    var cc = collectClips();
    if (!cc || cc.items.length === 0) {
      return res(false, 'Aucun clip utilisable. Sélectionne un ou plusieurs clips dans la timeline.');
    }
    var parts = [];
    var i, it;
    for (i = 0; i < cc.items.length; i++) {
      it = cc.items[i].item;
      parts.push('{"name":"' + esc(it.name) + '","path":"' + esc(cc.items[i].path) + '"' +
        ',"inSec":' + it.inPoint.seconds +
        ',"outSec":' + it.outPoint.seconds +
        ',"startSec":' + it.start.seconds + '}');
    }
    var extra = ',"isAudio":' + (cc.isAudio ? 'true' : 'false') +
      ',"skipped":' + cc.skipped +
      ',"fromSelection":' + (cc.fromSelection ? 'true' : 'false') +
      ',"clips":[' + parts.join(',') + ']';
    return res(true, 'ok', extra);
  } catch (e) {
    return res(false, 'Erreur getSelectionInfo : ' + e.message + ' (ligne ' + e.line + ')');
  }
}

// Vérifie que ce que le panneau a analysé correspond toujours à la sélection actuelle.
function checkSameClips(cc, planClips) {
  if (!cc || cc.items.length !== planClips.length) return false;
  var i;
  for (i = 0; i < cc.items.length; i++) {
    if (cc.items[i].path !== planClips[i].path) return false;
  }
  return true;
}

// ---------- points d'entrée / sortie du clip source ----------
// L'API accepte selon les versions des secondes, un objet Time ou des ticks (texte).
// On essaie dans l'ordre et on vérifie en relisant la valeur.
var MARKS = [
  function (x) { return x; },
  function (x) { var t = new Time(); t.seconds = x; return t; },
  function (x) { return String(Math.round(x * TICKS_PER_SECOND)); }
];
var markMode = -1;

function readMark(pi, isIn) {
  var t = null;
  try { t = isIn ? pi.getInPoint(4) : pi.getOutPoint(4); } catch (e1) {}
  if (t === null || t === undefined) {
    try { t = isIn ? pi.getInPoint() : pi.getOutPoint(); } catch (e2) {}
  }
  if (t === null || t === undefined) return null;
  if (typeof t === 'object' && t.seconds !== undefined) return t.seconds;
  var n = parseFloat(t);
  return isNaN(n) ? null : n;
}

function setMarks(pi, a, b) {
  var curOut = readMark(pi, false);
  var outFirst = (curOut === null) || (a >= curOut);
  var from = (markMode >= 0) ? markMode : 0;
  var to = (markMode >= 0) ? markMode : MARKS.length - 1;
  var m;
  for (m = from; m <= to; m++) {
    try {
      if (outFirst) {
        pi.setOutPoint(MARKS[m](b), 4);
        pi.setInPoint(MARKS[m](a), 4);
      } else {
        pi.setInPoint(MARKS[m](a), 4);
        pi.setOutPoint(MARKS[m](b), 4);
      }
      var ri = readMark(pi, true);
      var ro = readMark(pi, false);
      if (ri !== null && ro !== null && Math.abs(ri - a) < 0.05 && Math.abs(ro - b) < 0.05) {
        markMode = m;
        return true;
      }
    } catch (e) {}
  }
  return false;
}

function restoreMarks(savedList) {
  var i, s, ok = true;
  for (i = 0; i < savedList.length; i++) {
    s = savedList[i];
    if (s.a !== null && s.b !== null) {
      try { if (!setMarks(s.pi, s.a, s.b)) ok = false; } catch (e) { ok = false; }
    }
  }
  return ok;
}

// ---------- pose des clips sur la timeline ----------
var PLACE = [
  function (tr, pi, t) { tr.overwriteClip(pi, t); },
  function (tr, pi, t) { var x = new Time(); x.seconds = t; tr.overwriteClip(pi, x); },
  function (tr, pi, t) { tr.overwriteClip(pi, String(Math.round(t * TICKS_PER_SECOND))); }
];

function lastEnd(track) {
  var n = track.clips.numItems;
  return n ? track.clips[n - 1].end.seconds : 0;
}

function clearTrack(track) {
  var j;
  for (j = track.clips.numItems - 1; j >= 0; j--) {
    track.clips[j].remove(false, false);
  }
}

function clearAll(seq) {
  var i;
  for (i = 0; i < seq.videoTracks.numTracks; i++) clearTrack(seq.videoTracks[i]);
  for (i = 0; i < seq.audioTracks.numTracks; i++) clearTrack(seq.audioTracks[i]);
}

// Test à t = 10 s (pour distinguer secondes / ticks) : quelle variante d'overwriteClip marche ?
function pickPlaceVariant(seq, track, pi) {
  var v;
  for (v = 0; v < PLACE.length; v++) {
    try {
      clearAll(seq);
      PLACE[v](track, pi, 10);
      if (track.clips.numItems > 0 && Math.abs(track.clips[0].start.seconds - 10) < 0.1) {
        clearAll(seq);
        return v;
      }
    } catch (e) {}
  }
  clearAll(seq);
  return -1;
}

function findSequence(name) {
  var seqs = app.project.sequences;
  var i, found = null;
  for (i = 0; i < seqs.numSequences; i++) {
    if (seqs[i].name === name) found = seqs[i];
  }
  return found;
}

// ---------- mode 1 : nouvelle séquence (multi-clips) ----------
function applyCuts(str) {
  var savedByPath = {};
  var savedList = [];
  try {
    var data = eval('(' + str + ')');
    var cc = collectClips();
    if (!checkSameClips(cc, data.clips)) {
      return res(false, "La sélection a changé depuis l'analyse : relance « Analyser ».");
    }
    var useAudio = cc.isAudio;
    var i, j, it, segs, a, b, t, dur;

    var totalSegs = 0;
    var firstWith = -1;
    for (i = 0; i < data.clips.length; i++) {
      totalSegs += data.clips[i].segments.length;
      if (firstWith < 0 && data.clips[i].segments.length > 0) firstWith = i;
    }
    if (totalSegs === 0) return res(false, 'Aucun morceau à placer.');

    // marques IN/OUT d'origine de chaque fichier source (restaurées à la fin)
    for (i = 0; i < cc.items.length; i++) {
      it = cc.items[i];
      if (!savedByPath[it.path]) {
        savedByPath[it.path] = { pi: it.pi, a: readMark(it.pi, true), b: readMark(it.pi, false) };
        savedList.push(savedByPath[it.path]);
      }
    }

    // 1. nouvelle séquence (réglages du premier clip), qu'on vide
    var name = cc.items[0].item.name + ' - sans silences ' + stamp();
    var before = {};
    var k;
    for (k = 0; k < app.project.sequences.numSequences; k++) before[app.project.sequences[k].sequenceID] = true;

    app.project.createNewSequenceFromClips(name, [cc.items[0].pi], app.project.rootItem);

    // On retrouve la nouvelle séquence : par son nom, sinon par son ID (nouvelle), sinon la séquence active.
    var seq = findSequence(name);
    if (!seq) {
      for (k = 0; k < app.project.sequences.numSequences; k++) {
        if (!before[app.project.sequences[k].sequenceID]) seq = app.project.sequences[k];
      }
    }
    if (!seq) seq = app.project.activeSequence;
    if (!seq || before[seq.sequenceID]) {
      restoreMarks(savedList);
      return res(false, 'Séquence créée mais introuvable (nom : ' + name + '). Supprime-la du projet et réessaie.');
    }
    try { seq.name = name; } catch (eName) {}
    app.project.openSequence(seq.sequenceID);
    clearAll(seq);

    var track = useAudio ? seq.audioTracks[0] : seq.videoTracks[0];

    // 2. repérer la bonne façon d'appeler l'API dans cette version de Premiere
    var testPi = cc.items[firstWith].pi;
    var testSeg = data.clips[firstWith].segments[0];
    if (!setMarks(testPi, testSeg[0], testSeg[1])) {
      restoreMarks(savedList);
      return res(false, "Impossible de régler les points IN/OUT du clip source (setInPoint/setOutPoint).");
    }
    var variant = pickPlaceVariant(seq, track, testPi);
    if (variant < 0) {
      restoreMarks(savedList);
      return res(false, "Impossible de poser un clip sur la timeline (overwriteClip). Séquence '" + name + "' laissée vide.");
    }

    // 3. poser chaque morceau à la suite (au vrai bout de la piste, pour rester collé à l'image près)
    var placed = [];
    for (i = 0; i < cc.items.length; i++) {
      segs = data.clips[i].segments;
      for (j = 0; j < segs.length; j++) {
        a = segs[j][0];
        b = segs[j][1];
        dur = b - a;
        if (dur < 0.04) continue;
        if (!setMarks(cc.items[i].pi, a, b)) {
          throw new Error('Points IN/OUT refusés (clip ' + (i + 1) + ', morceau ' + (j + 1) + ').');
        }
        t = lastEnd(track);
        PLACE[variant](track, cc.items[i].pi, t);
        if (Math.abs(lastEnd(track) - (t + dur)) > 0.2) {
          throw new Error('Placement incorrect (clip ' + (i + 1) + ', morceau ' + (j + 1) + ' : attendu fin ' + (t + dur) + ', obtenu ' + lastEnd(track) + ').');
        }
        placed.push({ a: a, b: b, t: t, pi: cc.items[i].pi });
      }
    }

    // 4. si l'audio lié n'a pas suivi la vidéo, on le pose à part
    var warn = '';
    if (!useAudio && seq.audioTracks.numTracks > 0 && seq.audioTracks[0].clips.numItems === 0) {
      try {
        var at = seq.audioTracks[0];
        for (i = 0; i < placed.length; i++) {
          setMarks(placed[i].pi, placed[i].a, placed[i].b);
          PLACE[variant](at, placed[i].pi, placed[i].t);
        }
      } catch (e3) {
        warn = ' Attention : audio non posé automatiquement (' + e3.message + ').';
      }
    }

    // 5. on remet les marques d'origine des clips sources
    if (!restoreMarks(savedList)) warn += " Les marques IN/OUT d'un clip source n'ont pas pu être restaurées.";

    var total = lastEnd(track);
    return res(true, "Séquence '" + name + "' créée : " + placed.length + ' morceaux (' + cc.items.length + ' clip(s)), durée ' + Math.round(total) + ' s.' + warn);
  } catch (e) {
    try { restoreMarks(savedList); } catch (e2) {}
    return res(false, 'Erreur applyCuts : ' + e.message + ' (ligne ' + e.line + ')');
  }
}

// ---------- mode 2 : marqueurs sur la séquence active ----------
function setMarkerEnd(m, endSec) {
  var tries = [
    function () { m.end = endSec; },
    function () { var t = new Time(); t.seconds = endSec; m.end = t; },
    function () { m.end = String(Math.round(endSec * TICKS_PER_SECOND)); }
  ];
  var i, cur;
  for (i = 0; i < tries.length; i++) {
    try {
      tries[i]();
      cur = m.end;
      if (cur !== null && cur !== undefined) {
        cur = (typeof cur === 'object' && cur.seconds !== undefined) ? cur.seconds : parseFloat(cur);
        if (!isNaN(cur) && Math.abs(cur - endSec) < 0.05) return true;
      }
    } catch (e) {}
  }
  return false;
}

function applyMarkers(str) {
  try {
    var data = eval('(' + str + ')');
    var seq = app.project.activeSequence;
    if (!seq) return res(false, 'Aucune séquence active.');
    var cc = collectClips();
    if (!checkSameClips(cc, data.clips)) {
      return res(false, "La sélection a changé depuis l'analyse : relance « Analyser ».");
    }
    var n = 0;
    var noEnd = false;
    var i, j, it, gaps, base, m;
    for (i = 0; i < cc.items.length; i++) {
      it = cc.items[i].item;
      // temps timeline = début du clip + (temps source - IN du clip)
      base = it.start.seconds - it.inPoint.seconds;
      gaps = data.clips[i].gaps;
      for (j = 0; j < gaps.length; j++) {
        m = seq.markers.createMarker(base + gaps[j][0]);
        try { m.name = 'Silence'; } catch (e1) {}
        if (!setMarkerEnd(m, base + gaps[j][1])) noEnd = true;
        n++;
      }
    }
    return res(true, n + ' marqueur(s) « Silence » posé(s).' +
      (noEnd ? " (La durée des marqueurs n'a pas pu être réglée : ils marquent seulement le début de chaque silence.)" : ''));
  } catch (e) {
    return res(false, 'Erreur applyMarkers : ' + e.message + ' (ligne ' + e.line + ')');
  }
}
