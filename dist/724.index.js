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
 * Email integration for scheduled reports
 * Supports: SendGrid API, Gmail SMTP, or generic SMTP
 */


/**
 * Send email report via configured email provider
 * @param {Object|Array} results - Analysis results (single form object or array of forms)
 * @param {string} htmlReport - HTML report content
 * @param {Object} options - Email options (repository, from, formGistLinks)
 * @returns {Promise<boolean>} Success status
 */
async function sendEmailReport(results, htmlReport, options = {}) {
  // Check which email provider is configured
  const sendgridKey = process.env.SENDGRID_API_KEY;
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;
  const smtpHost = process.env.SMTP_HOST;
  
  const toEmail = process.env.REPORT_EMAIL || 'abc@gmail.com';
  
  // Determine which provider to use
  if (sendgridKey) {
    return await sendViaSendGrid(results, htmlReport, options, sendgridKey, toEmail);
  } else if (gmailUser && gmailPassword) {
    return await sendViaGmail(results, htmlReport, options, gmailUser, gmailPassword, toEmail);
  } else if (smtpHost) {
    return await sendViaSMTP(results, htmlReport, options, toEmail);
  } else {
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.warning('⚠️  No email provider configured - skipping email');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  To enable email reports, configure ONE of:');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  ');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  Option 1: SendGrid (API)');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('    - Set SENDGRID_API_KEY');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  ');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  Option 2: Gmail (SMTP - No signup!)');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('    - Set GMAIL_USER (your Gmail address)');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('    - Set GMAIL_APP_PASSWORD (from https://myaccount.google.com/apppasswords)');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  ');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  Option 3: Generic SMTP');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('    - Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  ');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  All options also require: REPORT_EMAIL (recipient)');
    return false;
  }
}

/**
 * Send email via SendGrid API
 */
async function sendViaSendGrid(results, htmlReport, options, apiKey, toEmail) {
  const fromEmail = options.from || 'aemforms-performance-bot@adobe.com';
  
  const date = new Date().toDateString();
  const isMultipleForms = Array.isArray(results);
  const summary = isMultipleForms 
    ? countIssuesFromMultipleForms(results) 
    : countIssuesFromScheduledResults(results);
  const issueCount = summary.totalIssues;
  const criticalCount = summary.criticalIssues;
  const repository = options.repository || 'Unknown Repository';
  const formCount = isMultipleForms ? results.length : 1;
  
  const subject = `📊 Daily Performance Report - ${repository} - ${date} (${formCount} form${formCount > 1 ? 's' : ''}, ${issueCount} issues${criticalCount > 0 ? `, ${criticalCount} critical` : ''})`;
  
  const emailData = {
    personalizations: [{
      to: [{ email: toEmail }],
      subject
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
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info(`📧 Sending email via SendGrid to ${toEmail}...`);
    
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
 * Send email via Gmail SMTP
 * Uses Gmail's SMTP with app password authentication
 */
async function sendViaGmail(results, htmlReport, options, gmailUser, gmailPassword, toEmail) {
  const date = new Date().toDateString();
  const isMultipleForms = Array.isArray(results);
  const summary = isMultipleForms 
    ? countIssuesFromMultipleForms(results) 
    : countIssuesFromScheduledResults(results);
  const issueCount = summary.totalIssues;
  const criticalCount = summary.criticalIssues;
  const repository = options.repository || 'Unknown Repository';
  const formCount = isMultipleForms ? results.length : 1;
  
  const subject = `📊 Daily Performance Report - ${repository} - ${date} (${formCount} form${formCount > 1 ? 's' : ''}, ${issueCount} issues${criticalCount > 0 ? `, ${criticalCount} critical` : ''})`;
  
  try {
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info(`📧 Sending email via Gmail SMTP to ${toEmail}...`);
    
    // Use Gmail's REST API with OAuth-style authentication
    // This is simpler than implementing full SMTP protocol
    const nodemailer = await __webpack_require__.e(/* import() */ 2).then(__webpack_require__.t.bind(__webpack_require__, 26002, 19)).catch(() => null);
    
    if (!nodemailer) {
      _actions_core__WEBPACK_IMPORTED_MODULE_0__.warning('⚠️  Gmail SMTP requires nodemailer package');
      _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  Install: npm install nodemailer');
      return false;
    }
    
    const transporter = nodemailer.default.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // use TLS
      auth: {
        user: gmailUser,
        pass: gmailPassword
      },
      // Anti-spam: Set proper headers
      tls: {
        rejectUnauthorized: false
      }
    });
    
    await transporter.sendMail({
      from: `"AEM Forms Performance Bot" <${gmailUser}>`,
      to: toEmail,
      subject,
      html: htmlReport,
      // Anti-spam headers
      headers: {
        'X-Mailer': 'AEM Forms Performance Bot',
        'X-Priority': '3', // Normal priority (1=high, 5=low can trigger spam)
        'Importance': 'Normal',
        'List-Unsubscribe': `<mailto:${gmailUser}?subject=Unsubscribe>`, // Required for bulk emails
      },
      // Provide plain text fallback (helps with spam filters)
      text: htmlReport.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    });
    
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info(`✅ Email sent successfully via Gmail to ${toEmail}`);
    return true;
  } catch (error) {
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.error(`❌ Gmail SMTP error: ${error.message}`);
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  Troubleshooting:');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  1. Enable "Less secure app access" or use App Password');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  2. Go to: https://myaccount.google.com/apppasswords');
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('  3. Generate app-specific password');
    return false;
  }
}

/**
 * Send email via generic SMTP
 */
async function sendViaSMTP(results, htmlReport, options, toEmail) {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const fromEmail = process.env.SMTP_FROM || user;
  
  const date = new Date().toDateString();
  const isMultipleForms = Array.isArray(results);
  const summary = isMultipleForms 
    ? countIssuesFromMultipleForms(results) 
    : countIssuesFromScheduledResults(results);
  const issueCount = summary.totalIssues;
  const criticalCount = summary.criticalIssues;
  const repository = options.repository || 'Unknown Repository';
  const formCount = isMultipleForms ? results.length : 1;
  
  const subject = `📊 Daily Performance Report - ${repository} - ${date} (${formCount} form${formCount > 1 ? 's' : ''}, ${issueCount} issues${criticalCount > 0 ? `, ${criticalCount} critical` : ''})`;
  
  try {
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info(`📧 Sending email via SMTP (${host}:${port}) to ${toEmail}...`);
    
    const nodemailer = await __webpack_require__.e(/* import() */ 2).then(__webpack_require__.t.bind(__webpack_require__, 26002, 19)).catch(() => null);
    
    if (!nodemailer) {
      _actions_core__WEBPACK_IMPORTED_MODULE_0__.warning('⚠️  SMTP requires nodemailer package');
      return false;
    }
    
    const transporter = nodemailer.default.createTransport({
      host,
      port: parseInt(port),
      secure: port == 465, // true for 465, false for other ports
      auth: {
        user,
        pass: password
      }
    });
    
    await transporter.sendMail({
      from: `"AEM Forms Performance Bot" <${fromEmail}>`,
      to: toEmail,
      subject,
      html: htmlReport
    });
    
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info(`✅ Email sent successfully via SMTP to ${toEmail}`);
    return true;
  } catch (error) {
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.error(`❌ SMTP error: ${error.message}`);
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
