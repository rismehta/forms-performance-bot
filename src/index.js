import * as core from '@actions/core';
import * as github from '@actions/github';
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { URLAnalyzer } from './analyzers/url-analyzer.js';
import { FormAnalyzer } from './analyzers/form-analyzer.js';
import { FormEventsAnalyzer } from './analyzers/form-events-analyzer.js';
import { HiddenFieldsAnalyzer } from './analyzers/hidden-fields-analyzer.js';
import { RulePerformanceAnalyzer } from './analyzers/rule-performance-analyzer.js';
import { FormHTMLAnalyzer } from './analyzers/form-html-analyzer.js';
import { FormCSSAnalyzer } from './analyzers/form-css-analyzer.js';
import { CustomFunctionAnalyzer } from './analyzers/custom-function-analyzer.js';
import { AIAutoFixAnalyzer } from './analyzers/ai-autofix-analyzer.js';
import { FormPRReporter } from './reporters/pr-reporter-form.js';
import { HTMLReporter } from './reporters/html-reporter.js';
import { extractURLsFromPR, getPRDiffFiles, filterResultsToPRFiles } from './utils/github-helper.js';
import { loadConfig } from './utils/config-loader.js';

/**
 * Get tokens for different operations
 * - GITHUB_TOKEN (default): For Checks API, PR comments, and reading files
 * - PAT_TOKEN (optional): Only needed for PR creation and Gist creation
 */
function getTokens() {
  const defaultToken = core.getInput('github-token', { required: true });
  const patToken = process.env.PAT_TOKEN || defaultToken;
  
  return {
  // Use default GITHUB_TOKEN for most operations (has checks:write permission)
  defaultToken,
  // Use PAT only for PR creation (GITHUB_TOKEN can't trigger workflows) and Gist (needs gist scope)
  patToken
  };
}

/**
 * Main entry point for the performance bot
 */
async function run() {
  try {
  core.info(' Starting Performance Bot analysis...');

  // Load configuration
  core.info(' Loading configuration...');
  const config = await loadConfig();

  // Get GitHub context
  const context = github.context;
  const tokens = getTokens();
  
  // Use default GITHUB_TOKEN for Checks API and PR comments
  // This token has checks:write permission from workflow
  const octokit = github.getOctokit(tokens.defaultToken);
  
  // Use PAT only for operations that need it (PR creation, Gist)
  const patOctokit = tokens.patToken !== tokens.defaultToken 
    ? github.getOctokit(tokens.patToken) 
    : octokit;

  // MODE DETECTION: PR mode vs Scheduled mode
  const isPRMode = !!context.payload.pull_request;
  const isScheduledMode = context.eventName === 'schedule' || context.eventName === 'workflow_dispatch';
  
  if (isPRMode) {
    core.info('🔍 MODE: PR Analysis (analyzing PR diff files only)');
    await runPRMode(context, octokit, patOctokit, config);
  } else if (isScheduledMode) {
    core.info('📊 MODE: Scheduled Codebase Scan (analyzing entire repository)');
    await runScheduledMode(context, octokit, patOctokit, config);
  } else {
    core.warning('Unknown event type - expected PR, schedule, or workflow_dispatch');
    return;
  }

  } catch (error) {
  core.setFailed(`Performance Bot failed: ${error.message}`);
  core.error(error.stack);
  }
}

/**
 * Run PR analysis mode (analyze only PR diff files)
 */
