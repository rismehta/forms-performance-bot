# Performance Bot

A GitHub Action that analyzes Adaptive Form performance by comparing before/after URLs in pull requests.

## Features

- **Form structure** – Component count, nesting depth, complexity
- **Form events** – Blocking API calls in `initialize` events (move to custom events after render)
- **Hidden fields** – Unnecessary hidden fields that bloat the DOM (never made visible)
- **Disabled fields** – Disabled vs readOnly; disabled fields do not submit data
- **Rule performance** – Circular dependencies (infinite loops) and slow rules (via @aemforms/af-core)
- **Custom functions** – DOM access, **window** access, and HTTP requests (use API tool / `request()` instead)
- **Runtime CLS** – Dynamic CSS/style/class during form load (e.g. in `subscribe` or init) that causes layout shift
- **Form HTML** – Lazy loading, image dimensions, blocking/inline scripts, iframes, autoplay
- **Form CSS** – background-image, large data URIs, @import, deep/duplicate selectors, !important, hardcoded colors, large files
- **AI auto-fix** – Optional PR with fixes (CSS + JS suggestions for DOM/HTTP/window); Azure OpenAI
- **CWV-focused reports** – Impact mapped to Core Web Vitals; configurable thresholds

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
PR (Before/After URLs) → URL extraction (HTML, Form JSON, JS/CSS from branch)
                     → Parallel analysis (analyzers)
                     → Compare before/after, report, optional auto-fix PR
```

### Analyzers

| Analyzer | Purpose |
|----------|---------|
| **FormAnalyzer** | Structure, component count, depth |
| **FormEventsAnalyzer** | API calls in `events.initialize` (blocks render) |
| **HiddenFieldsAnalyzer** | Hidden fields never made visible (JS/events) |
| **DisabledFieldsAnalyzer** | Disabled vs readOnly; enable/disable in JS and events |
| **RulePerformanceAnalyzer** | Circular rule dependencies + slow rules (@aemforms/af-core) |
| **CustomFunctionAnalyzer** | DOM access, **window** access, HTTP (fetch/XHR/axios) in custom functions |
| **RuntimeCLSAnalyzer** | Dynamic CSS/style/class during form load (decorate vs subscribe) |
| **FormHTMLAnalyzer** | Lazy load, dimensions, blocking/inline scripts, iframes, videos |
| **FormCSSAnalyzer** | background-image, data URIs, @import, selectors, !important, colors, file size |
| **EventImpactAnalyzer** | Event/rule → impacted field names (reporting/CLI) |

### Project structure

```
src/
├── index.js           ← GitHub Actions entry point (PR + scheduled modes)
├── pipeline.js        ← Shared analyzer pipeline (single source of truth)
├── cli/
│   └── analyze.js     ← Local CLI entry point
├── extractors/
│   └── json-extractor.js
├── analyzers/
│   ├── url-analyzer.js
│   ├── form-analyzer.js
│   ├── form-events-analyzer.js
│   ├── hidden-fields-analyzer.js
│   ├── disabled-fields-analyzer.js
│   ├── rule-performance-analyzer.js
│   ├── custom-function-analyzer.js
│   ├── runtime-cls-analyzer.js
│   ├── form-html-analyzer.js
│   ├── form-css-analyzer.js
│   ├── event-impact-analyzer.js
│   └── ai-autofix-analyzer.js
├── reporters/
│   └── pr-reporter-form.js
└── utils/
    ├── config-loader.js
    └── github-helper.js
```

### Adding a new analyzer

`src/pipeline.js` is the single source of truth for the analyzer pipeline. Both the GitHub Action and the local CLI import from it. You only need to touch it once.

**Steps:**

1. **Create** `src/analyzers/my-analyzer.js` with `analyze(...)` and `compare(before, after)` methods following the existing analyzer pattern.

2. **Wire into `src/pipeline.js`**:
   - Import the analyzer at the top
   - Call `analyze()` inside the `Promise.all([...])` in `runAnalysis()`
   - Call `compare()` in the results assembly block
   - Add the result key to the returned object

3. **Report the findings** in `src/reporters/pr-reporter-form.js` — add a section that reads from the new results key.

4. **Add unit tests** in `test/test-all-analyzers.js` using fixture data from `test/fixtures/`.

5. **Update `test/test-cli.js`** — add the new key to `EXPECTED_KEYS` and assert the result shape.

That's it. `src/index.js`, `src/cli/analyze.js`, and `test/test-runner.js` all pick up the change automatically through the shared pipeline.

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
