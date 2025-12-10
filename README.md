# Performance Bot

A GitHub Action that analyzes Adaptive Form performance by comparing before/after URLs in pull requests.

## Features

- 🔍 **Form Structure Analysis**: Analyzes component count, nesting depth, and complexity
-  **Form Events Analysis**: Detects blocking API calls in initialize events
- 👁️ **Hidden Fields Detection**: Identifies unnecessary hidden fields bloating the DOM
- 🔄 **Rule Cycle Detection**: Finds circular dependencies in form rules using @aemforms/af-core
- ⚙️ **Custom Function Validation**: Detects DOM access and HTTP requests in custom functions
- 🎨 **Form HTML Analysis**: Checks lazy loading, image dimensions, blocking scripts
-  **CSS Analysis**: Detects architectural issues like background-image, @import, deep selectors
-  **AI Auto-Fix PR**: Automatically creates a PR with fixes for CSS issues, ready to merge into your branch (Azure OpenAI GPT-4.1)
-  **CWV-Optimized Reports**: Actionable insights with Core Web Vitals impact
- ⚙️ **Configurable Thresholds**: Smart defaults, fully customizable

## Quick Start

### Test Locally First

```bash
# Quick offline test with fixtures (no network)
node test/test-analyzers-offline.js

# Or test with live URLs
./test-local.sh https://your-before-url.aem.live/ https://your-after-url.aem.live/
```

**📖 See [Local Testing](#local-testing) for complete testing guide.**

### Deploy to GitHub

1. Add the following to your PR description:

```
Test URLs:

Before: https://main--forms-engine--hdfc-forms.aem.live/
After: https://branch--forms-engine--hdfc-forms.aem.live/
```

2. The bot will automatically analyze both URLs and comment on the PR with findings.

## Configuration

The Performance Bot works out-of-the-box with **Core Web Vitals (CWV) optimized defaults**. No configuration needed!

### Optional: Customize Thresholds

Create `.performance-bot.json` in your project root:

```json
{
  "thresholds": {
    "form": {
      "maxComponents": 100,
      "maxDepth": 10
    },
    "html": {
      "maxDOMSize": 1000
    }
  }
}
```

**📖 See [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) for more examples and options.**

## Setup

### As a GitHub Action

#### 1. Create Personal Access Token (PAT)

**Required for:** Auto-fix PRs and Gist creation

1. Go to **GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic)**
2. Click **Generate new token (classic)**
3. **Scopes required:**
   -  `repo` (Full repository access)
   -  `workflow` (Update workflows)
   -  `gist` (Create gists for inline report viewing) ← **NEW!**
4. Click **Generate token** and copy it
5. Go to your repository → **Settings → Secrets → Actions**
6. Add secret: `PAT_TOKEN` with the token value

#### 2. Create Workflow

Create `.github/workflows/performance-check.yml` in your repository:

```yaml
name: Performance Check

on:
  pull_request:
    types: [opened, synchronize, reopened, edited]

permissions:
  contents: write  # Required for auto-fix PR creation
  pull-requests: write

jobs:
  performance-analysis:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.PAT_TOKEN }}  # Use PAT, not GITHUB_TOKEN
          fetch-depth: 0
      
      - name: Run Performance Bot
        uses: rismehta/forms-performance-bot@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}  # Default token (has checks:write)
        env:
          PAT_TOKEN: ${{ secrets.PAT_TOKEN }}  # Only for PR creation + Gist
          # Optional: Enable AI Auto-Fix with Codex
          AZURE_API_KEY: ${{ secrets.AZURE_API_KEY }}
          AZURE_OPENAI_ENDPOINT: 'https://your-endpoint.openai.azure.com/openai/responses'
          AZURE_OPENAI_MODEL: 'gpt-5.1-codex'
          AZURE_OPENAI_API_VERSION: '2025-04-01-preview'
      
      - name: Upload Performance Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: performance-report-pr-${{ github.event.pull_request.number }}
          path: performance-report.html
          retention-days: 90
```

### AI Auto-Fix Configuration (Optional)

To enable AI-powered auto-fix suggestions with Codex, add Azure OpenAI credentials to your repository secrets:

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Add secret: `AZURE_API_KEY` with your Azure OpenAI API key
3. Update workflow env vars with your endpoint details

**Environment Variables:**

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `AZURE_API_KEY` (or `AZURE_OPENAI_API_KEY`) | Azure OpenAI API key | - | Yes |
| `AZURE_OPENAI_ENDPOINT` | Custom endpoint URL | `.../openai/responses` | Yes |
| `AZURE_OPENAI_MODEL` | Model name (e.g., gpt-5.1-codex) | `gpt-5.1-codex` | Yes |
| `AZURE_OPENAI_API_VERSION` | API version | `2025-04-01-preview` | Yes |

