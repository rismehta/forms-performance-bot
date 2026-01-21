/**
 * Event Impact Analyzer
 * Generates impact analysis showing which events affect which fields
 * Useful for understanding ripple effects when modifying events
 */

export class EventImpactAnalyzer {
  constructor(config = null) {
    this.config = config;
  }

  /**
   * Generate impact analysis: Event → Fields mapping
   * Shows which fields are affected when an event fires
   */
  analyze(formJson) {
    const eventImpactMap = {};
    const fieldEventMap = {}; // Reverse map: field → events that target it
    
    // Traverse form and extract all events
    const traverse = (node, path = []) => {
      if (!node) return;
      
      const fieldName = node.name || node.id;
      const currentPath = fieldName ? [...path, fieldName] : path;
      const fieldPath = currentPath.join('.');
      
      // Process events on this field
      if (node.events && typeof node.events === 'object') {
        Object.entries(node.events).forEach(([eventType, handlers]) => {
          // Skip if no valid field path
          const sourceField = fieldPath || '(root)';
          const eventKey = `${sourceField} → ${eventType}`;
          
          if (!eventImpactMap[eventKey]) {
            eventImpactMap[eventKey] = {
              sourceField,
              eventType,
              handlers: [],
              impactedFields: new Set(),
              customFunctions: new Set(),
              hasHTTPCalls: false,
              hasDOMAccess: false,
            };
          }
          
          const handlerArray = Array.isArray(handlers) ? handlers : [handlers];
          
          handlerArray.forEach(handler => {
            if (typeof handler !== 'string') return;
            
            eventImpactMap[eventKey].handlers.push(handler);
            
            // Extract impacted fields from handler
            this.extractImpactedFields(handler, eventImpactMap[eventKey], fieldEventMap);
            
            // Extract custom functions used
            this.extractCustomFunctions(handler, eventImpactMap[eventKey]);
            
            // Detect performance issues
            if (handler.includes('fetch(') || handler.includes('axios.')) {
              eventImpactMap[eventKey].hasHTTPCalls = true;
            }
            if (handler.includes('document.') || handler.includes('querySelector')) {
              eventImpactMap[eventKey].hasDOMAccess = true;
            }
          });
        });
      }
      
      // Traverse children
      if (node[':items']) {
        Object.values(node[':items']).forEach(child => traverse(child, currentPath));
      }
      if (node.items && Array.isArray(node.items)) {
        node.items.forEach(child => traverse(child, currentPath));
      }
    };
    
    traverse(formJson);
    
    // Convert Sets to Arrays for JSON serialization
    Object.values(eventImpactMap).forEach(event => {
      event.impactedFields = Array.from(event.impactedFields).sort();
      event.customFunctions = Array.from(event.customFunctions).sort();
    });
    
    // Detect duplicates and similar events (PRIMARY USE CASE)
    const duplicateAnalysis = this.detectDuplicateEvents(eventImpactMap);
    
    return {
      totalEvents: Object.keys(eventImpactMap).length,
      events: eventImpactMap,
      fieldEventMap, // field → list of events targeting it
      summary: this.generateSummary(eventImpactMap, fieldEventMap),
      duplicates: duplicateAnalysis.duplicates,
      similarEvents: duplicateAnalysis.similar,
      performanceIssues: this.identifyPerformanceIssues(eventImpactMap),
    };
  }
  
