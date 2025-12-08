/**
 * Analyzes adaptive form JSON for performance issues
 */
export class FormAnalyzer {
  constructor(config = null) {
    this.config = config;
  }

  /**
   * Analyze a single form JSON
   * @param {Object} formJson - Form JSON object
   * @returns {Object} Analysis results
   */
  analyze(formJson) {
    if (!formJson) {
      return { error: 'No form JSON provided' };
    }

    return {
      metadata: this.extractMetadata(formJson),
      components: this.analyzeComponents(formJson),
      events: this.analyzeEvents(formJson),
      rules: this.analyzeRules(formJson),
      fragments: this.analyzeFragments(formJson),
      issues: this.detectIssues(formJson),
    };
  }

  /**
   * Extract basic form metadata
   */
  extractMetadata(formJson) {
    return {
      id: formJson.id,
      title: formJson.title,
      action: formJson.action,
      version: formJson.adaptiveform,
      theme: formJson.properties?.themeClientLibRef,
      variant: formJson.properties?.variant,
    };
  }

  /**
   * Analyze form components structure
   */
  analyzeComponents(formJson, depth = 0) {
    const stats = {
      total: 0,
      byType: {},
      maxDepth: 0,
      nestedPanels: 0,
      repeatable: 0,
      visible: 0,
      hidden: 0,
    };

    const traverse = (node, currentDepth, isRoot = false) => {
      if (!node) return;

      // Update max depth
      stats.maxDepth = Math.max(stats.maxDepth, currentDepth);

      // Don't count the root form itself as a component
      if (!isRoot) {
        stats.total++;

        // Count by type (exclude root form)
        if (node.fieldType) {
          stats.byType[node.fieldType] = (stats.byType[node.fieldType] || 0) + 1;
        }

        // Count special attributes (only for actual components, not root)
        if (node.repeatable) stats.repeatable++;
        
        // Visibility check - only count if visible property exists
        if (node.hasOwnProperty('visible')) {
          if (node.visible === false) {
            stats.hidden++;
          } else {
            stats.visible++;
          }
        } else {
          // If no visible property, assume visible (default for AEM forms)
          stats.visible++;
        }
        
        if (node.fieldType === 'panel' && currentDepth > 0) stats.nestedPanels++;
      }

      // Traverse children
      if (node[':items']) {
        Object.values(node[':items']).forEach(child => {
          traverse(child, currentDepth + 1, false);
        });
      }
    };

    // Start traversal, marking root as true
    traverse(formJson, 0, true);
    return stats;
  }


  /**
   * Analyze event handlers in the form
   */
  analyzeEvents(formJson) {
    const events = {
      total: 0,
      byType: {},
      componentsWithEvents: 0,
    };

    const traverse = (node) => {
      if (!node) return;

      if (node.events) {
        events.componentsWithEvents++;
        Object.entries(node.events).forEach(([eventType, handlers]) => {
          const handlerCount = Array.isArray(handlers) ? handlers.length : 1;
          events.total += handlerCount;
          events.byType[eventType] = (events.byType[eventType] || 0) + handlerCount;
        });
      }

      if (node[':items']) {
        Object.values(node[':items']).forEach(traverse);
      }
    };

    traverse(formJson);
    return events;
  }

  /**
   * Analyze validation rules
   */
  analyzeRules(formJson) {
    const rules = {
      total: 0,
      componentsWithRules: 0,
      validationRules: 0,
      customRules: 0,
    };

    const traverse = (node) => {
      if (!node) return;

      if (node.properties?.['fd:rules']) {
        rules.componentsWithRules++;
        rules.total++;
      }

      if (node.required) rules.validationRules++;
      if (node.pattern) rules.validationRules++;
      if (node.minimum !== undefined || node.maximum !== undefined) rules.validationRules++;

      if (node[':items']) {
        Object.values(node[':items']).forEach(traverse);
      }
    };

    traverse(formJson);
    return rules;
  }

