/**
 * SendGrid email integration for scheduled reports
 */
import * as core from '@actions/core';

/**
 * Send email report via SendGrid
 * @param {string} htmlReport - HTML report content
 * @param {Object} summary - Report summary
 * @returns {Promise<boolean>} Success status
 */
export async function sendEmailReport(htmlReport, summary) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const toEmail = process.env.REPORT_EMAIL || 'abc@gmail.com';
  const fromEmail = process.env.FROM_EMAIL || 'performance-bot@aem-forms.com';
  
  if (!apiKey) {
    core.warning('⚠️  SENDGRID_API_KEY not set - skipping email');
    core.info('  To enable email reports:');
    core.info('  1. Sign up at https://sendgrid.com (free tier: 100 emails/day)');
    core.info('  2. Create API key');
    core.info('  3. Add SENDGRID_API_KEY to repository secrets');
    return false;
  }
  
  const date = new Date().toDateString();
  const issueCount = summary.totalIssues || 0;
  const criticalCount = summary.criticalIssues || 0;
  
  const emailData = {
    personalizations: [{
      to: [{ email: toEmail }],
      subject: `📊 AEM Forms Performance Report - ${date} (${issueCount} issues${criticalCount > 0 ? `, ${criticalCount} critical` : ''})`
    }],
    from: { email: fromEmail },
    content: [{
      type: 'text/html',
      value: htmlReport
    }]
  };
  
  try {
    core.info(`📧 Sending email to ${toEmail}...`);
    
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailData)
    });
    
    if (response.ok) {
      core.info(`✅ Email sent successfully to ${toEmail}`);
      return true;
    } else {
      const errorText = await response.text();
      core.error(`❌ Failed to send email: ${response.status} ${response.statusText}`);
      core.error(`   Details: ${errorText}`);
      return false;
    }
  } catch (error) {
    core.error(`❌ SendGrid API error: ${error.message}`);
    return false;
  }
}

/**
 * Count issues in results
 * @param {Object} results - Analysis results
 * @returns {Object} Issue counts
 */
export function countIssues(results) {
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

