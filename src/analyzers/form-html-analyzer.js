import * as cheerio from 'cheerio';

/**
 * Analyzes rendered form HTML for performance issues
 * Focus: Client-side rendered form content
 */
export class FormHTMLAnalyzer {
  constructor(config = null) {
    this.config = config;
    
    // Hero image detection configuration (with defaults)
    this.heroConfig = {
      enabled: true,
      keywords: ['hero', 'banner', 'masthead', 'jumbotron', 'splash', 'featured'],
      treatFirstImageAsHero: true,
      minimumHeroSize: { width: 300, height: 200 },
      checkParentContainer: true,
      ...(config?.heroImageDetection || {})
    };
  }

  /**
   * Detect if an image is a hero/banner image that should NOT be lazy-loaded
   * Multi-factor heuristic approach
   */
  isHeroImage(img, index, allImages) {
    if (!this.heroConfig.enabled) {
      return false; // If disabled, all images should be lazy-loaded
    }
    
    // 1. Check image class/id for hero keywords
    const imgClasses = (img.class || '').toLowerCase();
    const imgId = (img.id || '').toLowerCase();
    const keywords = this.heroConfig.keywords.join('|');
    const heroRegex = new RegExp(keywords, 'i');
    
    if (heroRegex.test(imgClasses + imgId)) {
      return true; // Explicit hero indicator in class/id
    }
    
    // 2. Check if image has explicit eager loading attributes
    //    (Next.js priority, fetchpriority, or loading="eager")
    if (img.loading === 'eager' || img.fetchpriority === 'high' || img.priority === 'true') {
      return true; // Developer explicitly marked as high priority
    }
    
    // 3. First image in form heuristic
    if (this.heroConfig.treatFirstImageAsHero && index === 0) {
      // First image is often hero, but check if it's large enough
      const width = parseInt(img.width) || 0;
      const height = parseInt(img.height) || 0;
      const minWidth = this.heroConfig.minimumHeroSize.width;
      const minHeight = this.heroConfig.minimumHeroSize.height;
      
      // If no dimensions, assume it might be hero (safer to not flag)
      if (!width && !height) {
        return true; // First image without dimensions - likely hero
      }
      
      // If dimensions exist, check if they exceed minimum hero size
      if (width >= minWidth || height >= minHeight) {
        return true; // First large image is likely hero
      }
    }
    
    // 4. Check parent container for hero-related classes
    //    (e.g., <section class="hero-section"><img></section>)
    if (this.heroConfig.checkParentContainer && img.parentClasses) {
      const parentClasses = img.parentClasses.toLowerCase();
      if (heroRegex.test(parentClasses)) {
        return true; // Inside a hero container
      }
    }
    
    // Not a hero image - should be lazy-loaded
    return false;
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
      scripts: this.analyzePageScripts($), // Analyze ALL scripts on page (not just in form)
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
      const $parent = $img.parent();
      
      return {
        src: $img.attr('src'),
        alt: $img.attr('alt'),
        loading: $img.attr('loading'),
        fetchpriority: $img.attr('fetchpriority'),
        priority: $img.attr('priority'),
        width: $img.attr('width'),
        height: $img.attr('height'),
        class: $img.attr('class'),
        id: $img.attr('id'),
        parentClasses: $parent.attr('class') || '',
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
   * Analyze ALL scripts on the page (not just within form)
   * Scripts anywhere on the page can block form rendering
   */
  analyzePageScripts($) {
    // Analyze ALL scripts on the entire page
    const inlineScripts = $('script:not([src])').map((i, script) => {
      const content = $(script).html();
      const $script = $(script);
      return {
        size: content.length,
        hasContent: content.length > 0,
        location: this.getScriptLocation($, $script),
      };
    }).get();

    const externalScripts = $('script[src]').map((i, script) => {
      const $script = $(script);
      return {
        src: $script.attr('src'),
        async: $script.attr('async') !== undefined,
        defer: $script.attr('defer') !== undefined,
        location: this.getScriptLocation($, $script),
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
   * Determine script location on page (head, body, etc.)
   */
  getScriptLocation($, $script) {
    if ($script.closest('head').length) return 'head';
    if ($script.closest('body').length) return 'body';
    return 'unknown';
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

    // Images without lazy loading (EXCLUDE hero/banner images)
    if (analysis.images.nonLazyLoaded > 0) {
      // Filter out hero/banner images (which should be eager-loaded for LCP)
      const nonHeroImages = analysis.images.nonLazyImages.filter((img, index) => {
        return !this.isHeroImage(img, index, analysis.images.nonLazyImages);
      });
      
      if (nonHeroImages.length > 0) {
        const heroCount = analysis.images.nonLazyLoaded - nonHeroImages.length;
        issues.push({
          severity: 'error', // CRITICAL: All non-hero images must be lazy loaded
          type: 'images-not-lazy-loaded',
          message: `${nonHeroImages.length} image(s) in form without lazy loading. This blocks form rendering and impacts LCP.${heroCount > 0 ? ` (${heroCount} hero image(s) excluded)` : ''}`,
          count: nonHeroImages.length,
          images: nonHeroImages.map(img => img.src),
          recommendation: 'Add loading="lazy" attribute to all images EXCEPT hero/banner images (first visible image above the fold). Hero images should be eager-loaded for LCP optimization.',
        });
      }
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

    // Inline scripts on page (ALWAYS blocking - they execute synchronously)
    if (analysis.scripts.inline > 0) {
      const inHead = analysis.scripts.scripts.inline.filter(s => s.location === 'head').length;
      const inBody = analysis.scripts.scripts.inline.filter(s => s.location === 'body').length;
      
      issues.push({
        severity: 'error',
        type: 'inline-scripts-on-page',
        message: `${analysis.scripts.inline} inline script(s) on page (${(analysis.scripts.inlineSize / 1024).toFixed(2)} KB) - ${inHead} in HEAD, ${inBody} in BODY. Inline scripts ALWAYS block form rendering.`,
        size: analysis.scripts.inlineSize,
        count: analysis.scripts.inline,
        breakdown: { head: inHead, body: inBody },
        recommendation: 'All JavaScript should be in external files with defer attribute. Move inline scripts to external files loaded with defer. Scripts in HEAD especially delay form rendering.',
      });
    }

    // Blocking external scripts (without async/defer)
    if (analysis.scripts.blocking > 0) {
      const blockingScripts = analysis.scripts.scripts.external.filter(s => !s.async && !s.defer);
      const inHead = blockingScripts.filter(s => s.location === 'head').length;
      const inBody = blockingScripts.filter(s => s.location === 'body').length;
      
      // Build script list for message
      const scriptNames = blockingScripts.map(s => s.src).join(', ');
      
      issues.push({
        severity: 'error',
        type: 'blocking-scripts-on-page',
        message: `${analysis.scripts.blocking} synchronous script(s) on page without async/defer - ${inHead} in HEAD, ${inBody} in BODY. Scripts: ${scriptNames}`,
        count: analysis.scripts.blocking,
        breakdown: { head: inHead, body: inBody },
        scripts: blockingScripts,
        recommendation: 'Add defer attribute to all script tags above. Use defer (not async) for forms to maintain execution order. Scripts in HEAD are especially critical.',
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

    // Large DOM size (impacts INP, TBT, and overall responsiveness)
    // Google recommendation: < 1,500 nodes, warn at 800, error at 1,500
    const domThresholds = this.config?.thresholds?.html?.maxDomNodes || { warning: 800, critical: 1500 };
    
    if (analysis.rendering.totalElements > domThresholds.critical) {
      issues.push({
        severity: 'error',
        type: 'excessive-dom-size',
        message: `${analysis.rendering.totalElements} DOM nodes in rendered form (threshold: ${domThresholds.critical}). Large DOM severely impacts INP (Interaction to Next Paint) and form responsiveness.`,
        count: analysis.rendering.totalElements,
        threshold: domThresholds.critical,
        recommendation: 'Reduce DOM complexity: Remove unnecessary hidden fields, simplify nested structures, use lazy rendering for large lists, consolidate panels. Each interaction must traverse all ${analysis.rendering.totalElements} nodes, causing slow responses.',
      });
    } else if (analysis.rendering.totalElements > domThresholds.warning) {
      issues.push({
        severity: 'warning',
        type: 'large-dom-size',
        message: `${analysis.rendering.totalElements} DOM nodes in rendered form (warning threshold: ${domThresholds.warning}). This impacts INP and can slow down interactions.`,
        count: analysis.rendering.totalElements,
        threshold: domThresholds.warning,
        recommendation: 'Consider reducing DOM size. Target < 800 nodes for optimal INP. Focus on: removing unnecessary hidden fields (see Hidden Fields section), simplifying component structure, lazy loading content.',
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

