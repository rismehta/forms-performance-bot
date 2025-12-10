# Performance Bot - Test Suite

## 🧪 Three Ways to Test

| Mode | Network | JS/CSS | Speed | Use Case |
|------|---------|--------|-------|----------|
| **1. Offline Unit Test** |  No |  Mock |  Fastest | Quick analyzer testing |
| **2. Live URLs (Basic)** |  Yes |  No |  Fast | Quick form check |
| **3. Live URLs (Full)** |  Yes |  Local |  Complete | Full local validation |

---

## Test 1: Offline Unit Test  **Recommended for Development**

**No network required! Tests all analyzers with mock data.**

```bash
cd /Users/rismehta/performance-bot
node test/test-analyzers-offline.js
```

### What It Tests:

 **All 7 Analyzers with Mock Data:**
1. Form Structure - Component count, depth, events
2. Form Events - API calls in initialize detection
3. Hidden Fields - Path matching with mock JS
4. Custom Functions - DOM access & HTTP detection
5. Form HTML - Lazy loading, dimensions, blocking scripts
6. CSS - background-image, @import, deep selectors
7. Rule Cycles - (skipped in mock, needs real form)

### Expected Issues Detected:

```
 1 API call in initialize (fetch)
 2 unnecessary hidden fields (unusedField, userId)
 2 custom function violations (DOM access, HTTP request)
 1 non-lazy loaded image
 1 blocking script
 4+ CSS issues
```

### Benefits:

-  **Super fast** (~1-2 seconds)
- 🔒 **No network needed**
- 🎯 **Tests exact patterns** you care about
- 🐛 **Easy debugging** - controlled data

---

## Test 2: Live URLs (Basic)  **Quick Form Check**

**Tests with real form URLs, but no JS/CSS analysis.**

```bash
cd /Users/rismehta/performance-bot
./test-local.sh \
  https://applyonline.hdfcbank.com/loan-against-assets/smartemi/smartemi \
  https://applyonline.hdfcbank.com/loan-against-assets/smartemi/smartemi
```

### What It Tests:

-  Form JSON extraction from real page
-  Form structure (components, depth)
-  Form events (API in initialize)
-  Form HTML (images, scripts)
-  Hidden fields (**inaccurate** - marks all as unnecessary)
-  Custom functions (finds nothing - no JS)
-  CSS (finds nothing - no CSS)

###  Limitations:

```
Mock JS files: 0
Mock CSS files: 0

**Total Hidden Fields:** 70
**Unnecessary Hidden Fields:** 70  ← ALL marked unnecessary!
```

**Why?** No JS files to check against!

### Use Case:

- Quick sanity check of form structure
- Verify JSON extraction works
- Check for obvious issues (API in initialize)

---

## Test 3: Live URLs (Full) 🎯 **Complete Local Validation**

**Tests with real URLs AND your local codebase.**

```bash
cd /Users/rismehta/performance-bot
node test-local-with-files.js \
  --before https://applyonline.hdfcbank.com/loan-against-assets/smartemi/smartemi \
  --after https://applyonline.hdfcbank.com/loan-against-assets/smartemi/smartemi \
  --js-dir /Users/rismehta/forms-engine/blocks/form \
  --css-dir /Users/rismehta/forms-engine/styles
```

### What It Tests:

-  Form JSON from real page
-  Form structure
-  Form events
-  **Hidden fields (accurate!)** - checks against your JS files
-  **Custom functions** - analyzes your actual functions
-  Form HTML
-  **CSS** - analyzes your stylesheets

### Example Output:

```
📂 Loading JavaScript files from: /Users/rismehta/forms-engine/blocks/form
 Loaded 45 JavaScript files

📂 Loading CSS files from: /Users/rismehta/forms-engine/styles
 Loaded 12 CSS files

👁️ Hidden Fields:
  - Total hidden: 70
  - Unnecessary: 5  (Actually accurate!)

⚙️ Custom Functions:
  - Functions analyzed: 12
  - Violations: 2  (DOM access detected)
```

### Use Case:

- Complete pre-PR validation
- Test against production form
- Debug hidden field detection
- Verify custom function compliance

---

## Test Files

### Core Test Files

- **`test-analyzers-offline.js`** - Offline unit test with mock data
- **`test-runner.js`** - Test orchestration engine
- **`run-test.js`** - CLI entry point for live URL tests
- **`test-json-extraction.js`** - Tests JSON extractor specifically
- **`test-config.js`** - Tests configuration loading

### Test Scripts

- **`../test-local.sh`** - Wrapper for basic live URL test
- **`../test-local-with-files.js`** - Full test with local JS/CSS

### Fixtures

```
test/fixtures/
├── js/
│   └── sample-functions.js      # Mock JS with setProperty calls
├── css/
│   └── sample-form.css          # Mock CSS with issues
└── README.md
```

---

## Debugging Guide

### Issue: "All hidden fields marked unnecessary"

**Cause:** No JS files provided

**Solution:**
```bash
# Use Test 3 with your JS directory
node test-local-with-files.js --js-dir /path/to/js
```

### Issue: "Custom functions not found"

**Cause:** Function names extracted from JSON but not found in JS files

**Debug:**
```bash
# Run offline test first to verify function extraction
node test/test-analyzers-offline.js
```

### Issue: "JSON not found in HTML"

**Cause:** Page structure doesn't match `div.form pre`

**Debug:**
```bash
curl -s <your-url> | grep -A 10 'class="form"'
```

---

## How Hidden Field Analysis Works

### Detection Logic:

```javascript
// 1. Find all fields with visible: false
// 2. Check if field has visibility rules in JSON
// 3. Check if field has visibility events in JSON
// 4. Parse ALL JS files for:
//    - globals.functions.setProperty(globals.form?.path?.field, { visible: true })
//    - globals.form?.path?.field.visible = true

// Field is "unnecessary" if:
isUnnecessary = !hasVisibleRule && !hasVisibleEvent && !madeVisibleInJS
```

### Path Matching (Updated for Accuracy):

The analyzer now matches by **both full path AND field name**:

**Example:**
```javascript
// JS: globals.form?.panel1?.email
// Stores as BOTH:
//   - "panel1.email" (full path)
//   - "email" (field name)

// Matching:
//   - Try full path first (most accurate)
//   - Fallback to name (for simple cases)
```

This correctly handles:
-  Simple forms with unique field names
-  Complex forms with duplicate field names
-  Nested panels with same-named fields

---

## Performance

| Test Mode | Time | Bottleneck |
|-----------|------|------------|
| Offline | ~1-2s | None |
| Basic | ~15-25s | URL fetching |
| Full | ~20-40s | URL fetching + file I/O |

**GitHub Actions:** ~15-30s (fetches JS/CSS via API)

---

## Next Steps

1.  Run offline test first: `node test/test-analyzers-offline.js`
2.  Test with your form URL: `./test-local.sh <url> <url>`
3.  Full test with your code: `node test-local-with-files.js --js-dir ... --css-dir ...`
4.  Review output: `cat test/output/pr-comment.md`
5.  Deploy to GitHub Actions when confident

---

## Need Help?

- **See `LOCAL_TESTING.md`** for detailed explanation of limitations
- **See `FULL_LOCAL_TEST_EXAMPLE.md`** for complete examples
- **See `docs/CONFIGURATION.md`** for customizing thresholds
