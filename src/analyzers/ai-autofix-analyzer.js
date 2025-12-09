import * as core from '@actions/core';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * AI-Powered Auto-Fix Generator
 * Generates GitHub PR suggestions for automatically fixable performance issues
 */
export class AIAutoFixAnalyzer {
  constructor(config = null) {
    this.config = config;
    
    // Azure OpenAI Configuration
    this.azureApiKey = process.env.AZURE_OPENAI_API_KEY;
    this.azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT || 'https://forms-azure-openai-stg-eastus2.openai.azure.com/';
    this.azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1-garage-week';
    this.azureApiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';
    
    this.workspaceRoot = process.cwd();
  }

  /**
   * Analyze all results and generate auto-fix suggestions
   * @param {Object} results - All analyzer results
   * @returns {Promise<Array>} Array of fix suggestions
   */
  async analyze(results) {
    if (!this.azureApiKey) {
      core.info('AI Auto-Fix skipped: No Azure OpenAI API key configured (set AZURE_OPENAI_API_KEY)');
      return {
        enabled: false,
        reason: 'No Azure OpenAI API key configured',
        suggestions: []
      };
    }

    try {
      core.info('🤖 Starting AI Auto-Fix Analysis...');
      core.info(`Azure OpenAI Endpoint: ${this.azureEndpoint}`);
      core.info(`Azure OpenAI Deployment: ${this.azureDeployment}`);
      
      const fixableSuggestions = [];
      
      // 1. CSS @import → <link> tags (CRITICAL)
      const importFixes = await this.fixCSSImports(results.formCSS);
      fixableSuggestions.push(...importFixes);
      
      // 2. CSS background-image → <img> component (CRITICAL)
      const backgroundImageFixes = await this.fixCSSBackgroundImages(results.formCSS);
      fixableSuggestions.push(...backgroundImageFixes);
      
      // 3. Blocking scripts → defer (CRITICAL)
      const scriptFixes = await this.fixBlockingScripts(results.formHTML);
      fixableSuggestions.push(...scriptFixes);
      
      // 4. Remove unnecessary hidden fields (HIGH)
      const hiddenFieldFixes = await this.fixUnnecessaryHiddenFields(results.hiddenFields);
      fixableSuggestions.push(...hiddenFieldFixes);
      
      // 5. API calls in initialize → custom events (CRITICAL but complex)
      const initializeFixes = await this.fixAPICallsInInitialize(results.formEvents);
      fixableSuggestions.push(...initializeFixes);
      
      core.info(`✅ AI Auto-Fix completed: ${fixableSuggestions.length} suggestion(s) generated`);
      
      return {
        enabled: true,
        provider: 'azure-openai',
        suggestions: fixableSuggestions
      };
    } catch (error) {
      core.warning(`AI Auto-Fix failed: ${error.message}`);
      return {
        enabled: false,
        error: error.message,
        suggestions: []
      };
    }
  }

  /**
   * Fix CSS @import statements
   * Replace with <link> tags in HTML or bundle recommendation
   */
  async fixCSSImports(cssResults) {
    if (!cssResults?.newIssues) return [];
    
    const importIssues = cssResults.newIssues.filter(i => i.type === 'css-import-blocking');
    if (importIssues.length === 0) return [];
    
    const suggestions = [];
    
    for (const issue of importIssues) {
      try {
        const filePath = resolve(this.workspaceRoot, issue.file);
        const fileContent = readFileSync(filePath, 'utf-8');
        const lines = fileContent.split('\n');
        
        // Get context around the @import line
        const lineIndex = issue.line - 1;
        const contextStart = Math.max(0, lineIndex - 2);
        const contextEnd = Math.min(lines.length, lineIndex + 3);
        const context = lines.slice(contextStart, contextEnd).join('\n');
        
        // Generate fix using AI
        const fix = await this.generateImportFix(issue, context, lines[lineIndex]);
        
        if (fix) {
          suggestions.push({
            type: 'css-import-fix',
            severity: 'critical',
            file: issue.file,
            line: issue.line,
            title: `Replace @import with bundled CSS`,
            description: `CSS @import blocks rendering. ${fix.explanation}`,
            originalCode: lines[lineIndex],
            fixedCode: fix.fixedCode,
            alternativeFix: fix.alternativeFix,
            estimatedImpact: 'Eliminates render-blocking @import, improves FCP by 100-300ms'
          });
        }
      } catch (error) {
        core.warning(`Error generating fix for ${issue.file}:${issue.line}: ${error.message}`);
      }
    }
    
    return suggestions;
  }

