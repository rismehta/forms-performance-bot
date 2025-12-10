import { URLAnalyzer } from '../src/analyzers/url-analyzer.js';
import { FormAnalyzer } from '../src/analyzers/form-analyzer.js';
import { FormEventsAnalyzer } from '../src/analyzers/form-events-analyzer.js';
import { HiddenFieldsAnalyzer } from '../src/analyzers/hidden-fields-analyzer.js';
import { RuleCycleAnalyzer } from '../src/analyzers/rule-cycle-analyzer.js';
import { FormHTMLAnalyzer } from '../src/analyzers/form-html-analyzer.js';
import { FormCSSAnalyzer } from '../src/analyzers/form-css-analyzer.js';
import { CustomFunctionAnalyzer } from '../src/analyzers/custom-function-analyzer.js';
import { FormPRReporter } from '../src/reporters/pr-reporter-form.js';
import { loadConfig } from '../src/utils/config-loader.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Test runner for Performance Bot
 * Simulates what would happen in a GitHub Action
 */
class TestRunner {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      errors: [],
    };
  }

  /**
   * Run complete analysis with live URLs
   */
  async runLiveURLTest(beforeUrl, afterUrl, options = {}) {
    console.log('🧪 Running Live URL Test\n');
    console.log(`Before URL: ${beforeUrl}`);
    console.log(`After URL: ${afterUrl}\n`);

    try {
      // Load configuration
      console.log(' Loading configuration...');
      const config = await loadConfig();
      console.log('');

      // Initialize analyzers with config
      const urlAnalyzer = new URLAnalyzer();
      const formAnalyzer = new FormAnalyzer(config);
      const formEventsAnalyzer = new FormEventsAnalyzer(config);
      const hiddenFieldsAnalyzer = new HiddenFieldsAnalyzer(config);
      const ruleCycleAnalyzer = new RuleCycleAnalyzer(config);
      const formHTMLAnalyzer = new FormHTMLAnalyzer(config);
      const formCSSAnalyzer = new FormCSSAnalyzer(config);
      const customFunctionAnalyzer = new CustomFunctionAnalyzer(config);

      // Step 1: Fetch URLs
      console.log('📥 Fetching before URL...');
      const beforeData = await urlAnalyzer.analyze(beforeUrl);
      console.log(` Before URL fetched (${(beforeData.rawSize / 1024).toFixed(2)} KB)`);

      console.log('📥 Fetching after URL...');
      const afterData = await urlAnalyzer.analyze(afterUrl);
      console.log(` After URL fetched (${(afterData.rawSize / 1024).toFixed(2)} KB)\n`);

      // Load mock JS/CSS files if provided
      const jsFiles = options.jsFiles || [];
      const cssFiles = options.cssFiles || [];

      console.log(`📂 Mock JS files: ${jsFiles.length}`);
      console.log(`📂 Mock CSS files: ${cssFiles.length}\n`);

      // Step 2: Run analyses IN PARALLEL
      console.log('🔍 Running all analyses in parallel...\n');
      
      const [
        formStructureAnalysis,
        formEventsAnalysis,
        { beforeHiddenFields, afterHiddenFields },
        { beforeRuleCycles, afterRuleCycles },
        formHTMLAnalysis,
        cssAnalysis,
        { beforeCustomFunctions, afterCustomFunctions }
      ] = await Promise.all([
        Promise.resolve(formAnalyzer.compare(beforeData.formJson, afterData.formJson)),
        Promise.resolve(formEventsAnalyzer.compare(beforeData.formJson, afterData.formJson)),
        Promise.resolve({
          beforeHiddenFields: hiddenFieldsAnalyzer.analyze(beforeData.formJson, jsFiles),
          afterHiddenFields: hiddenFieldsAnalyzer.analyze(afterData.formJson, jsFiles)
        }),
        Promise.all([
          ruleCycleAnalyzer.analyze(beforeData.formJson),
          ruleCycleAnalyzer.analyze(afterData.formJson)
        ]).then(([beforeRuleCycles, afterRuleCycles]) => ({ beforeRuleCycles, afterRuleCycles })),
        Promise.resolve(formHTMLAnalyzer.compare(beforeData.html, afterData.html)),
        Promise.resolve(formCSSAnalyzer.analyze(cssFiles)),
        Promise.resolve({
          beforeCustomFunctions: customFunctionAnalyzer.analyze(beforeData.formJson, jsFiles),
          afterCustomFunctions: customFunctionAnalyzer.analyze(afterData.formJson, jsFiles)
        })
      ]);

      // Compile comparison results
      const hiddenFieldsAnalysis = hiddenFieldsAnalyzer.compare(beforeHiddenFields, afterHiddenFields);
      const ruleCycleAnalysis = ruleCycleAnalyzer.compare(beforeRuleCycles, afterRuleCycles);
      const formCSSAnalysis = { after: cssAnalysis, newIssues: cssAnalysis.issues, resolvedIssues: [] };
      const customFunctionAnalysis = customFunctionAnalyzer.compare(beforeCustomFunctions, afterCustomFunctions);
      
      console.log(' All analyses completed\n');

      // Step 3: Compile results
      const results = {
        formStructure: formStructureAnalysis,
        formEvents: formEventsAnalysis,
        hiddenFields: hiddenFieldsAnalysis,
        ruleCycles: ruleCycleAnalysis,
        formHTML: formHTMLAnalysis,
        formCSS: formCSSAnalysis,
        customFunctions: customFunctionAnalysis,
      };

      // Step 4: Generate report
      console.log(' Generating PR Comment Report...\n');
      const reporter = new MockPRReporter();
      const report = reporter.generateReportSync(results, { before: beforeUrl, after: afterUrl });

      // Save report
      const outputPath = path.join(__dirname, 'output', 'pr-comment.md');
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, report);

      console.log('═══════════════════════════════════════════════════════════\n');
      console.log(' GENERATED PR COMMENT:\n');
      console.log('═══════════════════════════════════════════════════════════\n');
      console.log(report);
      console.log('\n═══════════════════════════════════════════════════════════\n');
      console.log(` Report saved to: ${outputPath}\n`);

      // Summary
      this.printSummary(results);

      return {
        success: true,
        results,
        report,
      };

    } catch (error) {
      console.error(' Test failed:', error.message);
      console.error(error.stack);
      this.results.failed++;
      this.results.errors.push(error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Print summary of findings
   */
  printSummary(results) {
    console.log(' ANALYSIS SUMMARY:\n');

    // Form Structure
    if (results.formStructure?.after) {
      console.log(' Form Structure:');
      console.log(`  - Components: ${results.formStructure.after.components.total}`);
      console.log(`  - Max Depth: ${results.formStructure.after.components.maxDepth}`);
      console.log(`  - Event Handlers: ${results.formStructure.after.events.total}`);
      console.log(`  - Issues: ${results.formStructure.after.issues.length}`);
      console.log('');
    }

    // Form Events
    if (results.formEvents?.after) {
      const apiCalls = results.formEvents.after.apiCallsInInitialize?.length || 0;
      console.log(' Form Events:');
      console.log(`  - API calls in initialize: ${apiCalls} ${apiCalls > 0 ? '' : ''}`);
      console.log('');
    }

    // Hidden Fields
    if (results.hiddenFields?.after) {
      console.log('👁️ Hidden Fields:');
      console.log(`  - Total hidden: ${results.hiddenFields.after.totalHiddenFields}`);
      console.log(`  - Unnecessary: ${results.hiddenFields.after.unnecessaryHiddenFields} ${results.hiddenFields.after.unnecessaryHiddenFields > 0 ? '' : ''}`);
      console.log('');
    }

    // Rule Cycles
    if (results.ruleCycles?.after) {
      const cycles = results.ruleCycles.after.cycles || 0;
      console.log('🔄 Rule Cycles:');
      console.log(`  - Circular dependencies: ${cycles} ${cycles > 0 ? '' : ''}`);
      if (cycles > 0 && results.ruleCycles.after.cycleDetails) {
        results.ruleCycles.after.cycleDetails.forEach((cycle, i) => {
          console.log(`    ${i + 1}. ${cycle.fields.join(' → ')}`);
        });
      }
      console.log('');
    }

    // Form HTML
    if (results.formHTML?.after) {
      console.log('🎨 Form HTML:');
      console.log(`  - Images: ${results.formHTML.after.images.total}`);
      console.log(`  - Non-lazy images: ${results.formHTML.after.images.nonLazyLoaded} ${results.formHTML.after.images.nonLazyLoaded > 0 ? '' : ''}`);
      console.log(`  - Blocking scripts: ${results.formHTML.after.scripts.blocking} ${results.formHTML.after.scripts.blocking > 0 ? '' : ''}`);
      console.log(`  - Issues: ${results.formHTML.after.issues.length}`);
      console.log('');
    }

    // Form CSS
    if (results.formCSS?.after) {
      console.log('🎨 Form CSS:');
      console.log(`  - Files analyzed: ${results.formCSS.after.filesAnalyzed}`);
      console.log(`  - Background images: ${results.formCSS.after.summary.backgroundImages} ${results.formCSS.after.summary.backgroundImages > 0 ? '' : ''}`);
      console.log(`  - Total issues: ${results.formCSS.after.issues.length}`);
      console.log('');
    }

    // Custom Functions
    if (results.customFunctions?.after) {
      const violations = results.customFunctions.after.violations || 0;
      console.log('⚙️ Custom Functions:');
      console.log(`  - Functions analyzed: ${results.customFunctions.after.functionsAnalyzed}`);
      console.log(`  - Violations: ${violations} ${violations > 0 ? '' : ''}`);
      console.log('');
    }
  }

  /**
   * Run test with sample data
   */
  async runSampleTest() {
    console.log('🧪 Running Sample Test with Mock Data\n');

    const sampleUrls = {
      before: 'https://main--forms-engine--hdfc-forms.aem.live/',
      after: 'https://branch--forms-engine--hdfc-forms.aem.live/',
    };

    const sampleJSFiles = this.loadSampleJSFiles();
    const sampleCSSFiles = this.loadSampleCSSFiles();

    return await this.runLiveURLTest(sampleUrls.before, sampleUrls.after, {
      jsFiles: sampleJSFiles,
      cssFiles: sampleCSSFiles,
    });
  }

  /**
   * Load sample JS files from test fixtures
   */
  loadSampleJSFiles() {
    const fixtures = path.join(__dirname, 'fixtures', 'js');
    if (!fs.existsSync(fixtures)) {
      return [];
    }

    const files = fs.readdirSync(fixtures).filter(f => f.endsWith('.js'));
    return files.map(file => ({
      filename: file,
      content: fs.readFileSync(path.join(fixtures, file), 'utf-8'),
    }));
  }

  /**
   * Load sample CSS files from test fixtures
   */
  loadSampleCSSFiles() {
    const fixtures = path.join(__dirname, 'fixtures', 'css');
    if (!fs.existsSync(fixtures)) {
      return [];
    }

    const files = fs.readdirSync(fixtures).filter(f => f.endsWith('.css'));
    return files.map(file => ({
      filename: file,
      content: fs.readFileSync(path.join(fixtures, file), 'utf-8'),
    }));
  }
}

/**
 * Mock PR Reporter that doesn't need GitHub API
 */
class MockPRReporter extends FormPRReporter {
  constructor() {
    super(null, 'test-owner', 'test-repo', 999);
  }

  generateReportSync(results, urls) {
    return this.buildMarkdownReport(results, urls);
  }

  async postComment(body) {
    // Don't actually post, just return
    return { success: true, comment: body };
  }
}

export { TestRunner };

