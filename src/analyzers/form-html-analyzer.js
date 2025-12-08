import * as cheerio from 'cheerio';

/**
 * Analyzes rendered form HTML for performance issues
 * Focus: Client-side rendered form content
 */
export class FormHTMLAnalyzer {
  constructor(config = null) {
    this.config = config;
  }

  /**
   * Analyze form HTML for performance issues
   * @param {string} html - HTML content
   * @returns {Object} Analysis results
   */
  analyze(html) {
    if (!html) {
      return { error: 'No HTML provided' };
    }

    const $ = cheerio.load(html);
    
    // Find the form container (adaptive forms typically render in main or specific container)
    const formContainer = $('main, [class*="form"], form').first();
    
    if (!formContainer.length) {
      return { error: 'No form container found in HTML' };
    }

    return {
      images: this.analyzeFormImages($, formContainer),
      scripts: this.analyzeFormScripts($, formContainer),
      resources: this.analyzeFormResources($, formContainer),
      rendering: this.analyzeRenderingPerformance($, formContainer),
      issues: [],
    };
  }

  /**
   * Analyze images within the form
   */
  analyzeFormImages($, container) {
    const images = container.find('img').map((i, img) => {
      const $img = $(img);
      return {
        src: $img.attr('src'),
        alt: $img.attr('alt'),
        loading: $img.attr('loading'),
        width: $img.attr('width'),
        height: $img.attr('height'),
        hasLazyLoading: $img.attr('loading') === 'lazy',
        hasDimensions: !!($img.attr('width') && $img.attr('height')),
      };
    }).get();

    const nonLazyImages = images.filter(img => !img.hasLazyLoading);
    const imagesWithoutDimensions = images.filter(img => !img.hasDimensions);

    return {
      total: images.length,
      lazyLoaded: images.filter(img => img.hasLazyLoading).length,
      nonLazyLoaded: nonLazyImages.length,
      withoutDimensions: imagesWithoutDimensions.length,
      images,
      nonLazyImages,
      imagesWithoutDimensions,
    };
  }

  /**
   * Analyze scripts within form (inline scripts that may block rendering)
   */
  analyzeFormScripts($, container) {
    const inlineScripts = container.find('script:not([src])').map((i, script) => {
      const content = $(script).html();
      return {
        size: content.length,
        hasContent: content.length > 0,
      };
    }).get();

    const externalScripts = container.find('script[src]').map((i, script) => {
      const $script = $(script);
      return {
        src: $script.attr('src'),
        async: $script.attr('async') !== undefined,
        defer: $script.attr('defer') !== undefined,
      };
    }).get();

    return {
      inline: inlineScripts.length,
      inlineSize: inlineScripts.reduce((sum, s) => sum + s.size, 0),
      external: externalScripts.length,
      blocking: externalScripts.filter(s => !s.async && !s.defer).length,
      scripts: {
        inline: inlineScripts,
        external: externalScripts,
      },
    };
  }

  /**
   * Analyze resources loaded within form
   */
  analyzeFormResources($, container) {
    // Check for iframes (can block rendering)
    const iframes = container.find('iframe').map((i, iframe) => {
      const $iframe = $(iframe);
      return {
        src: $iframe.attr('src'),
        loading: $iframe.attr('loading'),
      };
    }).get();

    // Check for videos
    const videos = container.find('video').map((i, video) => {
      const $video = $(video);
      return {
        src: $video.attr('src'),
        preload: $video.attr('preload'),
        autoplay: $video.attr('autoplay') !== undefined,
      };
    }).get();

    // Check for large data attributes (can bloat HTML)
    // Note: [data-*] is not valid CSS, so we check all elements
    const elementsWithLargeData = container.find('*').filter((i, elem) => {
      const attrs = elem.attribs || {};
      let totalDataSize = 0;
      
      // Sum up all data-* attribute sizes
      Object.keys(attrs).forEach(attr => {
        if (attr.startsWith('data-')) {
          totalDataSize += (attrs[attr] || '').length;
        }
      });
      
      return totalDataSize > 5000; // 5KB threshold
    }).length;

    return {
      iframes: iframes.length,
      videos: videos.length,
      autoplayVideos: videos.filter(v => v.autoplay).length,
      elementsWithLargeData,
      iframeList: iframes,
      videoList: videos,
    };
  }

  /**
   * Analyze rendering performance factors
   */
  analyzeRenderingPerformance($, container) {
    // Count DOM elements in form
    const totalElements = container.find('*').length;
    
    // Count elements with inline styles (can slow down rendering)
    const inlineStyleElements = container.find('[style]').length;
    
    // Count deeply nested elements
    const maxDepth = this.calculateMaxDepth($, container);
    
    // Count form fields (inputs, selects, textareas)
    const formFields = container.find('input, select, textarea, button').length;
    
    // Check for visibility: hidden elements (DOM bloat)
    const hiddenElements = container.find('[style*="display:none"], [style*="display: none"], [hidden]').length;

    return {
      totalElements,
      maxDepth,
      formFields,
      inlineStyleElements,
      hiddenElements,
    };
  }

  /**
   * Calculate maximum DOM depth
   */
  calculateMaxDepth($, element, currentDepth = 0) {
    const children = $(element).children();
    if (children.length === 0) {
      return currentDepth;
    }

    let maxChildDepth = currentDepth;
    children.each((i, child) => {
      const depth = this.calculateMaxDepth($, child, currentDepth + 1);
      maxChildDepth = Math.max(maxChildDepth, depth);
    });

    return maxChildDepth;
  }

