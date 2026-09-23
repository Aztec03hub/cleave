/*!
 * cleave: VSCode-style diff renderer (side-by-side or unified). Zero dependencies.
 *
 *   Cleave.render(targetEl, { before, after, filename, language, ... })
 *
 * The target element must have a height (e.g. height:100vh, or a fixed px).
 * Multiple instances per page are fine (all lookups are scoped to the target);
 * rendering into the same element again cleans up the previous instance.
 * Exposes: Cleave.render, Cleave.lineDiff, Cleave.langFromFilename, Cleave.version
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }
  function wsKey(s) { return s.replace(/\s+/g, ' ').trim(); }
  function idKey(s) { return s; }
  function noWsKey(s) { return s.replace(/\s+/g, ''); }   // ignore-whitespace compares like git diff -w

  /* ---------- line-level diff (LCS) ----------
     Returns aligned rows: {t:'ctx'|'del'|'add'|'mod', l:string|null, r:string|null,
     mv?:id (moved block), pair?:string (counterpart of a line changed inside a move), pc?:1} */
  function rawLineOps(A, B, key) {
    var KA = A.map(key), KB = B.map(key), n = A.length, m = B.length, s = 0, e = 0, i, j, ops = [];
    // unchanged top and bottom never enter the O(N*M) table
    while (s < n && s < m && KA[s] === KB[s]) s++;
    while (e < n - s && e < m - s && KA[n - 1 - e] === KB[m - 1 - e]) e++;
    for (i = 0; i < s; i++) ops.push({ t: 'ctx', l: A[i], r: B[i] });
    var a0 = s, b0 = s, N = n - s - e, M = m - s - e, dp = [];
    // ponytail: O(N*M) LCS over the changed middle; Myers if huge rewrites ever matter
    for (i = 0; i <= N; i++) dp.push(new Uint32Array(M + 1));
    for (i = N - 1; i >= 0; i--)
      for (j = M - 1; j >= 0; j--)
        dp[i][j] = KA[a0 + i] === KB[b0 + j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    i = 0; j = 0;
    while (i < N && j < M) {
      if (KA[a0 + i] === KB[b0 + j]) { ops.push({ t: 'ctx', l: A[a0 + i], r: B[b0 + j] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', l: A[a0 + i], r: null }); i++; }
      else { ops.push({ t: 'add', l: null, r: B[b0 + j] }); j++; }
    }
    while (i < N) ops.push({ t: 'del', l: A[a0 + i++], r: null });
    while (j < M) ops.push({ t: 'add', l: null, r: B[b0 + j++] });
    for (i = 0; i < e; i++) ops.push({ t: 'ctx', l: A[n - e + i], r: B[m - e + i] });
    return ops;
  }

  // Similarity of two lines: shared non-whitespace characters, 0..1.
  var SIM = 0.4;
  function sim(a, b) {
    var na = a.replace(/\s/g, '').length, nb = b.replace(/\s/g, '').length, same = 0;
    if (!na || !nb) return na === nb ? 1 : 0;
    wdiff(a, b).L.forEach(function (p) { if (!p.ch) same += p.v.replace(/\s/g, '').length; });
    return 2 * same / (na + nb);
  }

  // Within each changed hunk, pair deleted and added lines into 'mod' rows, aligned in
  // order to maximise total similarity; a pair needs similarity >= SIM, so unrelated
  // replacements stay a red block then a green block. Moved rows stay in the hunk (so
  // each side keeps its order) but never pair.
  function pairHunks(ops) {
    var out = [], i = 0;
    while (i < ops.length) {
      if (ops[i].t === 'ctx') { out.push(ops[i++]); continue; }
      var D = [], A = [], n, m, d, a;
      while (i < ops.length && ops[i].t !== 'ctx') (ops[i].t === 'del' ? D : A).push(ops[i++]);
      n = D.length; m = A.length;
      // ponytail: O(n*m) similarity alignment per hunk; huge hunks skip pairing
      if (n * m > 4000) { out.push.apply(out, D.concat(A)); continue; }
      var S = [], best = [];
      for (d = 0; d <= n; d++) { S.push([]); best.push(new Array(m + 1).fill(0)); }
      for (d = n - 1; d >= 0; d--)
        for (a = m - 1; a >= 0; a--) {
          var s = S[d][a] = D[d].mv || A[a].mv ? 0 : sim(D[d].l, A[a].r);
          best[d][a] = Math.max(best[d + 1][a], best[d][a + 1], s >= SIM ? s + best[d + 1][a + 1] : 0);
        }
      d = 0; a = 0;
      while (d < n && a < m) {
        if (S[d][a] >= SIM && best[d][a] === S[d][a] + best[d + 1][a + 1]) {
          var l = D[d++].l, r = A[a++].r;
          out.push({ t: l === r ? 'ctx' : 'mod', l: l, r: r });
        }
        else if (best[d][a] === best[d + 1][a]) out.push(D[d++]);
        else out.push(A[a++]);
      }
      while (d < n) out.push(D[d++]);
      while (a < m) out.push(A[a++]);
    }
    return out;
  }

  function lcsPairs(X, Y) {
    var n = X.length, m = Y.length, i, j, dp = [], out = [];
    for (i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
    for (i = n - 1; i >= 0; i--)
      for (j = m - 1; j >= 0; j--)
        dp[i][j] = X[i] === Y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    for (i = 0, j = 0; i < n && j < m;) {
      if (X[i] === Y[j]) { out.push([i++, j++]); }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
    }
    return out;
  }

  // Moved blocks. Rows of one move share an `mv` id on both sides.
  //  1. with changes: a deleted run and an added run in DIFFERENT hunks whose lines
  //     mostly match (LCS density >= 0.6, >= 3 matches). Lines that differ inside get
  //     `pair` (their counterpart) and `pc`, so they render amber with word highlights.
  //     Runs first so an edited block is not split into several exact fragments.
  //  2. exact: a run of deleted lines reappearing as a run of added lines (whitespace
  //     ignored). >= 2 lines, one with 8+ chars, so lone braces never count.
  //  3. a closing bracket line right after both ends of a move joins the move.
  // ponytail: O(dels*adds) scans, fine for file-sized diffs
  var BRACE = /^[\]\)\}]+[;,]?$/;
  function detectMoves(ops) {
    var key = wsKey, id = 0, i, j, k, x, solid;
    var runs = [], h = 0, cur = null;
    ops.forEach(function (o, idx) {
      if (o.t === 'ctx') { h++; cur = null; return; }
      if (o.mv) { cur = null; return; }
      if (!cur || cur.t !== o.t) runs.push(cur = { t: o.t, h: h, idx: [] });
      cur.idx.push(idx);
    });
    runs.forEach(function (D) {
      if (D.t !== 'del' || D.used) return;
      var best = null;
      runs.forEach(function (A) {
        if (A.t !== 'add' || A.used || A.h === D.h || D.idx.length * A.idx.length > 40000) return;
        var m = lcsPairs(D.idx.map(function (q) { return key(ops[q].l); }), A.idx.map(function (q) { return key(ops[q].r); }));
        if (m.length < 3) return;
        var sol = m.filter(function (p) { return key(ops[D.idx[p[0]]].l).length >= 8; }).length;
        var sd = m[m.length - 1][0] - m[0][0] + 1, sa = m[m.length - 1][1] - m[0][1] + 1;
        if (sol < 2 || 2 * m.length / (sd + sa) < 0.6) return;
        if (!best || m.length > best.m.length) best = { A: A, m: m };
      });
      if (!best) return;
      var A = best.A, m = best.m, q, u;
      // blank lines at either edge are not part of the block
      while (m.length > 2 && !key(ops[D.idx[m[0][0]]].l)) m.shift();
      while (m.length > 2 && !key(ops[D.idx[m[m.length - 1][0]]].l)) m.pop();
      D.used = A.used = true; id++;
      for (q = m[0][0]; q <= m[m.length - 1][0]; q++) ops[D.idx[q]].mv = id;
      for (q = m[0][1]; q <= m[m.length - 1][1]; q++) ops[A.idx[q]].mv = id;
      for (q = 0; q + 1 < m.length; q++) {
        var gd = [], ga = [];
        for (u = m[q][0] + 1; u < m[q + 1][0]; u++) gd.push(ops[D.idx[u]]);
        for (u = m[q][1] + 1; u < m[q + 1][1]; u++) ga.push(ops[A.idx[u]]);
        for (u = 0; u < Math.min(gd.length, ga.length); u++)
          if (sim(gd[u].l, ga[u].r) >= SIM) { gd[u].pair = ga[u].r; ga[u].pair = gd[u].l; gd[u].pc = ga[u].pc = 1; }
      }
    });

    // exact moves among what is left
    for (i = 0; i < ops.length; i++) {
      if (ops[i].t !== 'del' || ops[i].mv || !key(ops[i].l)) continue;
      for (j = 0; j < ops.length; j++) {
        if (ops[j].t !== 'add' || ops[j].mv || key(ops[j].r) !== key(ops[i].l)) continue;
        for (k = 0; i + k < ops.length && j + k < ops.length && ops[i + k].t === 'del' && ops[j + k].t === 'add' &&
             !ops[i + k].mv && !ops[j + k].mv && key(ops[i + k].l) === key(ops[j + k].r); k++);
        while (k && !key(ops[i + k - 1].l)) k--;
        for (solid = 0, x = 0; x < k; x++) if (key(ops[i + x].l).length >= 8) solid++;
        if (k < 2 || !solid) continue;
        id++;
        for (x = 0; x < k; x++) { ops[i + x].mv = id; ops[j + x].mv = id; }
        i += k - 1;
        break;
      }
    }

    // closing bracket: the next line each side consumes after a move's end. On each side
    // it is either an unmoved row of that side's type right after the block (just join
    // it) or an unchanged row further on (split it: its line joins the move, its partner
    // on the other side becomes a plain del/add).
    var ends = {}, after = {}, rep = {}, busy = {};
    ops.forEach(function (o, idx) { if (o.mv) { var e = ends[o.mv] = ends[o.mv] || {}; e[o.t] = idx; } });
    function next(from, t, other) {
      var q = from + 1;
      if (ops[q] && ops[q].t === t && !ops[q].mv) return { q: q, direct: 1 };
      for (; q < ops.length; q++) {
        if (ops[q].t === 'ctx') return { q: q };
        if (ops[q].t !== other || ops[q].mv) return null;
      }
      return null;
    }
    Object.keys(ends).forEach(function (mid) {
      var e = ends[mid];
      if (e.del == null || e.add == null) return;
      var L = next(e.del, 'del', 'add'), R = next(e.add, 'add', 'del');
      if (!L || !R || L.q === R.q || busy[L.q] || busy[R.q] || busy[e.del] || busy[e.add]) return;
      var lt = ops[L.q].l, rt = ops[R.q].r;
      if (!BRACE.test(key(lt)) || key(lt) !== key(rt)) return;
      busy[L.q] = busy[R.q] = busy[e.del] = busy[e.add] = 1;
      if (L.direct) ops[L.q].mv = +mid;
      else { after[e.del] = { t: 'del', l: lt, r: null, mv: +mid }; rep[L.q] = { t: 'add', l: null, r: ops[L.q].r }; }
      if (R.direct) ops[R.q].mv = +mid;
      else { after[e.add] = { t: 'add', l: null, r: rt, mv: +mid }; rep[R.q] = { t: 'del', l: ops[R.q].l, r: null }; }
    });
    var out = [];
    ops.forEach(function (o, idx) { out.push(rep[idx] || o); if (after[idx]) out.push(after[idx]); });
    return out;
  }

  function lineDiff(before, after, o) {
    o = o || {};
    var a = String(before == null ? '' : before).replace(/\r\n?/g, '\n'),
        b = String(after == null ? '' : after).replace(/\r\n?/g, '\n');
    // a trailing newline both files end with (or an empty file) terminates the last
    // line; it is not a line of its own
    var ta = /\n$/.test(a), tb = /\n$/.test(b);
    if ((ta || !a) && (tb || !b)) { if (ta) a = a.slice(0, -1); if (tb) b = b.slice(0, -1); }
    var A = a === '' ? [] : a.split('\n'), B = b === '' ? [] : b.split('\n');
    return pairHunks(detectMoves(rawLineOps(A, B, o.ignoreWhitespace ? noWsKey : idKey)));
  }

  /* ---------- word-level diff (token LCS) ---------- */
  function toks(s) { return s.match(/\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) || []; }
  function wdiff(a, b, ignoreWs) {
    var A = toks(a), B = toks(b), n = A.length, m = B.length, i, j;
    var k = function (t) { return ignoreWs && /^\s/.test(t) ? ' ' : t; };
    var dp = [];
    for (i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
    for (i = n - 1; i >= 0; i--)
      for (j = m - 1; j >= 0; j--)
        dp[i][j] = k(A[i]) === k(B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var L = [], R = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (k(A[i]) === k(B[j])) { L.push({ v: A[i], ch: 0 }); R.push({ v: B[j], ch: 0 }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { L.push({ v: A[i], ch: 1 }); i++; }
      else { R.push({ v: B[j], ch: 1 }); j++; }
    }
    while (i < n) L.push({ v: A[i++], ch: 1 });
    while (j < m) R.push({ v: B[j++], ch: 1 });
    return { L: L, R: R };
  }
  // per-character changed flags for one side of a line against its counterpart
  function wflags(s, other, left, ignoreWs) {
    var w = left ? wdiff(s, other, ignoreWs) : wdiff(other, s, ignoreWs), fl = [], k = 0;
    (left ? w.L : w.R).forEach(function (p) { for (var q = 0; q < p.v.length; q++) fl[k++] = p.ch; });
    return fl;
  }

  /* ---------- syntax highlighting ----------
     A small tokenizer driven by a per-language table (keywords, line comment, block
     comments). Block-comment state carries across lines. opts.highlight overrides it. */
  function words(s) { var o = {}; s.split(' ').forEach(function (w) { o[w] = 1; }); return o; }
  var CK = 'if else for while do switch case default break continue return new this true false null try catch finally throw class extends import export static ';
  var LANGS = {
    js: { kw: words(CK + 'const let var of in function await async typeof instanceof from yield delete void undefined super get set'), line: '//', block: 1 },
    ts: { kw: words(CK + 'const let var of in function await async typeof instanceof from yield delete void undefined super get set interface type enum implements private public protected readonly declare namespace abstract as keyof'), line: '//', block: 1 },
    py: { kw: words('def class return if elif else for while in not and or is None True False import from as with try except finally raise lambda yield pass break continue global nonlocal async await del assert self'), line: '#' },
    go: { kw: words('func package import return if else for range switch case default break continue go defer chan map struct interface type var const nil true false select fallthrough goto'), line: '//', block: 1 },
    rust: { kw: words('fn let mut pub use mod struct enum impl trait return if else for while loop match in as ref move self Self true false None Some Ok Err crate super where const static async await dyn unsafe type'), line: '//', block: 1 },
    c: { kw: words(CK + 'int char float double void long short unsigned signed struct union enum typedef const sizeof goto extern NULL auto bool namespace using template typename public private protected virtual override nullptr delete'), line: '//', block: 1 },
    java: { kw: words(CK + 'public private protected final void int long boolean double float char byte short package interface implements throws abstract var val fun when is as object override data sealed internal super func let guard struct enum'), line: '//', block: 1 },
    sh: { kw: words('if then else elif fi for in do done while until case esac function return local export exit set unset source'), line: '#' },
    rb: { kw: words('def end class module if elsif else unless while until for in do return yield nil true false self require begin rescue ensure then'), line: '#' },
    sql: { kw: words('select from where and or not insert into values update set delete create table drop alter join left right inner outer on as group by order having limit null is in like distinct union all primary key foreign references index'), line: '--', block: 1, ci: 1 },
    css: { kw: {}, block: 1 },
    json: { kw: words('true false null') },
    yaml: { kw: words('true false null yes no'), line: '#' }
  };
  var ALIAS = { javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', typescript: 'ts', tsx: 'ts', python: 'py',
    golang: 'go', rs: 'rust', h: 'c', cpp: 'c', cc: 'c', cxx: 'c', hpp: 'c', 'c++': 'c', cs: 'java', csharp: 'java',
    kotlin: 'java', kt: 'java', swift: 'java', scala: 'java', dart: 'java', bash: 'sh', zsh: 'sh', shell: 'sh',
    ruby: 'rb', yml: 'yaml', scss: 'css', less: 'css', toml: 'yaml', ini: 'yaml', dockerfile: 'sh', makefile: 'sh' };
  function langKey(s) { s = String(s || '').toLowerCase(); s = ALIAS[s] || s; return LANGS[s] ? s : 'text'; }
  function langFromFilename(name) {
    var b = String(name || '').split(/[\\/]/).pop().toLowerCase(), m = /\.([^.]+)$/.exec(b);
    return langKey(m ? m[1] : b);
  }
  function segs(src, L, st) {
    if (!L) return [['', src]];
    var out = [], i = 0, n = src.length, m, rest;
    while (i < n) {
      if (st.block) {
        var end = src.indexOf('*/', i);
        if (end < 0) { out.push(['cm', src.slice(i)]); return out; }
        out.push(['cm', src.slice(i, end + 2)]); i = end + 2; st.block = 0; continue;
      }
      rest = src.slice(i);
      if (L.block && rest.lastIndexOf('/*', 0) === 0) { st.block = 1; out.push(['cm', '/*']); i += 2; continue; }
      if (L.line && rest.lastIndexOf(L.line, 0) === 0) { out.push(['cm', rest]); break; }
      if ((m = /^(?:'(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?|`(?:[^`\\]|\\.)*`?)/.exec(rest))) { out.push(['str', m[0]]); i += m[0].length; continue; }
      if ((m = /^\d[\w.]*/.exec(rest))) { out.push(['num', m[0]]); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_$][\w$]*/.exec(rest))) {
        var w = m[0], nx = src.charAt(i + w.length), pv = src.charAt(i - 1);
        out.push([L.kw[L.ci ? w.toLowerCase() : w] ? 'k' : nx === '(' ? 'fn' : pv === '.' ? 'prop' : /^[A-Z]/.test(w) ? 'ty' : 'pl', w]);
        i += w.length; continue;
      }
      if ((m = /^\s+/.exec(rest))) { out.push(['', m[0]]); i += m[0].length; continue; }
      out.push(['pl', src.charAt(i)]); i++;
    }
    return out;
  }
  // segments -> html, wrapping characters flagged as changed in .chg
  function paint(sg, flags) {
    var html = '', pos = 0, open = false;
    sg.forEach(function (s) {
      var t = s[1], a = 0;
      while (a < t.length) {
        var fl = flags ? flags[pos + a] || 0 : 0, b = a + 1;
        while (b < t.length && (flags ? flags[pos + b] || 0 : 0) === fl) b++;
        if (fl && !open) { html += '<span class="chg">'; open = true; }
        if (!fl && open) { html += '</span>'; open = false; }
        var piece = esc(t.slice(a, b));
        html += s[0] ? '<span class="' + s[0] + '">' + piece + '</span>' : piece;
        a = b;
      }
      pos += t.length;
    });
    return open ? html + '</span>' : html;
  }

  /* ---------- render ---------- */
  var MK = { mod: '~', del: '&minus;', add: '+' }, CTX = 3, MINFOLD = 4;
  function render(target, opts) {
    if (typeof target === 'string') target = document.querySelector(target);
    if (!target) throw new Error('cleave: target element not found');
    if (target._cleave) target._cleave.destroy();
    opts = opts || {};
    var f = Object.assign({ minimap: true, connectors: true, carets: true, wordDiff: true, hover: true, syntax: true, toolbar: true },
      opts.features || {});
    var S = { view: opts.view === 'unified' ? 'unified' : 'split', collapse: opts.collapse !== false,
              ignoreWs: !!opts.ignoreWhitespace, open: {}, sel: 0, nav: -1 };
    var ac = new AbortController(), ro = null;
    var on = function (el, ev, fn, o) { el.addEventListener(ev, fn, Object.assign({ signal: ac.signal }, o || {})); };
    var api = { rows: null, stats: null, destroy: function () { ac.abort(); if (ro) ro.disconnect(); if (target._cleave === api) delete target._cleave; } };
    target._cleave = api;

    var custom = typeof opts.highlight === 'function' ? opts.highlight : null;
    var LANG = f.syntax && !custom ? LANGS[opts.language != null ? langKey(opts.language) : langFromFilename(opts.filename)] : null;

    /* --- model --- */
    var rows, lnAt, rnAt, moves, segL, segR, hunks, st;
    function compute() {
      rows = opts.rows || lineDiff(opts.before, opts.after, { ignoreWhitespace: S.ignoreWs });
      lnAt = []; rnAt = []; moves = {}; segL = []; segR = []; hunks = [];
      st = { add: 0, del: 0, mod: 0, move: 0 };
      var ln = 0, rn = 0, sl = {}, sr = {}, h = null;
      rows.forEach(function (x, i) {
        lnAt.push(x.l !== null ? ++ln : 0); rnAt.push(x.r !== null ? ++rn : 0);
        if (x.l !== null) segL[i] = segs(x.l, LANG, sl);
        if (x.r !== null) segR[i] = segs(x.r, LANG, sr);
        if (x.t === 'ctx') { h = null; return; }
        if (!h) hunks.push(h = { a: i, b: i }); h.b = i;
        if (x.mv) {
          var m = moves[x.mv] = moves[x.mv] || { la: -1, lb: -1, ra: -1, rb: -1, changed: 0 };
          if (x.t === 'del') { if (m.la < 0) m.la = i; m.lb = i; st.move++; } else { if (m.ra < 0) m.ra = i; m.rb = i; }
          if (x.pc) m.changed = 1;
        } else st[x.t]++;
      });
      Object.keys(moves).forEach(function (id) { if (moves[id].la < 0 || moves[id].ra < 0) delete moves[id]; });
      api.rows = rows; api.stats = st;
    }

    /* --- display list: rows (or unified lines) plus folds of unchanged runs --- */
    var items, posL, posR;
    function layout() {
      items = []; posL = []; posR = [];
      var n = rows.length, i = 0, k;
      var emit = function (r) {
        var x = rows[r];
        if (S.view === 'split' || x.t === 'ctx') { posL[r] = posR[r] = items.length; items.push({ i: r, s: 'B' }); return; }
        if (x.l !== null) { posL[r] = items.length; items.push({ i: r, s: 'L' }); }
        if (x.r !== null) { posR[r] = items.length; items.push({ i: r, s: 'R' }); }
      };
      while (i < n) {
        if (rows[i].t !== 'ctx') { emit(i++); continue; }
        var a = i; while (i < n && rows[i].t === 'ctx') i++;
        var b = i - 1, h0 = a === 0 ? 0 : a + CTX, h1 = b === n - 1 ? b : b - CTX;
        if (S.collapse && h1 - h0 + 1 >= MINFOLD && !S.open[h0]) {
          for (k = a; k < h0; k++) emit(k);
          items.push({ fold: [h0, h1] });
          for (k = h1 + 1; k <= b; k++) emit(k);
        } else for (k = a; k <= b; k++) emit(k);
      }
    }
    function posOfRow(r) {
      if (posL[r] != null) return posL[r];
      if (posR[r] != null) return posR[r];
      for (var p = 0; p < items.length; p++) if (items[p].fold && items[p].fold[0] <= r && r <= items[p].fold[1]) return p;
      return 0;
    }

    /* --- static chrome --- */
    var fname = esc(opts.filename || 'diff');
    var sub = opts.subtitle != null ? esc(opts.subtitle) : 'diff';
    var lLabel = esc(opts.leftLabel || 'Before'), rLabel = esc(opts.rightLabel || 'After');
    var lSub = opts.leftSub != null ? '&nbsp;<b>' + esc(opts.leftSub) + '</b>' : '';
    var rSub = opts.rightSub != null ? '&nbsp;<b>' + esc(opts.rightSub) + '</b>' : '';
    if (opts.tabSize) target.style.setProperty('--tab', opts.tabSize);

    target.classList.add('cleave');
    target.classList.toggle('no-minimap', !f.minimap);
    target.innerHTML =
      '<div class="titlebar"><div class="dots"><i></i><i></i><i></i></div>' +
        '<span class="fname"><b>' + fname + '</b></span><span class="sub">&middot; ' + sub + '</span></div>' +
      '<div class="ribbon"><div class="stats"></div>' +
        (f.toolbar ? '<div class="tools">' +
          '<button type="button" class="tb nav-prev" title="Previous change (Shift+F7 / Alt+Up)" aria-label="Previous change">&#8593;</button>' +
          '<span class="navpos" aria-live="polite"></span>' +
          '<button type="button" class="tb nav-next" title="Next change (F7 / Alt+Down)" aria-label="Next change">&#8595;</button>' +
          '<button type="button" class="tb t-view" aria-pressed="false" title="Toggle unified view">unified</button>' +
          '<button type="button" class="tb t-fold" aria-pressed="false" title="Fold long unchanged runs">collapse unchanged</button>' +
          (opts.rows ? '' : '<button type="button" class="tb t-ws" aria-pressed="false" title="Ignore whitespace changes">ignore whitespace</button>') +
        '</div>' : '') +
        '<span class="spacer"></span>' +
        '<div class="legend">' +
          '<span><i class="sw a"></i>added</span><span><i class="sw d"></i>removed</span>' +
          '<span><i class="sw m"></i>modified</span><span><i class="sw v"></i>&raquo; moved</span>' +
          (f.wordDiff ? '<span><i class="sw w"></i>changed words</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="stage"><div class="editor" tabindex="0" aria-label="diff"></div>' +
        '<div class="minimap" tabindex="0" role="scrollbar" aria-label="minimap" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
        '<canvas></canvas><div class="mm-view"></div></div></div>';

    var q = function (s) { return target.querySelector(s); };
    var editor = q('.editor'), minimap = q('.minimap'), canvas = q('.minimap canvas'), view = q('.mm-view');
    var ROWH = 22, grid, heads;
    var hh = function () { return heads ? heads.offsetHeight : 0; };

    /* --- cells --- */
    function cls(x) { return 'r-' + x.t + (x.mv ? ' r-mv' : '') + (x.pc ? ' r-pc' : ''); }
    function mark(x) { var k = x.pc ? '~' : x.mv ? '&raquo;' : MK[x.t]; return k ? '<span class="mk">' + k + '</span>' : ''; }
    function text(i, side) {
      var x = rows[i], s = side === 'L' ? x.l : x.r, other = null;
      if (f.wordDiff && side !== 'B') {
        if (x.t === 'mod') other = side === 'L' ? x.r : x.l;
        else if (x.pair != null) other = x.pair;
      }
      if (custom) {
        if (other == null) return custom(s);
        var w = side === 'L' ? wdiff(s, other, S.ignoreWs).L : wdiff(other, s, S.ignoreWs).R;
        return w.map(function (p) { return p.ch ? '<span class="chg">' + esc(p.v) + '</span>' : custom(p.v); }).join('');
      }
      return paint(side === 'L' ? segL[i] : segR[i], other == null ? null : wflags(s, other, side === 'L', S.ignoreWs));
    }
    function tip(x) {
      var m = x.mv && moves[x.mv];
      if (!m) return '';
      var to = x.t === 'del', a = to ? rnAt[m.ra] : lnAt[m.la], b = to ? rnAt[m.rb] : lnAt[m.lb];
      return ' title="moved' + (m.changed ? ' with changes' : '') + (to ? ' to' : ' from') + ' line' + (a === b ? ' ' + a : 's ' + a + '-' + b) + '"';
    }
    function line(i, side, p) {
      var x = rows[i], c = cls(x), at = ' data-p="' + p + '"' + (x.mv ? ' data-mv="' + x.mv + '"' : '');
      var num = S.view === 'unified'
        ? '<span class="n1">' + (side !== 'R' ? lnAt[i] : '') + '</span><span class="n2">' + (side !== 'L' ? rnAt[i] : '') + '</span>'
        : side === 'L' ? lnAt[i] : rnAt[i];
      return '<div class="g ' + c + '"' + at + tip(x) + '>' + num + '</div>' +
             '<div class="c ' + c + '"' + at + ' data-side="' + side + '">' + (side === 'B' ? '' : mark(x)) + text(i, side === 'B' ? 'R' : side) + '</div>';
    }
    function pad(i, side, p) {
      var c = 'r-' + rows[i].t + ' r-pad', at = ' data-p="' + p + '"';
      var car = f.carets ? '<span class="caret ' + (side === 'L' ? 'a">&#9654;' : 'd">&#9664;') + '</span>' : '';
      return '<div class="g ' + c + '"' + at + '>' + car + '</div><div class="c ' + c + '"' + at + '></div>';
    }
    function foldBtn(fd) {
      var n = fd[1] - fd[0] + 1;
      return '<button type="button" class="fold" data-fold="' + fd[0] + '">&#8943; ' + n + ' unchanged line' + (n > 1 ? 's' : '') + '</button>';
    }

    /* --- full redraw of the diff body (keeps the scroll anchor) --- */
    function draw() {
      var anchor = null, off = 0;
      if (items && items.length) {
        var tp = Math.min(items.length - 1, Math.floor(editor.scrollTop / ROWH)), it = items[tp];
        anchor = it.fold ? it.fold[0] : it.i; off = editor.scrollTop - tp * ROWH;
      }
      layout();
      var uni = S.view === 'unified', split = !uni;
      target.classList.toggle('unified', uni);
      target.classList.toggle('no-conn', uni || !f.connectors);
      target.style.setProperty('--nd', String(Math.max(lnAt[lnAt.length - 1] || 0, rnAt[rnAt.length - 1] || 0, 1)).length);

      var body;
      if (split) {
        var hl = [], hr = [];
        items.forEach(function (it, p) {
          if (it.fold) { var fb = foldBtn(it.fold); hl.push(fb); hr.push(fb); return; }
          var x = rows[it.i];
          hl.push(x.l !== null ? line(it.i, 'L', p) : pad(it.i, 'L', p));
          hr.push(x.r !== null ? line(it.i, 'R', p) : pad(it.i, 'R', p));
        });
        body = '<div class="heads"><div class="h">' + lLabel + lSub + '</div>' +
            '<div class="h mid">' + (f.connectors ? 'where<i class="grip l"></i><i class="grip r"></i>' : '') + '</div>' +
            '<div class="h r">' + rLabel + rSub + '</div></div>' +
          '<div class="grid"><div class="pane paneL">' + hl.join('') + '</div>' +
            '<div class="conn"><svg class="csvg" xmlns="http://www.w3.org/2000/svg"></svg><i class="grip l"></i><i class="grip r"></i></div>' +
            '<div class="pane paneR">' + hr.join('') + '</div></div>' +
          '<div class="hbar"><div class="hs"><div></div></div><div></div><div class="hs"><div></div></div></div>';
      } else {
        body = '<div class="heads"><div class="h">' + lLabel + lSub + ' &rarr; <span class="r">' + rLabel + rSub + '</span></div></div>' +
          '<div class="grid"><div class="pane paneU">' + items.map(function (it, p) {
            return it.fold ? foldBtn(it.fold) : line(it.i, it.s, p);
          }).join('') + '</div></div>' +
          '<div class="hbar"><div class="hs"><div></div></div></div>';
      }
      editor.innerHTML = body;
      heads = editor.querySelector('.heads'); grid = editor.querySelector('.grid');
      ROWH = parseFloat(getComputedStyle(target).getPropertyValue('--rowh')) || 22;

      // horizontal scrolling: panes and their sticky bottom bars all move together
      var panes = [].slice.call(grid.querySelectorAll('.pane')), bars = [].slice.call(editor.querySelectorAll('.hs'));
      var scrollers = panes.concat(bars);
      scrollers.forEach(function (el) {
        on(el, 'scroll', function () {
          scrollers.forEach(function (o) { if (o !== el && o.scrollLeft !== el.scrollLeft) o.scrollLeft = el.scrollLeft; });
        }, { passive: true });
      });

      // stats + toolbar state
      q('.stats').innerHTML =
        '<div class="stat"><span class="n add">+' + st.add + '</span><span class="l">insertions</span></div>' +
        '<div class="stat"><span class="n del">&minus;' + st.del + '</span><span class="l">deletions</span></div>' +
        '<div class="stat"><span class="n mod">~' + st.mod + '</span><span class="l">modified</span></div>' +
        (st.move ? '<div class="stat"><span class="n mv">&raquo;' + st.move + '</span><span class="l">moved</span></div>' : '');
      if (f.toolbar) {
        q('.t-view').setAttribute('aria-pressed', uni);
        q('.t-fold').setAttribute('aria-pressed', S.collapse);
        if (q('.t-ws')) q('.t-ws').setAttribute('aria-pressed', S.ignoreWs);
        navLabel();
      }

      if (anchor != null) editor.scrollTop = posOfRow(anchor) * ROWH + off;
      relayout();
    }
    function relayout() {
      var panes = [].slice.call(grid.querySelectorAll('.pane')), bars = [].slice.call(editor.querySelectorAll('.hs')), any = false;
      bars.forEach(function (b, k) {
        var p = panes[k], over = p.scrollWidth > p.clientWidth + 1;
        b.firstChild.style.width = p.scrollWidth + 'px';
        b.classList.toggle('none', !over); any = any || over;
      });
      editor.querySelector('.hbar').style.display = any ? '' : 'none';
      drawConn(); drawSel(); drawMinimap();
    }

    /* --- WHERE column: funnel bands for changes, one lane per moved block --- */
    function drawConn() {
      var conn = grid.querySelector('.conn');
      if (!conn || !f.connectors) return;
      var svg = conn.querySelector('svg'), W = conn.clientWidth, total = items.length * ROWH, out = '', c = W / 2;
      svg.setAttribute('width', W); svg.setAttribute('height', total);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + total);
      var curve = function (y0, y1) { return 'M0 ' + y0 + ' C ' + c + ' ' + y0 + ' ' + c + ' ' + y1 + ' ' + W + ' ' + y1; };
      var cur = null, regions = [];
      rows.forEach(function (x, i) {
        var kind = x.t === 'ctx' || x.mv ? null : x.t;
        if (cur && kind === cur.t && posL[i] === cur.pb + 1) { cur.pb = posL[i]; return; }
        if (cur) regions.push(cur);
        cur = kind ? { t: kind, pa: posL[i], pb: posL[i] } : null;
      });
      if (cur) regions.push(cur);
      regions.forEach(function (rg) {
        var col = rg.t === 'mod' ? 'var(--mod)' : rg.t === 'add' ? 'var(--add)' : 'var(--del)';
        var top = rg.pa * ROWH, bot = (rg.pb + 1) * ROWH, mid = (top + bot) / 2;
        var lt = rg.t === 'add' ? mid : top, lb = rg.t === 'add' ? mid : bot;
        var rt = rg.t === 'del' ? mid : top, rb = rg.t === 'del' ? mid : bot;
        out += '<path d="' + curve(lt, rt) + ' L ' + W + ' ' + rb + ' C ' + c + ' ' + rb + ' ' + c + ' ' + lb + ' 0 ' + lb +
          ' Z" style="fill:' + col + ';fill-opacity:.18"/>' +
          '<path d="' + curve(lt, rt) + '" style="fill:none;stroke:' + col + ';stroke-opacity:.55"/>' +
          '<path d="' + curve(lb, rb) + '" style="fill:none;stroke:' + col + ';stroke-opacity:.55"/>';
      });
      // moves: a single line from the block's old spot, down/up its own lane, arrow into the new spot
      var ms = Object.keys(moves).map(function (id) {
        var m = moves[id], yl = (posL[m.la] + posL[m.lb] + 1) / 2 * ROWH, yr = (posR[m.ra] + posR[m.rb] + 1) / 2 * ROWH;
        return { id: +id, yl: yl, yr: yr, lo: Math.min(yl, yr), hi: Math.max(yl, yr) };
      }).sort(function (a, b) { return a.lo - b.lo; });
      var laneEnd = [];
      ms.forEach(function (m) {
        for (var k = 0; k < laneEnd.length && laneEnd[k] > m.lo - 8; k++);
        m.lane = k; laneEnd[k] = m.hi;
      });
      var nl = laneEnd.length, gap = Math.min(8, (W - 24) / Math.max(1, nl)), x0 = W / 2 - gap * (nl - 1) / 2;
      ms.sort(function (a, b) { return (a.id === S.sel) - (b.id === S.sel); }).forEach(function (m) {
        var x = x0 + m.lane * gap, dir = m.yr > m.yl ? 1 : -1, len = Math.abs(m.yr - m.yl), ch = '';
        var d = 'M0 ' + m.yl + ' H' + x + ' V' + m.yr + ' H' + (W - 7);
        for (var s = 45; s < len - 25; s += 90) {
          var cy = m.yl + dir * s;
          ch += ' M' + (x - 3.5) + ' ' + (cy - dir * 2.5) + ' L' + x + ' ' + (cy + dir * 1.5) + ' L' + (x + 3.5) + ' ' + (cy - dir * 2.5);
        }
        out += '<g class="mv' + (m.id === S.sel ? ' sel' : '') + '" data-mv="' + m.id + '"><path class="ml" d="' + d + ch + '"/>' +
          '<path class="mh" d="M' + (W - 7) + ' ' + (m.yr - 4) + ' L' + (W - 1) + ' ' + m.yr + ' L' + (W - 7) + ' ' + (m.yr + 4) + ' Z"/>' +
          '<path class="hit" d="' + d + '"/></g>';
      });
      svg.innerHTML = out;
    }

    /* --- selected move: outline both blocks, label links to the other end --- */
    function drawSel() {
      [].slice.call(grid.querySelectorAll('.mvbox')).forEach(function (n) { n.remove(); });
      [].slice.call(grid.querySelectorAll('.conn g.mv')).forEach(function (g) { g.classList.toggle('sel', +g.getAttribute('data-mv') === S.sel); });
      var m = moves[S.sel];
      if (!m) return;
      var box = function (pane, p0, p1, label, go) {
        var el = document.createElement('div');
        el.className = 'mvbox';
        el.style.cssText = 'left:' + pane.offsetLeft + 'px;width:' + pane.clientWidth + 'px;top:' + p0 * ROWH + 'px;height:' + (p1 - p0 + 1) * ROWH + 'px';
        el.innerHTML = '<button type="button" class="mvlabel" data-go="' + go + '">' + label + ' &#8599;</button>';
        grid.appendChild(el);
      };
      var rng = function (a, b) { return a === b ? 'line ' + a : 'lines ' + a + '-' + b; };
      var w = m.changed ? 'moved with changes ' : 'moved ';
      var pl = grid.querySelector('.paneL') || grid.querySelector('.paneU'), pr = grid.querySelector('.paneR') || pl;
      box(pl, posL[m.la], posL[m.lb], w + 'to ' + rng(rnAt[m.ra], rnAt[m.rb]), 'R');
      box(pr, posR[m.ra], posR[m.rb], w + 'from ' + rng(lnAt[m.la], lnAt[m.lb]), 'L');
    }
    function select(id) {
      S.sel = S.sel === id ? 0 : id;
      drawSel(); drawConn();
    }
    function scrollToPos(p) { editor.scrollTop = p * ROWH - (editor.clientHeight - hh()) / 3; }
    function flash(p0, p1) {
      for (var p = p0; p <= p1; p++)
        [].slice.call(grid.querySelectorAll('[data-p="' + p + '"]')).forEach(function (n) {
          n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash');
        });
    }

    /* --- change navigation --- */
    function hunkPos(h) { return posOfRow(h.a); }
    function hunkEnd(h) { var p = -1; for (var i = h.a; i <= h.b; i++) p = Math.max(p, posL[i] != null ? posL[i] : -1, posR[i] != null ? posR[i] : -1); return p; }
    function navLabel() {
      var el = q('.navpos');
      if (el) el.textContent = hunks.length ? (S.nav >= 0 ? S.nav + 1 : '-') + ' / ' + hunks.length : 'no changes';
    }
    function go(dir) {
      if (!hunks.length) return;
      var cur = (editor.scrollTop + (editor.clientHeight - hh()) / 3) / ROWH, k, n = hunks.length;
      if (dir > 0) { for (k = 0; k < n && hunkPos(hunks[k]) <= cur + 0.5; k++); if (k === n) k = 0; }
      else { for (k = n - 1; k >= 0 && hunkPos(hunks[k]) >= cur - 0.5; k--); if (k < 0) k = n - 1; }
      S.nav = k; navLabel();
      scrollToPos(hunkPos(hunks[k])); flash(hunkPos(hunks[k]), hunkEnd(hunks[k]));
    }
    function cycleMove(dir) {
      var ids = Object.keys(moves).map(Number).sort(function (a, b) { return posL[moves[a].la] - posL[moves[b].la]; });
      if (!ids.length) return;
      var k = ids.indexOf(S.sel), id = ids[k < 0 ? (dir > 0 ? 0 : ids.length - 1) : (k + dir + ids.length) % ids.length];
      S.sel = 0; select(id); scrollToPos(posL[moves[id].la]);
    }

    /* --- minimap: the whole diff in miniature, draggable viewport --- */
    var mctx = canvas.getContext('2d'), rowPx = 1, mmTop = 0;
    function drawMinimap() {
      if (!f.minimap) return;
      var w = minimap.clientWidth, h = minimap.clientHeight, dpr = window.devicePixelRatio || 1;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mctx.clearRect(0, 0, w, h);
      mmTop = hh();
      // ponytail: scale-to-fit, no minimap scrolling; very long files get sub-pixel rows
      rowPx = Math.min(3, (h - mmTop) / Math.max(1, items.length));
      var cs = getComputedStyle(target), col = function (n) { return cs.getPropertyValue(n).trim(); };
      var C = { del: col('--del'), add: col('--add'), mod: col('--mod') };
      var two = S.view === 'split', lw = two ? (w - 5) / 2 : w - 4, cw = lw / 100;
      var colorOf = function (x, side) {
        if (x.t === 'ctx' || side === 'B') return null;
        return x.pc || x.t === 'mod' ? C.mod : x.t === 'del' ? C.del : C.add;
      };
      var lane = function (textv, color, x0, y) {
        if (textv === null) { mctx.globalAlpha = 1; mctx.fillStyle = '#141414'; mctx.fillRect(x0, y, lw, rowPx); return; }
        if (color) {
          mctx.globalAlpha = .3; mctx.fillStyle = color; mctx.fillRect(x0, y, lw, rowPx);
          mctx.globalAlpha = 1; mctx.fillRect(x0, y, 2, Math.max(rowPx, 1.5));
        }
        mctx.globalAlpha = color ? .85 : .45; mctx.fillStyle = '#c8c8c8';
        var re = /\S+/g, m, t = textv.replace(/\t/g, '    ');
        while ((m = re.exec(t)) && m.index * cw < lw - 2)
          mctx.fillRect(x0 + 3 + m.index * cw, y + rowPx * .2, Math.min(m[0].length * cw, lw - 3 - m.index * cw), Math.max(rowPx * .6, .6));
      };
      items.forEach(function (it, p) {
        var y = mmTop + p * rowPx;
        if (it.fold) { mctx.globalAlpha = 1; mctx.fillStyle = '#3a3a3a'; mctx.fillRect(2, y + rowPx / 2 - .5, w - 4, 1); return; }
        var x = rows[it.i];
        if (two) { lane(x.l, colorOf(x, 'L'), 2, y); lane(x.r, colorOf(x, 'R'), 3 + lw, y); }
        else lane(it.s === 'L' ? x.l : x.r, colorOf(x, it.s), 2, y);
      });
      mctx.globalAlpha = 1;
      syncView();
    }
    function syncView() {
      var max = editor.scrollHeight - editor.clientHeight;
      view.style.display = max > 1 ? '' : 'none';
      view.style.top = (mmTop + editor.scrollTop / ROWH * rowPx) + 'px';
      view.style.height = Math.max(8, (editor.clientHeight - hh()) / ROWH * rowPx) + 'px';
      minimap.setAttribute('aria-valuenow', max > 0 ? Math.round(editor.scrollTop / max * 100) : 0);
    }

    /* --- events (persistent elements only; body cells use delegation) --- */
    var grab = null;
    var mmScroll = function (y) { editor.scrollTop = (y - mmTop - grab) / rowPx * ROWH; };
    on(minimap, 'pointerdown', function (e) {
      var y = e.clientY - minimap.getBoundingClientRect().top, top = view.offsetTop, vh = view.offsetHeight;
      grab = y >= top && y <= top + vh ? y - top : vh / 2;
      minimap.setPointerCapture(e.pointerId); minimap.classList.add('drag');
      mmScroll(y);
    });
    on(minimap, 'pointermove', function (e) { if (grab !== null) mmScroll(e.clientY - minimap.getBoundingClientRect().top); });
    var endDrag = function () { grab = null; minimap.classList.remove('drag'); };
    on(minimap, 'pointerup', endDrag); on(minimap, 'pointercancel', endDrag);
    on(minimap, 'keydown', function (e) {
      var d = { ArrowUp: -3 * ROWH, ArrowDown: 3 * ROWH, PageUp: -editor.clientHeight * .9, PageDown: editor.clientHeight * .9 }[e.key];
      if (e.key === 'Home') editor.scrollTop = 0;
      else if (e.key === 'End') editor.scrollTop = editor.scrollHeight;
      else if (d) editor.scrollTop += d;
      else return;
      e.preventDefault();
    });
    on(editor, 'scroll', syncView, { passive: true });

    on(editor, 'click', function (e) {
      var t = e.target, el;
      if ((el = t.closest('.fold'))) { S.open[el.getAttribute('data-fold')] = 1; draw(); return; }
      if ((el = t.closest('.mvlabel'))) {
        var m = moves[S.sel];
        if (m) scrollToPos(el.getAttribute('data-go') === 'R' ? posR[m.ra] : posL[m.la]);
        return;
      }
      if ((el = t.closest('[data-mv]'))) { select(+el.getAttribute('data-mv')); return; }
      if (S.sel && t.closest('.grid') && !t.closest('.grip')) select(S.sel);
    });

    // resizable WHERE column: drag either edge (both edges move, it stays centred); double-click resets
    on(editor, 'pointerdown', function (e) {
      var gp = e.target.closest && e.target.closest('.grip');
      if (!gp) return;
      var conn = grid.querySelector('.conn'), W0 = conn.offsetWidth, x0 = e.clientX, sgn = gp.classList.contains('l') ? -1 : 1;
      gp.setPointerCapture(e.pointerId); gp.classList.add('drag'); e.preventDefault();
      var mv = function (ev) {
        target.style.setProperty('--connw', Math.max(40, Math.min(480, W0 + sgn * (ev.clientX - x0) * 2)) + 'px');
        relayout();
      };
      var up = function () { gp.classList.remove('drag'); gp.removeEventListener('pointermove', mv); gp.removeEventListener('pointerup', up); };
      gp.addEventListener('pointermove', mv); gp.addEventListener('pointerup', up);
    });
    on(editor, 'dblclick', function (e) {
      if (e.target.closest && e.target.closest('.grip')) { target.style.removeProperty('--connw'); relayout(); }
    });

    if (f.hover) {
      var lastP = null;
      var clearHover = function () {
        if (lastP === null) return;
        [].slice.call(editor.querySelectorAll('.hoverrow')).forEach(function (n) { n.classList.remove('hoverrow'); });
        lastP = null;
      };
      on(editor, 'mousemove', function (e) {
        var cell = e.target.closest ? e.target.closest('[data-p]') : null, p = cell ? cell.getAttribute('data-p') : null;
        if (p === lastP) return;
        clearHover();
        if (p !== null) {
          lastP = p;
          [].slice.call(editor.querySelectorAll('[data-p="' + p + '"]')).forEach(function (n) { n.classList.add('hoverrow'); });
        }
      });
      on(editor, 'mouseleave', clearHover);
    }

    if (f.toolbar) {
      on(q('.nav-prev'), 'click', function () { go(-1); });
      on(q('.nav-next'), 'click', function () { go(1); });
      on(q('.t-view'), 'click', function () { S.view = S.view === 'split' ? 'unified' : 'split'; draw(); });
      on(q('.t-fold'), 'click', function () { S.collapse = !S.collapse; S.open = {}; draw(); });
      if (q('.t-ws')) on(q('.t-ws'), 'click', function () { S.ignoreWs = !S.ignoreWs; S.sel = 0; S.nav = -1; compute(); draw(); });
    }
    on(target, 'keydown', function (e) {
      if (e.key === 'F7' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
        go(e.shiftKey || e.key === 'ArrowUp' ? -1 : 1); e.preventDefault();
      } else if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        cycleMove(e.shiftKey ? -1 : 1); e.preventDefault();
      } else if (e.key === 'Escape' && S.sel) select(S.sel);
    });

    compute();
    draw();
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(function () { relayout(); }); ro.observe(editor); ro.observe(minimap); }
    else on(window, 'resize', relayout);
    return api;
  }

  var Cleave = { render: render, lineDiff: lineDiff, langFromFilename: langFromFilename, version: '2.0.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = Cleave;
  global.Cleave = Cleave;
})(typeof window !== 'undefined' ? window : this);
