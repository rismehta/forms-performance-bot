# 📊 Event Impact Analysis CLI

A standalone tool for analyzing event dependencies in AEM Adaptive Forms. Use this as a **pre-deployment validation tool** to understand the ripple effects of event changes.

## 🎯 Purpose

When working with complex forms with many events, it becomes difficult to track:
- **Which events affect which fields**
- **Impact analysis** when modifying an event
- **Custom function usage** across events
- **Performance issues** (HTTP calls, DOM access)

This CLI tool generates a comprehensive report showing all event dependencies.

---

## 📦 Installation

No additional installation needed if you have the performance-bot repository cloned.

```bash
cd /path/to/performance-bot
npm install  # If not already done
```

---

## 🚀 Quick Start

### Basic Usage

```bash
npm run analyze-events -- --form-url https://your-form.aem.live/form
```

### With Custom Output Directory

```bash
npm run analyze-events -- --form-url https://your-form.aem.live/form --output ./my-reports
```

### JSON Format (for automation)

```bash
npm run analyze-events -- --form-url https://your-form.aem.live/form --format json
```

### Both Markdown and JSON

```bash
npm run analyze-events -- --form-url https://your-form.aem.live/form --format both
```

---

## 📖 Command Line Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--form-url` | `-u` | Form URL to analyze (required) | - |
| `--output` | `-o` | Output directory | `./event-impact-reports` |
| `--format` | `-f` | Output format: `markdown`, `json`, `both` | `markdown` |
| `--verbose` | `-v` | Verbose output | `false` |
| `--help` | `-h` | Show help | - |

---

## 📊 What the Report Includes

### 1. **Summary Statistics**
- Total number of events
- Event types (change, click, initialize, etc.)
- Unique fields impacted
- Performance issues count

### 2. **Performance Issues**
- 🔴 **Critical:** HTTP calls in events (blocks interaction)
- 🟡 **Warning:** DOM access, high-impact events (>10 fields)

### 3. **Top Impacted Fields**
- Fields modified by the most events
- Helps identify "hotspots" in your form

### 4. **Most Targeted Fields**
- Fields that are targets of the most events
- Important when changing these fields

### 5. **Custom Function Usage**
- Which custom functions are used
- Where they're called from
- Usage frequency

### 6. **Detailed Event → Field Mapping**
- Every event with its handlers
- Fields impacted by each event
- Custom functions used
- Full event handler code

---

## 🔄 Pre-Deployment Workflow

### Step 1: Run Analysis Before Deployment

```bash
# Analyze your preview environment
npm run analyze-events -- --form-url https://preview--your-repo--org.aem.live/form --output ./pre-deploy
```

### Step 2: Review the Report

Open `./pre-deploy/event-impact-YYYY-MM-DD.md` and check:

✅ **No critical performance issues**
- No HTTP calls in events
- No excessive DOM manipulation

✅ **Understand impact of your changes**
- Which fields will be affected
- Which events need testing

✅ **Verify custom functions**
- Functions are still used correctly
- No orphaned function calls

### Step 3: Add to CI/CD Pipeline

#### GitHub Actions Example

```yaml
name: Pre-Deployment Validation

on:
  pull_request:
    branches: [main]

jobs:
  event-analysis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install Performance Bot
        run: |
          git clone https://github.com/your-org/forms-performance-bot.git
          cd forms-performance-bot
          npm install
      
      - name: Run Event Impact Analysis
        run: |
          cd forms-performance-bot
          npm run analyze-events -- \
            --form-url https://preview--${{ github.repository }}.aem.live/form \
            --format both \
            --output ../event-reports
      
      - name: Upload Report
        uses: actions/upload-artifact@v4
        with:
          name: event-impact-report
          path: event-reports/
      
      - name: Check for Critical Issues
        run: |
          # Script exits with code 1 if critical issues found
          echo "Check the report for critical performance issues"
```

#### Jenkins Example

```groovy
stage('Event Impact Analysis') {
    steps {
        script {
            sh '''
                cd performance-bot
                npm install
                npm run analyze-events -- \
                  --form-url https://preview.example.com/form \
                  --output ${WORKSPACE}/event-reports \
                  --format both
            '''
            
            // Archive the reports
            archiveArtifacts artifacts: 'event-reports/*', fingerprint: true
            
            // Fail build if critical issues found (exit code 1)
            // The CLI automatically exits with 1 if critical issues detected
        }
    }
}
```

---

## 📝 Report Format Examples

### Markdown Report

