/**
 * Analyzes hidden fields to detect unnecessary DOM bloat
 * Detects fields that are always hidden and only used for data storage
 */
import * as core from '@actions/core';

export class HiddenFieldsAnalyzer {
  constructor(config = null) {
    this.config = config;
  }

  /**
   * Analyze form JSON and JavaScript for hidden field usage
   * @param {Object} formJson - Form JSON object
   * @param {Array} jsFiles - Array of {filename, content} objects
   * @returns {Object} Analysis results
   */
  analyze(formJson, jsFiles = []) {
    if (!formJson) {
      return { error: 'No form JSON provided' };
    }

    core.info(`[HiddenFields] Starting analysis with ${jsFiles.length} JS file(s)`);
    
    const hiddenFields = this.findHiddenFields(formJson);
    core.info(`[HiddenFields] Found ${hiddenFields.length} hidden field(s) in form JSON`);
    
    const fieldVisibilityChanges = this.analyzeJSForVisibilityChanges(jsFiles);
    const visibilityChangeCount = Object.keys(fieldVisibilityChanges).length;
    core.info(`[HiddenFields] Found visibility changes for ${visibilityChangeCount} field identifier(s) in JS`);
    
    if (visibilityChangeCount > 0) {
      core.info(`[HiddenFields] Visibility changes detected for: ${Object.keys(fieldVisibilityChanges).slice(0, 5).join(', ')}${visibilityChangeCount > 5 ? '...' : ''}`);
    }
    
    const issues = this.detectUnnecessaryHiddenFields(hiddenFields, fieldVisibilityChanges);

    return {
      totalHiddenFields: hiddenFields.length,
      hiddenFields,
      fieldVisibilityChanges,
      unnecessaryHiddenFields: issues.length,
      issues,
    };
  }

  /**
   * Find all hidden fields in form JSON
   * @param {Object} node - Form node
   * @param {Array} fields - Array to populate
   * @param {string} path - Current path
   */
  findHiddenFields(node, fields = [], path = '') {
    if (!node) return fields;

    // Check if this field is hidden
    const isHidden = node.visible === false;
    const hasVisibleRule = node.rules?.visible !== undefined;
    const hasVisibleEvent = node.events && Object.keys(node.events).some(event =>
      typeof node.events[event] === 'string' && node.events[event].includes('visible')
    );

    if (isHidden && node.name) {
      const fieldName = node.name;
      const fieldPath = path || fieldName;

      fields.push({
        name: fieldName,
        path: fieldPath,
        fieldType: node.fieldType,
        hasVisibleRule,
        hasVisibleEvent,
        visibleRule: node.rules?.visible,
        // Initially assume it's unnecessary unless proven otherwise
        likelyUnnecessary: !hasVisibleRule && !hasVisibleEvent,
      });
    }

    // Traverse children
    if (node.items) {
      if (Array.isArray(node.items)) {
        node.items.forEach((child, index) => {
          // Use child's name if available, otherwise fall back to index
          const childPath = child?.name 
            ? (path ? `${path}.${child.name}` : child.name)
            : (path ? `${path}.items[${index}]` : `items[${index}]`);
          this.findHiddenFields(child, fields, childPath);
        });
      }
    }

    if (node[':items']) {
      Object.entries(node[':items']).forEach(([key, child]) => {
        // Use child's name property, NOT the key (which is the node ID)
        const childPath = child?.name 
          ? (path ? `${path}.${child.name}` : child.name)
          : (path ? `${path}.${key}` : key);
        this.findHiddenFields(child, fields, childPath);
      });
    }

    return fields;
  }

