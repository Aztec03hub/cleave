# cleave

A VSCode-style code diff (side-by-side or unified) in one file, with **zero dependencies**.

Give it two blobs of text and it renders an IDE-grade diff: red/green/amber line
backgrounds, word-level highlighting that keeps syntax colours, moved-block detection
with VSCode-style move lanes, a WHERE column linking the panes, folding of unchanged
runs, change navigation, a real minimap, and full-row hover across both panes.

It runs three ways:

1. **Standalone HTML**: a self-contained file you open in any browser. Great for
   handing to any LLM ("produce a cleave diff of these two files") regardless of
   provider, since it needs nothing but a browser.
2. **Claude Artifact**: a body-only variant (no `<html>/<head>/<body>`) that pastes
   straight into a Claude artifact.
3. **Programmatic**: `Cleave.render(el, {before, after})` inside any page.

Single committed dark theme (deliberate IDE look). Fonts: JetBrains Mono + Inter from
Google Fonts, with system fallbacks.

---

## The brief (what the owner asked for)

The full feature list that drove the project, kept here so it never has to be
re-explained. Every item is **done**; treat the list as the spec to preserve. Don't
regress any of it, and extend it in the same spirit.

**Palette rule (owner decision):** highlights use only red (removed), green (added)
and amber (modified). New concepts are expressed with those colours plus markers and
shape, never a new colour. Neutral greys are for chrome only.

- [x] **A beautiful VSCode-style code diff**: "like I'm looking at it in VSCode or some
      other amazing and beautiful code diff view." The aesthetic matters, not just
      correctness. Keep it looking like a real IDE.
- [x] **Side-by-side panes**: before on the left, after on the right.
- [x] **Red highlighting for removed lines** (full line background; slightly brighter
      than the modified tint).
- [x] **Green highlighting for added lines** (full line background, same rule).
- [x] **Amber highlighting for modified lines**, as a full line background in BOTH
      panes. (A dim red/green alternative was trialled; the owner chose amber.)
- [x] **Word-level highlighting**: the exact words that changed inside a modified
      line, red on the before side and green on the after side, keeping syntax colours.
- [x] **Where insertions/deletions happened**, three locators all on at once:
    - [x] **Gutter carets** (`▸` / `◀`) at the insert/delete point.
    - [x] **The WHERE column** between the panes: funnel bands for each change run.
          **Resizable**: drag either edge (header or body); double-click an edge to reset.
    - [x] **A real minimap**: the diff in miniature (before | after lanes, code shape
          and change colours), draggable viewport slider, click to jump.
- [x] **Moved blocks, VSCode style**: a moved block stays red where it left and green
      where it landed, marked `»`. In the WHERE column each move gets **its own lane**:
      a single thin line from the old spot, along the lane with direction chevrons,
      into an arrowhead at the new spot. **Click a moved block** (either end, or its
      lane) to select it: both ends get an amber outline, the lane turns amber, and a
      label ("moved to lines 13-16") jumps to the other end. `m` / `Shift+m` cycle
      moves, `Esc` clears. **Moves with changes** are detected too: lines edited inside
      the moved block render amber with word highlights against their counterpart.
      A trailing closing bracket joins the move.
- [x] **Hover a line → highlight that line** across both panes.
- [x] **Headers aligned exactly with the body**, WHERE included (sticky header row on
      the same column template as the body).
- [x] **Seamless padding hatching** across stacked rows (tile = half a row height).
- [x] **Long lines scroll horizontally**, both panes in step, via a sticky scrollbar
      pinned to the bottom of the view (no scrolling to the end of the file to find it).
- [x] **Change navigation**: ↑ / ↓ buttons with an "n / N" counter, `F7` / `Shift+F7`,
      `Alt+↓` / `Alt+↑`. The target change flashes.
- [x] **Collapse unchanged runs** into "⋯ N unchanged lines" (3 lines of context kept
      around each change); click to expand. Toggle in the toolbar; on by default.
- [x] **Ignore whitespace** toggle (compares like `git diff -w`).
- [x] **Unified view** toggle (old and new line numbers in one gutter).
- [x] **Keyboard access**: focusable editor (arrow-key scrolling), focusable minimap
      (arrows, PageUp/PageDown, Home/End), real buttons with focus rings.
- [x] **Syntax highlighting per language**, inferred from the filename: js, ts, py, go,
      rust, c/c++, java/kotlin/swift/c#, sh, ruby, sql, css, json, yaml. Comments
      (line and block, across lines) are coloured as comments.
