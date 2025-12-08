import fetch from 'node-fetch';
import { JSONExtractor } from '../extractors/json-extractor.js';

/**
 * Analyzes a URL by fetching and extracting form JSON
 */
export class URLAnalyzer {
  constructor() {
    this.jsonExtractor = new JSONExtractor();
  }

  /**
   * Analyze a URL and extract all relevant data
   * @param {string} url - URL to analyze
   * @returns {Promise<Object>} Analysis results
   */
  async analyze(url) {
    try {
      console.log(`Fetching URL: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Performance-Bot/1.0',
        },
        timeout: 30000,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const contentType = response.headers.get('content-type') || '';

      // Extract JSON data from div.form pre
      const jsonData = this.jsonExtractor.extract(html);

      return {
        url,
        timestamp: new Date().toISOString(),
        status: response.status,
        contentType,
        html, // Keep HTML for form HTML analysis
        formJson: jsonData.formJson,
        jsonErrors: jsonData.errors,
        rawSize: html.length,
      };

    } catch (error) {
      console.error(`Error analyzing URL ${url}:`, error.message);
      throw error;
    }
  }

}

