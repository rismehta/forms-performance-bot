import * as core from '@actions/core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { GitHelper } from '../utils/git-helper.js';

/**
 * AI-Powered Auto-Fix Generator
 * Generates GitHub PR suggestions for automatically fixable performance issues
 */
export class AIAutoFixAnalyzer {
  constructor(config = null) {
    this.config = config;
    
    // Azure OpenAI Configuration (Custom Codex Endpoint)
    this.azureApiKey = process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY; // Support both
    this.azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT || 'https://forms-azure-openai-stg-eastus2.openai.azure.com/openai/responses';
    this.azureModel = process.env.AZURE_OPENAI_MODEL || 'gpt-5.1-codex';
    this.azureApiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview';
    this.aiEnabled = !!this.azureApiKey; // Enable if API key is present
    
    this.workspaceRoot = process.cwd();
    
    if (this.aiEnabled) {
      core.info(` AI Auto-Fix enabled with model: ${this.azureModel}`);
    } else {
      core.info(' AI Auto-Fix disabled (no API key found)');
    }
  }

  /**
   * Generate refactored code for a specific issue using AI
   */
  generateRefactoredCode = async (issue, issueType) => {
    if (!this.aiEnabled) {
      return this.getDefaultRefactoredCode(issue, issueType);
    }

    try {
      // Extract function code and enhanced context
      const functionCode = this.extractFunctionCode(issue);
      const enhancedContext = this.buildEnhancedContext(issue);
      
      const userPrompt = issueType === 'http' 
        ? this.buildHTTPRefactorPrompt(issue, functionCode, enhancedContext)
        : this.buildDOMRefactorPrompt(issue, functionCode, enhancedContext);

      const systemPrompt = `You are a senior AEM Forms developer performing a surgical refactoring. Your ONLY job is to extract ${issueType === 'http' ? 'HTTP calls' : 'DOM manipulation'} from custom functions.

ABSOLUTE RULES (WILL BE REJECTED IF NOT FOLLOWED):
1. NEVER change function parameters - keep exact signature
2. NEVER remove existing logic - keep all validation, sorting, calculations
3. NEVER change variable names - use exact same names
4. NEVER change return types or values
5. ONLY extract the ${issueType === 'http' ? 'HTTP call (fetch/axios/request)' : 'DOM manipulation (document.*, .style.*, .innerHTML)'} to ${issueType === 'http' ? 'event dispatcher' : 'setProperty()'}
6. PRESERVE all comments, formatting, and code structure

YOU ARE NOT:
- Redesigning the function
- Improving the code
- Changing the architecture
- Adding new features

YOU ARE ONLY:
- ${issueType === 'http' ? 'Extracting HTTP calls to events' : 'Converting DOM manipulation to setProperty()'}
- Keeping EVERYTHING else EXACTLY the same

VALIDATION CHECKLIST (your response MUST pass this):
✓ Same number of parameters as original
✓ Same parameter names as original
✓ All validation logic preserved
✓ All data processing preserved  
✓ All setProperty/globals.functions calls preserved
✓ Only ${issueType === 'http' ? 'fetch/axios/request replaced with dispatchEvent' : 'DOM calls replaced with setProperty'}

Respond ONLY with valid JSON:
{
  "jsCode": "refactored JavaScript with SAME signature and logic",
  "formJsonSnippet": "form JSON event configuration${issueType === 'dom' ? ' (if applicable)' : ''}",
  "componentExample": "${issueType === 'dom' ? 'custom component code (if complex UI needed)' : ''}",
  "testingSteps": "testing instructions"
}`;

      // Call Azure OpenAI with custom Codex endpoint
      const parsed = await this.callAzureOpenAI(systemPrompt, userPrompt);
      
      if (parsed && parsed.jsCode && typeof parsed.jsCode === 'string' && parsed.jsCode.trim().length > 0) {
        
      // CRITICAL: Validate AI output before accepting it
      const validation = this.validateAIRefactoring(functionCode, parsed.jsCode, issue.functionName, issueType);
      if (!validation.valid) {
        core.warning(`AI refactoring rejected for ${issue.functionName} (${validation.rulesChecked} rules checked):`);
        validation.errors.forEach(err => core.warning(`  - ${err}`));
        core.warning('Falling back to safe comment-only approach');
        return this.getDefaultRefactoredCode(issue, issueType);
      }
      
      core.info(`AI refactoring validated for ${issue.functionName} (${validation.rulesChecked} rules passed)`);
      
      return {
        jsCode: parsed.jsCode,
        formJsonSnippet: parsed.formJsonSnippet || null,
        componentExample: parsed.componentExample || null,
        testingSteps: parsed.testingSteps || 'Test in browser after applying changes'
      };
    } else {
      core.warning(`AI response missing jsCode for ${issue.functionName}`);
      return this.getDefaultRefactoredCode(issue, issueType);
    }
    } catch (error) {
      core.warning(`AI refactoring failed for ${issue.functionName}: ${error.message}`);
      return this.getDefaultRefactoredCode(issue, issueType);
    }
  }

