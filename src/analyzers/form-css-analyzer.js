/**
 * Analyzes CSS for form-specific performance and architectural issues
 * Focus: Issues that linters cannot detect (architectural, not syntax)
 */
export class FormCSSAnalyzer {
  constructor(config = null) {
    this.config = config;
  }

  /**
   * Analyze CSS files for form-specific issues
   * @param {Array} cssFiles - Array of {filename, content} objects
   * @returns {Object} Analysis results
   */
  analyze(cssFiles) {
    if (!cssFiles || cssFiles.length === 0) {
      return { 
        filesAnalyzed: 0,
        issues: [],
        summary: {},
      };
    }

    const allIssues = [];
    const summary = {
      totalFiles: cssFiles.length,
      backgroundImages: 0,
      importantRules: 0,
      inlineDataURIs: 0,
      deepSelectors: 0,
      duplicateSelectors: 0,
    };

    cssFiles.forEach(file => {
      const fileIssues = this.analyzeFile(file.filename, file.content);
      allIssues.push(...fileIssues);

      // Update summary
      fileIssues.forEach(issue => {
        if (issue.type === 'css-background-image') summary.backgroundImages++;
        if (issue.type === 'excessive-important') summary.importantRules += issue.count || 0;
        if (issue.type === 'inline-data-uri') summary.inlineDataURIs++;
        if (issue.type === 'deep-selector') summary.deepSelectors++;
        if (issue.type === 'duplicate-selector') summary.duplicateSelectors++;
      });
    });

    return {
      filesAnalyzed: cssFiles.length,
      issues: allIssues,
      summary,
    };
  }

  /**
   * Analyze a single CSS file
   */
  analyzeFile(filename, content) {
    const issues = [];

    // Check for background-image usage (should use Image component)
    issues.push(...this.detectBackgroundImages(filename, content));

    // Check for inline data URIs (bloat CSS)
    issues.push(...this.detectInlineDataURIs(filename, content));

    // Check for excessive !important usage
    issues.push(...this.detectExcessiveImportant(filename, content));

    // Check for overly specific selectors (performance)
    issues.push(...this.detectDeepSelectors(filename, content));

    // Check for duplicate selectors (maintainability)
    issues.push(...this.detectDuplicateSelectors(filename, content));

    // Check for render-blocking CSS patterns
    issues.push(...this.detectRenderBlockingPatterns(filename, content));

    // Check for missing CSS custom properties for theming
    issues.push(...this.detectHardcodedColors(filename, content));

    // Check for large CSS files
    issues.push(...this.detectLargeFiles(filename, content));

    return issues;
  }

  /**
   * Detect CSS background-image usage
   * Issue: Should use Image component for lazy loading and optimization
   */
  detectBackgroundImages(filename, content) {
    const issues = [];
    const backgroundImagePattern = /background(-image)?:\s*url\(['"]?([^'"()]+)['"]?\)/gi;
    
    let match;
    while ((match = backgroundImagePattern.exec(content)) !== null) {
      const imageUrl = match[2];
      
      // Skip data URIs (handled separately)
      if (imageUrl.startsWith('data:')) continue;
      
      // Skip SVG patterns/gradients
      if (imageUrl.includes('.svg') && content.includes('background-repeat')) continue;
      
      const lineNumber = this.getLineNumber(content, match.index);
      
      // Extract the CSS selector that contains this background-image
      const selector = this.extractSelectorAtPosition(content, match.index);

      issues.push({
        severity: 'error',
        type: 'css-background-image',
        file: filename,
        line: lineNumber,
        message: `CSS background-image detected: "${imageUrl}". Must use Image component instead.`,
        imageUrl,
        selector,  // Add selector for AI fix to extract dimensions
        recommendation: 'Replace with <Image> component for better lazy loading, responsive images, and automatic optimization. Background images cannot be lazy loaded and block form rendering.',
      });
    }

    return issues;
  }
  
  /**
   * Extract CSS selector at a given position in the content
   * Works backwards from position to find the selector before the opening {
   */
  extractSelectorAtPosition(content, position) {
    // Find the opening brace before this position
    let bracePos = content.lastIndexOf('{', position);
    if (bracePos === -1) return null;
    
    // Find the closing brace of the previous rule (or start of file)
    let prevCloseBrace = content.lastIndexOf('}', bracePos);
    let startPos = prevCloseBrace === -1 ? 0 : prevCloseBrace + 1;
    
    // Extract the selector (text between previous } and current {)
    const selectorText = content.substring(startPos, bracePos).trim();
    
    // Clean up: remove comments, newlines, etc.
    const cleanSelector = selectorText
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
      .replace(/\s+/g, ' ')              // Normalize whitespace
      .trim();
    
    return cleanSelector || null;
  }