async function runPRMode(context, octokit, patOctokit, config) {
  const prNumber = context.payload.pull_request.number;
  const prBranch = context.payload.pull_request.head.ref;
  const { owner, repo } = context.repo;

  core.info(`Analyzing PR #${prNumber} in ${owner}/${repo}`);

  // Extract before/after URLs from PR description (optional)
  const prBody = context.payload.pull_request.body || '';
  core.info(`PR Body length: ${prBody.length} characters`);
  core.info(`PR Body preview (first 500 chars):\n${prBody.substring(0, 500)}`);
  
  const urls = extractURLsFromPR(prBody);

  const hasUrls = !!(urls.before && urls.after);
  
  if (!hasUrls) {
    core.warning('⚠️  No Before/After URLs found in PR description.');
    core.warning('URL-based analysis (form JSON, HTML, rules) will be skipped.');
    core.warning('Only JS/CSS code analysis will be performed.');
    core.warning('');
    core.warning('To enable full form analysis, add URLs to PR description:');
    core.warning('  Test URLs:');
    core.warning('  Before: https://example.com/before');
    core.warning('  After: https://example.com/after');
    core.warning('');
  } else {
    core.info(`✓ Before URL: ${urls.before}`);
    core.info(`✓ After URL: ${urls.after}`);
  }

  // Initialize analyzers with config
  const formCSSAnalyzer = new FormCSSAnalyzer(config);
  const customFunctionAnalyzer = new CustomFunctionAnalyzer(config);
  const aiAutoFixAnalyzer = new AIAutoFixAnalyzer(config);

  // URL-based analysis (only if URLs provided)
  let beforeData = null;
  let afterData = null;
  
  if (hasUrls) {
    const urlAnalyzer = new URLAnalyzer();
    
    // Analyze both URLs
    core.info('Fetching and analyzing before URL...');
    beforeData = await urlAnalyzer.analyze(urls.before);
    core.info(`✓ Fetched before URL: ${beforeData.rawSize} bytes HTML`);
    
    // Validate that form JSON was extracted from before URL
    if (!beforeData.formJson) {
      const errorMsg = beforeData.jsonErrors && beforeData.jsonErrors.length > 0
        ? `Failed to extract form JSON from before URL: ${beforeData.jsonErrors[0].message}`
        : 'Failed to extract form JSON from before URL. No form JSON found in the page.';
      core.error(errorMsg);
      core.setFailed(errorMsg);
      return;
    }
    const beforeJsonStr = JSON.stringify(beforeData.formJson);
    const beforeFormId = beforeData.formJson.id || 'unknown';
    const beforeFormTitle = beforeData.formJson.title || 'unknown';
    core.info(`Form JSON extracted from before URL (${beforeJsonStr.length} bytes)`);
    core.info(`Before form: id="${beforeFormId}", title="${beforeFormTitle}"`);

    core.info('Fetching and analyzing after URL...');
    afterData = await urlAnalyzer.analyze(urls.after);
    core.info(`✓ Fetched after URL: ${afterData.rawSize} bytes HTML`);
    
    // Validate that form JSON was extracted from after URL
    if (!afterData.formJson) {
      const errorMsg = afterData.jsonErrors && afterData.jsonErrors.length > 0
        ? `Failed to extract form JSON from after URL: ${afterData.jsonErrors[0].message}`
        : 'Failed to extract form JSON from after URL. No form JSON found in the page.';
      core.error(errorMsg);
      core.setFailed(errorMsg);
      return;
    }
    const afterJsonStr = JSON.stringify(afterData.formJson);
    const afterFormId = afterData.formJson.id || 'unknown';
    const afterFormTitle = afterData.formJson.title || 'unknown';
    core.info(`Form JSON extracted from after URL (${afterJsonStr.length} bytes)`);
    core.info(`After form: id="${afterFormId}", title="${afterFormTitle}"`);
    
    // Warn if both JSONs appear identical
    if (beforeJsonStr === afterJsonStr) {
      core.warning('WARNING: Before and After form JSONs are identical! This may indicate:');
      core.warning('  1. The URLs are pointing to the same content (caching issue?)');
      core.warning('  2. The PR branch has not been deployed yet');
      core.warning('  3. The form has not changed between branches');
      core.warning('Analysis will continue but results may not show differences.');
    }
  } else {
    // No URLs provided - create empty data objects
    core.info('Skipping URL-based analysis (no URLs provided)');
    beforeData = { formJson: null, html: null };
    afterData = { formJson: null, html: null };
  }

  // Load JavaScript and CSS files from checked-out repository (faster than API)
  core.info('Loading JavaScript and CSS files from checked-out repository...');
  const { jsFiles, cssFiles } = await loadFilesFromWorkspace();

  // Perform analyses based on available data
  let formStructureAnalysis, formEventsAnalysis, beforeHiddenFields, afterHiddenFields;
  let beforeRuleCycles, afterRuleCycles, formHTMLAnalysis, cssAnalysis;
  let beforeCustomFunctions, afterCustomFunctions;
  
  if (hasUrls) {
    // Full analysis with form JSON
    core.info('Running all analyses in parallel (form JSON available)...');
    
    // Initialize form-specific analyzers
    const formAnalyzer = new FormAnalyzer(config);
    const formEventsAnalyzer = new FormEventsAnalyzer(config);
    const hiddenFieldsAnalyzer = new HiddenFieldsAnalyzer(config);
    const rulePerformanceAnalyzer = new RulePerformanceAnalyzer(config);
    const formHTMLAnalyzer = new FormHTMLAnalyzer(config);
    
    const [
      fsa,
      fea,
      { beforeHiddenFields: bhf, afterHiddenFields: ahf },
      { beforeRuleCycles: brc, afterRuleCycles: arc },
      fha,
      css,
      { beforeCustomFunctions: bcf, afterCustomFunctions: acf }
    ] = await Promise.all([
      // 1. Form Structure (synchronous)
      Promise.resolve(formAnalyzer.compare(beforeData.formJson, afterData.formJson)),
      
      // 2. Form Events (synchronous)
      Promise.resolve(formEventsAnalyzer.compare(beforeData.formJson, afterData.formJson)),
      
      // 3. Hidden Fields (synchronous)
      Promise.resolve({
        beforeHiddenFields: hiddenFieldsAnalyzer.analyze(beforeData.formJson, jsFiles),
        afterHiddenFields: hiddenFieldsAnalyzer.analyze(afterData.formJson, jsFiles)
      }),
      
      // 4. Rule Cycles (async - uses real function implementations from checked-out repo)
      (async () => {
        try {
          core.info('Starting rule cycle analysis...');
          const beforeRuleCycles = await rulePerformanceAnalyzer.analyze(beforeData.formJson);
          core.info(`Before rules: ${beforeRuleCycles.totalRules || 0} rules, ${beforeRuleCycles.cycles || 0} cycles, ${beforeRuleCycles.slowRuleCount || 0} slow`);
          if (beforeRuleCycles.cycles > 0) {
            core.warning(`  Found ${beforeRuleCycles.cycles} cycle(s) in BEFORE state`);
          }
          
          const afterRuleCycles = await rulePerformanceAnalyzer.analyze(afterData.formJson);
          core.info(`After rules: ${afterRuleCycles.totalRules || 0} rules, ${afterRuleCycles.cycles || 0} cycles, ${afterRuleCycles.slowRuleCount || 0} slow`);
          if (afterRuleCycles.cycles > 0) {
            core.warning(`  Found ${afterRuleCycles.cycles} cycle(s) in AFTER state`);
            if (afterRuleCycles.cycleDetails) {
              afterRuleCycles.cycleDetails.forEach((cycle, i) => {
                core.warning(`    Cycle ${i + 1}: ${(cycle.fields || []).join(' → ')}`);
              });
            }
          }
          
          return { beforeRuleCycles, afterRuleCycles };
        } catch (error) {
          core.error(`Rule cycle analysis failed: ${error.message}`);
          core.error(error.stack);
          return {
            beforeRuleCycles: { totalRules: 0, cycles: 0, error: error.message },
            afterRuleCycles: { totalRules: 0, cycles: 0, error: error.message }
          };
        }
      })(),
      
      // 5. Form HTML (synchronous)
      Promise.resolve(formHTMLAnalyzer.compare(beforeData.html, afterData.html)),
      
      // 6. CSS (synchronous)
      Promise.resolve(formCSSAnalyzer.analyze(cssFiles)),
      
      // 7. Custom Functions (synchronous)
      Promise.resolve({
        beforeCustomFunctions: customFunctionAnalyzer.analyze(beforeData.formJson, jsFiles),
        afterCustomFunctions: customFunctionAnalyzer.analyze(afterData.formJson, jsFiles)
      })
    ]);
    
    formStructureAnalysis = fsa;
    formEventsAnalysis = fea;
    beforeHiddenFields = bhf;
    afterHiddenFields = ahf;
    beforeRuleCycles = brc;
    afterRuleCycles = arc;
    formHTMLAnalysis = fha;
    cssAnalysis = css;
    beforeCustomFunctions = bcf;
    afterCustomFunctions = acf;
    
  } else {
    // Limited analysis without URLs - only CSS and JS files
    core.info('Running limited analysis (CSS/JS only, no form JSON)...');
    
    const [css, { beforeCustomFunctions: bcf, afterCustomFunctions: acf }] = await Promise.all([
      // CSS analysis
      Promise.resolve(formCSSAnalyzer.analyze(cssFiles)),
      
      // Custom Functions (without form JSON context)
      Promise.resolve({
        beforeCustomFunctions: customFunctionAnalyzer.analyze(null, jsFiles),
        afterCustomFunctions: customFunctionAnalyzer.analyze(null, jsFiles)
      })
    ]);
    
    // Set empty results for form-specific analyzers
    formStructureAnalysis = { after: { components: { total: 0 } }, before: { components: { total: 0 } } };
    formEventsAnalysis = { after: { apiCallsInInitialize: [] }, newIssues: [], resolvedIssues: [] };
    beforeHiddenFields = { unnecessaryHiddenFields: 0, fields: [] };
    afterHiddenFields = { unnecessaryHiddenFields: 0, fields: [] };
    beforeRuleCycles = { totalRules: 0, cycles: 0, slowRuleCount: 0, runtimeErrors: [] };
    afterRuleCycles = { totalRules: 0, cycles: 0, slowRuleCount: 0, runtimeErrors: [] };
    formHTMLAnalysis = { after: { issues: [] }, newIssues: [], resolvedIssues: [] };
    cssAnalysis = css;
    beforeCustomFunctions = bcf;
    afterCustomFunctions = acf;
  }

  // Compile comparison results
  const hiddenFieldsAnalysis = hasUrls 
    ? (new (require('./analyzers/hidden-fields-analyzer.js').HiddenFieldsAnalyzer)(config)).compare(beforeHiddenFields, afterHiddenFields)
    : { after: afterHiddenFields, before: beforeHiddenFields, newIssues: [], resolvedIssues: [] };
    
  const ruleCycleAnalysis = hasUrls
    ? (new (require('./analyzers/rule-performance-analyzer.js').RulePerformanceAnalyzer)(config)).compare(beforeRuleCycles, afterRuleCycles)
    : { after: afterRuleCycles, before: beforeRuleCycles, newCycles: [], resolvedCycles: [], slowRuleCount: 0 };
    
  const formCSSAnalysis = { after: cssAnalysis, newIssues: cssAnalysis.issues, resolvedIssues: [] };
  const customFunctionAnalysis = customFunctionAnalyzer.compare(beforeCustomFunctions, afterCustomFunctions);
  
  core.info(hasUrls ? ' All analyses completed' : ' Limited analysis completed (CSS/JS only)');

  // Merge runtime errors from rule cycle analysis into custom functions
  if (ruleCycleAnalysis?.after?.runtimeErrors && ruleCycleAnalysis.after.runtimeErrors.length > 0) {
    core.info(`Merging ${ruleCycleAnalysis.after.runtimeErrors.length} runtime error(s) into custom functions`);
    
    // Add runtime errors as issues to custom functions
    // Runtime errors already have the correct file path from RulePerformanceAnalyzer
    const runtimeErrorsWithFiles = ruleCycleAnalysis.after.runtimeErrors.map(error => {
      // Find the function in custom function analysis to get line number
      const functionInfo = customFunctionAnalysis.after.analysis?.find(
        fn => fn.functionName === error.functionName
      );
      
      let lineNumber = functionInfo?.line;
      
      // If line number not found (function not in static analysis), search file content
      if (!lineNumber && error.file && error.file !== 'unknown') {
        try {
          const filePath = join(process.cwd(), error.file);
          if (existsSync(filePath)) {
            const content = readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            
            // Search for function definition (supports: function name(), export function name(), const name =)
            const functionPattern = new RegExp(
              `(export\\s+)?(async\\s+)?function\\s+${error.functionName}\\s*\\(|` +
              `(export\\s+)?const\\s+${error.functionName}\\s*=|` +
              `${error.functionName}\\s*:\\s*(async\\s+)?function`
            );
            
            for (let i = 0; i < lines.length; i++) {
              if (functionPattern.test(lines[i])) {
                lineNumber = i + 1; // Convert to 1-indexed
                core.info(`  Found ${error.functionName} at line ${lineNumber} in ${error.file}`);
                break;
              }
            }
          }
        } catch (err) {
          core.warning(`  Could not search file for ${error.functionName}: ${err.message}`);
        }
      }
      
      return {
        ...error,
        // error.file already has the correct path from RulePerformanceAnalyzer
        // If not present, try to get from customFunctionAnalysis
        file: error.file || functionInfo?.file || 'unknown',
        line: lineNumber || 1  // Fallback to 1 only if search fails
      };
    });
    
    if (!customFunctionAnalysis.after.issues) {
      customFunctionAnalysis.after.issues = [];
    }
    
    // Deduplicate - don't add if already exists (by functionName)
    const existingFunctionNames = new Set(
      customFunctionAnalysis.after.issues
        .filter(i => i.type === 'runtime-error-in-custom-function')
        .map(i => i.functionName)
    );
    
    core.info(`  Existing runtime errors in customFunctionAnalysis: ${existingFunctionNames.size}`);
    if (existingFunctionNames.size > 0) {
      core.info(`    Functions: ${Array.from(existingFunctionNames).join(', ')}`);
    }
    
    const newRuntimeErrors = runtimeErrorsWithFiles.filter(
      err => !existingFunctionNames.has(err.functionName)
    );
    
    if (newRuntimeErrors.length > 0) {
      customFunctionAnalysis.after.issues.push(...newRuntimeErrors);
      core.info(`  Added ${newRuntimeErrors.length} new runtime error(s) (${runtimeErrorsWithFiles.length - newRuntimeErrors.length} already present)`);
    } else {
      core.info(`  No new runtime errors to add (all ${runtimeErrorsWithFiles.length} already in customFunctionAnalysis)`);
    }
    
    // Final dedupe: Remove any remaining duplicates by function name (safety check)
    const seenFunctions = new Set();
    customFunctionAnalysis.after.issues = customFunctionAnalysis.after.issues.filter(issue => {
      if (issue.type === 'runtime-error-in-custom-function') {
        if (seenFunctions.has(issue.functionName)) {
          core.warning(`  Removing duplicate runtime error for ${issue.functionName}`);
          return false;
        }
        seenFunctions.add(issue.functionName);
      }
      return true;
    });
    
    // Add to newIssues for reporting (only new ones)
    if (!customFunctionAnalysis.newIssues) {
      customFunctionAnalysis.newIssues = [];
    }
    customFunctionAnalysis.newIssues.push(...newRuntimeErrors);
    
    // Track runtime error count
    customFunctionAnalysis.after.runtimeErrorCount = ruleCycleAnalysis.after.runtimeErrorCount;
  }

  let results = {
    formStructure: formStructureAnalysis,
    formEvents: formEventsAnalysis,
    hiddenFields: hiddenFieldsAnalysis,
    ruleCycles: ruleCycleAnalysis,
    formHTML: formHTMLAnalysis,
    formCSS: formCSSAnalysis,
    customFunctions: customFunctionAnalysis,
  };

  // FILTER results to PR diff files only
  core.info(' Filtering results to PR diff files only...');
  const prFiles = await getPRDiffFiles(octokit, owner, repo, prNumber);
  core.info(`  PR modified ${prFiles.length} file(s):`);
  prFiles.forEach(f => core.info(`    - ${f}`));
  
  // Log counts before filtering
  const beforeFilterCounts = {
    customFunctions: results.customFunctions?.newIssues?.length || 0,
    css: results.formCSS?.newIssues?.length || 0,
    formEvents: results.formEvents?.newIssues?.length || 0
  };
  core.info(`  Before filtering: ${beforeFilterCounts.customFunctions} custom function issues, ${beforeFilterCounts.css} CSS issues, ${beforeFilterCounts.formEvents} form event issues`);
  
  results = filterResultsToPRFiles(results, prFiles);
  
  // Log counts after filtering
  const afterFilterCounts = {
    customFunctions: results.customFunctions?.newIssues?.length || 0,
    css: results.formCSS?.newIssues?.length || 0,
    formEvents: results.formEvents?.newIssues?.length || 0
  };
  core.info(`  After filtering: ${afterFilterCounts.customFunctions} custom function issues, ${afterFilterCounts.css} CSS issues, ${afterFilterCounts.formEvents} form event issues`);
  core.info(` Filtered to issues in PR diff files only`);

  // AI AUTO-FIX SUGGESTIONS (runs after all analyzers complete)
  // Generates one-click fixable code suggestions for critical issues
  core.info(' Running AI Auto-Fix Analysis...');
  const autoFixSuggestions = await aiAutoFixAnalyzer.analyze(results);
  
  if (autoFixSuggestions.enabled) {
    core.info(` AI Auto-Fix completed: ${autoFixSuggestions.suggestions.length} suggestion(s) generated`);
    if (autoFixSuggestions.suggestions.length > 0) {
      core.info('  Fix suggestions for:');
      autoFixSuggestions.suggestions.forEach(s => {
        core.info(`    - ${s.title}`);
      });
    }
  }
  
  // Post inline PR review comments FIRST to know which ones succeed
  // Only count issues that have inline comments posted (files in PR diff)
  let postedInlineComments = [];
  let totalVisibleComments = 0;
  if (autoFixSuggestions?.enabled && autoFixSuggestions.suggestions.length > 0) {
    core.info(` Posting ${autoFixSuggestions.suggestions.length} inline suggestion(s)...`);
    try {
      const { reviewComments, totalVisible } = await aiAutoFixAnalyzer.postPRReviewComments(
        autoFixSuggestions.suggestions, // All suggestions (already filtered to PR diff files)
        octokit,
        owner,
        repo,
        prNumber,
        context.payload.pull_request.head.sha
      );
      
      postedInlineComments = reviewComments;
      totalVisibleComments = totalVisible;
      
      if (reviewComments.length > 0) {
        core.info(` Posted ${reviewComments.length} inline suggestion(s) on PR`);
      } else {
        core.info(' No inline comments posted (files not in PR diff)');
      }
    } catch (error) {
      core.warning(` Failed to post PR review comments: ${error.message}`);
    }
  }
  
  // Check for critical performance issues using totalVisibleComments for accurate count
  // Must be AFTER postPRReviewComments so totalVisibleComments is set
  const criticalIssues = detectCriticalIssues(results, totalVisibleComments);
  
  // Generate and post minimal PR comment (NO HTML report link in PR mode)
  // HTML reports are only for scheduled scans (full codebase analysis)
  // PR mode only shows issues in PR diff files via inline comments
  // Count ONLY issues that are actually visible in PR (posted + skipped = total visible)
  const reporter = new FormPRReporter(octokit, owner, repo, prNumber);
  await reporter.generateReport(results, {
    before: urls.before,
    after: urls.after,
    beforeData, // Include performance metrics
    afterData,  // Include performance metrics
    autoFixSuggestions, // Include AI-generated fix suggestions
    gistUrl: null, // No HTML report in PR mode
    totalVisibleComments, // Pass total visible comments (posted + existing) for accurate counting
  }, prNumber, `${owner}/${repo}`);

  // Fail the build if critical issues are detected
  if (criticalIssues.hasCritical) {
    core.error('Critical performance issues detected!');
    criticalIssues.issues.forEach(issue => core.error(`  - ${issue}`));
    core.setFailed(`Performance check failed: ${criticalIssues.count} critical issue(s) detected. See PR comment for details.`);
    return;
  }

  core.info('Performance analysis complete! No critical issues detected.');
}

