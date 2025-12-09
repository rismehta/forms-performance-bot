/**
 * Analyzes form events for performance anti-patterns
 * Specific check: API calls in initialize events should be in render instead
 */
export class FormEventsAnalyzer {
  constructor(config = null) {
    this.config = config;
  }

  /**
   * Analyze form JSON for event-related issues
   * @param {Object} formJson - Form JSON object
   * @returns {Object} Analysis results
   */
  analyze(formJson) {
    if (!formJson) {
      return { error: 'No form JSON provided' };
    }

    const issues = [];
    const apiCallPatterns = this.findAPICallsInInitialize(formJson, issues);

    return {
      apiCallsInInitialize: apiCallPatterns,
      issues,
    };
  }

  /**
   * Find API calls in initialize events
   * @param {Object} node - Form node
   * @param {Array} issues - Issues array to populate
   * @param {string} path - Current path in form
   */
  findAPICallsInInitialize(node, issues, path = '') {
    const apiCalls = [];

    if (!node) return apiCalls;

    // Check if current node has initialize event with API call
    if (node.events?.initialize) {
      const initializeEvent = node.events.initialize;
      
      // Handle both string and array formats
      const expressions = Array.isArray(initializeEvent) ? initializeEvent : [initializeEvent];
      
      expressions.forEach(expression => {
        const hasAPICall = this.detectAPICall(expression);

        if (hasAPICall) {
          const fieldName = node.name || node.fieldType || path.split('.').pop() || 'form';
          const fieldPath = path || fieldName;

          apiCalls.push({
            field: fieldName,
            path: fieldPath,
            expression: expression,
            apiCallType: hasAPICall.type,
          });

          issues.push({
            severity: 'error',
            type: 'api-call-in-initialize',
            field: fieldName,
            path: fieldPath,
            message: `API call found in initialize event for field "${fieldName}". This blocks form rendering.`,
            expression: expression,
            apiCallType: hasAPICall.type,
            recommendation: 'Move API calls to custom events triggered after render, or use lazy loading patterns. Initialize events should only set up initial state, not fetch data.',
          });
        }
      });
    }

    // Traverse children
    if (node.items) {
      if (Array.isArray(node.items)) {
        node.items.forEach((child, index) => {
          const childPath = path ? `${path}.items[${index}]` : `items[${index}]`;
          apiCalls.push(...this.findAPICallsInInitialize(child, issues, childPath));
        });
      }
    }

    if (node[':items']) {
      Object.entries(node[':items']).forEach(([key, child]) => {
        const childPath = path ? `${path}.${key}` : key;
        apiCalls.push(...this.findAPICallsInInitialize(child, issues, childPath));
      });
    }

    return apiCalls;
  }

  /**
   * Detect if an expression contains an API call
   * @param {string} expression - Expression to check
   * @returns {Object|null} API call info or null
   */
  detectAPICall(expression) {
    if (typeof expression !== 'string') return null;

    // Common API call patterns in adaptive forms
    const patterns = [
      { regex: /request\s*\([^)]+\)/gi, type: 'request' },
      { regex: /fetch\s*\([^)]+\)/gi, type: 'fetch' },
      { regex: /\$\.(get|post|ajax|getJSON)\s*\(/gi, type: 'jquery-ajax' },
      { regex: /XMLHttpRequest/gi, type: 'xhr' },
      { regex: /axios\.(get|post|request)/gi, type: 'axios' },
    ];

    for (const pattern of patterns) {
      if (pattern.regex.test(expression)) {
        return { type: pattern.type };
      }
    }

    return null;
  }

  /**
   * Compare before and after analyses
   */
  compare(beforeJson, afterJson) {
    if (!beforeJson || !afterJson) {
      return { error: 'Missing form JSON for comparison' };
    }

    const beforeAnalysis = this.analyze(beforeJson);
    const afterAnalysis = this.analyze(afterJson);

    // Handle cases where analysis failed or returned incomplete data
    const beforeIssues = beforeAnalysis?.issues || [];
    const afterIssues = afterAnalysis?.issues || [];
    const beforeApiCalls = beforeAnalysis?.apiCallsInInitialize || [];
    const afterApiCalls = afterAnalysis?.apiCallsInInitialize || [];

    const resolvedIssues = beforeIssues.filter(beforeIssue =>
      !afterIssues.some(afterIssue =>
        afterIssue.field === beforeIssue.field && afterIssue.type === beforeIssue.type
      )
    );

    return {
      before: beforeAnalysis || {},
      after: afterAnalysis || {},
      delta: {
        apiCallsAdded: afterApiCalls.length - beforeApiCalls.length,
      },
      newIssues: afterIssues, // Report ALL issues in current state
      resolvedIssues,
    };
  }
}

