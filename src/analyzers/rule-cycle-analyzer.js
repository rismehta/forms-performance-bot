import { createFormInstance } from '@aemforms/af-core';
import * as core from '@actions/core';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import nodeCrypto from 'crypto';
import vm from 'vm';

/**
 * Analyzes form rules for circular dependencies
 * Uses @aemforms/af-core to leverage the built-in dependency tracking
 */
export class RuleCycleAnalyzer {
  constructor(config = null) {
    this.config = config;
  }

  /**
   * Analyze form JSON for rule cycles
   * @param {Object} formJson - Form JSON object
   * @returns {Promise<Object>} Analysis results
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
      const { FunctionRuntime, createFormInstanceSync } = await import('@aemforms/af-core');
      
      // Try to load real custom function implementations from the checked-out repository
      const customFunctionsPath = formJson.properties?.customFunctionsPath;
      
      let realFunctions = {};
      let loadedCount = 0;
      let functionFailures = null;
      
      if (customFunctionsPath) {
        const result = await this.loadCustomFunctions(customFunctionsPath);
        if (result) {
          realFunctions = result.functions;
          loadedCount = result.count;
          functionFailures = result.failureTracker;
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
      
      // Use createFormInstanceSync which waits for all promises (including rule execution)
      // This ensures ExecuteRule event completes and dependencies are tracked
      // After this call returns, all rules have executed and _dependents arrays are populated
      let form;
      try {
        core.info('Creating form instance with af-core...');
        form = await createFormInstanceSync(formJson, undefined, 'off');
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
      
      // After createFormInstance returns, the event queue has run and dependencies are tracked
      // Now build the dependency graph from the form instance's internal state
      core.info('Building dependency graph from form instance...');
      let dependencyGraph = this.buildDependencyGraphFromForm(form);
      core.info(`Rule detection: Found ${dependencyGraph.totalRules} rules in ${dependencyGraph.fieldsWithRules} fields`);
      
      // Fallback: If af-core didn't detect dependencies, parse rule expressions directly
      // This handles Core Components syntax like "fieldName.$value" 
      if (Object.keys(dependencyGraph.dependencies).length === 0 && dependencyGraph.totalRules > 0) {
        core.info('No dependencies from af-core, using regex fallback for Core Components syntax...');
        dependencyGraph = this.buildDependencyGraphFromRules(formJson, dependencyGraph);
        core.info(`Regex fallback found ${Object.keys(dependencyGraph.dependencies).length} fields with dependencies`);
      }
      
      const cycles = this.detectCycles(dependencyGraph);
      if (cycles.length > 0) {
        core.warning(`Detected ${cycles.length} circular dependenc${cycles.length > 1 ? 'ies' : 'y'} in rules`);
      }
      const issues = this.generateIssues(cycles);

      return {
        totalRules: dependencyGraph.totalRules,
        fieldsWithRules: dependencyGraph.fieldsWithRules,
        dependencies: dependencyGraph.dependencies,
        cycles: cycles.length,
        cycleDetails: cycles,
        issues,
        circularDependencies: cycles.map(cycle => ({
          cycle: cycle.fields || cycle.path,
          fields: cycle.fields,
        })),
      };
    } catch (error) {
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
  async loadCustomFunctions(customFunctionsPath) {
    if (!customFunctionsPath) {
      return null;
    }

    try {
      const normalizedPath = customFunctionsPath.replace(/^\/+/, '');
      const absolutePath = resolve(process.cwd(), normalizedPath);
      
      if (!existsSync(absolutePath)) {
        core.info(`Custom functions file not found: ${absolutePath}`);
        return null;
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
        .replace(/export\s+function\s+/g, 'function ')  // export function -> function
        .replace(/export\s*\{[^}]+\}/gs, '')             // remove export { ... }
        .replace(/export\s+default\s+/g, '');            // export default (if any)
      
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
                  // Log promise rejection
                  if (!functionFailures.has(name)) {
                    functionFailures.set(name, { count: 0, errors: new Set() });
                  }
                  const failure = functionFailures.get(name);
                  failure.count++;
                  failure.errors.add(err?.message || 'Promise rejected');
                  return null;
                });
              }
              
              return result;
            } catch (e) {
              // Log sync error - functions expect different runtime context
              if (!functionFailures.has(name)) {
                functionFailures.set(name, { count: 0, errors: new Set() });
              }
              const failure = functionFailures.get(name);
              failure.count++;
              failure.errors.add(e?.message || 'Unknown error');
              return null;
            }
          };
          loadedCount++;
        }
      }
      
      core.info(`Successfully loaded ${loadedCount} real function(s)`);
      return { functions, count: loadedCount, failureTracker: functionFailures };
      
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
   * Build dependency graph by parsing rule expressions directly (fallback for Core Components)
   * Handles syntax like: fieldName.$value, fieldName.$visible, $form.fieldName
   * @param {Object} formJson - Original form JSON
   * @param {Object} existingGraph - Existing graph from af-core
   * @returns {Object} Updated dependency graph
   */
  buildDependencyGraphFromRules(formJson, existingGraph) {
    const graph = { ...existingGraph };
    const fieldNames = new Set();
    const fieldRules = new Map(); // Map of fieldName -> rule expressions

    // First pass: collect all field names and their rules
    const collectFields = (obj, path = '') => {
      if (!obj || typeof obj !== 'object') return;
      
      const name = obj.name || obj.id;
      if (name) {
        fieldNames.add(name);
        
        // Collect rules
        if (obj.rules && typeof obj.rules === 'object') {
          const ruleExpressions = Object.values(obj.rules)
            .filter(r => typeof r === 'string')
            .join(' ');
          if (ruleExpressions) {
            fieldRules.set(name, ruleExpressions);
          }
        }
      }

      // Recurse into items
      const items = obj[':items'] || obj.items;
      if (items) {
        const entries = Array.isArray(items) ? items : Object.values(items);
        entries.forEach(item => collectFields(item, `${path}/${name || ''}`));
      }
    };

    collectFields(formJson);
    core.info(`Found ${fieldNames.size} fields, ${fieldRules.size} have rule expressions`);

    // Second pass: parse rule expressions for field references
    // Patterns: fieldName.$value, fieldName.$visible, $form.fieldName
    const fieldNamePattern = Array.from(fieldNames)
      .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    
    if (!fieldNamePattern) return graph;

    // Regex to find field references in rules
    // Matches: fieldName.$value, fieldName.$visible, fieldName.$valid, $form.fieldName
    const refRegex = new RegExp(
      `(${fieldNamePattern})\\.\\\$(?:value|visible|valid|enabled)|` +
      `\\$form\\.(${fieldNamePattern})`,
      'g'
    );

    // Build dependencies from rule expressions
    fieldRules.forEach((ruleExpr, fieldName) => {
      const dependencies = new Set();
      let match;
      
      while ((match = refRegex.exec(ruleExpr)) !== null) {
        const referencedField = match[1] || match[2];
        if (referencedField && referencedField !== fieldName) {
          dependencies.add(referencedField);
        }
      }
      refRegex.lastIndex = 0; // Reset regex

      if (dependencies.size > 0) {
        // This field depends on other fields
        if (!graph.dependencies[fieldName]) {
          graph.dependencies[fieldName] = { dependents: [], dependsOn: [] };
        }
        graph.dependencies[fieldName].dependsOn = Array.from(dependencies);

        // Update reverse dependencies
        dependencies.forEach(depName => {
          if (!graph.dependencies[depName]) {
            graph.dependencies[depName] = { dependents: [], dependsOn: [] };
          }
          if (!graph.dependencies[depName].dependents.includes(fieldName)) {
            graph.dependencies[depName].dependents.push(fieldName);
          }
        });
      }
    });

    return graph;
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
        const cycleKey = cycle.sort().join('->');
        if (!cycles.some(c => c.key === cycleKey)) {
          cycles.push({
            key: cycleKey,
            fields: cycle,
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
    // Handle cases where analysis failed or returned incomplete data
    const beforeCycles = beforeData?.cycleDetails || [];
    const afterCycles = afterData?.cycleDetails || [];

    const resolvedCycles = beforeCycles.filter(beforeCycle =>
      !afterCycles.some(afterCycle => afterCycle.key === beforeCycle.key)
    );

    return {
      before: beforeData || {},
      after: afterData || {},
      delta: {
        cycles: (afterData?.cycles || 0) - (beforeData?.cycles || 0),
        totalRules: (afterData?.totalRules || 0) - (beforeData?.totalRules || 0),
      },
      newCycles: afterCycles, // Report ALL cycles in current state
      resolvedCycles,
    };
  }
}