/**
 * Run scheduled codebase scan mode (analyze entire repository)
 */
async function runScheduledMode(context, octokit, patOctokit, config) {
  const { owner, repo } = context.repo;
  
  core.info(`Scanning entire codebase in ${owner}/${repo}`);
  
  // Get URLs from config + workflow input
  const configUrls = config.scheduledScan?.urls || [];
  const workflowUrl = core.getInput('analysis-url');
  
  // Combine URLs (workflow input is added to config URLs)
  const analysisUrls = [...configUrls];
  if (workflowUrl && !analysisUrls.includes(workflowUrl)) {
    analysisUrls.push(workflowUrl);
  }
  
  if (analysisUrls.length === 0) {
    core.warning('⚠️  No analysis URLs provided for scheduled scan');
    core.info('');
    core.info('Scheduled mode requires URLs to extract form JSON.');
    core.info('Form JSON is not stored in repository - it only exists at runtime.');
    core.info('');
    core.info('To enable full analysis, provide URLs:');
    core.info('  1. Via .performance-bot.json: scheduledScan.urls array');
    core.info('  2. Via workflow_dispatch input: analysis-url (optional, added to config URLs)');
    core.info('');
    core.info('Falling back to static analysis only (CSS/JS files)...');
  } else {
    core.info(`Analyzing ${analysisUrls.length} form(s):`);
    analysisUrls.forEach((url, i) => core.info(`  ${i + 1}. ${url}`));
  }
  
  // Initialize analyzers
  const formCSSAnalyzer = new FormCSSAnalyzer(config);
  const customFunctionAnalyzer = new CustomFunctionAnalyzer(config);
  const rulePerformanceAnalyzer = new RulePerformanceAnalyzer(config);
  const formAnalyzer = new FormAnalyzer(config);
  const formEventsAnalyzer = new FormEventsAnalyzer(config);
  const hiddenFieldsAnalyzer = new HiddenFieldsAnalyzer(config);
  const formHTMLAnalyzer = new FormHTMLAnalyzer(config);
  const urlAnalyzer = new URLAnalyzer();
  
  // Load all files from workspace (NO filtering - entire codebase)
  core.info(' Loading all files from repository...');
  const { jsFiles, cssFiles} = await loadFilesFromWorkspace();
  core.info(`  Loaded ${jsFiles.length} JS files, ${cssFiles.length} CSS files`);
  
  // 1. CSS ANALYSIS (all CSS files - done once for entire codebase)
  core.info(' Analyzing CSS files...');
  const cssAnalysis = formCSSAnalyzer.analyze(cssFiles);
  const globalCSSIssues = cssAnalysis.issues || [];
  core.info(`  Found ${globalCSSIssues.length} CSS issues (codebase-wide)`);
  
  // 2. FORM-SPECIFIC ANALYSIS (loop through each URL)
  const formResults = [];
  const formGistLinks = [];
  
  if (analysisUrls.length > 0) {
    for (let i = 0; i < analysisUrls.length; i++) {
      const formUrl = analysisUrls[i];
      core.info(`\n [Form ${i + 1}/${analysisUrls.length}] Analyzing: ${formUrl}`);
      
      const formResult = {
        url: formUrl,
        formName: extractFormNameFromUrl(formUrl),
        css: { issues: globalCSSIssues }, // Same CSS issues for all forms
        customFunctions: { issues: [] },
        rules: { issues: [] },
        forms: { issues: [] },
        html: null,
        performance: null,
        formJson: null,
        gistUrl: null
      };
      
      try {
        core.info('  Fetching form JSON from URL...');
        const urlData = await urlAnalyzer.analyze(formUrl);
        
        if (!urlData.formJson) {
          core.warning('  Failed to extract form JSON - skipping this form');
          formResult.error = 'Failed to extract form JSON';
          formResults.push(formResult);
          continue;
        }
        
        core.info(`  Form JSON extracted successfully`);
        formResult.formJson = urlData.formJson;
        
        // Analyze this form
        core.info('  Analyzing custom functions...');
        const customFunctionsAnalysis = customFunctionAnalyzer.analyze(urlData.formJson, jsFiles);
        formResult.customFunctions.issues = customFunctionsAnalysis.issues || [];
        core.info(`    Found ${formResult.customFunctions.issues.length} custom function issues`);
        
        core.info('  Analyzing form events...');
        const eventsAnalysis = formEventsAnalyzer.analyze(urlData.formJson);
        if (eventsAnalysis.issues) {
          formResult.forms.issues.push(...eventsAnalysis.issues);
        }
        core.info(`    Found ${eventsAnalysis.issues?.length || 0} form event issues`);
        
        core.info('  Analyzing hidden fields...');
        const hiddenFieldsAnalysis = hiddenFieldsAnalyzer.analyze(urlData.formJson, jsFiles);
        if (hiddenFieldsAnalysis.issues) {
          formResult.forms.issues.push(...hiddenFieldsAnalysis.issues);
        }
        core.info(`    Found ${hiddenFieldsAnalysis.issues?.length || 0} hidden field issues`);
        
        core.info('  Analyzing rule cycles...');
        const ruleCyclesAnalysis = await rulePerformanceAnalyzer.analyze(urlData.formJson);
        if (ruleCyclesAnalysis.cycles > 0) {
          formResult.rules.issues.push({
            cycles: ruleCyclesAnalysis.cycles,
            details: ruleCyclesAnalysis.cycleDetails,
            totalRules: ruleCyclesAnalysis.totalRules
          });
        }
        core.info(`    Found ${ruleCyclesAnalysis.cycles || 0} rule cycles`);
        
        core.info('  Analyzing HTML...');
        const htmlAnalysis = formHTMLAnalyzer.analyze(urlData.html);
        if (htmlAnalysis.issues) {
          formResult.html = {
            domSize: urlData.html?.length || 0,
            formRendered: urlData.formRendered || false,
            issues: htmlAnalysis.issues
          };
        }
        core.info(`    Found ${htmlAnalysis.issues?.length || 0} HTML issues`);
        
        formResult.performance = {
          loadTime: urlData.loadTime || 0,
          jsHeapSize: urlData.jsHeapSize || 0
        };
        core.info(`    Load time: ${formResult.performance.loadTime}ms`);
        
        // Generate individual HTML report for this form
        core.info('  Generating HTML report for this form...');
        const htmlReporter = new HTMLReporter();
        const formHtmlReport = htmlReporter.generateScheduledReport(formResult, {
          repository: `${owner}/${repo}`,
          analysisUrl: formUrl,
          timestamp: new Date().toISOString()
        });
        
        // Upload to Gist
        core.info('  Creating Gist for detailed report...');
        try {
          const gistResponse = await patOctokit.rest.gists.create({
            description: `Performance Report - ${formResult.formName} - ${repo} - ${new Date().toDateString()}`,
            public: false,
            files: {
              [`${formResult.formName}-performance-report.html`]: {
                content: formHtmlReport
              }
            }
          });
          
          const previewUrl = `https://htmlpreview.github.io/?${gistResponse.data.files[`${formResult.formName}-performance-report.html`].raw_url}`;
          formResult.gistUrl = previewUrl;
          formGistLinks.push({ formName: formResult.formName, url: previewUrl });
          core.info(`    Gist created: ${previewUrl}`);
        } catch (error) {
          core.warning(`    Failed to create gist: ${error.message}`);
        }
        
      } catch (error) {
        core.error(`  Form analysis failed: ${error.message}`);
        formResult.error = error.message;
      }
      
      formResults.push(formResult);
    }
  }
  
  // Generate summary HTML report
  core.info('\n📊 Generating summary report...');
  const htmlReporter = new HTMLReporter();
  const summaryHtmlReport = htmlReporter.generateScheduledSummaryReport(formResults, {
    repository: `${owner}/${repo}`,
    timestamp: new Date().toISOString(),
    formGistLinks
  });
  
  // Save summary report
  const reportPath = join(process.cwd(), 'scheduled-performance-report.html');
  writeFileSync(reportPath, summaryHtmlReport, 'utf-8');
  core.info(` Summary report saved to: ${reportPath}`);
  
  // Send email via SendGrid
  core.info('\n📧 Sending email report...');
  const { sendEmailReport } = await import('./utils/email-sender.js');
  
  const emailSent = await sendEmailReport(formResults, summaryHtmlReport, {
    repository: `${owner}/${repo}`,
    from: 'aemforms-performance-bot@adobe.com',
    formGistLinks
  });
  
  if (emailSent) {
    core.info('✅ Email sent successfully');
  } else {
    core.warning('⚠️  Email not sent - check SENDGRID_API_KEY');
  }
  
  core.info(`\n✓ Scheduled scan completed - analyzed ${formResults.length} form(s)`);
}

