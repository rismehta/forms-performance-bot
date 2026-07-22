# Performance Bot

Static analyzer for AEM Adaptive Forms. Runs as a **GitHub Action** (before/after URL comparison on a PR), a **standalone CLI** (`analyze` report + `lint` gate), and an **ESLint plugin** (`eslint-plugin-aem-forms`, for the JS-anchored rules — live editor feedback). The Action + CLI share one analyzer pipeline (`src/pipeline.js`); the plugin reuses the same matcher modules. Findings are suppressible inline with ESLint's `// eslint-disable` directive across all surfaces.

## What it checks

Two families of analyzers, all defined in `src/pipeline.js` (the single source of truth):

- **Performance / CWV** – form structure & nesting, blocking API calls in `initialize`, unnecessary hidden & disabled fields, circular/slow rules, DOM/`window`/HTTP in custom functions, runtime CLS, HTML (lazy-load, dimensions, blocking scripts, iframes), CSS (background-image, data URIs, `@import`, deep/duplicate selectors, `!important`, hardcoded colors).
- **Design canon** – ownership & storage-class rules from the AEM Forms design canon: field-writes-sibling, foreign-fragment-root, dispatch-on-form-not-field, rules-vs-code, storage-class namespacing, content-in-code, display-format-in-code (use `displayFormat`/`displayValueExpression`), ootb-property-shadow (custom prop/event duplicating an OOTB one), rule-ordering-race, fragment-form-property-scope (`globals.form` reach inside a fragment), fragment-path-validator (`globals.fragment.<path>` vs the linked JSON hierarchy), component-owns-model-concern (view reinventing model presentation/constraints), and more.

Optional **AI auto-fix** (Azure OpenAI) can open a PR with CSS fixes and JS suggestions.

## Quick Start

### Run locally

1. **Install** (from repo root):

   ```bash
   git clone <repo-url> && cd performance-bot
   npm install
   ```

2. **Run with form URLs** (before/after form page URLs):

   ```bash
   # Using the shell script (installs deps if needed)
   ./test-local.sh "https://main--your-project.aem.live/" "https://branch--your-project.aem.live/"

   # Or using Node directly
   node test/run-test.js --before "https://main--your-project.aem.live/" --after "https://branch--your-project.aem.live/"

   # Sample run (built-in demo URLs)
   node test/run-test.js --sample
   ```

3. **Run with form URLs + local JS/CSS paths** (for accurate hidden-field and custom-function analysis):

   ```bash
   node test-local-with-files.js \
     --before "https://your-form-url/" \
     --after "https://your-form-url/" \
     --js-dir /path/to/your/form/blocks \
     --css-dir /path/to/your/styles
   ```

4. **Check the report**:

   - **Live URL runs** (run-test.js, test-local.sh, test-local-with-files.js): open **`test/output/pr-comment.md`** (Markdown summary).
   - **Offline run** (test-analyzers-offline.js): open **`test/output/offline-pr-comment.md`**.
   - **In CI**: download the **`performance-report-pr-<number>`** artifact to get `performance-report.html`.

   **Local vs CI:** Locally there is no PR diff—the run uses **full** before/after analysis. `pr-comment.md` shows the same summary format (critical-issue count); the detailed breakdown is printed in the **console**. In CI, results are filtered to PR diff files and details appear as inline comments on the PR.

   ```bash
   cat test/output/pr-comment.md
   ```

For more options (offline tests, full vs basic live test), see [test/README.md](test/README.md).

### Standalone CLI (pre-built release artifact)

A standalone `dist/cli/index.js` is published on every merge to `main`. No `git clone` or `npm install` required.

```bash
# Install
mkdir -p ~/.performance-bot
curl -L https://github.com/adobe-aem-forms/performance-bot/releases/latest/download/performance-bot-cli.tar.gz \
  | tar -xz -C ~/.performance-bot

# Single URL snapshot
node ~/.performance-bot/index.js --url https://your-branch--your-project.aem.live/

# Before/after comparison
node ~/.performance-bot/index.js \
  --before https://main--your-project.aem.live/ \
  --after  https://branch--your-project.aem.live/

# Git diff mode — analyze only your changed files (run from your project repo)
node ~/.performance-bot/index.js --diff                        # auto-detects merge-base
node ~/.performance-bot/index.js --diff HEAD                   # uncommitted changes only
node ~/.performance-bot/index.js --diff --url https://...      # changed files + URL analysis
```