  /**
   * Detect inline data URIs in CSS
   * Issue: Bloats CSS file size and blocks rendering
   */
  detectInlineDataURIs(filename, content) {
    const issues = [];
    const dataUriPattern = /url\(['"]?(data:[^'"()]+)['"]?\)/gi;
    
    let match;
    while ((match = dataUriPattern.exec(content)) !== null) {
      const dataUri = match[1];
      const size = dataUri.length;
      
      // Only flag large data URIs (>5KB)
      if (size > 5000) {
        const lineNumber = this.getLineNumber(content, match.index);

        issues.push({
          severity: 'warning',
          type: 'inline-data-uri',
          file: filename,
          line: lineNumber,
          message: `Large inline data URI (${(size / 1024).toFixed(2)} KB) bloats CSS file.`,
          size,
          recommendation: 'Extract to separate image file for better caching and lazy loading. Inline data URIs block CSS parsing and form rendering.',
        });
      }
    }

    return issues;
  }

  /**
   * Detect excessive !important usage
   * Issue: Makes CSS hard to maintain and override
   */
  detectExcessiveImportant(filename, content) {
    const issues = [];
    const importantPattern = /!important/gi;
    const matches = content.match(importantPattern);
    
    if (matches && matches.length > 10) {
      issues.push({
        severity: 'info',
        type: 'excessive-important',
        file: filename,
        message: `Excessive !important usage (${matches.length} times). This indicates specificity issues.`,
        count: matches.length,
        recommendation: 'Refactor CSS to reduce !important usage. Use proper specificity and BEM naming. Excessive !important makes forms hard to customize and theme.',
      });
    }

    return issues;
  }