  /**
   * GENERIC validation framework for AI-generated refactoring
   * Extensible for any fix type - just add validation rules
   * Returns {valid: boolean, errors: string[]}
   */
  validateAIRefactoring = (originalCode, refactoredCode, functionName, issueType = 'http') => {
    // Defensive check: ensure both codes are strings
    if (!originalCode || typeof originalCode !== 'string') {
      return { 
        valid: false, 
        rulesChecked: 0, 
        errors: ['Original code is missing or not a string'] 
      };
    }
    if (!refactoredCode || typeof refactoredCode !== 'string') {
      return { 
        valid: false, 
        rulesChecked: 0, 
        errors: ['Refactored code is missing or not a string'] 
      };
    }
    
    // Define validation rules for each issue type
    const validationRules = {
      // Common rules that apply to ALL refactorings
      common: [
        {
          name: 'Signature preservation',
          check: (orig, refac, fname) => {
            const origSig = orig.match(new RegExp(`function\\s+${fname}\\s*\\(([^)]*)\\)`));
            const refacSig = refac.match(new RegExp(`function\\s+${fname}\\s*\\(([^)]*)\\)`));
            
            if (!origSig) return { valid: false, error: 'Could not parse original signature' };
            if (!refacSig) return { valid: false, error: 'Refactored code missing function' };
            
            // Handle case where capturing group is undefined (empty params)
            const origParams = (origSig[1] || '').split(',').map(p => p.trim()).filter(Boolean);
            const refacParams = (refacSig[1] || '').split(',').map(p => p.trim()).filter(Boolean);
            
            if (origParams.length !== refacParams.length) {
              return { valid: false, error: `Parameter count: ${origParams.length} → ${refacParams.length}` };
            }
            
            // Check parameter names match
            const origNames = origParams.map(p => p.split('=')[0].trim());
            const refacNames = refacParams.map(p => p.split('=')[0].trim());
            
            for (const name of origNames) {
              if (!refacNames.includes(name)) {
                return { valid: false, error: `Parameter "${name}" removed/renamed` };
              }
            }
            
            return { valid: true };
          }
        },
        {
          name: 'Code length sanity',
          check: (orig, refac) => {
            const origLines = (orig || '').split('\n').filter(l => l.trim()).length;
            const refacLines = (refac || '').split('\n').filter(l => l.trim()).length;
            
            // Refactored should be within 50-150% of original (not drastically shorter/longer)
            if (refacLines < origLines * 0.5) {
              return { valid: false, error: `Too short: ${origLines} → ${refacLines} lines (removed logic?)` };
            }
            if (refacLines > origLines * 1.5) {
              return { valid: false, error: `Too long: ${origLines} → ${refacLines} lines (added unnecessary code?)` };
            }
            
            return { valid: true };
          }
        },
        {
          name: 'Critical calls preserved',
          check: (orig, refac) => {
            // Preserve setProperty, setVariable, any globals.functions.* calls
            const criticalPatterns = ['.setProperty(', '.setVariable(', '.getProperty('];
            
            for (const pattern of criticalPatterns) {
              const origHas = orig.includes(pattern);
              const refacHas = refac.includes(pattern);
              
              if (origHas && !refacHas) {
                return { valid: false, error: `Removed critical call: ${pattern}` };
              }
            }
            
            return { valid: true };
          }
        }
      ],
      
      // Rules specific to HTTP refactoring
      http: [
        {
          name: 'Event dispatcher added',
          check: (orig, refac) => {
            if (!refac.includes('dispatchEvent')) {
              return { valid: false, error: 'Missing dispatchEvent - HTTP not extracted' };
            }
            return { valid: true };
          }
        },
        {
          name: 'HTTP calls removed',
          check: (orig, refac) => {
            const httpPatterns = ['fetch(', 'axios(', '$.ajax(', 'XMLHttpRequest'];
            
            for (const pattern of httpPatterns) {
              if (refac.includes(pattern)) {
                return { valid: false, error: `Still contains ${pattern} - not extracted` };
              }
            }
            return { valid: true };
          }
        }
      ],
      
      // Rules specific to DOM refactoring
      dom: [
        {
          name: 'setProperty added',
          check: (orig, refac) => {
            if (!refac.includes('.setProperty(')) {
              return { valid: false, error: 'Missing setProperty - DOM not converted' };
            }
            return { valid: true };
          }
        },
        {
          name: 'DOM calls removed',
          check: (orig, refac) => {
            const domPatterns = ['document.querySelector', 'document.getElementById', 
                               '.innerHTML', '.style.', 'createElement'];
            
            for (const pattern of domPatterns) {
              if (refac.includes(pattern)) {
                return { valid: false, error: `Still contains ${pattern} - not converted` };
              }
            }
            return { valid: true };
          }
        }
      ]
    };
    
    // Run validation
    const errors = [];
    const rules = [
      ...validationRules.common,
      ...(validationRules[issueType] || [])
    ];
    
    try {
      for (const rule of rules) {
        const result = rule.check(originalCode, refactoredCode, functionName);
        if (!result.valid) {
          errors.push(`[${rule.name}] ${result.error}`);
        }
      }
    } catch (error) {
      errors.push(`Validation exception: ${error.message}`);
    }
    
    return {
      valid: errors.length === 0,
      errors,
      rulesChecked: rules.length
    };
  }

  /**
   * Extract function code from file
   */
  extractFunctionCode = (issue) => {
    try {
      const filePath = resolve(this.workspaceRoot, issue.file);
      if (!existsSync(filePath)) {
        return `function ${issue.functionName}() { /* code not available */ }`;
      }

      const content = readFileSync(filePath, 'utf-8');
      if (!content || typeof content !== 'string') {
        return `function ${issue.functionName}() { /* file read error */ }`;
      }
      const lines = content.split('\n');
      
      // Find function definition
      const functionPattern = new RegExp(`(export\\s+)?(async\\s+)?function\\s+${issue.functionName}\\s*\\(|const\\s+${issue.functionName}\\s*=|${issue.functionName}\\s*:\\s*(async\\s+)?function`);
      const startIndex = lines.findIndex(line => functionPattern.test(line));
      
      if (startIndex === -1) {
        return `function ${issue.functionName}() { /* definition not found */ }`;
      }

      // Extract function body (simple brace matching)
      let braceCount = 0;
      let endIndex = startIndex;
      let started = false;
      
      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        for (const char of line) {
          if (char === '{') {
            braceCount++;
            started = true;
          }
          if (char === '}') braceCount--;
        }
        
        if (started && braceCount === 0) {
          endIndex = i;
          break;
        }
      }

      return lines.slice(startIndex, endIndex + 1).join('\n');
    } catch (error) {
      return `function ${issue.functionName}() { /* extraction failed */ }`;
    }
  }

  /**
   * Build minimal essential context for AI refactoring
   * Keeps only what's necessary for acceptable results
   */
  buildEnhancedContext = (issue) => {
    const context = {
      relatedFunctions: [],
      relatedFunctionCode: [],  // NEW: Full function implementations
      imports: [],
      callSites: [],
      fullFileContent: '',  // NEW: Entire file for Codex
      moduleType: 'ESM',
      utilityFunctions: []  // NEW: Helper functions like encrypt, externalize
    };

    try {
      const filePath = resolve(this.workspaceRoot, issue.file);
      if (!existsSync(filePath)) {
        return context;
      }

      const content = readFileSync(filePath, 'utf-8');
      context.fullFileContent = content;  // Codex can handle full file!
      
      // Extract ALL imports (Codex has enough tokens)
      const importMatches = content.match(/^import .+ from .+$/gm) || [];
      const requireMatches = content.match(/const .+ = require\(.+\)/g) || [];
      context.imports = [...importMatches, ...requireMatches];
      
      // Extract ALL function names and their implementations
      const functionMatches = content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/g);
      for (const match of functionMatches) {
        const fname = match[1];
        if (fname && fname !== issue.functionName) {
          context.relatedFunctions.push(fname);
          
          // Extract full function body for top 10 functions
          if (context.relatedFunctionCode.length < 10) {
            const funcStart = match.index;
            const funcCode = this.extractFunctionFromIndex(content, funcStart);
            if (funcCode && funcCode.length < 500) {  // Only include small helpers
              context.relatedFunctionCode.push({
                name: fname,
                code: funcCode
              });
            }
          }
        }
      }
      
      // Identify common AEM utility functions used in the file
      const aemUtils = ['encrypt', 'decrypt', 'externalize', 'request', 'setProperty', 
                       'getProperty', 'setVariable', 'getVariable', 'dispatchEvent'];
      context.utilityFunctions = aemUtils.filter(util => content.includes(util));
      
      // Module type
      context.moduleType = content.includes('export') ? 'ESM' : 'CommonJS';
      
      // Find ALL call sites (Codex can handle more)
      const callPattern = new RegExp(`${issue.functionName}\\s*\\([^)]*\\)`, 'g');
      const calls = content.match(callPattern) || [];
      context.callSites = calls.map(call => call.trim());
      
      // Extract surrounding context (functions that call this function)
      const callers = this.findCallingFunctions(content, issue.functionName);
      context.callingFunctions = callers.slice(0, 3);
      
    } catch (error) {
      core.info(`Could not build context: ${error.message}`);
    }

    return context;
  }

  /**
   * Extract function code from a specific index
   */
  extractFunctionFromIndex = (content, startIndex) => {
    try {
      const lines = content.substring(startIndex).split('\n');
      let braceCount = 0;
      let started = false;
      let result = [];
      
      for (let i = 0; i < lines.length && i < 50; i++) {  // Max 50 lines
        const line = lines[i];
        result.push(line);
        
        for (const char of line) {
          if (char === '{') {
            braceCount++;
            started = true;
          }
          if (char === '}') braceCount--;
        }
        
        if (started && braceCount === 0) {
          return result.join('\n');
        }
      }
      
      return result.join('\n');
    } catch (error) {
      return '';
    }
  }

  /**
   * Find functions that call the target function
   */
  findCallingFunctions = (content, targetFunction) => {
    const callers = [];
    const functionMatches = content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*\}/gs);
    
    for (const match of functionMatches) {
      const funcName = match[1];
      const funcBody = match[0];
      
      if (funcBody.includes(`${targetFunction}(`)) {
        callers.push({
          name: funcName,
          callSite: funcBody.match(new RegExp(`${targetFunction}\\s*\\([^)]*\\)`))?.[0]
        });
      }
    }
    
    return callers;
  }

  /**
   * Build prompt for HTTP refactoring
   */
  buildHTTPRefactorPrompt = (issue, functionCode, enhancedContext) => {
    const contextSection = enhancedContext ? `

**FULL CONTEXT (You have access to everything):**

**File:** ${issue.file}
**Module Type:** ${enhancedContext.moduleType}

**Available Imports:**
${enhancedContext.imports?.length ? enhancedContext.imports.join('\n') : 'None'}

**AEM Utility Functions Available:**
${enhancedContext.utilityFunctions?.length ? enhancedContext.utilityFunctions.join(', ') : 'None'}

**How This Function Is Called (${enhancedContext.callSites?.length || 0} call sites):**
${enhancedContext.callSites?.length ? enhancedContext.callSites.slice(0, 5).join('\n') : 'No call sites found'}

**Related Helper Functions You Can Use:**
${enhancedContext.relatedFunctionCode?.length ? enhancedContext.relatedFunctionCode.map(f => `
Function: ${f.name}()
\`\`\`javascript
${f.code}
\`\`\`
`).join('\n') : 'No helper functions'}