/**
 * Extract form name from URL for display
 */
function extractFormNameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const parts = pathname.split('/').filter(p => p);
    // Return last 2-3 path segments as form name
    return parts.slice(-3).join('/') || 'form';
  } catch (error) {
    return 'form';
  }
}

/**
 * Detect critical performance issues that should fail the build
 * @param {Object} results - Analysis results
 * @param {number} totalVisibleComments - Count of inline comments actually visible in PR (most accurate)
 * @returns {Object} Critical issues summary
 */
function detectCriticalIssues(results, totalVisibleComments = null) {
  const critical = {
  hasCritical: false,
  count: 0,
  issues: [],
  };
  
  // If we have totalVisibleComments, use it directly (most accurate for PR mode)
  // This represents issues that are ACTUALLY visible in the PR, not just detected
  if (typeof totalVisibleComments === 'number' && totalVisibleComments > 0) {
    critical.hasCritical = true;
    critical.count = totalVisibleComments;
    critical.issues.push(`${totalVisibleComments} issue(s) found in PR diff (see inline comments)`);
    return critical;
  }

  // 1. API calls in initialize events (CRITICAL - blocks form rendering)
  if (results.formEvents?.newIssues && results.formEvents.newIssues.length > 0) {
  critical.hasCritical = true;
  critical.count += results.formEvents.newIssues.length;
  critical.issues.push(`${results.formEvents.newIssues.length} API call(s) in initialize events (blocks form rendering)`);
  }

  // 2. Circular dependencies (CRITICAL - causes infinite loops)
  if (results.ruleCycles?.newCycles && results.ruleCycles.newCycles.length > 0) {
  critical.hasCritical = true;
  critical.count += results.ruleCycles.newCycles.length;
  critical.issues.push(`${results.ruleCycles.newCycles.length} circular dependenc${results.ruleCycles.newCycles.length > 1 ? 'ies' : 'y'} (infinite loops)`);
  }

  // 2b. Slow rules (CRITICAL - blocks interactions)
  if (results.ruleCycles?.slowRuleCount && results.ruleCycles.slowRuleCount > 0) {
  critical.hasCritical = true;
  critical.count += results.ruleCycles.slowRuleCount;
  critical.issues.push(`${results.ruleCycles.slowRuleCount} slow rule(s) detected (> 50ms execution, blocks interactions)`);
  }

  // 3. Custom functions with violations (CRITICAL - breaks architecture)
  if (results.customFunctions?.newIssues) {
  const domAccessIssues = results.customFunctions.newIssues.filter(i => i.type === 'dom-access-in-custom-function');
  const httpRequestIssues = results.customFunctions.newIssues.filter(i => i.type === 'http-request-in-custom-function');
  
  if (domAccessIssues.length > 0) {
    critical.hasCritical = true;
    critical.count += domAccessIssues.length;
    critical.issues.push(`${domAccessIssues.length} custom function(s) directly accessing DOM`);
  }
  
  if (httpRequestIssues.length > 0) {
    critical.hasCritical = true;
    critical.count += httpRequestIssues.length;
    critical.issues.push(`${httpRequestIssues.length} custom function(s) making HTTP requests`);
  }
  }

  // 4. CSS issues (ALL issues in PR mode are critical - must fix)
  if (results.formCSS?.newIssues && results.formCSS.newIssues.length > 0) {
    critical.hasCritical = true;
    critical.count += results.formCSS.newIssues.length;
    
    // Break down by type for reporting
    const blockingImports = results.formCSS.newIssues.filter(i => i.type === 'css-import-blocking');
    const backgroundImages = results.formCSS.newIssues.filter(i => i.type === 'css-background-image');
    const otherCSS = results.formCSS.newIssues.length - blockingImports.length - backgroundImages.length;
    
    if (blockingImports.length > 0) {
      critical.issues.push(`${blockingImports.length} @import statement(s) in CSS`);
    }
    if (backgroundImages.length > 0) {
      critical.issues.push(`${backgroundImages.length} CSS background-image(s)`);
    }
    if (otherCSS > 0) {
      critical.issues.push(`${otherCSS} other CSS issue(s)`);
    }
  }

  // 5. HTML issues (ALL issues in PR mode are critical - must fix)
  if (results.formHTML?.newIssues && results.formHTML.newIssues.length > 0) {
    critical.hasCritical = true;
    
    // Count all HTML issues
    results.formHTML.newIssues.forEach(issue => {
      if (issue.count) {
        critical.count += 1; // Each issue type counts as 1
        
        // Add descriptive message based on type
        if (issue.type === 'inline-scripts-on-page' && issue.breakdown) {
          critical.issues.push(`${issue.count} inline script(s) (${issue.breakdown.head || 0} in <head>, ${issue.breakdown.body || 0} in <body>)`);
        } else if (issue.type === 'blocking-scripts-on-page' && issue.breakdown) {
          critical.issues.push(`${issue.count} blocking script(s) (${issue.breakdown.head || 0} in <head>, ${issue.breakdown.body || 0} in <body>)`);
        } else if (issue.type === 'excessive-dom-size') {
          critical.issues.push(`${issue.count} DOM nodes (threshold: ${issue.threshold})`);
        } else if (issue.type === 'images-not-lazy-loaded') {
          critical.issues.push(`${issue.count} image(s) without lazy loading`);
        } else if (issue.type === 'large-dom-size') {
          critical.issues.push(`${issue.count} DOM nodes (warning threshold)`);
        } else if (issue.type === 'iframes-in-form') {
          critical.issues.push(`${issue.count} iframe(s) in form`);
        } else if (issue.type === 'autoplay-videos') {
          critical.issues.push(`${issue.count} autoplay video(s)`);
        } else {
          critical.issues.push(`HTML issue: ${issue.message || issue.type}`);
        }
      }
    });
  }

  // 6. Hidden fields (ALL issues in PR mode are critical - must fix)
  if (results.hiddenFields?.newIssues && results.hiddenFields.newIssues.length > 0) {
    critical.hasCritical = true;
    critical.count += results.hiddenFields.newIssues.length;
    critical.issues.push(`${results.hiddenFields.newIssues.length} unnecessary hidden field(s)`);
  }

  // 7. Custom function runtime errors and other issues
  // NOTE: DOM and HTTP are already counted in section #3 above, don't double-count
  if (results.customFunctions?.newIssues && results.customFunctions.newIssues.length > 0) {
    critical.hasCritical = true;
    
    // Break down by type
    const runtimeErrors = results.customFunctions.newIssues.filter(i => i.type === 'runtime-error-in-custom-function');
    const domAccessIssues = results.customFunctions.newIssues.filter(i => i.type === 'dom-access-in-custom-function');
    const httpRequestIssues = results.customFunctions.newIssues.filter(i => i.type === 'http-request-in-custom-function');
    
    // Other issues = everything except runtime, DOM, HTTP (to avoid double counting)
    const otherIssues = results.customFunctions.newIssues.length - runtimeErrors.length - domAccessIssues.length - httpRequestIssues.length;
    
    // Only count runtime errors and "other" here (DOM/HTTP already counted above)
    critical.count += runtimeErrors.length + otherIssues;
    
    if (runtimeErrors.length > 0) {
      critical.issues.push(`${runtimeErrors.length} custom function(s) with runtime errors`);
    }
    if (otherIssues > 0) {
      critical.issues.push(`${otherIssues} other custom function issue(s)`);
    }
  }

  return critical;
}

