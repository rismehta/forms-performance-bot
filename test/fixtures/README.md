# Test Fixtures

This directory contains test fixtures for offline unit testing of all analyzers.

## Files

### `sample-form.json`
**AEM Adaptive Form JSON** adhering to the standard adaptive form schema.

**Structure:**
- `id`, `fieldType: "form"`, `title`, `adaptiveform: "0.14.0"`
- `metadata` with grammar and version
- `events.initialize` with API calls (array format)
- `:items` with panels and fields

**Intentional Issues:**
- ❌ `fetch()` in `events.initialize` - blocks form rendering
- ❌ `loadUserData()` in `events.initialize` - custom function with HTTP
- ❌ 7 hidden fields (only 1 is made visible via JS)

**Hidden Fields:**
1. `hiddenPanel` - Hidden panel (never shown)
2. `hiddenPanel.tempField` - Made visible via `showTempField()` ✅
3. `hiddenPanel.unusedField` - Never made visible ❌
4. `dataStorage` - Hidden panel (never shown)
5. `dataStorage.userId` - Only used for data storage ❌
6. `dataStorage.sessionId` - Only used for data storage ❌
7. `dataStorage.email` - Same name as other field, never shown ❌

### `sample-form.html`
**HTML page** with embedded form JSON and rendered form.

**Intentional Issues:**
- ❌ Images without `loading="lazy"`
- ❌ Images without `width`/`height` (causes layout shift)
- ❌ Blocking `<script>` tags (no `async`/`defer`)
- ❌ Inline blocking script
- ❌ `<iframe>` blocks rendering
- ❌ `<video>` with `autoplay`

**Good Patterns:**
- ✅ Image with `loading="lazy"` and dimensions
- ✅ Script with `async` attribute

### `js/sample-functions.js`
**JavaScript file** with custom functions and visibility manipulation.

**Functions:**
1. `showTempField(globals)` - Makes `hiddenPanel.tempField` visible ✅
2. `setupForm(globals)` - Makes `tempField` visible, sets data on hidden fields
3. `validateUserName(globals)` - ❌ **VIOLATION:** Accesses DOM (`document.querySelector`)
4. `loadUserData(globals)` - ❌ **VIOLATION:** Makes HTTP request (`XMLHttpRequest`)
5. `createJourneyId(channel)` - ✅ **GOOD:** Pure function, no DOM/HTTP
6. `validateField(fieldValue)` - ✅ **GOOD:** Complex logic but no violations

**Expected Detections:**
- ✅ `tempField` made visible via `globals.functions.setProperty(..., { visible: true })`
- ✅ `validateUserName` flagged for DOM access
- ✅ `loadUserData` flagged for HTTP request

### `css/sample-form.css`
**CSS file** with architecture and performance issues.

**Intentional Issues:**
- ❌ `background-image` usage (2 instances) - should use Image Component
- ❌ `@import url(...)` - blocks parallel CSS loading
- ❌ Excessive `!important` usage (7+ instances)
- ❌ Deep selectors (6+ levels deep)
- ❌ Hardcoded colors (should use CSS variables)
- ❌ Duplicate selectors (`.field` appears 3 times)

**Expected Detections:**
- ✅ 2 background-image violations
- ✅ 1 @import violation
- ✅ 13+ deep selector warnings
- ✅ 5+ hardcoded color warnings
- ✅ 3 duplicate selector warnings

## Running Tests

### Quick Test
```bash
cd /Users/rismehta/performance-bot
node test/test-analyzers-offline.js
```

### Expected Output

```
Total Issues Detected: 25+
  - Form Structure: 0
  - Form Events: 1 (fetch in initialize)
  - Hidden Fields: 6 (unnecessary hidden fields)
  - Custom Functions: 2 (validateUserName: DOM, loadUserData: HTTP)
  - Form HTML: 0-3 (depends on thresholds)
  - CSS: 16+ (background-image, deep selectors, etc.)
```

## Modifying Fixtures

### To Add New Test Cases:

1. **Form JSON:** Update `sample-form.json` with new fields/events
2. **HTML:** Update `sample-form.html` with new elements
3. **JS:** Add new functions to `js/sample-functions.js`
4. **CSS:** Add new styles to `css/sample-form.css`

### To Test New Patterns:

**Example: Test new API pattern**
```json
// In sample-form.json, add to events.initialize:
"axios.get('https://api.example.com/data')"
```

**Example: Test new hidden field pattern**
```javascript
// In js/sample-functions.js:
function showEmail(globals) {
  globals.form.dataStorage.email.visible = true;  // Direct assignment
}
```

## Validation

All fixtures should:
- ✅ Follow AEM Adaptive Forms standards
- ✅ Include both good and bad patterns
- ✅ Be documented with comments
- ✅ Represent real-world scenarios

## Coverage

Current test coverage:
- ✅ Form structure analysis
- ✅ API calls in initialize (direct + custom functions)
- ✅ Hidden field detection with path matching
- ✅ Custom function violations (DOM + HTTP)
- ✅ Form HTML rendering issues
- ✅ CSS architecture issues

Missing coverage:
- ⚠️ Rule cycle detection (requires actual form instance)
- ⚠️ Complex rule dependencies
- ⚠️ Multi-level panel nesting (>5 levels)
