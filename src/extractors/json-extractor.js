import * as cheerio from 'cheerio';

/**
 * Extracts JSON data from page HTML
 * Form JSON is always in: div.form > pre
 */
export class JSONExtractor {
  /**
   * Extract form JSON from HTML content
   * @param {string} html - HTML content
   * @returns {Object} Extracted JSON data
   */
  extract(html) {
    const $ = cheerio.load(html);
    const results = {
      formJson: null,
      errors: []
    };

    try {
      // Form JSON is always in div.form pre (may have nested code tag)
      const formDiv = $('div.form');
      if (!formDiv.length) {
        results.errors.push({
          message: 'No div.form element found in HTML',
        });
        return results;
      }

      const formPre = formDiv.find('pre').first();
      if (!formPre.length) {
        results.errors.push({
          message: 'No pre element found inside div.form',
        });
        return results;
      }

      // Get text content (handles both <pre>json</pre> and <pre><code>json</code></pre>)
      let jsonText = formPre.text().trim();
      
      if (!jsonText) {
        results.errors.push({
          message: 'Empty content in div.form pre',
        });
        return results;
      }

      results.formJson = this.parseJSON(jsonText);
      
      if (!results.formJson) {
        results.errors.push({
          message: 'Failed to parse JSON from div.form pre',
        });
      }

    } catch (error) {
      results.errors.push({
        message: error.message,
        stack: error.stack
      });
    }

    return results;
  }

  /**
   * Parse JSON string safely, handling double-encoded JSON
   * @param {string} jsonText - JSON string (may be double-encoded)
   * @returns {Object|null} Parsed JSON or null
   */
  parseJSON(jsonText) {
    try {
      let parsed = JSON.parse(jsonText);
      
      // Handle double-encoded JSON (common in AEM forms)
      // If first parse returns a string, parse again
      if (typeof parsed === 'string') {
        console.log('Detected double-encoded JSON, parsing again...');
        parsed = JSON.parse(parsed);
      }
      
      // Validate that we got an object (the form JSON)
      if (typeof parsed !== 'object' || parsed === null) {
        console.warn('Parsed JSON is not an object:', typeof parsed);
        return null;
      }
      
      return parsed;
    } catch (error) {
      console.warn('Failed to parse JSON from div.form pre:', error.message);
      return null;
    }
  }
}

