#!/usr/bin/env node

/**
 * Event Impact Analysis CLI
 * Standalone tool for analyzing event dependencies in AEM Forms
 * 
 * Usage:
 *   node src/cli/event-impact-cli.js --form-url https://your-form.aem.live/form
 *   npm run analyze-events -- --form-url https://your-form.aem.live/form
 */

import { URLAnalyzer } from '../analyzers/url-analyzer.js';
import { EventImpactAnalyzer } from '../analyzers/event-impact-analyzer.js';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    formUrl: null,
    outputDir: './event-impact-reports',
    format: 'markdown', // markdown, json, or both
    verbose: false,
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--form-url':
      case '-u':
        options.formUrl = args[++i];
        break;
      case '--output':
      case '-o':
        options.outputDir = args[++i];
        break;
      case '--format':
      case '-f':
        options.format = args[++i];
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        printHelp();
        process.exit(1);
    }
  }
  
  return options;
}

function printHelp() {
  console.log(`
📊 Event Impact Analysis CLI - AEM Forms Performance Bot

USAGE:
  node src/cli/event-impact-cli.js --form-url <URL> [options]
  npm run analyze-events -- --form-url <URL> [options]

OPTIONS:
  --form-url, -u <URL>     Form URL to analyze (required)
  --output, -o <DIR>       Output directory (default: ./event-impact-reports)
  --format, -f <FORMAT>    Output format: markdown, json, both (default: markdown)
  --verbose, -v            Verbose output
  --help, -h               Show this help

EXAMPLES:
  # Basic usage
  npm run analyze-events -- --form-url https://main--forms--adobe.aem.live/form
  
  # With custom output directory
  npm run analyze-events -- --form-url https://main--forms--adobe.aem.live/form --output ./reports
  
  # JSON format for programmatic consumption
  npm run analyze-events -- --form-url https://main--forms--adobe.aem.live/form --format json
  
  # Both markdown and JSON
  npm run analyze-events -- --form-url https://main--forms--adobe.aem.live/form --format both

PRE-DEPLOYMENT VALIDATION:
  Add this to your CI/CD pipeline:
  
  1. Run before deployment:
     npm run analyze-events -- --form-url https://preview--forms--adobe.aem.live/form
  
  2. Check for critical issues in the report
  
  3. Review changes with team before merging

OUTPUT:
  - Markdown report: Human-readable impact analysis
  - JSON report: Machine-readable for automation
  - Reports saved to: <output-dir>/event-impact-<timestamp>.{md,json}
`);
}

