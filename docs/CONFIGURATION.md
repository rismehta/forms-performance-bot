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

For all available options, see `.performance-bot.example.json` or the comprehensive guide:
- **Full Options**: `.performance-bot.example.json`
- **Research & Details**: `docs/THRESHOLDS.md` (if you need it)

## How It Works

1. **No config file?** → Uses CWV-optimized defaults
2. **Have config file?** → Your values override defaults
3. **Missing values?** → Falls back to defaults

You can configure as little or as much as you want!

## Need Help?

**Too many issues reported?** → Increase thresholds in config  
**Want stricter checks?** → Decrease thresholds in config  
**Default is fine?** → Don't create a config file!

