#!/usr/bin/env node
/* cleave build — inline src/cleave.css + src/cleave.js into self-contained HTML.
 *
 *   node build/build.js                         # regenerate dist/ with the sample diff
 *   node build/build.js --before a.js --after b.js --filename a.js --lang js --out mydiff.html
 *
 * Flags:
 *   --before/-b FILE   left text        --after/-a FILE   right text
 *   --filename NAME    titlebar name    --lang LANG       js|text|...
 *   --left LABEL --right LABEL --subtitle TEXT
 *   --out FILE         write ONE file (extension-agnostic); form chosen by --form
 *   --form full|artifact   default: writes BOTH dist/cleave.standalone.html and
 *                          dist/cleave.artifact.html when --out is omitted
 */
const fs = require('fs');
const path = require('path');

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

const SAMPLE_BEFORE = `function loadRules(path) {
  const raw = fs.readFileSync(path);
  const rules = new Set();
  let count = 0;
  for (const line of raw.split('\\n')) {
    const rule = line.split('#')[0].trim();
    if (rule) rules.push(rule);
  }
  return rules;
}`;
const SAMPLE_AFTER = `function loadRules(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const rules = new Set();
  for (const line of raw.split('\\n')) {
    if (!line.trim()) continue;
    const rule = line.split('#')[0].trim();
    if (rule) rules.add(rule);
  }
  return rules;
}`;

const beforeFile = arg(['--before', '-b']);
const afterFile = arg(['--after', '-a']);
const data = {
  before: beforeFile ? fs.readFileSync(beforeFile, 'utf8') : SAMPLE_BEFORE,
  after: afterFile ? fs.readFileSync(afterFile, 'utf8') : SAMPLE_AFTER,
  filename: arg(['--filename'], beforeFile ? path.basename(beforeFile) : 'loadRules.js'),
  language: arg(['--lang', '--language'], 'js'),
  leftLabel: arg(['--left'], 'Before'),
  rightLabel: arg(['--right'], 'After'),
  subtitle: arg(['--subtitle'], 'side-by-side diff'),
};

// JSON embedded in a <script> must not contain a literal </script>.
const dataJSON = JSON.stringify(data, null, 2).replace(/<\//g, '<\\/');
const BOOT =
  '(function(){var el=document.getElementById("app"),d={};' +
  'try{d=JSON.parse(document.getElementById("cleave-data").textContent);}catch(e){' +
  'el.textContent="cleave: bad data — "+e;return;}Cleave.render(el,d);})();';

function fullDoc() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(data.filename)} — cleave</title>
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

// Artifact form: no <!doctype>/<html>/<head>/<body> — the Claude Artifact skeleton adds them.
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