/**
 * Load JavaScript and CSS files from the checked-out repository
 * This is faster than fetching via GitHub API and works with the same files
 * that RuleCycleAnalyzer uses for loading custom functions
 */
async function loadFilesFromWorkspace() {
  const workspaceRoot = process.cwd();
  const jsFiles = [];
  const cssFiles = [];
  
  core.info(`Scanning workspace: ${workspaceRoot}`);
  
  // Recursively scan directory for JS and CSS files
  function scanDirectory(dir, depth = 0) {
  // Prevent infinite recursion and skip deep node_modules
  if (depth > 10) return;
  
  try {
    const entries = readdirSync(dir);
    
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      
      // Skip common ignore patterns
      if (entry === 'node_modules' || 
          entry === '.git' || 
          entry === 'dist' ||
          entry === 'coverage' ||
          entry.startsWith('.')) {
        continue;
      }
      
      try {
        const stats = statSync(fullPath);
        
        if (stats.isDirectory()) {
          scanDirectory(fullPath, depth + 1);
        } else if (stats.isFile()) {
          const relativePath = fullPath.replace(workspaceRoot + '/', '');
          
          // JavaScript files
          if ((entry.endsWith('.js') || entry.endsWith('.mjs')) &&
              !relativePath.includes('test') &&
              !relativePath.includes('__tests__') &&
              !entry.includes('.test.') &&
              !entry.includes('.spec.')) {
            jsFiles.push({
              filename: relativePath,
              content: readFileSync(fullPath, 'utf-8')
            });
          }
          
          // CSS files
          if (entry.endsWith('.css') &&
              !relativePath.includes('test') &&
              !relativePath.includes('__tests__')) {
            cssFiles.push({
              filename: relativePath,
              content: readFileSync(fullPath, 'utf-8')
            });
          }
        }
      } catch (error) {
        // Skip files/dirs we can't access
        continue;
      }
    }
  } catch (error) {
    core.warning(`Could not scan directory ${dir}: ${error.message}`);
  }
  }
  
  scanDirectory(workspaceRoot);
  
  // Prioritize functions.js files so they're always included even if we hit the limit
  // Sort to put functions.js files first
  jsFiles.sort((a, b) => {
  const aIsFunctions = a.filename.includes('functions.js');
  const bIsFunctions = b.filename.includes('functions.js');
  if (aIsFunctions && !bIsFunctions) return -1;
  if (!aIsFunctions && bIsFunctions) return 1;
  return 0;
  });
  
  // Limit to reasonable numbers (same as API approach)
  const jsFilesLimited = jsFiles.slice(0, 50);
  const cssFilesLimited = cssFiles.slice(0, 30);
  
  core.info(`Found ${jsFiles.length} JS files (analyzing ${jsFilesLimited.length}), ${cssFiles.length} CSS files (analyzing ${cssFilesLimited.length})`);
  
  // Log functions.js files to verify they're included
  const functionsFiles = jsFilesLimited.filter(f => f.filename.includes('functions.js'));
  core.info(`functions.js files included (${functionsFiles.length}): ${functionsFiles.map(f => f.filename).join(', ')}`);
  if (jsFilesLimited.length > 0 && functionsFiles.length === 0) {
  core.warning(`No functions.js files found in first ${jsFilesLimited.length} files!`);
  }
  
  return {
  jsFiles: jsFilesLimited,
  cssFiles: cssFilesLimited
  };
}

