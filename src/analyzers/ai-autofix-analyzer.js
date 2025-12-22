import * as core from '@actions/core';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, basename, relative, dirname, join } from 'path';

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
   * Find relevant component file for a DOM manipulation issue
   * Analyzes DOM selectors in the function to find related component files
   */
  findRelevantComponent = async (issue) => {
    try {
      // Extract DOM selectors from the issue details
      const domSelectors = this.extractDOMSelectors(issue);
      
      if (domSelectors.length === 0) {
        core.info(`  No DOM selectors found for ${issue.functionName}()`);
        return {
          componentFile: null,
          componentPath: null,
          componentContent: null,
          domSelectors: []
        };
      }
      
      core.info(`  DOM selectors found: ${domSelectors.join(', ')}`);
      
      // Search for component files that might handle these selectors
      // Similar to background-image approach: look in components/ directory
      const componentsDir = join(this.workspaceRoot, 'blocks/form/components');
      
      if (!existsSync(componentsDir)) {
        core.info(`  Components directory not found: ${componentsDir}`);
        return {
          componentFile: null,
          componentPath: null,
          componentContent: null,
          domSelectors
        };
      }
      
      // Search for component files that might match the selectors
      const componentFiles = [];
      
      const scanComponents = (dir) => {
        const entries = readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          
          if (entry.isDirectory()) {
            // Check if component has a .js file
            const componentJSPath = join(fullPath, `${entry.name}.js`);
            if (existsSync(componentJSPath)) {
              componentFiles.push({
                name: entry.name,
                path: componentJSPath,
                relativePath: relative(this.workspaceRoot, componentJSPath)
              });
            }
          }
        }
      };
      
      scanComponents(componentsDir);
      
      // Try to match selectors to component names
      for (const selector of domSelectors) {
        const cleanSelector = selector.replace(/^[.#]/, ''); // Remove . or #
        
        for (const component of componentFiles) {
          // Check if selector matches component name or is in component content
          if (cleanSelector.toLowerCase().includes(component.name.toLowerCase()) ||
              component.name.toLowerCase().includes(cleanSelector.toLowerCase())) {
            
            core.info(`  Found matching component: ${component.relativePath} (matched selector: ${selector})`);
            
            return {
              componentFile: component.relativePath,
              componentPath: component.path,
              componentContent: readFileSync(component.path, 'utf-8'),
              domSelectors
            };
          }
        }
      }
      
      // If no exact match, return first component as a suggestion
      if (componentFiles.length > 0) {
        const firstComponent = componentFiles[0];
        core.info(`  No exact match, suggesting: ${firstComponent.relativePath}`);
        
        return {
          componentFile: firstComponent.relativePath,
          componentPath: firstComponent.path,
          componentContent: readFileSync(firstComponent.path, 'utf-8'),
          domSelectors
        };
      }
      
      return {
        componentFile: null,
        componentPath: null,
        componentContent: null,
        domSelectors
      };
      
    } catch (error) {
      core.warning(`Could not find component for ${issue.functionName}(): ${error.message}`);
      return {
        componentFile: null,
        componentPath: null,
        componentContent: null,
        domSelectors: []
      };
    }
  }
  
  /**
   * Extract DOM selectors from the function code
   * Looks for document.querySelector, getElementById, getElementsByClassName, etc.
   */
  extractDOMSelectors = (issue) => {
    const selectors = [];
    
    try {
      // Get the function code
      const functionCode = this.extractFunctionCode(issue);
      if (!functionCode) return selectors;
      
      // Extract querySelector/querySelectorAll selectors
      const querySelectorPattern = /\.querySelector(?:All)?\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
      let match;
      while ((match = querySelectorPattern.exec(functionCode)) !== null) {
        selectors.push(match[1]);
      }
      
      // Extract getElementById
      const getByIdPattern = /\.getElementById\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
      while ((match = getByIdPattern.exec(functionCode)) !== null) {
        selectors.push(`#${match[1]}`);
      }
      
      // Extract getElementsByClassName
      const getByClassPattern = /\.getElementsByClassName\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
      while ((match = getByClassPattern.exec(functionCode)) !== null) {
        selectors.push(`.${match[1]}`);
      }
      
      // Extract classList operations (e.g., element.classList.add('my-class'))
      const classListPattern = /\.classList\.(add|remove|toggle)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
      while ((match = classListPattern.exec(functionCode)) !== null) {
        selectors.push(`.${match[2]}`);
      }
      
    } catch (error) {
      core.warning(`Could not extract selectors from ${issue.functionName}(): ${error.message}`);
    }
    
    // Remove duplicates
    return [...new Set(selectors)];
  }

  /**
   * Generate refactored code for a specific issue using AI
   */
  generateRefactoredCode = async (issue, issueType, componentInfo = null) => {
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
        : this.buildDOMRefactorPrompt(issue, functionCode, enhancedContext, componentInfo);

      const systemPrompt = `You are a senior AEM Forms developer performing a surgical refactoring. Your ONLY job is to extract ${issueType === 'http' ? 'HTTP calls' : 'DOM manipulation'} from custom functions.

ABSOLUTE RULES (WILL BE REJECTED IF NOT FOLLOWED):
1. NEVER change function parameters - keep exact signature
2. NEVER remove existing logic - keep all validation, sorting, calculations
3. NEVER change variable names - use exact same names
4. NEVER change return types or values
5. ONLY ${issueType === 'http' ? 'move HTTP calls to event dispatcher' : 'move DOM manipulation to custom component'}
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
        
      // Validate AI output (skip for DOM/HTTP since they're comment-only anyway)
      if (issueType === 'dom' || issueType === 'http') {
        // DOM/HTTP fixes are ALWAYS comment-only (never auto-applied)
        // Developer will review before applying, so validation is less critical
        core.info(`AI suggestion generated for ${issue.functionName} (${parsed.jsCode.length} chars, will be shown in PR comment)`);
      } else {
        // For auto-applied fixes (runtime, CSS), strict validation required
        const validation = this.validateAIRefactoring(functionCode, parsed.jsCode, issue.functionName, issueType);
        if (!validation.valid) {
          core.warning(`AI refactoring rejected for ${issue.functionName} (${validation.rulesChecked} rules checked):`);
          validation.errors.forEach(err => core.warning(`  - ${err}`));
          core.warning('Fix will be skipped due to validation failure');
          return this.getDefaultRefactoredCode(issue, issueType);
        }
        
        core.info(`AI refactoring validated for ${issue.functionName} (${validation.rulesChecked} rules passed)`);
      }
      
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
      // Provide specific error context
      if (error.message.includes('too large')) {
        core.warning(`AI refactoring skipped for ${issue.functionName}: Function too large (${functionCode.length} chars)`);
        core.warning('  Suggestion: Manually refactor or split into smaller functions');
      } else if (error.message.includes('content filter')) {
        core.warning(`AI refactoring skipped for ${issue.functionName}: Content filtered by API`);
        core.warning('  Suggestion: Manually review function for sensitive operations');
      } else {
        core.warning(`AI refactoring failed for ${issue.functionName}: ${error.message}`);
      }
      
      // Return generic guidance (for comment/annotation)
      // Pass error context so default code can be more helpful
      return this.getDefaultRefactoredCode(issue, issueType, error.message);
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
              /if\s*\([^)]*!\s*\w+\s*\)/,         // if (!variable)
              /\w+\s*\?\s*[^:]+\s*:\s*/,          // Ternary operator (condition ? true : false)
              /!=\s*null/,                         // != null check
              /!==\s*null/,                        // !== null check
              /!=\s*undefined/,                    // != undefined check
              /!==\s*undefined/                    // !== undefined check
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
              // Single checks
              /if\s*\(\s*!globals\s*\)/,                       // if (!globals)
              /if\s*\(\s*!globals\.functions\s*\)/,           // if (!globals.functions)
              /if\s*\(\s*!globals\.form\s*\)/,                // if (!globals.form)
              /if\s*\([^)]*globals\.functions\s*===?\s*null/, // if (globals.functions === null)
              /if\s*\([^)]*globals\.form\s*===?\s*null/,      // if (globals.form === null)
              
              // Compound checks (with ||)
              /if\s*\([^)]*!globals\s*\|\|/,                   // if (!globals || ...)
              /\|\|\s*!globals\.functions\s*\|\|/,             // || !globals.functions ||
              /\|\|\s*!globals\.form\s*\|\|/,                  // || !globals.form ||
              /\|\|\s*!globals\s*\)/,                          // || !globals)
              /\|\|\s*!globals\.functions\s*\)/,               // || !globals.functions)
              /\|\|\s*!globals\.form\s*\)/,                    // || !globals.form)
              
              // Typeof checks on OOTB functions
              /typeof\s+globals\.functions\.setProperty\s*[!=]=\s*['"]function['"]/,
              /typeof\s+globals\.functions\.getProperty\s*[!=]=\s*['"]function['"]/,
              /typeof\s+globals\.functions\.setVariable\s*[!=]=\s*['"]function['"]/,
              /typeof\s+globals\.functions\.dispatchEvent\s*[!=]=\s*['"]function['"]/,
              
              // Negation checks
              /!globals\.functions\.setProperty/,              // !globals.functions.setProperty
              /!globals\.functions\.getProperty/,              // !globals.functions.getProperty
              /!globals\.functions\.setVariable/,              // !globals.functions.setVariable
              /!globals\.functions\.getVariable/,              // !globals.functions.getVariable
              /!globals\.functions\.dispatchEvent/,            // !globals.functions.dispatchEvent
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
  buildDOMRefactorPrompt = (issue, functionCode, enhancedContext, componentInfo = null) => {
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

    const componentSection = componentInfo?.componentContent ? `

**RELEVANT COMPONENT FILE FOUND:**
**File:** ${componentInfo.componentFile}
This is where the DOM logic should be moved.

\`\`\`javascript
${componentInfo.componentContent.substring(0, 5000)}${componentInfo.componentContent.length > 5000 ? '\n... (truncated)' : ''}
\`\`\`
` : '';

    const refactoringStrategy = componentInfo?.componentFile 
      ? `**REFACTORING STRATEGY: Move DOM logic to existing component**

The function is in or near a component file. Move the DOM manipulation to that component's lifecycle methods.

**Steps:**
1. Remove DOM manipulation from the custom function
2. Move DOM logic to the component file (${componentInfo.componentFile})
3. Use component lifecycle (connectedCallback, render, etc.)
4. Keep function for data processing only (no DOM access)`
      : `**REFACTORING STRATEGY: Create a custom component**

This function manipulates DOM but is not in a component file. The DOM logic should be in a custom component.

**Steps:**
1. Remove DOM manipulation from the custom function
2. Create a new custom component file
3. Move DOM logic to component's lifecycle methods
4. Keep function for data processing only (no DOM access)`;

    return `Refactor this AEM Forms custom function to move DOM manipulation to a custom component.

**CRITICAL ARCHITECTURAL RULES:**
1. **DOM manipulation ONLY in components** - Custom functions should NOT touch DOM
2. **Custom functions = DATA PROCESSING** - Validate, calculate, transform data
3. **Custom components = UI/DOM** - Read state and update DOM
4. **setProperty() stores STATE/DATA** - NOT DOM elements (e.g., store { highlight: true }, not document.querySelector())
5. **Component reads state** - Component listens for changes and updates its own DOM

**TWO-STEP REFACTORING:**
STEP 1: Function stores STATE via setProperty()
STEP 2: Component reads STATE and updates DOM

**CRITICAL RULES - MUST FOLLOW:**
1. **USE setProperty() for STATE** - Store data/flags, NOT DOM elements
2. **MOVE DOM TO COMPONENT** - All document.*, .style, .innerHTML goes to component
3. **PRESERVE EXACT FUNCTION SIGNATURE** - Do NOT change parameters, parameter names, or order
4. **PRESERVE ALL DATA LOGIC** - Keep all validation, calculations, data processing
5. **ONLY REMOVE DOM MANIPULATION** - Remove document.querySelector, .innerHTML, .style, etc.
6. **USE EXISTING HELPERS** - Reuse helper functions already defined in the file
7. **MATCH CODING STYLE** - Follow the same patterns as other functions in this file

${refactoringStrategy}

**Target Function to Refactor:**
\`\`\`javascript
${functionCode}
\`\`\`
${contextSection}
${componentSection}

${enhancedContext?.fullFileContent && enhancedContext.fullFileContent.length < 10000 ? `
**COMPLETE FILE FOR REFERENCE (so you can see all patterns and helpers):**
\`\`\`javascript
${enhancedContext.fullFileContent}
\`\`\`
` : ''}

**Example of correct refactoring:**

BEFORE (BAD - DOM in custom function):
\`\`\`javascript
// In functions.js
export function highlightField(value, targetField, globals) {
  if (!value) return;
  
  // DOM manipulation (WRONG - function touching DOM)
  const element = document.querySelector(\`[name="\${targetField.$name}"]\`);
  element.style.backgroundColor = 'yellow';
  element.closest('.field-wrapper').style.border = '2px solid red';
}
\`\`\`

AFTER (GOOD - State in function, DOM in component):
\`\`\`javascript
// STEP 1: In functions.js - Store STATE (not DOM elements!)
export function highlightField(value, targetField, globals) {
  if (!value) return;
  
  // Store STATE via setProperty (data/flags, NOT DOM)
  globals.functions.setProperty(targetField, {
    value: value,
    customState: {
      shouldHighlight: true,  // ✓ State flag
      highlightColor: 'yellow' // ✓ State data
      // ✗ Do NOT store: domElement: document.querySelector(...)
    }
  });
}

// STEP 2: In components/my-field/my-field.js - Read STATE, update DOM
export default function decorate(block) {
  const input = block.querySelector('input');
  const field = block.closest('.field-wrapper');
  
  // Listen for property changes (when setProperty is called)
  input.addEventListener('change', () => {
    const fieldModel = input.fieldModel; // Access to form model
    
    // Read STATE from the field
    if (fieldModel.customState?.shouldHighlight) {
      // DOM manipulation HERE in component (CORRECT PLACE)
      input.style.backgroundColor = fieldModel.customState.highlightColor;
      field.style.border = '2px solid red';
    }
  });
  
  // Or use MutationObserver for automatic sync
  const observer = new MutationObserver(() => {
    if (input.fieldModel?.customState?.shouldHighlight) {
      input.style.backgroundColor = input.fieldModel.customState.highlightColor;
    }
  });
  observer.observe(input, { attributes: true });
}
\`\`\`

**KEY DIFFERENCES:**
- Function: Processes data, stores STATE flags/data via setProperty
- Component: Reads STATE, performs DOM manipulation
- State contains: { shouldHighlight: true } ✓
- State does NOT contain: { element: document.querySelector(...) } ✗

**Response Format (JSON ONLY):**
{
  "jsCode": "REFACTORED function - uses setProperty() to store STATE/DATA (not DOM elements)",
  "componentSuggestion": "Which component file to modify (${componentInfo?.componentFile || 'blocks/form/components/[name]/[name].js'}) and what DOM logic to add",
  "componentExample": "Complete component code showing: 1) How to read STATE from field model, 2) How to update DOM based on that STATE",
  "testingSteps": "Step-by-step testing instructions"
}

**VALIDATION CHECKLIST:**
✓ Function signature preserved exactly
✓ All parameters in same order
✓ All validation/data logic preserved
✓ ALL DOM manipulation removed (document.*, .innerHTML, .style)
✓ Function dispatches event OR returns data (no DOM)
✓ Component suggestion provided with specific file path
✓ Component example shows proper DOM handling`;
  }

  /**
   * Get default refactored code (fallback)
   * @param {Object} issue - The issue object
   * @param {string} issueType - 'http' or 'dom'
   * @param {string} errorMsg - Optional error message for context
   */
  getDefaultRefactoredCode = (issue, issueType, errorMsg = '') => {
    // If function is too large, provide manual guidance instead of template
    if (errorMsg.includes('too large')) {
      return {
        jsCode: `// Function ${issue.functionName}() is too large for automated AI refactoring.
// Manual refactoring required:
// 1. Extract ${issueType === 'http' ? 'HTTP calls' : 'DOM manipulation'} to separate function
// 2. Use ${issueType === 'http' ? 'custom events + form-level request()' : 'globals.functions.setProperty()'}
// 3. Test thoroughly in browser
// 
// See AEM Forms documentation for best practices.`,
        formJsonSnippet: issueType === 'http' ? `// Add form-level event handler in Visual Rule Editor` : null,
        testingSteps: 'Manual refactoring required - function too large for AI'
      };
    }
    
    // Default template for other failures
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
      // 1. CSS background-image → <img> component (suggestions only)
      { name: 'CSS background-image fixes', fn: () => this.fixCSSBackgroundImages(results.formCSS) },
      
      // 2. Custom functions with HTTP/DOM (suggestions only)
      { name: 'Custom function fixes', fn: () => this.fixCustomFunctions(results.customFunctions) },
      
      // 3. Runtime errors → add null checks (suggestions only)
      { name: 'Runtime error fixes', fn: () => this.fixRuntimeErrors(results.customFunctions) },
      
      // 4. CSS @import statements (suggestions only)
      { name: 'CSS import fixes', fn: () => this.fixCSSImportSuggestions(results.formCSS) }
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
          // Check if this is an external import that was moved to head.html
          const isExternalImport = inlineResult.htmlFileUpdated;
          const title = isExternalImport 
            ? `Move external CSS to head.html (${basename(inlineResult.importedFile)})` 
            : `Inline CSS from ${basename(inlineResult.importedFile || issue.importUrl)}`;
          const description = isExternalImport
            ? `External CSS @import blocks rendering. Moved to ${inlineResult.htmlFilePath} with optimized preconnect.`
            : `CSS @import blocks rendering. Inlined ${inlineResult.importedLines} lines from ${inlineResult.importedFile}.`;
          
          suggestions.push({
            type: 'css-import-fix',
            severity: 'critical',
            file: issue.file,
            line: issue.line,
            title,
            description,
            originalCode: inlineResult.originalImportLine,
            fixedCode: inlineResult.inlinedCSS,
            alternativeFix: inlineResult.alternativeFix,
            estimatedImpact: isExternalImport 
              ? 'Eliminates render-blocking @import, loads via optimized HTML <link>, improves FCP by 200-500ms'
              : 'Eliminates render-blocking @import, improves FCP by 100-300ms',
            metadata: {
              htmlFileUpdated: inlineResult.htmlFileUpdated,
              htmlFilePath: inlineResult.htmlFilePath
            }
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
    
    core.info(`Fixing ${bgImageIssues.length} background-image issue(s)...`);
    
    // PARALLEL: Generate all CSS background-image fixes at once (no limit)
    const cssFixPromises = bgImageIssues.map(async (issue) => {
      try {
        const cssFilePath = resolve(this.workspaceRoot, issue.file);
        const cssContent = readFileSync(cssFilePath, 'utf-8');
        
        // CRITICAL FIX: Detect if this issue is in INLINED CSS
        // If so, extract the original source file from the comment header
        // This ensures we find the correct component (e.g., button.js not form.js)
        let effectiveCSSPath = cssFilePath;
        const lines = cssContent.split('\n');
        const issueLine = issue.line - 1; // 0-indexed
        
        // Search backwards from issue line to find "INLINED CSS from:" comment
        for (let i = issueLine; i >= 0; i--) {
          const line = lines[i];
          const inlinedMatch = line.match(/INLINED CSS from:\s*(.+)/);
          if (inlinedMatch) {
            const originalRelativePath = inlinedMatch[1].trim();
            // Resolve relative to the parent CSS file's directory
            const parentDir = dirname(cssFilePath);
            const originalCSSPath = resolve(parentDir, originalRelativePath);
            
            if (existsSync(originalCSSPath)) {
              effectiveCSSPath = originalCSSPath;
              core.info(`Detected inlined CSS - original source: ${relative(this.workspaceRoot, originalCSSPath)}`);
              core.info(`  Will look for component based on original file, not ${basename(cssFilePath)}`);
            } else {
              core.warning(`Found inlined CSS marker but original file not found: ${originalCSSPath}`);
            }
            break;
          }
          
          // Stop searching if we hit another inlined section or start of file
          if (line.includes('/* ═══════════════') && i < issueLine) {
            break;
          }
        }
        
        // NEW: Find associated component file (same base name, different extension)
        // Use effectiveCSSPath (original source) instead of cssFilePath (inlined file)
        const baseName = effectiveCSSPath.replace(/\.css$/, '');
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
        
        // Generate fix (with or without component)
        let fix;
        
        if (!componentContent) {
          // No component found - provide manual guidance only
          core.info(`No component found for ${issue.file} - generating manual guidance`);
          fix = {
            type: 'css-background-image-fix',
            severity: 'critical',
            file: issue.file,
            line: issue.line,
            selector: issue.selector,
            imagePath: enhancedContext.imagePath,
            title: `Replace CSS background-image with <img> tag`,
            description: `CSS background-image at \`${issue.selector}\` cannot be lazy loaded. Replace with \`<img loading="lazy">\` for better performance.`,
            guidance: `
**Why this is an issue:**
- CSS \`background-image\` loads immediately (even if user never scrolls to it)
- Browser's \`loading="lazy"\` attribute ONLY works on \`<img>\` tags
- This hurts Core Web Vitals (LCP, CLS)

**How to fix:**
1. Remove \`background-image\` from CSS (\`${issue.selector}\`)
2. Add an \`<img>\` tag in your HTML/component:
   \`\`\`html
   <img src="${enhancedContext.imagePath}" 
        loading="lazy" 
        width="${enhancedContext.width || 'auto'}" 
        height="${enhancedContext.height || 'auto'}"
        alt="Description">
   \`\`\`
3. Style the image with CSS classes as needed

**Note:** If this is a hero image (above the fold), use \`loading="eager"\` instead.
`,
            estimatedImpact: 'Enables lazy loading, reduces initial page load, improves LCP'
          };
        } else {
          // Component found - generate AI-powered fix
          fix = await this.generateBackgroundImageFix(issue, enhancedContext, cssContent, componentContent);
        }
        
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
    
    // HTTP fixes: Static guidance only (NO AI calls)
    for (const issue of httpIssues.slice(0, 5)) {
      suggestions.push({
        type: 'custom-function-http-fix',
        severity: 'critical',
        function: issue.functionName,
        functionName: issue.functionName,
        file: issue.file,
        line: issue.line || 1,
        details: issue.details || [], // Pass through specific HTTP request details
        title: `Move HTTP request from ${issue.functionName}() to form-level API call`,
        description: `Custom function "${issue.functionName}()" makes direct HTTP requests. This bypasses error handling, loading states, and retry logic.\n\n**FIX:** (1) Refactor function to remove request() call, (2) Use **Visual Rule Editor** to create API Integration (invoke service/HTTP request rule) in form events.`,
        guidance: `
**Action Required:**

1. Remove HTTP calls (fetch/request/axios) from this function
2. Use **Visual Rule Editor** to add API Integration:
   - Select field → Add Rule → When "Value Changes" → Then "Invoke Service"
   - Configure the request endpoint in the rule editor
   - Form handles loading states, retries, and encryption automatically

**Why:** Direct HTTP bypasses form's error handling, loading states, and request queue. Use form-level API integration for reliability.
`,
        estimatedImpact: 'Improves error handling, adds loading states, enables request queueing'
      });
    }
    
    core.info(`  HTTP fixes: ${suggestions.length} generated (static guidance, no AI)`);
    
    // DOM access in custom functions
    const domIssues = customFunctionsResults.newIssues.filter(
      issue => issue.type === 'dom-access-in-custom-function'
    );
    
    // DOM fixes: Static guidance only (NO AI calls)
    for (const issue of domIssues.slice(0, 5)) {
      suggestions.push({
        type: 'custom-function-dom-fix',
        severity: 'critical',
        function: issue.functionName,
        functionName: issue.functionName,
        file: issue.file,
        line: issue.line || 1,
        details: issue.details || [], // Pass through specific DOM access details
        title: `Move DOM access from ${issue.functionName}() to custom component`,
        description: `Custom function "${issue.functionName}()" directly manipulates DOM. This breaks AEM Forms architecture and causes maintenance issues.\n\n**FIX:** (1) Refactor function to use setProperty() for STATE only, (2) Move DOM manipulation to custom component where it reads state and updates DOM.`,
        guidance: `
**Action Required:**

1. Remove DOM access (document.querySelector, getElementById, innerHTML, etc.) from this function
2. Create custom component in blocks/form/components/ to handle all DOM updates
3. Update function to use setProperty() to store STATE/DATA only (not DOM elements)
4. Component reads state via field properties and updates its own DOM

**Why:** Direct DOM manipulation bypasses form state management and breaks validation/rules. Move DOM logic to components for proper architecture.
`,
        estimatedImpact: 'Improves maintainability, enables proper state management, reduces bugs'
      });
    }
    
    core.info(`  DOM fixes: ${suggestions.length - httpIssues.length} generated (static guidance, no AI)`);
    
    return suggestions;
  }

  /**
   * Generate inline suggestions for CSS @import statements
   * Suggests removing/commenting @import and adding <link> to head.html
   */
  fixCSSImportSuggestions = async (cssResults) => {
    if (!cssResults || !cssResults.newIssues) return [];
    
    const importIssues = cssResults.newIssues.filter(i => i.type === 'css-import-blocking');
    if (importIssues.length === 0) return [];
    
    core.info(`Generating ${importIssues.length} CSS @import suggestion(s)...`);
    
    const suggestions = [];
    
    for (const issue of importIssues) {
      try {
        const cssFilePath = resolve(this.workspaceRoot, issue.file);
        
        if (!existsSync(cssFilePath)) {
          core.warning(`CSS file not found: ${cssFilePath}`);
          continue;
        }
        
        const cssContent = readFileSync(cssFilePath, 'utf-8');
        const lines = cssContent.split('\n');
        const issueLine = issue.line - 1; // 0-indexed
        
        if (issueLine < 0 || issueLine >= lines.length) {
          core.warning(`Invalid line number ${issue.line} in ${issue.file}`);
          continue;
        }
        
        const originalLine = lines[issueLine];
        const importUrl = issue.importUrl;
        
        // Determine if it's an external URL
        const isExternalURL = importUrl.startsWith('http://') || importUrl.startsWith('https://');
        
        let suggestedFix;
        let guidance;
        
        if (isExternalURL) {
          // External URL: Suggest removing @import and moving to head.html
          suggestedFix = `/* ${originalLine.trim()} - Moved to head.html */`;
          guidance = `
**Fix for External CSS Import**

**Step 1: Remove from CSS (click "Commit suggestion" at the top)**

**Step 2: Add to \`head.html\`**
\`\`\`html
<!-- In head.html -->
<link rel="stylesheet" href="${importUrl}">
\`\`\`

**Why this matters:**
- \`@import\` in CSS blocks rendering (even though bundled)
- \`<link>\` in HTML allows parallel loading
- Better browser caching and performance
- Follows web performance best practices

**Note:** During build, imports are bundled. This change improves development server performance and follows production patterns.
`;
        } else {
          // Local file: Note that it's bundled during build
          suggestedFix = originalLine; // Keep as-is (no change needed)
          guidance = `
**Note: Local CSS Import (Bundled During Build)**

This \`@import\` statement will be automatically bundled into a single CSS file during the build process.

**No action required** - this warning is informational only.

If you want to optimize development server performance, you can manually bundle local imports, but it's not necessary for production.
`;
        }
        
        suggestions.push({
          type: 'css-import-suggestion',
          severity: isExternalURL ? 'warning' : 'info',
          file: issue.file,
          line: issue.line,
          title: isExternalURL ? `Move external CSS import to head.html` : `CSS import will be bundled (no action needed)`,
          description: isExternalURL 
            ? `External CSS import "${importUrl}" should be moved to head.html for better performance.`
            : `Local CSS import "${importUrl}" will be bundled during build.`,
          originalCode: originalLine,
          suggestedCode: suggestedFix,
          guidance: guidance,
          importUrl: importUrl,
          isExternal: isExternalURL,
          estimatedImpact: isExternalURL ? 'Enables parallel CSS loading, improves page load time' : 'No impact - bundled during build'
        });
        
        core.info(`  Generated suggestion for ${issue.file}:${issue.line} (${isExternalURL ? 'external' : 'local'})`);
        
      } catch (error) {
        core.warning(`Failed to generate CSS import suggestion for ${issue.file}:${issue.line}: ${error.message}`);
      }
    }
    
    core.info(`  CSS import fixes: ${suggestions.length} generated (static suggestions, no AI)`);
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
            severity: 'critical', // Critical in PR mode (must fix), warning in scheduled mode
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
        // External URLs cannot be inlined - provide HTML <link> alternative instead
        core.info(`Generating HTML <link> alternative for external URL: ${importedFilePath}`);
        return this.generateExternalImportFix(issue, importedFilePath, parentFileContent);
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
   * Generate fix for external @import (e.g., Google Fonts)
   * Strategy:
   * 1. Remove @import from CSS
   * 2. Add optimized <link> tags to head.html
   * 3. Commit both changes together
   */
  generateExternalImportFix = async (issue, externalUrl, parentFileContent) => {
    try {
      // Find the exact @import line
      const importPattern = new RegExp(
        `@import\\s+(?:url\\()?['"]?${externalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?(?:\\))?\\s*;?`,
        'i'
      );
      const match = parentFileContent.match(importPattern);
      const originalImportLine = match ? match[0] : `@import url('${externalUrl}');`;
      
      // Detect if it's a font import (most common case)
      const isFontImport = /fonts\.(googleapis|gstatic)|font/.test(externalUrl);
      const domain = new URL(externalUrl).hostname;
      
      // Generate optimized HTML <link> tags
      let htmlLinks = '';
      if (isFontImport) {
        // Optimized font loading pattern
        htmlLinks = `<!-- Performance: Moved from CSS @import in ${issue.file} -->
<link rel="preconnect" href="https://${domain}" crossorigin>
<link rel="preload" as="style" href="${externalUrl}">
<link rel="stylesheet" href="${externalUrl}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${externalUrl}"></noscript>`;
      } else {
        // Generic external stylesheet
        htmlLinks = `<!-- Performance: Moved from CSS @import in ${issue.file} -->
<link rel="preconnect" href="https://${domain}" crossorigin>
<link rel="stylesheet" href="${externalUrl}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${externalUrl}"></noscript>`;
      }
      
      // Try to find and update head.html (common AEM pattern)
      const headHtmlPath = resolve(this.workspaceRoot, 'head.html');
      let htmlFileUpdated = false;
      
      if (existsSync(headHtmlPath)) {
        try {
          const headContent = readFileSync(headHtmlPath, 'utf-8');
          
          // Check if this URL is already in head.html
          if (headContent.includes(externalUrl)) {
            core.info(`  External URL already in head.html: ${externalUrl}`);
            // Just remove from CSS, don't duplicate in HTML
            return {
              originalImportLine,
              inlinedCSS: `/* Removed @import - already loaded in head.html */`,
              importedFile: externalUrl,
              importedLines: 0,
              alternativeFix: `Already optimized in head.html`,
              htmlFileUpdated: false
            };
          }
          
          // Add links before the first existing <link> or <script> tag
          let updatedHead = headContent;
          const insertMarkers = [
            { regex: /(<link[^>]*>)/i, position: 'before' },
            { regex: /(<script[^>]*>)/i, position: 'before' },
            { regex: /(<\/head>)/i, position: 'before' },
          ];
          
          let inserted = false;
          for (const marker of insertMarkers) {
            if (marker.regex.test(updatedHead)) {
              updatedHead = updatedHead.replace(marker.regex, `${htmlLinks}\n$1`);
              inserted = true;
              break;
            }
          }
          
          // Fallback: append at the end
          if (!inserted) {
            updatedHead = `${headContent.trimEnd()}\n${htmlLinks}\n`;
          }
          
          // Write updated head.html
          writeFileSync(headHtmlPath, updatedHead, 'utf-8');
          htmlFileUpdated = true;
          core.info(`  ✓ Added external CSS link to head.html`);
          
        } catch (htmlError) {
          core.warning(`Failed to update head.html: ${htmlError.message}`);
        }
      } else {
        core.warning(`head.html not found at: ${headHtmlPath}`);
      }
      
      // Remove the @import from CSS (clean removal, no comment)
      const cleanRemoval = htmlFileUpdated 
        ? `/* Performance: External CSS moved to head.html (${relative(this.workspaceRoot, headHtmlPath)}) */`
        : `/* ${originalImportLine} */
/* Performance: External CSS should be loaded via HTML <link> tag */
/* MANUAL FIX: Add the following to your HTML <head>: */
${htmlLinks.split('\n').map(line => `/* ${line} */`).join('\n')}`;
      
      return {
        originalImportLine,
        inlinedCSS: cleanRemoval,
        importedFile: externalUrl,
        importedLines: 0,
        alternativeFix: htmlFileUpdated 
          ? `Moved to head.html with optimized preconnect` 
          : `Add <link rel="stylesheet" href="${externalUrl}"> to HTML <head> with preconnect for optimal performance.`,
        htmlFileUpdated,
        htmlFilePath: htmlFileUpdated ? relative(this.workspaceRoot, headHtmlPath) : null
      };
      
    } catch (error) {
      core.warning(`Error generating external import fix: ${error.message}`);
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

**WRONG EXAMPLES (DO NOT do any of these):**
\`\`\`javascript
function formatPhoneNumber(phone, formData, globals) {
  // ❌ WRONG: Compound check with ||
  if (!globals || !globals.functions || typeof globals.functions.setProperty !== 'function') {
    return;
  }
  
  // ❌ WRONG: Individual checks
  if (!globals) return;
  if (!globals.functions) return;
  if (!globals.functions.setProperty) return;
  
  // ❌ WRONG: Typeof checks on OOTB functions
  if (typeof globals.functions.setProperty !== 'function') return;
  
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
4. **NEVER check globals/globals.functions/globals.form** - they are GUARANTEED by AEM runtime
5. **DO NOT use compound checks** like \`if (!globals || !globals.functions || ...)\` - FORBIDDEN
6. **DO NOT use typeof checks** on OOTB functions like \`setProperty\`, \`getProperty\`, etc. - FORBIDDEN
7. PRESERVE function signature (parameters, name) exactly
8. PRESERVE all existing logic and calculations
9. PRESERVE all setProperty, setVariable, dispatchEvent calls
10. DO NOT change variable names or remove any logic
11. ONLY ADD defensive checks - don't refactor or simplify

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

**FORBIDDEN PATTERNS (will be REJECTED):**
❌ \`if (!globals || !globals.functions || ...)\` - compound checks on guaranteed objects
❌ \`if (!globals.functions.setProperty)\` - checking OOTB functions
❌ \`typeof globals.functions.setProperty !== 'function'\` - typeof on OOTB functions
❌ \`if (!globals.form)\` - checking guaranteed form instance

**ONLY check these:**
✅ Function parameters that can be null (e.g., \`phone\`, \`panNumber\`, \`formData\`)
✅ Field values (e.g., \`field.$value\`, \`formData.countryCode\`)
✅ Results from operations (e.g., \`str.split()[0]\`, \`array[index]\`)

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
   * Post PR review comments and check annotations with AI suggestions
   * Uses BOTH:
   * 1. GitHub Checks API (annotations) - Works for ALL files, even not in PR diff
   * 2. PR Review Comments - Only works for files in PR diff, but gives "Apply suggestion" button
   */
  postPRReviewComments = async (httpDomFixes, octokit, owner, repo, prNumber, commitSha) => {
    const reviewComments = [];
    
    // Log what we're about to post
    core.info(`  Attempting to post ${httpDomFixes.length} inline comment(s):`);
    core.info(`  Using commit SHA: ${commitSha}`);
    const typeBreakdown = {};
    httpDomFixes.forEach(fix => {
      typeBreakdown[fix.type] = (typeBreakdown[fix.type] || 0) + 1;
    });
    Object.entries(typeBreakdown).forEach(([type, count]) => {
      core.info(`    - ${type}: ${count}`);
    });
    
    // Fetch existing review comments to avoid duplicates
    core.info(`  Fetching existing PR comments to avoid duplicates...`);
    let existingComments = [];
    try {
      const { data: comments } = await octokit.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number: prNumber,
      });
      existingComments = comments;
      core.info(`  Found ${existingComments.length} existing comment(s) on this PR`);
    } catch (error) {
      core.warning(`  Failed to fetch existing comments: ${error.message}`);
    }
    
    // Try PR Review Comments for files in PR diff (gives "Apply suggestion" button)
    for (const fix of httpDomFixes) {
      try {
        // Check if comment already exists on this line
        const existingComment = existingComments.find(comment => 
          comment.path === fix.file && 
          comment.line === (fix.line || 1) &&
          (comment.user.login === 'github-actions[bot]' || 
           comment.body.includes('AEM Forms Performance'))
        );
        
        if (existingComment) {
          core.info(`  ⊘ Skipped ${fix.file}:${fix.line} (${fix.functionName}) - comment already exists (ID: ${existingComment.id})`);
          continue;
        }
        
        const commentBody = this.buildPRLineCommentBody(fix);
        
        core.info(`  Posting comment: ${fix.file}:${fix.line} (${fix.functionName}, ${fix.type})`);
        
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
        
        core.info(`  ✓ Posted ${fix.type} comment on ${fix.file}:${fix.line || 1} (${fix.functionName || 'N/A'})`);
        reviewComments.push(fix);
        
      } catch (error) {
        // GitHub returns 422 for various reasons (file/line not in diff, invalid SHA, etc.)
        if (error.status === 422) {
          const errorDetails = error.response?.data?.message || error.message;
          core.info(`  ✗ GitHub rejected comment on ${fix.file}:${fix.line} - ${fix.type} for ${fix.functionName || 'N/A'}`);
          core.info(`     Reason: ${errorDetails}`);
          core.info(`     This usually means the line is not in the PR diff (only changed lines can have comments)`);
        } else {
          core.warning(`  ✗ Failed to post comment on ${fix.file}: ${error.message}`);
        }
      }
    }
    
    core.info(`  Summary: ${reviewComments.length} inline comment(s) posted successfully`);
    return { reviewComments };
  }
  
  /**
   * Format testing steps for better readability
   * Handles both numbered lists and plain text
   */
  formatTestingSteps = (testingSteps) => {
    if (!testingSteps) return 'Test the changes in a development environment';
    
    // If already formatted with newlines, return as-is
    if (testingSteps.includes('\n')) {
      return testingSteps;
    }
    
    // Try to split by numbered patterns (1. 2. 3. or 1) 2) 3))
    const numberedPattern = /(\d+[\.)]\s+)/g;
    const parts = testingSteps.split(numberedPattern).filter(p => p.trim());
    
    if (parts.length > 2) {
      // Has numbered steps, reconstruct with proper line breaks
      const formatted = [];
      for (let i = 0; i < parts.length; i += 2) {
        if (parts[i + 1]) {
          const stepNum = parts[i].trim();
          const stepText = parts[i + 1].trim();
          
          // Truncate long steps
          const truncated = stepText.length > 120 
            ? stepText.substring(0, 117) + '...' 
            : stepText;
          
          formatted.push(`${stepNum} ${truncated}`);
        }
      }
      return formatted.join('\n');
    }
    
    // If very long single sentence, truncate
    if (testingSteps.length > 200) {
      return testingSteps.substring(0, 197) + '...';
    }
    
    return testingSteps;
  }

  /**
   * Build annotation message for GitHub Checks
   */
  buildAnnotationMessage = (fix) => {
    if (fix.type === 'custom-function-http-fix') {
      return `Function ${fix.functionName}() makes direct HTTP call. FIX: (1) Refactor function code to remove request() call, (2) Add API integration via Visual Rule Editor.`;
    } else if (fix.type === 'custom-function-dom-fix') {
      const componentHint = fix.componentFile ? ` Move DOM logic to component: ${fix.componentFile}.` : ' Move DOM manipulation to a custom component.';
      return `Function ${fix.functionName}() accesses DOM directly.${componentHint} Use setProperty() to store STATE (data/flags), component reads STATE and updates DOM.`;
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
      
      // Show specific HTTP requests found
      if (fix.details && Array.isArray(fix.details) && fix.details.length > 0) {
        const count = fix.details.length;
        lines.push(`**Issue:** Function \`${fix.functionName}()\` makes ${count} HTTP request${count > 1 ? 's' : ''}:`);
        lines.push('');
        fix.details.slice(0, 5).forEach(detail => {
          lines.push(`- \`${detail.type}()\`${detail.line ? ` at line ${detail.line}` : ''}`);
        });
        if (fix.details.length > 5) {
          lines.push(`- ... and ${fix.details.length - 5} more`);
        }
      } else {
        lines.push(`**Issue:** Function \`${fix.functionName}()\` makes direct HTTP request.`);
      }
      lines.push('');
      
      // NO ```suggestion syntax - guidance only (no code to apply)
      if (fix.guidance) {
        lines.push(fix.guidance);
      }
      
    } else if (fix.type === 'custom-function-dom-fix') {
      lines.push(`##  DOM Access in Custom Function`);
      lines.push('');
      
      // Show specific DOM accesses found
      if (fix.details && Array.isArray(fix.details) && fix.details.length > 0) {
        const count = fix.details.length;
        lines.push(`**Issue:** Function \`${fix.functionName}()\` has ${count} DOM access${count > 1 ? 'es' : ''}:`);
        lines.push('');
        fix.details.slice(0, 5).forEach(detail => {
          lines.push(`- \`${detail.type}\`${detail.line ? ` at line ${detail.line}` : ''}`);
        });
        if (fix.details.length > 5) {
          lines.push(`- ... and ${fix.details.length - 5} more`);
        }
      } else {
        lines.push(`**Issue:** Function \`${fix.functionName}()\` directly manipulates DOM.`);
      }
      lines.push('');
      
      // NO ```suggestion syntax - guidance only (no code to apply)
      if (fix.guidance) {
        lines.push(fix.guidance);
      }
      
    } else if (fix.type === 'custom-function-runtime-error-fix') {
      lines.push(`##  Runtime Error in Custom Function`);
      lines.push('');
      lines.push(`**Issue:** Function \`${fix.functionName}()\` throws runtime errors - ${fix.description}`);
      lines.push('');
      lines.push('**Fixed function with defensive null checks:**');
      lines.push('```suggestion');
      lines.push(fix.refactoredCode || '// AI-generated code with null checks');
      lines.push('```');
      lines.push('');
      if (fix.testingSteps) {
        lines.push('**Testing:**');
        lines.push(fix.testingSteps);
        lines.push('');
      }
      
    } else if (fix.type === 'css-background-image-fix') {
      lines.push(`##  CSS Background-Image Performance Issue`);
      lines.push('');
      lines.push(fix.description);
      lines.push('');
      
      // If AI-generated fix available (component found)
      if (fix.fixedCSSCode || fix.fixedComponentCode) {
        lines.push('**Step 1: Update CSS** (comment out background-image):');
        lines.push('```suggestion');
        lines.push(fix.fixedCSSCode || fix.originalCode);
        lines.push('```');
        lines.push('');
        if (fix.fixedComponentCode) {
          lines.push('**Step 2: Update Component** (add lazy-loaded <img> tag):');
          lines.push('```javascript');
          lines.push(fix.fixedComponentCode);
          lines.push('```');
          lines.push('');
        }
        if (fix.htmlSuggestion) {
          lines.push('**Alternative: Use <img> tag directly:**');
          lines.push('```html');
          lines.push(fix.htmlSuggestion);
          lines.push('```');
          lines.push('');
        }
      } else if (fix.guidance) {
        // Manual guidance only (no component found)
        lines.push(fix.guidance);
      }
      
    } else if (fix.type === 'css-import-suggestion') {
      lines.push(`##  CSS @import ${fix.isExternal ? 'External URL' : 'Local File'}`);
      lines.push('');
      lines.push(fix.description);
      lines.push('');
      
      if (fix.isExternal) {
        // External URL: GitHub automatically shows "Apply suggestion" button
        lines.push('```suggestion');
        lines.push(fix.suggestedCode);
        lines.push('```');
        lines.push('');
      }
      
      // Add guidance
      if (fix.guidance) {
        lines.push(fix.guidance);
      }
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
      
      // Check for incomplete response (function too large)
      if (data.status === 'incomplete' && data.incomplete_details?.reason === 'max_output_tokens') {
        core.warning(`  Function too large for AI refactoring (exceeded max_output_tokens)`);
        throw new Error('Function too large for AI refactoring');
      }
      
      // Check for content filter blocks
      if (data.content_filters) {
        core.warning(`  Content filtered: ${JSON.stringify(data.content_filters)}`);
        throw new Error('AI response blocked by content filter');
      }
      
      // Check for explicit error
      if (data.error) {
        core.warning(`  API error: ${JSON.stringify(data.error)}`);
        throw new Error('AI API error');
      }
      
      // Check for other incomplete reasons
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
      // If JSON.parse fails, try to extract code from malformed response
      // AI sometimes returns literal newlines instead of escaped \n
      core.warning(`Failed to parse AI response as JSON (trying fallback extraction)`);
      core.warning(`Error: ${error.message}`);
      
      // Helper to extract field value (handles literal newlines)
      const extractField = (fieldName, content) => {
        // Try to match: "fieldName": "value" or "fieldName": `value`
        // Use non-greedy match and handle escaped quotes
        const patterns = [
          new RegExp(`"${fieldName}"\\s*:\\s*"([\\s\\S]*?)"\\s*[,}]`),
          new RegExp(`"${fieldName}"\\s*:\\s*\`([\\s\\S]*?)\`\\s*[,}]`)
        ];
        
        for (const pattern of patterns) {
          const match = content.match(pattern);
          if (match) {
            return match[1]
              .replace(/\\n/g, '\n')        // Unescape \n
              .replace(/\\"/g, '"')         // Unescape \"
              .replace(/\\\\/g, '\\')       // Unescape \\
              .replace(/\\t/g, '\t');       // Unescape \t
          }
        }
        return null;
      };
      
      // Try to extract common fields
      const extracted = {
        jsCode: extractField('jsCode', cleanContent),
        reason: extractField('reason', cleanContent),
        originalCSSCode: extractField('originalCSSCode', cleanContent),
        fixedCSSCode: extractField('fixedCSSCode', cleanContent),
        originalComponentCode: extractField('originalComponentCode', cleanContent),
        fixedComponentCode: extractField('fixedComponentCode', cleanContent),
        htmlSuggestion: extractField('htmlSuggestion', cleanContent),
        explanation: extractField('explanation', cleanContent),
        componentExample: extractField('componentExample', cleanContent),
        componentSuggestion: extractField('componentSuggestion', cleanContent),
        testingSteps: extractField('testingSteps', cleanContent),
        formJsonSnippet: extractField('formJsonSnippet', cleanContent)
      };
      
      // Remove null values
      const result = {};
      for (const [key, value] of Object.entries(extracted)) {
        if (value !== null) {
          result[key] = value;
          core.info(`  Extracted ${key}: ${value.length} chars`);
        }
      }
      
      if (Object.keys(result).length > 0) {
        core.info(`Fallback extraction succeeded (${Object.keys(result).length} fields)`);
        return result;
      }
      
      core.warning(`Fallback extraction found no fields. Response preview: ${cleanContent.substring(0, 200)}...`);
      throw new Error('AI response was not valid JSON');
    }
  }
}

