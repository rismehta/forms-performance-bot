# 🚀 Quick Start: Event Impact Analysis CLI

## ⚡ TL;DR

```bash
# 1. Clone and install (one-time setup)
git clone https://github.com/your-org/forms-performance-bot.git
cd forms-performance-bot
npm install

# 2. Run analysis on your form
npm run analyze-events -- --form-url https://your-form.aem.live/form

# 3. Open the report
open event-impact-reports/event-impact-*.md
```

---

## 📋 What You'll Get

✅ **Complete event dependency map** - Know which events affect which fields  
✅ **Performance issue detection** - Find HTTP calls and DOM access in events  
✅ **Custom function usage tracking** - See where functions are used  
✅ **Impact analysis** - Understand ripple effects before making changes  

---

## 🎯 Common Use Cases

### 1. Before Modifying an Event

```bash
# Run analysis first
npm run analyze-events -- --form-url https://preview--forms.aem.live/form

# Search report for your field
# See what will be impacted by your change
```

### 2. Pre-Deployment Validation

```bash
# Analyze preview environment
npm run analyze-events -- --form-url https://preview.../form --output ./pre-deploy

# Review report for critical issues
# Exit code 1 if critical issues found (perfect for CI/CD)
```

### 3. Finding All Uses of a Function

```bash
# Generate report
npm run analyze-events -- --form-url https://.../form

# Look in "Custom Function Usage" section
# See everywhere your function is called
```

---

## 📊 Sample Output

```
📊 Event Impact Analysis CLI

🔍 Analyzing form: https://your-form.aem.live/form

⏳ Fetching form data...
✅ Form data fetched (12 top-level keys)

⏳ Analyzing event dependencies...
✅ Analysis complete!

📈 Summary:
   Total Events: 147
   Event Types: 8
   Unique Fields Impacted: 89
   Performance Issues: 3
     - Critical: 2
     - Warnings: 1

📊 Top Impacted Fields:
   1. wizard.reviewMainPanel (23 events)
   2. loaderFragment (18 events)
   3. errorPanel (15 events)

📝 Generating reports...
   ✅ Markdown report: ./event-impact-reports/event-impact-2026-01-21.md

✨ Analysis complete!

⚠️  Warning: 2 critical performance issue(s) detected
   Review the report before deploying to production
```

---

## 🔧 CI/CD Integration (5 minutes)

### GitHub Actions

```yaml
# .github/workflows/pre-deploy-validation.yml
name: Pre-Deploy Validation
on: [pull_request]

jobs:
  event-analysis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      
      - name: Clone Performance Bot
        run: |
          git clone https://github.com/your-org/forms-performance-bot.git
          cd forms-performance-bot && npm install
      
      - name: Analyze Events
        run: |
          cd forms-performance-bot
          npm run analyze-events -- \
            --form-url https://preview--${{ github.repository }}.aem.live/form \
            --output ../reports
      
      - name: Upload Report
        uses: actions/upload-artifact@v4
        with:
          name: event-impact-report
          path: reports/
```

---

## 💡 Pro Tips

### Tip 1: JSON for Automation

```bash
# Generate JSON for scripting
npm run analyze-events -- --form-url https://... --format json

# Check for issues programmatically
jq '.performanceIssues | length' event-impact-*.json
```

### Tip 2: Regular Audits

```bash
# Weekly audit script
#!/bin/bash
DATE=$(date +%Y-%m-%d)
npm run analyze-events -- \
  --form-url https://main--forms.aem.live/form \
  --output ./weekly-reports \
  --format both

# Email report to team
mail -s "Weekly Event Analysis $DATE" team@company.com < weekly-reports/event-impact-$DATE.md
```

### Tip 3: Compare Versions

```bash
# Before changes
npm run analyze-events -- --form-url https://preview-old.../form --output ./before

# After changes
npm run analyze-events -- --form-url https://preview-new.../form --output ./after

# See what changed
diff ./before/event-impact-*.json ./after/event-impact-*.json
```

---

## 🆘 Troubleshooting

| Problem | Solution |
|---------|----------|
| `--form-url is required` | Add the URL: `npm run analyze-events -- --form-url https://...` |
| `Failed to extract form JSON` | Check URL is accessible and is a valid AEM form |
| `Cannot find module` | Run `npm install` in performance-bot directory |
| Report shows 0 events | Verify form has events in the authoring tool |

---

## 📚 Full Documentation

For detailed documentation, see: [docs/EVENT-IMPACT-CLI.md](docs/EVENT-IMPACT-CLI.md)

---

## 🤝 Need Help?

1. Check the [full documentation](docs/EVENT-IMPACT-CLI.md)
2. Review [example reports](examples/)
3. Open an issue on GitHub

---

**Ready to analyze your forms? Let's go!** 🚀

```bash
npm run analyze-events -- --form-url https://your-form.aem.live/form
```