**Note:** The bot supports both standard Azure OpenAI and custom Codex endpoints. Use `AZURE_API_KEY` for Bearer auth or `AZURE_OPENAI_API_KEY` for api-key header.

**Old Variable Names (Deprecated):**

| Variable | Description | Default |
|----------|-------------|---------|
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API Key | *(required for AI features)* |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL | `https://forms-azure-openai-stg-eastus2.openai.azure.com/` |
| `AZURE_OPENAI_DEPLOYMENT` | Model deployment name | `gpt-4.1-garage-week` |
| `AZURE_OPENAI_API_VERSION` | Azure API version | `2024-12-01-preview` |

**What AI Auto-Fix Does:**
-  **Creates Auto-Fix PR** with fixes and annotations applied
-  **CSS Fixes:**
  - Comments out @import statements (with bundling guidance)
  - Comments out background-image (with lazy-load guidance)
-  **JS Fixes with GitHub Suggestions:**
  - Generates refactored code for HTTP requests → custom events
  - Generates refactored code for DOM access → setProperty()
  - **One-click "Apply suggestion" button** in PR comment
  - AI-powered code generation using Azure OpenAI GPT-4.1
-  **JS Annotations in Auto-Fix PR:**
  - Flags problematic functions with warning comments
- 💡 **Detailed Suggestions** for complex issues:
  - Hidden fields → setVariable() migration
  - API calls from initialize → custom events

**How Auto-Fix PR Works:**
1. Bot analyzes your PR and detects fixable issues (CSS + JS annotations)
2. Bot creates a **separate PR** targeting your feature branch
3. You review the auto-fix PR and merge if acceptable
4. Your original PR automatically includes the fixes

**GitHub Suggestions (One-Click Fix):**

The bot generates AI-powered refactored code and posts it as **GitHub suggestions** in the PR comment:

```markdown
### Custom Function: fetchMergedBranchDetails()

**File:** `blocks/form/functions.js:123`

**Issue:** Makes direct HTTP request, bypassing form's error handling

**One-Click Fix:** Apply the suggestion below

```suggestion
export function fetchMergedBranchDetails(field, globals) {
  globals.functions.dispatchEvent(field, 'custom:fetchBranchData', {
    branchId: field.$value
  });
}
```

**Step 2: Add to Form JSON**
```json
"events": {
  "custom:fetchBranchData": [
    "request(externalize('/api/branches/' & $event.detail.branchId), 'GET')"
  ]
}
```

Click **"Apply suggestion"** → Code is automatically updated in your PR!

**Re-runs:**
- If you edit your original PR (adding URLs, etc.), the bot runs again
- The bot **updates the existing auto-fix PR** (force push) with latest changes
- No duplicate PRs are created

All changes are **non-destructive** (comments/annotations only) and **fully reversible** — you control what gets merged.

```

## Architecture

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  1. PR Trigger → Bot reads PR description for URLs          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  2. URL Extraction Phase                                     │
│     • Fetch Before & After URLs                             │
│     • Extract Form JSON (from div.form pre)                 │
│     • Extract HTML content                                  │
│     • Fetch JS/CSS files from PR branch                     │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  3. Parallel Analysis Phase (7 Analyzers)                   │
│     ├─ FormAnalyzer: Structure & complexity                 │
│     ├─ FormEventsAnalyzer: API calls in initialize          │
│     ├─ HiddenFieldsAnalyzer: Unnecessary hidden fields      │
│     ├─ RuleCycleAnalyzer: Circular dependencies             │
│     ├─ CustomFunctionAnalyzer: DOM/HTTP violations          │
│     ├─ FormHTMLAnalyzer: Rendering performance              │
│     └─ FormCSSAnalyzer: CSS architectural issues            │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  4. Comparison & Reporting                                   │
│     • Compare Before vs After                               │
│     • Detect new/resolved issues                            │
│     • Calculate CWV impact                                  │
│     • Post formatted PR comment                             │
└─────────────────────────────────────────────────────────────┘
```

### Project Structure

```
src/
├── index.js                          # Orchestrates entire analysis flow
├── extractors/
│   └── json-extractor.js             # Extracts form JSON from HTML
├── analyzers/
│   ├── url-analyzer.js               # Fetches URLs & extracts data
│   ├── form-analyzer.js              # Analyzes form structure
│   ├── form-events-analyzer.js       # Detects API calls in initialize
│   ├── hidden-fields-analyzer.js     # Finds unnecessary hidden fields
│   ├── rule-cycle-analyzer.js        # Detects circular dependencies
│   ├── custom-function-analyzer.js   # Validates custom functions
│   ├── form-html-analyzer.js         # Analyzes form HTML performance
│   └── form-css-analyzer.js          # Detects CSS issues
├── reporters/
│   └── pr-reporter-form.js           # Generates markdown PR comments
└── utils/
    ├── config-loader.js              # Loads configuration with CWV defaults
    └── github-helper.js              # GitHub API utilities
