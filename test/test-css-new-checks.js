/**
 * Test cases for new FormCSSAnalyzer checks:
 *   - non-composited-animation (Gap 4)
 *   - missing-will-change      (Gap 4)
 */

import { FormCSSAnalyzer } from '../src/analyzers/form-css-analyzer.js';

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
// Gap 4 — Non-composited CSS animations
// ---------------------------------------------------------------------------

console.log('\n=== Gap 4: Non-composited CSS animations ===\n');

// 4a. @keyframes animating "top" → non-composited-animation warning
{
  const css = `
@keyframes slideDown {
  from { top: -100px; }
  to { top: 0; }
}
.panel {
  animation: slideDown 0.3s ease;
}
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'test.css', content: css }]);
  const issue = result.issues.find(i => i.type === 'non-composited-animation');
  assert(!!issue, '@keyframes animating "top" is flagged');
  assert(issue?.severity === 'warning', 'non-composited-animation severity is warning');
  assert(issue?.file === 'test.css', 'non-composited-animation has file');
}

// 4b. @keyframes animating "left" → non-composited-animation warning
{
  const css = `
@keyframes moveLeft {
  from { left: 100%; }
  to { left: 0; }
}
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'anim.css', content: css }]);
  const issue = result.issues.find(i => i.type === 'non-composited-animation');
  assert(!!issue, '@keyframes animating "left" is flagged');
}

// 4c. @keyframes animating "width" → non-composited-animation warning
{
  const css = `
@keyframes expand {
  from { width: 0; }
  to { width: 100%; }
}
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'anim.css', content: css }]);
  const issue = result.issues.find(i => i.type === 'non-composited-animation');
  assert(!!issue, '@keyframes animating "width" is flagged');
}

// 4d. @keyframes animating "height" → non-composited-animation warning
{
  const css = `
@keyframes grow {
  from { height: 0; }
  to { height: 200px; }
}
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'anim.css', content: css }]);
  const issue = result.issues.find(i => i.type === 'non-composited-animation');
  assert(!!issue, '@keyframes animating "height" is flagged');
}

// 4e. @keyframes animating only "transform" and "opacity" → NOT flagged
{
  const css = `
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'anim.css', content: css }]);
  const issue = result.issues.find(i => i.type === 'non-composited-animation');
  assert(!issue, '@keyframes animating only transform/opacity is NOT flagged');
}

// 4f. Issue includes property name, keyframe name, recommendation
{
  const css = `
@keyframes slideIn {
  from { margin-left: -200px; }
  to { margin-left: 0; }
}
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'slide.css', content: css }]);
  const issue = result.issues.find(i => i.type === 'non-composited-animation');
  assert(!!issue, '@keyframes animating "margin" is flagged');
  assert(typeof issue?.property === 'string', 'non-composited-animation: has property field');
  assert(typeof issue?.keyframeName === 'string', 'non-composited-animation: has keyframeName field');
  assert(typeof issue?.recommendation === 'string', 'non-composited-animation: has recommendation');
}

// 4g. @keyframes animating "padding" → flagged
{
  const css = `
@keyframes paddingPulse {
  0% { padding: 10px; }
  100% { padding: 20px; }
}
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'anim.css', content: css }]);
  const issue = result.issues.find(i => i.type === 'non-composited-animation');
  assert(!!issue, '@keyframes animating "padding" is flagged');
}

// 4h. @keyframes animating "font-size" → flagged
{
  const css = `
@keyframes textGrow {
  from { font-size: 12px; }
  to { font-size: 24px; }
}
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'anim.css', content: css }]);
  const issue = result.issues.find(i => i.type === 'non-composited-animation');
  assert(!!issue, '@keyframes animating "font-size" is flagged');
}

// ---------------------------------------------------------------------------
// Gap 4 — missing-will-change
// ---------------------------------------------------------------------------

console.log('\n=== Gap 4: Missing will-change for transform animations ===\n');

// 4i. transition: transform without will-change → missing-will-change (info)
{
  const css = `
.slide-panel {
  transition: transform 0.3s ease;
}
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'panel.css', content: css }]);
  const issue = result.issues.find(i => i.type === 'missing-will-change');
  assert(!!issue, 'transition: transform without will-change is flagged');
  assert(issue?.severity === 'info', 'missing-will-change severity is info');
}

// 4j. animation: uses transform, no will-change → missing-will-change (info)
{
  const css = `
.loading-spinner {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'spinner.css', content: css }]);
  const issue = result.issues.find(i => i.type === 'missing-will-change');
  assert(!!issue, 'animation with transform and no will-change is flagged');
}

// 4k. transition: transform WITH will-change: transform → NOT flagged
{
  const css = `
.slide-panel {
  transition: transform 0.3s ease;
  will-change: transform;
}
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'panel.css', content: css }]);
  const issue = result.issues.find(i => i.type === 'missing-will-change');
  assert(!issue, 'transition: transform WITH will-change is NOT flagged');
}

// 4l. transition: color (no transform) → no missing-will-change issue
{
  const css = `
.button {
  transition: color 0.2s;
  background: blue;
}
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'btn.css', content: css }]);
  const issue = result.issues.find(i => i.type === 'missing-will-change');
  assert(!issue, 'transition without transform → no missing-will-change');
}

// 4m. Issue includes recommendation
{
  const css = `
.panel {
  transition: transform 0.4s cubic-bezier(0,0,0.2,1);
}
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'panel.css', content: css }]);
  const issue = result.issues.find(i => i.type === 'missing-will-change');
  assert(typeof issue?.recommendation === 'string' && issue.recommendation.length > 0,
    'missing-will-change: has recommendation');
}

// 4n. animation: transform in shorthand (e.g. "animation: spin 1s") — rule block has transform → flagged if no will-change
{
  const css = `
.spin {
  animation: rotate 0.5s ease;
  transform: rotate(0deg);
}
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'spin.css', content: css }]);
  const issue = result.issues.find(i => i.type === 'missing-will-change');
  assert(!!issue, 'rule with animation + transform and no will-change is flagged');
}

// ---------------------------------------------------------------------------
// Ensure existing checks still work after new code is added
// ---------------------------------------------------------------------------

console.log('\n=== Regression: existing CSS checks still work ===\n');

{
  const css = `
.hero-banner {
  background-image: url('images/hero.jpg');
}
@import url('theme.css');
`;
  const analyzer = new FormCSSAnalyzer();
  const result = analyzer.analyze([{ filename: 'test.css', content: css }]);
  const bgIssue = result.issues.find(i => i.type === 'css-background-image');
  const importIssue = result.issues.find(i => i.type === 'css-import-blocking');
  assert(!!bgIssue, 'Regression: css-background-image still detected');
  assert(!!importIssue, 'Regression: css-import-blocking still detected');
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
