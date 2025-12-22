/**
 * Generates a comprehensive HTML performance report
 * Uploaded as GitHub artifact for detailed analysis
 */
export class HTMLReporter {
  constructor() {
    this.timestamp = new Date().toISOString();
    this.autoFixCommit = null; // Will be set in generateReport
    this.repoUrl = null; // Will be set in generateReport
  }
  
  /**
   * Convert timestamp to IST (Indian Standard Time)
   * @param {string|Date} timestamp - ISO string or Date object
   * @returns {string} - Formatted date in IST
   */
  formatTimestampIST(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }) + ' IST';
  }

  /**
   * Check if a specific file was auto-fixed
   */
  isFileFixed(filename) {
    if (!this.autoFixCommit || !this.autoFixCommit.files) return false;
    return this.autoFixCommit.files.some(f => f.includes(filename));
  }

  /**
   * Generate "Fixed" badge HTML with commit link
   */
  getFixedBadgeHTML() {
    if (!this.autoFixCommit || !this.repoUrl) return '';
    const commitUrl = `https://github.com/${this.repoUrl}/commit/${this.autoFixCommit.sha}`;
    return `<a href="${commitUrl}" class="fixed-badge" target="_blank" title="View auto-fix commit">FIXED</a>`;
  }

  /**
   * Generate auto-fix banner (success or failure)
   */
  buildAutoFixBanner() {
    // No banner if auto-fix wasn't attempted
    if (!this.autoFixCommit && !this.autoFixFailureReason) return '';
    
    // Success banner
    if (this.autoFixCommit && this.autoFixCommit.sha) {
      const commitUrl = `https://github.com/${this.repoUrl}/commit/${this.autoFixCommit.sha}`;
      const shortSha = this.autoFixCommit.sha.substring(0, 7);
      return `
      <div class="autofix-banner success">
        <h3>✓ Auto-Fix Applied Successfully</h3>
        <p><strong>${this.autoFixCommit.filesChanged}</strong> file(s) were automatically fixed and committed to this PR.</p>
        <p>Commit: <a href="${commitUrl}" target="_blank" style="color: #fff; text-decoration: underline;">${shortSha}</a> - ${this.autoFixCommit.message}</p>
        <p><em>Look for green "FIXED" badges below to see which issues were resolved.</em></p>
      </div>`;
    }
    
    // Failure banner
    if (this.autoFixFailureReason) {
      return `
      <div class="autofix-banner">
        <h3>⚠ Auto-Fix Not Applied</h3>
        <p><strong>Reason:</strong> ${this.autoFixFailureReason}</p>
        <p>The bot identified fixable issues but could not commit the changes automatically. Please review the issues below and apply fixes manually.</p>
      </div>`;
    }
    
    return '';
  }

  /**
   * Generate full HTML report
   */
  generateReport(results, urls, prNumber, repo, autoFixCommit = null, autoFixFailureReason = null) {
    // Store for use in helper methods
    this.autoFixCommit = autoFixCommit;
    this.repoUrl = repo;
    this.autoFixFailureReason = autoFixFailureReason;
    
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
      position: relative;
    }
    .issue-item.warning { border-left-color: #d29922; }
    .issue-item.fixed { 
      border-left-color: #238636; 
      opacity: 0.7;
    }
    .issue-item h4 { margin-bottom: 8px; color: #f85149; }
    .issue-item.warning h4 { color: #d29922; }
    .issue-item.fixed h4 { color: #238636; }
    .issue-item code {
      background: #161b22;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
      color: #79c0ff;
    }
    .fixed-badge {
      display: inline-block;
      background: #238636;
      color: #fff;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.75em;
      font-weight: 600;
      margin-left: 10px;
      text-decoration: none;
      transition: background 0.2s;
    }
    .fixed-badge:hover {
      background: #2ea043;
      text-decoration: none;
    }
    .fixed-badge::before {
      content: '✓ ';
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
    
    .autofix-banner {
      background: #d29922;
      border: 2px solid #bb8009;
      border-radius: 8px;
      padding: 15px 20px;
      margin-bottom: 20px;
      color: #000;
    }
    .autofix-banner h3 {
      margin: 0 0 8px 0;
      color: #000;
      font-size: 1.1em;
    }
    .autofix-banner p {
      margin: 0;
      line-height: 1.5;
    }
    .autofix-banner.success {
      background: #238636;
      border-color: #2ea043;
      color: #fff;
    }
    .autofix-banner.success h3 {
      color: #fff;
    }
    
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
        <strong>PR #${prNumber}</strong> | ${repo} | ${this.formatTimestampIST(this.timestamp)}
      </div>
    </header>

    ${this.buildAutoFixBanner()}
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
    ${this.buildFormValidationSection(results)}

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
          <p><strong>Type:</strong> ${call.apiCallType || 'API call'}</p>
          <p><strong>Expression:</strong></p>
          <pre><code>${call.expression.substring(0, 150)}...</code></pre>
        </div>
      `).join('')}
      <p><strong>Recommendation:</strong> Use <strong>Visual Rule Editor</strong> to move API calls from <code>initialize</code> event to <code>custom:formViewInitialized</code> event (triggered after form renders). Initialize events should only set up initial state, not fetch data.</p>
    </div>`;
  }

  buildHiddenFieldsSection(results) {
    const data = results.hiddenFields?.after;
    if (!data || data.unnecessaryHiddenFields === 0) {
      return '<div class="section"><h2> Hidden Fields</h2><p>No unnecessary hidden fields detected</p></div>';
    }

    const fields = data.issues || [];

    return `
    <div class="section">
      <h2> Hidden Fields (${data.unnecessaryHiddenFields} Unnecessary)</h2>
      <p><strong>Total Hidden:</strong> ${data.totalHiddenFields} | <strong>Unnecessary:</strong> ${data.unnecessaryHiddenFields}</p>
      
      <h3>All Unnecessary Hidden Field Names (${fields.length})</h3>
      <div class="issue-list" style="max-height: 400px; overflow-y: auto; border: 1px solid #30363d; padding: 15px; border-radius: 6px; background: #0d1117; margin-bottom: 20px;">
        ${fields.map((f, idx) => `<div style="margin-bottom: 8px;"><strong>${idx + 1}.</strong> <code style="background: #161b22; padding: 2px 6px; border-radius: 3px; color: #79c0ff;">${f.field || f.name}</code></div>`).join('')}
      </div>
      
      <p><strong>Recommendation:</strong> Use <strong>Visual Rule Editor</strong> to replace hidden fields with Form Variables (<code>setVariable()</code> instead of field-based storage). Remove the hidden fields from form JSON. Hidden fields that are never shown bloat the DOM (each adds ~50-100 bytes) and slow down rendering. Configure state management via the rule editor's variable actions.</p>
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
      ${data.issues.map(issue => `
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
        ${critical.map(issue => {
          const isFixed = this.isFileFixed(issue.file);
          const fixedClass = isFixed ? 'fixed' : '';
          const fixedBadge = isFixed ? this.getFixedBadgeHTML() : '';
          return `
          <div class="issue-item ${fixedClass}">
            <h4>${issue.type}${fixedBadge}</h4>
            <p><code>${issue.file}:${issue.line}</code></p>
            <p>${issue.message}</p>
            ${isFixed ? '<p><em>This issue was automatically fixed by the bot</em></p>' : ''}
          </div>
        `;
        }).join('')}
      ` : ''}
      
      ${warnings.length > 0 ? `
        <h3>Warnings (${warnings.length})</h3>
        <div class="issue-list" style="max-height: 500px; overflow-y: auto;">
          ${warnings.map(issue => `
            <div class="issue-item warning">
              <h4>${issue.type}</h4>
              <p><code>${issue.file}${issue.line ? ':' + issue.line : ''}</code></p>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>`;
  }

  buildCustomFunctionsSection(results) {
    const data = results.customFunctions?.after;
    if (!data) return '';

    const httpIssues = data.issues?.filter(i => i.type === 'http-request-in-custom-function') || [];
    const domIssues = data.issues?.filter(i => i.type === 'dom-access-in-custom-function') || [];
    const runtimeErrors = data.issues?.filter(i => i.type === 'runtime-error-in-custom-function') || [];

    if (httpIssues.length === 0 && domIssues.length === 0 && runtimeErrors.length === 0) {
      return `<div class="section"><h2> Custom Functions</h2><p>${data.functionsAnalyzed || 0} functions analyzed, no violations</p></div>`;
    }

    return `
    <div class="section">
      <h2> Custom Functions</h2>
      <p><strong>Analyzed:</strong> ${data.functionsAnalyzed || 0} functions</p>
      
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
      
      ${runtimeErrors.length > 0 ? `
        <h3>Runtime Errors (${runtimeErrors.length})</h3>
        <p class="info">Functions encountered errors during execution. These can be auto-fixed by AI to add proper null/undefined checks.</p>
        ${runtimeErrors.map(issue => {
          const isFixed = this.isFileFixed(issue.file);
          const fixedClass = isFixed ? 'fixed' : '';
          const fixedBadge = isFixed ? this.getFixedBadgeHTML() : '';
          
          // Extract only the error message (first line), remove stack trace
          let errorMessage = 'Unknown error';
          if (issue.errors && issue.errors.length > 0) {
            const fullError = issue.errors[0];
            
            // Try to parse if it's a JSON string
            try {
              const parsedError = JSON.parse(fullError);
              errorMessage = parsedError.message || 'Unknown error';
            } catch (e) {
              // Not JSON, treat as plain string
              // Split by newline and take first line (the actual error message)
              errorMessage = fullError.split('\n')[0].trim();
            }
          }
          
          return `
          <div class="issue-item ${fixedClass}">
            <h4>${issue.functionName}() - ${issue.errorCount} error(s)${fixedBadge}</h4>
            <p><strong>Error:</strong> ${errorMessage}</p>
            <p>${issue.recommendation}</p>
            ${isFixed ? '<p><em>This issue was automatically fixed by the bot</em></p>' : ''}
          </div>
        `;
        }).join('')}
      ` : ''}
    </div>`;
  }

  buildFormValidationSection(results) {
    const validationErrors = results.ruleCycles?.after?.validationErrors;
    if (!validationErrors || !validationErrors.dataRefErrors && !validationErrors.typeConflicts) return '';
    
    const dataRefErrors = validationErrors.dataRefErrors || [];
    const typeConflicts = validationErrors.typeConflicts || [];
    const totalErrors = dataRefErrors.length + typeConflicts.length;
    
    if (totalErrors === 0) return '';
    
    return `
    <div class="section">
      <h2> Form Validation Warnings (${totalErrors})</h2>
      <p class="warning-message">These are form authoring issues detected by af-core. They require fixes in AEM Forms Editor, not code changes.</p>
      
      ${dataRefErrors.length > 0 ? `
      <h3>dataRef Parsing Issues (${dataRefErrors.length})</h3>
      <p><strong>Issue:</strong> af-core failed to parse dataRef for ${dataRefErrors.length} field(s). Data binding will fail and these field values won't be exported in form submission.</p>
      
      ${(() => {
        // Group by root cause
        const ancestorNullIssues = dataRefErrors.filter(e => e.rootCause === 'ancestor_null_dataref');
        const noNullFoundIssues = dataRefErrors.filter(e => e.rootCause === 'no_null_ancestor_found');
        const parsingIssues = dataRefErrors.filter(e => e.rootCause === 'parsing_error');
        
        let html = '';
        
        // Ancestor null dataRef issues (most common)
        if (ancestorNullIssues.length > 0) {
          // Group by the ancestor that has dataRef: null
          const byAncestor = {};
          ancestorNullIssues.forEach(error => {
            const ancestorId = error.nullAncestor?.id || 'unknown';
            if (!byAncestor[ancestorId]) {
              byAncestor[ancestorId] = {
                ancestor: error.nullAncestor,
                fields: []
              };
            }
            byAncestor[ancestorId].fields.push(error);
          });
          
          html += '<div class="issue-item">';
          html += '<h4>Root Cause: Ancestor Panel/Container has <code>dataRef: null</code></h4>';
          html += `<p><strong>${ancestorNullIssues.length} field(s)</strong> are descendants of panel(s)/container(s) with <code>dataRef: null</code>. When an ancestor has null binding, all descendants lose their data context and cannot use dataRef.</p>`;
          
          Object.values(byAncestor).forEach(group => {
            html += '<div style="margin-left: 20px; margin-bottom: 15px; border-left: 3px solid #d29922; padding-left: 15px; background: rgba(210, 153, 34, 0.1); padding: 15px; border-radius: 4px;">';
            html += `<p><strong>⚠ Problem Ancestor:</strong> <code>${group.ancestor?.name || group.ancestor?.id}</code> (ID: <code>${group.ancestor?.id}</code>)</p>`;
            html += `<p><strong>Depth:</strong> ${group.ancestor?.depth} level(s) up from affected fields</p>`;
            html += `<p><strong>Current dataRef:</strong> <code>null</code> ← This breaks data binding for all descendants</p>`;
            html += `<p><strong>Affected descendant fields (${group.fields.length}):</strong></p>`;
            html += '<ul>';
            group.fields.forEach(error => {
              // Show the path from ancestor to field
              const pathFromAncestor = error.nullAncestor?.path ? `${error.nullAncestor.path} > ${error.fieldName}` : error.fieldName;
              html += `<li><code>${error.fieldName}</code> (dataRef: <code>${error.dataRef}</code>)`;
              if (error.nullAncestor?.depth > 1) {
                html += `<br><em style="font-size: 0.9em; color: #8b949e;">Path: ${pathFromAncestor}</em>`;
              }
              html += '</li>';
            });
            if (group.fields.length > 10) {
              html += `<li><em>... and ${group.fields.length - 10} more descendant fields</em></li>`;
            }
            html += '</ul>';
            html += '<hr style="border: 0; border-top: 1px solid #30363d; margin: 10px 0;">';
            html += `<p><strong>✓ ACTIONABLE FIX:</strong></p>`;
            html += '<ol style="margin-left: 20px;">';
            html += `<li>Open form in <strong>AEM Forms Editor</strong></li>`;
            html += `<li>Select ancestor "<strong>${group.ancestor?.name || group.ancestor?.id}</strong>" in the component tree</li>`;
            html += `<li>In Properties panel → Find "Data Reference (dataRef)" field</li>`;
            html += `<li><strong>Change from <code>null</code> to:</strong>`;
            html += '<ul style="margin-top: 5px;">';
            html += `<li><strong>Option A (Recommended):</strong> Remove the dataRef property entirely → Use name binding (default behavior)</li>`;
            html += `<li><strong>Option B:</strong> Set to valid path like <code>${group.ancestor?.name || 'container'}</code></li>`;
            html += '</ul></li>';
            html += `<li>Save form → All ${group.fields.length} descendant field(s) will now bind correctly</li>`;
            html += '</ol>';
            html += '</div>';
          });
          html += '</div>';
        }
        
        // No null ancestor found (unexpected - should investigate)
        if (noNullFoundIssues.length > 0) {
          html += '<div class="issue-item">';
          html += '<h4>Root Cause: Unknown (No Null Ancestor Found)</h4>';
          html += `<p><strong>${noNullFoundIssues.length} field(s)</strong> failed dataRef parsing, but the bot could not find an ancestor with <code>dataRef: null</code>.</p>`;
          html += '<p><em>This is unexpected since dataRef parsing errors typically come from null ancestor bindings. The ancestor chain is shown below for investigation.</em></p>';
          html += '<ul>';
          noNullFoundIssues.forEach(error => {
            html += `<li><code>${error.fieldName}</code> (dataRef: <code>${error.dataRef}</code>)`;
            if (error.ancestorChain && error.ancestorChain.length > 0) {
              html += '<br><details style="margin-top: 5px;"><summary style="cursor: pointer; color: #58a6ff;">View ancestor chain</summary>';
              html += '<ul style="margin-top: 5px; font-size: 0.9em;">';
              error.ancestorChain.forEach((ancestor, idx) => {
                const dataRefDisplay = ancestor.dataRef === null ? '<code style="color: #f85149;">null</code>' : 
                                       ancestor.dataRef === undefined ? '<em>undefined</em>' : 
                                       `<code>${ancestor.dataRef}</code>`;
                html += `<li>Level ${idx + 1}: ${ancestor.name} - dataRef: ${dataRefDisplay}</li>`;
              });
              html += '</ul></details>';
            }
            html += '</li>';
          });
          if (noNullFoundIssues.length > 5) {
            html += `<li><em>... and ${noNullFoundIssues.length - 5} more (see action logs for details)</em></li>`;
          }
          html += '</ul>';
          html += '<p><strong>Suggested Actions:</strong></p>';
          html += '<ol>';
          html += '<li>Check action logs for detailed ancestor chain analysis</li>';
          html += '<li>Manually inspect form JSON for these field IDs to see their ancestor hierarchy</li>';
          html += '<li>Look for ancestors with <code>dataRef: null</code> that might not be captured</li>';
          html += '<li>If issue persists, this may indicate a bug in the bot\'s analysis - please report with form JSON</li>';
          html += '</ol>';
          html += '</div>';
        }
        
        // Parsing errors (syntax issues - rare, usually caught by Forms Editor)
        if (parsingIssues.length > 0) {
          html += '<div class="issue-item">';
          html += '<h4>Root Cause: dataRef Syntax Error (Rare)</h4>';
          html += `<p><strong>${parsingIssues.length} field(s)</strong> have malformed dataRef syntax that af-core cannot parse. This is unusual as Forms Editor usually validates syntax.</p>`;
          html += '<ul>';
          parsingIssues.forEach(error => {
            html += `<li><code>${error.fieldName}</code> - dataRef: <code>${error.dataRef}</code></li>`;
          });
          html += '</ul>';
          html += '<p><strong>✓ Fix:</strong> Open form in <strong>AEM Forms Editor</strong> → Visual Rule Editor validates dataRef syntax automatically. Re-open each field\'s properties to trigger validation and see the exact syntax error.</p>';
          html += '</div>';
        }
        
        return html;
      })()}
      ` : ''}
      
      ${typeConflicts.length > 0 ? `
      <h3>Data Type Conflicts (${typeConflicts.length})</h3>
      <p><strong>Issue:</strong> Multiple fields are mapped to the same <code>dataRef</code> but have different data types. This causes type coercion and potential data loss.</p>
      <div class="issue-list">
        ${typeConflicts.map(conflict => `
          <div class="issue-item">
            <h4>DataRef: <code>${conflict.dataRef}</code></h4>
            <p><strong>New field:</strong> <code>${conflict.newField}</code> (type: <code>${conflict.newFieldType}</code>)</p>
            <p><strong>Conflicts with:</strong> ${conflict.conflictingFields}</p>
            <p><strong>Fix options:</strong></p>
            <ul>
              <li><strong>Option A:</strong> Use unique <code>dataRef</code> for each field (e.g., <code>${conflict.dataRef}_text</code> vs <code>${conflict.dataRef}_number</code>)</li>
              <li><strong>Option B:</strong> Ensure all fields use the SAME type</li>
              <li><strong>Option C:</strong> Remove <code>dataRef</code> from one field if it's just for display</li>
            </ul>
          </div>
        `).join('')}
      </div>
      ` : ''}
      
      <p class="recommendation"><strong>Action Required:</strong> Fix these in <strong>AEM Forms Editor</strong> - these are form JSON structure issues, not code issues.</p>
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

  /**
   * Generate scheduled scan HTML report
   */
  generateScheduledReport(results, options = {}) {
    const { repository, analysisUrl, timestamp } = options;
    const date = this.formatTimestampIST(timestamp || Date.now());
    
    const totalCSSIssues = results.css?.issues?.length || 0;
    const totalFunctionIssues = results.customFunctions?.issues?.length || 0;
    const totalFormIssues = results.forms?.issues?.length || 0;
    const totalRuleIssues = results.rules?.issues?.length || 0;
    const totalHTMLIssues = results.html?.issues?.length || 0;
    const totalIssues = totalCSSIssues + totalFunctionIssues + totalFormIssues + totalRuleIssues + totalHTMLIssues;
    
    const criticalCSS = results.css?.issues?.filter(i => i.severity === 'error').length || 0;
    const criticalFunctions = results.customFunctions?.issues?.filter(i => i.severity === 'error').length || 0;
    const criticalForms = results.forms?.issues?.filter(i => i.severity === 'error').length || 0;
    const criticalRules = totalRuleIssues; // All rule cycles are critical
    const criticalHTML = results.html?.issues?.filter(i => i.severity === 'error').length || 0;
    const totalCritical = criticalCSS + criticalFunctions + criticalForms + criticalRules + criticalHTML;
    
    const hasFormAnalysis = !!results.formJson;
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AEM Forms Performance - Daily Scan - ${date}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #333; border-bottom: 3px solid #0078d4; padding-bottom: 10px; }
    h2 { color: #0078d4; margin-top: 30px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
    .summary-card { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; text-align: center; }
    .summary-card.critical { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
    .summary-card h3 { margin: 0; font-size: 36px; }
    .summary-card p { margin: 5px 0 0 0; opacity: 0.9; }
    .issue-list { margin: 20px 0; }
    .issue-item { background: #f8f9fa; border-left: 4px solid #dc3545; padding: 15px; margin: 10px 0; border-radius: 4px; }
    .issue-item.warning { border-left-color: #ffc107; }
    .issue-item.error { border-left-color: #dc3545; }
    .meta { color: #666; font-size: 0.9em; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; }
  </style>
</head>
<body>
  <div class="container">
    <h1>AEM Forms Performance - Daily Codebase Scan</h1>
    <div class="meta">
      <strong>Repository:</strong> ${repository || 'Unknown'}<br>
      <strong>Scan Date:</strong> ${date}<br>
      ${analysisUrl ? `<strong>Analysis URL:</strong> <a href="${analysisUrl}" target="_blank">${analysisUrl}</a><br>` : '<strong>Analysis URL:</strong> Not provided (static analysis only)<br>'}
      <strong>Form Analysis:</strong> ${hasFormAnalysis ? 'Enabled' : 'Disabled (no URL provided)'}
    </div>
    
    ${!hasFormAnalysis ? `
    <div class="issue-item" style="border-left-color: #ffc107; background: #fff3cd;">
      <strong>⚠️  Limited Analysis Mode</strong><br>
      Form-specific analysis skipped because no URL was provided. Form JSON only exists at runtime, not in the repository.<br>
      <br>
      <strong>What was analyzed:</strong>
      <ul style="margin: 10px 0;">
        <li>CSS files (${results.css?.filesAnalyzed || 0} files)</li>
        <li>JavaScript files (static analysis only)</li>
      </ul>
      <strong>To enable full analysis:</strong>
      <ul style="margin: 10px 0;">
        <li>Provide <code>analysis-url</code> via workflow_dispatch</li>
        <li>Or configure <code>scheduledScan.defaultUrl</code> in .performance-bot.json</li>
      </ul>
    </div>
    ` : ''}
    
    <div class="summary">
      <div class="summary-card">
        <h3>${totalIssues}</h3>
        <p>Total Issues</p>
      </div>
      <div class="summary-card critical">
        <h3>${totalCritical}</h3>
        <p>Critical Issues</p>
      </div>
      <div class="summary-card">
        <h3>${results.css?.filesAnalyzed || 0}</h3>
        <p>CSS Files</p>
      </div>
      <div class="summary-card">
        <h3>${totalHTMLIssues}</h3>
        <p>HTML Issues</p>
      </div>
    </div>
    
    ${totalCSSIssues > 0 ? `
    <h2>CSS Issues (${totalCSSIssues})</h2>
    <div class="issue-list" style="max-height: 500px; overflow-y: auto;">
      ${results.css.issues.map(issue => `
        <div class="issue-item ${issue.severity || 'warning'}">
          <strong>${issue.type || 'CSS Issue'}</strong> in <code>${issue.file || 'unknown'}</code><br>
          ${issue.message || 'No description'}
        </div>
      `).join('')}
    </div>
    ` : ''}
    
    ${totalFunctionIssues > 0 ? `
    <h2>Custom Function Issues (${totalFunctionIssues})</h2>
    <div class="issue-list" style="max-height: 500px; overflow-y: auto;">
      ${results.customFunctions.issues.map(issue => `
        <div class="issue-item ${issue.severity || 'warning'}">
          <strong>${issue.type || 'Function Issue'}</strong> - <code>${issue.functionName || 'unknown'}</code><br>
          ${issue.message || 'No description'}
        </div>
      `).join('')}
    </div>
    ` : ''}
    
    ${totalRuleIssues > 0 ? `
    <h2>Rule Cycle Issues (${totalRuleIssues})</h2>
    <div class="issue-list">
      ${results.rules.issues.map(issue => `
        <div class="issue-item error">
          <strong>Circular Dependency Detected</strong> in <code>${issue.form || 'unknown'}</code><br>
          ${issue.cycles} cycle(s) found
          ${issue.details ? `<br><em>${issue.details.map(d => d.fields?.join(' → ')).join(' | ')}</em>` : ''}
        </div>
      `).join('')}
    </div>
    ` : ''}
    
    ${totalFormIssues > 0 ? `
    <h2>Form Issues (${totalFormIssues})</h2>
    <div class="issue-list" style="max-height: 500px; overflow-y: auto;">
      ${results.forms.issues.map(issue => `
        <div class="issue-item ${issue.severity || 'warning'}">
          <strong>${issue.type || 'Form Issue'}</strong><br>
          ${issue.message || 'No description'}
        </div>
      `).join('')}
    </div>
    ` : ''}
    
    ${totalHTMLIssues > 0 ? `
    <h2>HTML Issues (${totalHTMLIssues})</h2>
    <div class="issue-list" style="max-height: 500px; overflow-y: auto;">
      ${results.html.issues.map(issue => `
        <div class="issue-item ${issue.severity || 'warning'}">
          <strong>${issue.type || 'HTML Issue'}</strong><br>
          ${issue.message || 'No description'}
          ${issue.count ? `<br><em>Count: ${issue.count}</em>` : ''}
        </div>
      `).join('')}
    </div>
    ` : ''}
    
    ${analysisUrl && results.performance ? `
    <h2>Performance Metrics</h2>
    <div class="issue-list">
      <div class="issue-item">
        <strong>Load Time:</strong> ${results.performance.loadTime}ms<br>
        <strong>JS Heap Size:</strong> ${Math.round(results.performance.jsHeapSize / 1024 / 1024)}MB<br>
        <strong>DOM Size:</strong> ${results.html?.domSize || 0} nodes
      </div>
    </div>
    ` : ''}
    
    ${totalIssues === 0 ? `
    <div class="issue-list">
      <div class="issue-item" style="border-left-color: #28a745;">
        <strong>No issues found!</strong> Your codebase is looking great.
      </div>
    </div>
    ` : ''}
    
    <div class="meta">
      <p>Generated by <strong>AEM Forms Performance Bot</strong></p>
      <p><em>This report is sent daily. To modify the schedule or recipients, update your GitHub Actions workflow.</em></p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Generate summary HTML report for scheduled scans with multiple forms
   */
  generateScheduledSummaryReport(formResults, options = {}) {
    const { repository, timestamp, formGistLinks = [] } = options;
    
    // Count total issues across all forms
    let totalCritical = 0;
    let totalWarnings = 0;
    let totalForms = formResults.length;
    let formsWithErrors = 0;
    
    formResults.forEach(result => {
      if (result.error) {
        formsWithErrors++;
        return;
      }
      
      // Count critical issues
      totalCritical += (result.css?.issues || []).filter(i => i.severity === 'error').length;
      totalCritical += (result.customFunctions?.issues || []).filter(i => i.severity === 'critical').length;
      totalCritical += (result.html?.issues || []).filter(i => i.severity === 'error').length;
      totalCritical += (result.rules?.issues || []).filter(i => i.cycles > 0).length;
      
      // Count warnings
      totalWarnings += (result.css?.issues || []).filter(i => i.severity === 'warning').length;
      totalWarnings += (result.customFunctions?.issues || []).filter(i => i.severity === 'warning').length;
      totalWarnings += (result.forms?.issues || []).length;
      totalWarnings += (result.html?.issues || []).filter(i => i.severity === 'warning').length;
    });
    
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AEM Forms Performance Summary - ${repository}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f6f8fa;
      color: #24292e;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    .header h1 {
      margin: 0 0 10px 0;
      font-size: 28px;
    }
    .summary-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      text-align: center;
    }
    .stat-number {
      font-size: 36px;
      font-weight: bold;
      margin: 10px 0;
    }
    .stat-number.critical { color: #d73a49; }
    .stat-number.warning { color: #f9c513; }
    .stat-number.success { color: #28a745; }
    .stat-label {
      color: #586069;
      font-size: 14px;
    }
    .form-grid {
      display: grid;
      gap: 20px;
      margin-bottom: 30px;
    }
    .form-card {
      background: white;
      padding: 25px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      border-left: 4px solid #667eea;
    }
    .form-card.error {
      border-left-color: #d73a49;
      background: #ffeef0;
    }
    .form-name {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 10px;
      color: #24292e;
    }
    .form-url {
      font-size: 12px;
      color: #586069;
      word-break: break-all;
      margin-bottom: 15px;
    }
    .form-stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      margin: 15px 0;
    }
    .form-stat {
      text-align: center;
    }
    .form-stat-value {
      font-size: 24px;
      font-weight: bold;
    }
    .form-stat-value.critical { color: #d73a49; }
    .form-stat-value.warning { color: #f9c513; }
    .form-stat-label {
      font-size: 12px;
      color: #586069;
      margin-top: 5px;
    }
    .gist-link {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 10px 20px;
      border-radius: 6px;
      text-decoration: none;
      margin-top: 15px;
      font-weight: 500;
    }
    .gist-link:hover {
      background: #5568d3;
    }
    .error-message {
      color: #d73a49;
      background: #ffeef0;
      padding: 10px;
      border-radius: 4px;
      margin-top: 10px;
    }
    .meta {
      text-align: center;
      color: #586069;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e1e4e8;
    }
  </style>
</head>
<body>
  <div class="header" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
    <h1 style="margin: 0 0 10px 0; font-size: 28px; color: white !important;">📊 Performance Summary - ${repository}</h1>
    <p style="color: white !important; font-size: 16px; margin: 5px 0 0 0;">${this.formatTimestampIST(timestamp)}</p>
  </div>
  
  <div class="summary-stats">
    <div class="stat-card">
      <div class="stat-label">Forms Analyzed</div>
      <div class="stat-number">${totalForms}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Critical Issues</div>
      <div class="stat-number critical">${totalCritical}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Warnings</div>
      <div class="stat-number warning">${totalWarnings}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Forms with Errors</div>
      <div class="stat-number ${formsWithErrors > 0 ? 'critical' : 'success'}">${formsWithErrors}</div>
    </div>
  </div>
  
  <h2 style="color: #24292e !important; margin-top: 30px; margin-bottom: 20px; font-size: 24px; font-weight: 600;">Individual Form Reports</h2>
  <div class="form-grid">
    ${formResults.map((result, index) => {
      if (result.error) {
        return `
          <div class="form-card error">
            <div class="form-name" style="font-size: 18px; font-weight: 600; margin-bottom: 10px; color: #24292e !important;">${result.formName}</div>
            <div class="form-url" style="font-size: 12px; color: #24292e !important; word-break: break-all; margin-bottom: 15px; opacity: 0.8;">${result.url}</div>
            <div class="error-message" style="color: #d73a49 !important; font-weight: 600; margin-top: 10px;">❌ Analysis Failed: ${result.error}</div>
          </div>
        `;
      }
      
      const formCritical = (
        (result.css?.issues || []).filter(i => i.severity === 'error').length +
        (result.customFunctions?.issues || []).filter(i => i.severity === 'critical').length +
        (result.html?.issues || []).filter(i => i.severity === 'error').length +
        (result.rules?.issues || []).filter(i => i.cycles > 0).length
      );
      
      const formWarnings = (
        (result.css?.issues || []).filter(i => i.severity === 'warning').length +
        (result.customFunctions?.issues || []).filter(i => i.severity === 'warning').length +
        (result.forms?.issues || []).length +
        (result.html?.issues || []).filter(i => i.severity === 'warning').length
      );
      
      const formCSSIssues = (result.css?.issues || []).length;
      const formHTMLIssues = (result.html?.issues || []).length;
      
      return `
        <div class="form-card">
          <div class="form-name" style="font-size: 18px; font-weight: 600; margin-bottom: 10px; color: #24292e !important;">${result.formName}</div>
          <div class="form-url" style="font-size: 12px; color: #24292e !important; word-break: break-all; margin-bottom: 15px; opacity: 0.8;">${result.url}</div>
          
          <div class="form-stats" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 15px; margin-top: 15px;">
            <div class="form-stat" style="text-align: center;">
              <div class="form-stat-value critical" style="font-size: 24px; font-weight: bold; color: #d73a49 !important;">${formCritical}</div>
              <div class="form-stat-label" style="color: #24292e !important; font-size: 12px; font-weight: 500;">Critical</div>
            </div>
            <div class="form-stat" style="text-align: center;">
              <div class="form-stat-value warning" style="font-size: 24px; font-weight: bold; color: #f9c513 !important;">${formWarnings}</div>
              <div class="form-stat-label" style="color: #24292e !important; font-size: 12px; font-weight: 500;">Warnings</div>
            </div>
            <div class="form-stat" style="text-align: center;">
              <div class="form-stat-value" style="font-size: 24px; font-weight: bold; color: #24292e !important;">${formCSSIssues}</div>
              <div class="form-stat-label" style="color: #24292e !important; font-size: 12px; font-weight: 500;">CSS Issues</div>
            </div>
            <div class="form-stat" style="text-align: center;">
              <div class="form-stat-value" style="font-size: 24px; font-weight: bold; color: #24292e !important;">${formHTMLIssues}</div>
              <div class="form-stat-label" style="color: #24292e !important; font-size: 12px; font-weight: 500;">HTML Issues</div>
            </div>
          </div>
          
          ${result.gistUrl ? `
            <a href="${result.gistUrl}" class="gist-link" style="display: inline-block; margin-top: 15px; padding: 10px 20px; background: #0969da; color: white !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px;" target="_blank">
              View Detailed Report →
            </a>
          ` : '<div style="color: #d73a49 !important; margin-top: 15px; font-weight: 600;">⚠️ Detailed report not available</div>'}
        </div>
      `;
    }).join('')}
  </div>
  
  <div class="meta">
    <p>Generated by <strong>AEM Forms Performance Bot</strong></p>
    <p><em>This report is sent daily. To modify the schedule or recipients, update your GitHub Actions workflow.</em></p>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Convert HTML to email-safe format with inline styles
   * Email clients strip <style> tags, so we need to inline critical styles
   */
  convertToEmailSafeHTML(html) {
    // Step 1: Add inline styles to body tag
    html = html.replace(
      /<body>/g,
      '<body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f6f8fa; color: #24292e;">'
    );
    
    // Step 2: Add inline styles to header
    html = html.replace(
      /<div class="header">/g,
      '<div class="header" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px; margin-bottom: 30px;">'
    );
    
    // Step 3: Add inline styles to stat cards
    html = html.replace(
      /<div class="stat-card">/g,
      '<div class="stat-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center;">'
    );
    
    // Step 4: Add inline styles to stat numbers
    html = html.replace(
      /<div class="stat-number critical">/g,
      '<div class="stat-number critical" style="font-size: 36px; font-weight: bold; margin: 10px 0; color: #d73a49;">'
    );
    html = html.replace(
      /<div class="stat-number warning">/g,
      '<div class="stat-number warning" style="font-size: 36px; font-weight: bold; margin: 10px 0; color: #f9c513;">'
    );
    html = html.replace(
      /<div class="stat-number success">/g,
      '<div class="stat-number success" style="font-size: 36px; font-weight: bold; margin: 10px 0; color: #28a745;">'
    );
    html = html.replace(
      /<div class="stat-number">/g,
      '<div class="stat-number" style="font-size: 36px; font-weight: bold; margin: 10px 0; color: #24292e;">'
    );
    
    // Step 5: Add inline styles to stat labels (MUCH DARKER for email visibility)
    html = html.replace(
      /<div class="stat-label">/g,
      '<div class="stat-label" style="color: #24292e !important; font-size: 14px; font-weight: 500;">'
    );
    
    // Step 6: Add inline styles to form cards
    html = html.replace(
      /<div class="form-card">/g,
      '<div class="form-card" style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">'
    );
    
    // Step 7: Add inline styles to form stats
    html = html.replace(
      /<div class="form-stat-value critical">/g,
      '<div class="form-stat-value critical" style="font-size: 24px; font-weight: bold; color: #d73a49;">'
    );
    html = html.replace(
      /<div class="form-stat-value warning">/g,
      '<div class="form-stat-value warning" style="font-size: 24px; font-weight: bold; color: #f9c513;">'
    );
    html = html.replace(
      /<div class="form-stat-value">/g,
      '<div class="form-stat-value" style="font-size: 24px; font-weight: bold; color: #24292e;">'
    );
    
    // Step 8: Add inline styles to form stat labels (MUCH DARKER for email visibility)
    html = html.replace(
      /<div class="form-stat-label">/g,
      '<div class="form-stat-label" style="color: #24292e !important; font-size: 12px; font-weight: 500;">'
    );
    
    // Step 9: Add inline styles to form names and URLs
    html = html.replace(
      /<div class="form-name">/g,
      '<div class="form-name" style="font-size: 18px; font-weight: 600; margin-bottom: 10px; color: #24292e !important;">'
    );
    html = html.replace(
      /<div class="form-url">/g,
      '<div class="form-url" style="font-size: 12px; color: #24292e !important; word-break: break-all; margin-bottom: 15px; opacity: 0.8;">'
    );
    
    // Step 10: Add inline styles to h1, h2, h3
    html = html.replace(
      /<h1>/g,
      '<h1 style="margin: 0 0 10px 0; font-size: 28px; color: white !important;">'
    );
    html = html.replace(
      /<h2>/g,
      '<h2 style="color: #24292e !important; margin-top: 20px; margin-bottom: 10px; font-size: 24px; font-weight: 600;">'
    );
    html = html.replace(
      /<h3>/g,
      '<h3 style="color: #24292e !important; margin: 15px 0 10px 0; font-size: 18px; font-weight: 600;">'
    );
    
    // Step 11: Add inline styles to paragraphs and divs with text
    html = html.replace(
      /<p>/g,
      '<p style="color: #24292e !important; line-height: 1.6; margin: 10px 0;">'
    );
    
    // Step 12: Add inline styles to error messages and other divs
    html = html.replace(
      /<div class="error-message">/g,
      '<div class="error-message" style="color: #d73a49 !important; font-weight: 600; margin-top: 10px;">'
    );
    
    return html;
  }
}

