import * as cheerio from 'cheerio';

// Properties that force layout / are non-composited when animated
const NON_COMPOSITED_ANIM_PROPS = new Set([
  'top', 'left', 'right', 'bottom',
  'width', 'height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-size',
]);

// CSS selectors / tag names considered "above the fold"
const ABOVE_FOLD_SELECTORS = [
  'header',
  '.header',
  '[class*="header"]',
  '.banner',
  '[class*="banner"]',
];

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
      aboveFoldLazyIssues: this.detectAboveFoldLazyImages($),
      imageUrls: this.collectImageUrls($),
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
   * Classify image URLs (with known sizes) into issues.
   * Called from analyzeWithIssues (sync) or tests directly.
   * @param {Array<{url: string, fileSizeKb: number|null}>} imageSizes
   * @returns {Array} issues
   */
  classifyImageIssues(imageSizes) {
    const issues = [];

    for (const { url, fileSizeKb } of imageSizes) {
      const isGif = /\.gif(\?|$)/i.test(url);

      if (isGif) {
        if (fileSizeKb === null) {
          // HEAD request failed — flag on URL alone
          issues.push({
            severity: 'warning',
            type: 'animated-gif-detected',
            url,
            fileSizeKb: null,
            message: `Animated GIF detected: "${url}". GIF format is inefficient regardless of size.`,
            recommendation: 'Replace GIFs with video (<video autoplay loop muted playsinline>) or WebP animations for smaller file size and better performance.',
          });
        } else if (fileSizeKb > 200) {
          issues.push({
            severity: 'error',
            type: 'animated-gif-detected',
            url,
            fileSizeKb,
            message: `Large animated GIF (${fileSizeKb.toFixed(1)} KB): "${url}". Severely impacts page weight.`,
            recommendation: 'Replace GIFs with video (<video autoplay loop muted playsinline>) or WebP animations for smaller file size and better performance.',
          });
        } else if (fileSizeKb > 50) {
          issues.push({
            severity: 'warning',
            type: 'animated-gif-detected',
            url,
            fileSizeKb,
            message: `Animated GIF (${fileSizeKb.toFixed(1)} KB): "${url}". GIF format is inefficient.`,
            recommendation: 'Replace GIFs with video (<video autoplay loop muted playsinline>) or WebP animations for smaller file size and better performance.',
          });
        }
      }

      // Oversized image check — applies to ALL formats (when size is known)
      if (fileSizeKb !== null) {
        if (fileSizeKb > 500) {
          issues.push({
            severity: 'error',
            type: 'oversized-image',
            url,
            fileSizeKb,
            message: `Oversized image (${fileSizeKb.toFixed(1)} KB): "${url}". Exceeds 500 KB threshold.`,
            recommendation: 'Compress and resize images. Use modern formats (WebP/AVIF). Target < 150 KB for most images.',
          });
        } else if (fileSizeKb > 150) {
          issues.push({
            severity: 'warning',
            type: 'oversized-image',
            url,
            fileSizeKb,
            message: `Large image (${fileSizeKb.toFixed(1)} KB): "${url}". Exceeds 150 KB warning threshold.`,
            recommendation: 'Compress and resize images. Use modern formats (WebP/AVIF). Target < 150 KB for most images.',
          });
        }
      }
    }

    return issues;
  }

  /**
   * Collect image URLs from HTML (img src + source type=image/gif).
   * @param {CheerioAPI} $ - Cheerio instance
   * @returns {string[]} array of absolute-or-relative URLs
   */
  collectImageUrls($) {
    const urls = new Set();

    $('img[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (src && !src.startsWith('data:')) {
        urls.add(src);
      }
    });

    // <picture><source type="image/gif" srcset="...">
    $('source[type="image/gif"]').each((_, el) => {
      const srcset = $(el).attr('srcset') || $(el).attr('src');
      if (srcset && !srcset.startsWith('data:')) {
        // srcset may have multiple values; take the first URL part
        const firstUrl = srcset.split(',')[0].trim().split(/\s+/)[0];
        if (firstUrl) urls.add(firstUrl);
      }
    });

    return Array.from(urls);
  }

  /**
   * Fetch Content-Length for a list of URLs using HEAD requests.
   * Max 10 concurrent, 3s timeout per request. Never throws.
   * @param {string[]} urls
   * @returns {Promise<Map<string, number|null>>} url → fileSizeKb (or null on failure)
   */
  async fetchImageSizes(urls) {
    const result = new Map();
    const CONCURRENCY = 10;
    const TIMEOUT_MS = 3000;

    async function fetchOne(url) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const resp = await fetch(url, { method: 'HEAD', signal: controller.signal });
        clearTimeout(timer);
        const contentLength = resp.headers.get('content-length');
        return contentLength ? parseInt(contentLength, 10) / 1024 : null;
      } catch {
        return null;
      }
    }

    // Process in batches of CONCURRENCY
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      const sizes = await Promise.all(batch.map(fetchOne));
      batch.forEach((url, idx) => result.set(url, sizes[idx]));
    }

    return result;
  }

  /**
   * Detect above-fold images with loading="lazy".
   * Checks:
   *  1. Any <img loading="lazy"> inside header/.header/[class*="header"]/.banner/[class*="banner"]
   *  2. The first <img> on the page that is lazy but has no fetchpriority="high"
   * @param {CheerioAPI} $
   * @returns {Array} issues
   */
  detectAboveFoldLazyImages($) {
    const issues = [];
    const seen = new Set();

    // Check 1 — images in above-fold containers
    const aboveFoldContainerSelectors = [
      'header',
      '.header',
      '[class*="header"]',
      '.banner',
      '[class*="banner"]',
    ];

    for (const containerSel of aboveFoldContainerSelectors) {
      $(`${containerSel} img[loading="lazy"]`).each((_, el) => {
        const $img = $(el);
        const src = $img.attr('src') || '';
        if (seen.has(src)) return;
        seen.add(src);

        issues.push({
          severity: 'warning',
          type: 'above-fold-image-lazy-loaded',
          url: src,
          alt: $img.attr('alt') || '',
          container: containerSel,
          message: `Above-fold image "${src}" inside "${containerSel}" has loading="lazy". This delays LCP.`,
          recommendation: 'Use loading="eager" (or omit the loading attribute) for images inside header/banner containers. Reserve lazy loading for below-fold images.',
        });
      });
    }

    // Check 2 — first <img> on the entire page that is lazy without fetchpriority="high"
    const allImgs = $('img').toArray();
    if (allImgs.length > 0) {
      const firstImg = $(allImgs[0]);
      const isLazy = firstImg.attr('loading') === 'lazy';
      const hasFetchPriority = firstImg.attr('fetchpriority') === 'high';
      const src = firstImg.attr('src') || '';

      if (isLazy && !hasFetchPriority && !seen.has(src)) {
        seen.add(src);
        issues.push({
          severity: 'warning',
          type: 'above-fold-image-lazy-loaded',
          url: src,
          alt: firstImg.attr('alt') || '',
          container: 'first-image-on-page',
          message: `First image on page "${src}" has loading="lazy" without fetchpriority="high". This delays LCP.`,
          recommendation: 'The first visible image should use loading="eager" or fetchpriority="high" to ensure fast LCP.',
        });
      }
    }

    return issues;
  }

  /**
   * Static analysis of JS files for loadFragment() calls without eager override.
   * @param {Array<{filename: string, content: string}>} jsFiles
   * @returns {Array} issues
   */
  detectFragmentIssues(jsFiles) {
    const issues = [];

    if (!jsFiles || jsFiles.length === 0) {
      return issues;
    }

    for (const { filename, content } of jsFiles) {
      // Find all loadFragment( calls and their line numbers
      const lines = content.split('\n');
      const loadFragmentLines = [];

      lines.forEach((line, idx) => {
        if (line.includes('loadFragment(')) {
          loadFragmentLines.push(idx + 1); // 1-based line number
        }
      });

      if (loadFragmentLines.length === 0) continue;

      // Check if the file contains an eager override anywhere
      // Patterns: img.loading = 'eager' / img.loading='eager' / loading = 'eager' / setAttribute('loading', 'eager')
      const hasEagerOverride = /img\.loading\s*=\s*['"]eager['"]/.test(content)
        || /loading\s*=\s*['"]eager['"]/.test(content)
        || /setAttribute\s*\(\s*['"]loading['"]\s*,\s*['"]eager['"]/.test(content);

      if (!hasEagerOverride) {
        issues.push({
          severity: 'warning',
          type: 'fragment-images-not-eagerly-loaded',
          file: filename,
          line: loadFragmentLines[0],
          message: `loadFragment() called in "${filename}" but no img.loading = 'eager' override found. Fragment images will default to lazy loading.`,
          recommendation: "After loadFragment(), set eager loading on images: fragment.querySelectorAll('img').forEach(img => { img.loading = 'eager'; })",
        });
      }
    }

    return issues;
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

    // Above-fold images with lazy loading (Gap 2)
    if (analysis.aboveFoldLazyIssues && analysis.aboveFoldLazyIssues.length > 0) {
      issues.push(...analysis.aboveFoldLazyIssues);
    }

    return issues;
  }

  /**
   * Perform full analysis with issue detection.
   * Optionally accepts jsFiles for Gap 5 (fragment eager-load check).
   */
  analyzeWithIssues(html, jsFiles = []) {
    const analysis = this.analyze(html);
    if (analysis.error) {
      return analysis;
    }

    analysis.issues = this.detectIssues(analysis);

    // Gap 5 — fragment eager-load check (static JS analysis)
    if (jsFiles && jsFiles.length > 0) {
      analysis.issues.push(...this.detectFragmentIssues(jsFiles));
    }

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

