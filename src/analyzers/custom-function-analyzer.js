import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import * as core from '@actions/core';

/**
 * Analyzes custom functions used in forms for performance anti-patterns
 * - Detects DOM access (should not access DOM)
 * - Detects HTTP requests (should use API tool instead)
 */
export class CustomFunctionAnalyzer {
  constructor(config = null) {
    this.config = config;
  }

  /**
   * Analyze custom functions in form JSON and JavaScript files
   * @param {Object} formJson - Form JSON object
   * @param {Array} jsFiles - Array of {filename, content} objects
   * @returns {Object} Analysis results
   */
  analyze(formJson, jsFiles = []) {
    // If no form JSON provided, analyze ALL exported functions from all JS files
    if (!formJson) {
      core.info(`[CustomFunctions] No form JSON provided - analyzing all exported functions in ${jsFiles.length} JS file(s)`);
      
      // Analyze all JS files for exported functions
      const allFunctionAnalyses = [];
      for (const jsFile of jsFiles) {
        try {
          // Parse with locations enabled to get line numbers
          const ast = acorn.parse(jsFile.content, { 
            ecmaVersion: 2020, 
            sourceType: 'module',
            locations: true  // ← CRITICAL: Required for line numbers!
          });
          walk.simple(ast, {
            ExportNamedDeclaration: (node) => {
              if (node.declaration && node.declaration.type === 'FunctionDeclaration') {
                const funcName = node.declaration.id.name;
                const analysis = this.analyzeFunctionNode(node.declaration, jsFile, funcName);
                if (analysis) {
                  allFunctionAnalyses.push(analysis);
                }
              }
            }
          });
        } catch (error) {
          core.warning(`[CustomFunctions] Failed to parse ${jsFile.filename}: ${error.message}`);
        }
      }
      
      const violations = this.detectViolations(allFunctionAnalyses);
      core.info(`[CustomFunctions] Found ${allFunctionAnalyses.length} exported function(s), ${violations.length} violation(s)`);
      
      return {
        functionsFound: allFunctionAnalyses.length,
        functionNames: allFunctionAnalyses.map(f => f.functionName),
        functionsAnalyzed: allFunctionAnalyses.length,
        violations: violations.length,
        issues: violations,
        details: allFunctionAnalyses,
      };
    }

    // Filter jsFiles to only the custom functions file specified in form JSON
    const customFunctionsPath = formJson.properties?.customFunctionsPath;
    let filteredJsFiles = jsFiles;
    
    if (customFunctionsPath) {
      const normalizedPath = customFunctionsPath.replace(/^\/+/, '');
      core.info(`[CustomFunctions] Form specifies custom functions path: ${normalizedPath}`);
      core.info(`[CustomFunctions] Searching among ${jsFiles.length} JS files`);
      
      // Debug: Show first few file paths to understand format
      if (jsFiles.length > 0 && jsFiles.length <= 10) {
        jsFiles.forEach(f => core.info(`[CustomFunctions]   Available: ${f.filename}`));
      } else if (jsFiles.length > 10) {
        jsFiles.slice(0, 3).forEach(f => core.info(`[CustomFunctions]   Available: ${f.filename}`));
        core.info(`[CustomFunctions]   ... and ${jsFiles.length - 3} more files`);
      }
      
      // Find files that match the custom functions path (suffix matching)
      // Match if the file path ends with the normalized path (handles prefix directories like 'eds-li/')
      filteredJsFiles = jsFiles.filter(file => {
        const filePathNormalized = file.filename.replace(/\\/g, '/').replace(/^\/+/, '');
        
        // Check if path ends with target (handles cases like 'eds-li/liabilities/.../functions.js')
        if (filePathNormalized.endsWith(normalizedPath)) {
          return true;
        }
        
        // Also check if just the filename matches (fallback)
        const targetFilename = normalizedPath.split('/').pop();
        const actualFilename = filePathNormalized.split('/').pop();
        if (actualFilename === targetFilename) {
          // Further verify that parent directories match
          const targetDirs = normalizedPath.split('/').slice(0, -1);
          const actualDirs = filePathNormalized.split('/');
          
          // Check if all target directory segments exist in actual path in order
          let matchIndex = 0;
          for (const dir of actualDirs) {
            if (targetDirs[matchIndex] === dir) {
              matchIndex++;
              if (matchIndex === targetDirs.length) {
                return true; // All segments matched
              }
            }
          }
        }
        
        return false;
      });
      
      if (filteredJsFiles.length > 0) {
        core.info(`[CustomFunctions] Found ${filteredJsFiles.length} file(s) matching custom functions path`);
        filteredJsFiles.forEach(f => core.info(`[CustomFunctions]   - ${f.filename}`));
      } else {
        core.warning(`[CustomFunctions] No files found matching ${normalizedPath}, analyzing all ${jsFiles.length} JS files as fallback`);
        filteredJsFiles = jsFiles;
      }
    } else {
      core.info(`[CustomFunctions] No customFunctionsPath specified, analyzing all ${jsFiles.length} JS file(s)`);
    }

    // Step 1: Extract function names from form JSON
    const functionNames = this.extractFunctionNames(formJson);
    core.info(`[CustomFunctions] Extracted ${functionNames.length} custom function(s) from form JSON`);

    // Step 2: Find and analyze these functions in the filtered JS files
    const functionAnalyses = this.analyzeFunctionsInJS(functionNames, filteredJsFiles);
    core.info(`[CustomFunctions] Found ${functionAnalyses.length} function definition(s) in JS files`);

    // Step 3: Detect violations
    const violations = this.detectViolations(functionAnalyses);
    
    if (violations.length > 0) {
      core.info(`[CustomFunctions] Detected ${violations.length} violation(s):`);
      violations.forEach(v => {
        core.info(`[CustomFunctions]   - ${v.functionName}() in ${v.file}: ${v.type}`);
      });
    } else {
      core.info(`[CustomFunctions] No violations detected`);
    }

    return {
      functionsFound: functionNames.length,
      functionNames: functionNames.map(f => f.id),
      functionsAnalyzed: functionAnalyses.length,
      violations: violations.length,
      issues: violations,
      details: functionAnalyses,
    };
  }