/**
 * Fetch ALL JavaScript files from the PR branch (DEPRECATED - use loadFilesFromWorkspace instead)
 * Not just the diff - we need to scan all JS files to find hidden field references
 */
async function fetchJSFilesFromPR(context, octokit) {
  try {
  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request.number;
  const branch = context.payload.pull_request.head.ref;
  const sha = context.payload.pull_request.head.sha;

  core.info(`Fetching all JavaScript files from branch: ${branch} (${sha})`);

  // Get the tree of the entire branch
  const { data: tree } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: sha,
    recursive: 'true', // Get entire tree recursively
  });

  // Filter for JavaScript files
  const jsFiles = tree.tree.filter(file => 
    file.type === 'blob' &&
    (file.path.endsWith('.js') || file.path.endsWith('.mjs')) &&
    !file.path.includes('node_modules') &&
    !file.path.includes('test') &&
    !file.path.includes('__tests__') &&
    !file.path.includes('.test.') &&
    !file.path.includes('.spec.')
  );

  core.info(`Found ${jsFiles.length} JavaScript files in branch (excluding tests and node_modules)`);

  const fileContents = [];
  
  // Limit to reasonable number to avoid timeout
  const filesToAnalyze = jsFiles.slice(0, 50);
  core.info(`Analyzing ${filesToAnalyze.length} files for hidden field references`);

  for (const file of filesToAnalyze) {
    try {
      // Fetch file content using blob API
      const { data: blob } = await octokit.rest.git.getBlob({
        owner,
        repo,
        file_sha: file.sha,
      });

      // Decode base64 content
      const content = Buffer.from(blob.content, 'base64').toString('utf-8');
      
      fileContents.push({
        filename: file.path,
        content,
      });
    } catch (error) {
      core.warning(`Error fetching ${file.path}: ${error.message}`);
    }
  }

  core.info(`Successfully fetched ${fileContents.length} JavaScript files`);
  return fileContents;
  } catch (error) {
  core.warning(`Error fetching JS files: ${error.message}`);
  return [];
  }
}