  /**
   * Analyze JavaScript files for setProperty calls that change visibility
   * @param {Array} jsFiles - Array of {filename, content} objects
   * @returns {Object} Field visibility changes found in JS
   */
  analyzeJSForVisibilityChanges(jsFiles) {
    const visibilityChanges = {};
    let totalMatches = 0;

    core.info(`[HiddenFields] Scanning ${jsFiles.length} JS file(s) for visibility changes...`);

    jsFiles.forEach(file => {
      const { filename, content } = file;
      let fileMatches = 0;
      
      // Pattern 1: globals.functions.setProperty(globals.form.fieldName, { visible: true/false })
      const setPropertyPattern = /globals\.functions\.setProperty\s*\(\s*globals\.form(?:\?\.)?([a-zA-Z0-9_.?]+)\s*,\s*\{[^}]*visible\s*:\s*(true|false)[^}]*\}/g;
      
      let match;
      while ((match = setPropertyPattern.exec(content)) !== null) {
        const fieldPath = match[1];
        const visibleValue = match[2] === 'true';
        fileMatches++;
        totalMatches++;
        
        // Extract both field name AND full path for matching
        // e.g., "?.panel?.subPanel?.email" → path: "panel.subPanel.email", name: "email"
        const pathSegments = fieldPath.split(/[.?]/).filter(Boolean);
        const fieldName = pathSegments[pathSegments.length - 1];
        const fullPath = pathSegments.join('.');
        
        // Store by both name and full path
        // This allows matching by name (for simple cases) and path (for duplicates)
        const keys = [fieldName, fullPath];
        
        keys.forEach(key => {
          if (!visibilityChanges[key]) {
            visibilityChanges[key] = {
              files: [],
              madeVisible: false,
              madeHidden: false,
            };
          }

          visibilityChanges[key].files.push({
            filename,
            visible: visibleValue,
            line: this.getLineNumber(content, match.index),
          });

          if (visibleValue) {
            visibilityChanges[key].madeVisible = true;
          } else {
            visibilityChanges[key].madeHidden = true;
          }
        });
      }

      // Pattern 2: Direct property assignment like field.visible = true
      const directAssignmentPattern = /globals\.form(?:\?\.)?([a-zA-Z0-9_.?]+)\.visible\s*=\s*(true|false)/g;
      
      while ((match = directAssignmentPattern.exec(content)) !== null) {
        const fieldPath = match[1];
        const visibleValue = match[2] === 'true';
        
        const pathSegments = fieldPath.split(/[.?]/).filter(Boolean);
        const fieldName = pathSegments[pathSegments.length - 1];
        const fullPath = pathSegments.join('.');
        
        const keys = [fieldName, fullPath];
        
        keys.forEach(key => {
          if (!visibilityChanges[key]) {
            visibilityChanges[key] = {
              files: [],
              madeVisible: false,
              madeHidden: false,
            };
          }

          visibilityChanges[key].files.push({
            filename,
            visible: visibleValue,
            line: this.getLineNumber(content, match.index),
          });

          if (visibleValue) {
            visibilityChanges[key].madeVisible = true;
          }
        });
      }
    });

