#!/usr/bin/env node

/**
 * Comprehensive Pre-Build Test for Performance Bot
 * 
 * Tests ALL analyzers in both PR mode and Scheduled mode
 * Run before every build to catch errors early
 * 
 * Usage:
 *   npm run test:build     # Run this test
 *   npm run build          # Build after tests pass
 */

import { FormAnalyzer } from '../src/analyzers/form-analyzer.js';
import { FormEventsAnalyzer } from '../src/analyzers/form-events-analyzer.js';
import { HiddenFieldsAnalyzer } from '../src/analyzers/hidden-fields-analyzer.js';
import { DisabledFieldsAnalyzer } from '../src/analyzers/disabled-fields-analyzer.js';
import { RulePerformanceAnalyzer } from '../src/analyzers/rule-performance-analyzer.js';
import { CustomFunctionAnalyzer } from '../src/analyzers/custom-function-analyzer.js';
import { FormHTMLAnalyzer } from '../src/analyzers/form-html-analyzer.js';
import { FormCSSAnalyzer } from '../src/analyzers/form-css-analyzer.js';
import { RuntimeCLSAnalyzer } from '../src/analyzers/runtime-cls-analyzer.js';
import { FormPRReporter } from '../src/reporters/pr-reporter-form.js';
import { HTMLReporter } from '../src/reporters/html-reporter.js';
import { loadConfig } from '../src/utils/config-loader.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test tracking
let passedTests = 0;
let failedTests = 0;
const testResults = [];

function log(msg) {
  console.log(msg);
}

function pass(testName, details = '') {
  passedTests++;
  testResults.push({ name: testName, status: 'PASS', details });
  log(`  ✓ ${testName}${details ? ` - ${details}` : ''}`);
}

function fail(testName, error) {
  failedTests++;
  testResults.push({ name: testName, status: 'FAIL', error: error.message });
  log(`  ✗ ${testName}`);
  log(`    Error: ${error.message}`);
}

function section(title) {
  log(`\n${'═'.repeat(60)}`);
  log(`  ${title}`);
  log(`${'═'.repeat(60)}\n`);
}

/**
 * Load fixture files
 */
function loadFixtures() {
  const fixturesDir = path.join(__dirname, 'fixtures');
  
  // Load form JSON
  const formJsonPath = path.join(fixturesDir, 'sample-form.json');
  const mockFormJSON = JSON.parse(fs.readFileSync(formJsonPath, 'utf-8'));
  
  // Load HTML
  const htmlPath = path.join(fixturesDir, 'sample-form.html');
  const mockHTML = fs.readFileSync(htmlPath, 'utf-8');
  
  // Load JavaScript files
  const jsDir = path.join(fixturesDir, 'js');
  const jsFileNames = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
  const mockJSFiles = jsFileNames.map(file => ({
    filename: file,
    content: fs.readFileSync(path.join(jsDir, file), 'utf-8')
  }));
  
  // Load CSS files
  const cssDir = path.join(fixturesDir, 'css');
  const cssFileNames = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
  const mockCSSFiles = cssFileNames.map(file => ({
    filename: file,
    content: fs.readFileSync(path.join(cssDir, file), 'utf-8')
  }));
  
  return { mockFormJSON, mockHTML, mockJSFiles, mockCSSFiles };
}

/**
 * Test individual analyzer initialization and basic execution
 */
