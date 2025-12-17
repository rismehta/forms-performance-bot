/**
 * GitHub helper utilities
 */

/**
 * Extract before/after URLs from PR description
 * @param {string} prBody - PR description text
 * @returns {Object} Object with before and after URLs
 */
export function extractURLsFromPR(prBody) {
  const urls = {
    before: null,
    after: null,
  };

  if (!prBody) return urls;

  // Clean up the PR body (remove markdown formatting, normalize whitespace)
  const cleanBody = prBody
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\*\*/g, '') // Remove bold
    .replace(/\*/g, '') // Remove italic
    .replace(/`/g, ''); // Remove code formatting

  // Pattern 1: "Before: <url>" and "After: <url>" (flexible whitespace)
  // Match URLs that may have trailing slash, query params, etc.
  const beforeMatch = cleanBody.match(/Before:\s*(https?:\/\/[^\s\n<>]+)/i);
  const afterMatch = cleanBody.match(/After:\s*(https?:\/\/[^\s\n<>]+)/i);

  if (beforeMatch) {
    // Clean up trailing punctuation (., /, etc. at the very end)
    urls.before = beforeMatch[1].trim().replace(/[,;]+$/, '');
  }
  if (afterMatch) {
    urls.after = afterMatch[1].trim().replace(/[,;]+$/, '');
  }

  // Pattern 2: Also try to find URLs in a "Test URLs:" section
  if (!urls.before || !urls.after) {
    const testURLsSection = cleanBody.match(/Test URLs?:?\s*([\s\S]*?)(?:\n\n|$)/i);
    if (testURLsSection) {
      const section = testURLsSection[1];
      const beforeMatch2 = section.match(/Before:\s*(https?:\/\/[^\s\n<>]+)/i);
      const afterMatch2 = section.match(/After:\s*(https?:\/\/[^\s\n<>]+)/i);
      
      if (beforeMatch2 && !urls.before) {
        urls.before = beforeMatch2[1].trim().replace(/[,;]+$/, '');
      }
      if (afterMatch2 && !urls.after) {
        urls.after = afterMatch2[1].trim().replace(/[,;]+$/, '');
      }
    }
  }

  return urls;
}

/**
 * Format file size in human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Get file extension
 * @param {string} filename - File name
 * @returns {string} File extension
 */
export function getFileExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

/**
 * Check if file is a JavaScript file
 * @param {string} filename - File name
 * @returns {boolean} True if JavaScript file
 */
export function isJavaScriptFile(filename) {
  const ext = getFileExtension(filename);
  return ['js', 'mjs', 'cjs'].includes(ext);
}

/**
 * Check if file is a test file
 * @param {string} filename - File name
 * @returns {boolean} True if test file
 */
export function isTestFile(filename) {
  return filename.includes('.test.') || 
         filename.includes('.spec.') || 
         filename.includes('/test/') ||
         filename.includes('/tests/');
}

/**
 * Get list of files changed in a PR
 * @param {Object} octokit - GitHub API client
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - PR number
 * @returns {Promise<Array<string>>} List of changed file paths
 */
export async function getPRDiffFiles(octokit, owner, repo, prNumber) {
  try {
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100
    });
    
    return files.map(f => f.filename);
  } catch (error) {
    console.error(`Failed to get PR diff files: ${error.message}`);
    return [];
  }
}

/**
 * Filter analysis results to only include issues in PR diff files
 * @param {Object} results - Analysis results
 * @param {Array<string>} prFiles - List of files in PR diff
 * @returns {Object} Filtered results
 */
export function filterResultsToPRFiles(results, prFiles) {
  if (!prFiles || prFiles.length === 0) {
    return results; // No filtering if no PR files
  }
  
  const filtered = JSON.parse(JSON.stringify(results)); // Deep clone
  
  // Filter CSS issues to only files in PR diff
  // Show ALL issues (error + warning) - in PR mode, everything must be fixed
  if (filtered.formCSS?.newIssues) {
    filtered.formCSS.newIssues = filtered.formCSS.newIssues.filter(issue =>
      prFiles.includes(issue.file)
    );
  }
  
  if (filtered.formCSS?.after?.issues) {
    filtered.formCSS.after.issues = filtered.formCSS.after.issues.filter(issue =>
      prFiles.includes(issue.file)
    );
  }
  
  // Filter custom function issues to only files in PR diff
  // Show ALL issues (error + warning) - in PR mode, everything must be fixed
  if (filtered.customFunctions?.newIssues) {
    const beforeCount = filtered.customFunctions.newIssues.length;
    filtered.customFunctions.newIssues = filtered.customFunctions.newIssues.filter(issue => {
      const isInPR = prFiles.includes(issue.file);
      if (!isInPR) {
        console.log(`  ✗ Filtered out custom function issue in ${issue.file} (not in PR diff)`);
      }
      return isInPR;
    });
    const afterCount = filtered.customFunctions.newIssues.length;
    if (beforeCount > afterCount) {
      console.log(`  Filtered custom function newIssues: ${beforeCount} → ${afterCount} (removed ${beforeCount - afterCount})`);
    }
  }
  
  if (filtered.customFunctions?.after?.issues) {
    const beforeCount = filtered.customFunctions.after.issues.length;
    filtered.customFunctions.after.issues = filtered.customFunctions.after.issues.filter(issue => {
      const isInPR = prFiles.includes(issue.file);
      if (!isInPR) {
        console.log(`  ✗ Filtered out custom function issue in ${issue.file} (not in PR diff)`);
      }
      return isInPR;
    });
    const afterCount = filtered.customFunctions.after.issues.length;
    if (beforeCount > afterCount) {
      console.log(`  Filtered custom function after.issues: ${beforeCount} → ${afterCount} (removed ${beforeCount - afterCount})`);
    }
  }
  
  // NOTE: HTML issues are URL-based (not file-based), always shown in PR mode
  // All HTML issues (error + warning) must be fixed in PR mode
  
  // Filter hidden fields (check if form JSON is in PR)
  const hasFormJSON = prFiles.some(file => file.endsWith('.form.json'));
  if (!hasFormJSON) {
    if (filtered.hiddenFields?.newIssues) {
      filtered.hiddenFields.newIssues = [];
    }
    if (filtered.hiddenFields?.after?.issues) {
      filtered.hiddenFields.after.issues = [];
    }
  }
  
  // Filter form events (check if form JSON is in PR)
  if (!hasFormJSON) {
    if (filtered.formEvents?.newIssues) {
      filtered.formEvents.newIssues = [];
    }
    if (filtered.formEvents?.after?.issues) {
      filtered.formEvents.after.issues = [];
    }
  }
  
  // Filter rule cycles (check if form JSON is in PR)
  if (!hasFormJSON) {
    if (filtered.ruleCycles?.newIssues) {
      filtered.ruleCycles.newIssues = [];
    }
    if (filtered.ruleCycles?.after?.issues) {
      filtered.ruleCycles.after.issues = [];
    }
  }
  
  return filtered;
}

