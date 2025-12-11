import * as core from '@actions/core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename, relative, dirname } from 'path';
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
      
      // Skip if extraction failed
      if (!functionCode) {
        core.warning(`Skipping ${issue.functionName}() - could not extract function code`);
        return this.getDefaultRefactoredCode(issue, issueType);
      }
      
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
   * Validate component refactoring (for CSS background-image fixes)
   * Ensures AI preserved all critical code and only added <img> tag
   */
  validateComponentRefactoring = (originalCode, refactoredCode) => {
    const errors = [];
    
    try {
      // 1. Length sanity check - should not drastically shrink
      if (refactoredCode.length < originalCode.length * 0.7) {
        errors.push(`Code too short: ${originalCode.length} → ${refactoredCode.length} chars (likely removed code)`);
      }
      
      // 2. Preserve export statements
      const origExports = (originalCode.match(/export\s+(default\s+)?function|export\s+{/g) || []).length;
      const refacExports = (refactoredCode.match(/export\s+(default\s+)?function|export\s+{/g) || []).length;
      if (refacExports < origExports) {
        errors.push(`Exports removed: ${origExports} → ${refacExports} (missing export statements)`);
      }
      
      // 3. Preserve function declarations (especially "decorate" method)
      const origFunctions = originalCode.match(/function\s+\w+/g) || [];
      const refacFunctions = refactoredCode.match(/function\s+\w+/g) || [];
      if (refacFunctions.length < origFunctions.length) {
        errors.push(`Functions removed: ${origFunctions.length} → ${refacFunctions.length}`);
      }
      
      // Check for critical function names (decorate, init, etc.)
      const criticalFunctions = ['decorate', 'init', 'setup', 'render'];
      for (const fnName of criticalFunctions) {
        if (originalCode.includes(`function ${fnName}`) && !refactoredCode.includes(`function ${fnName}`)) {
          errors.push(`Critical function removed: ${fnName}()`);
        }
      }
      
      // 4. Check that <img> tag was actually added with proper attributes
      if (!refactoredCode.includes('loading') || !refactoredCode.includes('img')) {
        errors.push('No <img> tag added (expected img element with loading attribute)');
      }
      
      // Check for broken src attribute
      if (refactoredCode.includes("src = 'undefined'") || refactoredCode.includes('src="undefined"')) {
        errors.push("Image src is 'undefined' - must extract actual path from CSS background-image");
      }
      
      // Check for hard-coded small dimensions (likely arbitrary)
      const hardcodedDimensions = refactoredCode.match(/\.(width|height)\s*=\s*\d+/g) || [];
      if (hardcodedDimensions.length > 0) {
        errors.push(`Hard-coded dimensions found: ${hardcodedDimensions.join(', ')} - use 'auto' or extract from CSS`);
      }
      
      // 5. Preserve addEventListener/event listeners
      const origListeners = (originalCode.match(/addEventListener/g) || []).length;
      const refacListeners = (refactoredCode.match(/addEventListener/g) || []).length;
      if (refacListeners < origListeners) {
        errors.push(`Event listeners removed: ${origListeners} → ${refacListeners}`);
      }
      
    } catch (error) {
      errors.push(`Validation error: ${error.message}`);
    }
    
    return {
      valid: errors.length === 0,
      errors,
      rulesChecked: 5
    };
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
          check: (orig, refac, fnName, issueType) => {
            const origLines = (orig || '').split('\n').filter(l => l.trim()).length;
            const refacLines = (refac || '').split('\n').filter(l => l.trim()).length;
            
            // For runtime errors, code SHOULD get longer (adding null checks)
            // Use very lenient thresholds - sometimes a 1-line expression needs multiple checks
            const minRatio = issueType === 'runtime' ? 0.3 : 0.5;
            const maxRatio = issueType === 'runtime' ? 10.0 : 1.5;  // Very lenient for runtime (1 line can become 10 with checks)
            
            if (refacLines < origLines * minRatio) {
              return { valid: false, error: `Too short: ${origLines} → ${refacLines} lines (removed logic?)` };
            }
            if (refacLines > origLines * maxRatio) {
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
      ],
      
      // Rules specific to runtime error fixes
      runtime: [
        {
          name: 'Has defensive checks',
          check: (orig, refac) => {
            // For runtime errors, just check if refactored code has defensive patterns
            // Don't compare with original since it might already have some operators
            const defensivePatterns = [
              /if\s*\([^)]*(!|===?\s*null|===?\s*undefined|typeof)/,  // if with null/undefined checks
              /\?\.(?!\.)$/m,                      // Optional chaining
              /\?\?/,                              // Nullish coalescing  
              /try\s*\{/,                          // Try-catch
              /if\s*\([^)]*!\s*\w+\s*\)/          // if (!variable)
            ];
            
            // Just check if refactored code has ANY defensive pattern
            const hasDefensiveCode = defensivePatterns.some(pattern => pattern.test(refac));
            
            if (!hasDefensiveCode) {
              // Log what we got to help debug
              core.info(`  [Validation Debug] Original code length: ${orig.length}, Refactored: ${refac.length}`);
              core.info(`  [Validation Debug] Refactored code preview: ${refac.substring(0, 200)}...`);
              return { valid: false, error: 'No defensive checks added (expected if/null checks or try-catch)' };
            }
            return { valid: true };
          }
        },
        {
          name: 'No unnecessary checks on guaranteed objects',
          check: (orig, refac) => {
            // Check for unnecessary null checks on AEM runtime guaranteed objects
            const unnecessaryChecks = [
              /if\s*\(\s*!globals\s*\)/,                       // if (!globals)
              /if\s*\(\s*!globals\.functions\s*\)/,           // if (!globals.functions)
              /if\s*\(\s*!globals\.form\s*\)/,                // if (!globals.form)
              /if\s*\([^)]*globals\.functions\s*===?\s*null/, // if (globals.functions === null)
              /if\s*\([^)]*globals\.form\s*===?\s*null/,      // if (globals.form === null)
              /!globals\.functions\.setProperty/,              // !globals.functions.setProperty
              /!globals\.functions\.getProperty/,              // !globals.functions.getProperty
              /!globals\.functions\.setVariable/,              // !globals.functions.setVariable
              /!globals\.functions\.getVariable/,              // !globals.functions.getVariable
            ];
            
            for (const pattern of unnecessaryChecks) {
              if (pattern.test(refac)) {
                return { 
                  valid: false, 
                  error: `Added unnecessary null check for guaranteed object (globals/globals.functions/globals.form are always present in AEM runtime)` 
                };
              }
            }
            return { valid: true };
          }
        },
        {
          name: 'Property access still present',
          check: (orig, refac) => {
            // Should still have the original property accesses (just guarded now)
            const origProps = orig.match(/\.\w+/g) || [];
            const refacProps = refac.match(/\.\w+/g) || [];
            
            // Should have at least 80% of original property accesses
            if (refacProps.length < origProps.length * 0.8) {
              return { valid: false, error: 'Too many property accesses removed - logic may be broken' };
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
        const result = rule.check(originalCode, refactoredCode, functionName, issueType);
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
        core.warning(`File not found for ${issue.functionName}(): ${filePath}`);
        return null; // Signal failure
      }

      const content = readFileSync(filePath, 'utf-8');
      if (!content || typeof content !== 'string') {
        core.warning(`Could not read file for ${issue.functionName}(): ${filePath}`);
        return null; // Signal failure
      }
      const lines = content.split('\n');
      
      // Find function definition - try multiple patterns
      const patterns = [
        new RegExp(`export\\s+(default\\s+)?(async\\s+)?function\\s+${issue.functionName}\\s*\\(`),
        new RegExp(`function\\s+${issue.functionName}\\s*\\(`),
        new RegExp(`const\\s+${issue.functionName}\\s*=\\s*(async\\s+)?\\(`),
        new RegExp(`${issue.functionName}\\s*:\\s*(async\\s+)?function\\s*\\(`),
        new RegExp(`${issue.functionName}\\s*=\\s*(async\\s+)?\\(`),
      ];
      
      let startIndex = -1;
      for (const pattern of patterns) {
        startIndex = lines.findIndex(line => pattern.test(line));
        if (startIndex !== -1) break;
      }
      
      if (startIndex === -1) {
        core.warning(`Function definition not found for ${issue.functionName}() in ${issue.file}`);
        core.info(`  Tried patterns: export function, function, const =, object method, arrow function`);
        return null; // Signal failure
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
      
      if (!started || braceCount !== 0) {
        core.warning(`Could not extract complete function body for ${issue.functionName}()`);
        return null; // Signal failure
      }

      const extracted = lines.slice(startIndex, endIndex + 1).join('\n');
      core.info(`  Extracted ${issue.functionName}(): ${extracted.length} chars`);
      return extracted;
    } catch (error) {
      core.warning(`Extraction failed for ${issue.functionName}(): ${error.message}`);
      return null; // Signal failure
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

**Response Format (JSON ONLY):**
{
  "jsCode": "COMPLETE refactored function with SAME signature, SAME logic, ONLY HTTP call extracted to event dispatcher",
  "formJsonSnippet": "Form JSON event configuration with request() call (for Visual Rule Editor)",
  "testingSteps": "Step-by-step testing instructions"
}

**VALIDATION CHECKLIST:**
✓ Function signature preserved exactly
✓ All parameters in same order
✓ All validation logic preserved
✓ All data processing preserved
✓ Only HTTP call removed (fetch/axios/request)
✓ Event dispatcher added with callback
✓ Form JSON snippet provided`;
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

**Response Format (JSON ONLY):**
{
  "jsCode": "COMPLETE refactored function with SAME signature, SAME logic, ONLY DOM manipulation → setProperty",
  "componentExample": "Custom component code (only if complex UI logic needed beyond setProperty)",
  "testingSteps": "Step-by-step testing instructions"
}

**VALIDATION CHECKLIST:**
✓ Function signature preserved exactly
✓ All parameters in same order
✓ All validation logic preserved
✓ All data processing preserved
✓ Only DOM manipulation removed (document.*, .innerHTML, .style)
✓ setProperty() used instead
✓ Component example provided (if needed)`;
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
    
    // Run all fix generators in PARALLEL for faster execution
    core.info(' Generating all fixes in parallel...');
    const startTime = performance.now();
    
    const fixGenerators = [
      // 1. CSS @import → comments (CRITICAL, no AI needed)
      { name: 'CSS @import fixes', fn: () => this.fixCSSImports(results.formCSS) },
      
      // 2. CSS background-image → <img> component (CRITICAL, AI-powered)
      { name: 'CSS background-image fixes', fn: () => this.fixCSSBackgroundImages(results.formCSS) },
      
      // 3. Blocking scripts → defer (guidance only)
      { name: 'Blocking scripts fixes', fn: () => this.fixBlockingScripts(results.formHTML) },
      
      // 4. Remove unnecessary hidden fields (guidance only)
      { name: 'Hidden fields fixes', fn: () => this.fixUnnecessaryHiddenFields(results.hiddenFields) },
      
      // 5. API calls in initialize → custom events (guidance only)
      { name: 'API call fixes', fn: () => this.fixAPICallsInInitialize(results.formEvents) },
      
      // 6. Custom functions with HTTP/DOM (CRITICAL, AI-powered)
      { name: 'Custom function fixes', fn: () => this.fixCustomFunctions(results.customFunctions) },
      
      // 7. Runtime errors → add null checks (AI-powered)
      { name: 'Runtime error fixes', fn: () => this.fixRuntimeErrors(results.customFunctions) },
      
      // 8. Form validation errors → recommendations (no AI)
      { name: 'Validation recommendations', fn: () => this.generateValidationErrorRecommendations(results.ruleCycles) }
    ];
    
    // Execute all generators in parallel using Promise.allSettled
    // This ensures all fixes are attempted even if one fails
    const settledResults = await Promise.allSettled(
      fixGenerators.map(generator => generator.fn())
    );
    
    // Collect results and log individual outcomes
    settledResults.forEach((result, index) => {
      const generatorName = fixGenerators[index].name;
      
      if (result.status === 'fulfilled') {
        const fixes = result.value || [];
        core.info(`  ${generatorName}: ${fixes.length} generated`);
        fixableSuggestions.push(...fixes);
      } else {
        core.warning(`  ${generatorName}: Failed - ${result.reason?.message || 'Unknown error'}`);
      }
    });
    
    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    core.info(` AI Auto-Fix completed in ${duration}s: ${fixableSuggestions.length} suggestion(s) generated`);
    
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
  /**
   * Apply fixes directly to the current PR branch (no new PR created)
   * Commits changes to the same branch with a bot-identifiable message
   */
  applyFixesToCurrentPR = async (suggestions, octokit, owner, repo, currentBranch) => {
    if (!suggestions || suggestions.length === 0) {
      core.info('No suggestions to apply - skipping auto-fix');
      return null;
    }

    // SAFETY: Never auto-commit to main/master branches
    const protectedBranches = ['main', 'master'];
    if (protectedBranches.includes(currentBranch.toLowerCase())) {
      core.warning(` Skipping auto-fix: Cannot commit to protected branch '${currentBranch}'`);
      core.warning('   Auto-fixes can only be applied to feature branches');
      core.warning('   AI suggestions will still be shown in PR comment for manual review');
      return null;
    }

    // Filter for auto-fixable issues that should be applied to files
    // HTTP/DOM fixes are shown as PR comments only (not applied to files)
    const trivialFixes = suggestions.filter(s => 
      s.type === 'css-import-fix' || 
      s.type === 'css-background-image-fix' ||
      s.type === 'custom-function-runtime-error-fix'
    );
    
    if (trivialFixes.length === 0) {
      core.info('No trivial fixes available - skipping auto-commit');
      return null;
    }

    try {
      core.info(` Applying ${trivialFixes.length} fix(es) to current PR...`);

      const git = new GitHelper(this.workspaceRoot);
      
      // Configure git user for commits
      git.configureGitUser();

      // Apply fixes to files
      const filesChanged = [];
      
      for (const fix of trivialFixes) {
        try {
          // Apply primary file fix (CSS, JS, etc.)
          const result = await this.applyFixToFile(fix);
          if (result.success) {
            git.stageFile(result.filePath);
            filesChanged.push(result);
            core.info(` Applied fix to ${result.filePath}`);
          }
          
          // For background-image fixes, also apply component file refactoring
          if (fix.type === 'css-background-image-fix' && fix.componentFile && fix.fixedComponentCode) {
            try {
              const componentPath = resolve(this.workspaceRoot, fix.componentFile);
              if (existsSync(componentPath)) {
                writeFileSync(componentPath, fix.fixedComponentCode, 'utf-8');
                git.stageFile(componentPath);
                filesChanged.push({
                  success: true,
                  filePath: fix.componentFile,
                  description: `Refactor component to use <img> tag (AI-generated)`,
                  impact: 'Adds lazy-loaded image component'
                });
                core.info(` Applied component refactoring to ${fix.componentFile}`);
              }
            } catch (compError) {
              core.warning(`Failed to apply component fix to ${fix.componentFile}: ${compError.message}`);
            }
          }
        } catch (error) {
          core.warning(`Failed to apply fix to ${fix.file}: ${error.message}`);
        }
      }

      if (filesChanged.length === 0) {
        core.warning('No fixes were successfully applied - aborting auto-commit');
        return null;
      }

      // Create commit with bot-identifiable message prefix (for loop prevention)
      const hasAIRefactoring = filesChanged.some(f => f.description.includes('AI-generated'));
      
      const commitMessage = `[bot] chore: Auto-fix ${filesChanged.length} performance issue(s)

${hasAIRefactoring ? '  WARNING: This commit contains AI-generated code refactoring\n  REQUIRED: Thorough testing and code review before merging\n  AI Model: Azure OpenAI GPT-5.1-codex\n\n' : ''}Performance fixes applied:
${filesChanged.map((f, i) => `${i + 1}. ${f.description}`).join('\n')}

Impact:
${filesChanged.map(f => `- ${f.impact}`).join('\n')}

${hasAIRefactoring ? '\n REVIEW CHECKLIST:\n- [ ] Test all affected functions\n- [ ] Verify form behavior unchanged\n- [ ] Check error handling\n- [ ] Validate performance improvement\n\n' : ''} Auto-generated by AEM Forms Performance Analyzer`;

      git.commit(commitMessage);

      // Pull latest changes from remote before pushing (handle race conditions)
      core.info(` Pulling latest changes from ${currentBranch}...`);
      try {
        git.exec(`git pull --rebase origin ${currentBranch}`);
        core.info(`  Rebased successfully`);
      } catch (pullError) {
        // If pull fails, try force push with lease (safer than --force)
        core.warning(`  Pull failed: ${pullError.message}`);
        core.info(`  Will use --force-with-lease for safe force push`);
      }

      // Push to the same branch (current PR branch)
      core.info(` Pushing changes to ${currentBranch}...`);
      try {
        git.push(currentBranch, false); // Try normal push first
      } catch (pushError) {
        // If normal push fails, use --force-with-lease (safer than --force)
        core.warning(`  Normal push failed, using --force-with-lease`);
        git.exec(`git push origin HEAD:${currentBranch} --force-with-lease`);
      }

      const commitSHA = git.getCurrentSHA();
      
      core.info(` Successfully committed to ${currentBranch} (${commitSHA.substring(0, 7)})`);

      return {
        sha: commitSHA,
        filesChanged: filesChanged.length,
        message: commitMessage.split('\n')[0], // First line only
        files: filesChanged.map(f => f.filePath)
      };

    } catch (error) {
      core.error(`Failed to apply auto-fixes: ${error.message}`);
      core.error(error.stack);
      throw error;
    }
  }

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

    // Filter for auto-fixable issues that should be applied to files
    // HTTP/DOM fixes are shown as PR comments only (not applied to files)
    const trivialFixes = suggestions.filter(s => 
      s.type === 'css-import-fix' || 
      s.type === 'css-background-image-fix' ||
      s.type === 'custom-function-runtime-error-fix'
    );
    
    // HTTP/DOM fixes remain in suggestions for PR comments but not applied to files
    const commentOnlyFixes = suggestions.filter(s =>
      s.type === 'custom-function-http-fix' ||
      s.type === 'custom-function-dom-fix'
    );
    
    if (commentOnlyFixes.length > 0) {
      core.info(`${commentOnlyFixes.length} fix(es) will be shown as PR comments only (not applied to files)`);
    }

    if (trivialFixes.length === 0) {
      core.info('No trivial fixes available - skipping auto-fix PR');
      return null;
    }

    try {
      core.info(` Creating auto-fix PR with ${trivialFixes.length} fix(es)...`);

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
          // Apply primary file fix (CSS, JS, etc.)
          const result = await this.applyFixToFile(fix);
          if (result.success) {
            git.stageFile(result.filePath);
            filesChanged.push(result);
            core.info(` Applied fix to ${result.filePath}`);
          }
          
          // For background-image fixes, also apply component file refactoring
          if (fix.type === 'css-background-image-fix' && fix.componentFile && fix.fixedComponentCode) {
            try {
              const componentPath = resolve(this.workspaceRoot, fix.componentFile);
              if (existsSync(componentPath)) {
                writeFileSync(componentPath, fix.fixedComponentCode, 'utf-8');
                git.stageFile(componentPath);
                filesChanged.push({
                  success: true,
                  filePath: fix.componentFile,
                  description: `Refactor component to use <img> tag (AI-generated)`,
                  impact: 'Adds lazy-loaded image component'
                });
                core.info(` Applied component refactoring to ${fix.componentFile}`);
              }
            } catch (compError) {
              core.warning(`Failed to apply component fix to ${fix.componentFile}: ${compError.message}`);
            }
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
      // Replace @import with inlined CSS content
      const originalLine = fix.originalCode;
      const inlinedCSS = fix.fixedCode;
      
      if (!content.includes(originalLine)) {
        core.warning(`Could not find original @import line in ${fix.file}`);
        core.warning(`  Looking for: ${originalLine}`);
        return { success: false, error: '@import line not found' };
      }
      
      content = content.replace(originalLine, inlinedCSS);
      description = `Inline CSS from ${fix.title}`;
      impact = 'Eliminates render-blocking CSS import, preserves all styling';
      
    } else if (fix.type === 'css-background-image-fix') {
      // Apply AI-generated CSS and component refactoring
      
      // 1. Apply CSS fix (comment out or replace background-image)
      if (fix.fixedCSSCode) {
        content = fix.fixedCSSCode;
        description = `Refactor background-image in ${fix.file} (AI-generated)`;
        impact = 'Replaces background-image with <img loading="lazy"> for better performance';
      } else {
        // Fallback: just comment out
        const lines = content.split('\n');
        const lineIndex = fix.line - 1;
        
        if (lines[lineIndex] && lines[lineIndex].includes('background-image')) {
          lines[lineIndex] = `  /* ${lines[lineIndex].trim()} */`;
          lines.splice(lineIndex + 1, 0, '  /* Performance: Replace with <img loading="lazy"> in HTML - see Performance Bot PR comment */');
          content = lines.join('\n');
          description = `Comment out background-image in ${fix.file}`;
          impact = 'Enables lazy loading when replaced with <img>';
        }
      }
      
    } else if (fix.type === 'custom-function-runtime-error-fix') {
      // Apply AI-generated null checks for runtime errors
      const lines = content.split('\n');
      const functionName = fix.functionName || 'unknown';
      
      // Find the function definition
      const functionPattern = new RegExp(`(export\\s+)?(async\\s+)?function\\s+${functionName}\\s*\\(|const\\s+${functionName}\\s*=|${functionName}\\s*:\\s*(async\\s+)?function`);
      const functionLineIndex = lines.findIndex(line => functionPattern.test(line));
      
      if (functionLineIndex !== -1) {
        // Find the end of the function
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
        
        // Add AI-generated code with attribution
        const indent = lines[functionLineIndex].match(/^(\s*)/)[1];
        const aiHeader = [
          `${indent}// ============================================================`,
          `${indent}//   AI-GENERATED FIX (Azure OpenAI gpt-5.1-codex)`,
          `${indent}// Original: Runtime errors due to missing null checks`,
          `${indent}// Fixed: Added defensive null/undefined checks`,
          `${indent}// REVIEW REQUIRED: Test with various input scenarios`,
          `${indent}// ============================================================`,
          ''
        ];
        
        // Replace function with AI-generated code
        if (fix.refactoredCode) {
          lines.splice(functionLineIndex, functionEndIndex - functionLineIndex + 1, ...aiHeader, fix.refactoredCode);
          content = lines.join('\n');
          description = `Add null checks to ${functionName}() (AI-generated)`;
          impact = fix.impact || 'Prevents runtime errors, improves stability';
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
   * Fix CSS @import statements by INLINING the imported CSS content
   * This eliminates render-blocking imports while preserving styling
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
        
        // Read and inline the imported CSS file
        const inlineResult = await this.inlineImportedCSS(issue, fileContent);
        
        if (inlineResult) {
          suggestions.push({
            type: 'css-import-fix',
            severity: 'critical',
            file: issue.file,
            line: issue.line,
            title: `Inline CSS from ${basename(inlineResult.importedFile || issue.importUrl)}`,
            description: `CSS @import blocks rendering. Inlined ${inlineResult.importedLines} lines from ${inlineResult.importedFile}.`,
            originalCode: inlineResult.originalImportLine,
            fixedCode: inlineResult.inlinedCSS,
            alternativeFix: inlineResult.alternativeFix,
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
    
    // PARALLEL: Generate all CSS background-image fixes at once
    const cssFixPromises = bgImageIssues.slice(0, 3).map(async (issue) => {
      try {
        const cssFilePath = resolve(this.workspaceRoot, issue.file);
        const cssContent = readFileSync(cssFilePath, 'utf-8');
        
        // NEW: Find associated component file (same base name, different extension)
        const baseName = cssFilePath.replace(/\.css$/, '');
        const componentExtensions = ['.js', '.jsx', '.ts', '.tsx'];
        let componentPath = null;
        let componentContent = null;
        
        for (const ext of componentExtensions) {
          const testPath = baseName + ext;
          if (existsSync(testPath)) {
            componentPath = testPath;
            componentContent = readFileSync(testPath, 'utf-8');
            core.info(`Found associated component: ${relative(this.workspaceRoot, componentPath)}`);
            break;
          }
        }
        
        // Extract dimensions from CSS if available
        let cssWidth = 'auto';
        let cssHeight = 'auto';
        try {
          const selectorMatch = cssContent.match(new RegExp(`${issue.selector}\\s*\\{[^}]*\\}`, 's'));
          if (selectorMatch) {
            const widthMatch = selectorMatch[0].match(/width:\s*([^;]+)/);
            const heightMatch = selectorMatch[0].match(/height:\s*([^;]+)/);
            if (widthMatch) cssWidth = widthMatch[1].trim();
            if (heightMatch) cssHeight = heightMatch[1].trim();
          }
        } catch (e) {
          core.info(`Could not extract dimensions from CSS: ${e.message}`);
        }
        
        // Build enhanced context with both CSS and component
        const enhancedContext = {
          cssFile: issue.file,
          cssContent: cssContent,
          componentFile: componentPath ? relative(this.workspaceRoot, componentPath) : null,
          componentContent: componentContent,
          imagePath: issue.imageUrl || issue.imagePath || '',  // CSS analyzer uses 'imageUrl'
          selector: issue.selector || '',
          cssWidth,  // Extracted from CSS or 'auto'
          cssHeight, // Extracted from CSS or 'auto'
        };
        
        // Log what we extracted for debugging
        core.info(`  Image path: ${enhancedContext.imagePath || 'NOT FOUND'}`);
        core.info(`  CSS dimensions: ${cssWidth} x ${cssHeight}`);
        
        // Skip if we couldn't extract the image path
        if (!enhancedContext.imagePath) {
          core.warning(`Skipping ${issue.file}:${issue.line} - could not extract image path from CSS`);
          core.warning(`  CSS issue: ${issue.message}`);
          return null;
        }
        
        const fix = await this.generateBackgroundImageFix(issue, enhancedContext, cssContent, componentContent);
        
        if (fix) {
          // VALIDATE: If component was provided, ensure AI preserved all critical code
          let componentValidationFailed = false;
          let validationErrors = [];
          
          if (componentContent && fix.fixedComponentCode) {
            const validation = this.validateComponentRefactoring(componentContent, fix.fixedComponentCode);
            if (!validation.valid) {
              componentValidationFailed = true;
              validationErrors = validation.errors;
              
              core.warning(`Component refactoring REJECTED for ${relative(this.workspaceRoot, componentPath)}:`);
              validation.errors.forEach(err => core.warning(`  - ${err}`));
              core.warning('  Only CSS fix will be applied (component requires manual review)');
              core.warning(`  Original component: ${componentContent.length} chars`);
              core.warning(`  AI refactored: ${fix.fixedComponentCode.length} chars`);
              
              // Don't include fixedComponentCode if validation failed
              fix.fixedComponentCode = null;
              fix.componentFile = null;
            }
          }
          
          return {
            type: 'css-background-image-fix',
            severity: 'critical',
            file: issue.file,
            componentFile: componentPath ? relative(this.workspaceRoot, componentPath) : null,
            line: issue.line,
            title: `Replace background-image with Image component in ${basename(issue.file)}`,
            description: `CSS background-images cannot be lazy loaded. ${fix.explanation}`,
            originalCode: fix.originalCSSCode,
            fixedCSSCode: fix.fixedCSSCode,
            originalComponentCode: fix.originalComponentCode,
            fixedComponentCode: fix.fixedComponentCode,
            htmlSuggestion: fix.htmlSuggestion,
            estimatedImpact: 'Enables lazy loading, reduces initial page weight by image size'
          };
        }
        return null;
      } catch (error) {
        core.warning(`Error generating fix for ${issue.file}:${issue.line}: ${error.message}`);
        return null;
      }
    });
    
    const cssFixResults = await Promise.all(cssFixPromises);
    const suggestions = cssFixResults.filter(r => r !== null);
    
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
    
    // PARALLEL: Generate all HTTP fixes at once
    const httpFixPromises = httpIssues.slice(0, 3).map(async (issue) => {
      try {
        const refactoredCode = await this.generateRefactoredCode(issue, 'http');
        
        return {
          type: 'custom-function-http-fix',
          severity: 'critical',
          function: issue.functionName,
          functionName: issue.functionName,
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
        };
      } catch (error) {
        core.warning(`Failed to generate HTTP fix for ${issue.functionName}(): ${error.message}`);
        return null;
      }
    });
    
    const httpResults = await Promise.all(httpFixPromises);
    suggestions.push(...httpResults.filter(r => r !== null));
    
    // DOM access in custom functions
    const domIssues = customFunctionsResults.newIssues.filter(
      issue => issue.type === 'dom-access-in-custom-function'
    );
    
    // PARALLEL: Generate all DOM fixes at once
    const domFixPromises = domIssues.slice(0, 2).map(async (issue) => {
      try {
        const refactoredCode = await this.generateRefactoredCode(issue, 'dom');
        
        return {
          type: 'custom-function-dom-fix',
          severity: 'critical',
          function: issue.functionName,
          functionName: issue.functionName,
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
        };
      } catch (error) {
        core.warning(`Failed to generate DOM fix for ${issue.functionName}(): ${error.message}`);
        return null;
      }
    });
    
    const domResults = await Promise.all(domFixPromises);
    suggestions.push(...domResults.filter(r => r !== null));
    
    return suggestions;
  }

  /**
   * Fix runtime errors in custom functions
   * Add null/undefined checks to prevent crashes
   */
  fixRuntimeErrors = async (customFunctionsResults) => {
    if (!customFunctionsResults || !customFunctionsResults.newIssues) return [];
    
    const runtimeErrorIssues = customFunctionsResults.newIssues.filter(
      issue => issue.type === 'runtime-error-in-custom-function'
    );
    
    if (runtimeErrorIssues.length === 0) return [];
    
    // PARALLEL: Generate all runtime error fixes at once
    const runtimeFixPromises = runtimeErrorIssues.slice(0, 5).map(async (issue) => {
      try {
        // Extract function code
        core.info(`Extracting ${issue.functionName}() from ${issue.file || 'blocks/form/functions.js'}`);
        const functionCode = this.extractFunctionCode(issue);
        
        // Skip if extraction failed
        if (!functionCode) {
          core.warning(`Skipping ${issue.functionName}() - could not extract function code from ${issue.file}`);
          return null;
        }
        
        // Log what was extracted
        core.info(`  Extracted ${functionCode.length} chars`);
        core.info(`  Preview: ${functionCode.substring(0, 100)}...`);
        
        const enhancedContext = this.buildEnhancedContext(issue);
        
        if (!enhancedContext) {
          core.warning(`Could not extract context for ${issue.functionName}`);
          return null;
        }
        
        // Validate the extracted code has actual body (not just signature)
        if (functionCode.length < 50 || !functionCode.includes('{') || functionCode.split('\n').length < 3) {
          core.warning(`Skipping ${issue.functionName}() - extracted code too short or incomplete`);
          core.warning(`  Extracted: ${functionCode}`);
          return null;
        }
        
        // Generate AI-powered null-check fix
        const refactored = await this.generateRuntimeErrorFix(issue, functionCode, enhancedContext);
        
        if (refactored && refactored.jsCode) {
          // Validate AI output
          const validation = this.validateAIRefactoring(functionCode, refactored.jsCode, issue.functionName, 'runtime');
          
          if (!validation.valid) {
            core.warning(`AI refactoring rejected for ${issue.functionName} (${validation.rulesChecked} rules checked):`);
            validation.errors.forEach(err => core.warning(`  - ${err}`));
            return null;
          }
          
          core.info(`AI refactoring validated for ${issue.functionName} (${validation.rulesChecked} rules passed)`);
          
          return {
            type: 'custom-function-runtime-error-fix',
            severity: 'warning',
            file: issue.file || 'blocks/form/functions.js',
            functionName: issue.functionName,
            title: `Add null checks to ${issue.functionName}()`,
            description: `Function throws ${issue.errorCount} runtime error(s): ${issue.errors && issue.errors[0]}`,
            refactoredCode: refactored.jsCode,
            impact: `Prevents ${issue.errorCount} runtime error(s), improves form stability`,
            testingSteps: refactored.testingSteps || 'Test form submission and field interactions'
          };
        }
        return null;
      } catch (error) {
        core.warning(`Error generating runtime error fix for ${issue.functionName}: ${error.message}`);
        return null;
      }
    });
    
    const runtimeResults = await Promise.all(runtimeFixPromises);
    const suggestions = runtimeResults.filter(r => r !== null);
    
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
   * Generate recommendations for form validation errors
   * These are authoring-level issues detected by af-core during form instance creation
   * Cannot be auto-fixed programmatically - require manual form JSON updates
   */
  generateValidationErrorRecommendations = async (ruleCyclesResults) => {
    if (!ruleCyclesResults || !ruleCyclesResults.after) return [];
    
    const { validationErrors, validationErrorCount } = ruleCyclesResults.after;
    if (!validationErrors || validationErrorCount === 0) return [];
    
    const recommendations = [];
    
    // 1. DataRef Parsing Errors
    for (const error of validationErrors.dataRefErrors.slice(0, 10)) { // Limit to top 10
      recommendations.push({
        type: 'form-validation-dataref-error',
        severity: 'warning', // Warning, not critical (form still works, field data just won't export)
        fieldId: error.fieldId,
        dataRef: error.dataRef,
        title: `Invalid dataRef syntax in field "${error.fieldId}"`,
        description: `Field has invalid JSONPath in \`dataRef\`: "${error.dataRef}". The field's data will not be exported.`,
        recommendation: `
**Issue:** The \`dataRef\` property uses invalid JSONPath syntax: \`"${error.dataRef}"\`

**Possible Causes:**
1. **Missing path prefix** - Should be \`$.${error.dataRef}\` (global) or \`data.${error.dataRef}\` (relative)
2. **Invalid characters** - Contains special chars like \`@\`, \`[\`, \`"\` without proper escaping
3. **Unclosed quotes** - JSONPath string literal not properly closed

**Fix in AEM Forms Authoring:**
1. Open the form in **AEM Forms Editor**
2. Select field "${error.fieldId}"
3. In **Properties** panel → **Basic** tab → Find **Data Reference (dataRef)**
4. Update to valid JSONPath:
   - For global binding: \`$.${error.dataRef}\`
   - For relative binding: \`data.${error.dataRef}\`
   - Or remove \`dataRef\` to use field's \`name\` property instead

**Impact:** Field value won't be included in form submission data until fixed.

**Verification:** After fix, check browser console - error should disappear.
        `,
        estimatedImpact: 'Field data will be properly exported in form submissions'
      });
    }
    
    // 2. Type Conflict Errors
    for (const error of validationErrors.typeConflicts.slice(0, 10)) { // Limit to top 10
      recommendations.push({
        type: 'form-validation-type-conflict',
        severity: 'warning', // Warning, not critical (form still works, but data consistency issue)
        fieldId: error.newField,
        dataRef: error.dataRef,
        title: `Type conflict: Multiple fields bound to "${error.dataRef}"`,
        description: `Field "${error.newField}" (type: ${error.newFieldType}) shares dataRef with fields of different types: ${error.conflictingFields}`,
        recommendation: `
**Issue:** Multiple fields are mapped to the same data property (\`${error.dataRef}\`) but have different data types.

**Conflicting Fields:**
- **New field:** ${error.newField} (type: **${error.newFieldType}**)
- **Existing fields:** ${error.conflictingFields}

**Why This Is a Problem:**
- The data model can only store ONE value at \`${error.dataRef}\`
- When multiple fields with different types write to it, type coercion occurs
- This can cause data loss or unexpected validation errors

**Fix in AEM Forms Authoring:**

**Option A:** Use unique \`dataRef\` for each field
1. Open form in **AEM Forms Editor**
2. Select field "${error.newField}"
3. In **Properties** → **Basic** → Update **Data Reference (dataRef)** to unique value:
   - Example: \`${error.dataRef}_text\` vs \`${error.dataRef}_number\`

**Option B:** Ensure all fields use the SAME type
1. Check all fields bound to \`${error.dataRef}\`
2. Update their \`type\` property to match (e.g., all \`string\` or all \`number\`)

**Option C:** Remove \`dataRef\` from one field
1. If one field is just for display/calculation, remove its \`dataRef\`
2. This prevents it from writing to the data model

**Impact:** Consistent data types prevent silent data coercion and validation issues.

**Verification:** After fix, check browser console - conflict warning should disappear.
        `,
        estimatedImpact: 'Eliminates data type inconsistencies and potential data loss'
      });
    }
    
    if (recommendations.length > 0) {
      core.info(`Generated ${recommendations.length} form validation recommendations (${validationErrors.dataRefErrors.length} dataRef, ${validationErrors.typeConflicts.length} type conflicts)`);
    }
    
    return recommendations;
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
   * Inline imported CSS content to eliminate render-blocking @import
   * Handles nested imports recursively
   */
  inlineImportedCSS = async (issue, parentFileContent) => {
    try {
      const parentFilePath = resolve(this.workspaceRoot, issue.file);
      const parentDir = dirname(parentFilePath);
      
      // Resolve import path (relative to parent CSS file)
      let importedFilePath = issue.importUrl;
      
      // Handle different import formats
      // @import url('../shared/buttons.css');
      // @import '../shared/buttons.css';
      // @import 'buttons.css';
      if (importedFilePath.startsWith('http://') || importedFilePath.startsWith('https://')) {
        // External URLs cannot be inlined
        core.warning(`Cannot inline external URL: ${importedFilePath}`);
        return null;
      }
      
      // Resolve relative path
      importedFilePath = resolve(parentDir, importedFilePath);
      
      // Check if file exists
      if (!existsSync(importedFilePath)) {
        core.warning(`Imported CSS file not found: ${importedFilePath}`);
        core.warning(`  Referenced in: ${issue.file}`);
        core.warning(`  Import URL: ${issue.importUrl}`);
        return null;
      }
      
      // Read imported file
      const importedContent = readFileSync(importedFilePath, 'utf-8');
      const importedLines = importedContent.split('\n').length;
      
      core.info(`  Reading imported CSS: ${relative(this.workspaceRoot, importedFilePath)}`);
      core.info(`  Imported file: ${importedLines} lines`);
      
      // CRITICAL: Resolve relative paths in the imported CSS
      // Example: url(../icons/arrow.png) needs to be rewritten relative to parent file
      const importedDir = dirname(importedFilePath);
      let processedContent = importedContent.replace(
        /url\(['"]?([^'")]+)['"]?\)/gi,
        (match, urlPath) => {
          // Skip absolute URLs and data URIs
          if (urlPath.startsWith('http://') || 
              urlPath.startsWith('https://') || 
              urlPath.startsWith('//') ||
              urlPath.startsWith('data:')) {
            return match;
          }
          
          // Resolve path relative to imported file's location
          const absolutePath = resolve(importedDir, urlPath);
          
          // Make it relative to parent file's location
          const relativeToParent = relative(parentDir, absolutePath);
          
          core.info(`    Resolved path: ${urlPath} → ${relativeToParent}`);
          return `url('${relativeToParent}')`;
        }
      );
      
      // Check for nested @imports in the imported file
      const nestedImports = this.detectNestedImports(processedContent);
      
      if (nestedImports.length > 0) {
        core.info(`  Found ${nestedImports.length} nested @import(s) in ${basename(importedFilePath)}`);
        
        // Recursively inline nested imports
        for (const nestedImport of nestedImports) {
          try {
            const nestedResult = await this.inlineImportedCSS(
              {
                file: relative(this.workspaceRoot, importedFilePath),
                importUrl: nestedImport.url,
                line: nestedImport.line
              },
              importedContent
            );
            
            if (nestedResult) {
              // Replace nested @import with its inlined content
              processedContent = processedContent.replace(
                nestedImport.fullLine,
                nestedResult.inlinedCSS
              );
            }
          } catch (nestedError) {
            core.warning(`Failed to inline nested import ${nestedImport.url}: ${nestedError.message}`);
          }
        }
      }
      
      // Find the exact @import line in the parent file
      const importPattern = new RegExp(
        `@import\\s+(?:url\\()?['"]?${issue.importUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?(?:\\))?\\s*;?`,
        'i'
      );
      const match = parentFileContent.match(importPattern);
      const originalImportLine = match ? match[0] : `@import url('${issue.importUrl}');`;
      
      // Generate inlined CSS with source comments
      const inlinedCSS = `/* ═══════════════════════════════════════════════════════════════════
   INLINED CSS from: ${relative(dirname(parentFilePath), importedFilePath)}
   Performance: Eliminates render-blocking @import
   Lines: ${importedLines}
   Original: ${originalImportLine}
   Auto-generated by AEM Forms Performance Analyzer
   ═══════════════════════════════════════════════════════════════════ */

${processedContent}

/* ═══════════════════════════════════════════════════════════════════
   End of inlined CSS from: ${relative(dirname(parentFilePath), importedFilePath)}
   ═══════════════════════════════════════════════════════════════════ */`;
      
      return {
        originalImportLine,
        inlinedCSS,
        importedFile: relative(this.workspaceRoot, importedFilePath),
        importedLines,
        alternativeFix: `Alternatively, use a bundler (webpack/rollup) to combine CSS during build.`
      };
      
    } catch (error) {
      core.warning(`Error inlining CSS for ${issue.file}: ${error.message}`);
      return null;
    }
  }

  /**
   * Detect nested @import statements in CSS content
   */
  detectNestedImports = (cssContent) => {
    const imports = [];
    const importPattern = /@import\s+(?:url\()?['"]([^'"]+)['"](?:\))?\s*;?/gi;
    let match;
    
    while ((match = importPattern.exec(cssContent)) !== null) {
      imports.push({
        fullLine: match[0],
        url: match[1],
        line: cssContent.substring(0, match.index).split('\n').length
      });
    }
    
    return imports;
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
  "originalCode": "The exact @import line to replace (e.g., @import url('/fonts.css');)",
  "fixedCode": "Replacement code or comment with build tool integration steps",
  "alternativeFix": "Alternative approach if build tools not available",
  "explanation": "Performance impact (1 sentence, mention FCP/LCP improvement)"
}

**CRITICAL RULES:**
1. Extract EXACT @import line from the CSS file above as "originalCode"
2. DO NOT invent imports that don't exist in the file
3. Preserve all other CSS rules
4. Provide actionable fix (not just generic advice)

**CONCRETE EXAMPLES:**

Example 1: With Build Tools
BEFORE:
\`\`\`css
@import url('/styles/fonts.css');
.header { color: blue; }
\`\`\`

AFTER (fixedCode):
\`\`\`css
/* @import url('/styles/fonts.css'); */
/* PERFORMANCE FIX: Bundle fonts.css during build with webpack/rollup */
/* Add to webpack.config.js: import './styles/fonts.css' */
.header { color: blue; }
\`\`\`

Example 2: Without Build Tools
BEFORE:
\`\`\`css
@import url('https://fonts.googleapis.com/css?family=Roboto');
.text { font-family: Roboto; }
\`\`\`

AFTER (fixedCode):
\`\`\`css
/* @import url('https://fonts.googleapis.com/css?family=Roboto'); */
/* PERFORMANCE FIX: Add to HTML <head> with preconnect: */
/* <link rel="preconnect" href="https://fonts.googleapis.com"> */
/* <link href="https://fonts.googleapis.com/css?family=Roboto&display=swap" rel="stylesheet"> */
.text { font-family: Roboto; }
\`\`\`

**Requirements:**
- Extract exact @import line from actual file
- Comment out the @import
- Provide clear, actionable replacement steps
- Mention specific build tool if detected (${buildToolInfo ? 'detected' : 'not detected'})
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
  generateBackgroundImageFix = async (issue, enhancedContext, cssContent, componentContent) => {
    const hasComponent = !!componentContent;
    
    const prompt = `Replace CSS background-image with a lazy-loaded <img> element by refactoring BOTH the CSS and the component.

**CSS File:** ${enhancedContext.cssFile}
**Component File:** ${enhancedContext.componentFile || 'Not found'}
**Image Path:** ${enhancedContext.imagePath || '(extraction failed - check CSS background-image URL)'}
**Selector:** ${enhancedContext.selector}
**CSS Width:** ${enhancedContext.cssWidth || 'auto'} (use this or 'auto')
**CSS Height:** ${enhancedContext.cssHeight || 'auto'} (use this or 'auto')

**CRITICAL: If Image Path is "(extraction failed)", skip this fix - cannot proceed without valid image path.**

**Current CSS:**
\`\`\`css
${cssContent}
\`\`\`

${hasComponent ? `**Current Component Code:**
\`\`\`javascript
${componentContent}
\`\`\`
` : '**Note:** No component file found. Generate HTML snippet instead.'}

**Task:** Add <img> element to component while preserving ALL existing code.

**CRITICAL RULES:**
${hasComponent ? `1. PRESERVE ALL EXISTING CODE - Do NOT remove any:
   - Functions (especially decorate() method)
   - Variables
   - Event listeners
   - Import statements
   - Export statements
   - Comments
2. ONLY ADD the <img> element where the background was used
3. Return the COMPLETE component file with img added
4. DO NOT refactor or simplify existing code` : `1. Generate standalone <img> snippet only`}

**Response Format (JSON):**
{
  "originalCSSCode": "CSS rule with background-image",
  "fixedCSSCode": "Complete CSS file with background-image removed, ALL other styles preserved",
  ${hasComponent ? `"originalComponentCode": "NOT USED - ignore this field",
  "fixedComponentCode": "COMPLETE component file with <img> tag added and ALL existing code preserved",` : ''}
  "htmlSuggestion": "Standalone <img> snippet: <img src='...' loading='lazy' width='...' height='...' alt='...' />",
  "explanation": "Why this improves performance (1 sentence)"
}

**Image Requirements:**
- src: Use "${enhancedContext.imagePath || issue.image}" (extracted from CSS background-image)
- loading="lazy" (for off-screen images)
- width: Use img.style.width = '${enhancedContext.cssWidth || 'auto'}' (from CSS above)
- height: Use img.style.height = '${enhancedContext.cssHeight || 'auto'}' (from CSS above)
- alt text: Generic descriptive text (e.g., "Background image", "Decorative image")
- DO NOT use img.width/img.height attributes with hard-coded pixel values
- DO NOT invent dimensions like 28, 1200, etc. - use the CSS values provided or 'auto'
- Use object-fit CSS if needed for aspect ratio

**CONCRETE EXAMPLE:**

Given CSS: \`.hero { background-image: url('/images/hero-bg.jpg'); width: 100%; height: 400px; }\`

BEFORE (component with background-image in CSS):
\`\`\`javascript
export default function decorate(block) {
  const container = document.createElement('div');
  container.className = 'hero-container';
  // ... existing logic ...
  block.appendChild(container);
}
\`\`\`

AFTER (with <img> added, ALL existing code preserved):
\`\`\`javascript
export default function decorate(block) {
  const container = document.createElement('div');
  container.className = 'hero-container';
  
  // ADD: Lazy-loaded image (extracted from CSS background-image)
  const img = document.createElement('img');
  img.src = '/images/hero-bg.jpg';  // Extracted from CSS url()
  img.loading = 'lazy';
  img.style.width = '100%';  // Extracted from CSS or use 'auto'
  img.style.height = 'auto';  // Use 'auto' to maintain aspect ratio
  img.alt = 'Hero background';  // Descriptive alt text
  container.appendChild(img);
  
  // ... existing logic PRESERVED ...
  block.appendChild(container);
}
\`\`\`

**WRONG EXAMPLES (DO NOT DO THIS):**
❌ \`img.src = 'undefined';\` // Extract actual path from CSS!
❌ \`img.width = 28;\` // Don't hard-code arbitrary dimensions!
❌ Missing decorate() function in output // Preserve ALL functions!

**Performance Impact:**
- CSS background-images cannot be lazy loaded
- <img loading="lazy"> reduces initial page weight
- width/height attributes prevent Cumulative Layout Shift (CLS)`;

    try {
      const response = await this.callAI(prompt, 'Fix CSS background-image');
      return response;
    } catch (error) {
      core.warning(`AI call failed for background-image fix: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate runtime error fix by adding null/undefined checks
   */
  generateRuntimeErrorFix = async (issue, functionCode, enhancedContext) => {
    // Check if function contains crypto operations (Azure OpenAI content filter may block)
    const hasCryptoOperations = /crypto\.(subtle\.|getRandomValues|encrypt|decrypt)|CryptoKey|SubtleCrypto/i.test(functionCode);
    
    if (hasCryptoOperations) {
      core.warning(`Skipping AI fix for ${issue.functionName}() - contains cryptographic operations (may trigger content filter)`);
      core.warning(`  Recommendation: Manually add null checks before crypto operations`);
      return null; // Skip AI generation, will not be auto-applied
    }
    
    // Parse error details (now includes stack traces)
    const parsedErrors = [];
    if (issue.errors && issue.errors.length > 0) {
      for (const errStr of issue.errors) {
        try {
          const errObj = JSON.parse(errStr);
          parsedErrors.push(errObj);
        } catch (e) {
          // Fallback for old format (plain strings)
          parsedErrors.push({ message: errStr, stack: '', name: 'Error' });
        }
      }
    }
    
    // Build error list with stack traces for AI context
    const errorList = parsedErrors.length > 0
      ? parsedErrors.map((err, i) => {
          let formatted = `${i + 1}. ${err.message}`;
          if (err.stack) {
            // Extract relevant stack trace lines (filter out internal Node.js traces)
            const stackLines = err.stack.split('\n')
              .filter(line => !line.includes('node_modules') && !line.includes('internal/'))
              .slice(0, 5) // Top 5 relevant lines
              .join('\n   ');
            if (stackLines) {
              formatted += `\n   Stack:\n   ${stackLines}`;
            }
          }
          return formatted;
        }).join('\n\n')
      : 'Unknown errors';
    
    const contextInfo = enhancedContext ? `
**Function Context:**
- File: ${enhancedContext.fullFileContent ? `${enhancedContext.fullFileContent.split('\n').length} lines` : 'N/A'}
- Imports: ${(enhancedContext.imports || []).slice(0, 5).join(', ') || 'None'}
- Related functions: ${(enhancedContext.relatedFunctions || []).slice(0, 10).join(', ') || 'None'}
- Helper functions available: ${(enhancedContext.relatedFunctionCode || []).slice(0, 5).map(h => h.name).join(', ') || 'None'}
- AEM Utilities: ${(enhancedContext.utilityFunctions || []).join(', ') || 'None'}
` : '';

    const userPrompt = `Add defensive null/undefined checks to prevent runtime errors in this custom function.

**Function:** ${issue.functionName}()
**Error Count:** ${issue.errorCount}
**Errors Encountered:**
${errorList}
${contextInfo}

**Current Implementation:**
\`\`\`javascript
${functionCode}
\`\`\`

${enhancedContext?.fullFileContent && enhancedContext.fullFileContent.length < 15000 ? `
**Complete File Context (for reference):**
\`\`\`javascript
${enhancedContext.fullFileContent}
\`\`\`
` : ''}

**Task:** Add TARGETED null/undefined checks ONLY where the stack trace indicates errors occurred.

**AEM FORMS RUNTIME GUARANTEES (DO NOT add null checks for these):**
The following are ALWAYS present in AEM Forms runtime:
✓ \`globals\` - always exists
✓ \`globals.form\` - always exists (the FormModel instance)
✓ \`globals.functions\` - always exists (contains OOTB functions)
✓ \`globals.functions.setProperty\` - OOTB function, always available
✓ \`globals.functions.getProperty\` - OOTB function, always available
✓ \`globals.functions.setVariable\` - OOTB function, always available
✓ \`globals.functions.getVariable\` - OOTB function, always available
✓ \`globals.functions.exportData\` - OOTB function, always available
✓ \`globals.functions.importData\` - OOTB function, always available
✓ \`globals.functions.validate\` - OOTB function, always available
✓ \`globals.functions.setFocus\` - OOTB function, always available
✓ \`globals.functions.dispatchEvent\` - OOTB function, always available

**What CAN be null/undefined (DO add checks for these):**
✗ Function parameters (e.g., \`panNumber\`, \`field\`, \`formData\`)
✗ Field values (e.g., \`field.$value\`, \`field.$qualifiedName\`)
✗ User-defined form fields (e.g., \`globals.form.someCustomField\`)
✗ Properties on user data (e.g., \`formData.countryCode\`, \`user.profile.name\`)
✗ Results from operations (e.g., \`str.split()[0]\`, \`array[index]\`)

**CONCRETE EXAMPLE (showing what we expect):**

BEFORE (crashes on null):
\`\`\`javascript
function formatPhoneNumber(phone, formData, globals) {
  const cleaned = phone.toString().replace(/\\D/g, '');  // ← Error: phone is null
  globals.functions.setProperty(field, { value: cleaned });
}
\`\`\`

AFTER (with TARGETED defensive check):
\`\`\`javascript
function formatPhoneNumber(phone, formData, globals) {
  // Add null check ONLY for 'phone' (the parameter causing the error)
  if (!phone) {
    return '';
  }
  const cleaned = phone.toString().replace(/\\D/g, '');
  
  // NO check needed for globals.functions.setProperty - it's OOTB and always available
  globals.functions.setProperty(field, { value: cleaned });
}
\`\`\`

**WRONG EXAMPLE (DO NOT do this):**
\`\`\`javascript
function formatPhoneNumber(phone, formData, globals) {
  // ❌ WRONG: No need to check globals
  if (!globals) return;
  
  // ❌ WRONG: No need to check globals.functions
  if (!globals.functions) return;
  
  // ❌ WRONG: No need to check globals.functions.setProperty
  if (!globals.functions.setProperty) return;
  
  // ✓ CORRECT: Only check user parameters
  if (!phone) return '';
  
  const cleaned = phone.toString().replace(/\\D/g, '');
  globals.functions.setProperty(field, { value: cleaned });
}
\`\`\`

**Response Format (JSON ONLY):**
{
  "jsCode": "COMPLETE refactored function code with defensive checks",
  "testingSteps": "how to test the fix"
}

**CRITICAL RULES:**
1. RETURN THE COMPLETE FUNCTION with all original code intact
2. USE THE STACK TRACE to identify which specific variable/operation is failing
3. ADD checks ONLY for the variables mentioned in the error stack trace
4. DO NOT add checks for \`globals\`, \`globals.form\`, or \`globals.functions.*\` (guaranteed by runtime)
5. PRESERVE function signature (parameters, name) exactly
6. PRESERVE all existing logic and calculations
7. PRESERVE all setProperty, setVariable, dispatchEvent calls
8. DO NOT change variable names or remove any logic
9. ONLY ADD defensive checks - don't refactor or simplify

**Defensive Check Patterns (use sparingly, only where stack trace indicates):**
- Before .toString() on parameter: if (!value) { return ''; }
- Before .split() on parameter: if (!str || typeof str !== 'string') { return []; }
- Before property access on user data: if (!obj || !obj.property) { return null; }
- Before field.$value: if (!field || field.$value === undefined) { return; }

**DO NOT add checks for:**
- \`globals\` (always exists)
- \`globals.form\` (always exists)  
- \`globals.functions\` (always exists)
- \`globals.functions.setProperty\`, \`getProperty\`, \`setVariable\`, etc. (all OOTB functions)

Respond with ONLY the JSON object containing the COMPLETE function code, no markdown formatting.`;

    try {
      const parsed = await this.callAzureOpenAI(`You are an expert at adding defensive null checks to JavaScript functions.`, userPrompt);
      
      if (parsed && parsed.jsCode && typeof parsed.jsCode === 'string' && parsed.jsCode.trim().length > 0) {
        // Log AI response for debugging
        core.info(`  AI generated ${parsed.jsCode.length} chars for ${issue.functionName}()`);
        core.info(`  Preview: ${parsed.jsCode.substring(0, 150)}...`);
        
        // Validate AI output
        const validation = this.validateAIRefactoring(functionCode, parsed.jsCode, issue.functionName, 'runtime');
        
        if (!validation.valid) {
          core.warning(`Runtime error fix rejected for ${issue.functionName}:`);
          validation.errors.forEach(err => core.warning(`  - ${err}`));
          core.warning(`  Original code: ${functionCode.substring(0, 100)}...`);
          core.warning(`  AI refactored: ${parsed.jsCode.substring(0, 200)}...`);
          return null;
        }
        
        return {
          jsCode: parsed.jsCode,
          testingSteps: parsed.testingSteps || 'Test form with various input scenarios'
        };
      }
    } catch (error) {
      core.warning(`AI call failed for runtime error fix: ${error.message}`);
    }
    
    return null;
  }

  /**
   * Create comprehensive GitHub Check with all performance issues
   * Shows up alongside ESLint, build checks in PR Checks tab
   */
  createPerformanceCheck = async (results, suggestions, octokit, owner, repo, prNumber, commitSha) => {
    const annotations = [];
    
    // Collect all critical issues as annotations
    const criticalIssues = [];
    
    // 1. CSS @import issues (critical errors)
    if (results.formCSS?.newIssues) {
      results.formCSS.newIssues
        .filter(i => i.type === 'css-import-blocking')
        .forEach(issue => {
          criticalIssues.push({
            path: issue.file,
            start_line: issue.line || 1,
            end_line: issue.line || 1,
            annotation_level: 'failure',
            title: 'Blocking CSS @import',
            message: `${issue.message}\n\nFix: Bundle CSS during build or use <link> tag in HTML.`,
          });
        });
    }
    
    // 2. CSS background-image issues (critical errors)
    if (results.formCSS?.newIssues) {
      results.formCSS.newIssues
        .filter(i => i.type === 'css-background-image')
        .forEach(issue => {
          criticalIssues.push({
            path: issue.file,
            start_line: issue.line || 1,
            end_line: issue.line || 1,
            annotation_level: 'failure',
            title: 'CSS background-image cannot be lazy loaded',
            message: `${issue.message}\n\nFix: Replace with <img loading="lazy"> for better performance.`,
          });
        });
    }
    
    // 3. HTTP requests in custom functions
    if (suggestions) {
      suggestions
        .filter(s => s.type === 'custom-function-http-fix')
        .forEach(fix => {
          criticalIssues.push({
            path: fix.file,
            start_line: fix.line || 1,
            end_line: fix.line || 1,
            annotation_level: 'failure',
            title: `HTTP Request in ${fix.functionName}()`,
            message: `${fix.description}\n\n**AI-Generated Fix Available** (see PR comment for details)`,
            raw_details: fix.refactoredCode ? `AI-suggested refactoring:\n\n${fix.refactoredCode}` : undefined
          });
        });
    }
    
    // 4. DOM access in custom functions
    if (suggestions) {
      suggestions
        .filter(s => s.type === 'custom-function-dom-fix')
        .forEach(fix => {
          criticalIssues.push({
            path: fix.file,
            start_line: fix.line || 1,
            end_line: fix.line || 1,
            annotation_level: 'failure',
            title: `DOM Access in ${fix.functionName}()`,
            message: `${fix.description}\n\n**AI-Generated Fix Available** (see PR comment for details)`,
            raw_details: fix.refactoredCode ? `AI-suggested refactoring:\n\n${fix.refactoredCode}` : undefined
          });
        });
    }
    
    // 5. Slow rules
    if (results.ruleCycles?.after?.slowRules?.length > 0) {
      results.ruleCycles.after.slowRules.slice(0, 10).forEach(rule => {
        criticalIssues.push({
          path: 'form.json',
          start_line: 1,
          end_line: 1,
          annotation_level: 'warning',
          title: `Slow Rule: ${rule.field}`,
          message: `Rule execution took ${rule.duration}ms (threshold: 50ms)\n\nExpression: ${rule.expression}\n\nOptimize rule logic to improve form responsiveness.`,
        });
      });
    }
    
    try {
      const conclusion = criticalIssues.length > 0 ? 'action_required' : 'success';
      
      core.info(`  Annotations prepared: ${criticalIssues.length}`);
      if (criticalIssues.length > 0) {
        criticalIssues.slice(0, 5).forEach((ann, i) => {
          core.info(`    ${i + 1}. ${ann.path}:${ann.start_line} - ${ann.title}`);
        });
      }
      
      const checkPayload = {
        owner,
        repo,
        name: 'AEM Forms Performance Analysis',
        head_sha: commitSha,
        status: 'completed',
        conclusion,
        output: {
          title: criticalIssues.length > 0 
            ? `${criticalIssues.length} Performance Issue(s) Found` 
            : 'All Performance Checks Passed',
          summary: criticalIssues.length > 0
            ? `Found ${criticalIssues.length} performance issue(s). Review annotations below for AI-powered fix suggestions.`
            : 'No critical performance issues detected. Form meets performance best practices.',
          annotations: criticalIssues.slice(0, 50) // GitHub limit: 50 annotations per check
        }
      };
      
      core.info(`  Sending check to GitHub API...`);
      const checkResponse = await octokit.rest.checks.create(checkPayload);
      
      core.info(`  ✅ Check created successfully!`);
      core.info(`     Name: ${checkResponse.data.name}`);
      core.info(`     ID: ${checkResponse.data.id}`);
      core.info(`     URL: ${checkResponse.data.html_url}`);
      core.info(`     Conclusion: ${conclusion}`);
      core.info(`     Annotations: ${criticalIssues.length}`);
      core.info(`  View in: PR → Checks tab → "AEM Forms Performance Analysis" (left sidebar)`);
      
    } catch (error) {
      core.warning(` Failed to create performance check: ${error.message}`);
      core.warning(`  Status: ${error.status}`);
      core.warning(`  Response: ${JSON.stringify(error.response?.data || {})}`);
    }
  }

  /**
   * Post PR review comments and check annotations with AI suggestions
   * Uses BOTH:
   * 1. GitHub Checks API (annotations) - Works for ALL files, even not in PR diff
   * 2. PR Review Comments - Only works for files in PR diff, but gives "Apply suggestion" button
   */
  postPRReviewComments = async (httpDomFixes, octokit, owner, repo, prNumber, commitSha) => {
    const reviewComments = [];
    
    // Try PR Review Comments for files in PR diff (gives "Apply suggestion" button)
    for (const fix of httpDomFixes) {
      try {
        const commentBody = this.buildPRLineCommentBody(fix);
        
        await octokit.rest.pulls.createReviewComment({
          owner,
          repo,
          pull_number: prNumber,
          body: commentBody,
          commit_id: commitSha,
          path: fix.file,
          line: fix.line || 1,
          side: 'RIGHT'
        });
        
        core.info(`  Posted review comment on ${fix.file}:${fix.line || 1} (file in PR diff)`);
        reviewComments.push(fix);
        
      } catch (error) {
        // If file is not in PR diff, GitHub returns 422
        if (error.status === 422) {
          core.info(`  File ${fix.file} not in PR diff - annotation in "Checks" tab instead`);
        } else {
          core.warning(`  Failed to post comment on ${fix.file}: ${error.message}`);
        }
      }
    }
    
    return { reviewComments };
  }
  
  /**
   * Build annotation message for GitHub Checks
   */
  buildAnnotationMessage = (fix) => {
    if (fix.type === 'custom-function-http-fix') {
      return `Function ${fix.functionName}() makes direct HTTP call, bypassing form's request() API. Use Visual Rule Editor to refactor this function to dispatch events instead.`;
    } else if (fix.type === 'custom-function-dom-fix') {
      return `Function ${fix.functionName}() accesses DOM directly. Use globals.functions.setProperty() instead to update field properties.`;
    }
    return fix.description || 'Performance issue detected';
  }

  /**
   * Build PR line comment body with AI suggestion
   */
  buildPRLineCommentBody = (fix) => {
    const lines = [];
    
    if (fix.type === 'custom-function-http-fix') {
      lines.push(`##  HTTP Request in Custom Function`);
      lines.push('');
      lines.push(`**Function:** \`${fix.functionName}()\``);
      lines.push(`**Issue:** Direct HTTP call bypasses form's request() API`);
      lines.push('');
      lines.push('**AI-Generated Fix:**');
      lines.push('Use **Visual Rule Editor** to refactor this function according to the suggestion below:');
      lines.push('');
      lines.push('```suggestion');
      lines.push(fix.refactoredCode || '// AI-generated refactored code');
      lines.push('```');
      lines.push('');
      lines.push('**Testing:** ' + (fix.testingSteps || 'Test form submission and API calls'));
      lines.push('');
      lines.push('---');
      lines.push('* AI-powered suggestion by [AEM Forms Performance Analyzer](https://github.com/rismehta/forms-performance-bot)*');
      
    } else if (fix.type === 'custom-function-dom-fix') {
      lines.push(`##  DOM Access in Custom Function`);
      lines.push('');
      lines.push(`**Function:** \`${fix.functionName}()\``);
      lines.push(`**Issue:** Direct DOM manipulation bypasses form state management`);
      lines.push('');
      lines.push('**AI-Generated Fix:**');
      lines.push('Use **Visual Rule Editor** to refactor this function:');
      lines.push('');
      lines.push('```suggestion');
      lines.push(fix.refactoredCode || '// AI-generated refactored code');
      lines.push('```');
      lines.push('');
      if (fix.componentExample) {
        lines.push('**Custom Component (if complex UI):**');
        lines.push('```javascript');
        lines.push(fix.componentExample);
        lines.push('```');
        lines.push('');
      }
      lines.push('**Testing:** ' + (fix.testingSteps || 'Test UI interactions'));
      lines.push('');
      lines.push('---');
      lines.push('* AI-powered suggestion by [AEM Forms Performance Analyzer](https://github.com/rismehta/forms-performance-bot)*');
    }
    
    return lines.join('\n');
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
      
      // Check for content filter blocks
      if (data.content_filters) {
        core.warning(`  Content filtered: ${JSON.stringify(data.content_filters)}`);
      }
      
      // Check for explicit error
      if (data.error) {
        core.warning(`  API error: ${JSON.stringify(data.error)}`);
      }
      
      // Check for incomplete details
      if (data.incomplete_details) {
        core.warning(`  Incomplete: ${JSON.stringify(data.incomplete_details)}`);
      }
      
      // Check status field
      if (data.status) {
        core.warning(`  Status: ${data.status}`);
      }
      
      throw new Error('AI response contained no content (possibly filtered or rate limited)');
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