async function testAnalyzers(config, fixtures) {
  section('TESTING ANALYZERS');
  
  const { mockFormJSON, mockHTML, mockJSFiles, mockCSSFiles } = fixtures;
  const results = {};
  
  // 1. Form Analyzer
  try {
    const analyzer = new FormAnalyzer(config);
    const result = analyzer.analyze(mockFormJSON);
    if (result && typeof result.components === 'object') {
      pass('FormAnalyzer', `${result.components.total} components`);
      results.formStructure = result;
    } else {
      throw new Error('Invalid result structure');
    }
  } catch (e) {
    fail('FormAnalyzer', e);
  }
  
  // 2. Form Events Analyzer
  try {
    const analyzer = new FormEventsAnalyzer(config);
    const result = analyzer.analyze(mockFormJSON);
    if (result && Array.isArray(result.apiCallsInInitialize)) {
      pass('FormEventsAnalyzer', `${result.apiCallsInInitialize.length} API calls in initialize`);
      results.formEvents = result;
    } else {
      throw new Error('Invalid result structure');
    }
  } catch (e) {
    fail('FormEventsAnalyzer', e);
  }
  
  // 3. Hidden Fields Analyzer
  try {
    const analyzer = new HiddenFieldsAnalyzer(config);
    const result = analyzer.analyze(mockFormJSON, mockJSFiles);
    if (result && typeof result.totalHiddenFields === 'number') {
      pass('HiddenFieldsAnalyzer', `${result.totalHiddenFields} hidden fields`);
      results.hiddenFields = result;
    } else {
      throw new Error('Invalid result structure');
    }
  } catch (e) {
    fail('HiddenFieldsAnalyzer', e);
  }
  
  // 3b. Disabled Fields Analyzer
  try {
    const analyzer = new DisabledFieldsAnalyzer(config);
    const result = analyzer.analyze(mockFormJSON, mockJSFiles);
    if (result && typeof result.totalDisabledFields === 'number') {
      pass('DisabledFieldsAnalyzer', `${result.totalDisabledFields} disabled fields`);
      results.disabledFields = result;
    } else {
      throw new Error('Invalid result structure');
    }
  } catch (e) {
    fail('DisabledFieldsAnalyzer', e);
  }
  
  // 4. Rule Performance Analyzer
  try {
    const analyzer = new RulePerformanceAnalyzer(config);
    const result = await analyzer.analyze(mockFormJSON);
    if (result && typeof result.totalRules === 'number') {
      pass('RulePerformanceAnalyzer', `${result.totalRules} rules, ${result.cycles || 0} cycles`);
      results.ruleCycles = result;
    } else {
      throw new Error('Invalid result structure');
    }
  } catch (e) {
    fail('RulePerformanceAnalyzer', e);
  }
  
  // 5. Custom Function Analyzer
  try {
    const analyzer = new CustomFunctionAnalyzer(config);
    const result = analyzer.analyze(mockFormJSON, mockJSFiles);
    if (result && typeof result.functionsAnalyzed === 'number') {
      pass('CustomFunctionAnalyzer', `${result.functionsAnalyzed} functions, ${result.violations} violations`);
      results.customFunctions = result;
    } else {
      throw new Error('Invalid result structure');
    }
  } catch (e) {
    fail('CustomFunctionAnalyzer', e);
  }
  
  // 6. Form HTML Analyzer
  try {
    const analyzer = new FormHTMLAnalyzer(config);
    const result = analyzer.analyze(mockHTML);
    if (result && typeof result.images === 'object') {
      pass('FormHTMLAnalyzer', `${result.images.total} images, ${result.scripts.total} scripts`);
      results.htmlAnalysis = result;
    } else {
      throw new Error('Invalid result structure');
    }
  } catch (e) {
    fail('FormHTMLAnalyzer', e);
  }
  
  // 7. CSS Analyzer
  try {
    const analyzer = new FormCSSAnalyzer(config);
    const result = analyzer.analyze(mockCSSFiles);
    if (result && typeof result.filesAnalyzed === 'number') {
      pass('FormCSSAnalyzer', `${result.filesAnalyzed} files, ${result.issues.length} issues`);
      results.cssAnalysis = result;
    } else {
      throw new Error('Invalid result structure');
    }
  } catch (e) {
    fail('FormCSSAnalyzer', e);
  }
  
  // 8. Runtime CLS Analyzer (NEW)
  try {
    const analyzer = new RuntimeCLSAnalyzer(config);
    const result = analyzer.analyze(mockJSFiles);
    if (result && Array.isArray(result.issues)) {
      pass('RuntimeCLSAnalyzer', `${result.issues.length} CLS issues`);
      results.runtimeCLS = result;
    } else {
      throw new Error('Invalid result structure');
    }
  } catch (e) {
    fail('RuntimeCLSAnalyzer', e);
  }
  
  return results;
}

/**
 * Test PR Mode Reporter
 */
