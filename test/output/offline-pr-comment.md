## Form Performance Analysis Report

> **Automated analysis of Adaptive Form performance**

**Analysis Time:** 2025-12-09T09:39:04.595Z
**Before:** `https://main--test-repo.aem.live/`
**After:** `https://feature--test-repo.aem.live/`

---

### Form Structure

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Components | 13 | 13 | undefined  |
| Event Handlers | 1 | 1 | undefined  |
| Max Nesting Depth | 2 | 2 | undefined  |

### Form Events Analysis

 No API calls found in initialize events.

###  Hidden Fields Analysis

**Total Hidden Fields:** 7
**Unnecessary Hidden Fields:** 6

**Changes:**
- Hidden fields: undefined 
- Unnecessary fields: undefined 

####  Unnecessary Hidden Fields Detected

**Field: `hiddenPanel`**
- **Issue:** Field "hiddenPanel" is always hidden and increases DOM size unnecessarily.
- ** Recommendation:** Consider removing this field from the form and storing this as form variable. Hidden fields that are never shown bloat the DOM and impact performance.

**Field: `unusedField`**
- **Issue:** Field "unusedField" is always hidden and increases DOM size unnecessarily.
- ** Recommendation:** Consider removing this field from the form and storing this as form variable. Hidden fields that are never shown bloat the DOM and impact performance.

**Field: `dataStorage`**
- **Issue:** Field "dataStorage" is always hidden and increases DOM size unnecessarily.
- ** Recommendation:** Consider removing this field from the form and storing this as form variable. Hidden fields that are never shown bloat the DOM and impact performance.

**Field: `userId`**
- **Issue:** Field "userId" is always hidden and increases DOM size unnecessarily.
- ** Recommendation:** Consider removing this field from the form and storing this as form variable. Hidden fields that are never shown bloat the DOM and impact performance.

**Field: `sessionId`**
- **Issue:** Field "sessionId" is always hidden and increases DOM size unnecessarily.
- ** Recommendation:** Consider removing this field from the form and storing this as form variable. Hidden fields that are never shown bloat the DOM and impact performance.

**Field: `email`**
- **Issue:** Field "email" is always hidden and increases DOM size unnecessarily.
- ** Recommendation:** Consider removing this field from the form and storing this as form variable. Hidden fields that are never shown bloat the DOM and impact performance.

###  Rule Dependency Cycles

**Total Rules:** 4
**Fields with Rules:** 4
**Circular Dependencies:** 1

####  Critical: Circular Dependencies Found

**Cycle 1:** `fieldA → fieldA → fieldB → fieldC`
- **Fields involved:** fieldA, fieldB, fieldC
- ** Recommendation:** Break this circular dependency by removing or modifying one of the rules. This can cause infinite loops and severely impact performance.

####  New Circular Dependencies Introduced

- `fieldA → fieldA → fieldB → fieldC`

###  Form Rendering Performance

**Rendered Form Analysis:**
- Total DOM Elements: 27
- Hidden Elements: 0
- Images: 3 (1 without lazy loading)
- Blocking Scripts: 0

**Changes:**
- Images: undefined 
- Non-lazy images: undefined 
- DOM elements: undefined 
- Blocking scripts: undefined 

 No form rendering issues detected.

###  Form CSS Analysis

**Files Analyzed:** 1

**Issues Found:**
- CSS background-image: 2 (should use Image component)
- Deep selectors: 13

#### CSS Issues Detected

**Warnings:**

**[WARN] sample-form.css:5** - css-background-image
- CSS background-image detected: "images/hero.jpg". Consider using Image component instead.
- Image: `images/hero.jpg`
- Recommendation: Replace with <Image> component for better lazy loading, responsive images, and automatic optimization. Background images cannot be lazy loaded and impact form rendering performance.

**[WARN] sample-form.css:12** - css-background-image
- CSS background-image detected: "/assets/card-bg.png". Consider using Image component instead.
- Image: `/assets/card-bg.png`
- Recommendation: Replace with <Image> component for better lazy loading, responsive images, and automatic optimization. Background images cannot be lazy loaded and impact form rendering performance.

**[WARN] sample-form.css:22** - css-import-blocking
- @import blocks rendering: "theme.css"
- Recommendation: Replace @import with <link> tags or bundle CSS files. @import forces sequential loading and delays form rendering.


*Note: 13 additional CSS issue(s) not shown (mostly informational). Check CSS files for full details.*

###  Custom Functions Analysis

**Functions Found:** 1
**Functions Analyzed:** 1

####  Violations Detected

** 1 DOM Access(es) in Custom Functions:**

- `validateUserName` in `sample-functions.js`
  - Remove DOM access from custom functions. Use form data model and rules engine for UI updates. DOM manipulations should be handled in custom component, not custom functions.


---
###  Overall Assessment

**Performance Impact:** Critical Issues Detected 

** Critical Issues:**
- 1 circular dependency introduced - can cause infinite loops
- 1 @import statement(s) blocking rendering
- 1 custom function(s) accessing DOM directly

** Warnings:**
- 6 unnecessary hidden field(s) bloating DOM
- 3 CSS warning(s)
- 2 CSS background-image(s) should use Image component

** Recommendations:**
- Remove hidden fields that are never shown - use JavaScript variables instead
- Break circular dependencies immediately - these cause severe performance issues
- Replace CSS background images with <Image> component for lazy loading and optimization
- Replace @import with <link> tags or bundle CSS
- Remove DOM access from custom functions - use form data model instead

---
*Generated by AEM Forms Performance Analyzer*