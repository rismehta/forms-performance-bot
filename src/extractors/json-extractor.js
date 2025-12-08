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
   * Parse JSON string safely
   * @param {string} jsonText - JSON string
   * @returns {Object|null} Parsed JSON or null
   */
  parseJSON(jsonText) {
    try {
      return JSON.parse(jsonText);
    } catch (error) {
      console.warn('Failed to parse JSON from div.form pre:', error.message);
      return null;
    }
  }
}

