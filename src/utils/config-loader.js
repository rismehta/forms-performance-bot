import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Default configuration based on Core Web Vitals research
 * See docs/THRESHOLDS.md for detailed explanation
 */
const DEFAULT_CONFIG = {
  thresholds: {
    form: {
      maxComponents: 75,
      maxDepth: 8,
      maxEventHandlers: 30,
      maxHiddenFields: 20,
      maxRulesPerField: 5,
      maxTotalRules: 50,
      maxNestedPanels: 15
    },
    html: {
      maxDOMSize: 800,
      maxDOMDepth: 12,
      maxInlineStyles: 20,
      maxHiddenElements: 50,
      maxDataAttributeSize: 1024,
      requireLazyLoading: true,
      requireImageDimensions: true
    },
    javascript: {
      maxFileSize: 51200, // 50KB
      maxFunctionComplexity: 10,
      maxFunctionsPerFile: 30,
      maxLinesPerFunction: 50,
      blockingAPIsInInitialize: true
    },
    css: {
      maxFileSize: 51200, // 50KB
      maxSelectorsPerFile: 500,
      maxSelectorDepth: 3,
      maxImportantUsage: 10,
      maxDuplicateSelectors: 5,
      disallowImports: true,
      maxInlineDataURISize: 4096,
      preferCSSVariables: true
    },
    images: {
      requireLazyLoading: true,
      requireDimensions: true,
      maxInlineImageSize: 4096,
      preferWebP: true
    },
    performance: {
      targetLCP: 2500,
      targetINP: 200,
      targetCLS: 0.1,
      targetTBT: 300
    }
  },
  ignorePatterns: [
    'test/**',
    'tests/**',
    '*.spec.js',
    '*.test.js',
    '**/node_modules/**',
    'dist/**',
    'build/**',
    'coverage/**',
    '*.min.js',
    '*.min.css'
  ],
  reportOptions: {
    includeRecommendations: true,
    verboseMode: false,
    maxIssuesDisplayed: 10,
    showCWVImpact: true,
    groupBySeverity: true
  }
};

/**
 * Configuration loader with defaults
 */
export class ConfigLoader {
  constructor() {
    this.config = null;
  }

  /**
   * Load configuration from file or use defaults
   * @param {string} configPath - Optional path to config file
   * @returns {Promise<Object>} Configuration object
   */
  async load(configPath = null) {
    if (this.config) {
      return this.config;
    }

    // Try to load custom config
    if (configPath) {
      try {
        const content = await readFile(configPath, 'utf-8');
        const customConfig = JSON.parse(content);
        this.config = this.mergeConfig(DEFAULT_CONFIG, customConfig);
        console.log('✅ Loaded custom configuration from:', configPath);
        return this.config;
      } catch (error) {
        console.warn(`⚠️  Failed to load config from ${configPath}: ${error.message}`);
        console.log('Using default configuration');
      }
    }

    // Try to load from default locations
    const defaultPaths = [
      '.performance-bot.json',
      '.performancebotrc.json',
      join(process.cwd(), '.performance-bot.json')
    ];

    for (const path of defaultPaths) {
      try {
        const content = await readFile(path, 'utf-8');
        const customConfig = JSON.parse(content);
        this.config = this.mergeConfig(DEFAULT_CONFIG, customConfig);
        console.log('✅ Loaded configuration from:', path);
        return this.config;
      } catch (error) {
        // Continue to next path
      }
    }

    // No custom config found, use defaults
    this.config = DEFAULT_CONFIG;
    console.log('📋 Using default configuration (no custom config file found)');
    return this.config;
  }

  /**
   * Deep merge custom config with defaults
   * @param {Object} defaults - Default configuration
   * @param {Object} custom - Custom configuration
   * @returns {Object} Merged configuration
   */
  mergeConfig(defaults, custom) {
    const merged = { ...defaults };

    for (const key in custom) {
      if (custom[key] && typeof custom[key] === 'object' && !Array.isArray(custom[key])) {
        merged[key] = this.mergeConfig(defaults[key] || {}, custom[key]);
      } else {
        merged[key] = custom[key];
      }
    }

    return merged;
  }

  /**
   * Get threshold value with fallback
   * @param {string} category - Threshold category (form, html, css, etc.)
   * @param {string} key - Threshold key
   * @param {*} fallback - Fallback value if not found
   * @returns {*} Threshold value
   */
  getThreshold(category, key, fallback = null) {
    if (!this.config) {
      return fallback;
    }

    return this.config.thresholds?.[category]?.[key] ?? fallback;
  }

  /**
   * Get all thresholds for a category
   * @param {string} category - Threshold category
   * @returns {Object} All thresholds for the category
   */
  getThresholds(category) {
    if (!this.config) {
      return {};
    }

    return this.config.thresholds?.[category] || {};
  }

  /**
   * Get report options
   * @returns {Object} Report options
   */
  getReportOptions() {
    return this.config?.reportOptions || DEFAULT_CONFIG.reportOptions;
  }

  /**
   * Get ignore patterns
   * @returns {Array<string>} Ignore patterns
   */
  getIgnorePatterns() {
    return this.config?.ignorePatterns || DEFAULT_CONFIG.ignorePatterns;
  }

  /**
   * Reset cached config (useful for testing)
   */
  reset() {
    this.config = null;
  }
}

// Singleton instance
let configInstance = null;

/**
 * Get configuration loader instance
 * @returns {ConfigLoader} Configuration loader
 */
export function getConfig() {
  if (!configInstance) {
    configInstance = new ConfigLoader();
  }
  return configInstance;
}

/**
 * Load configuration (convenience function)
 * @param {string} configPath - Optional path to config file
 * @returns {Promise<Object>} Configuration object
 */
export async function loadConfig(configPath = null) {
  const loader = getConfig();
  return await loader.load(configPath);
}

