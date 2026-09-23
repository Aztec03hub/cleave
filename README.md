# cleave

A VSCode-style side-by-side code diff, in one file, with **zero dependencies**.

Give it two blobs of text; it renders an IDE-grade diff: red/green/amber line
backgrounds, word-level intra-line highlighting, gutter carets at insertion
points, connector bands linking the two panes across the middle gutter, a
clickable minimap, and full-row hover across both panes.

It runs three ways:

1. **Standalone HTML** — a self-contained file you open in any browser. Great for
   handing to any LLM ("produce a cleave diff of these two files") regardless of
   provider, since it needs nothing but a browser.
2. **Claude Artifact** — a body-only variant (no `<html>/<head>/<body>`) that
   pastes straight into a Claude artifact.
3. **Programmatic** — `Cleave.render(el, {before, after})` inside any page.

Single committed dark theme (deliberate IDE look). Fonts: JetBrains Mono + Inter
from Google Fonts, with system fallbacks.

---

## Quick start

### Standalone / other LLMs
Open `dist/cleave.standalone.html` in a browser — it ships with a sample diff.
To diff your own files:

```bash
node build/build.js --before old.js --after new.js --filename app.js --lang js --out mydiff.html
# then open mydiff.html
```

Or hand any LLM the contents of `dist/cleave.standalone.html` and ask it to
replace the JSON inside `<script type="application/json" id="cleave-data">` with
`{ "before": "...", "after": "...", "filename": "...", "language": "js" }`. That
JSON is the entire contract — the page computes the diff itself.

### Claude Artifact
Publish `dist/cleave.artifact.html` as an artifact (it has no doctype/html/head/body,
matching the artifact skeleton). Edit the same `#cleave-data` JSON block, or
regenerate it: `node build/build.js --before a --after b --out out.html --form artifact`.

### Programmatic (embed in a page)
```html
<link rel="stylesheet" href="src/cleave.css">
<script src="src/cleave.js"></script>
<div id="diff" style="height:100vh"></div>
<script>
  Cleave.render('#diff', {
    before: "line 1\nline 2\n",
    after:  "line 1\nline 2 changed\nline 3\n",
    filename: "example.js",
    language: "js"
  });
</script>
```
See `examples/programmatic.html` for a working host-page embed.

---

## API

`Cleave.render(target, options)` — `target` is an element or a selector string.
**The target must have a height** (e.g. `height:100vh`, flex `flex:1`, or a fixed
px); cleave fills it. Returns `{ rows, stats:{add,del,mod} }`.

| option | default | meaning |
|---|---|---|
| `before` | `''` | left text (the "old" side) |
| `after` | `''` | right text (the "new" side) |
| `rows` | — | pre-aligned rows instead of before/after (see below) |
| `filename` | `'diff'` | titlebar name |
| `subtitle` | `'side-by-side diff'` | titlebar sub text |
| `language` | `'js'` | `js`/`ts`/`json`/`c`/… use the JS-flavored highlighter; anything else (`text`) renders plain |
| `highlight` | — | `fn(lineString) -> html` to plug in your own highlighter (must return escaped HTML) |
| `leftLabel` / `rightLabel` | `Before` / `After` | column header labels |
| `leftSub` / `rightSub` | — | small mono sub-label per column (e.g. a git ref) |
| `features` | all `true` | `{ minimap, connectors, carets, wordDiff, hover, syntax }` — toggle any off |

`Cleave.lineDiff(before, after)` returns the aligned `rows` array if you want to
compute/inspect the diff yourself. Also `Cleave.version`.

### The `rows` model
The renderer is driven by an array of aligned rows; `lineDiff` produces it, or you
supply your own:
```js
{ t: 'ctx'|'del'|'add'|'mod', l: string|null, r: string|null }
```
- `ctx` unchanged (l === r) · `del` left only (r=null) · `add` right only (l=null)
- `mod` changed line present on both sides — triggers word-level highlighting

### Diff algorithm
- **Line diff:** LCS over lines → context/insert/delete ops.
- **Hunk pairing:** each run of deletions is zipped with the run of insertions that
  follows it into `mod` rows (leftovers stay pure del/add), so replaced lines get
  word-level highlights instead of a delete+add pair.
- **Word diff:** token-level LCS (words / symbols / whitespace) within `mod` rows;
  only changed runs get a colored block.

This is a clean LCS, not Myers — great for typical function/file diffs, O(n·m)
memory, so it is not meant for diffing megabyte inputs.

---

## The three insertion locators
Because a diff's key question is *where* did content appear/disappear:
- **Gutter carets** (`▸` / `◀`) sit in the *opposite* pane's gutter exactly at an
  insert/delete point.
- **Connector bands** (middle "where" column) link each change region left↔right,
  colored by kind (green insert / red delete / amber modify); pure inserts/deletes
  taper to a point at the caret so the band arrows toward the change.
- **Minimap** (right edge) has a colored tick per change and a draggable viewport
  box; click to jump.

---

## Project layout
```
src/cleave.css          scoped styles (everything under .cleave; nothing leaks)
src/cleave.js           the library: Cleave.render / Cleave.lineDiff (UMD-ish global + module.exports)
build/build.js          inlines src into self-contained HTML (no deps; needs Node)
dist/cleave.standalone.html   generated full-page file (open anywhere)
dist/cleave.artifact.html     generated body-only file (paste into a Claude artifact)
examples/programmatic.html    host-page embed example
```
`dist/*` is generated — edit `src/*`, then `node build/build.js` to regenerate.
`src/` is the single source of truth; the two dist files are built from it so the
inlined JS/CSS can never drift.

## Security
All text content is HTML-escaped before it reaches the DOM (`esc()`, and the
syntax highlighter escapes too). Line numbers are integers. So arbitrary
`before`/`after` text is safe to render. If you pass a custom `highlight`
function, it is responsible for escaping its own output.

## For a fresh Claude Code session taking this over
- The whole thing is `src/cleave.js` + `src/cleave.css`. Start there.
- To change the look: `src/cleave.css`, tokens are the `--*` vars on `.cleave`.
- To change diff behavior: `rawLineOps` / `pairHunks` / `wdiff` in `src/cleave.js`.
- After any `src/` edit, run `node build/build.js` and commit the regenerated `dist/`.
- Smoke test: `node -e "console.log(require('./src/cleave.js').lineDiff('a\nb','a\nB').map(r=>r.t))"`
  should print `[ 'ctx', 'mod' ]`.
- No test framework, no bundler, no npm deps — keep it that way unless there's a real reason.
- Origin lineage: this grew out of a hand-rolled logcat-diff artifact; the design
  brief was "VSCode-style, dependency-free, works as a standalone file AND as a
  Claude artifact." Keep both output forms working.

## License
MIT — see [LICENSE](LICENSE).