async function main() {
  console.log('📊 Event Impact Analysis CLI\n');
  
  const options = parseArgs();
  
  // Validate required options
  if (!options.formUrl) {
    console.error('❌ Error: --form-url is required\n');
    printHelp();
    process.exit(1);
  }
  
  console.log(`🔍 Analyzing form: ${options.formUrl}\n`);
  
  try {
    // Step 1: Fetch form JSON from URL
    console.log('⏳ Fetching form data...');
    const urlAnalyzer = new URLAnalyzer();
    const urlAnalysis = await urlAnalyzer.analyze(options.formUrl);
    
    if (!urlAnalysis.formJson) {
      throw new Error('Failed to extract form JSON from URL');
    }
    
    console.log(`✅ Form data fetched (${Object.keys(urlAnalysis.formJson).length} top-level keys)\n`);
    
    if (options.verbose) {
      console.log(`   Form ID: ${urlAnalysis.formJson.id || 'N/A'}`);
      console.log(`   Form Title: ${urlAnalysis.formJson.title || 'N/A'}`);
      console.log(`   HTML Size: ${urlAnalysis.html?.length || 0} bytes\n`);
    }
    
    // Step 2: Analyze event impacts
    console.log('⏳ Analyzing event dependencies...');
    const eventAnalyzer = new EventImpactAnalyzer();
    const analysis = eventAnalyzer.analyze(urlAnalysis.formJson);
    
    console.log(`✅ Analysis complete!\n`);
    
    // Print summary to console
    console.log('📈 Summary:');
    console.log(`   Total Events: ${analysis.totalEvents}`);
    console.log(`   Event Types: ${analysis.summary.totalEventTypes}`);
    console.log(`   Unique Fields Impacted: ${analysis.summary.totalUniqueFieldsImpacted}`);
    
    // Highlight duplicates (PRIMARY USE CASE)
    if (analysis.duplicates && analysis.duplicates.length > 0) {
      console.log(`\n🚨 DUPLICATES FOUND:`);
      console.log(`   ${analysis.duplicates.length} event(s) have multiple handlers`);
      analysis.duplicates.forEach(dup => {
        console.log(`     - ${dup.field} → ${dup.eventType} (${dup.count} handlers)`);
      });
    }
    
    // Show similar events
    if (analysis.similarEvents && analysis.similarEvents.length > 0) {
      console.log(`\n🔍 Similar Events: ${analysis.similarEvents.length} pair(s) detected`);
    }
    
    // Performance issues (secondary)
    if (analysis.performanceIssues.length > 0) {
      console.log(`\n⚠️  Performance Issues: ${analysis.performanceIssues.length}`);
      const critical = analysis.performanceIssues.filter(i => i.severity === 'critical').length;
      const warnings = analysis.performanceIssues.filter(i => i.severity === 'warning').length;
      if (critical > 0) console.log(`     - Critical: ${critical}`);
      if (warnings > 0) console.log(`     - Warnings: ${warnings}`);
    }
    
    console.log(`\n📊 Top Impacted Fields:`);
    analysis.summary.topImpactedFields.slice(0, 5).forEach((field, idx) => {
      console.log(`   ${idx + 1}. ${field.field} (${field.impactCount} events)`);
    });
    
    // Step 3: Generate reports
    console.log(`\n📝 Generating reports...`);
    
    // Create output directory
    mkdirSync(options.outputDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const baseFilename = `event-impact-${timestamp}`;
    
    let savedFiles = [];
    
    // Generate markdown report
    if (options.format === 'markdown' || options.format === 'both') {
      const markdown = eventAnalyzer.generateMarkdownReport(analysis);
      const mdPath = resolve(options.outputDir, `${baseFilename}.md`);
      writeFileSync(mdPath, markdown, 'utf8');
      savedFiles.push(mdPath);
      console.log(`   ✅ Markdown report: ${mdPath}`);
    }
    
    // Generate JSON report
    if (options.format === 'json' || options.format === 'both') {
      const json = eventAnalyzer.generateJSONReport(analysis);
      const jsonPath = resolve(options.outputDir, `${baseFilename}.json`);
      writeFileSync(jsonPath, json, 'utf8');
      savedFiles.push(jsonPath);
      console.log(`   ✅ JSON report: ${jsonPath}`);
    }
    
    // Success message
    console.log(`\n✨ Analysis complete!`);
    console.log(`\n📁 Reports saved to: ${options.outputDir}`);
    
    if (options.format === 'markdown' || options.format === 'both') {
      console.log(`\n💡 Open the markdown file to view the full impact analysis:`);
      console.log(`   ${savedFiles.find(f => f.endsWith('.md'))}`);
    }
    
    // Exit with error code if duplicates or critical issues found
    const hasDuplicates = analysis.duplicates && analysis.duplicates.length > 0;
    const criticalCount = analysis.performanceIssues.filter(i => i.severity === 'critical').length;
    
    if (hasDuplicates) {
      console.log(`\n🚨 WARNING: ${analysis.duplicates.length} duplicate event(s) detected`);
      console.log(`   Review and consolidate duplicate handlers before deploying`);
      process.exit(1);
    }
    
    if (criticalCount > 0) {
      console.log(`\n⚠️  Warning: ${criticalCount} critical performance issue(s) detected`);
      console.log(`   Review the report before deploying to production`);
      process.exit(1);
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

