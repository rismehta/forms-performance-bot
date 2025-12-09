import puppeteer from 'puppeteer-core';
import { JSONExtractor } from '../extractors/json-extractor.js';
import { CoreComponentsExtractor } from '../extractors/core-components-extractor.js';

/**
 * Analyzes a URL by rendering it in headless browser and extracting form JSON + metrics
 * 
 * Supports:
 * - EDS/Franklin forms (JSON in div.form pre)
 * - Core Components forms (model.json or embedded JSON)
 */
export class URLAnalyzer {
  constructor() {
    this.edsExtractor = new JSONExtractor();
    this.coreComponentsExtractor = new CoreComponentsExtractor();
  }

  /**
   * Detect form type from HTML and URL
   * @param {string} html - Rendered HTML
   * @param {string} url - Page URL
   * @returns {string} 'eds' | 'core-components' | 'unknown'
   */
  detectFormType(html, url = '') {
    // Check for EDS form (div.form with pre containing JSON)
    if (html.includes('<div class="form"') && html.includes('<pre>')) {
      return 'eds';
    }

    // Check for Core Components form - HTML markers
    if (html.includes('data-cmp-is="adaptiveFormContainer"') ||
        html.includes('data-cmp-is="formcontainer"') ||
        html.includes('cmp-adaptiveform-container') ||
        html.includes('cmp-adaptiveform-') ||
        html.includes('adaptiveform-') ||
        html.includes('aem-Form')) {
      return 'core-components';
    }

    // Check for Core Components form - URL patterns
    if (url.includes('/content/forms/af/') ||
        url.includes('/content/dam/formsanddocuments/')) {
      return 'core-components';
    }

    return 'unknown';
  }

  /**
   * Analyze a URL by rendering in headless browser
   * @param {string} url - URL to analyze
   * @returns {Promise<Object>} Analysis results with rendered HTML and performance metrics
   */
  async analyze(url) {
    let browser = null;
    
    try {
      console.log(`Launching headless browser for URL: ${url}`);
      
      // Detect Chrome executable path
      const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
      
      let executablePath;
      if (isCI) {
        // GitHub Actions: use pre-installed Chrome
        executablePath = '/usr/bin/google-chrome';
      } else {
        // Local development: use system Chrome (macOS)
        executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      }
      
      browser = await puppeteer.launch({
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', // Overcome limited resource problems
          '--disable-gpu',
        ],
        defaultViewport: { width: 1280, height: 720 },
        executablePath,
        headless: true,
        ignoreHTTPSErrors: true,
      });

      const page = await browser.newPage();
      
      // Enable performance metrics
      await page.evaluateOnNewDocument(() => {
        window.performanceMetrics = {
          navigationStart: performance.now(),
        };
      });

      console.log(`Navigating to URL...`);
      const startTime = Date.now();
      
      // Navigate to URL
      await page.goto(url, {
        waitUntil: 'domcontentloaded', // Wait for DOM to be ready
        timeout: 30000,
      });

      // Wait for form to actually render (not just the container)
      // AEM forms render fields dynamically, so wait for first input field
      const FORM_TIMEOUT_MS = 15000;
      let formRendered = false;
      
      // Check multiple form types with comprehensive selectors
      const formSelectors = [
        'div.form input',
        'div.form button',
        'div.form select',
        '[data-cmp-is="adaptiveFormContainer"] input',
        '.cmp-adaptiveform-container input',
        'form input[type="text"]',
        'form select'
      ].join(', ');
      
      try {
        await page.waitForSelector(formSelectors, { 
          timeout: FORM_TIMEOUT_MS
        });
        formRendered = true;
        console.log('Form fields rendered successfully');
      } catch (e) {
        console.log('Form fields not rendered within timeout - form failed to load');
      }

      const loadTime = Date.now() - startTime;
      
      if (formRendered) {
        console.log(`Form loaded in ${loadTime}ms`);
      } else {
        console.log(`Form FAILED to load (timeout after ${loadTime}ms)`);
      }

      // Get performance metrics
      const metrics = await page.metrics();
      const performanceTimings = await page.evaluate(() => {
        const perf = performance.getEntriesByType('navigation')[0];
        return perf ? {
          domContentLoaded: perf.domContentLoadedEventEnd - perf.domContentLoadedEventStart,
          loadComplete: perf.loadEventEnd - perf.loadEventStart,
          domInteractive: perf.domInteractive - perf.fetchStart,
        } : {};
      });

      // Get rendered HTML (after JavaScript execution)
      const renderedHTML = await page.content();

      // Detect form type (from HTML markers + URL pattern)
      const formType = this.detectFormType(renderedHTML, url);
      console.log(`Detected form type: ${formType}`);

      // Extract JSON using appropriate extractor
      let jsonData;
      if (formType === 'core-components') {
        console.log('Using Core Components extractor...');
        jsonData = await this.coreComponentsExtractor.extract(renderedHTML, url);
      } else {
        console.log('Using EDS extractor...');
        jsonData = this.edsExtractor.extract(renderedHTML);
      }

      await browser.close();
      browser = null;

      return {
        url,
        timestamp: new Date().toISOString(),
        status: 200,
        contentType: 'text/html',
        html: renderedHTML, // Rendered HTML with all components
        formJson: jsonData.formJson,
        formType,
        jsonErrors: jsonData.errors,
        rawSize: renderedHTML.length,
        performanceMetrics: {
          loadTime, // Total time to load and render (ms)
          formRendered, // Whether form actually loaded or timed out
          domContentLoaded: performanceTimings.domContentLoaded || 0,
          loadComplete: performanceTimings.loadComplete || 0,
          domInteractive: performanceTimings.domInteractive || 0,
          ...metrics, // Puppeteer metrics (JSHeapSize, Nodes, etc.)
        },
      };

    } catch (error) {
      console.error(`Error analyzing URL ${url}:`, error.message);
      if (browser) {
        await browser.close();
      }
      throw error;
    }
  }
}