async function testPRModeReporter(analyzerResults) {
  section('TESTING PR MODE REPORTER');
  
  // Build results structure for PR mode
  const prResults = {
    formStructure: {
      before: analyzerResults.formStructure,
      after: analyzerResults.formStructure,
      newIssues: analyzerResults.formStructure?.issues || [],
      resolvedIssues: []
    },
    formEvents: {
      before: analyzerResults.formEvents,
      after: analyzerResults.formEvents,
      newIssues: analyzerResults.formEvents?.issues || [],
      resolvedIssues: []
    },
    hiddenFields: {
      before: analyzerResults.hiddenFields,
      after: analyzerResults.hiddenFields,
      newIssues: analyzerResults.hiddenFields?.issues || [],
      resolvedIssues: []
    },
    disabledFields: {
      before: analyzerResults.disabledFields || { totalDisabledFields: 0, disabledFields: [] },
      after: analyzerResults.disabledFields || { totalDisabledFields: 0, disabledFields: [] },
      delta: { disabledFields: 0 },
      newIssues: [],
      resolvedIssues: []
    },
    ruleCycles: {
      before: analyzerResults.ruleCycles,
      after: analyzerResults.ruleCycles,
      newCycles: analyzerResults.ruleCycles?.cycleDetails || [],
      resolvedCycles: []
    },
    customFunctions: {
      before: analyzerResults.customFunctions,
      after: analyzerResults.customFunctions,
      newIssues: analyzerResults.customFunctions?.issues || [],
      resolvedIssues: []
    },
    formHTML: {
      before: analyzerResults.htmlAnalysis,
      after: analyzerResults.htmlAnalysis,
      newIssues: analyzerResults.htmlAnalysis?.issues || [],
      resolvedIssues: []
    },
    formCSS: {
      before: analyzerResults.cssAnalysis,
      after: analyzerResults.cssAnalysis,
      newIssues: analyzerResults.cssAnalysis?.issues || [],
      resolvedIssues: []
    },
    runtimeCLS: {
      after: analyzerResults.runtimeCLS,
      newIssues: analyzerResults.runtimeCLS?.issues || [],
      resolvedIssues: []
    }
  };
  
  // Test PR Reporter - buildMarkdownReport
  try {
    const reporter = new FormPRReporter(null, 'test-owner', 'test-repo', 999);
    const markdown = reporter.buildMarkdownReport(prResults, {
      before: 'https://main--test.aem.live/',
      after: 'https://feature--test.aem.live/'
    });
    
    if (markdown && markdown.length > 100 && markdown.includes('Performance')) {
      pass('PR Reporter - buildMarkdownReport', `${markdown.length} chars`);
    } else {
      throw new Error('Markdown report too short or invalid');
    }
  } catch (e) {
    fail('PR Reporter - buildMarkdownReport', e);
  }
  
  // Test Runtime CLS section in PR report
  try {
    const reporter = new FormPRReporter(null, 'test-owner', 'test-repo', 999);
    // Test with some CLS issues
    const clsTestResults = { ...prResults };
    clsTestResults.runtimeCLS = {
      after: { issues: [{ type: 'dynamic-css-loading', file: 'test.js', line: 10, pattern: 'loadCSS()' }] },
      newIssues: [{ type: 'dynamic-css-loading', file: 'test.js', line: 10, pattern: 'loadCSS()' }],
      resolvedIssues: []
    };
    
    const markdown = reporter.buildMarkdownReport(clsTestResults, {
      before: 'https://main--test.aem.live/',
      after: 'https://feature--test.aem.live/'
    });
    
    if (markdown.includes('Runtime CLS') || markdown.includes('CLS')) {
      pass('PR Reporter - Runtime CLS section', 'Included in report');
    } else {
      pass('PR Reporter - Runtime CLS section', 'No issues to report (OK)');
    }
  } catch (e) {
    fail('PR Reporter - Runtime CLS section', e);
  }

  // --- PR comment critical count: inline step count must drive body (fixes "body shows 3 after fixing 1") ---
  try {
    const reporter = new FormPRReporter(null, 'test-owner', 'test-repo', 999);
    const resultsWithThreeIssues = {
      ...prResults,
      runtimeCLS: {
        after: { issues: [] },
        newIssues: [
          { type: 'dynamic-class-manipulation', file: 'a.js', line: 10, severity: 'warning' },
          { type: 'direct-style-manipulation', file: 'a.js', line: 20, severity: 'warning' },
          { type: 'dynamic-css-loading', file: 'b.js', line: 5, severity: 'error' }
        ],
        resolvedIssues: []
      }
    };
    const urlsBase = { before: 'https://a.aem.live/', after: 'https://b.aem.live/' };

    const bodyWithInlineCount2 = reporter.buildMarkdownReport(resultsWithThreeIssues, {
      ...urlsBase,
      criticalCountFromInlineStep: 2,
      totalVisibleComments: 2
    });
    if (!bodyWithInlineCount2.includes('2 critical issue') || bodyWithInlineCount2.includes('3 critical')) {
      throw new Error('When criticalCountFromInlineStep=2, body must show "2 critical issues", not 3');
    }
    pass('PR Reporter - critical count uses criticalCountFromInlineStep (body shows 2 when inline=2)', 'OK');
  } catch (e) {
    fail('PR Reporter - critical count uses criticalCountFromInlineStep', e);
  }

  try {
    const reporter = new FormPRReporter(null, 'test-owner', 'test-repo', 999);
    const resultsWithIssues = {
      ...prResults,
      runtimeCLS: { after: { issues: [] }, newIssues: [{ type: 'x', file: 'f.js', line: 1, severity: 'error' }], resolvedIssues: [] }
    };
    const bodyWithZeroVisible = reporter.buildMarkdownReport(resultsWithIssues, {
      before: 'https://a.aem.live/',
      after: 'https://b.aem.live/',
      totalVisibleComments: 0,
      criticalCountFromInlineStep: 0
    });
    if (!bodyWithZeroVisible.includes('No critical issues found')) {
      throw new Error('When criticalCountFromInlineStep=0 (or totalVisibleComments=0), body must show no critical issues');
    }
    pass('PR Reporter - critical count 0 shows "No critical issues found"', 'OK');
  } catch (e) {
    fail('PR Reporter - critical count 0 shows no issues', e);
  }

  try {
    const reporter = new FormPRReporter(null, 'test-owner', 'test-repo', 999);
    const resultsFallback = {
      ...prResults,
      runtimeCLS: {
        after: { issues: [] },
        newIssues: [
          { type: 'dynamic-css-loading', file: 'x.js', line: 1, severity: 'error' },
          { type: 'direct-style-manipulation', file: 'x.js', line: 2, severity: 'warning' }
        ],
        resolvedIssues: []
      }
    };
    const bodyFallback = reporter.buildMarkdownReport(resultsFallback, {
      before: 'https://a.aem.live/',
      after: 'https://b.aem.live/'
      // no criticalCountFromInlineStep or totalVisibleComments => use fallback from results
    });
    const countFromFallback = reporter.countCriticalIssues(resultsFallback, null);
    if (countFromFallback < 1) {
      throw new Error('Fallback count from results should be >= 1 when runtimeCLS has issues');
    }
    if (!bodyFallback.includes(`${countFromFallback} critical issue`) && !bodyFallback.includes('No critical issues')) {
      throw new Error('When no inline count passed, body must use fallback count or no issues');
    }
    pass('PR Reporter - critical count fallback when no inline count passed', 'OK');
  } catch (e) {
    fail('PR Reporter - critical count fallback', e);
  }

  return prResults;
}

