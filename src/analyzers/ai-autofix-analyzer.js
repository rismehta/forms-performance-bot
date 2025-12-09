import * as core from '@actions/core';
import { readFileSync, existsSync } from 'fs';
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
      core.info('Generating CSS @import fixes...');
      const importFixes = await this.fixCSSImports(results.formCSS);
      core.info(`CSS @import fixes generated: ${importFixes.length}`);
      fixableSuggestions.push(...importFixes);
      
      // 2. CSS background-image → <img> component (CRITICAL)
      core.info('Generating CSS background-image fixes...');
      const backgroundImageFixes = await this.fixCSSBackgroundImages(results.formCSS);
      core.info(`CSS background-image fixes generated: ${backgroundImageFixes.length}`);
      fixableSuggestions.push(...backgroundImageFixes);
      
      // 3. Blocking scripts → defer (CRITICAL)
      core.info('Generating blocking scripts fixes...');
      const scriptFixes = await this.fixBlockingScripts(results.formHTML);
      core.info(`Blocking scripts fixes generated: ${scriptFixes.length}`);
      fixableSuggestions.push(...scriptFixes);
      
      // 4. Remove unnecessary hidden fields (HIGH)
      core.info('Generating hidden fields fixes...');
      const hiddenFieldFixes = await this.fixUnnecessaryHiddenFields(results.hiddenFields);
      core.info(`Hidden fields fixes generated: ${hiddenFieldFixes.length}`);
      fixableSuggestions.push(...hiddenFieldFixes);
      
      // 5. API calls in initialize → custom events (CRITICAL but complex)
      core.info('Generating API call in initialize fixes...');
      const initializeFixes = await this.fixAPICallsInInitialize(results.formEvents);
      core.info(`API call fixes generated: ${initializeFixes.length}`);
      fixableSuggestions.push(...initializeFixes);
      
      // 6. Custom functions with HTTP requests or DOM access (CRITICAL)
      core.info('Generating custom function fixes...');
      const customFunctionFixes = await this.fixCustomFunctions(results.customFunctions);
      core.info(`Custom function fixes generated: ${customFunctionFixes.length}`);
      fixableSuggestions.push(...customFunctionFixes);
      
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
        
        // PHASE 1 ENHANCEMENT: Send full file + related files for better context
        const enhancedContext = this.buildEnhancedContext(issue.file, fileContent);
        
        // Generate fix using AI with enhanced context
        const fix = await this.generateImportFix(issue, enhancedContext, fileContent);
        
        if (fix) {
          suggestions.push({
            type: 'css-import-fix',
            severity: 'critical',
            file: issue.file,
            line: issue.line,
            title: `Replace @import with bundled CSS`,
            description: `CSS @import blocks rendering. ${fix.explanation}`,
            originalCode: fix.originalCode || `@import url('${issue.importUrl}');`,
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
        
        // PHASE 1 ENHANCEMENT: Send full file + related files
        const enhancedContext = this.buildEnhancedContext(issue.file, fileContent);
        
        const fix = await this.generateBackgroundImageFix(issue, enhancedContext, fileContent);
        
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
   * Suggest removal or conversion to form variables, or proper visibility controls
   */
  async fixUnnecessaryHiddenFields(hiddenFieldsResults) {
    // Extract unnecessary hidden fields from issues
    if (!hiddenFieldsResults?.after?.issues) return [];
    
    const unnecessaryFieldIssues = hiddenFieldsResults.after.issues.filter(
      issue => issue.type === 'unnecessary-hidden-field'
    );
    
    if (unnecessaryFieldIssues.length === 0) return [];
    
    const suggestions = [];
    
    // Extract field names and paths from issues
    const fieldNames = unnecessaryFieldIssues.map(issue => issue.field);
    const top5Fields = fieldNames.slice(0, 5);
    const top5Paths = unnecessaryFieldIssues.slice(0, 5).map(issue => issue.path);
    
    suggestions.push({
      type: 'hidden-fields-fix',
      severity: 'high',
      title: `Replace ${fieldNames.length} hidden field(s) used for state storage with setVariable`,
      description: `These fields are never made visible and are likely used for data storage. They create ${fieldNames.length} unnecessary DOM elements. Use setVariable() instead for zero-DOM state management.`,
      fieldsToRemove: top5Fields,
      guidance: `
**Option 1: Remove from form JSON** (If field is completely unused)
1. Remove field definitions from form JSON
2. Remove any references in rules/validations

**Option 2: Use \`setVariable\` for state storage** (Recommended for data storage)

Hidden fields are commonly misused for storing state. Use \`setVariable\` instead:

\`\`\`javascript
// ❌ BAD: Using hidden field for state storage (creates DOM element)
// Field in JSON: { "name": "${top5Fields[0]}", "visible": false }
// Accessing: $form.${top5Paths[0]}.$value

// ✅ GOOD: Use setVariable (no DOM element created)
// Store state:
setVariable('${top5Fields[0]}', value, $form)

// Retrieve state:
getVariable('${top5Fields[0]}', $form)
\`\`\`

**Example: Replace hidden field with setVariable**

**Before (creates DOM):**
\`\`\`javascript
// Form JSON has hidden field:
{
  "name": "${top5Fields[0]}",
  "fieldType": "text-input",
  "visible": false
}

// Setting value in custom function:
$form.${top5Paths[0]}.$value = "some data";

// Reading value:
const data = $form.${top5Paths[0]}.$value;
\`\`\`

**After (no DOM):**
\`\`\`javascript
// Remove field from form JSON entirely

// Setting value in Rule Editor:
"events": {
  "change": [
    "setVariable('${top5Fields[0]}', 'some data', $form)"
  ]
}

// Setting value in custom function (functions.js):
export function storeData(key, value, globals) {
  const target = globals.form;
  const existingProperties = target.$properties || {};
  const updatedProperties = { 
    ...existingProperties, 
    [key]: value 
  };
  globals.functions.setProperty(target, { 
    properties: updatedProperties 
  });
}
// Usage: storeData('${top5Fields[0]}', someValue, $)

// Reading value in Rule Editor:
const data = getVariable('${top5Fields[0]}', $form);

// Reading value in visible/enable expressions:
"visible": "getVariable('${top5Fields[0]}', $form) !== null"
\`\`\`

**Option 3: Keep as hidden field ONLY if conditionally visible**

Only keep the hidden field if it will be shown based on user input:

\`\`\`javascript
// In form JSON - field definition:
{
  "name": "${top5Fields[0]}",
  "visible": false,
  "events": {
    "custom:showField": [
      "setProperty(${top5Paths[0]}, {visible: true})"
    ]
  }
}

// Trigger visibility from another field:
"events": {
  "change": [
    "dispatch(${top5Paths[0]}, 'custom:showField')"
  ]
}

// Or use condition-based visibility:
"visible": "someOtherField.$value === 'showIt'"
\`\`\`

**Fields to review:**
${top5Fields.map((f, i) => `- \`${f}\` (path: \`${top5Paths[i]}\`)`).join('\n')}
${fieldNames.length > 5 ? `\n...and ${fieldNames.length - 5} more` : ''}

**Best Practices for AEM Adaptive Forms:**

✅ **Use hidden fields for:**
- Conditional UI elements (shown via rules/events based on user input)
- Progressive disclosure (wizard steps, conditional sections)
- Dynamic form structure changes

❌ **Don't use hidden fields for:**
- Pure data storage (use \`setVariable\` instead)
- Session/temporary data (use form properties via \`setProperty\`)
- Static data that never becomes visible

**Why it matters:**
- Hidden fields create DOM elements (impact: INP, TBT)
- Each hidden field adds ~2-5ms to interaction latency
- ${fieldNames.length} unnecessary fields = ~${Math.min(fieldNames.length * 3, 100)}ms slower interactions

**AEM Forms APIs:**
- \`setProperty(target, {visible: true})\` - Show/hide fields
- \`setVariable(name, value, $form)\` - Store data without DOM
- \`getVariable(name, $form)\` - Retrieve stored data
`,
      estimatedImpact: `Reduces DOM by ${fieldNames.length} nodes, improves INP by ~${Math.min(fieldNames.length * 2, 50)}ms`
    });
    
    return suggestions;
  }

  /**
   * Fix custom functions with HTTP requests or DOM access
   * Suggest using form APIs instead of direct HTTP/DOM manipulation
   */
  async fixCustomFunctions(customFunctionsResults) {
    if (!customFunctionsResults?.newIssues) return [];
    
    const suggestions = [];
    
    // HTTP requests in custom functions
    const httpIssues = customFunctionsResults.newIssues.filter(
      issue => issue.type === 'http-request-in-custom-function'
    );
    
    for (const issue of httpIssues.slice(0, 3)) { // Top 3
      suggestions.push({
        type: 'custom-function-http-fix',
        severity: 'critical',
        function: issue.functionName,
        file: issue.file,
        title: `Move HTTP request from ${issue.functionName}() to form-level API call`,
        description: `Custom function "${issue.functionName}()" makes direct HTTP requests. This bypasses error handling, loading states, and retry logic.`,
        guidance: `
**Current (ANTI-PATTERN):**
\`\`\`javascript
// In ${issue.file}:
export function ${issue.functionName}(...args) {
  // Direct HTTP call in custom function
  const response = await fetch(...);  // or axios(), etc.
  return response;
}
\`\`\`

**Recommended Fix: Use Form-Level Request API**

**Option A: Move to event support via Visual Rule Editor (Recommended)**
\`\`\`javascript
// In form JSON - field events (set via Visual Rule Editor):
"events": {
  "change": [
    "request(externalize('/api/endpoint'), 'POST', {data: $field.$value})"
  ]
}
\`\`\`

**How to set in Visual Rule Editor:**
1. Select field in form editor
2. Add Rule → When "Value Changes"
3. Then "Invoke Service" → Configure request()
4. Service returns data and updates form automatically

**Option B: Trigger via custom event (For complex logic)**
\`\`\`javascript
// In form JSON - define custom event with request():
"events": {
  "custom:fetchData": [
    "request(externalize('/api/endpoint'), 'POST', encrypt({data: $field.$value}))"
  ]
}

// In custom function - trigger the event instead of calling request():
export function ${issue.functionName}(field, globals) {
  // Validate/transform data first
  const processedData = transformData(field.$value);
  
  // Trigger form's request handler (don't call request() directly)
  field.dispatch(new CustomEvent('custom:fetchData', { 
    detail: processedData 
  }));
}
\`\`\`

**Why form-level request() is better:**
- Handles loading states automatically (spinner shown to user)
- Built-in retry logic
- Proper encryption via encrypt() helper
- Better debugging and monitoring

**Anti-pattern risks (direct HTTP in custom functions):**
- No retry on network failure
- Breaks form's request queue (race conditions)
- Security: Bypasses encrypt() wrapper
`,
        estimatedImpact: 'Improves error handling, adds loading states, enables request queueing'
      });
    }
    
    // DOM access in custom functions
    const domIssues = customFunctionsResults.newIssues.filter(
      issue => issue.type === 'dom-access-in-custom-function'
    );
    
    for (const issue of domIssues.slice(0, 2)) { // Top 2
      suggestions.push({
        type: 'custom-function-dom-fix',
        severity: 'critical',
        function: issue.functionName,
        file: issue.file,
        title: `Replace DOM access in ${issue.functionName}() with custom component`,
        description: `Custom function "${issue.functionName}()" directly manipulates DOM. This breaks AEM Forms architecture and causes maintenance issues.`,
        guidance: `
**Current (ANTI-PATTERN):**
\`\`\`javascript
// In ${issue.file}:
export function ${issue.functionName}(...args) {
  // Direct DOM manipulation
  document.querySelector('.field').style.color = 'red';
  // or
  const element = document.getElementById('someId');
  element.innerHTML = 'Updated';
}
\`\`\`

**Recommended Fix: Create Custom Component**

**Step 1: Create custom component**
\`\`\`javascript
// In blocks/form/components/${issue.functionName}/
class CustomFieldComponent extends HTMLElement {
  connectedCallback() {
    this.render();
  }
  
  render() {
    this.innerHTML = \`
      <div class="custom-field">
        <!-- Your custom UI here -->
      </div>
    \`;
  }
  
  updateState(newState) {
    // Component manages its own DOM
    this.querySelector('.custom-field').textContent = newState;
  }
}

customElements.define('custom-field-${issue.functionName}', CustomFieldComponent);
\`\`\`

**Step 2: Use component in form**
\`\`\`javascript
// In form JSON - use custom fieldType:
{
  "fieldType": "custom-field-${issue.functionName}",
  "name": "myCustomField"
}
\`\`\`

**Step 3: Interact via setProperty (not DOM)**
\`\`\`javascript
// In custom function - use AEM Forms APIs:
export function ${issue.functionName}(field, newState, globals) {
  // Update via setProperty (not DOM)
  globals.functions.setProperty(field, { 
    value: newState 
  });
  
  // Component automatically re-renders
}
\`\`\`

**Why this matters:**
- ✅ Components are self-contained and reusable
- ✅ Proper lifecycle management
- ✅ Works with form validation/rules
- ✅ Easier to test and maintain
- ✅ Follows AEM Forms architecture

**Anti-pattern risks:**
- ❌ DOM changes bypass form's state management
- ❌ Breaks rules/validation that depend on field
- ❌ Hard to debug when things break
- ❌ Doesn't work with form serialization
`,
        estimatedImpact: 'Improves maintainability, enables proper state management, reduces bugs'
      });
    }
    
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
   * Build enhanced context for AI with full file + related files + patterns
   * PHASE 1 ENHANCEMENT: Much richer context for better suggestions
   */
  buildEnhancedContext(targetFile, fileContent) {
    const context = {
      targetFile,
      fullContent: fileContent,
      relatedFiles: {},
      projectPatterns: {},
      fileStats: {
        lines: fileContent.split('\n').length,
        size: `${(fileContent.length / 1024).toFixed(1)}KB`
      }
    };

    try {
      // Find related files (same base name, different extensions)
      const baseName = targetFile.replace(/\.[^.]+$/, ''); // Remove extension
      const extensions = ['.js', '.html', '.json', '.css'];
      
      for (const ext of extensions) {
        const relatedPath = baseName + ext;
        try {
          const fullPath = resolve(this.workspaceRoot, relatedPath);
          if (existsSync(fullPath)) {
            const content = readFileSync(fullPath, 'utf-8');
            // Limit related files to reasonable size
            if (content.length < 50000) { // 50KB limit
              context.relatedFiles[relatedPath] = content;
            }
          }
        } catch (err) {
          // Skip files we can't read
        }
      }

      // Detect project patterns (simplified for now)
      context.projectPatterns = {
        hasRollupConfig: existsSync(resolve(this.workspaceRoot, 'rollup.config.js')),
        hasWebpackConfig: existsSync(resolve(this.workspaceRoot, 'webpack.config.js')),
        packageManager: existsSync(resolve(this.workspaceRoot, 'package.json')) ? 'npm/yarn' : 'unknown'
      };
    } catch (error) {
      core.warning(`Could not build enhanced context: ${error.message}`);
    }

    return context;
  }

  /**
   * Generate @import fix using AI with enhanced context
   */
  async generateImportFix(issue, enhancedContext, fullFileContent) {
    const relatedFilesInfo = Object.keys(enhancedContext.relatedFiles).length > 0
      ? `\n\nRelated files found: ${Object.keys(enhancedContext.relatedFiles).join(', ')}`
      : '';

    const buildToolInfo = enhancedContext.projectPatterns.hasRollupConfig
      ? '\nNote: Project uses Rollup - can bundle CSS during build'
      : enhancedContext.projectPatterns.hasWebpackConfig
      ? '\nNote: Project uses Webpack - can bundle CSS during build'
      : '';

    const prompt = `Fix this CSS @import that blocks rendering.

**File:** ${issue.file}
**Line:** ${issue.line}
**Import URL:** ${issue.importUrl}
**File Size:** ${enhancedContext.fileStats.size} (${enhancedContext.fileStats.lines} lines)${relatedFilesInfo}${buildToolInfo}

**Full CSS File:**
\`\`\`css
${fullFileContent}
\`\`\`

**Task:** Provide practical fix as JSON:
{
  "originalCode": "The @import line to replace",
  "fixedCode": "Replacement code or comment with clear instructions",
  "alternativeFix": "Alternative approach (bundling vs <link> tag)",
  "explanation": "Why this fix improves FCP/LCP (1 sentence)"
}

**Requirements:**
- If bundler detected, suggest bundling during build
- Otherwise, suggest <link> tag in HTML
- Keep explanation concise and performance-focused`;

    try {
      const response = await this.callAI(prompt, 'Fix CSS @import');
      return response;
    } catch (error) {
      core.warning(`AI call failed for import fix: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate background-image fix using AI with enhanced context
   */
  async generateBackgroundImageFix(issue, enhancedContext, fullFileContent) {
    const relatedFilesInfo = Object.keys(enhancedContext.relatedFiles).length > 0
      ? `\n\nRelated files available:\n${Object.keys(enhancedContext.relatedFiles).map(f => `- ${f}`).join('\n')}`
      : '';

    // Include related HTML/JS if available for better component suggestions
    const relatedHTML = enhancedContext.relatedFiles[issue.file.replace('.css', '.html')] || '';
    const relatedJS = enhancedContext.relatedFiles[issue.file.replace('.css', '.js')] || '';

    const prompt = `Replace this CSS background-image with a lazy-loaded Image component.

**File:** ${issue.file}
**Line:** ${issue.line}
**Image URL:** ${issue.image}
**File Size:** ${enhancedContext.fileStats.size} (${enhancedContext.fileStats.lines} lines)${relatedFilesInfo}

**Full CSS File:**
\`\`\`css
${fullFileContent}
\`\`\`

${relatedHTML ? `**Related HTML (${issue.file.replace('.css', '.html')}):**
\`\`\`html
${relatedHTML.substring(0, 2000)}${relatedHTML.length > 2000 ? '\n... (truncated)' : ''}
\`\`\`\n` : ''}

**Task:** Provide practical fix as JSON:
{
  "originalCode": "The CSS background-image rule to replace/remove",
  "fixedCode": "Updated CSS (remove bg-image, keep other styles)",
  "htmlSuggestion": "Complete <img> tag with loading='lazy', width, height",
  "explanation": "Why this improves LCP and enables lazy loading (1 sentence)"
}

**Requirements:**
- Use loading="lazy" for off-screen images
- Include width/height attributes to prevent CLS
- Maintain visual appearance with CSS (object-fit, positioning)
- Consider responsive images if applicable`;

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

