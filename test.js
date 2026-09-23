// node test.js : smallest check that the diff logic still holds
const assert = require('assert');
const { lineDiff, langFromFilename } = require('./src/cleave.js');
const t = (a, b, o) => lineDiff(a, b, o).map(r => r.t).join(' ');

assert.strictEqual(t('a\nb', 'a\nb'), 'ctx ctx');
assert.strictEqual(t('x\nconst a = 1;', 'x\nconst a = 2;'), 'ctx mod');          // similar -> modified
assert.strictEqual(t('x\nfoo(bar);', 'x\nreturn 42;'), 'ctx del add');           // unrelated -> red then green
assert.strictEqual(t('a\nb\nc', 'a\nc'), 'ctx del ctx');
assert.strictEqual(t('a\nc', 'a\nb\nc'), 'ctx add ctx');
// best alignment, not greedy: the similar line pairs even when it is not first in the hunk
assert.strictEqual(t('k\nsend(res, 201, { ok: true });', 'k\n} catch (e) {\nreturn send(res, 201, { ok: true });'), 'ctx add mod');

// line endings: CRLF vs LF is not a change; a shared trailing newline is not an extra line
assert.strictEqual(t('a\r\nb\r\n', 'a\nb\n'), 'ctx ctx');
assert.strictEqual(t('', 'x'), 'add');
// ignore whitespace
assert.strictEqual(t('if (a)  {', 'if (a) {'), 'mod');
assert.strictEqual(t('if (a)  {', 'if (a) {', { ignoreWhitespace: true }), 'ctx');

// moves: exact (even re-indented) links both sides; lone braces never count
const mv = lineDiff('a\nfunction f() {\n  go();\nb\nc', 'a\nb\nc\n    function f() {\n      go();');
assert.strictEqual(mv.filter(r => r.mv).map(r => r.t + r.mv).join(' '), 'del1 del1 add1 add1');
assert.ok(!lineDiff('x\n}\n}\ny', 'x\ny\n}\n}').some(r => r.mv));
// a block re-indented in place (wrapped in an if) is an edit, not a move
assert.ok(!lineDiff('foo();\ndoThing(alpha);\ndoOther(beta);\nbar();', 'foo();\nif (x) {\n  doThing(alpha);\n  doOther(beta);\n}\nbar();').some(r => r.mv));
assert.ok(!lineDiff('  alpha beta gamma\n  delta epsilon\nx', 'alpha beta gamma\ndelta epsilon\nx').some(r => r.mv));
// moved with changes: one block, the edited line carries its counterpart
const mid = 'm1\nm2\nm3\nm4\nm5\nm6\nm7\n';   // longer than the function, so the function is what moves
const fz = lineDiff(
  'top\nfunction v(k) {\n  if (!k) return 0;\n  if (k > 256) return 0;\n  return k * 2;\n}\n' + mid + 'end',
  'top\n' + mid + 'function v(k) {\n  if (!k) return 0;\n  if (k > 512) return 0;\n  return k * 2;\n}\nend');
const moved = fz.filter(r => r.mv);
assert.strictEqual(new Set(moved.map(r => r.mv)).size, 1);
assert.strictEqual(moved.filter(r => r.t === 'del').length, 5);                  // closing brace included
assert.strictEqual(fz.find(r => r.pc && r.t === 'del').pair, '  if (k > 512) return 0;');

// round trip: the rows must rebuild both files exactly (move/bracket/pairing reorders are order-safe)
const fs = require('fs');
const gb = fs.readFileSync(__dirname + '/examples/gold/before.js', 'utf8'), ga = fs.readFileSync(__dirname + '/examples/gold/after.js', 'utf8');
const gr = lineDiff(gb, ga);
assert.strictEqual(gr.filter(r => r.l !== null).map(r => r.l).join('\n'), gb.replace(/\n$/, ''));
assert.strictEqual(gr.filter(r => r.r !== null).map(r => r.r).join('\n'), ga.replace(/\n$/, ''));
// every move has both ends
const ids = new Set(gr.filter(r => r.mv).map(r => r.mv));
ids.forEach(id => assert.ok(gr.some(r => r.mv === id && r.t === 'del') && gr.some(r => r.mv === id && r.t === 'add')));
assert.ok(ids.size >= 4);

// fuzz: random edits, moves and duplicate lines must always round-trip (seeded, deterministic)
let seed = 12345;
const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 16) % n; };   // high bits: LCG low bits cycle
const pool = ['}', '', '  return x;', 'const a = 1;', 'if (ok) {', '  go(a, b);', 'foo();', '// note', '  }', 'let total = sum(items);'];
const seen = { mv: 0, mod: 0 };
for (let run = 0; run < 400; run++) {
  const A = Array.from({ length: rnd(30) }, () => pool[rnd(pool.length)] + (rnd(3) ? '' : ' ' + rnd(9)));
  const B = A.slice();
  for (let e = rnd(6); e >= 0; e--) {
    const op = rnd(4), i = rnd(B.length + 1);
    if (op === 0) B.splice(i, 0, pool[rnd(pool.length)]);
    else if (op === 1 && B.length) B.splice(rnd(B.length), 1);
    else if (op === 2 && B.length) B[rnd(B.length)] += ' x';
    else if (B.length > 3) { const s = rnd(B.length - 2), blk = B.splice(s, 1 + rnd(3)); B.splice(rnd(B.length + 1), 0, ...blk); }
  }
  const a = A.join('\n') + (rnd(2) ? '\n' : ''), b = B.join('\n') + (rnd(2) ? '\n' : '');
  for (const o of [{}, { ignoreWhitespace: true }]) {
    const rows = lineDiff(a, b, o), strip = s => s.replace(/\r\n?/g, '\n');
    if (rows.some(r => r.mv)) seen.mv++;
    if (rows.some(r => r.t === 'mod')) seen.mod++;
    const L = rows.filter(r => r.l !== null).map(r => r.l), R = rows.filter(r => r.r !== null).map(r => r.r);
    const want = (s, other) => { s = strip(s); return (/\n$/.test(s) || !s) && (/\n$/.test(strip(other)) || !other) ? s.replace(/\n$/, '') : s; };
    assert.strictEqual(L.join('\n'), want(a, b), 'left round trip, run ' + run);
    assert.strictEqual(R.join('\n'), want(b, a), 'right round trip, run ' + run);
    rows.forEach(r => assert.ok(r.t === 'ctx' ? r.l !== null && r.r !== null : r.t === 'mod' ? r.l !== null && r.r !== null : r.t === 'del' ? r.r === null : r.l === null));
    new Set(rows.filter(r => r.mv).map(r => r.mv)).forEach(id =>
      assert.ok(rows.some(r => r.mv === id && r.t === 'del') && rows.some(r => r.mv === id && r.t === 'add'), 'one-sided move, run ' + run));
  }
}

// the fuzz must actually exercise moves and pairing, or its passes mean nothing
assert.ok(seen.mv > 50 && seen.mod > 100, 'fuzz too weak: ' + JSON.stringify(seen));

// language from filename
assert.strictEqual(langFromFilename('a/b/rate_limiter.py'), 'py');
assert.strictEqual(langFromFilename('x.tsx'), 'ts');
assert.strictEqual(langFromFilename('notes.txt'), 'text');
console.log('ok');