The same bundle exposes a **`lint`** subcommand — a static gate that runs the **full** analyzer pipeline (perf + design-canon) over your files and exits non-zero on any error-severity finding:

```bash
# Lint explicit files (exits non-zero on any error-severity finding → use in a commit hook / CI)
node ~/.performance-bot/index.js lint blocks/form/scripts/fragment/myfrag.js

# Lint everything you changed vs the merge-base
node ~/.performance-bot/index.js lint --diff

# Lint a whole directory tree
node ~/.performance-bot/index.js lint --dir blocks/form

# Machine-readable output for tooling
node ~/.performance-bot/index.js lint --diff --json

# Exclude extra files by regex (repeatable), on top of the built-in skips
# (generated bundles, node_modules, *.test.js/*.spec.js, vendored afb-runtime.js)
node ~/.performance-bot/index.js lint --dir blocks/form --exclude 'vendor/' --exclude '\.gen\.js$'
```

From a clone you can run it via npm: `npm run lint:forms -- <files… | --diff | --dir <path>>`.

`analyze` gates natively with `--fail-on error|warning` (default report-only) and honours the same `--exclude <regex>` — e.g. `analyze --diff --fail-on error --exclude 'vendor/'`.

**Output.** `lint` prints the **complete** findings list — every finding from every analyzer (perf + design-canon), grouped by file, each as `✗ [error] <type>:<line>` (or `[warning]`) with a one-line explanation, then an `N error(s), M warning(s)` footer. It exits `1` if any error is present, else `0`.

```text
──────────────────────────────────────────────────────────────────────
Forms lint (performance + design-canon)
──────────────────────────────────────────────────────────────────────

blocks/form/scripts/fragment/loanoffer10sec.js
  ✗ [error] dom-access-in-custom-function:154   ← performance analyzer
      Custom function "handleResetAll" accesses the DOM…
  ✗ [error] getvariable-not-namespaced:72       ← design-canon analyzer
      getVariable('tenureValues') reads a form-scoped property with no positive namespace prefix…
  ✗ [error] display-format-in-code:344           ← design-canon analyzer
      A field's display value is FORMATTED in code — move the decoration to displayFormat / displayValueExpression…
──────────────────────────────────────────────────────────────────────
  206 error(s), 3 warning(s)
──────────────────────────────────────────────────────────────────────
```

`--json` emits `{ findings: [{ severity, type, message, file, line, analyzer }], errors, warnings }` for tooling/editor integration.

### Suppressing a finding (false positives)

Use ESLint's own directive syntax — the **same comment works in the bot CLI and in the editor** (via the ESLint plugin below). Name the **rule id** (the ESLint rule name, e.g. `aem-forms/component-owns-model-concern`); the bot maps it to all of that analyzer's finding types, so it suppresses the same findings the ESLint rule does. The `aem-forms/` prefix is optional, and a bare finding `type` works too.

```js
// eslint-disable-next-line aem-forms/display-format-in-code
return `₹${formatIndianNumber(amount)}`;              // suppressed on the next line

const s = `${v} months`; // eslint-disable-line aem-forms/component-owns-model-concern   ← same line

// eslint-disable-next-line                            // bare = suppress ALL rules on the next line
input.dispatchEvent(new Event('change'));

// eslint-disable aem-forms/rule-performance           // no -line/-next-line = WHOLE FILE
```

