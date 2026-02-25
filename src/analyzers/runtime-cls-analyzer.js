import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import * as core from '@actions/core';

/**
 * Analyzes JavaScript files for runtime CSS/style/class manipulations
 * that can cause CLS (Cumulative Layout Shift) during form load.
 * 
 * IMPORTANT: Only flags patterns that run during form initialization,
 * NOT patterns in event handlers or user-triggered callbacks.
 * 
 * Detects:
 * 1. Dynamic CSS loading (loadCSS, dynamic imports)
 * 2. Dynamic style injection (createElement('style'), createElement('link'))
 * 3. Dynamic class manipulation (classList.add/remove/toggle)
 * 4. Direct style manipulation (element.style.xxx)
 */
export class RuntimeCLSAnalyzer {
  constructor(config = null) {
    this.config = config;
    
    // Function names that indicate initialization context (FLAG these)
    this.initializationFunctions = new Set([
      'decorateForm',
      'decorate',
      'init',
      'initialize',
      'setup',
      'loadBlock',
      'loadEager',
      'loadLazy',
      'loadDelayed',
    ]);
    
    // Event types that indicate user-triggered context (DON'T flag inside these)
    this.userEventTypes = new Set([
      'click',
      'dblclick',
      'mousedown',
      'mouseup',
      'mouseover',
      'mouseout',
      'mousemove',
      'keydown',
      'keyup',
      'keypress',
      'change',
      'input',
      'blur',
      'focus',
      'focusin',
      'focusout',
      'submit',
      'reset',
      'scroll',
      'resize',
      'touchstart',
      'touchend',
      'touchmove',
      'drag',
      'drop',
      'dragstart',
      'dragend',
    ]);
    
    // Class names that are acceptable for state management (allowlist)
    this.allowedStateClasses = new Set([
      'valid',
      'invalid',
      'error',
      'success',
      'warning',
      'focused',
      'touched',
      'dirty',
      'pristine',
      'disabled',
      'readonly',
      'loading',
      'loaded',
      'active',
      'selected',
      'checked',
      'visible',
      'hidden', // Note: hidden is ok as state class
      'expanded',
      'collapsed',
      'open',
      'closed',
    ]);
  }

  /**
   * Analyze JavaScript files for runtime CLS patterns
   * @param {Array} jsFiles - Array of {filename, content} objects
   * @returns {Object} Analysis results
   */
  analyze(jsFiles = []) {
    if (!jsFiles || jsFiles.length === 0) {
      return {
        filesAnalyzed: 0,
        issues: [],
        summary: {
          dynamicCSSLoading: 0,
          dynamicStyleInjection: 0,
          dynamicClassManipulation: 0,
          directStyleManipulation: 0,
        },
      };
    }

    const allIssues = [];
    const summary = {
      dynamicCSSLoading: 0,
      dynamicStyleInjection: 0,
      dynamicClassManipulation: 0,
      directStyleManipulation: 0,
    };

    // Prioritize decorateForm.js files
    const sortedFiles = [...jsFiles].sort((a, b) => {
      const aIsDecorate = a.filename.includes('decorateForm');
      const bIsDecorate = b.filename.includes('decorateForm');
      if (aIsDecorate && !bIsDecorate) return -1;
      if (!aIsDecorate && bIsDecorate) return 1;
      return 0;
    });

    for (const file of sortedFiles) {
      try {
        const fileIssues = this.analyzeFile(file);
        allIssues.push(...fileIssues);

        // Update summary
        fileIssues.forEach(issue => {
          if (issue.type === 'dynamic-css-loading') summary.dynamicCSSLoading++;
          if (issue.type === 'dynamic-style-injection') summary.dynamicStyleInjection++;
          if (issue.type === 'dynamic-class-manipulation') summary.dynamicClassManipulation++;
          if (issue.type === 'direct-style-manipulation') summary.directStyleManipulation++;
        });
      } catch (error) {
        core.warning(`[RuntimeCLS] Failed to parse ${file.filename}: ${error.message}`);
      }
    }

    core.info(`[RuntimeCLS] Analyzed ${jsFiles.length} file(s), found ${allIssues.length} issue(s)`);
    
    return {
      filesAnalyzed: jsFiles.length,
      issues: allIssues,
      summary,
    };
  }

