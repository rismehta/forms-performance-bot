/**
 * Analyzes disabled fields in adaptive forms.
 * Disabled fields do not submit their data; use readOnly when the value should be included in submission.
 */
import * as core from '@actions/core';

export class DisabledFieldsAnalyzer {
  constructor(config = null) {
    this.config = config;
  }

  /**
   * Analyze form JSON and JavaScript for disabled field usage
   * @param {Object} formJson - Form JSON object
   * @param {Array} jsFiles - Array of {filename, content} objects
   * @returns {Object} Analysis results
   */
  analyze(formJson, jsFiles = []) {
    if (!formJson) {
      return { error: 'No form JSON provided' };
    }

    core.info(`[DisabledFields] Starting analysis with ${jsFiles.length} JS file(s)`);

    const disabledInJson = this.findDisabledFieldsInJson(formJson);
    core.info(`[DisabledFields] Found ${disabledInJson.length} disabled field(s) in form JSON`);

    const enabledChangesInJS = this.analyzeJSForEnabledChanges(jsFiles);
    const jsCount = Object.keys(enabledChangesInJS).length;
    core.info(`[DisabledFields] Found enable/disable changes for ${jsCount} field identifier(s) in JS`);

    const enabledChangesInEvents = this.analyzeEventsForEnabledChanges(formJson);
    const eventsCount = Object.keys(enabledChangesInEvents).length;
    core.info(`[DisabledFields] Found enable/disable changes for ${eventsCount} field identifier(s) in events/rules`);

    const disabledViaRules = this.findDisabledViaRules(formJson);

    const allDisabled = this.mergeDisabledSources(
      disabledInJson,
      enabledChangesInJS,
      enabledChangesInEvents,
      disabledViaRules
    );

    return {
      totalDisabledFields: allDisabled.length,
      disabledFields: allDisabled,
      disabledInJson: disabledInJson.length,
      disabledViaRules: disabledViaRules.length,
      enabledChangesInJS,
      enabledChangesInEvents,
    };
  }

  /**
   * Find all fields with enabled === false in form JSON
   */
  findDisabledFieldsInJson(node, fields = [], path = '') {
    if (!node) return fields;

    const isDisabled = node.enabled === false || node.properties?.enabled === false;
    const hasEnabledRule = node.rules?.enabled !== undefined;
    const hasEnabledEvent =
      node.events &&
      Object.keys(node.events).some(
        (event) =>
          typeof node.events[event] === 'string' && node.events[event].includes('enabled')
      );
    const isReadOnly = node.readOnly === true || node.properties?.readOnly === true;

    if (isDisabled && node.name) {
      const fieldName = node.name;
      const fieldPath = path || fieldName;
      fields.push({
        name: fieldName,
        path: fieldPath,
        fieldType: node.fieldType,
        source: 'json',
        hasEnabledRule,
        hasEnabledEvent,
        enabledRule: node.rules?.enabled,
        isReadOnly,
      });
    }

    if (node.items && Array.isArray(node.items)) {
      node.items.forEach((child, index) => {
        const childPath = child?.name
          ? (path ? `${path}.${child.name}` : child.name)
          : (path ? `${path}.items[${index}]` : `items[${index}]`);
        this.findDisabledFieldsInJson(child, fields, childPath);
      });
    }
    if (node[':items']) {
      Object.entries(node[':items']).forEach(([key, child]) => {
        const childPath = child?.name
          ? (path ? `${path}.${child.name}` : child.name)
          : (path ? `${path}.${key}` : key);
        this.findDisabledFieldsInJson(child, fields, childPath);
      });
    }
    return fields;
  }

  /**
   * Find fields that are disabled via fd:rules (setProperty with enabled: false)
   */
  findDisabledViaRules(formJson) {
    const disabledByRule = [];
    const traverse = (node, path = '') => {
      if (!node) return;
      const rules = node.properties?.['fd:rules'] || node.rules;
      if (rules && typeof rules === 'object') {
        const ruleStr = JSON.stringify(rules);
        if (/enabled\s*:\s*false\s*\(\)|enabled\s*:\s*false\b/i.test(ruleStr)) {
          if (node.name) {
            const fieldPath = path || node.name;
            disabledByRule.push({
              name: node.name,
              path: fieldPath,
              fieldType: node.fieldType,
              source: 'rules',
            });
          }
        }
      }
      if (node[':items']) {
        Object.entries(node[':items']).forEach(([key, child]) => {
          const childPath = child?.name
            ? (path ? `${path}.${child.name}` : child.name)
            : (path ? `${path}.${key}` : key);
          traverse(child, childPath);
        });
      }
      if (node.items && Array.isArray(node.items)) {
        node.items.forEach((child, index) => {
          const childPath = child?.name
            ? (path ? `${path}.${child.name}` : child.name)
            : (path ? `${path}.items[${index}]` : `items[${index}]`);
          traverse(child, childPath);
        });
      }
    };
    traverse(formJson);
    return disabledByRule;
  }

