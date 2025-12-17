# Configuration Guide

## Quick Start

The Performance Bot works out-of-the-box with **Core Web Vitals (CWV) optimized defaults**. You don't need a configuration file to get started.

## Common Customizations

Create `.performance-bot.json` in your project root to customize:

### Example 1: Basic Form Thresholds

```json
{
  "thresholds": {
    "form": {
      "maxComponents": 100,
      "maxDepth": 10
    }
  }
}
```

### Example 2: Larger Forms

```json
{
  "thresholds": {
    "form": {
      "maxComponents": 150,
      "maxComplexity": 300
    },
    "html": {
      "maxDOMSize": 1200
    }
  }
}
```

### Example 3: Strict Mode (Better Performance)

```json
{
  "thresholds": {
    "form": {
      "maxComponents": 50,
      "maxDepth": 6,
      "maxComplexity": 150
    },
    "html": {
      "maxDOMSize": 600
    }
  }
}
```

## Available Thresholds

### Form (Most Common)

| Threshold | Default | Description |
|-----------|---------|-------------|
| `maxComponents` | 75 | Maximum number of form components |
| `maxDepth` | 8 | Maximum nesting depth |
| `maxComplexity` | 200 | Overall form complexity score |

### HTML

| Threshold | Default | Description |
|-----------|---------|-------------|
| `maxDOMSize` | 800 | Maximum DOM nodes in form |

## CWV-Optimized Defaults

All defaults are based on research to achieve **"Good" Core Web Vitals**:

- **LCP (Largest Contentful Paint)**: < 2.5s
- **INP (Interaction to Next Paint)**: < 200ms  
- **CLS (Cumulative Layout Shift)**: < 0.1

You only need to customize if your forms have legitimate reasons for higher thresholds.

## Advanced Configuration

### Scheduled Scans (Multiple Forms)

Configure multiple form URLs for automated daily scans:

```json
{
  "scheduledScan": {
    "urls": [
      "https://main--your-project--your-org.aem.live/forms/form-1",
      "https://main--your-project--your-org.aem.live/forms/form-2",
      "https://main--your-project--your-org.aem.live/forms/form-3"
    ]
  }
}
```

**How it works:**
- Each form gets its own detailed Gist report
- Summary email shows aggregated stats across all forms with links to individual reports
- You can add additional URLs via `workflow_dispatch` input to supplement these
- **Required:** Form JSON only exists at runtime (not in repository), so URLs are needed for form-specific analysis

**Why scheduled scans:** Monitor production forms for performance issues daily without waiting for PRs. Catch issues early!

### Hero Image Detection

Control which images should NOT be lazy-loaded (for LCP optimization):

```json
{
  "heroImageDetection": {
    "enabled": true,
    "keywords": ["hero", "banner", "masthead", "jumbotron", "splash", "featured"],
    "treatFirstImageAsHero": true,
    "minimumHeroSize": { "width": 300, "height": 200 },
    "checkParentContainer": true
  }
}
```

**How it works:**
- Hero/banner images are detected and excluded from lazy-loading requirements
- All other images MUST have `loading="lazy"` (CRITICAL error if missing)
- Multi-factor detection: class/id keywords, first image heuristic, explicit `loading="eager"`, parent container

**Why:** Hero images should be eager-loaded for optimal LCP (Largest Contentful Paint). Lazy-loading the hero image delays your LCP metric!

### All Available Options

For complete configuration reference, see [`.performance-bot.example.json`](../.performance-bot.example.json) which includes:
- Form and HTML thresholds
- Hero image detection settings
- Analysis skip patterns
- Reporting verbosity controls
- Auto-fix configuration

## How It Works

1. **No config file?** → Uses CWV-optimized defaults
2. **Have config file?** → Your values override defaults
3. **Missing values?** → Falls back to defaults

You can configure as little or as much as you want!

## Need Help?

**Too many issues reported?** → Increase thresholds in config  
**Want stricter checks?** → Decrease thresholds in config  
**Default is fine?** → Don't create a config file!