  /**
   * Analyze form fragments usage
   */
  analyzeFragments(formJson) {
    const fragments = {
      count: 0,
      paths: [],
    };

    const traverse = (node) => {
      if (!node) return;

      if (node.fieldType === 'fragment' || node[':type']?.includes('fragment')) {
        fragments.count++;
        if (node.properties?.['fd:path']) {
          fragments.paths.push(node.properties['fd:path']);
        }
      }

      if (node[':items']) {
        Object.values(node[':items']).forEach(traverse);
      }
    };

    traverse(formJson);
    return fragments;
  }

  /**
   * Detect potential performance issues
   */
  detectIssues(formJson) {
    const issues = [];
    const components = this.analyzeComponents(formJson);
    const events = this.analyzeEvents(formJson);

    // Get thresholds from config or use defaults
    const maxComponents = this.config?.thresholds?.form?.maxComponents || 75;
    const maxDepth = this.config?.thresholds?.form?.maxDepth || 8;
    const maxEventHandlers = this.config?.thresholds?.form?.maxEventHandlers || 30;
    const maxNestedPanels = this.config?.thresholds?.form?.maxNestedPanels || 15;

    // Too many components
    if (components.total > maxComponents) {
      issues.push({
        severity: 'warning',
        type: 'component-count',
        message: `High component count (${components.total}). Consider breaking into multiple forms or using fragments.`,
        value: components.total,
        threshold: maxComponents,
        cwvImpact: 'LCP, INP'
      });
    }

    // Deep nesting
    if (components.maxDepth > maxDepth) {
      issues.push({
        severity: 'warning',
        type: 'nesting-depth',
        message: `Deep nesting detected (${components.maxDepth} levels). This may impact rendering performance.`,
        value: components.maxDepth,
        threshold: maxDepth,
        cwvImpact: 'INP'
      });
    }

    // Too many nested panels
    if (components.nestedPanels > maxNestedPanels) {
      issues.push({
        severity: 'info',
        type: 'nested-panels',
        message: `High number of nested panels (${components.nestedPanels}). Consider flattening the structure.`,
        value: components.nestedPanels,
        threshold: maxNestedPanels,
        cwvImpact: 'LCP'
      });
    }

    // Too many event handlers
    if (events.total > maxEventHandlers) {
      issues.push({
        severity: 'warning',
        type: 'event-handlers',
        message: `High number of event handlers (${events.total}). Consider consolidating event logic.`,
        value: events.total,
        threshold: maxEventHandlers,
        cwvImpact: 'INP, TBT'
      });
    }

    return issues;
  }

  /**
   * Compare two form JSONs
   */
  compare(beforeJson, afterJson) {
    if (!beforeJson || !afterJson) {
      return { error: 'Missing form JSON for comparison' };
    }

    const beforeAnalysis = this.analyze(beforeJson);
    const afterAnalysis = this.analyze(afterJson);

    return {
      before: beforeAnalysis,
      after: afterAnalysis,
      delta: {
        components: afterAnalysis.components.total - beforeAnalysis.components.total,
        events: afterAnalysis.events.total - beforeAnalysis.events.total,
        maxDepth: afterAnalysis.components.maxDepth - beforeAnalysis.components.maxDepth,
      },
      newIssues: this.findNewIssues(beforeAnalysis.issues, afterAnalysis.issues),
      resolvedIssues: this.findResolvedIssues(beforeAnalysis.issues, afterAnalysis.issues),
    };
  }

  /**
   * Find new issues introduced
   */
  findNewIssues(beforeIssues, afterIssues) {
    return afterIssues.filter(afterIssue => {
      return !beforeIssues.some(beforeIssue => beforeIssue.type === afterIssue.type);
    });
  }

  /**
   * Find issues that were resolved
   */
  findResolvedIssues(beforeIssues, afterIssues) {
    return beforeIssues.filter(beforeIssue => {
      return !afterIssues.some(afterIssue => afterIssue.type === beforeIssue.type);
    });
  }
}