  /**
   * Analyze events for setProperty / dispatchEvent that change enabled
   */
  analyzeEventsForEnabledChanges(formJson) {
    const changes = {};
    const hasEnabledChange = /enabled\s*:\s*(true|false)\s*\(\)/;
    const targetPathPattern = /dispatchEvent\s*\(\s*['"]?([^'",\s][^'",]*?)['"]?\s*,/;

    const traverse = (node) => {
      if (!node) return;
      if (node.events && typeof node.events === 'object') {
        Object.entries(node.events).forEach(([eventType, handlers]) => {
          if (!Array.isArray(handlers)) return;
          handlers.forEach((handler) => {
            if (typeof handler !== 'string') return;
            if (handler.includes('dispatchEvent') && hasEnabledChange.test(handler)) {
              const targetMatch = handler.match(targetPathPattern);
              const enabledMatch = handler.match(/enabled\s*:\s*(true|false)\s*\(\)/);
              if (targetMatch && enabledMatch) {
                const targetPath = this.normalizeEventPath(targetMatch[1].trim());
                const enabledValue = enabledMatch[1].toLowerCase() === 'true';
                if (!changes[targetPath]) {
                  changes[targetPath] = { madeEnabled: false, madeDisabled: false, rules: [] };
                }
                changes[targetPath].rules.push(handler);
                if (enabledValue) changes[targetPath].madeEnabled = true;
                else changes[targetPath].madeDisabled = true;
              }
            }
          });
        });
      }
      if (node[':items']) Object.values(node[':items']).forEach(traverse);
      if (node.items && Array.isArray(node.items)) node.items.forEach(traverse);
    };
    traverse(formJson);
    return changes;
  }

  /**
   * Analyze JavaScript for setProperty / direct assignment that change enabled
   */
  analyzeJSForEnabledChanges(jsFiles) {
    const changes = {};
    jsFiles.forEach((file) => {
      const { filename, content } = file;
      const setPropertyPattern =
        /globals\.functions\.setProperty\s*\(\s*globals\.form(?:\?\.)?([a-zA-Z0-9_.?]+)\s*,\s*\{[^}]*enabled\s*:\s*(true|false)[^}]*\}/g;
      let match;
      while ((match = setPropertyPattern.exec(content)) !== null) {
        const fieldPath = match[1];
        const enabledValue = match[2] === 'true';
        const pathSegments = fieldPath.split(/[.?]/).filter(Boolean);
        const fieldName = pathSegments[pathSegments.length - 1];
        const fullPath = pathSegments.join('.');
        [fieldName, fullPath].forEach((key) => {
          if (!key) return;
          if (!changes[key]) {
            changes[key] = { files: [], madeEnabled: false, madeDisabled: false };
          }
          changes[key].files.push({
            filename,
            enabled: enabledValue,
            line: this.getLineNumber(content, match.index),
          });
          if (enabledValue) changes[key].madeEnabled = true;
          else changes[key].madeDisabled = true;
        });
      }
      const directPattern = /globals\.form(?:\?\.)?([a-zA-Z0-9_.?]+)\.enabled\s*=\s*(true|false)/g;
      while ((match = directPattern.exec(content)) !== null) {
        const fieldPath = match[1];
        const enabledValue = match[2] === 'true';
        const pathSegments = fieldPath.split(/[.?]/).filter(Boolean);
        const fieldName = pathSegments[pathSegments.length - 1];
        const fullPath = pathSegments.join('.');
        [fieldName, fullPath].forEach((key) => {
          if (!key) return;
          if (!changes[key]) {
            changes[key] = { files: [], madeEnabled: false, madeDisabled: false };
          }
          changes[key].files.push({
            filename,
            enabled: enabledValue,
            line: this.getLineNumber(content, match.index),
          });
          if (enabledValue) changes[key].madeEnabled = true;
          else changes[key].madeDisabled = true;
        });
      }
    });
    return changes;
  }

  getLineNumber(content, index) {
    return content.substring(0, index).split('\n').length;
  }

  normalizeEventPath(path) {
    return path.replace(/^\$form\.?/, '').replace(/\?\./g, '.');
  }

  /**
   * Merge disabled fields from JSON, rules, and optionally from JS/events (fields only disabled in script/rule)
   */
  mergeDisabledSources(disabledInJson, enabledChangesInJS, enabledChangesInEvents, disabledViaRules) {
    const byPath = new Map();
    disabledInJson.forEach((f) => {
      byPath.set(f.path, { ...f, source: 'json', sources: ['json'] });
    });
    disabledViaRules.forEach((f) => {
      const existing = byPath.get(f.path);
      if (existing) {
        if (!existing.sources.includes('rules')) existing.sources.push('rules');
      } else {
        byPath.set(f.path, { ...f, sources: ['rules'] });
      }
    });
    const onlyInScriptOrEvents = new Set();
    [...Object.entries(enabledChangesInJS), ...Object.entries(enabledChangesInEvents)].forEach(
      ([key, data]) => {
        if (data.madeDisabled && !byPath.has(key)) {
          const pathSegments = key.split('.');
          const name = pathSegments[pathSegments.length - 1];
          if (!byPath.has(name)) onlyInScriptOrEvents.add(key);
        }
      }
    );
    onlyInScriptOrEvents.forEach((path) => {
      const pathSegments = path.split('.');
      const name = pathSegments[pathSegments.length - 1];
      if (!byPath.has(path) && !byPath.has(name)) {
        byPath.set(path, {
          name,
          path,
          fieldType: 'unknown',
          source: 'rules_or_script',
          sources: ['rules_or_script'],
        });
      }
    });
    return Array.from(byPath.values());
  }

  compare(beforeData, afterData) {
    return {
      before: beforeData,
      after: afterData,
      delta: {
        disabledFields: (afterData.totalDisabledFields || 0) - (beforeData.totalDisabledFields || 0),
      },
      newIssues: [],
      resolvedIssues: [],
    };
  }
}
