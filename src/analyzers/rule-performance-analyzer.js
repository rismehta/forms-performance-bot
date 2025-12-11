import { createFormInstance, createFormInstanceSync, FunctionRuntime } from '@aemforms/af-core';
import * as core from '@actions/core';
import { resolve, join, relative } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import nodeCrypto from 'crypto';
import vm from 'vm';

/**
 * Analyzes form rules for performance issues:
 * 1. Circular dependencies (cycles) - causes infinite loops
 * 2. Slow rule execution (runtime profiling) - blocks rendering
 * 
 * Uses @aemforms/af-core to leverage the built-in dependency tracking
 * and hooks into RuleEngine.execute() to measure actual execution times
 */
export class RulePerformanceAnalyzer {
  constructor(config = null) {
    this.config = config;
    this.slowRuleThreshold = config?.thresholds?.form?.slowRuleThreshold || 50; // ms
  }

  /**
   * Analyze form JSON for rule cycles and slow rules
   * @param {Object} formJson - Form JSON object
   * @returns {Promise<Object>} Analysis results with cycles and slow rules
   */
  async analyze(formJson) {
    if (!formJson) {
      return { error: 'No form JSON provided' };
    }

    // Validate form JSON
    if (typeof formJson === 'string') {
      try {
        formJson = JSON.parse(formJson);
      } catch (e) {
        return { error: 'Invalid form JSON: Unable to parse' };
      }
    }

    if (typeof formJson !== 'object' || Array.isArray(formJson)) {
      return { error: 'Form JSON must be an object' };
    }

    // Check if this is a valid AEM form JSON
    // AEM forms use :items (with colon) or items
    const hasItems = (formJson[':items'] && typeof formJson[':items'] === 'object') || 
                     (formJson.items && Array.isArray(formJson.items));
    const hasFormProperties = formJson.fieldType === 'form' || formJson[':type'] === 'fd/franklin/components/form/v1/form';
    
    if (!hasItems && !hasFormProperties) {
      core.info('Form validation: No :items or items found, no form properties');
      return {
        totalRules: 0,
        fieldsWithRules: 0,
        dependencies: {},
        cycles: 0,
        cycleDetails: [],
        issues: [],
        circularDependencies: [],
        skipped: true,
        skipReason: 'Form JSON structure not recognized - missing :items or items',
      };
    }
    
    // If form has form properties but no items, skip (empty form)
    if (!hasItems) {
      core.info('Form has no :items or items to analyze (empty form)');
      return {
        totalRules: 0,
        fieldsWithRules: 0,
        dependencies: {},
        cycles: 0,
        cycleDetails: [],
        issues: [],
        circularDependencies: [],
        skipped: true,
        skipReason: 'Form has no items to analyze',
      };
    }

    try {
      // Register custom functions for form initialization
      // Try to load real custom function implementations from the checked-out repository
      const customFunctionsPath = formJson.properties?.customFunctionsPath;
      
      let realFunctions = {};
      let loadedCount = 0;
      let functionFailures = null;
      let customFunctionsFilePath = null; // Track the actual file path for runtime errors
      
      if (customFunctionsPath) {
        const result = await this.loadCustomFunctions(customFunctionsPath);
        if (result) {
          realFunctions = result.functions;
          loadedCount = result.count;
          functionFailures = result.failureTracker;
          customFunctionsFilePath = result.filePath; // Store actual file path
        }
      }
      
      // Extract ALL function names used in the form
      const functionNames = this.extractAllFunctionNames(formJson);
      core.info(`Detected ${functionNames.length} function(s) in form, loaded ${loadedCount} real implementation(s)`);
      
      // Register real functions first (if any)
      if (loadedCount > 0) {
        FunctionRuntime.registerFunctions(realFunctions);
      }
      
      // Create mocks for remaining functions
      const mockFunctions = {};
      functionNames.forEach(fnName => {
        if (!realFunctions[fnName]) {
          mockFunctions[fnName] = (...args) => Promise.resolve(null);
        }
      });
      
      if (Object.keys(mockFunctions).length > 0) {
        FunctionRuntime.registerFunctions(mockFunctions);
      }
      
      core.info(`Registered ${loadedCount} real + ${Object.keys(mockFunctions).length} mock function(s)`);
      
      // RUNTIME PROFILING: Hook into RuleEngine.execute() to measure actual rule execution times
      const slowRules = [];
      const ruleExecutionCounts = new Map(); // Track how many times each rule executes
      let originalExecute = null;
      const that = this; // Capture 'this' for use in callback
      
      // Helper: Find the ancestor with dataRef: null
      const findNullDataRefAncestor = (ancestors) => {
        // Walk from closest to farthest ancestor
        for (let i = ancestors.length - 1; i >= 0; i--) {
          if (ancestors[i].dataRef === null) {
            return {
              ancestor: ancestors[i],
              depth: ancestors.length - i, // How many levels up
              path: ancestors.slice(i).map(a => a.name || a.id).join(' > ')
            };
          }
        }
        return null;
      };

      // CAPTURE FORM VALIDATION ERRORS: Intercept console.error to capture af-core validation warnings
      const validationErrors = {
        dataRefErrors: [],
        typeConflicts: []
      };
      
      // Collect raw errors during instantiation (defer processing until form is ready)
      const rawDataRefErrors = [];
      const rawTypeConflicts = [];
      
      const originalConsoleError = console.error;
      console.error = (...args) => {
        const message = args[0];
        if (typeof message === 'string') {
          // Capture dataRef parsing errors (don't process - fields not yet instantiated)
          if (message.includes('Error parsing dataRef')) {
            const match = message.match(/Error parsing dataRef "([^"]+)" for field "([^"]+)"/);
            if (match) {
              rawDataRefErrors.push({ dataRef: match[1], fieldId: match[2], message });
              return; // Process after form instantiation
            }
          }
          // Capture type conflict errors (don't process - collect for later)
          else if (message.includes('Type conflict detected')) {
            rawTypeConflicts.push({ message });
            return; // Process after form instantiation
          }
        }
        // Still call original console.error for logging
        originalConsoleError(...args);
      };
      
      // Use createFormInstanceSync with callback to hook into RuleEngine BEFORE event queue runs
      // This ensures ExecuteRule event completes and dependencies are tracked
      // After this call returns, all rules have executed and _dependents arrays are populated
      // Note: af-core internally calls sitesModelToFormModel() to handle :items/:itemsOrder transformation
      let form;
      try {
        core.info('Creating form instance with af-core (profiling rule execution)...');
        
        // Use callback to access form BEFORE event queue runs
        form = await createFormInstanceSync(formJson, (f) => {
          // RuleEngine is not exported from af-core, so we get it from the form instance
          // The callback runs BEFORE f.getEventQueue().runPendingQueue() is called
          const RuleEngine = f.ruleEngine.constructor;
          originalExecute = RuleEngine.prototype.execute;
          
          // Hook into RuleEngine.prototype.execute to measure rule execution times
          RuleEngine.prototype.execute = function(node, data, globals, useValueOf, eString) {
            const start = performance.now();
            const result = originalExecute.call(this, node, data, globals, useValueOf, eString);
            const duration = performance.now() - start;
            
            // Track execution
            const fieldName = globals?.field?.name || 'unknown';
            const eventType = globals?.$event?.type || 'unknown';
            const ruleKey = `${fieldName}:${eString}`;
            
            // Count executions
            ruleExecutionCounts.set(ruleKey, (ruleExecutionCounts.get(ruleKey) || 0) + 1);
            
            // Flag slow rules (only if they take significant time)
            if (duration > that.slowRuleThreshold) {
              slowRules.push({
                field: fieldName,
                expression: eString.substring(0, 150), // Truncate long expressions
                duration: Math.round(duration * 10) / 10, // Round to 1 decimal
                event: eventType,
              });
            }
            
            return result;
          };
        }, 'off');
        
        core.info('Form instance created successfully');
      } catch (coreError) {
        // If af-core fails to create the form instance, return gracefully
        core.error(`af-core failed to create form instance: ${coreError.message}`);
        return {
          totalRules: 0,
          fieldsWithRules: 0,
          dependencies: {},
          cycles: 0,
          cycleDetails: [],
          issues: [],
          circularDependencies: [],
          skipped: true,
          skipReason: `Unable to analyze form structure: ${coreError.message}`,
        };
      }
      
      // Log function execution failures if any occurred during rule execution
      if (functionFailures && functionFailures.size > 0) {
        core.info(`[CustomFunctions] ${functionFailures.size} function(s) encountered errors during execution:`);
        let loggedCount = 0;
        for (const [fnName, failure] of functionFailures.entries()) {
          if (loggedCount < 5) { // Only log first 5 to avoid noise
            const errorMessages = Array.from(failure.errors).join(', ');
            core.info(`[CustomFunctions]   - ${fnName}(): ${failure.count} error(s) - ${errorMessages}`);
            loggedCount++;
          }
        }
        if (functionFailures.size > 5) {
          core.info(`[CustomFunctions]   ... and ${functionFailures.size - 5} more function(s) with errors`);
        }
        core.info(`[CustomFunctions] Note: Errors are expected for functions accessing formData/globals in test context`);
      }
      
      // Restore original RuleEngine.execute (if it was hooked)
      if (originalExecute && form) {
        const RuleEngine = form.ruleEngine.constructor;
        RuleEngine.prototype.execute = originalExecute;
      }
      
      // After createFormInstance returns, the event queue has run and dependencies are tracked
      // Now build the dependency graph from the form instance's internal state
      core.info('Building dependency graph from form instance...');
      const dependencyGraph = this.buildDependencyGraphFromForm(form);
      core.info(`Rule detection: Found ${dependencyGraph.totalRules} rules in ${dependencyGraph.fieldsWithRules} fields`);
      
      const cycles = this.detectCycles(dependencyGraph);
      if (cycles.length > 0) {
        core.warning(`Detected ${cycles.length} circular dependenc${cycles.length > 1 ? 'ies' : 'y'} in rules`);
      }
      const issues = this.generateIssues(cycles);

      // Process slow rules
      const sortedSlowRules = slowRules
        .sort((a, b) => b.duration - a.duration) // Sort by duration descending
        .slice(0, 10); // Top 10 slowest
      
      if (sortedSlowRules.length > 0) {
        core.warning(`Detected ${slowRules.length} slow rule execution(s) (> ${this.slowRuleThreshold}ms)`);
        core.info(`Top ${Math.min(3, sortedSlowRules.length)} slowest rules:`);
        sortedSlowRules.slice(0, 3).forEach(rule => {
          core.info(`  - Field "${rule.field}" took ${rule.duration}ms during ${rule.event}`);
        });
      }

      // Convert functionFailures Map to array for reporting
      const runtimeErrors = [];
      if (functionFailures && functionFailures.size > 0) {
        for (const [fnName, failure] of functionFailures.entries()) {
          runtimeErrors.push({
            functionName: fnName,
            file: customFunctionsFilePath, // Add the actual file path (e.g., eds-li/blocks/form/functions.js)
            errorCount: failure.count,
            errors: Array.from(failure.errors),
            severity: 'warning', // Runtime errors are warnings, not critical errors
            type: 'runtime-error-in-custom-function',
            recommendation: `Function "${fnName}" throws errors during execution. Review function logic to handle missing or null values gracefully.`
          });
        }
      }

      // Restore console.error
      console.error = originalConsoleError;
      
      // NOW process the collected errors (form is fully instantiated, fields are available)
      core.info(`Processing ${rawDataRefErrors.length} dataRef error(s) and ${rawTypeConflicts.length} type conflict(s)...`);
      
      // Helper: Get parent chain from instantiated form model (uses .parent references)
      // This matches exactly how af-core checks dataRef - walks up the .parent chain
      const getModelParentChain = (field) => {
        const ancestors = [];
        let current = field.parent;
        while (current && current.id !== formJson.id) { // Stop at form root
          ancestors.push({
            id: current.id,
            name: current.name,
            fieldType: current.fieldType,
            dataRef: current.dataRef
          });
          current = current.parent;
        }
        return ancestors; // Closest to farthest
      };
      
      // Process dataRef errors - ALWAYS use form model hierarchy (not JSON structure)
      for (const raw of rawDataRefErrors) {
        let fieldInfo = null;
        
        if (form) {
          try {
            const field = form.getElement(raw.fieldId);
            if (field) {
              // Get ancestor chain from MODEL's .parent references
              // This is the ACTUAL hierarchy af-core uses for dataRef checking
              const modelAncestors = getModelParentChain(field);
              
              fieldInfo = {
                field: { id: field.id, name: field.name, fieldType: field.fieldType },
                ancestors: modelAncestors
              };
            }
          } catch (e) {
            // Field doesn't exist in form
          }
        }
        
        if (!fieldInfo) {
          // Field not found in instantiated form
          validationErrors.dataRefErrors.push({
            fieldId: raw.fieldId,
            dataRef: raw.dataRef,
            rootCause: 'field_not_found',
            message: raw.message,
            ancestorChain: [],
            nullAncestor: null
          });
          continue;
        }
        
        // Build ancestor chain
        const ancestorChain = fieldInfo.ancestors.map(a => ({
          id: a.id,
          name: a.name || a.id,
          dataRef: a.dataRef
        }));
        
        // Find null ancestor
        const nullAncestor = findNullDataRefAncestor(fieldInfo.ancestors);
        
        validationErrors.dataRefErrors.push({
          dataRef: raw.dataRef,
          fieldId: raw.fieldId,
          fieldName: fieldInfo.field.name || 'unknown',
          message: raw.message,
          nullAncestor: nullAncestor ? {
            id: nullAncestor.ancestor.id || 'unknown',
            name: nullAncestor.ancestor.name || 'unknown',
            depth: nullAncestor.depth,
            path: nullAncestor.path
          } : null,
          ancestorChain,
          rootCause: nullAncestor ? 'ancestor_null_dataref' : 'no_null_ancestor_found'
        });
      }
      
      // Process type conflicts
      for (const raw of rawTypeConflicts) {
        const dataRefMatch = raw.message.match(/DataRef:\s*(\S+)/);
        const newFieldMatch = raw.message.match(/New field '([^']+)'\s*\(([^)]+)\)/);
        const conflictsMatch = raw.message.match(/conflicts with:\s*(.+?)(?:\.\s*DataRef|$)/);
        
        if (newFieldMatch) {
          validationErrors.typeConflicts.push({
            dataRef: dataRefMatch ? dataRefMatch[1] : 'unknown',
            newField: newFieldMatch[1],
            newFieldType: newFieldMatch[2],
            conflictingFields: conflictsMatch ? conflictsMatch[1] : '',
            message: raw.message
          });
        }
      }
      
      // Log summary (not individual fields - too verbose)
      if (validationErrors.dataRefErrors.length > 0) {
        core.info(` Found ${validationErrors.dataRefErrors.length} dataRef parsing error(s)`);
        
        const notFound = validationErrors.dataRefErrors.filter(e => e.rootCause === 'field_not_found').length;
        const noNullAncestor = validationErrors.dataRefErrors.filter(e => e.rootCause === 'no_null_ancestor_found').length;
        const withNullAncestor = validationErrors.dataRefErrors.filter(e => e.rootCause === 'ancestor_null_dataref').length;
        
        if (notFound > 0) {
          core.info(`   ${notFound} field(s) not found (may be in fragments/conditional panels)`);
        }
        if (withNullAncestor > 0) {
          core.info(`   ${withNullAncestor} field(s) have ancestor with dataRef: null`);
        }
        if (noNullAncestor > 0) {
          core.warning(`   ${noNullAncestor} field(s) fail dataRef parsing but NO ancestor has dataRef: null (unexpected)`);
          core.warning(`   Detailed ancestor chains for investigation:`);
          
          validationErrors.dataRefErrors
            .filter(e => e.rootCause === 'no_null_ancestor_found')
            .slice(0, 5) // Show first 5 to avoid log spam
            .forEach(error => {
              const ancestorPath = error.ancestorChain.length > 0
                ? error.ancestorChain.map(a => `${a.name}(dataRef: ${a.dataRef === null ? 'NULL' : a.dataRef || 'undefined'})`).join(' > ')
                : 'No ancestors';
              core.warning(`     Field "${error.fieldName}" (dataRef: "${error.dataRef}")`);
              core.warning(`       Ancestor chain: ${ancestorPath}`);
            });
          
          if (noNullAncestor > 5) {
            core.warning(`     ... and ${noNullAncestor - 5} more field(s) - see HTML report for full details`);
          }
        }
      }
      if (validationErrors.typeConflicts.length > 0) {
        core.info(` Found ${validationErrors.typeConflicts.length} type conflict(s)`);
      }

      return {
        totalRules: dependencyGraph.totalRules,
        fieldsWithRules: dependencyGraph.fieldsWithRules,
        dependencies: dependencyGraph.dependencies,
        cycles: cycles.length,
        cycleDetails: cycles,
        slowRules: sortedSlowRules, // Add slow rules to results
        slowRuleCount: slowRules.length,
        issues,
        circularDependencies: cycles.map(cycle => ({
          cycle: cycle.fields || cycle.path,
          fields: cycle.fields,
        })),
        runtimeErrors, // NEW: Runtime errors for AI to fix
        runtimeErrorCount: runtimeErrors.length,
        validationErrors, // NEW: Form validation errors from af-core
        validationErrorCount: validationErrors.dataRefErrors.length + validationErrors.typeConflicts.length,
      };
    } catch (error) {
      // Restore console.error in catch block too
      console.error = originalConsoleError;
      
      console.error('Error analyzing rule cycles:', error);
      return {
        totalRules: 0,
        fieldsWithRules: 0,
        dependencies: {},
        cycles: 0,
        cycleDetails: [],
        issues: [],
        circularDependencies: [],
        skipped: true,
        skipReason: `Analysis error: ${error.message}`,
      };
    }
  }


  /**
   * Load custom function implementations from the checked-out repository
   * Removes export statements and evaluates in a sandboxed vm context
   * @param {string} customFunctionsPath - Path like "/blocks/form/functions.js"
   * @returns {Promise<Object|null>} {functions: {...}, count: number} or null
   */
  /**
   * Recursively search for a file matching the given path suffix
   * @param {string} dir - Directory to search in
   * @param {string} targetPath - Path suffix to match (e.g., "liabilities/insta_savings_journey/functions.js")
   * @param {number} maxDepth - Maximum recursion depth
   * @returns {string|null} Absolute path to the file or null
   */
  findFileByPathSuffix(dir, targetPath, maxDepth = 5) {
    if (maxDepth <= 0) return null;
    
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        // Skip common directories we don't want to search
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
          continue;
        }
        
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Recursively search all directories
          const found = this.findFileByPathSuffix(fullPath, targetPath, maxDepth - 1);
          if (found) return found;
        } else if (entry.isFile()) {
          // Check if the relative path from repo root ends with our target path
          const relativePath = relative(process.cwd(), fullPath);
          if (relativePath.endsWith(targetPath)) {
            return fullPath;
          }
        }
      }
    } catch (error) {
      // Ignore permission errors, etc.
      return null;
    }
    
    return null;
  }

  async loadCustomFunctions(customFunctionsPath) {
    if (!customFunctionsPath) {
      return null;
    }

    try {
      // Try specified path first
      const normalizedPath = customFunctionsPath.replace(/^\/+/, '');
      let absolutePath = resolve(process.cwd(), normalizedPath);
      
      // If not found, search for the file in the repository
      if (!existsSync(absolutePath)) {
        core.info(`Custom functions file not found at specified path: ${absolutePath}`);
        core.info(`Searching repository for file matching: ${normalizedPath}`);
        
        const foundPath = this.findFileByPathSuffix(process.cwd(), normalizedPath);
        
        if (foundPath) {
          absolutePath = foundPath;
          core.info(`Found custom functions at: ${absolutePath}`);
        } else {
          core.info(`Custom functions file not found: ${normalizedPath}`);
          return null;
        }
      }
      
      core.info(`Loading custom functions from: ${absolutePath}`);
      
      // Read the ESM module source code
      let sourceCode = readFileSync(absolutePath, 'utf-8');
      
      // Extract function names from export block (export { fn1, fn2, ... })
      const exportMatch = sourceCode.match(/export\s*\{([^}]+)\}/s);
      let exportedNames = [];
      if (exportMatch) {
        exportedNames = exportMatch[1]
          .split(',')
          .map(name => name.trim())
          .filter(name => name && !name.startsWith('//'));
        core.info(`Found ${exportedNames.length} exported names in export block`);
      }
      
      // Remove ALL export statements to make it executable in non-ESM context
      sourceCode = sourceCode
        .replace(/export\s+async\s+function\s+/g, 'async function ')  // export async function
        .replace(/export\s+function\s+/g, 'function ')                // export function
        .replace(/export\s+const\s+/g, 'const ')                      // export const
        .replace(/export\s+let\s+/g, 'let ')                          // export let
        .replace(/export\s+var\s+/g, 'var ')                          // export var
        .replace(/export\s+class\s+/g, 'class ')                      // export class
        .replace(/export\s*\{[^}]+\}/gs, '')                           // remove export { ... }
        .replace(/export\s+default\s+/g, '');                          // export default
      
      // Create sandbox with browser globals
      const sandbox = {
        console,
        crypto: nodeCrypto.webcrypto || nodeCrypto,
        window: {
          msCrypto: undefined,
          location: { href: '', protocol: 'https:' },
          navigator: { userAgent: 'Node.js' },
          document: {},
          addEventListener: () => {},
          removeEventListener: () => {},
          getComputedStyle: () => ({}),
          matchMedia: () => ({ matches: false }),
        },
        document: {
          createElement: () => ({}),
          querySelector: () => null,
          querySelectorAll: () => [],
          getElementById: () => null,
          body: {},
          head: {},
          addEventListener: () => {},
        },
      };
      
      // Create context and run script
      const context = vm.createContext(sandbox);
      vm.runInContext(sourceCode, context, {
        filename: 'functions.js',
        timeout: 10000,
      });
      
      // Collect exported functions from the context
      const functions = {};
      let loadedCount = 0;
      
      // Track function execution failures for debugging
      const functionFailures = new Map(); // functionName -> { count, errors: Set }
      
      for (const name of exportedNames) {
        if (typeof context[name] === 'function') {
          // Wrap in try-catch for safe execution
          // Custom functions may reference globals.form, formData, etc. that don't exist in test context
          // Log failures but continue execution to prevent crashes
          functions[name] = function safeFunctionWrapper(...args) {
            try {
              const result = context[name].apply(this, args);
              
              // If result is a promise, catch rejections
              if (result && typeof result.then === 'function') {
                return result.catch((err) => {
                  // Log promise rejection with stack trace
                  if (!functionFailures.has(name)) {
                    functionFailures.set(name, { count: 0, errors: new Set() });
                  }
                  const failure = functionFailures.get(name);
                  failure.count++;
                  
                  // Capture full error details including stack trace
                  const errorDetails = {
                    message: err?.message || 'Promise rejected',
                    stack: err?.stack || '',
                    name: err?.name || 'Error'
                  };
                  failure.errors.add(JSON.stringify(errorDetails));
                  return null;
                });
              }
              
              return result;
            } catch (e) {
              // Log sync error with stack trace - functions expect different runtime context
              if (!functionFailures.has(name)) {
                functionFailures.set(name, { count: 0, errors: new Set() });
              }
              const failure = functionFailures.get(name);
              failure.count++;
              
              // Capture full error details including stack trace
              const errorDetails = {
                message: e?.message || 'Unknown error',
                stack: e?.stack || '',
                name: e?.name || 'Error'
              };
              failure.errors.add(JSON.stringify(errorDetails));
              return null;
            }
          };
          loadedCount++;
        }
      }
      
      core.info(`Successfully loaded ${loadedCount} real function(s)`);
      
      // Make path relative to workspace root for consistency
      const workspaceRoot = process.cwd();
      const relativePath = absolutePath.startsWith(workspaceRoot) 
        ? absolutePath.substring(workspaceRoot.length + 1) 
        : absolutePath;
      
      return { 
        functions, 
        count: loadedCount, 
        failureTracker: functionFailures,
        filePath: relativePath // Return workspace-relative path (e.g., eds-li/blocks/form/functions.js)
      };
      
    } catch (error) {
      core.warning(`Could not load custom functions: ${error.message}`);
      core.warning(`Stack: ${error.stack}`);
      return null;
    }
  }

  /**
   * Extract all function names from form JSON (rules, events, expressions)
   * @param {Object} formJson - Form JSON object
   * @returns {Array<string>} Array of unique function names
   */
  extractAllFunctionNames(formJson) {
    const functionNames = new Set();
    const functionPattern = /(\w+)\s*\(/g;
    
    // JavaScript keywords that should NOT be treated as custom functions
    const jsKeywords = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
      'return', 'throw', 'try', 'catch', 'finally', 'typeof', 'instanceof',
      'new', 'delete', 'void', 'yield', 'await', 'async', 'function',
      'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
      'var', 'let', 'const', 'class', 'extends', 'super', 'this',
      'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Math',
      'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI'
    ]);

    const extractFromString = (str) => {
      if (typeof str !== 'string') return;
      let match;
      while ((match = functionPattern.exec(str)) !== null) {
        const fnName = match[1];
        // Only add if it's not a JavaScript keyword
        if (!jsKeywords.has(fnName)) {
          functionNames.add(fnName);
        }
      }
    };

    const traverse = (node) => {
      if (!node || typeof node !== 'object') return;

      // Check events
      if (node.events && typeof node.events === 'object') {
        Object.values(node.events).forEach(eventHandlers => {
          if (Array.isArray(eventHandlers)) {
            eventHandlers.forEach(handler => extractFromString(handler));
          } else {
            extractFromString(eventHandlers);
          }
        });
      }

      // Check rules
      if (node.rules && typeof node.rules === 'object') {
        Object.values(node.rules).forEach(rule => {
          if (typeof rule === 'object' && rule.expression) {
            extractFromString(rule.expression);
          } else {
            extractFromString(rule);
          }
        });
      }

      // Check validation/display expressions
      if (node.validationExpression) extractFromString(node.validationExpression);
      if (node.displayValueExpression) extractFromString(node.displayValueExpression);

      // Traverse children
      if (node[':items']) {
        Object.values(node[':items']).forEach(child => traverse(child));
      }
      if (node.items && Array.isArray(node.items)) {
        node.items.forEach(child => traverse(child));
      }
    };

    traverse(formJson);
    return Array.from(functionNames);
  }

  /**
   * Build dependency graph from form instance
   * After createFormInstanceSync returns, ExecuteRule has run and dependencies are tracked
   * in each field's _dependents array by RuleEngine.trackDependency()
   * @param {Object} form - Form instance from createFormInstanceSync
   * @returns {Object} Dependency graph
   */
  buildDependencyGraphFromForm(form) {
    const graph = {
      totalRules: 0,
      fieldsWithRules: 0,
      dependencies: {},
      fieldMap: {}, // Map field IDs to names for lookup
    };

    let visitedFieldCount = 0;

    // Visit each field in the form using the built-in visitor
    form.visit((field) => {
      visitedFieldCount++;
      const fieldName = field.name;
      const fieldId = field.id;
      
      if (!fieldName) return; // Skip fields without names (transparent nodes)

      // Store field mapping
      graph.fieldMap[fieldId] = fieldName;

      // Check if field has rules
      const fieldJson = field._jsonModel || {};
      
      if (fieldJson.rules && typeof fieldJson.rules === 'object') {
        const ruleProperties = Object.keys(fieldJson.rules);
        
        if (ruleProperties.length > 0) {
          graph.fieldsWithRules++;
          graph.totalRules += ruleProperties.length;
        }
      }

      // Access the _dependents array populated by RuleEngine during rule execution
      // After ExecuteRule event runs, each field's _dependents contains fields that depend on it
      const dependents = field._dependents || [];
      
      if (dependents.length > 0) {
        if (!graph.dependencies[fieldName]) {
          graph.dependencies[fieldName] = {
            id: fieldId,
            dependents: [], // Fields that depend on this field
            dependsOn: [],  // Will be populated in reverse pass
          };
        }

        // Each dependent is a field that depends on this field
        dependents.forEach(dep => {
          const dependentField = dep.node;
          const dependentName = dependentField.name;
          
          if (dependentName && dependentName !== fieldName) {
            graph.dependencies[fieldName].dependents.push(dependentName);
          }
        });
      }
    });

    // Build reverse dependencies (dependsOn)
    Object.keys(graph.dependencies).forEach(fieldName => {
      const field = graph.dependencies[fieldName];
      
      // For each field that this field affects (dependents)
      field.dependents.forEach(dependentName => {
        if (!graph.dependencies[dependentName]) {
          graph.dependencies[dependentName] = {
            dependents: [],
            dependsOn: [],
          };
        }
        
        // The dependent field depends on this field
        if (!graph.dependencies[dependentName].dependsOn.includes(fieldName)) {
          graph.dependencies[dependentName].dependsOn.push(fieldName);
        }
      });
    });

    core.info(`Visited ${visitedFieldCount} fields, ${graph.fieldsWithRules} have rules`);

    return graph;
  }

  /**
   * Detect cycles in dependency graph using DFS
   * @param {Object} graph - Dependency graph
   * @returns {Array} Array of cycles found
   */
  detectCycles(graph) {
    const cycles = [];
    const visited = new Set();
    const recursionStack = new Set();

    const dfs = (fieldName, path = []) => {
      if (recursionStack.has(fieldName)) {
        // Cycle detected
        const cycleStart = path.indexOf(fieldName);
        const cycle = path.slice(cycleStart);
        cycle.push(fieldName); // Complete the cycle
        
        // Check if this cycle is already recorded (avoid duplicates)
        // Create a sorted copy for the key (don't mutate the original cycle array)
        const cycleKey = [...cycle].sort().join('->');
        if (!cycles.some(c => c.key === cycleKey)) {
          cycles.push({
            key: cycleKey,
            fields: cycle,  // Keep original order for display
            path: [...path, fieldName],
          });
        }
        return;
      }

      if (visited.has(fieldName)) {
        return;
      }

      visited.add(fieldName);
      recursionStack.add(fieldName);
      path.push(fieldName);

      const node = graph.dependencies[fieldName];
      if (node && node.dependsOn) {
        node.dependsOn.forEach(dependency => {
          dfs(dependency, [...path]);
        });
      }

      recursionStack.delete(fieldName);
    };

    // Run DFS from each field
    Object.keys(graph.dependencies).forEach(fieldName => {
      if (!visited.has(fieldName)) {
        dfs(fieldName);
      }
    });

    return cycles;
  }

  /**
   * Generate issues from detected cycles
   */
  generateIssues(cycles) {
    return cycles.map(cycle => ({
      severity: 'error',
      type: 'rule-cycle',
      message: `Circular dependency detected: ${cycle.fields.join(' → ')}`,
      fields: cycle.fields,
      path: cycle.path,
      recommendation: 'Break the circular dependency by removing or modifying one of the rules. Circular dependencies can cause infinite loops and performance issues. Consider using events or consolidating the logic.',
    }));
  }

  /**
   * Compare before and after analyses
   */
  compare(beforeData, afterData) {
    const resolvedCycles = (beforeData.cycleDetails || []).filter(beforeCycle =>
      !(afterData.cycleDetails || []).some(afterCycle => afterCycle.key === beforeCycle.key)
    );

    return {
      before: beforeData,
      after: afterData,
      delta: {
        cycles: (afterData.cycles || 0) - (beforeData.cycles || 0),
        totalRules: (afterData.totalRules || 0) - (beforeData.totalRules || 0),
        slowRules: (afterData.slowRuleCount || 0) - (beforeData.slowRuleCount || 0),
      },
      newCycles: afterData.cycleDetails || [], // Report ALL cycles in current state
      resolvedCycles,
      slowRules: afterData.slowRules || [], // Top 10 slowest rules
      slowRuleCount: afterData.slowRuleCount || 0,
    };
  }
}