**Functions That Call This One:**
${enhancedContext.callingFunctions?.length ? enhancedContext.callingFunctions.map(c => `- ${c.name}() calls as: ${c.callSite}`).join('\n') : 'None'}

**All Functions in This File:**
${enhancedContext.relatedFunctions?.length ? enhancedContext.relatedFunctions.join(', ') : 'None'}
` : '';

    return `Refactor this AEM Forms custom function that makes direct HTTP requests.

**CRITICAL RULES - MUST FOLLOW:**
1. **PRESERVE EXACT FUNCTION SIGNATURE** - Do NOT change parameters, parameter names, or order
2. **PRESERVE ALL EXISTING LOGIC** - Keep all sorting, validation, data processing
3. **ONLY REMOVE HTTP CALLS** - Extract fetch/axios/request calls to form events
4. **KEEP ALL OTHER CODE** - Keep all setProperty, calculations, array operations, etc.
5. **USE EXISTING HELPERS** - Reuse helper functions already defined in the file
6. **MATCH CODING STYLE** - Follow the same patterns as other functions in this file

**Target Function to Refactor:**
\`\`\`javascript
${functionCode}
\`\`\`
${contextSection}

${enhancedContext?.fullFileContent && enhancedContext.fullFileContent.length < 10000 ? `
**COMPLETE FILE FOR REFERENCE (so you can see all patterns and helpers):**
\`\`\`javascript
${enhancedContext.fullFileContent}
\`\`\`
` : ''}

**What to do:**
1. Identify the HTTP call (fetch, axios, request, etc.) in the function
2. Extract ONLY the HTTP call to a custom event handler
3. Keep everything else in the function EXACTLY as-is
4. Add event dispatcher to trigger the HTTP call
5. Use callback pattern for async results

**Example of correct refactoring:**

BEFORE (BAD):
\`\`\`javascript
export function myFunction(data, field1, field2, globals) {
  // Some validation
  if (!data) return;
  
  // HTTP call (PROBLEM)
  const response = await fetch('/api/endpoint', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  
  // Process response
  const result = response.json();
  globals.functions.setProperty(field1, { value: result.value });
}
\`\`\`

AFTER (GOOD):
\`\`\`javascript
export function myFunction(data, field1, field2, globals) {
  // Same validation (PRESERVED)
  if (!data) return;
  
  // Dispatch event instead of direct HTTP call (CHANGED)
  globals.functions.dispatchEvent(globals.form.$form, 'custom:myFunctionFetch', {
    data: data,
    onSuccess: (result) => {
      // Same processing logic (PRESERVED)
      globals.functions.setProperty(field1, { value: result.value });
    }
  });
}
\`\`\`

Form JSON event:
\`\`\`json
{
  "events": {
    "custom:myFunctionFetch": [
      "request(externalize('/api/endpoint'), 'POST', encrypt({body: $event.data}), {onSuccess: $event.onSuccess})"
    ]
  }
}
\`\`\`

**Generate JSON response with:**
- jsCode: Refactored function with SAME signature, SAME logic, ONLY HTTP extracted
- formJsonSnippet: Form JSON event with request() call
- testingSteps: How to test`;
  }

  /**
   * Build prompt for DOM refactoring
   */
  buildDOMRefactorPrompt = (issue, functionCode, enhancedContext) => {
    const contextSection = enhancedContext ? `

**FULL CONTEXT (You have access to everything):**

**File:** ${issue.file}
**Module Type:** ${enhancedContext.moduleType}

**Available Imports:**
${enhancedContext.imports?.length ? enhancedContext.imports.join('\n') : 'None'}

**AEM Utility Functions Available:**
${enhancedContext.utilityFunctions?.length ? enhancedContext.utilityFunctions.join(', ') : 'None'}

**How This Function Is Called (${enhancedContext.callSites?.length || 0} call sites):**
${enhancedContext.callSites?.length ? enhancedContext.callSites.slice(0, 5).join('\n') : 'No call sites found'}

**Related Helper Functions You Can Use:**
${enhancedContext.relatedFunctionCode?.length ? enhancedContext.relatedFunctionCode.map(f => `
Function: ${f.name}()
\`\`\`javascript
${f.code}
\`\`\`
`).join('\n') : 'No helper functions'}

