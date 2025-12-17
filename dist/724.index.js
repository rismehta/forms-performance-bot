export const id = 724;
export const ids = [724];
export const modules = {

/***/ 75724:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   sendEmailReport: () => (/* binding */ sendEmailReport)
/* harmony export */ });
/* unused harmony export countIssues */
/* harmony import */ var _actions_core__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(37484);
/**
 * SendGrid email integration for scheduled reports
 */


/**
 * Send email report via SendGrid
 * @param {Object|Array} results - Analysis results (single form object or array of forms)
 * @param {string} htmlReport - HTML report content
 * @param {Object} options - Email options (repository, from, formGistLinks)
 * @returns {Promise<boolean>} Success status
 */
async function sendEmailReport(results, htmlReport, options = {}) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const toEmail = process.env.REPORT_EMAIL || 'abc@gmail.com';
  const fromEmail = options.from || 'aemforms-performance-bot@adobe.com';
  
  if (!apiKey) {
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.warning('⚠️  SENDGRID_API_KEY not set - skipping email');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  To enable email reports:');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  1. Sign up at https://sendgrid.com (free tier: 100 emails/day)');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  2. Create API key');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  3. Add SENDGRID_API_KEY to repository secrets');
    return false;
  }
  
  const date = new Date().toDateString();
  const isMultipleForms = Array.isArray(results);
  const summary = isMultipleForms 
    ? countIssuesFromMultipleForms(results) 
    : countIssuesFromScheduledResults(results);
  const issueCount = summary.totalIssues;
  const criticalCount = summary.criticalIssues;
  const repository = options.repository || 'Unknown Repository';
  const formCount = isMultipleForms ? results.length : 1;
  
  const emailData = {
    personalizations: [{
      to: [{ email: toEmail }],
      subject: `📊 Daily Performance Report - ${repository} - ${date} (${formCount} form${formCount > 1 ? 's' : ''}, ${issueCount} issues${criticalCount > 0 ? `, ${criticalCount} critical` : ''})`
    }],
    from: { 
      email: fromEmail,
      name: 'AEM Forms Performance Bot'
    },
    content: [{
      type: 'text/html',
      value: htmlReport
    }]
  };
  
  try {
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info(`📧 Sending email to ${toEmail}...`);
    
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailData)
    });
    
    if (response.ok) {
      _actions_core__WEBPACK_IMPORTED_MODULE_0__.info(`✅ Email sent successfully to ${toEmail}`);
      return true;
    } else {
      const errorText = await response.text();
      _actions_core__WEBPACK_IMPORTED_MODULE_0__.error(`❌ Failed to send email: ${response.status} ${response.statusText}`);
      _actions_core__WEBPACK_IMPORTED_MODULE_0__.error(`   Details: ${errorText}`);
      return false;
    }
  } catch (error) {
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.error(`❌ SendGrid API error: ${error.message}`);
    return false;
  }
}

/**
 * Count issues in results
 * @param {Object} results - Analysis results
 * @returns {Object} Issue counts
 */
function countIssues(results) {
  let totalIssues = 0;
  let criticalIssues = 0;
  
  // Count CSS issues
  if (results.formCSS?.newIssues) {
    totalIssues += results.formCSS.newIssues.length;
    criticalIssues += results.formCSS.newIssues.filter(i => i.severity === 'error').length;
  }
  
  // Count custom function issues
  if (results.customFunctions?.newIssues) {
    totalIssues += results.customFunctions.newIssues.length;
    criticalIssues += results.customFunctions.newIssues.filter(i => i.severity === 'error').length;
  }
  
  // Count rule cycles
  if (results.ruleCycles?.after?.issues) {
    totalIssues += results.ruleCycles.after.issues.length;
    criticalIssues += results.ruleCycles.after.issues.filter(i => i.severity === 'error').length;
  }
  
  // Count hidden fields
  if (results.hiddenFields?.newIssues) {
    totalIssues += results.hiddenFields.newIssues.length;
  }
  
  // Count form events
  if (results.formEvents?.newIssues) {
    totalIssues += results.formEvents.newIssues.length;
  }
  
  // Count HTML issues
  if (results.formHTML?.newIssues) {
    totalIssues += results.formHTML.newIssues.length;
    criticalIssues += results.formHTML.newIssues.filter(i => i.severity === 'error').length;
  }
  
  return {
    totalIssues,
    criticalIssues
  };
}

/**
 * Count issues from scheduled scan results (single form)
 * @param {Object} results - Scheduled scan results
 * @returns {Object} Issue counts
 */
function countIssuesFromScheduledResults(results) {
  let totalIssues = 0;
  let criticalIssues = 0;
  
  // CSS issues
  if (results.css?.issues) {
    totalIssues += results.css.issues.length;
    criticalIssues += results.css.issues.filter(i => i.severity === 'error').length;
  }
  
  // Custom function issues
  if (results.customFunctions?.issues) {
    totalIssues += results.customFunctions.issues.length;
    criticalIssues += results.customFunctions.issues.filter(i => i.severity === 'error').length;
  }
  
  // Form issues
  if (results.forms?.issues) {
    totalIssues += results.forms.issues.length;
    criticalIssues += results.forms.issues.filter(i => i.severity === 'error').length;
  }
  
  // Rule issues
  if (results.rules?.issues) {
    totalIssues += results.rules.issues.length;
    criticalIssues += results.rules.issues.length; // All rule cycles are critical
  }
  
  // HTML issues
  if (results.html?.issues) {
    totalIssues += results.html.issues.length;
    criticalIssues += results.html.issues.filter(i => i.severity === 'error').length;
  }
  
  return {
    totalIssues,
    criticalIssues
  };
}

/**
 * Count issues from multiple forms
 * @param {Array} formResults - Array of form results
 * @returns {Object} Issue counts
 */
function countIssuesFromMultipleForms(formResults) {
  let totalIssues = 0;
  let criticalIssues = 0;
  
  formResults.forEach(result => {
    if (result.error) {
      return; // Skip forms with errors
    }
    
    const counts = countIssuesFromScheduledResults(result);
    totalIssues += counts.totalIssues;
    criticalIssues += counts.criticalIssues;
  });
  
  return {
    totalIssues,
    criticalIssues
  };
}



/***/ })

};