    return visibilityChanges;
  }

  /**
   * Get line number from content and index
   */
  getLineNumber(content, index) {
    return content.substring(0, index).split('\n').length;
  }

  /**
   * Detect unnecessary hidden fields
   */
  detectUnnecessaryHiddenFields(hiddenFields, visibilityChanges) {
    const issues = [];
    let foundInJS = 0;

    core.info(`[HiddenFields] Analyzing ${hiddenFields.length} hidden field(s) for unnecessary usage...`);

    hiddenFields.forEach((field, index) => {
      const { name, path, hasVisibleRule, hasVisibleEvent, visibleRule } = field;
      
      // Check if field is ever made visible in JS
      // Try multiple matching strategies for robustness:
      // 1. Exact path match (most accurate)
      // 2. Exact name match (fallback for simple cases)
      // 3. Fuzzy match: any JS path ends with our path (handles parent path differences)
      
      const jsVisibilityByPath = visibilityChanges[path];
      const jsVisibilityByName = visibilityChanges[name];
      
      let fuzzyMatch = null;
      let fuzzyMatchPath = null;
      if (!jsVisibilityByPath && !jsVisibilityByName) {
        for (const [jsPath, jsVisibility] of Object.entries(visibilityChanges)) {
          // Check if JS path ends with our path (e.g., "parentPanel.panel.field" matches "panel.field")
          if (jsPath.endsWith(path) || jsPath.endsWith(`.${name}`)) {
            fuzzyMatch = jsVisibility;
            fuzzyMatchPath = jsPath;
            break;
          }
        }
      }
      
      const madeVisibleInJS = 
        jsVisibilityByPath?.madeVisible === true || 
        jsVisibilityByName?.madeVisible === true ||
        fuzzyMatch?.madeVisible === true;

      // Only log when we find a visibility change in JS (reduces noise)
      if (jsVisibilityByPath) {
        foundInJS++;
        core.info(`[HiddenFields] ✓ Field "${name}" (path: "${path}") - FOUND by exact path match`);
        core.info(`[HiddenFields]   → Made visible: ${jsVisibilityByPath.madeVisible}, Files: ${jsVisibilityByPath.files.map(f => f.filename).join(', ')}`);
      } else if (jsVisibilityByName) {
        foundInJS++;
        core.info(`[HiddenFields] ✓ Field "${name}" (path: "${path}") - FOUND by name match`);
        core.info(`[HiddenFields]   → Made visible: ${jsVisibilityByName.madeVisible}, Files: ${jsVisibilityByName.files.map(f => f.filename).join(', ')}`);
      } else if (fuzzyMatch) {
        foundInJS++;
        core.info(`[HiddenFields] ✓ Field "${name}" (path: "${path}") - FOUND by fuzzy match (JS path: "${fuzzyMatchPath}")`);
        core.info(`[HiddenFields]   → Made visible: ${fuzzyMatch.madeVisible}, Files: ${fuzzyMatch.files.map(f => f.filename).join(', ')}`);
      }

      // Field is potentially unnecessary if:
      // 1. It has no visible rule in JSON
      // 2. It has no event that sets visibility
      // 3. It's never made visible in JavaScript
      const isUnnecessary = !hasVisibleRule && !hasVisibleEvent && !madeVisibleInJS;

      if (isUnnecessary) {
        issues.push({
          severity: 'error', // Critical in PR mode (must fix), shown as warning in scheduled mode
          type: 'unnecessary-hidden-field',
          field: name,
          path,
          message: `Field "${name}" is always hidden and increases DOM size unnecessarily.`,
          recommendation: 'Consider removing this field from the form and storing this as form variable. Hidden fields that are never shown bloat the DOM and impact performance.',
        });
      }

      // Additional check: Field has visible rule but it evaluates to a static false
      if (hasVisibleRule && this.isStaticFalse(visibleRule)) {
        issues.push({
          severity: 'error', // Critical in PR mode (must fix), shown as warning in scheduled mode
          type: 'static-false-visibility',
          field: name,
          path,
          message: `Field "${name}" has a visibility rule that always evaluates to false.`,
          visibleRule,
          recommendation: 'Remove this field or fix the visibility rule. A rule that always returns false serves no purpose.',
        });
      }
    });

    core.info(`[HiddenFields] Summary: ${foundInJS}/${hiddenFields.length} hidden fields have visibility controls in JS`);
    core.info(`[HiddenFields] Found ${issues.length} unnecessary hidden field(s)`);

    return issues;
  }

  /**
   * Check if a visibility rule is statically false
   */
  isStaticFalse(rule) {
    if (typeof rule !== 'string') return false;
    
    const staticFalsePatterns = [
      /^false\(\)$/,
      /^false$/,
      /^0$/,
      /^null$/,
      /^undefined$/,
    ];

    return staticFalsePatterns.some(pattern => pattern.test(rule.trim()));
  }

  /**
   * Compare before and after analyses
   */
  compare(beforeData, afterData) {
    const resolvedIssues = beforeData.issues.filter(beforeIssue =>
      !afterData.issues.some(afterIssue =>
        afterIssue.field === beforeIssue.field && afterIssue.type === afterIssue.type
      )
    );

    return {
      before: beforeData,
      after: afterData,
      delta: {
        hiddenFields: afterData.totalHiddenFields - beforeData.totalHiddenFields,
        unnecessaryFields: afterData.unnecessaryHiddenFields - beforeData.unnecessaryHiddenFields,
      },
      newIssues: afterData.issues, // Report ALL issues in current state
      resolvedIssues,
    };
  }
}

