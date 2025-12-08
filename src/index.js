import * as core from '@actions/core';
import * as github from '@actions/github';
import { URLAnalyzer } from './analyzers/url-analyzer.js';
import { FormAnalyzer } from './analyzers/form-analyzer.js';
import { FormEventsAnalyzer } from './analyzers/form-events-analyzer.js';
import { HiddenFieldsAnalyzer } from './analyzers/hidden-fields-analyzer.js';
import { RuleCycleAnalyzer } from './analyzers/rule-cycle-analyzer.js';
import { FormHTMLAnalyzer } from './analyzers/form-html-analyzer.js';
import { FormCSSAnalyzer } from './analyzers/form-css-analyzer.js';
import { CustomFunctionAnalyzer } from './analyzers/custom-function-analyzer.js';
import { FormPRReporter } from './reporters/pr-reporter-form.js';
import { extractURLsFromPR } from './utils/github-helper.js';
import { loadConfig } from './utils/config-loader.js';

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
    const token = core.getInput('github-token', { required: true });
    const octokit = github.getOctokit(token);

    // Verify this is a pull request
    if (!context.payload.pull_request) {
      core.warning('This action only runs on pull requests');
      return;
    }

    const prNumber = context.payload.pull_request.number;
    const { owner, repo } = context.repo;

    core.info(`Analyzing PR #${prNumber} in ${owner}/${repo}`);

    // Extract before/after URLs from PR description
    const prBody = context.payload.pull_request.body || '';
    const urls = extractURLsFromPR(prBody);

    if (!urls.before || !urls.after) {
      core.warning('Could not find Before/After URLs in PR description');
      core.info('Expected format:\nTest URLs:\nBefore: <url>\nAfter: <url>');
      return;
    }

    core.info(`Before URL: ${urls.before}`);
    core.info(`After URL: ${urls.after}`);

    // Initialize analyzers with config
    const urlAnalyzer = new URLAnalyzer();
    const formAnalyzer = new FormAnalyzer(config);
    const formEventsAnalyzer = new FormEventsAnalyzer(config);
    const hiddenFieldsAnalyzer = new HiddenFieldsAnalyzer(config);
    const ruleCycleAnalyzer = new RuleCycleAnalyzer(config);
    const formHTMLAnalyzer = new FormHTMLAnalyzer(config);
    const formCSSAnalyzer = new FormCSSAnalyzer(config);
    const customFunctionAnalyzer = new CustomFunctionAnalyzer(config);

    // Analyze both URLs
    core.info('Fetching and analyzing before URL...');
    const beforeData = await urlAnalyzer.analyze(urls.before);
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
    const afterData = await urlAnalyzer.analyze(urls.after);
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
      core.warning('⚠️ WARNING: Before and After form JSONs are identical! This may indicate:');
      core.warning('  1. The URLs are pointing to the same content (caching issue?)');
      core.warning('  2. The PR branch has not been deployed yet');
      core.warning('  3. The form has not changed between branches');
      core.warning('Analysis will continue but results may not show differences.');
    }

    // Get JavaScript and CSS files from PR branch
    core.info(' Fetching JavaScript files from PR branch...');
    const jsFiles = await fetchJSFilesFromPR(context, octokit);
    
    core.info(' Fetching CSS files from PR branch...');
    const cssFiles = await fetchCSSFilesFromPR(context, octokit);

    // Perform form-specific analyses IN PARALLEL for speed
    core.info(' Running all analyses in parallel...');
    
    const [
      formStructureAnalysis,
      formEventsAnalysis,
      { beforeHiddenFields, afterHiddenFields },
      { beforeRuleCycles, afterRuleCycles },
      formHTMLAnalysis,
      cssAnalysis,
      { beforeCustomFunctions, afterCustomFunctions }
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
      
      // 4. Rule Cycles (async - uses createFormInstance)
      Promise.all([
        ruleCycleAnalyzer.analyze(beforeData.formJson),
        ruleCycleAnalyzer.analyze(afterData.formJson)
      ]).then(([beforeRuleCycles, afterRuleCycles]) => ({ beforeRuleCycles, afterRuleCycles })),
      
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

    // Compile comparison results
    const hiddenFieldsAnalysis = hiddenFieldsAnalyzer.compare(beforeHiddenFields, afterHiddenFields);
    const ruleCycleAnalysis = ruleCycleAnalyzer.compare(beforeRuleCycles, afterRuleCycles);
    const formCSSAnalysis = { after: cssAnalysis, newIssues: cssAnalysis.issues, resolvedIssues: [] };
    const customFunctionAnalysis = customFunctionAnalyzer.compare(beforeCustomFunctions, afterCustomFunctions);
    
    core.info(' All analyses completed');

    const results = {
      formStructure: formStructureAnalysis,
      formEvents: formEventsAnalysis,
      hiddenFields: hiddenFieldsAnalysis,
      ruleCycles: ruleCycleAnalysis,
      formHTML: formHTMLAnalysis,
      formCSS: formCSSAnalysis,
      customFunctions: customFunctionAnalysis,
    };

    // Generate and post PR comment
    const reporter = new FormPRReporter(octokit, owner, repo, prNumber);
    await reporter.generateReport(results, urls);

    core.info(' Performance analysis complete!');

  } catch (error) {
    core.setFailed(`Performance Bot failed: ${error.message}`);
    core.error(error.stack);
  }
}

/**
 * Fetch ALL JavaScript files from the PR branch
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