  /**
   * Fix CSS background-image usage
   * Replace with <img> component for lazy loading
   */
  async fixCSSBackgroundImages(cssResults) {
    if (!cssResults?.newIssues) return [];
    
    const bgImageIssues = cssResults.newIssues.filter(i => i.type === 'css-background-image');
    if (bgImageIssues.length === 0) return [];
    
    const suggestions = [];
    
    for (const issue of bgImageIssues.slice(0, 3)) { // Limit to top 3
      try {
        const filePath = resolve(this.workspaceRoot, issue.file);
        const fileContent = readFileSync(filePath, 'utf-8');
        const lines = fileContent.split('\n');
        
        const lineIndex = issue.line - 1;
        const contextStart = Math.max(0, lineIndex - 5);
        const contextEnd = Math.min(lines.length, lineIndex + 5);
        const context = lines.slice(contextStart, contextEnd).join('\n');
        
        const fix = await this.generateBackgroundImageFix(issue, context);
        
        if (fix) {
          suggestions.push({
            type: 'css-background-image-fix',
            severity: 'critical',
            file: issue.file,
            line: issue.line,
            title: `Replace background-image with Image component`,
            description: `CSS background-images cannot be lazy loaded. ${fix.explanation}`,
            originalCode: fix.originalCode,
            fixedCode: fix.fixedCode,
            htmlSuggestion: fix.htmlSuggestion,
            estimatedImpact: 'Enables lazy loading, reduces initial page weight by image size'
          });
        }
      } catch (error) {
        core.warning(`Error generating fix for ${issue.file}:${issue.line}: ${error.message}`);
      }
    }
    
    return suggestions;
  }

  /**
   * Fix blocking scripts
   * Add defer attribute to external scripts
   */
  async fixBlockingScripts(htmlResults) {
    if (!htmlResults?.newIssues) return [];
    
    const blockingScripts = htmlResults.newIssues.filter(i => 
      i.type === 'blocking-scripts-on-page'
    );
    
    if (blockingScripts.length === 0) return [];
    
    const suggestions = [];
    
    // For blocking scripts, we need to provide general guidance since HTML is client-rendered
    suggestions.push({
      type: 'blocking-scripts-fix',
      severity: 'critical',
      title: `Add defer attribute to ${blockingScripts[0].count} blocking script(s)`,
      description: `Blocking scripts delay form rendering. Add 'defer' attribute to external scripts.`,
      guidance: `
1. Locate <script> tags in your HTML template without 'defer' or 'async'
2. Add 'defer' attribute: <script src="..." defer></script>
3. For inline scripts, consider moving to external file or placing before </body>

Example:
- Before: <script src="app.js"></script>
- After:  <script src="app.js" defer></script>

Note: defer maintains execution order, async does not.
`,
      estimatedImpact: `Eliminates parser blocking, improves TBT by ${blockingScripts[0].count * 50}ms+`
    });
    
    return suggestions;
  }

  /**
   * Fix unnecessary hidden fields
   * Suggest removal or conversion to form variables
   */
  async fixUnnecessaryHiddenFields(hiddenFieldsResults) {
    if (!hiddenFieldsResults?.after?.unnecessaryFields?.length) return [];
    
    const fields = hiddenFieldsResults.after.unnecessaryFields;
    if (fields.length === 0) return [];
    
    const suggestions = [];
    
    // Group by common patterns for batch fixes
    const top5Fields = fields.slice(0, 5);
    
    suggestions.push({
      type: 'hidden-fields-fix',
      severity: 'high',
      title: `Remove ${fields.length} unnecessary hidden field(s)`,
      description: `These fields are never made visible and bloat the DOM by ${fields.length} elements.`,
      fieldsToRemove: top5Fields,
      guidance: `
**Option 1: Remove from form JSON** (Recommended if not needed)
1. Remove field definitions from form JSON
2. Remove any references in rules/validations

**Option 2: Convert to form variables** (If data storage is needed)
\`\`\`javascript
// Instead of hidden field, use:
const formData = {
  ${top5Fields.slice(0, 3).map(f => `${f}: null`).join(',\n  ')}
};
\`\`\`

**Fields to review:**
${top5Fields.map(f => `- ${f}`).join('\n')}
${fields.length > 5 ? `\n...and ${fields.length - 5} more` : ''}
`,
      estimatedImpact: `Reduces DOM by ${fields.length} nodes, improves INP by ~${Math.min(fields.length * 2, 50)}ms`
    });
    
    return suggestions;
  }

