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

  // Pattern 1: "Before: <url>" and "After: <url>"
  const beforeMatch = prBody.match(/Before:\s*(https?:\/\/[^\s\n]+)/i);
  const afterMatch = prBody.match(/After:\s*(https?:\/\/[^\s\n]+)/i);

  if (beforeMatch) urls.before = beforeMatch[1].trim();
  if (afterMatch) urls.after = afterMatch[1].trim();

  // Pattern 2: Also try to find URLs in a "Test URLs:" section
  if (!urls.before || !urls.after) {
    const testURLsSection = prBody.match(/Test URLs?:?\s*([\s\S]*?)(?:\n\n|$)/i);
    if (testURLsSection) {
      const section = testURLsSection[1];
      const beforeMatch2 = section.match(/Before:\s*(https?:\/\/[^\s\n]+)/i);
      const afterMatch2 = section.match(/After:\s*(https?:\/\/[^\s\n]+)/i);
      
      if (beforeMatch2 && !urls.before) urls.before = beforeMatch2[1].trim();
      if (afterMatch2 && !urls.after) urls.after = afterMatch2[1].trim();
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