```css
/* CSS has no `//` — use a block comment; both -line and -next-line work */
/* eslint-disable-next-line aem-forms/css-import-blocking */
@import url('./assisted-by-bank.css');
```

- Honored by both `lint` **and** `analyze --fail-on` (a suppressed finding never fails the gate).
- Works for **every** analyzer — including the whole-form / runtime ones the ESLint plugin can't host.
- **CSS:** use the `/* … */` block-comment form (CSS has no `//`); both `-line` and `-next-line` are honored.
- **Line-less findings** (runtime findings that carry no source line, e.g. `runtime-error-in-custom-function`) can only be silenced by the **file-wide** form — a bare `eslint-disable` (optionally with a rule list), with no `-line`/`-next-line`. Placed anywhere in the file, it applies to the whole file.
- To silence a whole file or path instead, use `--exclude '<regex>'` (repeatable); generated bundles, `node_modules`, `*.test.js`/`*.spec.js`, and the vendored `afb-runtime.js` are excluded automatically.

### ESLint plugin — editor integration

The **JS-anchored** design-canon rules (display-format, content-in-code, field-writes-sibling, should-be-component, component-owns-model-concern) also ship as `eslint-plugin-aem-forms` for live in-editor squigglies + one-click `eslint-disable`. It **reuses the bot's matcher modules**, so a rule's verdict is identical in the editor and in CI.

```js
// eslint.config.js (flat config, ESLint 9 / 8.57+)
import aemForms from 'eslint-plugin-aem-forms';
export default [
  aemForms.configs.recommended,
  { files: ['**/components/**/*.js'],
    rules: { 'aem-forms/component-owns-model-concern': 'error' } },
];
```