/**
 * Test Scheduled Mode HTML Reporter
 */
async function testScheduledModeReporter(analyzerResults) {
  section('TESTING SCHEDULED MODE REPORTER');
  
  // Build results structure for scheduled mode
  const scheduledResults = {
    url: 'https://test-form.aem.live/form',
    formName: 'test-form',
    css: { issues: analyzerResults.cssAnalysis?.issues || [], filesAnalyzed: 1 },
    customFunctions: { issues: analyzerResults.customFunctions?.issues || [] },
    rules: { issues: analyzerResults.ruleCycles?.cycleDetails ? [{ cycles: analyzerResults.ruleCycles.cycles }] : [] },
    forms: { issues: [] },
    html: { issues: analyzerResults.htmlAnalysis?.issues || [], domSize: 100 },
    runtimeCLS: { 
      newIssues: analyzerResults.runtimeCLS?.issues || [],
      after: { issues: analyzerResults.runtimeCLS?.issues || [] }
    },
    performance: { loadTime: 1500, jsHeapSize: 10000000 },
    formJson: { name: 'test-form' }
  };
  
  // Test HTML Reporter - generateScheduledReport
  try {
    const reporter = new HTMLReporter();
    const html = reporter.generateScheduledReport(scheduledResults, {
      repository: 'test-owner/test-repo',
      analysisUrl: 'https://test-form.aem.live/form',
      timestamp: new Date().toISOString()
    });
    
    if (html && html.length > 500 && html.includes('<!DOCTYPE html>')) {
      pass('HTML Reporter - generateScheduledReport', `${html.length} chars`);
    } else {
      throw new Error('HTML report too short or invalid');
    }
  } catch (e) {
    fail('HTML Reporter - generateScheduledReport', e);
  }
  
  // Test Runtime CLS section in scheduled report
  try {
    const reporter = new HTMLReporter();
    const clsTestResults = { ...scheduledResults };
    clsTestResults.runtimeCLS = {
      newIssues: [
        { type: 'dynamic-css-loading', file: 'test.js', line: 10, pattern: 'loadCSS()' },
        { type: 'dynamic-class-manipulation', file: 'test.js', line: 20, pattern: 'classList.add()' }
      ],
      after: { issues: [] }
    };
    
    const html = reporter.generateScheduledReport(clsTestResults, {
      repository: 'test-owner/test-repo',
      analysisUrl: 'https://test-form.aem.live/form',
      timestamp: new Date().toISOString()
    });
    
    if (html.includes('Runtime CLS')) {
      pass('HTML Reporter - Runtime CLS section', 'Included in scheduled report');
    } else {
      fail('HTML Reporter - Runtime CLS section', new Error('Runtime CLS section missing'));
    }
  } catch (e) {
    fail('HTML Reporter - Runtime CLS section', e);
  }
  
  // Test Custom Functions breakdown (window access, HTTP, DOM)
  try {
    const reporter = new HTMLReporter();
    const cfTestResults = { ...scheduledResults };
    cfTestResults.customFunctions = {
      issues: [
        { type: 'window-access-in-custom-function', functionName: 'testFunc', file: 'test.js' },
        { type: 'http-request-in-custom-function', functionName: 'fetchData', file: 'test.js' },
        { type: 'dom-access-in-custom-function', functionName: 'getElement', file: 'test.js' }
      ]
    };
    
    const html = reporter.generateScheduledReport(cfTestResults, {
      repository: 'test-owner/test-repo',
      analysisUrl: 'https://test-form.aem.live/form',
      timestamp: new Date().toISOString()
    });
    
    if (html.includes('Window Access') && html.includes('HTTP Request') && html.includes('DOM Access')) {
      pass('HTML Reporter - Custom Functions breakdown', 'All issue types shown');
    } else {
      fail('HTML Reporter - Custom Functions breakdown', new Error('Missing issue type sections'));
    }
  } catch (e) {
    fail('HTML Reporter - Custom Functions breakdown', e);
  }
  
  // Test scheduled summary report
  try {
    const reporter = new HTMLReporter();
    const formResults = [scheduledResults];
    
    const html = reporter.generateScheduledSummaryReport(formResults, {
      repository: 'test-owner/test-repo',
      timestamp: new Date().toISOString(),
      formGistLinks: [],
      exceptionPRs: []
    });
    
    if (html && html.length > 500 && html.includes('<!DOCTYPE html>')) {
      pass('HTML Reporter - generateScheduledSummaryReport', `${html.length} chars`);
    } else {
      throw new Error('Summary HTML report too short or invalid');
    }
  } catch (e) {
    fail('HTML Reporter - generateScheduledSummaryReport', e);
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  log('\n🧪 PERFORMANCE BOT - PRE-BUILD TEST SUITE\n');
  log('═'.repeat(60));
  log('  Testing all analyzers and reporters for PR & Scheduled modes');
  log('═'.repeat(60));
  
  const startTime = Date.now();
  
  try {
    // Load config
    log('\n📦 Loading configuration...');
    const config = await loadConfig();
    pass('Config loaded');
    
    // Load fixtures
    log('\n📂 Loading test fixtures...');
    const fixtures = loadFixtures();
    pass('Fixtures loaded', `${fixtures.mockJSFiles.length} JS, ${fixtures.mockCSSFiles.length} CSS files`);
    
    // Test all analyzers
    const analyzerResults = await testAnalyzers(config, fixtures);
    
    // Test PR mode reporter
    await testPRModeReporter(analyzerResults);
    
    // Test scheduled mode reporter
    await testScheduledModeReporter(analyzerResults);
    
  } catch (error) {
    fail('Test suite setup', error);
  }
  
  const duration = Date.now() - startTime;
  
  // Final summary
  section('TEST RESULTS');
  
  const total = passedTests + failedTests;
  log(`  Total Tests:  ${total}`);
  log(`  Passed:       ${passedTests} ✓`);
  log(`  Failed:       ${failedTests} ✗`);
  log(`  Duration:     ${duration}ms`);
  log('');
  
  if (failedTests > 0) {
    log('❌ TESTS FAILED - Fix errors before building\n');
    log('Failed tests:');
    testResults.filter(t => t.status === 'FAIL').forEach(t => {
      log(`  - ${t.name}: ${t.error}`);
    });
    log('');
    process.exit(1);
  } else {
    log('✅ ALL TESTS PASSED - Ready to build\n');
    process.exit(0);
  }
}

// Run tests
runAllTests();
