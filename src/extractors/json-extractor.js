import * as cheerio from 'cheerio';

/**
 * Extracts JSON data from page HTML
 * Supports both EDS forms (div.form > pre) and Core Components forms (model.json)
 */
export class JSONExtractor {
  /**
   * Extract form JSON from HTML content
   * @param {string} html - HTML content
   * @param {string} url - Optional URL for Core Components model.json fetching
   * @param {Object} page - Optional Puppeteer page object for authenticated requests
   * @returns {Object} Extracted JSON data
   */
  async extract(html, url = null, page = null) {
    // For Core Components, fetch model.json
    if (url && (url.includes('/content/forms/af/') || url.includes('/content/dam/formsanddocuments/'))) {
      const modelData = await this.extractCoreComponents(url, page);
      if (modelData.formJson) {
        return modelData;
      }
    }
    
    // Default to EDS extraction (synchronous, backward compatible)
    return this.extractEDS(html);
  }

  /**
   * Extract EDS/Franklin form JSON from HTML (original method)
   * @param {string} html - HTML content
   * @returns {Object} Extracted JSON data
   */
  extractEDS(html) {
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

  /**
   * Extract Core Components form JSON by fetching model.json using Puppeteer page
   * @param {string} url - Page URL
   * @param {Object} page - Puppeteer page object from URLAnalyzer
   * @returns {Object} Extracted JSON data
   */
  async extractCoreComponents(url, page) {
    const results = {
      formJson: null,
      errors: []
    };

    try {
      // Convert page URL to model.json URL
      // Example: /content/forms/af/myform.html?wcmmode=disabled -> /content/forms/af/myform.model.json
      const modelUrl = url.replace('.html', '.model.json').split('?')[0];
      
      // Use page.evaluate to fetch with the page's cookies/auth and Basic Auth for AEM
      const jsonResponse = await page.evaluate(async (modelUrl) => {
        try {
          // Add Basic Auth for localhost AEM (default credentials)
          const headers = {
            'Accept': 'application/json'
          };
          
          // For localhost AEM, add Basic Auth
          const urlObj = new URL(modelUrl);
          if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
            const credentials = 'admin:admin'; // Default AEM credentials
            headers['Authorization'] = `Basic ${btoa(credentials)}`;
          }
          
          const response = await fetch(modelUrl, {
            credentials: 'include', // Include cookies
            headers: headers
          });
          
          if (!response.ok) {
            return { error: `HTTP ${response.status}: ${response.statusText}` };
          }
          
          const text = await response.text();
          return { success: true, data: text };
        } catch (error) {
          return { error: error.message };
        }
      }, modelUrl);
      
      if (jsonResponse.error) {
        results.errors.push({ message: `Failed to fetch model.json: ${jsonResponse.error}` });
        return results;
      }
      
      // Parse the JSON
      const modelJson = JSON.parse(jsonResponse.data);
      
      // Find form container in model (recursively search for formcontainer component)
      const formData = this.findFormInModel(modelJson);
      
      if (formData) {
        // Return as-is - Core Components format is already compatible with analyzers
        results.formJson = formData;
      } else {
        results.errors.push({ message: 'No form container found in model.json' });
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
   * Recursively find form container in Core Components model.json
   * @param {Object} obj - Model JSON object
   * @returns {Object|null} Form container data or null
   */
  findFormInModel(obj) {
    if (!obj || typeof obj !== 'object') return null;
    
    // Check if this is a form container
    // Core Components use :type like "mysite/components/adaptiveForm/formcontainer"
    // Or fieldType === 'form'
    if ((obj[':type'] && obj[':type'].includes('/formcontainer')) || obj.fieldType === 'form') {
      return obj;
    }
    
    // Recursively search in :items
    if (obj[':items']) {
      for (const key in obj[':items']) {
        const result = this.findFormInModel(obj[':items'][key]);
        if (result) return result;
      }
    }
    
    return null;
  }
}