- [x] **Robust input**: CRLF and LF compare equal; a trailing newline both files share
      is not shown as an extra empty line; tabs render 4 wide (`tabSize`).
- [x] **Git input**: `build.js --git REF[..REF2] --file PATH` diffs a file straight from git.
- [x] **A gold-standard example** (`examples/gold/`) exercising every case: multi-line
      pure additions and removals, multi-line modifications, mixed hunks, unrelated
      replacements, five moved blocks (crossing lanes, one moved with changes),
      first/last-line changes, whitespace-only change, a long line, HTML-special
      characters, unicode. It is the default sample in `dist/`.
- [x] **Works standalone AND plugs easily into a Claude Artifact page.**
- [x] **Standalone HTML creation supported**, so other LLMs can use it: hand any LLM
      the standalone file + the JSON contract; nothing Claude-specific is required.
- [x] **Its own project a fresh Claude Code session can take over** (this README).
- [x] **Reusable for other diff views**: drop in any two texts; the diff is computed.
- [x] **Zero dependencies.**

### Open ideas (not requested)
- A light theme (currently single committed dark, by design).
- A "Compare" action on a moved-with-changes block (VSCode shows a mini diff of the two ends).

---

## Quick start

### Standalone / other LLMs
Open `dist/cleave.standalone.html` in a browser; it ships with the gold example.
To diff your own files:

```bash
node build/build.js --before old.py --after new.py --out mydiff.html     # language from the filename
node build/build.js --git HEAD~1 --file src/app.js --out mydiff.html     # a ref vs the working tree
node build/build.js --git v1.0..v2.0 --file src/app.js --out mydiff.html # two refs
```
Other flags: `--filename`, `--lang`, `--left`, `--right`, `--subtitle`, `--unified`,
`--no-collapse`, `--ignore-ws`, `--form artifact`.

Or hand any LLM the contents of `dist/cleave.standalone.html` and ask it to replace the
JSON inside `<script type="application/json" id="cleave-data">` with
`{ "before": "...", "after": "...", "filename": "app.py" }`. That JSON is the entire
contract (any option below may be added); the page computes the diff itself.

### Claude Artifact
Publish `dist/cleave.artifact.html` as an artifact (no doctype/html/head/body, matching
the artifact skeleton). Edit the same `#cleave-data` JSON block, or regenerate it:
`node build/build.js --before a --after b --out out.html --form artifact`.

### Programmatic (embed in a page)
```html
<link rel="stylesheet" href="src/cleave.css">
<script src="src/cleave.js"></script>
<div id="diff" style="height:100vh"></div>
<script>
  Cleave.render('#diff', {
    before: "line 1\nline 2\n",
    after:  "line 1\nline 2 changed\nline 3\n",
    filename: "example.js"
  });
</script>
```
See `examples/programmatic.html` for a working host-page embed.

---

## API

`Cleave.render(target, options)`: `target` is an element or a selector string.
**The target must have a height** (e.g. `height:100vh`, flex `flex:1`, or a fixed px);
cleave fills it. Returns `{ rows, stats:{add,del,mod,move}, destroy() }`. Rendering
into the same element again destroys the previous instance first (listeners, observers).

| option | default | meaning |
|---|---|---|
| `before` / `after` | `''` | left ("old") and right ("new") text |
| `rows` | none | pre-aligned rows instead of before/after (see below) |
| `filename` | `'diff'` | titlebar name; also picks the language |
| `language` | from `filename` | `js` `ts` `py` `go` `rust` `c` `java` `sh` `rb` `sql` `css` `json` `yaml` (+ aliases such as `python`, `tsx`, `cpp`, `kotlin`); `text` = plain |
| `highlight` | none | `fn(lineString) -> html` custom highlighter (must return escaped HTML) |
| `view` | `'split'` | `'unified'` starts in unified view |
| `collapse` | `true` | fold unchanged runs |
| `ignoreWhitespace` | `false` | compare ignoring all whitespace |
| `tabSize` | `4` | tab width |
| `subtitle` | `'diff'` | titlebar sub text |
| `leftLabel` / `rightLabel` | `Before` / `After` | column header labels |
| `leftSub` / `rightSub` | none | small mono sub-label per column (e.g. a git ref) |
| `features` | all `true` | `{ minimap, connectors, carets, wordDiff, hover, syntax, toolbar }`; toggle any off |

`Cleave.lineDiff(before, after, {ignoreWhitespace})` returns the aligned `rows`.
`Cleave.langFromFilename(name)` returns the language key. Also `Cleave.version`.