  /**
   * Detect overly specific selectors
   * Issue: Slow selector matching, hard to maintain
   */
  detectDeepSelectors(filename, content) {
    const issues = [];
    
    // Match selectors (simplified - captures most cases)
    const selectorPattern = /([^{]+)\{/g;
    
    let match;
    while ((match = selectorPattern.exec(content)) !== null) {
      const selector = match[1].trim();
      
      // Skip @-rules
      if (selector.startsWith('@')) continue;
      
      // Count selector depth (number of spaces/combinators)
      const depth = (selector.match(/[\s>+~]/g) || []).length;
      
      // Flag selectors deeper than 4 levels
      if (depth > 4) {
        const lineNumber = this.getLineNumber(content, match.index);

        issues.push({
          severity: 'info',
          type: 'deep-selector',
          file: filename,
          line: lineNumber,
          message: `Overly specific selector (depth: ${depth}): "${selector.substring(0, 80)}..."`,
          selector: selector,
          depth,
          recommendation: 'Use BEM or utility classes to reduce selector depth. Deep selectors slow down CSS matching in forms with many elements.',
        });
      }
    }

    return issues;
  }

  /**
   * Detect duplicate selectors
   * Issue: Maintainability and file size
   */
  detectDuplicateSelectors(filename, content) {
    const issues = [];
    const selectorMap = new Map();
    const selectorPattern = /([^{]+)\{/g;
    
    let match;
    while ((match = selectorPattern.exec(content)) !== null) {
      const selector = match[1].trim();
      
      if (selector.startsWith('@')) continue;
      
      if (selectorMap.has(selector)) {
        selectorMap.get(selector).count++;
        selectorMap.get(selector).positions.push(match.index);
      } else {
        selectorMap.set(selector, { count: 1, positions: [match.index] });
      }
    }

    // Find duplicates
    selectorMap.forEach((data, selector) => {
      if (data.count > 2) {
        const lineNumber = this.getLineNumber(content, data.positions[0]);

        issues.push({
          severity: 'info',
          type: 'duplicate-selector',
          file: filename,
          line: lineNumber,
          message: `Selector "${selector.substring(0, 60)}..." appears ${data.count} times.`,
          selector,
          count: data.count,
          recommendation: 'Consolidate duplicate selectors to reduce CSS size and improve maintainability.',
        });
      }
    });

    return issues;
  }

  /**
   * Detect render-blocking CSS patterns
   * Issue: Delays form interactivity
   */
  detectRenderBlockingPatterns(filename, content) {
    const issues = [];

    // Check for @import (blocks rendering)
    const importPattern = /@import\s+(?:url\()?['"]([^'"]+)['"](?:\))?/gi;
    let match;
    
    while ((match = importPattern.exec(content)) !== null) {
      const importUrl = match[1];
      const lineNumber = this.getLineNumber(content, match.index);

      issues.push({
        severity: 'error',
        type: 'css-import-blocking',
        file: filename,
        line: lineNumber,
        message: `@import blocks rendering: "${importUrl}"`,
        importUrl,
        recommendation: 'Replace @import with <link> tags or bundle CSS files. @import forces sequential loading and delays form rendering.',
      });
    }

    // Check for large font files inline
    const fontFacePattern = /@font-face\s*\{[^}]+url\(['"]?(data:[^'"()]+)['"]?\)/gi;
    while ((match = fontFacePattern.exec(content)) !== null) {
      const dataUri = match[1];
      if (dataUri.length > 10000) {
        const lineNumber = this.getLineNumber(content, match.index);

        issues.push({
          severity: 'warning',
          type: 'inline-font-blocking',
          file: filename,
          line: lineNumber,
          message: `Large inline font (${(dataUri.length / 1024).toFixed(2)} KB) blocks CSS parsing.`,
          size: dataUri.length,
          recommendation: 'Use external font files with font-display: swap. Inline fonts block form rendering.',
        });
      }
    }

    return issues;
  }

  /**
   * Detect hardcoded colors (should use CSS variables for theming)
   * Issue: Forms cannot be easily themed/customized
   */
  detectHardcodedColors(filename, content) {
    const issues = [];
    
    // Count color declarations
    const hexColorPattern = /#[0-9a-fA-F]{3,6}/g;
    const rgbColorPattern = /rgba?\([^)]+\)/g;
    const hslColorPattern = /hsla?\([^)]+\)/g;
    
    const hexColors = (content.match(hexColorPattern) || []).length;
    const rgbColors = (content.match(rgbColorPattern) || []).length;
    const hslColors = (content.match(hslColorPattern) || []).length;
    const totalColors = hexColors + rgbColors + hslColors;

    // Check if using CSS custom properties
    const cssVarPattern = /var\(--[^)]+\)/g;
    const cssVars = (content.match(cssVarPattern) || []).length;

    // If lots of hardcoded colors but few CSS variables, flag it
    if (totalColors > 20 && cssVars < totalColors * 0.3) {
      issues.push({
        severity: 'info',
        type: 'hardcoded-colors',
        file: filename,
        message: `${totalColors} hardcoded color values with only ${cssVars} CSS variables. Forms should use design tokens.`,
        totalColors,
        cssVars,
        recommendation: 'Use CSS custom properties (--color-primary, --color-text, etc.) for better theming and consistency across forms. Hardcoded colors make forms hard to customize.',
      });
    }

    return issues;
  }

  /**
   * Detect large CSS files
   * Issue: Slow to parse, blocks rendering
   */
  detectLargeFiles(filename, content) {
    const issues = [];
    const size = content.length;

    // Flag files over 100KB
    if (size > 100000) {
      issues.push({
        severity: 'warning',
        type: 'large-css-file',
        file: filename,
        message: `Large CSS file (${(size / 1024).toFixed(2)} KB). Consider code splitting.`,
        size,
        recommendation: 'Split into critical and non-critical CSS. Load critical CSS inline and defer non-critical styles. Large CSS files delay form rendering.',
      });
    }

    return issues;
  }

  /**
   * Get line number from content and index
   */
  getLineNumber(content, index) {
    return content.substring(0, index).split('\n').length;
  }

  /**
   * Compare before and after analyses
   */
  compare(beforeData, afterData) {
    return {
      before: beforeData,
      after: afterData,
      delta: {
        backgroundImages: afterData.summary.backgroundImages - beforeData.summary.backgroundImages,
        importantRules: afterData.summary.importantRules - beforeData.summary.importantRules,
        inlineDataURIs: afterData.summary.inlineDataURIs - beforeData.summary.inlineDataURIs,
      },
      newIssues: afterData.issues.filter(afterIssue =>
        !beforeData.issues.some(beforeIssue =>
          beforeIssue.file === afterIssue.file &&
          beforeIssue.type === afterIssue.type &&
          beforeIssue.line === afterIssue.line
        )
      ),
      resolvedIssues: beforeData.issues.filter(beforeIssue =>
        !afterData.issues.some(afterIssue =>
          afterIssue.file === beforeIssue.file &&
          afterIssue.type === beforeIssue.type &&
          afterIssue.line === beforeIssue.line
        )
      ),
    };
  }
}