  /**
   * Extract custom function names from form JSON
   * Based on RuleUtils.extractFunctionNames logic from aem-core-forms-components
   * @param {Object} formJson - Form JSON object
   * @returns {Array<{id: string}>} Array of function name objects
   */
  extractFunctionNames(formJson) {
    const functionNames = new Set();
    
    // JavaScript keywords and built-in functions to exclude
    const jsKeywords = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
      'return', 'throw', 'try', 'catch', 'finally', 'typeof', 'instanceof',
      'new', 'delete', 'void', 'yield', 'await', 'async', 'function',
      'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
      'var', 'let', 'const', 'class', 'extends', 'super', 'this',
      'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Math',
      'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI'
    ]);

    // Helper to extract function names from expressions
    const extractFromExpression = (expression) => {
      if (!expression || typeof expression !== 'string') return;

      // Match patterns like functionName() with optional parameters
      const functionPattern = /(\w+)\s*\(/g;
      let match;

      while ((match = functionPattern.exec(expression)) !== null) {
        const fnName = match[1];
        // Filter out JavaScript keywords
        if (!jsKeywords.has(fnName)) {
          functionNames.add(fnName);
        }
      }
    };

    // Process events at form level
    if (formJson.events) {
      Object.values(formJson.events).forEach(eventArray => {
        if (Array.isArray(eventArray)) {
          eventArray.forEach(eventString => extractFromExpression(eventString));
        }
      });
    }

    // Process rules at form level
    if (formJson.rules) {
      Object.values(formJson.rules).forEach(ruleExpression => {
        extractFromExpression(ruleExpression);
      });
    }

    // Recursively process items
    const processItems = (items) => {
      if (!items) return;

      Object.values(items).forEach(item => {
        // Check validation expression
        if (item.validationExpression) {
          extractFromExpression(item.validationExpression);
        }

        // Check display value expression
        if (item.displayValueExpression) {
          extractFromExpression(item.displayValueExpression);
        }

        // Check events
        if (item.events) {
          Object.values(item.events).forEach(eventArray => {
            if (Array.isArray(eventArray)) {
              eventArray.forEach(eventString => extractFromExpression(eventString));
            }
          });
        }

        // Check rules
        if (item.rules) {
          Object.values(item.rules).forEach(ruleExpression => {
            extractFromExpression(ruleExpression);
          });
        }

        // Process nested items
        if (item[':items']) {
          processItems(item[':items']);
        }
      });
    };

    if (formJson[':items']) {
      processItems(formJson[':items']);
    }

    return Array.from(functionNames).map(id => ({ id }));
  }

  /**
   * Analyze custom functions in JavaScript files
   * @param {Array} functionNames - Array of {id: string}
   * @param {Array} jsFiles - Array of {filename, content}
   * @returns {Array} Function analyses
   */
  analyzeFunctionsInJS(functionNames, jsFiles) {
    const analyses = [];
    const nameSet = new Set(functionNames.map(f => f.id));

    for (const file of jsFiles) {
      try {
        // Parse JavaScript file
        const ast = acorn.parse(file.content, {
          ecmaVersion: 2022,
          sourceType: 'module',
          locations: true,
        });

        // Find function definitions
        walk.simple(ast, {
          FunctionDeclaration: (node) => {
            if (node.id && nameSet.has(node.id.name)) {
              const analysis = this.analyzeFunctionNode(node, file);
              analyses.push(analysis);
            }
          },
          VariableDeclarator: (node) => {
            // Handle: const funcName = function() {}
            if (node.id && nameSet.has(node.id.name) &&
                (node.init?.type === 'FunctionExpression' ||
                 node.init?.type === 'ArrowFunctionExpression')) {
              const analysis = this.analyzeFunctionNode(node.init, file, node.id.name);
              analyses.push(analysis);
            }
          },
          AssignmentExpression: (node) => {
            // Handle: obj.funcName = function() {}
            if (node.left?.property && nameSet.has(node.left.property.name) &&
                (node.right?.type === 'FunctionExpression' ||
                 node.right?.type === 'ArrowFunctionExpression')) {
              const analysis = this.analyzeFunctionNode(node.right, file, node.left.property.name);
              analyses.push(analysis);
            }
          },
        });

      } catch (error) {
        // Skip files that can't be parsed
        console.warn(`Could not parse ${file.filename}: ${error.message}`);
      }
    }

    return analyses;
  }

  /**
   * Analyze a single function node for violations
   * @param {Object} node - AST node
   * @param {Object} file - File info
   * @param {string} name - Function name (optional, extracted from node if not provided)
   * @returns {Object} Analysis result
   */
  analyzeFunctionNode(node, file, name = null) {
    const functionName = name || node.id?.name || 'anonymous';
    const domAccesses = [];
    const httpRequests = [];

    // Walk through function body to detect violations
    walk.simple(node, {
      MemberExpression: (memberNode) => {
        // Check for DOM access
        if (memberNode.object?.name === 'document' ||
            memberNode.property?.name === 'querySelector' ||
            memberNode.property?.name === 'querySelectorAll' ||
            memberNode.property?.name === 'getElementById' ||
            memberNode.property?.name === 'getElementsByClassName' ||
            memberNode.property?.name === 'getElementsByTagName' ||
            memberNode.property?.name === 'createElement' ||
            memberNode.property?.name === 'appendChild' ||
            memberNode.property?.name === 'removeChild' ||
            memberNode.property?.name === 'innerHTML' ||
            memberNode.property?.name === 'outerHTML') {
          
          domAccesses.push({
            type: memberNode.object?.name === 'document' ? 'document' : memberNode.property?.name,
            line: memberNode.loc?.start.line,
          });
        }
      },
      CallExpression: (callNode) => {
        // Check for HTTP requests
        const calleeName = this.getCallExpressionName(callNode.callee);
        
        if (calleeName === 'fetch' ||
            calleeName === 'request' ||  // AEM Forms standard HTTP function
            calleeName === 'XMLHttpRequest' ||
            calleeName.includes('ajax') ||
            calleeName.includes('axios') ||
            (calleeName.includes('$') && (calleeName.includes('get') || calleeName.includes('post')))) {
          
          httpRequests.push({
            type: calleeName,
            line: callNode.loc?.start.line,
          });
        }
      },
      NewExpression: (newNode) => {
        // Check for new XMLHttpRequest()
        if (newNode.callee?.name === 'XMLHttpRequest') {
          httpRequests.push({
            type: 'XMLHttpRequest',
            line: newNode.loc?.start.line,
          });
        }
      },
    });

    return {
      functionName,
      file: file.filename,
      line: node.loc?.start.line,
      hasDOMAccess: domAccesses.length > 0,
      hasHTTPRequests: httpRequests.length > 0,
      domAccesses,
      httpRequests,
    };
  }

  /**
   * Get call expression name (handles nested calls like $.ajax, axios.get)
   */
  getCallExpressionName(callee) {
    if (callee.type === 'Identifier') {
      return callee.name;
    }
    if (callee.type === 'MemberExpression') {
      const object = callee.object?.name || '';
      const property = callee.property?.name || '';
      return `${object}.${property}`;
    }
    return '';
  }

  /**
   * Detect violations and create issues
   */
  detectViolations(functionAnalyses) {
    const violations = [];

    for (const analysis of functionAnalyses) {
      // DOM access violation
      if (analysis.hasDOMAccess) {
        violations.push({
          severity: 'error',
          type: 'dom-access-in-custom-function',
          functionName: analysis.functionName,
          file: analysis.file,
          line: analysis.line,
          message: `Custom function "${analysis.functionName}" accesses the DOM. Custom functions should not manipulate the DOM directly.`,
          details: analysis.domAccesses,
          recommendation: 'Remove DOM access from custom functions. Use form data model and rules engine for UI updates. DOM manipulations should be handled in custom component, not custom functions.',
          cwvImpact: 'INP, CLS',
        });
      }

      // HTTP request violation
      if (analysis.hasHTTPRequests) {
        violations.push({
          severity: 'error',
          type: 'http-request-in-custom-function',
          functionName: analysis.functionName,
          file: analysis.file,
          line: analysis.line,
          message: `Custom function "${analysis.functionName}" makes HTTP requests. Use the API tool (request()) instead.`,
          details: analysis.httpRequests,
          recommendation: 'Replace direct HTTP calls with the form\'s API tool (request() function). This ensures proper error handling, loading states, and integration with the forms runtime.',
          cwvImpact: 'LCP, TBT',
        });
      }
    }

    return violations;
  }

  /**
   * Compare before and after analyses
   */
  compare(beforeAnalysis, afterAnalysis) {
    if (!beforeAnalysis || !afterAnalysis) {
      return { 
        error: 'Missing analysis for comparison',
        before: { functionsFound: 0, violations: 0, issues: [] },
        after: { functionsFound: 0, violations: 0, issues: [] },
        newIssues: [],
        resolvedIssues: []
      };
    }

    // Handle cases where analysis returned an error (e.g., no form JSON)
    if (beforeAnalysis.error || afterAnalysis.error) {
      return {
        before: beforeAnalysis.error ? { functionsFound: 0, violations: 0, issues: [] } : beforeAnalysis,
        after: afterAnalysis.error ? { functionsFound: 0, violations: 0, issues: [] } : afterAnalysis,
        newIssues: afterAnalysis.issues || [],
        resolvedIssues: [],
        delta: {
          functionsAdded: (afterAnalysis.functionsFound || 0) - (beforeAnalysis.functionsFound || 0),
          violationsAdded: (afterAnalysis.violations || 0) - (beforeAnalysis.violations || 0),
        }
      };
    }

    const resolvedIssues = (beforeAnalysis.issues || []).filter(beforeIssue =>
      !(afterAnalysis.issues || []).some(afterIssue =>
        afterIssue.functionName === beforeIssue.functionName &&
        afterIssue.type === beforeIssue.type
      )
    );

    return {
      before: beforeAnalysis,
      after: afterAnalysis,
      delta: {
        functionsAdded: afterAnalysis.functionsFound - beforeAnalysis.functionsFound,
        violationsAdded: afterAnalysis.violations - beforeAnalysis.violations,
      },
      newIssues: afterAnalysis.issues || [], // Report ALL issues found in current state
      resolvedIssues,
    };
  }
}

