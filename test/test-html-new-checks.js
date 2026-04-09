/**
 * Test cases for new FormHTMLAnalyzer checks:
 *   - animated-gif-detected    (Gap 1)
 *   - above-fold-image-lazy-loaded (Gap 2)
 *   - oversized-image          (Gap 3)
 *   - fragment-images-not-eagerly-loaded (Gap 5)
 */

import { FormHTMLAnalyzer } from '../src/analyzers/form-html-analyzer.js';

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${testName}${details ? ' — ' + details : ''}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${testName}${details ? ' — ' + details : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapInMain(inner) {
  return `<html><body><main>${inner}</main></body></html>`;
}

// ---------------------------------------------------------------------------
// Gap 2 — above-fold lazy images
// ---------------------------------------------------------------------------

console.log('\n=== Gap 2: Above-fold images with loading="lazy" ===\n');

// 2a. <img loading="lazy"> inside a <header> element should be flagged
{
  const html = wrapInMain(`
    <header>
      <img src="/logo.png" loading="lazy" alt="logo">
    </header>
    <div class="content">
      <img src="/content.jpg" loading="lazy" alt="content">
    </div>
  `);
  const analyzer = new FormHTMLAnalyzer();
  const result = analyzer.analyzeWithIssues(html);
  const issue = result.issues.find(i => i.type === 'above-fold-image-lazy-loaded');
  assert(!!issue, 'above-fold: lazy img inside <header> is flagged');
  assert(issue?.severity === 'warning', 'above-fold: severity is warning');
}

// 2b. <img loading="lazy"> inside .header class element should be flagged
{
  const html = wrapInMain(`
    <div class="header">
      <img src="/hero.png" loading="lazy" alt="hero">
    </div>
  `);
  const analyzer = new FormHTMLAnalyzer();
  const result = analyzer.analyzeWithIssues(html);
  const issue = result.issues.find(i => i.type === 'above-fold-image-lazy-loaded');
  assert(!!issue, 'above-fold: lazy img inside .header is flagged');
}

// 2c. <img loading="lazy"> inside element with class containing "banner" should be flagged
{
  const html = wrapInMain(`
    <section class="hero-banner">
      <img src="/banner.jpg" loading="lazy" alt="banner">
    </section>
  `);
  const analyzer = new FormHTMLAnalyzer();
  const result = analyzer.analyzeWithIssues(html);
  const issue = result.issues.find(i => i.type === 'above-fold-image-lazy-loaded');
  assert(!!issue, 'above-fold: lazy img inside [class*="banner"] is flagged');
}

// 2d. First <img> on the page with loading="lazy" and no fetchpriority="high" should be flagged
{
  const html = wrapInMain(`
    <div class="content">
      <img src="/first.jpg" loading="lazy" alt="first">
      <img src="/second.jpg" loading="lazy" alt="second">
    </div>
  `);
  const analyzer = new FormHTMLAnalyzer();
  const result = analyzer.analyzeWithIssues(html);
  const issue = result.issues.find(i => i.type === 'above-fold-image-lazy-loaded');
  assert(!!issue, 'above-fold: first lazy img without fetchpriority is flagged');
}

// 2e. First <img> with loading="lazy" AND fetchpriority="high" should NOT trigger above-fold issue for that img
{
  const html = wrapInMain(`
    <div class="content">
      <img src="/first.jpg" loading="lazy" fetchpriority="high" alt="first">
      <img src="/second.jpg" loading="lazy" alt="second">
    </div>
  `);
  const analyzer = new FormHTMLAnalyzer();
  const result = analyzer.analyzeWithIssues(html);
  // second img is not inside above-fold container and is not the first img → no above-fold issue
  const issue = result.issues.find(i => i.type === 'above-fold-image-lazy-loaded');
  assert(!issue, 'above-fold: first lazy img WITH fetchpriority="high" is NOT flagged');
}

// 2f. Image inside <div class="banner"> should be flagged (exact class match)
{
  const html = wrapInMain(`
    <div class="banner">
      <img src="/banner.webp" loading="lazy" alt="banner">
    </div>
  `);
  const analyzer = new FormHTMLAnalyzer();
  const result = analyzer.analyzeWithIssues(html);
  const issue = result.issues.find(i => i.type === 'above-fold-image-lazy-loaded');
  assert(!!issue, 'above-fold: lazy img inside .banner is flagged');
}

// 2g. Lazy image NOT in above-fold container AND not the first image → not flagged
{
  const html = wrapInMain(`
    <div class="content">
      <img src="/first.jpg" loading="eager" alt="first">
      <img src="/second.jpg" loading="lazy" alt="second">
    </div>
  `);
  const analyzer = new FormHTMLAnalyzer();
  const result = analyzer.analyzeWithIssues(html);
  const issue = result.issues.find(i => i.type === 'above-fold-image-lazy-loaded');
  assert(!issue, 'above-fold: second lazy img not in header/banner container is NOT flagged');
}

// 2h. Issue includes recommendation
{
  const html = wrapInMain(`
    <header>
      <img src="/logo.png" loading="lazy" alt="logo">
    </header>
  `);
  const analyzer = new FormHTMLAnalyzer();
  const result = analyzer.analyzeWithIssues(html);
  const issue = result.issues.find(i => i.type === 'above-fold-image-lazy-loaded');
  assert(typeof issue?.recommendation === 'string' && issue.recommendation.length > 0,
    'above-fold: issue has recommendation text');
}

// ---------------------------------------------------------------------------
// Gap 5 — Fragment-loaded images without eager override (static JS analysis)
// ---------------------------------------------------------------------------

console.log('\n=== Gap 5: Fragment images not eagerly loaded ===\n');

// 5a. loadFragment called with no eager override → should be flagged
{
  const jsFiles = [{
    filename: 'blocks/form/form.js',
    content: `
export async function decorate(block) {
  const fragment = await loadFragment('/path/to/fragment');
  block.append(fragment);
}
`
  }];
  const analyzer = new FormHTMLAnalyzer();
  const result = analyzer.detectFragmentIssues(jsFiles);
  assert(result.length > 0, 'fragment: loadFragment without eager override is flagged');
  assert(result[0].type === 'fragment-images-not-eagerly-loaded', 'fragment: correct issue type');
  assert(result[0].severity === 'warning', 'fragment: severity is warning');
}

// 5b. loadFragment called WITH img.loading eager assignment → should NOT be flagged
{
  const jsFiles = [{
    filename: 'blocks/form/form.js',
    content: `
export async function decorate(block) {
  const fragment = await loadFragment('/path/to/fragment');
  const imgs = fragment.querySelectorAll('img');
  imgs.forEach(img => { img.loading = 'eager'; });
  block.append(fragment);
}
`
  }];
  const analyzer = new FormHTMLAnalyzer();
  const result = analyzer.detectFragmentIssues(jsFiles);
  assert(result.length === 0, 'fragment: loadFragment with img.loading = eager is NOT flagged');
}

// 5c. loadFragment called with loading = 'eager' string present → should NOT be flagged
{
  const jsFiles = [{
    filename: 'blocks/hero/hero.js',
    content: `
export default async function decorate(block) {
  const frag = await loadFragment('/fragments/hero');
  const img = frag.querySelector('img');
  img.setAttribute('loading', 'eager');
  block.replaceChildren(frag);
}
`
  }];
  const analyzer = new FormHTMLAnalyzer();
  const result = analyzer.detectFragmentIssues(jsFiles);
  // 'eager' appears in same file scope → no issue
  assert(result.length === 0, 'fragment: loadFragment with loading eager setAttribute is NOT flagged');
}

// 5d. No loadFragment at all → no issues
{
  const jsFiles = [{
    filename: 'blocks/form/form.js',
    content: `
export function decorate(block) {
  block.classList.add('loaded');
}
`
  }];
  const analyzer = new FormHTMLAnalyzer();
  const result = analyzer.detectFragmentIssues(jsFiles);
  assert(result.length === 0, 'fragment: file without loadFragment has no issues');
}

// 5e. Issue includes file and recommendation
{
  const jsFiles = [{
    filename: 'blocks/teaser/teaser.js',
    content: `
async function init() {
  const frag = await loadFragment('/fragments/teaser');
  document.body.append(frag);
}
`
  }];
  const analyzer = new FormHTMLAnalyzer();
  const result = analyzer.detectFragmentIssues(jsFiles);
  assert(result[0]?.file === 'blocks/teaser/teaser.js', 'fragment: issue includes file');
  assert(typeof result[0]?.recommendation === 'string', 'fragment: issue includes recommendation');
  assert(typeof result[0]?.line === 'number', 'fragment: issue includes line number');
}

// ---------------------------------------------------------------------------
// Gap 1+3 via analyzeImageUrls (async) — animated GIF and oversized image
// ---------------------------------------------------------------------------

console.log('\n=== Gap 1: Animated GIF detection ===\n');

{
  // analyzeImageUrls with pre-provided sizeMap avoids actual HEAD requests
  const analyzer = new FormHTMLAnalyzer();

  // error: GIF > 200KB
  const largeGifResult = analyzer.classifyImageIssues([
    { url: 'https://example.com/anim.gif', fileSizeKb: 250 }
  ]);
  const gifError = largeGifResult.find(i => i.type === 'animated-gif-detected' && i.severity === 'error');
  assert(!!gifError, 'GIF > 200KB → error');

  // warning: GIF > 50KB
  const medGifResult = analyzer.classifyImageIssues([
    { url: 'https://example.com/anim.gif', fileSizeKb: 80 }
  ]);
  const gifWarn = medGifResult.find(i => i.type === 'animated-gif-detected' && i.severity === 'warning');
  assert(!!gifWarn, 'GIF > 50KB → warning');

  // warning: GIF with unknown size (HEAD failed) — URL alone is enough
  const unknownGifResult = analyzer.classifyImageIssues([
    { url: 'https://example.com/anim.gif', fileSizeKb: null }
  ]);
  const gifUnknownWarn = unknownGifResult.find(i => i.type === 'animated-gif-detected' && i.severity === 'warning');
  assert(!!gifUnknownWarn, 'GIF with unknown size (HEAD failed) → warning');

  // no issue: non-GIF small image
  const pngResult = analyzer.classifyImageIssues([
    { url: 'https://example.com/photo.png', fileSizeKb: 30 }
  ]);
  const gifForPng = pngResult.find(i => i.type === 'animated-gif-detected');
  assert(!gifForPng, 'PNG image does not get animated-gif-detected issue');
}

console.log('\n=== Gap 3: Oversized image detection ===\n');

{
  const analyzer = new FormHTMLAnalyzer();

  // error: any image > 500KB
  const bigPngResult = analyzer.classifyImageIssues([
    { url: 'https://example.com/photo.png', fileSizeKb: 600 }
  ]);
  const overErr = bigPngResult.find(i => i.type === 'oversized-image' && i.severity === 'error');
  assert(!!overErr, 'PNG > 500KB → oversized-image error');

  // warning: image > 150KB
  const medJpgResult = analyzer.classifyImageIssues([
    { url: 'https://example.com/photo.jpg', fileSizeKb: 200 }
  ]);
  const overWarn = medJpgResult.find(i => i.type === 'oversized-image' && i.severity === 'warning');
  assert(!!overWarn, 'JPG > 150KB → oversized-image warning');

  // no issue: image < 150KB
  const smallResult = analyzer.classifyImageIssues([
    { url: 'https://example.com/thumb.jpg', fileSizeKb: 50 }
  ]);
  const overSmall = smallResult.find(i => i.type === 'oversized-image');
  assert(!overSmall, 'JPG < 150KB → no oversized-image issue');

  // GIF > 500KB gets BOTH animated-gif error AND oversized-image error
  const bigGifResult = analyzer.classifyImageIssues([
    { url: 'https://example.com/big.gif', fileSizeKb: 600 }
  ]);
  const bothIssues = bigGifResult.filter(i => i.type === 'animated-gif-detected' || i.type === 'oversized-image');
  assert(bothIssues.length === 2, 'GIF > 500KB gets both animated-gif + oversized-image issues');

  // Issue includes url, fileSizeKb, recommendation
  assert(typeof overErr?.url === 'string', 'oversized-image: has url field');
  assert(typeof overErr?.fileSizeKb === 'number', 'oversized-image: has fileSizeKb field');
  assert(typeof overErr?.recommendation === 'string', 'oversized-image: has recommendation');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
  console.log('\n⚠️  Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}