  /**
   * Analyze a single JavaScript file
   * @param {Object} file - {filename, content}
   * @returns {Array} Issues found
   */
  analyzeFile(file) {
    const issues = [];
    const { filename, content } = file;

    // Skip test files
    if (filename.includes('test') || filename.includes('spec')) {
      return issues;
    }

    // Parse JavaScript
    let ast;
    try {
      ast = acorn.parse(content, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: true,
      });
    } catch (error) {
      // Skip files that can't be parsed
      return issues;
    }

    // Track context: are we inside an initialization function or event handler?
    const context = {
      currentFunction: null,
      isInsideEventHandler: false,
      isInsideInitialization: false,
      filename,
      // decorateForm.js is ALWAYS initialization context
      isDecorateFormFile: filename.includes('decorateForm'),
    };

    // Walk the AST
    this.walkAST(ast, content, context, issues);

    return issues;
  }

  /**
   * Walk AST and detect CLS-causing patterns
   */
  walkAST(ast, content, context, issues) {
    const self = this;

    // Custom walker to track function context
    walk.ancestor(ast, {
      // Track function declarations
      FunctionDeclaration(node, ancestors) {
        const funcName = node.id?.name;
        const prevFunction = context.currentFunction;
        const prevIsInit = context.isInsideInitialization;
        
        context.currentFunction = funcName;
        context.isInsideInitialization = self.isInitializationFunction(funcName) || context.isDecorateFormFile;
        
        // Walk function body
        self.analyzeNode(node.body, content, context, issues, ancestors);
        
        // Restore context
        context.currentFunction = prevFunction;
        context.isInsideInitialization = prevIsInit;
      },

      // Track arrow functions and function expressions
      ArrowFunctionExpression(node, ancestors) {
        self.handleFunctionExpression(node, ancestors, content, context, issues);
      },

      FunctionExpression(node, ancestors) {
        self.handleFunctionExpression(node, ancestors, content, context, issues);
      },

      // Detect patterns at call expression level
      CallExpression(node, ancestors) {
        self.detectCallExpression(node, ancestors, content, context, issues);
      },

      // Detect dynamic import() expressions (for CSS imports)
      ImportExpression(node, ancestors) {
        self.detectImportExpression(node, ancestors, content, context, issues);
      },

      // Detect class manipulation and style access
      MemberExpression(node, ancestors) {
        self.detectMemberExpression(node, ancestors, content, context, issues);
      },

      // Detect assignments (for className, style.cssText, etc.)
      AssignmentExpression(node, ancestors) {
        self.detectAssignment(node, ancestors, content, context, issues);
      },
    });
  }

  /**
   * Handle function expressions (arrow functions, anonymous functions)
   */
  handleFunctionExpression(node, ancestors, content, context, issues) {
    // Check if this function is an event handler callback
    const parent = ancestors[ancestors.length - 2];
    
    if (this.isEventHandlerCallback(parent, node)) {
      // This is an event handler - don't flag patterns inside
      const prevEventHandler = context.isInsideEventHandler;
      context.isInsideEventHandler = true;
      
      this.analyzeNode(node.body, content, context, issues, ancestors);
      
      context.isInsideEventHandler = prevEventHandler;
    } else {
      // Check if assigned to an initialization function
      const funcName = this.getFunctionName(parent, node);
      const prevFunction = context.currentFunction;
      const prevIsInit = context.isInsideInitialization;
      
      if (funcName) {
        context.currentFunction = funcName;
        context.isInsideInitialization = this.isInitializationFunction(funcName) || context.isDecorateFormFile;
      }
      
      this.analyzeNode(node.body, content, context, issues, ancestors);
      
      context.currentFunction = prevFunction;
      context.isInsideInitialization = prevIsInit;
    }
  }

  /**
   * Analyze a node for patterns
   */
  analyzeNode(node, content, context, issues, ancestors) {
    // This is called by the walker, patterns are detected in specific handlers
  }

  /**
   * Check if we're inside an event handler callback by examining ancestors
   */
  isInsideEventHandlerCallback(ancestors) {
    // Walk up the ancestors to find if we're inside an event handler callback
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestor = ancestors[i];
      
      // Check for addEventListener call with our function as callback
      if (ancestor.type === 'CallExpression') {
        const calleeName = this.getCalleeName(ancestor.callee);
        if (calleeName === 'addEventListener' || calleeName.endsWith('.addEventListener')) {
          const eventType = ancestor.arguments[0];
          if (eventType && this.userEventTypes.has(this.getStringValue(eventType))) {
            return true;
          }
        }
      }
      
      // Check for onXxx property assignment
      if (ancestor.type === 'AssignmentExpression') {
        const left = ancestor.left;
        if (left && left.type === 'MemberExpression') {
          const propName = left.property?.name;
          if (propName && propName.startsWith('on')) {
            const eventType = propName.slice(2).toLowerCase();
            if (this.userEventTypes.has(eventType)) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  /**
   * Get the containing initialization function from ancestors
   */
  getInitializationContext(ancestors) {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestor = ancestors[i];
      
      if (ancestor.type === 'FunctionDeclaration' && ancestor.id?.name) {
        if (this.isInitializationFunction(ancestor.id.name)) {
          return ancestor.id.name;
        }
      }
      
      if (ancestor.type === 'VariableDeclarator' && ancestor.id?.name) {
        if (this.isInitializationFunction(ancestor.id.name)) {
          return ancestor.id.name;
        }
      }
    }
    return null;
  }

  /**
   * True if this node is inside a callback passed to subscribe(...).
   * Class/style inside subscribe callbacks can cause CLS unless inside the 'change' branch.
   */
  isInsideSubscribeCallback(ancestors) {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestor = ancestors[i];
      if (ancestor.type === 'ArrowFunctionExpression' || ancestor.type === 'FunctionExpression') {
        const parent = ancestors[i - 1];
        if (parent?.type === 'CallExpression') {
          const calleeName = this.getCalleeName(parent.callee);
          if (calleeName === 'subscribe' || calleeName.endsWith('.subscribe')) {
            return true;
          }
        }
        break;
      }
    }
    return false;
  }

  /**
   * True if test expression is (variable) === value, e.g. eventType === 'register',
   * a === 'change', etc. Variable name can be anything. Used to detect register vs
   * change branches in subscribe callbacks.
   */
  isEventTypeEquals(testNode, value) {
    if (!testNode || typeof value !== 'string') return false;
    if (testNode.type === 'BinaryExpression' && (testNode.operator === '===' || testNode.operator === '==')) {
      const leftIsIdentifier = testNode.left?.type === 'Identifier';
      const rightVal = this.getStringValue(testNode.right);
      if (leftIsIdentifier && rightVal === value) return true;
    }
    return false;
  }

  /**
   * True if this node is inside a callback passed to x.subscribe (any name: fieldModel,
   * model, a, etc.). That callback runs on model change events, after form load — no CLS.
   * Loop is bounded: we walk the fixed ancestors array once (root → current).
   */
  isInsideModelSubscribeCallback(ancestors) {
    for (let i = ancestors.length - 1; i >= 0; i -= 1) {
      const ancestor = ancestors[i];
      if (ancestor.type === 'ArrowFunctionExpression' || ancestor.type === 'FunctionExpression') {
        const parent = ancestors[i - 1];
        if (parent?.type === 'CallExpression') {
          const callee = parent.callee;
          if (callee?.type === 'MemberExpression' && callee.property?.name === 'subscribe') {
            return true;
          }
          // Top-level subscribe(el, formId, cb): keep looking for inner model.subscribe
        }
      }
    }
    return false;
  }

  /**
   * True if this node is inside the "change" branch of a subscribe callback
   * (e.g. inside "if (eventType === 'change') { ... }" or "else if (eventType === 'change') { ... }").
   * Class/style in the change branch runs after form load, so no CLS - do not flag.
   */
  isInsideSubscribeChangeBranch(ancestors) {
    if (!this.isInsideSubscribeCallback(ancestors)) return false;
    for (let i = 0; i < ancestors.length; i++) {
      const ancestor = ancestors[i];
      if (ancestor.type === 'IfStatement') {
        const ifStmt = ancestor;
        if (!this.isEventTypeEquals(ifStmt.test, 'change')) continue;
        const childInPath = ancestors[i + 1];
        if (!childInPath) continue;
        if (childInPath === ifStmt.consequent) return true;
        if (ifStmt.alternate && childInPath === ifStmt.alternate) {
          if (ifStmt.alternate.type === 'IfStatement' && this.isEventTypeEquals(ifStmt.alternate.test, 'change')) return true;
          return true;
        }
      }
    }
    return false;
  }

  /**
   * True if this node is in the direct body of an init function (e.g. decorate),
   * not inside a nested callback. Class/style in decorate's direct body is allowed (one-time setup).
   */
  isInDirectBodyOfInitFunction(ancestors) {
    const initContext = this.getInitializationContext(ancestors);
    if (!initContext) return false;

    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestor = ancestors[i];
      if (ancestor.type === 'FunctionDeclaration' && ancestor.id?.name === initContext) {
        return true;
      }
      if (ancestor.type === 'ArrowFunctionExpression' || ancestor.type === 'FunctionExpression') {
        return false;
      }
    }
    return false;
  }

  /**
   * Detect problematic call expressions
   */
  detectCallExpression(node, ancestors, content, context, issues) {
    // Check if we're inside an event handler callback by examining ancestors
    if (this.isInsideEventHandlerCallback(ancestors)) {
      return; // Skip - this code runs after form load
    }

    const calleeName = this.getCalleeName(node.callee);
    
    // Determine if we should flag this call
    // Only flag if:
    // 1. In decorateForm file (always initialization context), OR
    // 2. Inside an initialization function, OR
    // 3. At top-level of module (no containing function)
    const initContext = this.getInitializationContext(ancestors);
    const hasContainingFunction = ancestors.some(a => 
      a.type === 'FunctionDeclaration' || 
      a.type === 'FunctionExpression' || 
      a.type === 'ArrowFunctionExpression'
    );
    
    const shouldFlag = context.isDecorateFormFile || initContext || !hasContainingFunction;
    
    if (!shouldFlag) {
      return; // Not in initialization context
    }

    // 1. Detect loadCSS() calls
    if (calleeName === 'loadCSS') {
      issues.push({
        severity: 'error',
        type: 'dynamic-css-loading',
        file: context.filename,
        line: node.loc?.start.line,
        functionContext: initContext || 'top-level',
        message: `Dynamic CSS loading with loadCSS() during form initialization causes CLS.`,
        pattern: this.extractCodeSnippet(content, node),
        recommendation: 'Load CSS in <head> via head.html, or use @import in your main CSS file. Dynamic CSS loading at runtime causes layout shifts.',
        cwvImpact: 'CLS, LCP',
      });
    }

    // 2. Detect dynamic import() for CSS - handle ImportExpression type
    if (node.type === 'ImportExpression' || node.callee?.type === 'Import') {
      const arg = node.source || node.arguments?.[0];
      if (arg && this.isCSSimport(arg, content)) {
        issues.push({
          severity: 'error',
          type: 'dynamic-css-loading',
          file: context.filename,
          line: node.loc?.start.line,
          functionContext: initContext || 'top-level',
          message: `Dynamic CSS import during form initialization causes CLS.`,
          pattern: this.extractCodeSnippet(content, node),
          recommendation: 'Use static imports or load CSS in <head>. Dynamic imports of CSS cause layout shifts.',
          cwvImpact: 'CLS, LCP',
        });
      }
    }

    // 3. Detect document.createElement('style') or createElement('link')
    if (calleeName === 'createElement' || calleeName === 'document.createElement') {
      const arg = node.arguments[0];
      if (arg && (this.isStringValue(arg, 'style') || this.isStringValue(arg, 'link'))) {
        const elementType = this.getStringValue(arg);
        issues.push({
          severity: 'error',
          type: 'dynamic-style-injection',
          file: context.filename,
          line: node.loc?.start.line,
          functionContext: initContext || 'top-level',
          message: `Dynamic <${elementType}> element creation during form initialization causes CLS.`,
          pattern: this.extractCodeSnippet(content, node),
          recommendation: elementType === 'link' 
            ? 'Add stylesheet links in head.html instead of creating them dynamically.'
            : 'Define styles in CSS files instead of injecting <style> elements at runtime.',
          cwvImpact: 'CLS, LCP',
        });
      }
    }

    // 4. Detect classList.add/remove/toggle calls
    if (node.callee.type === 'MemberExpression') {
      const method = node.callee.property?.name;
      if (['add', 'remove', 'toggle'].includes(method)) {
        // Check if it's classList
        if (this.isClassListMethod(node.callee)) {
          // Allow in direct body of decorate (one-time setup). Flag inside subscribe and other callbacks.
          if (this.isInDirectBodyOfInitFunction(ancestors)) {
            return;
          }
          // Allow in subscribe's change branch (runs after form load, no CLS). Flag in register branch.
          if (this.isInsideSubscribeChangeBranch(ancestors)) {
            return;
          }
          // Allow inside model.subscribe / fieldModel.subscribe callback (runs on model change, after load).
          if (this.isInsideModelSubscribeCallback(ancestors)) {
            return;
          }
          // Check if the class name is in the allowlist
          const className = this.getClassNameArgument(node);
          if (className && !this.isAllowedStateClass(className)) {
            issues.push({
              severity: 'warning',
              type: 'dynamic-class-manipulation',
              file: context.filename,
              line: node.loc?.start.line,
              functionContext: initContext || 'top-level',
              message: `classList.${method}('${className}') during form initialization may cause CLS if the class affects layout.`,
              pattern: this.extractCodeSnippet(content, node),
              className,
              recommendation: 'Pre-render classes in HTML or apply them server-side. Dynamic class changes during load cause layout shifts. If this is for state management, consider adding the class name to the allowlist.',
              cwvImpact: 'CLS',
            });
          }
        }
      }
    }
  }

  /**
   * Detect dynamic import() expressions for CSS
   */
  detectImportExpression(node, ancestors, content, context, issues) {
    // Check if we're inside an event handler callback
    if (this.isInsideEventHandlerCallback(ancestors)) {
      return; // Skip - this code runs after form load
    }

    // Determine if we should flag this import
    const initContext = this.getInitializationContext(ancestors);
    const hasContainingFunction = ancestors.some(a => 
      a.type === 'FunctionDeclaration' || 
      a.type === 'FunctionExpression' || 
      a.type === 'ArrowFunctionExpression'
    );
    
    const shouldFlag = context.isDecorateFormFile || initContext || !hasContainingFunction;
    
    if (!shouldFlag) {
      return; // Not in initialization context
    }

    // Check if it's a CSS import
    const source = node.source;
    if (source && this.isCSSimport(source, content)) {
      issues.push({
        severity: 'error',
        type: 'dynamic-css-loading',
        file: context.filename,
        line: node.loc?.start.line,
        functionContext: initContext || 'top-level',
        message: `Dynamic CSS import during form initialization causes CLS.`,
        pattern: this.extractCodeSnippet(content, node),
        recommendation: 'Use static imports or load CSS in <head>. Dynamic imports of CSS cause layout shifts.',
        cwvImpact: 'CLS, LCP',
      });
    }
  }

  /**
   * Detect problematic member expressions (style access)
   */
  detectMemberExpression(node, ancestors, content, context, issues) {
    // Skip if inside event handler
    if (context.isInsideEventHandler) {
      return;
    }

    // Check for element.style.xxx access in assignment context
    // This is handled in detectAssignment
  }

  /**
   * Detect problematic assignments
   */
  detectAssignment(node, ancestors, content, context, issues) {
    // Check if we're inside an event handler callback by examining ancestors
    if (this.isInsideEventHandlerCallback(ancestors)) {
      return; // Skip - this code runs after form load
    }

    // Determine if we should flag this assignment
    const initContext = this.getInitializationContext(ancestors);
    const hasContainingFunction = ancestors.some(a => 
      a.type === 'FunctionDeclaration' || 
      a.type === 'FunctionExpression' || 
      a.type === 'ArrowFunctionExpression'
    );
    
    const shouldFlag = context.isDecorateFormFile || initContext || !hasContainingFunction;
    
    if (!shouldFlag) {
      return; // Not in initialization context
    }

    // Allow style/class in direct body of decorate (one-time setup). Flag inside subscribe and other callbacks.
    if (this.isInDirectBodyOfInitFunction(ancestors)) {
      return;
    }
    // Allow in subscribe's change branch (runs after form load, no CLS). Flag in register branch.
    if (this.isInsideSubscribeChangeBranch(ancestors)) {
      return;
    }
    // Allow inside model.subscribe / fieldModel.subscribe callback (runs on model change, after load).
    if (this.isInsideModelSubscribeCallback(ancestors)) {
      return;
    }

    const left = node.left;

    // 1. Detect element.style.xxx = value
    if (left.type === 'MemberExpression' && left.object?.type === 'MemberExpression') {
      if (left.object.property?.name === 'style') {
        const styleProperty = left.property?.name;
        if (styleProperty && this.isLayoutAffectingStyle(styleProperty)) {
          issues.push({
            severity: 'warning',
            type: 'direct-style-manipulation',
            file: context.filename,
            line: node.loc?.start.line,
            functionContext: initContext || 'top-level',
            message: `Direct style manipulation (style.${styleProperty}) during form initialization may cause CLS.`,
            pattern: this.extractCodeSnippet(content, node),
            styleProperty,
            recommendation: 'Use CSS classes instead of direct style manipulation. Define styles in CSS files and toggle classes for state changes.',
            cwvImpact: 'CLS',
          });
        }
      }
    }

    // 2. Detect element.style.cssText = '...'
    if (left.type === 'MemberExpression') {
      if (left.property?.name === 'cssText' && left.object?.property?.name === 'style') {
        issues.push({
          severity: 'warning',
          type: 'direct-style-manipulation',
          file: context.filename,
          line: node.loc?.start.line,
          functionContext: initContext || 'top-level',
          message: `style.cssText assignment during form initialization causes CLS.`,
          pattern: this.extractCodeSnippet(content, node),
          recommendation: 'Use CSS classes instead of inline styles. Define styles in CSS files.',
          cwvImpact: 'CLS',
        });
      }
    }

    // 3. Detect element.className = '...'
    if (left.type === 'MemberExpression' && left.property?.name === 'className') {
      issues.push({
        severity: 'warning',
        type: 'dynamic-class-manipulation',
        file: context.filename,
        line: node.loc?.start.line,
        functionContext: initContext || 'top-level',
        message: `className assignment during form initialization may cause CLS.`,
        pattern: this.extractCodeSnippet(content, node),
        recommendation: 'Pre-render classes in HTML. Dynamic className changes during load cause layout shifts.',
        cwvImpact: 'CLS',
      });
    }
  }

  /**
   * Check if a function name indicates initialization
   */
  isInitializationFunction(funcName) {
    if (!funcName) return false;
    return this.initializationFunctions.has(funcName) ||
           funcName.toLowerCase().includes('init') ||
           funcName.toLowerCase().includes('setup') ||
           funcName.toLowerCase().includes('decorate');
  }

  /**
   * Check if a node is an event handler callback
   */
  isEventHandlerCallback(parent, node) {
    if (!parent) return false;

    // Check for addEventListener('click', callback)
    if (parent.type === 'CallExpression') {
      const calleeName = this.getCalleeName(parent.callee);
      if (calleeName === 'addEventListener' || calleeName.endsWith('.addEventListener')) {
        const eventType = parent.arguments[0];
        if (eventType && this.userEventTypes.has(this.getStringValue(eventType))) {
          return true;
        }
      }
    }

    // Check for element.onclick = function() {}
    if (parent.type === 'AssignmentExpression') {
      const left = parent.left;
      if (left.type === 'MemberExpression') {
        const propName = left.property?.name;
        if (propName && propName.startsWith('on')) {
          const eventType = propName.slice(2).toLowerCase();
          if (this.userEventTypes.has(eventType)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Get function name from parent context
   */
  getFunctionName(parent, node) {
    if (!parent) return null;

    // const funcName = () => {}
    if (parent.type === 'VariableDeclarator' && parent.id?.name) {
      return parent.id.name;
    }

    // obj.funcName = () => {}
    if (parent.type === 'AssignmentExpression' && parent.left?.property?.name) {
      return parent.left.property.name;
    }

    // { funcName: () => {} }
    if (parent.type === 'Property' && parent.key?.name) {
      return parent.key.name;
    }

    return null;
  }

  /**
   * Get callee name from various node types
   */
  getCalleeName(callee) {
    if (!callee) return '';
    
    if (callee.type === 'Identifier') {
      return callee.name;
    }
    
    if (callee.type === 'MemberExpression') {
      const obj = callee.object?.name || '';
      const prop = callee.property?.name || '';
      return obj ? `${obj}.${prop}` : prop;
    }
    
    return '';
  }

  /**
   * Check if an argument is a CSS import
   */
  isCSSimport(arg, content) {
    if (arg.type === 'Literal' && typeof arg.value === 'string') {
      return arg.value.endsWith('.css');
    }
    if (arg.type === 'TemplateLiteral') {
      // Extract template literal content
      const snippet = content.substring(arg.start, arg.end);
      return snippet.includes('.css');
    }
    return false;
  }

  /**
   * Check if a node is classList method
   */
  isClassListMethod(callee) {
    if (callee.object?.type === 'MemberExpression') {
      return callee.object.property?.name === 'classList';
    }
    if (callee.object?.type === 'Identifier' && callee.object.name === 'classList') {
      return true;
    }
    return false;
  }

  /**
   * Get class name from classList.add/remove/toggle call
   */
  getClassNameArgument(node) {
    const arg = node.arguments[0];
    if (!arg) return null;
    return this.getStringValue(arg);
  }

  /**
   * Check if a class name is in the allowed state classes
   */
  isAllowedStateClass(className) {
    if (!className) return false;
    
    // Check exact match
    if (this.allowedStateClasses.has(className)) {
      return true;
    }
    
    // Check if contains allowed patterns (e.g., 'field-valid', 'input-error')
    for (const allowed of this.allowedStateClasses) {
      if (className.includes(allowed)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check if a style property affects layout
   */
  isLayoutAffectingStyle(property) {
    const layoutProperties = new Set([
      'display',
      'visibility',
      'width',
      'height',
      'minWidth',
      'minHeight',
      'maxWidth',
      'maxHeight',
      'padding',
      'paddingTop',
      'paddingBottom',
      'paddingLeft',
      'paddingRight',
      'margin',
      'marginTop',
      'marginBottom',
      'marginLeft',
      'marginRight',
      'position',
      'top',
      'bottom',
      'left',
      'right',
      'flex',
      'flexDirection',
      'flexWrap',
      'flexGrow',
      'flexShrink',
      'flexBasis',
      'grid',
      'gridTemplate',
      'gridTemplateColumns',
      'gridTemplateRows',
      'gap',
      'fontSize',
      'lineHeight',
      'transform',
      'float',
      'clear',
      'overflow',
      'overflowX',
      'overflowY',
    ]);
    
    return layoutProperties.has(property);
  }

  /**
   * Check if argument is a specific string value
   */
  isStringValue(arg, value) {
    if (arg.type === 'Literal' && arg.value === value) {
      return true;
    }
    return false;
  }

  /**
   * Get string value from a node
   */
  getStringValue(node) {
    if (!node) return null;
    if (node.type === 'Literal' && typeof node.value === 'string') {
      return node.value;
    }
    return null;
  }

  /**
   * Extract code snippet from content
   */
  extractCodeSnippet(content, node) {
    try {
      const lines = content.split('\n');
      const line = lines[node.loc.start.line - 1];
      return line?.trim().substring(0, 100) || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Compare before and after analyses
   */
  compare(beforeAnalysis, afterAnalysis) {
    const before = beforeAnalysis || { issues: [], summary: {} };
    const after = afterAnalysis || { issues: [], summary: {} };

    // Find new issues (in after but not in before)
    const newIssues = (after.issues || []).filter(afterIssue =>
      !(before.issues || []).some(beforeIssue =>
        beforeIssue.file === afterIssue.file &&
        beforeIssue.type === afterIssue.type &&
        beforeIssue.line === afterIssue.line
      )
    );

    // Find resolved issues (in before but not in after)
    const resolvedIssues = (before.issues || []).filter(beforeIssue =>
      !(after.issues || []).some(afterIssue =>
        afterIssue.file === beforeIssue.file &&
        afterIssue.type === beforeIssue.type &&
        afterIssue.line === beforeIssue.line
      )
    );

    return {
      before,
      after,
      newIssues,
      resolvedIssues,
      delta: {
        dynamicCSSLoading: (after.summary?.dynamicCSSLoading || 0) - (before.summary?.dynamicCSSLoading || 0),
        dynamicStyleInjection: (after.summary?.dynamicStyleInjection || 0) - (before.summary?.dynamicStyleInjection || 0),
        dynamicClassManipulation: (after.summary?.dynamicClassManipulation || 0) - (before.summary?.dynamicClassManipulation || 0),
        directStyleManipulation: (after.summary?.directStyleManipulation || 0) - (before.summary?.directStyleManipulation || 0),
      },
    };
  }
}