The plugin covers the ~12 single-file rules; the **bot still runs the full set** in CI (the cross-file, whole-form, and runtime analyzers — `storage-class`, `ootb-property-shadow`, `rule-performance`, etc. — cannot be ESLint rules). See [issue #30](https://github.com/adobe-aem-forms/performance-bot/issues/30) for which analyzers live where and why.

### `analyze` vs `lint` — when to use which

Both run the **same full analyzer pipeline** (all analyzers, including the design-canon checks). They differ only in how they're driven and what they do with the results:

| | `analyze` (default command) | `lint` subcommand |
|---|---|---|
| **Question it answers** | "How does this form perform, and what's the CWV impact?" | "Do my files have any error-severity finding (perf or design-canon)? Fail if so." |
| **Input** | live form **URL(s)** (`--url` / `--before`/`--after`), optionally `--diff` to scope files | **files** — explicit paths, `--diff`, or `--dir` (no URL, no browser) |
| **Output** | a full Markdown **report** (perf sections + a **Design Canon** summary) written to `-o` | a findings list; **exits non-zero** on any error-severity finding |
| **Use it for** | PR performance review, before/after comparison, CWV dashboards | pre-commit / pre-PR **gate**, editor integration, CI check |
| **Findings surfaced** | full report, incl. a **Design Canon** section | all findings flattened; **any error fails the gate** |

Both run every analyzer — `lint` differs only in that it's file/offline-driven and turns findings into an exit code. Rule of thumb: **`lint`** while you code (fast, offline, gates on your files); **`analyze`** against a deployed URL when you want the performance picture.

See [docs/release-notes.md](docs/release-notes.md) for full CLI reference.

### Run tests (CI/build)

```bash
# Pre-build test suite (no network)
npm run test:build

# Offline test with fixtures
node test/test-analyzers-offline.js
```

### Use in a PR

1. Add to your PR description:

```
Test URLs:

Before: https://main--your-project.aem.live/
After: https://branch--your-project.aem.live/
```

2. The bot analyzes both URLs and comments on the PR with findings.

## Configuration

Defaults are tuned for Core Web Vitals. Optional: add `.performance-bot.json` in the project root (see [.performance-bot.example.json](.performance-bot.example.json) or [docs/CONFIGURATION.md](docs/CONFIGURATION.md)).

## Setup

### GitHub Action

1. **PAT** (for auto-fix PRs and Gists): GitHub → Settings → Developer settings → Personal Access Tokens. Scopes: `repo`, `workflow`, `gist`. Store as `PAT_TOKEN` in repo Secrets.

2. **Workflow** – Create `.github/workflows/performance-check.yml`:

```yaml
name: Performance Check

on:
  pull_request:
    types: [opened, synchronize, reopened, edited]

permissions:
  contents: write
  pull-requests: write

jobs:
  performance-analysis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.PAT_TOKEN }}
          fetch-depth: 0

      - name: Run Performance Bot
        uses: rismehta/forms-performance-bot@v1.73
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
        env:
          PAT_TOKEN: ${{ secrets.PAT_TOKEN }}
          # Optional: AI auto-fix
          AZURE_API_KEY: ${{ secrets.AZURE_API_KEY }}
          AZURE_OPENAI_ENDPOINT: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
          AZURE_OPENAI_MODEL: ${{ secrets.AZURE_OPENAI_MODEL }}
          AZURE_OPENAI_API_VERSION: ${{ secrets.AZURE_OPENAI_API_VERSION }}

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: performance-report-pr-${{ github.event.pull_request.number }}
          path: performance-report.html
          retention-days: 90
```

### AI auto-fix (optional)

Set repo secrets: `AZURE_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_MODEL`, `AZURE_OPENAI_API_VERSION`. The bot can open a PR with CSS fixes and JS suggestions (DOM/HTTP/window → model.dispatch, request(), etc.). You review and merge the auto-fix PR into your branch.

## Architecture

```
GitHub Action:  PR (Before/After URLs) → URL extraction → runAnalysis → compare → PR comment + optional auto-fix PR
analyze CLI:    URL(s) / --diff files  → runAnalysis → Markdown report (perf + Design Canon sections)
lint CLI:       files / --diff / --dir → runAnalysis → collectFindings → exit non-zero on error findings
```

All three call the same `runAnalysis()` in `src/pipeline.js`, so every analyzer runs in every mode; the modes differ only in input and how results are surfaced.

### Analyzers

Every analyzer lives in `src/analyzers/` and is wired into `src/pipeline.js`. The full list is `src/pipeline.js` itself — perf analyzers (`FormAnalyzer`, `FormEventsAnalyzer`, `RulePerformanceAnalyzer`, `CustomFunctionAnalyzer`, `RuntimeCLSAnalyzer`, `FormHTMLAnalyzer`, `FormCSSAnalyzer`, …) and design-canon analyzers (`StorageClassAnalyzer`, `FieldWritesSiblingAnalyzer`, `DisplayFormatInCodeAnalyzer`, …). The design-canon keys are enumerated in `DESIGN_CANON_KEYS` (`src/reporters/pr-reporter-form.js`).

### Project structure

```
src/
├── index.js           ← GitHub Actions entry point (PR + scheduled modes)
├── pipeline.js        ← Shared analyzer pipeline (single source of truth)
├── cli/
│   ├── analyze.js     ← CLI entry: default `analyze` report + `lint` subcommand dispatch
│   ├── lint.js        ← forms linter (runLintMain, collectFindings, isGating)
│   ├── suppressions.js← inline `// eslint-disable[-next-line] aem-forms/<rule>` handling
│   └── file-loaders.js← shared file/diff loaders + isAuthoredSource (non-authored exclusion)
├── analyzers/         ← one file per analyzer (perf + design-canon)
│   ├── format-detection.js   ← shared display-format matcher (bot + ESLint plugin)
│   ├── concept-tokens.js     ← shared OOTB concept-token normalizer (bot + plugin)
│   ├── text-predicates.js    ← shared isProse (dependency-free)
│   └── form-file-tiers.js    ← component/fragment/form tier classification
├── data/
│   └── runtime-property-matrix.js  ← OOTB property matrix (.js so ncc inlines it)
├── reporters/
│   └── pr-reporter-form.js   ← report rendering + DESIGN_CANON_KEYS
└── utils/ …

eslint-plugin/         ← eslint-plugin-aem-forms (JS-anchored rules; reuses src/analyzers matchers)
├── index.js           ← plugin + `recommended` flat-config preset
└── rules/*.js         ← one rule per Group-A analyzer
```

### Adding a new analyzer

`src/pipeline.js` is the single source of truth for the analyzer pipeline. Both the GitHub Action and the local CLI import from it. You only need to touch it once.

**Steps:**

1. **Create** `src/analyzers/my-analyzer.js` with `analyze(...)` and `compare(before, after)` methods following the existing analyzer pattern.

2. **Wire into `src/pipeline.js`** — import it, run `analyze()`, and add its result key (`{ after, newIssues, resolvedIssues }`) to the returned object. `lint` picks it up automatically (`collectFindings` iterates every result key).

3. **If it's a design-canon rule**, add its result key to `DESIGN_CANON_KEYS` in `src/reporters/pr-reporter-form.js` — that single map drives the `analyze` report's Design Canon section, the summary count, and the AI-autofix titles.

4. **Add tests** — `test/test-design-canon.js` for a design-canon analyzer (bad/good fixtures + a dedicated block), or `test/test-all-analyzers.js` for a perf analyzer.

5. **(Optional) expose it as an ESLint rule** — if the analyzer is single-JS-file (Group A), add a rule under `eslint-plugin/rules/` that **imports the analyzer's matcher/statics** (never re-implements them), register it in `eslint-plugin/index.js` + the `recommended` preset, and cover it in `test/test-eslint-plugin.js`. Cross-file / whole-form / runtime analyzers stay bot-only.

That's it. The Action, both CLI modes, and the release bundle pick up the change through the shared pipeline; inline `// eslint-disable aem-forms/<type>` suppression works automatically (keyed on the finding `type`).

## Performance checks (what the bot enforces)

### Form structure
- Component count and nesting depth (configurable thresholds).

### Form events
- **No API calls in `initialize`** – `request`/`fetch`/XHR/axios in `events.initialize` blocks rendering; move to custom events after render or lazy flows.

### Hidden fields
- **Unnecessary hidden fields** – Hidden fields with no visibility toggles in JS or events bloat the DOM; add visibility logic or remove.

### Disabled fields
- **Disabled vs readOnly** – Disabled fields do not submit; use readOnly when the value must be in submission. Bot reports disabled fields and enable/disable usage in JS and events.

### Rules
- **Circular dependencies** – Can cause infinite loops.
- **Slow rules** – Rules over threshold (e.g. 50 ms) can block; optimize or defer.

### Custom functions
- **No DOM access** – No `document.querySelector`, `createElement`, etc.; use model and rules; DOM in custom components only.
- **No window access** – No `window`; use scope/globals for headless compatibility.
- **No direct HTTP** – No `fetch`/XHR/axios; use the form API tool (`request()` / Invoke Service).

### Runtime CLS
- **During form load** (in `decorate`, `decorateForm`, `init`, `setup`, or inside `subscribe` that runs at load): no `loadCSS`, no dynamic `import()` of CSS, no `createElement('style'|'link')`, no `classList.add`/`remove`/`toggle` or `element.style.*` that cause layout shift.
- **Allowed:** One-time class/style in the **direct body** of init functions; state classes (e.g. valid, error, focused); class/style in **event handlers** (click, change, etc.).

### Form HTML
- **Images** – Non-hero images must use lazy loading; set width/height to avoid CLS.
- **Scripts** – No inline or blocking scripts; use async/defer where possible.
- **Iframes, autoplay video** – Flagged for performance.
- **Large data attributes, excessive hidden/inline** – Flagged for DOM size.

### Form CSS
- **No `background-image`** – Use Image component for lazy loading.
- **No large inline data URIs** (>5 KB) in CSS.
- **@import** – Flagged (prefer build-time bundling).
- **Excessive !important**, **deep selectors** (>4), **duplicate selectors** – Maintainability and performance.
- **Hardcoded colors** – Prefer CSS custom properties / design tokens.
- **Large CSS files** (>100 KB) – Consider splitting.

## Local testing (reference)

- **`npm run test:build`** – Full test suite used on build.
- **`node test/test-analyzers-offline.js`** – Offline run with fixtures; report: `test/output/offline-pr-comment.md`.
- **`node test/run-test.js --before <url> --after <url>`** – Live URL analysis; report: `test/output/pr-comment.md`.
- **`node test-local-with-files.js --before <url> --after <url> [--js-dir <path>] [--css-dir <path>]`** – Full analysis with local form code; report: `test/output/pr-comment.md`.

See [test/README.md](test/README.md) for the three test modes and limitations.

## License

MIT