/**
 * Fetch ALL CSS files from the PR branch
 * Analyzes all CSS for form-specific architectural issues
 */
async function fetchCSSFilesFromPR(context, octokit) {
  try {
  const { owner, repo } = context.repo;
  const sha = context.payload.pull_request.head.sha;

  core.info(`Fetching all CSS files from branch (${sha})`);

  // Get the tree of the entire branch
  const { data: tree } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: sha,
    recursive: 'true',
  });

  // Filter for CSS files
  const cssFiles = tree.tree.filter(file => 
    file.type === 'blob' &&
    file.path.endsWith('.css') &&
    !file.path.includes('node_modules') &&
    !file.path.includes('test') &&
    !file.path.includes('__tests__')
  );

  core.info(`Found ${cssFiles.length} CSS files in branch (excluding tests and node_modules)`);

  const fileContents = [];
  
  // Limit to reasonable number
  const filesToAnalyze = cssFiles.slice(0, 30);
  core.info(`Analyzing ${filesToAnalyze.length} CSS files for form-specific issues`);

  for (const file of filesToAnalyze) {
    try {
      const { data: blob } = await octokit.rest.git.getBlob({
        owner,
        repo,
        file_sha: file.sha,
      });

      const content = Buffer.from(blob.content, 'base64').toString('utf-8');
      
      fileContents.push({
        filename: file.path,
        content,
      });
    } catch (error) {
      core.warning(`Error fetching ${file.path}: ${error.message}`);
    }
  }

  core.info(`Successfully fetched ${fileContents.length} CSS files`);
  return fileContents;
  } catch (error) {
  core.warning(`Error fetching CSS files: ${error.message}`);
  return [];
  }
}

run();