```

## Local Testing

The Performance Bot provides three testing modes to validate analyzers locally before deploying to GitHub:

### 1. 🧪 Offline Unit Test (Fastest)

**No network required** - Tests all analyzers with mock fixtures in `test/fixtures/`

```bash
cd /Users/rismehta/performance-bot
node test/test-analyzers-offline.js
```

**What it tests:**
-  Form structure analysis
-  Hidden fields detection with mock JS
-  Rule cycle detection (circular dependencies)
-  Custom function violations (DOM access, HTTP requests)
-  Form HTML analysis
-  CSS architectural issues

**Use when:** Quick validation during development

---

### 2.  Remote URLs (Basic)

Tests with **live form URLs** but no local code analysis

```bash
./test-local.sh \
  https://main--forms-engine--hdfc-forms.aem.live/ \
  https://branch--forms-engine--hdfc-forms.aem.live/
```

**What it tests:**
-  JSON extraction from real pages
-  Form structure
-  Form events (API in initialize)
-  Form HTML
-  Hidden fields (inaccurate - no JS files)
-  Custom functions (none found - no JS files)
-  CSS (none found - no CSS files)

**Use when:** Quick sanity check of form structure

---

### 3. 🎯 Remote URLs + Local Code (Complete)

Tests with **live URLs AND your local codebase**

```bash
node test-local-with-files.js \
  --before https://main--forms-engine--hdfc-forms.aem.live/ \
  --after https://branch--forms-engine--hdfc-forms.aem.live/ \
  --js-dir /Users/rismehta/forms-engine/blocks/form \
  --css-dir /Users/rismehta/forms-engine/styles
```

**What it tests:**
-  Form JSON from real page
-  Form structure
-  Form events
-  **Hidden fields (accurate!)** - checks against your JS files
-  **Custom functions** - analyzes your actual functions
-  **Rule cycles** - detects circular dependencies using af-core
-  Form HTML
-  **CSS** - analyzes your stylesheets

**Use when:** Complete pre-PR validation

---

### Test Output

All tests generate a detailed markdown report:

```bash
📄 Check the output at: test/output/pr-comment.md
```

This shows **exactly** what would appear in a GitHub PR comment.

### Example Results

```
Total Issues Detected: 24
  - Form Structure: 0
  - Form Events: 0
  - Hidden Fields: 6 
  - Rule Cycles: 1  (fieldA → fieldB → fieldC → fieldA)
  - Custom Functions: 2 
  - Form HTML: 0
  - CSS: 16 
```

**📖 See [`test/README.md`](test/README.md) for detailed testing documentation.**

---

## Performance Checks

### 1. Form Structure
- **Component count** (default: ≤75) - Impacts DOM size
- **Nesting depth** (default: ≤8) - Impacts style recalculation
- **Event handlers** (default: ≤30) - Impacts JavaScript execution

### 2. Form Events
- **API calls in initialize** - Blocks form rendering (critical issue)
- Recommends moving to custom events or lazy loading

### 3. Hidden Fields
- **Unnecessary hidden fields** - Bloat DOM unnecessarily
- Cross-references with JavaScript to check if ever made visible

### 4. Rule Cycles
- **Circular dependencies** - Can cause infinite loops
- Uses @aemforms/af-core to build accurate dependency graph

### 5. Custom Functions
- **DOM access detection** - Custom functions shouldn't manipulate DOM
- **HTTP request detection** - Should use API tool (request()) instead

### 6. Form HTML
- **Non-lazy loaded images** - Impacts LCP
- **Missing image dimensions** - Causes CLS
- **Blocking scripts** - Delays interactivity
- **Iframes, autoplay videos** - Performance impact

### 7. CSS
- **background-image usage** - Should use Image component
- **@import statements** - Blocks parallel loading
- **Deep selectors** (>3 levels) - Slow selector matching
- **Excessive !important** - Code smell

## License

MIT

