#!/usr/bin/env node
/* cleave build: inline src/cleave.css + src/cleave.js into self-contained HTML.
 *
 *   node build/build.js                         # regenerate dist/ with the gold example
 *   node build/build.js --before a.js --after b.js --out mydiff.html
 *   node build/build.js --git HEAD~1 --file src/app.js --out mydiff.html       # ref vs working tree
 *   node build/build.js --git v1.0..v2.0 --file src/app.js --out mydiff.html   # ref vs ref
 *
 * Flags:
 *   --before/-b FILE   left text        --after/-a FILE   right text
 *   --git REF[..REF2] --file PATH       left = PATH at REF; right = PATH at REF2, or the working tree
 *   --filename NAME    titlebar name    --lang LANG       py|ts|go|... (default: from the filename)
 *   --left LABEL --right LABEL --subtitle TEXT
 *   --unified          start in unified view       --no-collapse   show unchanged runs in full
 *   --ignore-ws        start ignoring whitespace
 *   --out FILE         write ONE file (extension-agnostic); form chosen by --form
 *   --form full|artifact   default: writes BOTH dist/cleave.standalone.html and
 *                          dist/cleave.artifact.html when --out is omitted
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { langFromFilename } = require('../src/cleave.js');

const ROOT = path.resolve(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'src/cleave.css'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'src/cleave.js'), 'utf8');

const FONTS =
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;500;600;700&display=swap">';

function arg(names, def) {
  for (const n of names) {
    const i = process.argv.indexOf(n);
    if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  }
  return def;
}

// default sample: the gold-standard example that exercises every diff case
const GOLD = path.join(ROOT, 'examples/gold');

const flag = n => process.argv.includes(n);

// a file as it was at a git ref ('' if it did not exist there, e.g. a newly added file)
function gitShow(ref, file) {
  const rel = path.relative(process.cwd(), path.resolve(file)).split(path.sep).join('/');
  try { return execFileSync('git', ['show', ref + ':./' + rel], { encoding: 'utf8', maxBuffer: 1 << 28 }); }
  catch (e) { console.error('note: ' + file + ' not found at ' + ref + ', treating as empty'); return ''; }
}

const git = arg(['--git']);
let before, after, leftSub, rightSub, name;
if (git) {
  const file = arg(['--file']);
  if (!file) { console.error('--git needs --file PATH'); process.exit(2); }
  const [r1, r2] = git.split('..');
  before = gitShow(r1, file);
  after = r2 ? gitShow(r2, file) : fs.readFileSync(file, 'utf8');
  leftSub = r1; rightSub = r2 || 'working tree'; name = path.basename(file);
} else {
  const beforeFile = arg(['--before', '-b']), afterFile = arg(['--after', '-a']);
  before = fs.readFileSync(beforeFile || path.join(GOLD, 'before.js'), 'utf8');
  after = fs.readFileSync(afterFile || path.join(GOLD, 'after.js'), 'utf8');
  name = beforeFile ? path.basename(afterFile || beforeFile) : 'cache-server.js';
}
const filename = arg(['--filename'], name);
const data = {
  before, after, filename,
  language: arg(['--lang', '--language'], langFromFilename(filename)),
  leftLabel: arg(['--left'], 'Before'),
  rightLabel: arg(['--right'], 'After'),
  subtitle: arg(['--subtitle'], 'diff'),
  view: flag('--unified') ? 'unified' : 'split',
  collapse: !flag('--no-collapse'),
  ignoreWhitespace: flag('--ignore-ws'),
};
if (leftSub) Object.assign(data, { leftSub, rightSub });

// JSON embedded in a <script> must not contain a literal </script>.
const dataJSON = JSON.stringify(data, null, 2).replace(/<\//g, '<\\/');
const BOOT =
  '(function(){var el=document.getElementById("app"),d={};' +
  'try{d=JSON.parse(document.getElementById("cleave-data").textContent);}catch(e){' +
  'el.textContent="cleave: bad data: "+e;return;}Cleave.render(el,d);})();';

function fullDoc() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(data.filename)} · cleave</title>
${FONTS}
<style>
html,body{height:100%;margin:0;background:#1e1e1e}
#app{height:100vh}
${CSS}
</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="cleave-data">${dataJSON}</script>
<script>${JS}</script>
<script>${BOOT}</script>
</body>
</html>
`;
}

// Artifact form: no <!doctype>/<html>/<head>/<body>; the Claude Artifact skeleton adds them.
function artifactDoc() {
  return `<title>${esc(data.filename)} diff</title>
${FONTS}
<style>
#app{height:100vh}
${CSS}
</style>
<div id="app"></div>
<script type="application/json" id="cleave-data">${dataJSON}</script>
<script>${JS}</script>
<script>${BOOT}</script>
`;
}

function esc(s) { return String(s).replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;')); }

const out = arg(['--out', '-o']);
const distDir = path.join(ROOT, 'dist');
fs.mkdirSync(distDir, { recursive: true });

if (out) {
  const form = arg(['--form'], 'full');
  fs.writeFileSync(out, form === 'artifact' ? artifactDoc() : fullDoc());
  console.log('wrote', out, '(' + form + ')');
} else {
  const a = path.join(distDir, 'cleave.standalone.html');
  const b = path.join(distDir, 'cleave.artifact.html');
  fs.writeFileSync(a, fullDoc());
  fs.writeFileSync(b, artifactDoc());
  console.log('wrote', path.relative(ROOT, a), 'and', path.relative(ROOT, b));
}
