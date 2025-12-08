import { createFormInstance } from '@aemforms/af-core';

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

    try {
      // Register mock custom functions to prevent crashes during form initialization
      const { FunctionRuntime, createFormInstanceSync } = await import('@aemforms/af-core');
      const mockFunctions = {
        createJourneyId: () => 'mock-journey-id',
        loadUserData: () => {},
        mockApiCall: () => {},
      };
      
      // Register mock functions
      FunctionRuntime.registerFunctions(mockFunctions);
      
      // Use createFormInstanceSync which waits for all promises (including rule execution)
      // This ensures ExecuteRule event completes and dependencies are tracked
      // After this call returns, all rules have executed and _dependents arrays are populated
      const form = await createFormInstanceSync(formJson, undefined, 'error');
      
      // After createFormInstance returns, the event queue has run and dependencies are tracked
      // Now build the dependency graph from the form instance's internal state
      const dependencyGraph = this.buildDependencyGraphFromForm(form);
      const cycles = this.detectCycles(dependencyGraph);
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
        error: error.message,
        stack: error.stack,
      };
    }
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


    // Visit each field in the form using the built-in visitor
    form.visit((field) => {
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
    return {
      before: beforeData,
      after: afterData,
      delta: {
        cycles: (afterData.cycles || 0) - (beforeData.cycles || 0),
        totalRules: (afterData.totalRules || 0) - (beforeData.totalRules || 0),
      },
      newCycles: (afterData.cycleDetails || []).filter(afterCycle =>
        !(beforeData.cycleDetails || []).some(beforeCycle => beforeCycle.key === afterCycle.key)
      ),
      resolvedCycles: (beforeData.cycleDetails || []).filter(beforeCycle =>
        !(afterData.cycleDetails || []).some(afterCycle => afterCycle.key === beforeCycle.key)
      ),
    };
  }
}