  /**
   * Detect form HTML performance issues
   */
  detectIssues(analysis) {
    const issues = [];

    // Images without lazy loading
    if (analysis.images.nonLazyLoaded > 0) {
      issues.push({
        severity: 'warning',
        type: 'images-not-lazy-loaded',
        message: `${analysis.images.nonLazyLoaded} image(s) in form without lazy loading. This blocks form rendering.`,
        count: analysis.images.nonLazyLoaded,
        images: analysis.images.nonLazyImages.map(img => img.src),
        recommendation: 'Add loading="lazy" attribute to images that are not immediately visible. This prevents blocking the form render.',
      });
    }

    // Images without dimensions (causes layout shift)
    if (analysis.images.withoutDimensions > 0) {
      issues.push({
        severity: 'info',
        type: 'images-without-dimensions',
        message: `${analysis.images.withoutDimensions} image(s) without width/height attributes. This can cause layout shifts.`,
        count: analysis.images.withoutDimensions,
        recommendation: 'Add width and height attributes to prevent Cumulative Layout Shift (CLS).',
      });
    }

    // Inline scripts in form (blocking)
    if (analysis.scripts.inline > 0 && analysis.scripts.inlineSize > 5000) {
      issues.push({
        severity: 'warning',
        type: 'large-inline-scripts',
        message: `${analysis.scripts.inline} inline script(s) in form (${(analysis.scripts.inlineSize / 1024).toFixed(2)} KB). This blocks form rendering.`,
        size: analysis.scripts.inlineSize,
        recommendation: 'Move inline scripts to external files or execute after form renders.',
      });
    }

    // Blocking external scripts
    if (analysis.scripts.blocking > 0) {
      issues.push({
        severity: 'error',
        type: 'blocking-scripts-in-form',
        message: `${analysis.scripts.blocking} blocking script(s) in form. These delay form interactivity.`,
        count: analysis.scripts.blocking,
        recommendation: 'Add async or defer attributes to scripts, or load them after form renders.',
      });
    }

    // Iframes (blocking)
    if (analysis.resources.iframes > 0) {
      issues.push({
        severity: 'warning',
        type: 'iframes-in-form',
        message: `${analysis.resources.iframes} iframe(s) in form. Iframes block rendering and add overhead.`,
        count: analysis.resources.iframes,
        recommendation: 'Consider lazy loading iframes or using alternative approaches.',
      });
    }

    // Autoplay videos
    if (analysis.resources.autoplayVideos > 0) {
      issues.push({
        severity: 'warning',
        type: 'autoplay-videos',
        message: `${analysis.resources.autoplayVideos} autoplaying video(s) in form. This impacts performance and user experience.`,
        count: analysis.resources.autoplayVideos,
        recommendation: 'Remove autoplay or use lazy loading for videos.',
      });
    }

    // Large data attributes
    if (analysis.resources.elementsWithLargeData > 0) {
      issues.push({
        severity: 'info',
        type: 'large-data-attributes',
        message: `${analysis.resources.elementsWithLargeData} element(s) with large data attributes (>5KB). This bloats HTML size.`,
        count: analysis.resources.elementsWithLargeData,
        recommendation: 'Consider storing large data in JavaScript variables instead of data attributes.',
      });
    }

    // Too many hidden elements (DOM bloat)
    if (analysis.rendering.hiddenElements > 10) {
      issues.push({
        severity: 'info',
        type: 'excessive-hidden-elements',
        message: `${analysis.rendering.hiddenElements} hidden elements in form. This increases DOM size unnecessarily.`,
        count: analysis.rendering.hiddenElements,
        recommendation: 'Remove hidden elements from DOM and add them dynamically when needed.',
      });
    }

    // Excessive inline styles
    if (analysis.rendering.inlineStyleElements > 20) {
      issues.push({
        severity: 'info',
        type: 'excessive-inline-styles',
        message: `${analysis.rendering.inlineStyleElements} elements with inline styles. This prevents style reuse and increases HTML size.`,
        count: analysis.rendering.inlineStyleElements,
        recommendation: 'Use CSS classes instead of inline styles.',
      });
    }

    return issues;
  }

  /**
   * Perform full analysis with issue detection
   */
  analyzeWithIssues(html) {
    const analysis = this.analyze(html);
    if (analysis.error) {
      return analysis;
    }

    analysis.issues = this.detectIssues(analysis);
    return analysis;
  }

  /**
   * Compare before and after HTML analyses
   */
  compare(beforeHtml, afterHtml) {
    const beforeAnalysis = this.analyzeWithIssues(beforeHtml);
    const afterAnalysis = this.analyzeWithIssues(afterHtml);

    if (beforeAnalysis.error || afterAnalysis.error) {
      return { 
        error: beforeAnalysis.error || afterAnalysis.error,
        before: beforeAnalysis,
        after: afterAnalysis,
      };
    }

    return {
      before: beforeAnalysis,
      after: afterAnalysis,
      delta: {
        images: afterAnalysis.images.total - beforeAnalysis.images.total,
        nonLazyImages: afterAnalysis.images.nonLazyLoaded - beforeAnalysis.images.nonLazyLoaded,
        totalElements: afterAnalysis.rendering.totalElements - beforeAnalysis.rendering.totalElements,
        hiddenElements: afterAnalysis.rendering.hiddenElements - beforeAnalysis.rendering.hiddenElements,
        blockingScripts: afterAnalysis.scripts.blocking - beforeAnalysis.scripts.blocking,
      },
      newIssues: afterAnalysis.issues.filter(afterIssue =>
        !beforeAnalysis.issues.some(beforeIssue => beforeIssue.type === afterIssue.type)
      ),
      resolvedIssues: beforeAnalysis.issues.filter(beforeIssue =>
        !afterAnalysis.issues.some(afterIssue => afterIssue.type === beforeIssue.type)
      ),
    };
  }
}

