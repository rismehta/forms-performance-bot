/**
 * Generates a comprehensive HTML performance report
 * Uploaded as GitHub artifact for detailed analysis
 */
export class HTMLReporter {
  constructor() {
    this.timestamp = new Date().toISOString();
  }

  /**
   * Generate full HTML report
   */
  generateReport(results, urls, prNumber, repo) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Performance Report - PR #${prNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      line-height: 1.6;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header { 
      background: linear-gradient(135deg, #1f6feb 0%, #0969da 100%);
      padding: 30px;
      border-radius: 8px;
      margin-bottom: 30px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    h1 { font-size: 2em; margin-bottom: 10px; color: #fff; }
    .meta { color: rgba(255,255,255,0.8); font-size: 0.9em; }
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .card h3 { 
      font-size: 0.9em;
      color: #8b949e;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .card .value { 
      font-size: 2.5em;
      font-weight: bold;
      margin-bottom: 5px;
    }
    .card .label { color: #8b949e; font-size: 0.9em; }
    .critical { color: #f85149; }
    .warning { color: #d29922; }
    .success { color: #3fb950; }
    .info { color: #58a6ff; }
    
    .section {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 25px;
      margin-bottom: 20px;
    }
    .section h2 {
      font-size: 1.5em;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 2px solid #21262d;
      color: #58a6ff;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
      background: #0d1117;
      border-radius: 6px;
      overflow: hidden;
    }
    th {
      background: #21262d;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #c9d1d9;
      border-bottom: 2px solid #30363d;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #21262d;
    }
    tr:hover { background: #161b22; }
    
    .issue-item {
      background: #0d1117;
      border-left: 4px solid #f85149;
      padding: 15px;
      margin: 10px 0;
      border-radius: 4px;
    }
    .issue-item.warning { border-left-color: #d29922; }
    .issue-item h4 { margin-bottom: 8px; color: #f85149; }
    .issue-item.warning h4 { color: #d29922; }
    .issue-item code {
      background: #161b22;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
      color: #79c0ff;
    }
    
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 0.85em;
      font-weight: 600;
      margin-right: 8px;
    }
    .badge.critical { background: #f85149; color: #fff; }
    .badge.warning { background: #d29922; color: #000; }
    .badge.success { background: #3fb950; color: #000; }
    .badge.info { background: #58a6ff; color: #000; }
    
    pre {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 16px;
      overflow-x: auto;
      margin: 10px 0;
      font-size: 0.9em;
    }
    code { 
      font-family: 'Courier New', monospace;
      color: #79c0ff;
    }
    
    .collapsible {
      cursor: pointer;
      padding: 12px;
      background: #21262d;
      border: none;
      width: 100%;
      text-align: left;
      border-radius: 6px;
      color: #c9d1d9;
      font-weight: 600;
      margin: 10px 0;
    }
    .collapsible:hover { background: #30363d; }
    .collapsible:after {
      content: '▼';
      float: right;
      margin-left: 5px;
    }
    .collapsible.active:after { content: '▲'; }
    .content {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.2s ease-out;
      background: #0d1117;
      border-radius: 0 0 6px 6px;
    }
    .content.active {
      max-height: 5000px;
      padding: 15px;
      border: 1px solid #30363d;
      border-top: none;
    }
    
    footer {
      text-align: center;
      padding: 30px;
      color: #8b949e;
      font-size: 0.9em;
    }
    
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    
    .metric-delta.positive { color: #3fb950; }
    .metric-delta.negative { color: #f85149; }
    .metric-delta.neutral { color: #8b949e; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1> Performance Analysis Report</h1>
      <div class="meta">
        <strong>PR #${prNumber}</strong> | ${repo} | ${new Date(this.timestamp).toLocaleString()}
      </div>
    </header>

    ${this.buildSummaryCards(results)}
    ${this.buildCriticalIssuesSection(results)}
    ${this.buildFormLoadSection(urls)}
    ${this.buildFormStructureSection(results)}
    ${this.buildFormEventsSection(results)}
    ${this.buildHiddenFieldsSection(results)}
    ${this.buildRuleCyclesSection(results)}
    ${this.buildFormHTMLSection(results)}
    ${this.buildFormCSSSection(results)}
    ${this.buildCustomFunctionsSection(results)}
    ${this.buildRecommendationsSection(results)}

    <footer>
      Generated by <strong>AEM Forms Performance Analyzer</strong><br>
      <a href="https://github.com/rismehta/forms-performance-bot">View on GitHub</a>
    </footer>
  </div>

  <script>
    // Collapsible sections
    document.querySelectorAll('.collapsible').forEach(button => {
      button.addEventListener('click', function() {
        this.classList.toggle('active');
        const content = this.nextElementSibling;
        content.classList.toggle('active');
      });
    });
  </script>
</body>
</html>`;

    return html;
  }

  buildSummaryCards(results) {
    const critical = this.countCriticalIssues(results);
    const warnings = this.countWarnings(results);
    const components = results.formStructure?.after?.components?.total || 0;
    const rules = results.ruleCycles?.after?.totalRules || 0;

    return `
    <div class="summary-cards">
      <div class="card">
        <h3>Critical Issues</h3>
        <div class="value critical">${critical}</div>
        <div class="label">Requires immediate action</div>
      </div>
      <div class="card">
        <h3>Warnings</h3>
        <div class="value warning">${warnings}</div>
        <div class="label">Performance improvements</div>
      </div>
      <div class="card">
        <h3>Components</h3>
        <div class="value info">${components}</div>
        <div class="label">Form elements analyzed</div>
      </div>
      <div class="card">
        <h3>Rules</h3>
        <div class="value ${results.ruleCycles?.after?.cycles > 0 ? 'critical' : 'success'}">${rules}</div>
        <div class="label">${results.ruleCycles?.after?.cycles || 0} circular dependencies</div>
      </div>
    </div>`;
  }

  buildCriticalIssuesSection(results) {
    const criticalIssues = [];
    
    // API calls in initialize
    if (results.formEvents?.after?.apiCallsInInitialize?.length > 0) {
      criticalIssues.push({
        title: 'API Calls Blocking Form Render',
        count: results.formEvents.after.apiCallsInInitialize.length,
        severity: 'critical',
        description: 'API calls in initialize events block form rendering'
      });
    }
    
    // HTTP in custom functions
    const httpCount = results.customFunctions?.after?.httpRequestCount || 0;
    if (httpCount > 0) {
      criticalIssues.push({
        title: 'HTTP Requests in Custom Functions',
        count: httpCount,
        severity: 'critical',
        description: 'Direct HTTP calls bypass form error handling'
      });
    }
    
    // CSS critical
    const cssIssues = results.formCSS?.after?.issues?.filter(i => i.severity === 'error') || [];
    if (cssIssues.length > 0) {
      criticalIssues.push({
        title: 'Critical CSS Issues',
        count: cssIssues.length,
        severity: 'critical',
        description: 'CSS anti-patterns impacting render performance'
      });
    }

    if (criticalIssues.length === 0) {
      return '<div class="section"><h2> No Critical Issues</h2><p>All checks passed!</p></div>';
    }

    return `
    <div class="section">
      <h2> Critical Issues</h2>
      ${criticalIssues.map(issue => `
        <div class="issue-item">
          <h4><span class="badge critical">${issue.count}</span>${issue.title}</h4>
          <p>${issue.description}</p>
        </div>
      `).join('')}
    </div>`;
  }

  buildFormLoadSection(urls) {
    const before = urls.beforeData?.performanceMetrics;
    const after = urls.afterData?.performanceMetrics;
    
    if (!before && !after) return '';

    const beforeTime = before?.formRendered ? before.loadTime : '15000+';
    const afterTime = after?.formRendered ? after.loadTime : '15000+';
    const status = after?.formRendered ? 
      (after.loadTime < 2000 ? 'success' : after.loadTime < 3000 ? 'info' : 'warning') : 
      'critical';

    return `
    <div class="section">
      <h2> Form Load Performance</h2>
      <table>
        <tr>
          <th>Metric</th>
          <th>Before</th>
          <th>After</th>
          <th>Change</th>
          <th>Status</th>
        </tr>
        <tr>
          <td>Form Render Time</td>
          <td>${beforeTime}ms</td>
          <td>${afterTime}ms</td>
          <td class="metric-delta ${afterTime < beforeTime ? 'positive' : 'negative'}">
            ${afterTime - beforeTime > 0 ? '+' : ''}${afterTime - beforeTime}ms
          </td>
          <td><span class="badge ${status}">${after?.formRendered ? 'Loaded' : 'Failed'}</span></td>
        </tr>
        <tr>
          <td>DOM Nodes</td>
          <td>${before?.domNodes || '-'}</td>
          <td>${after?.domNodes || '-'}</td>
          <td>-</td>
          <td>-</td>
        </tr>
        <tr>
          <td>JS Heap Size</td>
          <td>${before?.jsHeapSize ? (before.jsHeapSize / 1024 / 1024).toFixed(1) + 'MB' : '-'}</td>
          <td>${after?.jsHeapSize ? (after.jsHeapSize / 1024 / 1024).toFixed(1) + 'MB' : '-'}</td>
          <td>-</td>
          <td>-</td>
        </tr>
      </table>
    </div>`;
  }

  buildFormStructureSection(results) {
    const data = results.formStructure?.after?.components;
    if (!data) return '';

    return `
    <div class="section">
      <h2> Form Structure</h2>
      <table>
        <tr>
          <th>Metric</th>
          <th>Count</th>
        </tr>
        <tr>
          <td>Total Components</td>
          <td>${data.total}</td>
        </tr>
        <tr>
          <td>Event Handlers</td>
          <td>${results.formStructure?.after?.events?.total || 0}</td>
        </tr>
        <tr>
          <td>Max Nesting Depth</td>
          <td><span class="${data.maxDepth > 7 ? 'critical' : data.maxDepth > 4 ? 'warning' : 'success'}">${data.maxDepth} levels</span></td>
        </tr>
        <tr>
          <td>Hidden Fields</td>
          <td>${data.hidden || 0}</td>
        </tr>
        <tr>
          <td>Visible Fields</td>
          <td>${data.visible || 0}</td>
        </tr>
      </table>
    </div>`;
  }

  buildFormEventsSection(results) {
    const apiCalls = results.formEvents?.after?.apiCallsInInitialize || [];
    if (apiCalls.length === 0) {
      return '<div class="section"><h2> Form Events</h2><p>No API calls in initialize events</p></div>';
    }

    return `
    <div class="section">
      <h2> Form Events (${apiCalls.length} API Calls in Initialize)</h2>
      ${apiCalls.map(call => `
        <div class="issue-item">
          <h4>${call.field} <code>${call.path}</code></h4>
          <p><strong>Type:</strong> ${call.type}</p>
          <p><strong>Expression:</strong></p>
          <pre><code>${call.expression.substring(0, 150)}...</code></pre>
        </div>
      `).join('')}
      <p><strong>Recommendation:</strong> Move API calls to <code>custom:formViewInitialized</code> event</p>
    </div>`;
  }

  buildHiddenFieldsSection(results) {
    const data = results.hiddenFields?.after;
    if (!data || data.unnecessaryHiddenFields === 0) {
      return '<div class="section"><h2> Hidden Fields</h2><p>No unnecessary hidden fields detected</p></div>';
    }

    const fields = data.issues || [];
    const displayFields = fields.slice(0, 20);

    return `
    <div class="section">
      <h2> Hidden Fields (${data.unnecessaryHiddenFields} Unnecessary)</h2>
      <p><strong>Total Hidden:</strong> ${data.totalHiddenFields} | <strong>Unnecessary:</strong> ${data.unnecessaryHiddenFields}</p>
      
      <button class="collapsible">View Field Names (${fields.length})</button>
      <div class="content">
        <p>${displayFields.map(f => `<code>${f.field || f.name}</code>`).join(', ')}</p>
        ${fields.length > 20 ? `<p>... and ${fields.length - 20} more</p>` : ''}
      </div>
      
      <p><strong>Recommendation:</strong> Remove these fields and use <code>setVariable()</code> for state storage</p>
    </div>`;
  }

  buildRuleCyclesSection(results) {
    const data = results.ruleCycles?.after;
    if (!data) return '';

    if (data.cycles === 0) {
      return `<div class="section"><h2> Rule Performance</h2><p>${data.totalRules} rules analyzed, no circular dependencies</p></div>`;
    }

    const cycles = data.cycleDetails || [];

    return `
    <div class="section">
      <h2> Rule Cycles (${data.cycles} Detected)</h2>
      ${cycles.map((cycle, idx) => `
        <div class="issue-item">
          <h4>Cycle ${idx + 1}: ${cycle.fields.join(' → ')}</h4>
          <p><strong>Path:</strong> ${cycle.path.join(' → ')}</p>
        </div>
      `).join('')}
    </div>`;
  }

  buildFormHTMLSection(results) {
    const data = results.formHTML?.after;
    if (!data || !data.issues || data.issues.length === 0) {
      return '<div class="section"><h2> Form HTML</h2><p>No rendering issues detected</p></div>';
    }

    return `
    <div class="section">
      <h2> Form HTML & Rendering</h2>
      ${data.issues.slice(0, 10).map(issue => `
        <div class="issue-item ${issue.severity === 'error' ? '' : 'warning'}">
          <h4>${issue.message}</h4>
          ${issue.scripts && issue.scripts.length > 0 ? `
            <p><strong>Scripts to fix:</strong></p>
            <ul>
              ${issue.scripts.map(s => `<li><code>${s.src}</code> (in ${s.location})</li>`).join('')}
            </ul>
          ` : ''}
          ${issue.recommendation ? `<p><strong>Fix:</strong> ${issue.recommendation}</p>` : ''}
        </div>
      `).join('')}
      ${data.issues.length > 10 ? `<p><em>... and ${data.issues.length - 10} more issues</em></p>` : ''}
    </div>`;
  }

  buildFormCSSSection(results) {
    const data = results.formCSS?.after;
    if (!data || !data.issues || data.issues.length === 0) {
      return '<div class="section"><h2> CSS Analysis</h2><p>No CSS issues detected</p></div>';
    }

    const critical = data.issues.filter(i => i.severity === 'error');
    const warnings = data.issues.filter(i => i.severity === 'warning');

    return `
    <div class="section">
      <h2> CSS Analysis</h2>
      
      ${critical.length > 0 ? `
        <h3>Critical Issues (${critical.length})</h3>
        ${critical.map(issue => `
          <div class="issue-item">
            <h4>${issue.type}</h4>
            <p><code>${issue.file}:${issue.line}</code></p>
            <p>${issue.message}</p>
          </div>
        `).join('')}
      ` : ''}
      
      ${warnings.length > 0 ? `
        <button class="collapsible">View Warnings (${warnings.length})</button>
        <div class="content">
          ${warnings.slice(0, 20).map(issue => `
            <div class="issue-item warning">
              <h4>${issue.type}</h4>
              <p><code>${issue.file}${issue.line ? ':' + issue.line : ''}</code></p>
            </div>
          `).join('')}
          ${warnings.length > 20 ? `<p><em>... and ${warnings.length - 20} more</em></p>` : ''}
        </div>
      ` : ''}
    </div>`;
  }

  buildCustomFunctionsSection(results) {
    const data = results.customFunctions?.after;
    if (!data) return '';

    const httpIssues = data.issues?.filter(i => i.type === 'http-request') || [];
    const domIssues = data.issues?.filter(i => i.type === 'dom-access') || [];

    if (httpIssues.length === 0 && domIssues.length === 0) {
      return `<div class="section"><h2> Custom Functions</h2><p>${data.analyzed} functions analyzed, no violations</p></div>`;
    }

    return `
    <div class="section">
      <h2> Custom Functions</h2>
      <p><strong>Analyzed:</strong> ${data.analyzed} functions</p>
      
      ${httpIssues.length > 0 ? `
        <h3>HTTP Requests (${httpIssues.length})</h3>
        ${httpIssues.map(issue => `
          <div class="issue-item">
            <h4>${issue.functionName}() in <code>${issue.file}</code></h4>
            <p>Direct HTTP call bypasses form's request() API</p>
          </div>
        `).join('')}
      ` : ''}
      
      ${domIssues.length > 0 ? `
        <h3>DOM Access (${domIssues.length})</h3>
        ${domIssues.map(issue => `
          <div class="issue-item">
            <h4>${issue.functionName}() in <code>${issue.file}</code></h4>
            <p>Direct DOM manipulation bypasses form state</p>
          </div>
        `).join('')}
      ` : ''}
    </div>`;
  }

  buildRecommendationsSection(results) {
    const recommendations = this.generateRecommendations(results);
    if (recommendations.length === 0) return '';

    return `
    <div class="section">
      <h2> Recommendations</h2>
      <ol>
        ${recommendations.map(rec => `<li>${rec}</li>`).join('')}
      </ol>
    </div>`;
  }

  countCriticalIssues(results) {
    let count = 0;
    if (results.formEvents?.after?.apiCallsInInitialize?.length) count += results.formEvents.after.apiCallsInInitialize.length;
    if (results.customFunctions?.after?.httpRequestCount) count += results.customFunctions.after.httpRequestCount;
    if (results.formCSS?.after?.issues?.filter(i => i.severity === 'error').length) count += results.formCSS.after.issues.filter(i => i.severity === 'error').length;
    if (results.ruleCycles?.after?.cycles) count += results.ruleCycles.after.cycles;
    return count;
  }

  countWarnings(results) {
    let count = 0;
    if (results.hiddenFields?.after?.unnecessaryHiddenFields) count += results.hiddenFields.after.unnecessaryHiddenFields;
    if (results.formCSS?.after?.issues?.filter(i => i.severity === 'warning').length) count += results.formCSS.after.issues.filter(i => i.severity === 'warning').length;
    if (results.formHTML?.after?.issues?.filter(i => i.severity === 'warning').length) count += results.formHTML.after.issues.filter(i => i.severity === 'warning').length;
    return count;
  }

  generateRecommendations(results) {
    const recs = [];
    if (results.formEvents?.after?.apiCallsInInitialize?.length) {
      recs.push('Move API calls from initialize to custom events or lazy load after render');
    }
    if (results.hiddenFields?.after?.unnecessaryHiddenFields > 0) {
      recs.push(`Remove ${results.hiddenFields.after.unnecessaryHiddenFields} hidden fields - use setVariable() instead`);
    }
    if (results.customFunctions?.after?.httpRequestCount > 0) {
      recs.push('Use request() API tool instead of direct HTTP calls in custom functions');
    }
    return recs;
  }
}

