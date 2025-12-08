import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { JSONExtractor } from '../extractors/json-extractor.js';

/**
 * Analyzes a URL by rendering it in headless browser and extracting form JSON + metrics
 */
export class URLAnalyzer {
  constructor() {
    this.jsonExtractor = new JSONExtractor();
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
      
      // Launch browser (uses local Chrome in dev, @sparticuz/chromium in GitHub Actions)
      const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
      
      let executablePath;
      if (isCI) {
        // GitHub Actions: use @sparticuz/chromium
        executablePath = await chromium.executablePath();
      } else {
        // Local development: use system Chrome
        executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      }
      
      browser = await puppeteer.launch({
        args: isCI ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: isCI ? chromium.defaultViewport : { width: 1280, height: 720 },
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
      await page.waitForSelector('div.form input, div.form button, div.form select', { 
        timeout: 15000 
      }).catch(() => {
        console.log('Form fields not rendered within timeout');
      });

      const loadTime = Date.now() - startTime;
      console.log(`Form loaded in ${loadTime}ms`);

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

      // Extract JSON data from rendered page
      const jsonData = this.jsonExtractor.extract(renderedHTML);

      await browser.close();
      browser = null;

      return {
        url,
        timestamp: new Date().toISOString(),
        status: 200,
        contentType: 'text/html',
        html: renderedHTML, // Rendered HTML with all components
        formJson: jsonData.formJson,
        jsonErrors: jsonData.errors,
        rawSize: renderedHTML.length,
        performanceMetrics: {
          loadTime, // Total time to load and render (ms)
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

