/*!
 * cleave — VSCode-style side-by-side diff renderer. Zero dependencies.
 *
 *   Cleave.render(targetEl, { before, after, filename, language, ... })
 *
 * The target element must have a height (e.g. height:100vh, or a fixed px).
 * Multiple instances per page are fine (all lookups are scoped to the target).
 * Exposes: Cleave.render, Cleave.lineDiff, Cleave.version
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
    });
  }

  /* ---------- line-level diff (LCS) ----------
     Returns aligned rows: {t:'ctx'|'del'|'add'|'mod', l:string|null, r:string|null} */
  function rawLineOps(A, B) {
    var n = A.length, m = B.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (i = n - 1; i >= 0; i--)
      for (j = m - 1; j >= 0; j--)
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var ops = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { ops.push({ t: 'ctx', l: A[i], r: B[j] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', l: A[i], r: null }); i++; }
      else { ops.push({ t: 'add', l: null, r: B[j] }); j++; }
    }
    while (i < n) ops.push({ t: 'del', l: A[i++], r: null });
    while (j < m) ops.push({ t: 'add', l: null, r: B[j++] });
    return ops;
  }
  // Pair each del-run with the add-run that follows it into 'mod' rows so
  // word-level highlighting kicks in on replaced lines.
  function pairHunks(ops) {
    var out = [], i = 0, x;
    while (i < ops.length) {
      if (ops[i].t === 'del') {
        var dels = [], adds = [];
        while (i < ops.length && ops[i].t === 'del') dels.push(ops[i++]);
        while (i < ops.length && ops[i].t === 'add') adds.push(ops[i++]);
        var k = Math.min(dels.length, adds.length);
        for (x = 0; x < k; x++) out.push({ t: 'mod', l: dels[x].l, r: adds[x].r });
        for (x = k; x < dels.length; x++) out.push(dels[x]);
        for (x = k; x < adds.length; x++) out.push(adds[x]);
      } else out.push(ops[i++]);
    }
    return out;
  }
  function lineDiff(before, after) {
    return pairHunks(rawLineOps(String(before).split('\n'), String(after).split('\n')));
  }

  /* ---------- word-level diff (token LCS) ---------- */
  function toks(s) { return s.match(/\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) || []; }
  function wdiff(a, b) {
    var A = toks(a), B = toks(b), n = A.length, m = B.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (i = n - 1; i >= 0; i--)
      for (j = m - 1; j >= 0; j--)
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var L = [], R = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { L.push({ v: A[i], ch: 0 }); R.push({ v: B[j], ch: 0 }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { L.push({ v: A[i], ch: 1 }); i++; }
      else { R.push({ v: B[j], ch: 1 }); j++; }
    }
    while (i < n) L.push({ v: A[i++], ch: 1 });
    while (j < m) R.push({ v: B[j++], ch: 1 });
    return { L: L, R: R };
  }

  /* ---------- syntax highlighting (JS-flavored; pluggable) ----------
     A minimal tokenizer for C-family / JS code. For other languages pass
     language:'text' (or add your own highlighter via opts.highlight). */
  var KW = { 'const':1,'let':1,'var':1,'for':1,'of':1,'in':1,'if':1,'else':1,'return':1,
    'function':1,'continue':1,'break':1,'new':1,'true':1,'false':1,'null':1,'while':1,
    'class':1,'extends':1,'import':1,'export':1,'from':1,'await':1,'async':1,'throw':1,
    'try':1,'catch':1,'typeof':1,'instanceof':1,'switch':1,'case':1,'default':1,'do':1,'this':1 };
  var TOK = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\/\/[^\n]*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z0-9_$'"`])/g;
  function hiJS(src) {
    var out = '', m; TOK.lastIndex = 0;
    while ((m = TOK.exec(src))) {
      if (m[1]) out += '<span class="str">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="num">' + esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="num">' + esc(m[3]) + '</span>';
      else if (m[4]) {
        var w = m[4], after = src.slice(TOK.lastIndex, TOK.lastIndex + 1),
            before = src.slice(Math.max(0, m.index - 1), m.index);
        if (KW[w]) out += '<span class="k">' + w + '</span>';
        else if (after === '(') out += '<span class="fn">' + w + '</span>';
        else if (before === '.') out += '<span class="prop">' + w + '</span>';
        else if (/^[A-Z]/.test(w)) out += '<span class="ty">' + w + '</span>';
        else out += '<span class="pl">' + w + '</span>';
      }
      else if (m[5]) out += esc(m[5]);
      else out += '<span class="pl">' + esc(m[6]) + '</span>';
    }
    return out;
  }

  /* ---------- render ---------- */
  function render(target, opts) {
    if (typeof target === 'string') target = document.querySelector(target);
    if (!target) throw new Error('cleave: target element not found');
    opts = opts || {};
    var f = Object.assign(
      { minimap: true, connectors: true, carets: true, wordDiff: true, hover: true, syntax: true },
      opts.features || {});
    var rows = opts.rows || lineDiff(opts.before || '', opts.after || '');
    var lang = opts.language == null ? 'js' : String(opts.language).toLowerCase();
    var jsish = ['js','javascript','ts','typescript','jsx','tsx','json','c','cpp','java','go','rust','swift','kotlin'].indexOf(lang) >= 0;
    var hl = typeof opts.highlight === 'function' ? opts.highlight
           : (f.syntax && jsish) ? hiJS : esc;
    function code(s) { return hl(s); }

    var ADD = 0, DEL = 0, MOD = 0;
    rows.forEach(function (x) { if (x.t === 'add') ADD++; else if (x.t === 'del') DEL++; else if (x.t === 'mod') MOD++; });

    var fname = esc(opts.filename || 'diff');
    var sub = opts.subtitle != null ? esc(opts.subtitle) : 'side-by-side diff';
    var lLabel = esc(opts.leftLabel || 'Before'), rLabel = esc(opts.rightLabel || 'After');
    var lSub = opts.leftSub != null ? '&nbsp;<b>' + esc(opts.leftSub) + '</b>' : '';
    var rSub = opts.rightSub != null ? '&nbsp;<b>' + esc(opts.rightSub) + '</b>' : '';

    target.classList.add('cleave');
    if (!f.minimap) target.classList.add('no-minimap');
    if (!f.connectors) target.classList.add('no-conn');

    target.innerHTML =
      '<div class="titlebar"><div class="dots"><i></i><i></i><i></i></div>' +
        '<span class="fname"><b>' + fname + '</b></span><span class="sub">— ' + sub + '</span></div>' +
      '<div class="ribbon">' +
        '<div class="stat"><span class="n add js-add">+0</span><span class="l">insertions</span></div>' +
        '<div class="stat"><span class="n del js-del">−0</span><span class="l">deletions</span></div>' +
        '<div class="stat"><span class="n mod js-mod">~0</span><span class="l">modified</span></div>' +
        '<span class="spacer"></span>' +
        '<div class="legend">' +
          '<span><i class="sw a"></i>added</span><span><i class="sw d"></i>removed</span>' +
          (f.wordDiff ? '<span><i class="sw w"></i>changed words</span>' : '') +
          (f.carets ? '<span><span class="car">&#9656;</span> insertion point</span>' : '') +
          (f.connectors || f.minimap ? '<span>' + (f.connectors ? 'connector band' : '') +
            (f.connectors && f.minimap ? ' + ' : '') + (f.minimap ? 'minimap &rarr;' : '') + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="heads"><div class="h">' + lLabel + lSub + '</div>' +
        '<div class="h mid">' + (f.connectors ? 'where' : '') + '</div>' +
        '<div class="h r">' + rLabel + rSub + '</div></div>' +
      '<div class="stage"><div class="editor"><div class="grid">' +
        '<div class="pane paneL"></div>' +
        '<div class="conn"><svg class="csvg" preserveAspectRatio="none"></svg></div>' +
        '<div class="pane paneR"></div>' +
      '</div></div><div class="minimap"><div class="mm-view"></div></div></div>';

    var q = function (s) { return target.querySelector(s); };
    q('.js-add').textContent = '+' + ADD;
    q('.js-del').textContent = '−' + DEL;
    q('.js-mod').textContent = '~' + MOD;

    // word-diff side renderer: changed runs get .chg (bg), unchanged runs get syntax
    function renderWL(parts, delSide) {
      var html = '', run = '', runch = parts.length ? parts[0].ch : 0;
      function flush() {
        if (!run) return;
        if (runch) html += '<span class="chg' + (delSide ? ' del' : '') + '">' + esc(run) + '</span>';
        else html += code(run);
        run = '';
      }
      parts.forEach(function (p) { if (p.ch !== runch) { flush(); runch = p.ch; } run += p.v; });
      flush();
      return html;
    }

    var paneL = q('.paneL'), paneR = q('.paneR');
    var hlL = [], hlR = [], ln = 0, rn = 0;
    rows.forEach(function (x) {
      var cls = 'r-' + x.t, lc, rc, wd;
      // LEFT
      if (x.l !== null) {
        ln++;
        if (x.t === 'mod' && f.wordDiff) { wd = wdiff(x.l, x.r); lc = '<span class="mk">~</span>' + renderWL(wd.L, true); }
        else if (x.t === 'mod') lc = '<span class="mk">~</span>' + code(x.l);
        else if (x.t === 'del') lc = '<span class="mk">−</span>' + code(x.l);
        else lc = code(x.l);
        hlL.push('<div class="g ' + cls + '">' + ln + '</div>');
        hlL.push('<div class="c cl ' + (x.t === 'mod' && f.wordDiff ? 'wl ' : '') + cls + '">' + lc + '</div>');
      } else {
        hlL.push('<div class="g ' + cls + ' r-pad">' + (f.carets ? '<span class="caret a">▶</span>' : '') + '</div>');
        hlL.push('<div class="c ' + cls + ' r-pad"></div>');
      }
      // RIGHT
      if (x.r !== null) {
        rn++;
        if (x.t === 'mod' && f.wordDiff) { wd = wd || wdiff(x.l, x.r); rc = '<span class="mk">~</span>' + renderWL(wd.R, false); }
        else if (x.t === 'mod') rc = '<span class="mk">~</span>' + code(x.r);
        else if (x.t === 'add') rc = '<span class="mk">+</span>' + code(x.r);
        else rc = code(x.r);
        hlR.push('<div class="g ' + cls + '">' + rn + '</div>');
        hlR.push('<div class="c ' + ((x.t === 'add' || (x.t === 'mod' && f.wordDiff)) ? 'wl ' : '') + cls + '">' + rc + '</div>');
      } else {
        hlR.push('<div class="g ' + cls + ' r-pad">' + (f.carets ? '<span class="caret d">◀</span>' : '') + '</div>');
        hlR.push('<div class="c ' + cls + ' r-pad"></div>');
      }
    });
    paneL.innerHTML = hlL.join('');
    paneR.innerHTML = hlR.join('');
    [paneL, paneR].forEach(function (p) {
      var kids = p.children;
      for (var i = 0; i < kids.length; i++) kids[i].setAttribute('data-row', Math.floor(i / 2));
    });

    var ROWH = 22, editor = q('.editor'), grid = q('.grid');

    // ----- connector bands -----
    if (f.connectors) {
      var regions = [], cur = null;
      rows.forEach(function (x, idx) {
        if (x.t === 'ctx') { if (cur) { regions.push(cur); cur = null; } return; }
        if (!cur) cur = { a: idx, b: idx, left: false, right: false };
        cur.b = idx;
        if (x.l !== null && x.t !== 'add') cur.left = true;
        if (x.r !== null && x.t !== 'del') cur.right = true;
      });
      if (cur) regions.push(cur);

      var svg = q('.csvg'), W = 96, total = rows.length * ROWH, paths = '';
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + total);
      regions.forEach(function (rg) {
        var color = rg.left && rg.right ? { f: 'var(--mod-band)', s: 'var(--mod)' }
          : rg.right ? { f: 'var(--add-band)', s: 'var(--add)' }
          : { f: 'var(--del-band)', s: 'var(--del)' };
        var top = rg.a * ROWH, bot = (rg.b + 1) * ROWH, mid = (top + bot) / 2, c = W * 0.5, lt, lb, rt, rb;
        if (rg.left) { lt = top; lb = bot; } else { lt = lb = mid; }
        if (rg.right) { rt = top; rb = bot; } else { rt = rb = mid; }
        paths += '<path d="M0 ' + lt + ' C ' + c + ' ' + lt + ' ' + c + ' ' + rt + ' ' + W + ' ' + rt +
          ' L ' + W + ' ' + rb + ' C ' + c + ' ' + rb + ' ' + c + ' ' + lb + ' 0 ' + lb + ' Z" fill="' + color.f + '"/>';
        paths += '<path d="M0 ' + lt + ' C ' + c + ' ' + lt + ' ' + c + ' ' + rt + ' ' + W + ' ' + rt + '" fill="none" stroke="' + color.s + '" stroke-opacity=".55" stroke-width="1"/>';
        paths += '<path d="M0 ' + lb + ' C ' + c + ' ' + lb + ' ' + c + ' ' + rb + ' ' + W + ' ' + rb + '" fill="none" stroke="' + color.s + '" stroke-opacity=".55" stroke-width="1"/>';
      });
      svg.innerHTML = paths;
    }

    // ----- minimap -----
    if (f.minimap) {
      var minimap = q('.minimap'), mmview = q('.mm-view');
      var layoutMinimap = function () {
        var sh = editor.scrollHeight || 1;
        [].slice.call(minimap.querySelectorAll('.mm-tick')).forEach(function (n) { n.remove(); });
        rows.forEach(function (x, idx) {
          if (x.t === 'ctx') return;
          var d = document.createElement('div');
          d.className = 'mm-tick ' + (x.t === 'mod' ? 'mod' : x.t);
          d.style.top = (idx * ROWH / sh * 100) + '%';
          d.style.height = Math.max(3, (ROWH / sh * 100)) + '%';
          minimap.appendChild(d);
        });
      };
      var syncView = function () {
        var sh = editor.scrollHeight || 1;
        mmview.style.height = (editor.clientHeight / sh * 100) + '%';
        mmview.style.top = (editor.scrollTop / sh * 100) + '%';
      };
      layoutMinimap(); syncView();
      editor.addEventListener('scroll', syncView, { passive: true });
      window.addEventListener('resize', function () { layoutMinimap(); syncView(); });
      minimap.addEventListener('click', function (e) {
        var r = minimap.getBoundingClientRect();
        editor.scrollTop = (e.clientY - r.top) / r.height * editor.scrollHeight - editor.clientHeight / 2;
      });
    }

    // ----- hover: same logical row across both panes -----
    if (f.hover) {
      var lastRow = null;
      var clearHover = function () {
        if (lastRow === null) return;
        [].slice.call(grid.querySelectorAll('.hoverrow')).forEach(function (n) { n.classList.remove('hoverrow'); });
        lastRow = null;
      };
      grid.addEventListener('mousemove', function (e) {
        var cell = e.target.closest ? e.target.closest('[data-row]') : null;
        var row = cell ? cell.getAttribute('data-row') : null;
        if (row === lastRow) return;
        clearHover();
        if (row !== null) {
          lastRow = row;
          [].slice.call(grid.querySelectorAll('[data-row="' + row + '"]')).forEach(function (n) { n.classList.add('hoverrow'); });
        }
      });
      grid.addEventListener('mouseleave', clearHover);
    }

    return { rows: rows, stats: { add: ADD, del: DEL, mod: MOD } };
  }

  var Cleave = { render: render, lineDiff: lineDiff, version: '1.0.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = Cleave;
  global.Cleave = Cleave;
})(typeof window !== 'undefined' ? window : this);