### Keyboard
| key | action |
|---|---|
| `F7` / `Alt+↓` | next change |
| `Shift+F7` / `Alt+↑` | previous change |
| `m` / `Shift+m` | select next / previous moved block |
| `Esc` | clear the move selection |
| arrows, PageUp/PageDown, Home/End | scroll (editor or minimap focused) |

### The `rows` model
```js
{ t: 'ctx'|'del'|'add'|'mod', l: string|null, r: string|null, mv?: number, pair?: string, pc?: 1 }
```
- `ctx` unchanged · `del` left only (r=null) · `add` right only (l=null)
- `mod` changed line on both sides; triggers word-level highlighting
- `mv` on `del`/`add` rows: rows sharing an `mv` id are one moved block (both ends)
- `pair` + `pc`: a line edited inside a moved block, with its counterpart's text

### Diff algorithm
1. **Line diff:** normalise CRLF, drop a shared trailing newline, trim the common
   prefix/suffix, then LCS over the changed middle (`rawLineOps`).
2. **Moves** (`detectMoves`), before pairing:
   - *with changes*: a deleted run and an added run in different hunks whose lines
     mostly match (LCS density ≥ 0.6, ≥ 3 matches, 2 substantial). Edited lines inside
     get `pair`/`pc`. Blank lines at the edges are trimmed.
   - *exact*: a deleted run reappearing as an added run (whitespace ignored), ≥ 2 lines,
     one with 8+ characters, so lone braces never count.
   - a closing-bracket line right after both ends of a move joins it.
3. **Hunk pairing** (`pairHunks`): within each changed hunk, deleted and added lines are
   aligned to maximise total similarity (small DP); a pair becomes `mod` only at
   similarity ≥ 0.4 (`SIM`), so unrelated replacements stay a red block then a green
   block. Moved rows stay in the hunk (order-safe) but never pair.
4. **Word diff** (`wdiff`): token LCS inside `mod` rows and edited moved lines; changed
   characters are overlaid on the syntax-highlighted line (`paint`).

This is LCS, not Myers: O(n·m) over the changed middle, fine for file-sized diffs, not
meant for megabyte rewrites. `test.js` checks that the rows rebuild both files exactly.

---

## Project layout
```
src/cleave.css          scoped styles (everything under .cleave; nothing leaks)
src/cleave.js           the library (UMD-ish global + module.exports)
build/build.js          inlines src into self-contained HTML; --git input (no deps; needs Node)
dist/cleave.standalone.html   generated full-page file (open anywhere)
dist/cleave.artifact.html     generated body-only file (paste into a Claude artifact)
examples/programmatic.html    host-page embed example (Python, language inferred)
examples/gold/before.js|after.js   gold-standard diff covering every case (default sample)
test.js                 `node test.js`: asserts on the diff logic, incl. a round trip
```
`dist/*` is generated: edit `src/*`, then `node build/build.js`. `src/` is the single
source of truth, so the inlined JS/CSS can never drift.

## Security
All text is HTML-escaped before it reaches the DOM (`esc()`; the highlighter escapes
every segment). Line numbers are integers. Arbitrary `before`/`after` text is safe to
render. A custom `highlight` function is responsible for escaping its own output.

## For a fresh Claude Code session taking this over
- The whole thing is `src/cleave.js` + `src/cleave.css`. Start there.
- Look: `src/cleave.css`; tokens are the `--*` vars on `.cleave`. Respect the palette rule.
- Diff behaviour: `rawLineOps` / `detectMoves` / `pairHunks` / `wdiff` in `src/cleave.js`.
- Rendering: `render()` builds a display list (`layout`: rows or unified lines plus
  folds), then `draw()` regenerates the body; `relayout()` redraws the WHERE column,
  selection boxes and minimap on resize.
- After any `src/` edit: `node test.js` (prints `ok`), `node build/build.js`, then open
  `dist/cleave.standalone.html` (the gold example) and look at it; it is the visual
  reference. Commit the regenerated `dist/`.
- Sizing: every size is fixed px, so the standalone page and the artifact render
  identically at the same browser zoom. If they look different sizes, check Chrome's
  per-site zoom (a magnifier icon in the address bar means the site is not at 100%).
- No test framework, no bundler, no npm deps; keep it that way unless there's a real reason.
- Origin: grew out of a hand-rolled logcat-diff artifact; the brief was "VSCode-style,
  dependency-free, works as a standalone file AND as a Claude artifact." Keep both forms working.

## License
MIT, see [LICENSE](LICENSE).