  extractImpactedFields(handler, event, fieldEventMap) {
    // Match patterns like:
    // - setProperty($form.field, ...)
    // - dispatchEvent($form.field, ...)
    // - field.$value = ...
    // - globals.functions.setProperty(field, ...)
    
    // Safety check
    if (!event || !event.sourceField || !event.eventType) {
      return;
    }
    
    const patterns = [
      /\$form\.([a-zA-Z0-9_.]+)/g,
      /setProperty\s*\(\s*\$?form\.([a-zA-Z0-9_.]+)/g,
      /dispatchEvent\s*\(\s*\$?form\.([a-zA-Z0-9_.]+)/g,
      /([a-zA-Z0-9_.]+)\.\$value/g,
      /globals\.functions\.setProperty\s*\(\s*([a-zA-Z0-9_.]+)/g,
    ];
    
    patterns.forEach(pattern => {
      let match;
      const handlerCopy = handler; // Reset regex state
      while ((match = pattern.exec(handlerCopy)) !== null) {
        let fieldPath = match[1].replace(/^\$form\./, '');
        
        // Filter out common false positives
        if (fieldPath && 
            fieldPath !== 'undefined' && 
            fieldPath !== 'form' &&
            fieldPath !== '$form' &&
            !fieldPath.startsWith('functions.')) {
          event.impactedFields.add(fieldPath);
          
          // Add to reverse map (with safety check)
          if (fieldEventMap) {
            if (!fieldEventMap[fieldPath]) {
              fieldEventMap[fieldPath] = [];
            }
            fieldEventMap[fieldPath].push(`${event.sourceField} → ${event.eventType}`);
          }
        }
      }
    });
  }
  
  extractCustomFunctions(handler, event) {
    // Match function calls: functionName(...)
    const functionPattern = /(\w+)\s*\(/g;
    const jsKeywords = new Set([
      'if', 'for', 'while', 'setProperty', 'dispatchEvent', 'getVariable',
      'setVariable', 'length', 'split', 'join', 'map', 'filter', 'includes',
      'parseInt', 'parseFloat', 'Date', 'Math', 'Array', 'Object', 'String'
    ]);
    
    let match;
    while ((match = functionPattern.exec(handler)) !== null) {
      const fnName = match[1];
      if (!jsKeywords.has(fnName)) {
        event.customFunctions.add(fnName);
      }
    }
  }
  
  generateSummary(eventImpactMap, fieldEventMap) {
    const fieldImpactCount = {};
    const eventTypeCount = {};
    const customFunctionUsage = {};
    
    Object.values(eventImpactMap).forEach(event => {
      // Safety checks
      if (!event || !event.sourceField || !event.eventType) {
        return;
      }
      
      // Count by event type
      eventTypeCount[event.eventType] = (eventTypeCount[event.eventType] || 0) + 1;
      
      // Count fields impacted
      if (event.impactedFields && typeof event.impactedFields.forEach === 'function') {
        event.impactedFields.forEach(field => {
          fieldImpactCount[field] = (fieldImpactCount[field] || 0) + 1;
        });
      }
      
      // Count custom function usage
      if (event.customFunctions && typeof event.customFunctions.forEach === 'function') {
        event.customFunctions.forEach(fn => {
          if (fn && typeof fn === 'string' && fn.length > 0) {
            // Get or create the usage object
            let usage = customFunctionUsage[fn];
            if (!usage) {
              usage = { count: 0, events: [] };
              customFunctionUsage[fn] = usage;
            }
            // Update the usage
            usage.count++;
            if (usage.events && Array.isArray(usage.events)) {
              usage.events.push(`${event.sourceField} → ${event.eventType}`);
            }
          }
        });
      }
    });
    
    // Find top impacted fields
    const topImpactedFields = Object.entries(fieldImpactCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([field, count]) => ({ field, impactCount: count }));
    
    // Find fields with most incoming events
    const mostTargetedFields = Object.entries(fieldEventMap)
      .map(([field, events]) => ({ field, eventCount: events.length }))
      .sort((a, b) => b.eventCount - a.eventCount)
      .slice(0, 20);
    
    return {
      totalEventTypes: Object.keys(eventTypeCount).length,
      eventsByType: eventTypeCount,
      topImpactedFields, // Fields modified by the most events
      mostTargetedFields, // Fields that are targets of the most events
      customFunctionUsage,
      totalUniqueFieldsImpacted: Object.keys(fieldImpactCount).length,
    };
  }
  
  /**
   * Detect duplicate and similar events
   * PRIMARY USE CASE: Prevent new developers from creating duplicate logic
   */
  detectDuplicateEvents(eventImpactMap) {
    const duplicates = [];
    const similar = [];
    const eventsByField = {};
    
    // Group events by source field and event type
    Object.entries(eventImpactMap).forEach(([eventKey, event]) => {
      const key = `${event.sourceField}::${event.eventType}`;
      if (!eventsByField[key]) {
        eventsByField[key] = [];
      }
      eventsByField[key].push({ eventKey, event });
    });
    
    // Check for exact duplicates (same field, same event type, multiple handlers)
    Object.entries(eventsByField).forEach(([key, events]) => {
      if (events.length > 1) {
        duplicates.push({
          field: events[0].event.sourceField,
          eventType: events[0].event.eventType,
          count: events.length,
          handlers: events.map(e => e.event.handlers).flat(),
          message: `${events.length} handlers defined for same event - may cause unexpected behavior`,
        });
      }
    });
    
    // Check for similar events (different events doing similar things)
    const allEvents = Object.entries(eventImpactMap);
    for (let i = 0; i < allEvents.length; i++) {
      for (let j = i + 1; j < allEvents.length; j++) {
        const [key1, event1] = allEvents[i];
        const [key2, event2] = allEvents[j];
        
        // Skip if same source field (handled by duplicates)
        if (event1.sourceField === event2.sourceField) continue;
        
        // Check if they impact the same fields
        const commonImpacts = event1.impactedFields.filter(f => 
          event2.impactedFields.includes(f)
        );
        
        // Check if they use same custom functions
        const commonFunctions = event1.customFunctions.filter(f =>
          event2.customFunctions.includes(f)
        );
        
        // If they have significant overlap, they might be doing similar things
        if (commonImpacts.length >= 3 || commonFunctions.length >= 2) {
          similar.push({
            event1: key1,
            event2: key2,
            commonImpacts,
            commonFunctions,
            message: `These events may have overlapping logic`,
          });
        }
      }
    }
    
    return { duplicates, similar };
  }
  
  /**
   * Detect performance issues (SECONDARY - not the main goal)
   */
  identifyPerformanceIssues(eventImpactMap) {
    const issues = [];
    
    Object.entries(eventImpactMap).forEach(([eventKey, event]) => {
      if (event.hasHTTPCalls) {
        issues.push({
          severity: 'critical',
          type: 'http-in-event',
          event: eventKey,
          message: `Event contains HTTP calls - will block user interaction`,
        });
      }
      
      if (event.hasDOMAccess) {
        issues.push({
          severity: 'warning',
          type: 'dom-in-event',
          event: eventKey,
          message: `Event accesses DOM directly - may cause layout thrashing`,
        });
      }
      
      if (event.impactedFields.length > 10) {
        issues.push({
          severity: 'warning',
          type: 'high-impact',
          event: eventKey,
          message: `Event impacts ${event.impactedFields.length} fields - may cause cascading updates`,
        });
      }
    });
    
    return issues;
  }
  
  /**
   * Generate markdown report for GitHub PR comment or Gist
   */
  generateMarkdownReport(analysis) {
    let markdown = `# 📊 Event Impact Analysis Report\n\n`;
    markdown += `**Generated:** ${new Date().toISOString()}\n\n`;
    markdown += `> **Purpose:** Prevent duplicate events, track impact of changes, document current setup\n\n`;
    
    markdown += `## 📈 Summary\n\n`;
    markdown += `| Metric | Value |\n`;
    markdown += `|--------|-------|\n`;
    markdown += `| Total Events | ${analysis.totalEvents} |\n`;
    markdown += `| Event Types | ${analysis.summary.totalEventTypes} |\n`;
    markdown += `| Unique Fields Impacted | ${analysis.summary.totalUniqueFieldsImpacted} |\n`;
    markdown += `| **Duplicate Events** | **${analysis.duplicates?.length || 0}** |\n`;
    markdown += `| **Similar Events** | **${analysis.similarEvents?.length || 0}** |\n`;
    markdown += `| Performance Issues | ${analysis.performanceIssues.length} |\n\n`;
    
    // PRIORITY 1: Duplicate Events (Main use case!)
    if (analysis.duplicates && analysis.duplicates.length > 0) {
      markdown += `## 🚨 Duplicate Events Found\n\n`;
      markdown += `**⚠️ IMPORTANT:** Multiple handlers defined for the same event. This may cause:\n`;
      markdown += `- Unexpected behavior (which handler runs first?)\n`;
      markdown += `- Maintenance nightmares (developers don't know about duplicate logic)\n`;
      markdown += `- Regression bugs (modifying one handler, forgetting the other)\n\n`;
      
      analysis.duplicates.forEach((dup, idx) => {
        markdown += `### ${idx + 1}. \`${dup.field}\` → **${dup.eventType}**\n\n`;
        markdown += `- **${dup.count} handlers** defined for this event\n`;
        markdown += `- **Action Required:** Consolidate into single handler or verify this is intentional\n\n`;
        markdown += `<details>\n<summary>Show All ${dup.count} Handlers</summary>\n\n`;
        dup.handlers.forEach((handler, i) => {
          markdown += `**Handler ${i + 1}:**\n\`\`\`javascript\n${handler}\n\`\`\`\n\n`;
        });
        markdown += `</details>\n\n`;
      });
    }
    
    // PRIORITY 2: Similar Events (Potential duplicates)
    if (analysis.similarEvents && analysis.similarEvents.length > 0) {
      markdown += `## 🔍 Similar Events Detected\n\n`;
      markdown += `**Note:** These events are on different fields but do similar things. Consider:\n`;
      markdown += `- Are they intentionally similar?\n`;
      markdown += `- Could they share common logic via a custom function?\n`;
      markdown += `- Is one a copy-paste of the other?\n\n`;
      
      analysis.similarEvents.slice(0, 10).forEach((sim, idx) => {
        markdown += `### ${idx + 1}. Similarity Between:\n`;
        markdown += `- **Event 1:** \`${sim.event1}\`\n`;
        markdown += `- **Event 2:** \`${sim.event2}\`\n\n`;
        
        if (sim.commonImpacts.length > 0) {
          markdown += `**Common Fields Modified:** ${sim.commonImpacts.map(f => `\`${f}\``).join(', ')}\n\n`;
        }
        if (sim.commonFunctions.length > 0) {
          markdown += `**Common Functions Used:** ${sim.commonFunctions.map(f => `\`${f}()\``).join(', ')}\n\n`;
        }
        markdown += `---\n\n`;
      });
      
      if (analysis.similarEvents.length > 10) {
        markdown += `*... and ${analysis.similarEvents.length - 10} more similar event pairs*\n\n`;
      }
    }
    
    // Performance Issues (Secondary - still useful but not main goal)
    if (analysis.performanceIssues.length > 0) {
      markdown += `## ⚠️ Performance Issues\n\n`;
      const critical = analysis.performanceIssues.filter(i => i.severity === 'critical');
      const warnings = analysis.performanceIssues.filter(i => i.severity === 'warning');
      
      if (critical.length > 0) {
        markdown += `### 🔴 Critical (${critical.length})\n\n`;
        critical.forEach(issue => {
          markdown += `- **${issue.event}**\n`;
          markdown += `  - ${issue.message}\n`;
        });
        markdown += `\n`;
      }
      
      if (warnings.length > 0) {
        markdown += `### 🟡 Warnings (${warnings.length})\n\n`;
        warnings.forEach(issue => {
          markdown += `- **${issue.event}**\n`;
          markdown += `  - ${issue.message}\n`;
        });
        markdown += `\n`;
      }
    }
    
    // Events by Type
    markdown += `## 📋 Events by Type\n\n`;
    Object.entries(analysis.summary.eventsByType)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        markdown += `- **${type}:** ${count} event(s)\n`;
      });
    
    // Top Impacted Fields
    markdown += `\n## 🎯 Top Impacted Fields\n\n`;
    markdown += `These fields are **modified** by the most events:\n\n`;
    markdown += `| Rank | Field | Times Modified |\n`;
    markdown += `|------|-------|----------------|\n`;
    analysis.summary.topImpactedFields.forEach(({ field, impactCount }, idx) => {
      markdown += `| ${idx + 1} | \`${field}\` | ${impactCount} |\n`;
    });
    
    // Most Targeted Fields
    markdown += `\n## 🎯 Most Targeted Fields\n\n`;
    markdown += `These fields are **targets** of the most events:\n\n`;
    markdown += `| Rank | Field | Incoming Events |\n`;
    markdown += `|------|-------|----------------|\n`;
    analysis.summary.mostTargetedFields.forEach(({ field, eventCount }, idx) => {
      markdown += `| ${idx + 1} | \`${field}\` | ${eventCount} |\n`;
    });
    
    // Custom Function Usage
    markdown += `\n## 🔧 Custom Function Usage\n\n`;
    const sortedFunctions = Object.entries(analysis.summary.customFunctionUsage)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15);
    
    if (sortedFunctions.length > 0) {
      markdown += `| Function | Usage Count | Sample Events |\n`;
      markdown += `|----------|-------------|---------------|\n`;
      sortedFunctions.forEach(([fn, data]) => {
        const samples = data.events.slice(0, 2).join('<br>');
        const more = data.events.length > 2 ? `<br>...+${data.events.length - 2} more` : '';
        markdown += `| \`${fn}()\` | ${data.count} | ${samples}${more} |\n`;
      });
    } else {
      markdown += `*No custom functions detected in events*\n`;
    }
    
    // Detailed Event Breakdown
    markdown += `\n## 📖 Detailed Event → Field Mapping\n\n`;
    markdown += `<details>\n<summary>Click to expand full event details (${analysis.totalEvents} events)</summary>\n\n`;
    
    Object.entries(analysis.events)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([eventKey, event]) => {
        markdown += `### ${eventKey}\n\n`;
        
        if (event.impactedFields.length > 0) {
          markdown += `**🎯 Impacts (${event.impactedFields.length}):** `;
          markdown += event.impactedFields.map(f => `\`${f}\``).join(', ');
          markdown += `\n\n`;
        }
        
        if (event.customFunctions.length > 0) {
          markdown += `**🔧 Uses Functions:** `;
          markdown += Array.from(event.customFunctions).map(f => `\`${f}()\``).join(', ');
          markdown += `\n\n`;
        }
        
        if (event.hasHTTPCalls) {
          markdown += `⚠️ **Contains HTTP calls**\n\n`;
        }
        if (event.hasDOMAccess) {
          markdown += `⚠️ **Accesses DOM**\n\n`;
        }
        
        markdown += `<details>\n<summary>Event Handlers (${event.handlers.length})</summary>\n\n`;
        event.handlers.forEach((handler, i) => {
          markdown += `**Handler ${i + 1}:**\n\`\`\`javascript\n${handler}\n\`\`\`\n\n`;
        });
        markdown += `</details>\n\n`;
        markdown += `---\n\n`;
      });
    
    markdown += `</details>\n\n`;
    
    // Impact Analysis Tips
    markdown += `## 💡 How to Use This Report\n\n`;
    markdown += `### Before Making Changes:\n`;
    markdown += `1. **Find your target field** in "Most Targeted Fields" to see what events affect it\n`;
    markdown += `2. **Check dependencies** - modifying an event may have ripple effects\n`;
    markdown += `3. **Review custom functions** to understand what code will execute\n\n`;
    
    markdown += `### Pre-Deployment Validation:\n`;
    markdown += `1. **Check for performance issues** (HTTP calls, DOM access)\n`;
    markdown += `2. **Review high-impact events** (>10 fields)\n`;
    markdown += `3. **Verify custom functions** are still used correctly\n\n`;
    
    markdown += `---\n`;
    markdown += `*Generated by AEM Forms Performance Bot - Event Impact Analyzer*\n`;
    
    return markdown;
  }
  
  /**
   * Generate JSON report for programmatic consumption
   */
  generateJSONReport(analysis) {
    return JSON.stringify(analysis, null, 2);
  }
}