```markdown
# 📊 Event Impact Analysis Report

## 📈 Summary
| Metric | Value |
|--------|-------|
| Total Events | 147 |
| Event Types | 8 |
| Unique Fields Impacted | 89 |
| Performance Issues | 3 |

## ⚠️ Performance Issues

### 🔴 Critical (2)
- **wizard.yourDetailsPanel.branchCity → change**
  - Event contains HTTP calls - will block user interaction

### 🟡 Warnings (1)
- **loginPanel.emailField → change**
  - Event impacts 15 fields - may cause cascading updates

## 🎯 Top Impacted Fields
| Rank | Field | Times Modified |
|------|-------|----------------|
| 1 | `wizard.reviewMainPanel` | 23 |
| 2 | `loaderFragment` | 18 |
| 3 | `errorPanel` | 15 |

## 🔧 Custom Function Usage
| Function | Usage Count | Sample Events |
|----------|-------------|---------------|
| `fetchMergedBranchDetails()` | 5 | wizard.branchCity → change<br>wizard.pincode → initialize |
```

### JSON Report (for automation)

```json
{
  "totalEvents": 147,
  "events": {
    "wizard.yourDetailsPanel.branchCity → change": {
      "sourceField": "wizard.yourDetailsPanel.branchCity",
      "eventType": "change",
      "handlers": ["..."],
      "impactedFields": ["wizard.branchName", "wizard.branchCode"],
      "customFunctions": ["fetchMergedBranchDetails"],
      "hasHTTPCalls": true,
      "hasDOMAccess": false
    }
  },
  "performanceIssues": [
    {
      "severity": "critical",
      "type": "http-in-event",
      "event": "wizard.yourDetailsPanel.branchCity → change",
      "message": "Event contains HTTP calls - will block user interaction"
    }
  ]
}
```

---

## 💡 Use Cases

### Use Case 1: Before Modifying an Event

**Scenario:** You need to modify the `change` event on `emailField`.

**Steps:**
1. Run analysis: `npm run analyze-events -- --form-url https://...`
2. Search for `emailField → change` in the report
3. Review:
   - Which fields will be impacted
   - What custom functions are called
   - If there are any performance issues
4. Make your changes with confidence

### Use Case 2: Finding All Uses of a Custom Function

**Scenario:** You need to refactor `calculateAge()` function.

**Steps:**
1. Run analysis
2. Look in "Custom Function Usage" section
3. See all events that call `calculateAge()`
4. Update all affected events

### Use Case 3: Performance Audit

**Scenario:** Form is slow, need to find performance issues.

**Steps:**
1. Run analysis
2. Check "Performance Issues" section
3. Find events with HTTP calls or DOM access
4. Refactor problematic events

### Use Case 4: Onboarding New Team Members

**Scenario:** New developer needs to understand form event flow.

**Steps:**
1. Generate report
2. Share markdown file with team
3. Use as documentation for event dependencies

---

## 🔧 Troubleshooting

### Error: "Failed to extract form JSON from URL"

**Cause:** Form URL is not accessible or doesn't contain form JSON.

**Solution:**
- Verify the URL loads in a browser
- Check if it's a valid AEM form URL
- Ensure the form is published

### Error: "Cannot find module"

**Cause:** Dependencies not installed.

**Solution:**
```bash
cd /path/to/performance-bot
npm install
```

### Report shows "0 events"

**Cause:** Form doesn't have any events, or they're defined differently.

**Solution:**
- Verify form has events in the authoring tool
- Check if events are in custom JavaScript (not supported)

---

## 📚 Integration with Other Tools

### Using JSON Output in Scripts

```bash
# Generate JSON report
npm run analyze-events -- --form-url https://... --format json

# Parse with jq to check for critical issues
CRITICAL_COUNT=$(jq '[.performanceIssues[] | select(.severity=="critical")] | length' event-impact-*.json)

if [ "$CRITICAL_COUNT" -gt 0 ]; then
  echo "❌ Found $CRITICAL_COUNT critical issues!"
  exit 1
fi
```

### Diff Between Two Versions

```bash
# Analyze before changes
npm run analyze-events -- --form-url https://preview-old.../form --output ./before

# Analyze after changes  
npm run analyze-events -- --form-url https://preview-new.../form --output ./after

# Compare
diff ./before/event-impact-*.json ./after/event-impact-*.json
```

---

## 🤝 Contributing

Found a bug or have a feature request? Please open an issue!

---

## 📞 Support

For questions or issues:
1. Check this documentation
2. Review the [main README](../README.md)
3. Open an issue on GitHub

---

**Generated by AEM Forms Performance Bot**  
Version: 1.0.0