**Functions That Call This One:**
${enhancedContext.callingFunctions?.length ? enhancedContext.callingFunctions.map(c => `- ${c.name}() calls as: ${c.callSite}`).join('\n') : 'None'}
` : '';

    return `Refactor this AEM Forms custom function that directly manipulates DOM.

**CRITICAL RULES - MUST FOLLOW:**
1. **PRESERVE EXACT FUNCTION SIGNATURE** - Do NOT change parameters, parameter names, or order
2. **PRESERVE ALL EXISTING LOGIC** - Keep all validation, calculations, data processing
3. **ONLY REMOVE DOM MANIPULATION** - Replace document.querySelector, .innerHTML, .style, etc.
4. **USE setProperty() INSTEAD** - Use globals.functions.setProperty() for state changes
5. **KEEP ALL OTHER CODE** - Keep all other logic, variables, returns EXACTLY as-is
6. **USE EXISTING HELPERS** - Reuse helper functions already defined in the file
7. **MATCH CODING STYLE** - Follow the same patterns as other functions in this file

**Target Function to Refactor:**
\`\`\`javascript
${functionCode}
\`\`\`
${contextSection}

${enhancedContext?.fullFileContent && enhancedContext.fullFileContent.length < 10000 ? `
**COMPLETE FILE FOR REFERENCE (so you can see all patterns and helpers):**
\`\`\`javascript
${enhancedContext.fullFileContent}
\`\`\`
` : ''}

**What to do:**
1. Identify DOM manipulation (document.*, element.innerHTML, .style.*, etc.)
2. Replace with globals.functions.setProperty() to update field properties
3. Keep everything else EXACTLY the same
4. Preserve all parameters, logic, validation

**Example of correct refactoring:**

