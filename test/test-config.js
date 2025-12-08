#!/usr/bin/env node

import { loadConfig } from '../src/utils/config-loader.js';

console.log('🧪 Testing Configuration Loader\n');
console.log('═══════════════════════════════════════════════════════════\n');

try {
  // Load configuration
  console.log('Loading configuration...');
  console.log('Note: Missing config values will use CWV-optimized defaults\n');
  const config = await loadConfig();

  console.log('✅ Configuration loaded successfully!\n');

  // Display thresholds
  console.log('📊 Form Thresholds:');
  console.log('  - Max Components:', config.thresholds.form.maxComponents);
  console.log('  - Max Depth:', config.thresholds.form.maxDepth);
  console.log('  - Max Complexity:', config.thresholds.form.maxComplexity);
  console.log('  - Max Event Handlers:', config.thresholds.form.maxEventHandlers);
  console.log('  - Max Hidden Fields:', config.thresholds.form.maxHiddenFields);
  console.log('  - Max Rules Per Field:', config.thresholds.form.maxRulesPerField);
  console.log('  - Max Total Rules:', config.thresholds.form.maxTotalRules);
  console.log('  - Max Nested Panels:', config.thresholds.form.maxNestedPanels);

  console.log('\n📊 HTML Thresholds:');
  console.log('  - Max DOM Size:', config.thresholds.html.maxDOMSize);
  console.log('  - Max DOM Depth:', config.thresholds.html.maxDOMDepth);
  console.log('  - Max Inline Styles:', config.thresholds.html.maxInlineStyles);
  console.log('  - Max Hidden Elements:', config.thresholds.html.maxHiddenElements);
  console.log('  - Max Data Attribute Size:', config.thresholds.html.maxDataAttributeSize);
  console.log('  - Require Lazy Loading:', config.thresholds.html.requireLazyLoading);
  console.log('  - Require Image Dimensions:', config.thresholds.html.requireImageDimensions);

  console.log('\n📊 JavaScript Thresholds:');
  console.log('  - Max File Size:', config.thresholds.javascript.maxFileSize, 'bytes');
  console.log('  - Max Function Complexity:', config.thresholds.javascript.maxFunctionComplexity);
  console.log('  - Max Functions Per File:', config.thresholds.javascript.maxFunctionsPerFile);
  console.log('  - Max Lines Per Function:', config.thresholds.javascript.maxLinesPerFunction);
  console.log('  - Block APIs in Initialize:', config.thresholds.javascript.blockingAPIsInInitialize);

  console.log('\n📊 CSS Thresholds:');
  console.log('  - Max File Size:', config.thresholds.css.maxFileSize, 'bytes');
  console.log('  - Max Selectors Per File:', config.thresholds.css.maxSelectorsPerFile);
  console.log('  - Max Selector Depth:', config.thresholds.css.maxSelectorDepth);
  console.log('  - Max !important Usage:', config.thresholds.css.maxImportantUsage);
  console.log('  - Max Duplicate Selectors:', config.thresholds.css.maxDuplicateSelectors);
  console.log('  - Disallow @imports:', config.thresholds.css.disallowImports);
  console.log('  - Max Inline Data URI Size:', config.thresholds.css.maxInlineDataURISize);
  console.log('  - Prefer CSS Variables:', config.thresholds.css.preferCSSVariables);

  console.log('\n📊 Image Thresholds:');
  console.log('  - Require Lazy Loading:', config.thresholds.images.requireLazyLoading);
  console.log('  - Require Dimensions:', config.thresholds.images.requireDimensions);
  console.log('  - Max Inline Image Size:', config.thresholds.images.maxInlineImageSize);
  console.log('  - Prefer WebP:', config.thresholds.images.preferWebP);

  console.log('\n🎯 Core Web Vitals Targets:');
  console.log('  - Target LCP:', config.thresholds.performance.targetLCP, 'ms');
  console.log('  - Target INP:', config.thresholds.performance.targetINP, 'ms');
  console.log('  - Target CLS:', config.thresholds.performance.targetCLS);
  console.log('  - Target TBT:', config.thresholds.performance.targetTBT, 'ms');

  console.log('\n⚙️  Report Options:');
  console.log('  - Include Recommendations:', config.reportOptions.includeRecommendations);
  console.log('  - Verbose Mode:', config.reportOptions.verboseMode);
  console.log('  - Max Issues Displayed:', config.reportOptions.maxIssuesDisplayed);
  console.log('  - Show CWV Impact:', config.reportOptions.showCWVImpact);
  console.log('  - Group By Severity:', config.reportOptions.groupBySeverity);

  console.log('\n📁 Ignore Patterns:');
  config.ignorePatterns.forEach(pattern => {
    console.log('  -', pattern);
  });

  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('✅ Configuration test passed!\n');
  console.log('💡 These thresholds are based on Core Web Vitals research.');
  console.log('   See docs/THRESHOLDS.md for detailed explanations.\n');

} catch (error) {
  console.error('\n❌ Configuration test failed!');
  console.error('Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}