  /**
   * Fix API calls in initialize events
   * Suggest moving to custom:formViewInitialized event
   */
  async fixAPICallsInInitialize(formEventsResults) {
    if (!formEventsResults?.newIssues?.length) return [];
    
    const suggestions = [];
    
    for (const issue of formEventsResults.newIssues.slice(0, 2)) { // Top 2
      suggestions.push({
        type: 'api-in-initialize-fix',
        severity: 'critical',
        field: issue.field,
        title: `Move API call from initialize to custom:formViewInitialized (${issue.field})`,
        description: `API calls in initialize block form rendering until complete.`,
        guidance: `
**Current (BLOCKING):**
\`\`\`json
"events": {
  "initialize": [
    "${issue.expression?.substring(0, 60)}..."
  ]
}
\`\`\`

**Recommended Fix:**
\`\`\`json
"events": {
  "custom:formViewInitialized": [
    "${issue.expression?.substring(0, 60)}..."
  ]
}
\`\`\`

**Why:** 
- \`initialize\` runs during form construction (blocks rendering)
- \`custom:formViewInitialized\` runs after form is rendered (non-blocking)
- Form displays immediately, API calls execute in background
- User sees UI ~500-2000ms faster (API latency removed from critical path)
`,
        estimatedImpact: 'Form renders ~500-2000ms faster (API latency removed from critical path)'
      });
    }
    
    return suggestions;
  }

  /**
   * Generate @import fix using AI
   */
  async generateImportFix(issue, context, importLine) {
    const prompt = `Fix this CSS @import that blocks rendering:

File: ${issue.file}
Line: ${issue.line}
Code: ${importLine}
Import URL: ${issue.importUrl}

Context:
\`\`\`css
${context}
\`\`\`

Provide TWO solutions as JSON:
{
  "fixedCode": "/* Comment suggesting removal and bundling */",
  "alternativeFix": "How to add <link> in HTML instead",
  "explanation": "Why this fix improves performance (1 sentence)"
}

Keep fixedCode brief (single line comment suggesting bundling).`;

    try {
      const response = await this.callAI(prompt, 'Fix CSS @import');
      return response;
    } catch (error) {
      core.warning(`AI call failed for import fix: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate background-image fix using AI
   */
  async generateBackgroundImageFix(issue, context) {
    const prompt = `Replace this CSS background-image with an HTML Image component:

File: ${issue.file}
Line: ${issue.line}
Image URL: ${issue.image}

CSS Context:
\`\`\`css
${context}
\`\`\`

Provide a fix as JSON:
{
  "originalCode": "The CSS rule to remove/comment",
  "fixedCode": "CSS comment or empty rule",
  "htmlSuggestion": "<img> tag to add in HTML",
  "explanation": "Why this enables lazy loading (1 sentence)"
}

The HTML should use loading="lazy" and include width/height for CLS prevention.`;

    try {
      const response = await this.callAI(prompt, 'Fix CSS background-image');
      return response;
    } catch (error) {
      core.warning(`AI call failed for background-image fix: ${error.message}`);
      return null;
    }
  }

  /**
   * Call Azure OpenAI API
   */
  async callAI(userPrompt, taskName) {
    const systemPrompt = `You are an expert web performance engineer specializing in AEM Forms.
Generate ONLY valid JSON responses. Be concise and actionable.
Focus on performance impact and Core Web Vitals (FCP, LCP, TBT, INP).`;

    return await this.callAzureOpenAI(systemPrompt, userPrompt);
  }

  /**
   * Call Azure OpenAI API (converted from Python)
   */
  async callAzureOpenAI(systemPrompt, userPrompt) {
    // Build Azure OpenAI endpoint URL
    // Format: {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={api-version}
    const url = `${this.azureEndpoint}/openai/deployments/${this.azureDeployment}/chat/completions?api-version=${this.azureApiVersion}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.azureApiKey  // Azure uses 'api-key' header, not 'Authorization'
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_completion_tokens: 1000,  // Azure uses max_completion_tokens instead of max_tokens
        temperature: 0.3,
        top_p: 1.0,
        frequency_penalty: 0.0,
        presence_penalty: 0.0,
        response_format: { type: 'json_object' }  // Force JSON output
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Azure OpenAI API error: ${response.status} - ${errorBody}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    try {
      return JSON.parse(content);
    } catch (error) {
      core.warning(`Failed to parse AI response as JSON: ${content}`);
      throw new Error('AI response was not valid JSON');
    }
  }
}