BEFORE (BAD):
\`\`\`javascript
export function myDOMFunction(value, targetField, globals) {
  // Validation
  if (!value) return;
  
  // DOM manipulation (PROBLEM)
  const element = document.querySelector('#field');
  element.style.color = 'red';
  element.innerHTML = value;
}
\`\`\`

AFTER (GOOD):
\`\`\`javascript
export function myDOMFunction(value, targetField, globals) {
  // Same validation (PRESERVED)
  if (!value) return;
  
  // Use setProperty instead of DOM (CHANGED)
  globals.functions.setProperty(targetField, { 
    value: value,
    visible: true
  });
}
\`\`\`

**Generate JSON response with:**
- jsCode: Refactored function with SAME signature, SAME logic, ONLY DOM → setProperty
- componentExample: Custom component code (if complex UI needed)
- testingSteps: How to test`;
  }

  /**
   * Get default refactored code (fallback)
   */
  getDefaultRefactoredCode = (issue, issueType) => {
    if (issueType === 'http') {
      return {
        jsCode: `export function ${issue.functionName}(field, globals) {
  // Refactored: Trigger form-level request via custom event
  globals.functions.dispatchEvent(field, 'custom:${issue.functionName}Data', {
    // Pass any required data
    value: field.$value
  });
}`,
        formJsonSnippet: `"events": {
  "custom:${issue.functionName}Data": [
    "request(externalize('/api/endpoint'), 'POST', encrypt({data: $event.detail.value}))"
  ]
}`,
        testingSteps: '1. Apply JS changes\n2. Add form JSON event\n3. Test in browser\n4. Verify Network tab shows request'
      };
    } else {
      return {
        jsCode: `export function ${issue.functionName}(field, globals) {
  // Refactored: Use setProperty instead of DOM manipulation
  globals.functions.setProperty(field, {
    visible: true,
    // Add other property changes as needed
  });
}`,
        componentExample: '// Create custom component if complex UI changes needed',
        testingSteps: '1. Apply JS changes\n2. Test in browser\n3. Verify field updates correctly'
      };
    }
  }

  /**
   * Analyze all results and generate auto-fix suggestions
   * @param {Object} results - All analyzer results
   * @returns {Promise<Array>} Array of fix suggestions
   */
  analyze = async (results) => {
    if (!this.azureApiKey) {
      core.info('AI Auto-Fix skipped: No Azure OpenAI API key configured (set AZURE_API_KEY or AZURE_OPENAI_API_KEY)');
      return {
        enabled: false,
        reason: 'No Azure OpenAI API key configured',
        suggestions: []
      };
    }

    core.info(' Starting AI Auto-Fix Analysis...');
    core.info(`Azure OpenAI Endpoint: ${this.azureEndpoint}`);
    core.info(`Azure OpenAI Model: ${this.azureModel}`);
    
    const fixableSuggestions = [];
    
    // 1. CSS @import → <link> tags (CRITICAL)
    try {
      core.info('Generating CSS @import fixes...');
      const importFixes = await this.fixCSSImports(results.formCSS);
      core.info(`CSS @import fixes generated: ${importFixes.length}`);
      fixableSuggestions.push(...importFixes);
    } catch (error) {
      core.warning(`Failed to generate CSS @import fixes: ${error.message}`);
    }
    
    // 2. CSS background-image → <img> component (CRITICAL)
    try {
      core.info('Generating CSS background-image fixes...');
      const backgroundImageFixes = await this.fixCSSBackgroundImages(results.formCSS);
      core.info(`CSS background-image fixes generated: ${backgroundImageFixes.length}`);
      fixableSuggestions.push(...backgroundImageFixes);
    } catch (error) {
      core.warning(`Failed to generate CSS background-image fixes: ${error.message}`);
    }
    
    // 3. Blocking scripts → defer (CRITICAL)
    try {
      core.info('Generating blocking scripts fixes...');
      const scriptFixes = await this.fixBlockingScripts(results.formHTML);
      core.info(`Blocking scripts fixes generated: ${scriptFixes.length}`);
      fixableSuggestions.push(...scriptFixes);
    } catch (error) {
      core.warning(`Failed to generate blocking scripts fixes: ${error.message}`);
    }
    
    // 4. Remove unnecessary hidden fields (HIGH)
    try {
      core.info('Generating hidden fields fixes...');
      const hiddenFieldFixes = await this.fixUnnecessaryHiddenFields(results.hiddenFields);
      core.info(`Hidden fields fixes generated: ${hiddenFieldFixes.length}`);
      fixableSuggestions.push(...hiddenFieldFixes);
    } catch (error) {
      core.warning(`Failed to generate hidden fields fixes: ${error.message}`);
    }
    
    // 5. API calls in initialize → custom events (CRITICAL but complex)
    try {
      core.info('Generating API call in initialize fixes...');
      const initializeFixes = await this.fixAPICallsInInitialize(results.formEvents);
      core.info(`API call fixes generated: ${initializeFixes.length}`);
      fixableSuggestions.push(...initializeFixes);
    } catch (error) {
      core.warning(`Failed to generate API call fixes: ${error.message}`);
    }
    
    // 6. Custom functions with HTTP requests or DOM access (CRITICAL)
    try {
      core.info('Generating custom function fixes...');
      const customFunctionFixes = await this.fixCustomFunctions(results.customFunctions);
      core.info(`Custom function fixes generated: ${customFunctionFixes.length}`);
      fixableSuggestions.push(...customFunctionFixes);
    } catch (error) {
      core.warning(`Failed to generate custom function fixes: ${error.message}`);
    }
    
    core.info(` AI Auto-Fix completed: ${fixableSuggestions.length} suggestion(s) generated`);
    
    return {
      enabled: true,
      provider: 'azure-openai',
      suggestions: fixableSuggestions
    };
  }

  /**
   * Create auto-fix PR with trivial fixes applied
   * @param {Array} suggestions - AI-generated suggestions
   * @param {Object} octokit - GitHub API client
   * @param {String} owner - Repository owner
   * @param {String} repo - Repository name
   * @param {String} baseBranch - User's feature branch (PR head branch)
   * @param {Number} prNumber - Original PR number
   * @returns {Promise<Object|null>} Created PR details or null if no fixes applied
   */
  createAutoFixPR = async (suggestions, octokit, owner, repo, baseBranch, prNumber) => {
    if (!suggestions || suggestions.length === 0) {
      core.info('No suggestions to apply - skipping auto-fix PR');
      return null;
    }

    // SAFETY: Never create auto-fix PRs targeting main/master branches
    const protectedBranches = ['main', 'master'];
    if (protectedBranches.includes(baseBranch.toLowerCase())) {
      core.warning(` Skipping auto-fix PR: Cannot target protected branch '${baseBranch}'`);
      core.warning('   Auto-fix PRs can only target feature branches, not main/master');
      core.warning('   AI suggestions will still be shown in PR comment for manual review');
      return null;
    }

    // Filter for trivial, auto-fixable issues (CSS + JS annotations)
    const trivialFixes = suggestions.filter(s => 
      s.type === 'css-import-fix' || 
      s.type === 'css-background-image-fix' ||
      s.type === 'custom-function-http-fix' ||
      s.type === 'custom-function-dom-fix'
    );

    if (trivialFixes.length === 0) {
      core.info('No trivial fixes available - skipping auto-fix PR');
      return null;
    }

    try {
      core.info(`🔧 Creating auto-fix PR with ${trivialFixes.length} fix(es)...`);

      const git = new GitHelper(this.workspaceRoot);
      
      // Configure git user for commits
      git.configureGitUser();

      // Save current branch to restore later
      const originalBranch = git.getCurrentBranch();
      const originalSHA = git.getCurrentSHA();
      
      // Create new branch for fixes
      const fixBranchName = `perf-bot/auto-fixes-pr-${prNumber}`;
      core.info(`Creating fix branch: ${fixBranchName}`);
      
      // Delete local branch if it exists
      try {
        git.exec(`git branch -D ${fixBranchName}`);
        core.info(`  Deleted existing local branch: ${fixBranchName}`);
      } catch (error) {
        // Branch doesn't exist locally, that's fine
      }
      
      // Check if branch exists on remote
      const remoteBranchExists = git.remoteBranchExists(fixBranchName);
      
      if (remoteBranchExists) {
        core.info(`  Remote branch exists - will force push to update existing PR`);
      }
      
      git.createBranch(fixBranchName);

      // Apply fixes to files
      const filesChanged = [];
      
      for (const fix of trivialFixes) {
        try {
          const result = await this.applyFixToFile(fix);
          if (result.success) {
            git.stageFile(result.filePath);
            filesChanged.push(result);
            core.info(` Applied fix to ${result.filePath}`);
          }
        } catch (error) {
          core.warning(`Failed to apply fix to ${fix.file}: ${error.message}`);
        }
      }

      if (filesChanged.length === 0) {
        core.warning('No fixes were successfully applied - aborting auto-fix PR');
        // Try to restore original branch (skip if detached HEAD in GitHub Actions)
        try {
          if (originalBranch && originalBranch !== 'HEAD') {
            git.checkoutBranch(originalBranch);
          }
        } catch (e) {
          core.info(`Could not restore branch (GitHub Actions isolated environment): ${e.message}`);
        }
        return null;
      }

      // Create commit with AI attribution
      const hasAIRefactoring = filesChanged.some(f => f.description.includes('AI-generated'));
      
      const commitMessage = `fix(perf): ${hasAIRefactoring ? '  AI-GENERATED ' : ''}Auto-fix ${filesChanged.length} performance issue(s)

${hasAIRefactoring ? '  WARNING: This commit contains AI-generated code refactoring\n  REQUIRED: Thorough testing and code review before merging\n  AI Model: Azure OpenAI GPT-4.1\n\n' : ''}Performance fixes for PR #${prNumber}:
${filesChanged.map((f, i) => `${i + 1}. ${f.description}`).join('\n')}

Impact:
${filesChanged.map(f => `- ${f.impact}`).join('\n')}

${hasAIRefactoring ? '\n REVIEW CHECKLIST:\n- [ ] Test all affected functions\n- [ ] Verify form behavior unchanged\n- [ ] Check error handling\n- [ ] Validate performance improvement\n\n' : ''}Auto-generated by AEM Forms Performance Analyzer`;

      git.commit(commitMessage);

      // Push to remote
      git.push(fixBranchName, true);

      // Restore original branch (skip if detached HEAD in GitHub Actions)
      try {
        if (originalBranch && originalBranch !== 'HEAD') {
          git.checkoutBranch(originalBranch);
        }
      } catch (e) {
        core.info(`Could not restore branch (GitHub Actions isolated environment): ${e.message}`);
      }

      // Check if PR already exists for this branch
      let createdPR;
      try {
        const { data: existingPRs } = await octokit.rest.pulls.list({
          owner,
          repo,
          head: `${owner}:${fixBranchName}`,
          base: baseBranch,
          state: 'open'
        });

        if (existingPRs.length > 0) {
          // PR already exists - update it
          createdPR = existingPRs[0];
          core.info(`  Auto-fix PR already exists: #${createdPR.number} - force push updated it`);
          
          // Update PR body with latest fixes
          const prBody = this.generateAutoFixPRDescription(filesChanged, prNumber, baseBranch, true);
          await octokit.rest.pulls.update({
            owner,
            repo,
            pull_number: createdPR.number,
            body: prBody
          });
          
          core.info(`  Updated PR description with latest changes`);
        } else {
          // Create new PR
          core.info(`Creating new PR: ${fixBranchName} → ${baseBranch}`);
          
          const prBody = this.generateAutoFixPRDescription(filesChanged, prNumber, baseBranch, false);
          
          const hasAIRefactoring = filesChanged.some(f => f.description.includes('AI-generated'));
          const title = hasAIRefactoring 
            ? `  AI-GENERATED: Performance fixes for PR #${prNumber}` 
            : ` Performance fixes for PR #${prNumber}`;
          
          const { data: newPR } = await octokit.rest.pulls.create({
            owner,
            repo,
            title,
            head: fixBranchName,
            base: baseBranch,  // Target user's feature branch
            body: prBody
          });
          
          createdPR = newPR;
          core.info(` Auto-fix PR created: #${createdPR.number}`);
        }
      } catch (error) {
        core.warning(`Failed to create/update PR: ${error.message}`);
        throw error;
      }

      return {
        number: createdPR.number,
        url: createdPR.html_url,
        branch: fixBranchName,
        filesChanged: filesChanged.length,
        fixes: filesChanged.map(f => f.description)
      };

    } catch (error) {
      core.warning(`Failed to create auto-fix PR: ${error.message}`);
      core.warning(error.stack);
      
      // Try to restore original branch (skip if detached HEAD in GitHub Actions)
      try {
        const git = new GitHelper(this.workspaceRoot);
        const currentBranch = git.getCurrentBranch();
        if (currentBranch && currentBranch !== 'HEAD' && currentBranch !== baseBranch) {
          git.checkoutBranch(baseBranch);
        }
      } catch (restoreError) {
        core.info(`Could not restore branch (GitHub Actions isolated environment): ${restoreError.message}`);
      }
      
      return null;
    }
  }

  /**
   * Apply a single fix to a file
   */
  applyFixToFile = async (fix) => {
    const filePath = resolve(this.workspaceRoot, fix.file);
    
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    let content = readFileSync(filePath, 'utf-8');
    let description = '';
    let impact = '';

    // Apply fix based on type
    if (fix.type === 'css-import-fix') {
      // Comment out @import statement
      const originalLine = fix.originalCode;
      const commentedLine = `/* ${originalLine} */\n/* Performance: Bundle CSS during build instead - see Performance Bot PR comment */`;
      
      content = content.replace(originalLine, commentedLine);
      description = `Comment out @import in ${fix.file}`;
      impact = 'Eliminates render-blocking CSS import';
      
    } else if (fix.type === 'css-background-image-fix') {
      // Comment out background-image line
      const lines = content.split('\n');
      const lineIndex = fix.line - 1;
      
      if (lines[lineIndex] && lines[lineIndex].includes('background-image')) {
        lines[lineIndex] = `  /* ${lines[lineIndex].trim()} */`;
        lines.splice(lineIndex + 1, 0, '  /* Performance: Replace with <img loading="lazy"> in HTML - see Performance Bot PR comment */');
        content = lines.join('\n');
        description = `Comment out background-image in ${fix.file}`;
        impact = 'Enables lazy loading when replaced with <img>';
      }
      
    } else if (fix.type === 'custom-function-http-fix') {
      // Apply AI-generated refactored code for HTTP requests
      const lines = content.split('\n');
      const functionName = fix.functionName || 'unknown';
      
      // Find the function definition
      const functionPattern = new RegExp(`(export\\s+)?(async\\s+)?function\\s+${functionName}\\s*\\(|const\\s+${functionName}\\s*=|${functionName}\\s*:\\s*(async\\s+)?function`);
      const functionLineIndex = lines.findIndex(line => functionPattern.test(line));
      
      if (functionLineIndex !== -1) {
        // Find the end of the function (closing brace)
        let braceCount = 0;
        let inFunction = false;
        let functionEndIndex = functionLineIndex;
        
        for (let i = functionLineIndex; i < lines.length; i++) {
          const line = lines[i];
          for (const char of line) {
            if (char === '{') {
              braceCount++;
              inFunction = true;
            } else if (char === '}') {
              braceCount--;
              if (inFunction && braceCount === 0) {
                functionEndIndex = i;
                break;
              }
            }
          }
          if (inFunction && braceCount === 0) break;
        }
        
        // Add AI-generated code with clear attribution
        const indent = lines[functionLineIndex].match(/^(\s*)/)[1];
        const aiHeader = [
          `${indent}// ============================================================`,
          `${indent}//   AI-GENERATED REFACTORING (Azure OpenAI GPT-4.1)`,
          `${indent}// Original: Direct HTTP call in custom function`,
          `${indent}// Refactored: Trigger via custom event for better performance`,
          `${indent}// REVIEW REQUIRED: Test thoroughly before merging`,
          `${indent}// ============================================================`,
          ''
        ];
        
        // Replace function with AI-generated code
        if (fix.refactoredCode) {
          lines.splice(functionLineIndex, functionEndIndex - functionLineIndex + 1, ...aiHeader, fix.refactoredCode);
          content = lines.join('\n');
          description = `Refactor ${functionName}() to use form-level request() (AI-generated)`;
          impact = 'Eliminates blocking HTTP calls, enables request queueing and error handling';
        } else {
          // Fallback: add warning comment if no AI code available
          const warningComment = [
            `${indent}//  PERFORMANCE WARNING: This function makes HTTP requests`,
            `${indent}// ISSUE: Direct HTTP calls block form interactions`,
            `${indent}// FIX: Move to form-level request() via custom events`,
          ];
          lines.splice(functionLineIndex, 0, ...warningComment);
          content = lines.join('\n');
          description = `Annotate ${functionName}() with HTTP request warning`;
          impact = 'Flags blocking HTTP calls for manual refactoring';
        }
      } else {
        throw new Error(`Could not find function definition for ${functionName}`);
      }
      
    } else if (fix.type === 'custom-function-dom-fix') {
      // Apply AI-generated refactored code for DOM access
      const lines = content.split('\n');
      const functionName = fix.functionName || 'unknown';
      
      // Find the function definition
      const functionPattern = new RegExp(`(export\\s+)?(async\\s+)?function\\s+${functionName}\\s*\\(|const\\s+${functionName}\\s*=|${functionName}\\s*:\\s*(async\\s+)?function`);
      const functionLineIndex = lines.findIndex(line => functionPattern.test(line));
      
      if (functionLineIndex !== -1) {
        // Find the end of the function (closing brace)
        let braceCount = 0;
        let inFunction = false;
        let functionEndIndex = functionLineIndex;
        
        for (let i = functionLineIndex; i < lines.length; i++) {
          const line = lines[i];
          for (const char of line) {
            if (char === '{') {
              braceCount++;
              inFunction = true;
            } else if (char === '}') {
              braceCount--;
              if (inFunction && braceCount === 0) {
                functionEndIndex = i;
                break;
              }
            }
          }
          if (inFunction && braceCount === 0) break;
        }
        
        // Add AI-generated code with clear attribution
        const indent = lines[functionLineIndex].match(/^(\s*)/)[1];
        const aiHeader = [
          `${indent}// ============================================================`,
          `${indent}//   AI-GENERATED REFACTORING (Azure OpenAI GPT-4.1)`,
          `${indent}// Original: Direct DOM manipulation in custom function`,
          `${indent}// Refactored: Use setProperty() for state management`,
          `${indent}// REVIEW REQUIRED: Test thoroughly before merging`,
          `${indent}// ============================================================`,
          ''
        ];
        
        // Replace function with AI-generated code
        if (fix.refactoredCode) {
          lines.splice(functionLineIndex, functionEndIndex - functionLineIndex + 1, ...aiHeader, fix.refactoredCode);
          content = lines.join('\n');
          description = `Refactor ${functionName}() to use setProperty() instead of DOM (AI-generated)`;
          impact = 'Eliminates direct DOM access, uses form state management';
        } else {
          // Fallback: add warning comment if no AI code available
          const warningComment = [
            `${indent}//  PERFORMANCE WARNING: This function accesses DOM directly`,
            `${indent}// ISSUE: Bypasses form state management`,
            `${indent}// FIX: Use setProperty() instead of direct DOM manipulation`,
          ];
          lines.splice(functionLineIndex, 0, ...warningComment);
          content = lines.join('\n');
          description = `Annotate ${functionName}() with DOM access warning`;
          impact = 'Flags direct DOM manipulation for manual refactoring';
        }
      } else {
        throw new Error(`Could not find function definition for ${functionName}`);
      }
    }

    // Write updated content
    writeFileSync(filePath, content, 'utf-8');

    return {
      success: true,
      filePath: fix.file,
      description,
      impact,
      originalCode: fix.originalCode,
      fixedCode: fix.fixedCode
    };
  }

  /**
   * Generate PR description for auto-fix PR
   */
  generateAutoFixPRDescription = (filesChanged, originalPRNumber, targetBranch, isUpdate = false) => {
    const lines = [];
    
    const hasAIRefactoring = filesChanged.some(f => f.description.includes('AI-generated'));
    
    if (hasAIRefactoring) {
      lines.push('##   AI-GENERATED CODE - REVIEW REQUIRED\n');
      lines.push('> **WARNING:** This PR contains AI-generated code refactoring using Azure OpenAI GPT-4.1');
      lines.push('> **REQUIRED:** Thorough testing and code review before merging');
      lines.push('> **DO NOT** merge blindly - AI-generated code may have bugs or incorrect assumptions\n');
    } else {
      lines.push('##  Automated Performance Fixes\n');
    }
    
    lines.push(`This PR contains automated performance fixes for **PR #${originalPRNumber}**.\n`);
    lines.push(`**Target Branch:** \`${targetBranch}\` (your feature branch)\n`);
    
    if (isUpdate) {
      lines.push(`**Status:**  *Updated by bot on re-run*\n`);
    }
    
    lines.push('---\n');
    
    if (hasAIRefactoring) {
      lines.push('###  Testing Required\n');
      lines.push('Before merging, verify:');
      lines.push('- [ ] **Unit tests pass** for all modified functions');
      lines.push('- [ ] **Form behavior** unchanged (no regressions)');
      lines.push('- [ ] **Error handling** works correctly');
      lines.push('- [ ] **Performance** actually improved (measure!)');
      lines.push('- [ ] **Form JSON events** added (if applicable)');
      lines.push('- [ ] **Manual testing** in browser completed\n');
      lines.push('---\n');
    }
    
    lines.push('### Fixes Applied\n');
    filesChanged.forEach((change, i) => {
      const isAI = change.description.includes('AI-generated');
      lines.push(`${i + 1}. ${isAI ? '  **[AI]** ' : ''}**${change.description}**`);
      lines.push(`   - Impact: ${change.impact}`);
      lines.push(`   - File: \`${change.filePath}\``);
      if (isAI) {
        lines.push(`   - **WARNING:** AI-generated refactoring - test thoroughly`);
      }
      lines.push('');
    });
    
    lines.push('### How to Use\n');
    
    if (hasAIRefactoring) {
      lines.push('  **IMPORTANT: For AI-generated refactoring**\n');
      lines.push('1. **Review the code changes carefully** in "Files changed" tab');
      lines.push('2. **Test the functions** in your local environment');
      lines.push('3. **Add form JSON events** if needed (check PR comment for snippets)');
      lines.push('4. **Run your test suite** to catch regressions');
      lines.push('5. **Manual browser testing** to verify behavior');
      lines.push('6. Only merge after all tests pass\n');
    }
    
    lines.push('**Option 1: Merge via GitHub UI (Recommended)**');
    lines.push('1. Complete testing checklist above');
    lines.push('2. Review changes in "Files changed" tab');
    lines.push('3. Click "Merge pull request" to apply fixes');
    lines.push('4. Your original PR will include these fixes\n');
    
    lines.push('**Option 2: Merge via command line**');
    lines.push('```bash');
    lines.push(`git checkout ${targetBranch}`);
    lines.push(`git merge perf-bot/auto-fixes-pr-${originalPRNumber}`);
    lines.push('# Run tests here!');
    lines.push('git push');
    lines.push('```\n');
    
    lines.push('### Notes\n');
    if (hasAIRefactoring) {
      lines.push('- **AI Model:** Azure OpenAI GPT-4.1');
      lines.push('- **AI Context:** Project patterns, related files, full codebase');
      lines.push('- **Human Review:** REQUIRED before merge');
      lines.push('- **Original code:** Replaced (check git diff)');
    } else {
      lines.push('- **Safe changes:** Comments and annotations only');
      lines.push('- **Original code:** Preserved');
    }
    lines.push('- Full implementation guidance in main PR comment');
    lines.push('- Close this PR if fixes not needed\n');
    
    lines.push('---');
    lines.push('*Auto-generated by [AEM Forms Performance Analyzer](https://github.com/rismehta/forms-performance-bot)*');
    
    return lines.join('\n');
  }

  /**
   * Fix CSS @import statements
   * Replace with <link> tags in HTML or bundle recommendation
   */
  fixCSSImports = async (cssResults) => {
    if (!cssResults || !cssResults.newIssues) return [];
    
    const importIssues = cssResults.newIssues.filter(i => i.type === 'css-import-blocking');
    if (importIssues.length === 0) return [];
    
    const suggestions = [];
    
    for (const issue of importIssues) {
      try {
        const filePath = resolve(this.workspaceRoot, issue.file);
        const fileContent = readFileSync(filePath, 'utf-8');
        
        // PHASE 1 ENHANCEMENT: Send full file + related files for better context
        const enhancedContext = this.buildCSSEnhancedContext(issue.file, fileContent);
        
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
  fixCSSBackgroundImages = async (cssResults) => {
    if (!cssResults || !cssResults.newIssues) return [];
    
    const bgImageIssues = cssResults.newIssues.filter(i => i.type === 'css-background-image');
    if (bgImageIssues.length === 0) return [];
    
    const suggestions = [];
    
    for (const issue of bgImageIssues.slice(0, 3)) { // Limit to top 3
      try {
        const filePath = resolve(this.workspaceRoot, issue.file);
        const fileContent = readFileSync(filePath, 'utf-8');
        
        // PHASE 1 ENHANCEMENT: Send full file + related files
        const enhancedContext = this.buildCSSEnhancedContext(issue.file, fileContent);
        
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
  fixBlockingScripts = async (htmlResults) => {
    if (!htmlResults || !htmlResults.newIssues) return [];
    
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
  fixUnnecessaryHiddenFields = async (hiddenFieldsResults) => {
    // Extract unnecessary hidden fields from issues
    if (!hiddenFieldsResults || !hiddenFieldsResults.after || !hiddenFieldsResults.after.issues) return [];
    
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
//  BAD: Using hidden field for state storage (creates DOM element)
// Field in JSON: { "name": "${top5Fields[0]}", "visible": false }
// Accessing: $form.${top5Paths[0]}.$value

//  GOOD: Use setVariable (no DOM element created)
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

 **Use hidden fields for:**
- Conditional UI elements (shown via rules/events based on user input)
- Progressive disclosure (wizard steps, conditional sections)
- Dynamic form structure changes

 **Don't use hidden fields for:**
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
  fixCustomFunctions = async (customFunctionsResults) => {
    if (!customFunctionsResults || !customFunctionsResults.newIssues) return [];
    
    const suggestions = [];
    
    // HTTP requests in custom functions
    const httpIssues = customFunctionsResults.newIssues.filter(
      issue => issue.type === 'http-request-in-custom-function'
    );
    
    for (const issue of httpIssues.slice(0, 3)) { // Top 3
      // Generate AI-powered refactored code
      const refactoredCode = await this.generateRefactoredCode(issue, 'http');
      
      suggestions.push({
        type: 'custom-function-http-fix',
        severity: 'critical',
        function: issue.functionName,
        functionName: issue.functionName, // For applyFixToFile()
        file: issue.file,
        line: issue.line || 1,
        title: `Move HTTP request from ${issue.functionName}() to form-level API call`,
        description: `Custom function "${issue.functionName}()" makes direct HTTP requests. This bypasses error handling, loading states, and retry logic.`,
        refactoredCode: refactoredCode.jsCode,
        formJsonSnippet: refactoredCode.formJsonSnippet,
        testingSteps: refactoredCode.testingSteps,
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
      // Generate AI-powered refactored code
      const refactoredCode = await this.generateRefactoredCode(issue, 'dom');
      
      suggestions.push({
        type: 'custom-function-dom-fix',
        severity: 'critical',
        function: issue.functionName,
        functionName: issue.functionName, // For applyFixToFile()
        file: issue.file,
        line: issue.line || 1,
        title: `Replace DOM access in ${issue.functionName}() with custom component`,
        description: `Custom function "${issue.functionName}()" directly manipulates DOM. This breaks AEM Forms architecture and causes maintenance issues.`,
        refactoredCode: refactoredCode.jsCode,
        componentExample: refactoredCode.componentExample,
        testingSteps: refactoredCode.testingSteps,
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
-  Components are self-contained and reusable
-  Proper lifecycle management
-  Works with form validation/rules
-  Easier to test and maintain
-  Follows AEM Forms architecture

**Anti-pattern risks:**
-  DOM changes bypass form's state management
-  Breaks rules/validation that depend on field
-  Hard to debug when things break
-  Doesn't work with form serialization
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
  fixAPICallsInInitialize = async (formEventsResults) => {
    if (!formEventsResults || !formEventsResults.newIssues || !formEventsResults.newIssues.length) return [];
    
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
    "${issue.expression ? issue.expression.substring(0, 60) : 'API call'}..."
  ]
}
\`\`\`

**Recommended Fix:**
\`\`\`json
"events": {
  "custom:formViewInitialized": [
    "${issue.expression ? issue.expression.substring(0, 60) : 'API call'}..."
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
   * Build enhanced context for CSS fixes with full file + related files + patterns
   * PHASE 1 ENHANCEMENT: Much richer context for better suggestions
   */
  buildCSSEnhancedContext = (targetFile, fileContent) => {
    // Defensive check for fileContent
    if (!fileContent || typeof fileContent !== 'string') {
      return { targetFile, fullContent: '', relatedFiles: {}, projectPatterns: {}, fileStats: { lines: 0, size: '0KB' } };
    }
    
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
  generateImportFix = async (issue, enhancedContext, fullFileContent) => {
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
  generateBackgroundImageFix = async (issue, enhancedContext, fullFileContent) => {
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
   callAI = async (userPrompt, taskName) => {
    const systemPrompt = `You are an expert web performance engineer specializing in AEM Forms.
Generate ONLY valid JSON responses. Be concise and actionable.
Focus on performance impact and Core Web Vitals (FCP, LCP, TBT, INP).`;

    return await this.callAzureOpenAI(systemPrompt, userPrompt);
  }

  /**
   * Call Azure OpenAI API (converted from Python)
   */
  callAzureOpenAI = async (systemPrompt, userPrompt) => {
    // Build Azure OpenAI Custom Codex endpoint URL
    // Format: {endpoint}?api-version={api-version}
    const url = `${this.azureEndpoint}?api-version=${this.azureApiVersion}`;
    
    core.info(` Calling Azure OpenAI: ${this.azureModel}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.azureApiKey}`  // Custom endpoint uses Bearer auth
      },
      body: JSON.stringify({
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_output_tokens: 16384,
        model: this.azureModel  // Only parameters from your curl example
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      core.warning(`Azure OpenAI API error: ${response.status} - ${errorBody}`);
      throw new Error(`Azure OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Responses API returns output as an array with message objects
    // Structure: { output: [{ type: "reasoning" }, { type: "message", content: [{ text: "..." }] }] }
    let content = null;
    
    if (data.output && Array.isArray(data.output)) {
      // Find the message object in the output array
      const messageObj = data.output.find(item => item.type === 'message');
      if (messageObj && messageObj.content && Array.isArray(messageObj.content)) {
        // Extract text from first content item
        const textObj = messageObj.content.find(c => c.type === 'output_text');
        content = textObj?.text;
      }
    }
    
    // Fallback to other formats (Chat Completions API)
    if (!content) {
      content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text;
    }
    
    // Defensive check: ensure content is a string
    if (!content) {
      core.warning(`No content in API response. Keys: ${Object.keys(data).join(', ')}`);
      throw new Error('AI response contained no content');
    }
    
    if (typeof content !== 'string') {
      core.warning(`Content is not a string (type: ${typeof content}). Value: ${JSON.stringify(content).substring(0, 200)}`);
      throw new Error('AI response content is not a string');
    }
    
    core.info(` AI response received (${content.length} chars)`);
    
    // Strip markdown code blocks if present (```json ... ``` or ``` ... ```)
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```')) {
      // Remove opening ```json or ```
      cleanContent = cleanContent.replace(/^```(?:json)?\s*\n?/, '');
      // Remove closing ```
      cleanContent = cleanContent.replace(/\n?```\s*$/, '');
      cleanContent = cleanContent.trim();
      core.info(` Stripped markdown code blocks from AI response`);
    }
    
    try {
      return JSON.parse(cleanContent);
    } catch (error) {
      core.warning(`Failed to parse AI response as JSON: ${cleanContent.substring(0, 200)}...`);
      throw new Error('AI response was not valid JSON');
    }
  }
}

