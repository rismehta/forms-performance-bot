/**
 * Test cases for RuntimeCLSAnalyzer
 * 
 * Tests the detection of dynamic CSS/style/class manipulation
 * during form load vs. after form load (event handlers).
 */

import { RuntimeCLSAnalyzer } from '../src/analyzers/runtime-cls-analyzer.js';

// Test file contents that should TRIGGER issues (during form load)
const SHOULD_FLAG = {
  // 1. loadCSS in decorateForm function
  decorateFormWithLoadCSS: {
    filename: 'blocks/form/decorateForm.js',
    content: `
import { loadCSS } from '../../scripts/aem.js';

export default function decorateForm(form, formDef) {
  const { journeyName } = formDef?.properties || {};
  form?.classList.add(journeyName);
  
  // This should be flagged - loadCSS during form initialization
  loadCSS(\`\${window.hlx.codeBasePath}/styles/custom.css\`);
}
`,
    expectedIssues: [
      { type: 'dynamic-css-loading', severity: 'error' }
    ]
  },

  // 2. Dynamic style element creation in decorate function
  createStyleInDecorate: {
    filename: 'blocks/form/form.js',
    content: `
export function decorate(block) {
  // This should be flagged - creating style element during decoration
  const style = document.createElement('style');
  style.textContent = '.custom { color: red; }';
  document.head.appendChild(style);
}
`,
    expectedIssues: [
      { type: 'dynamic-style-injection', severity: 'error' }
    ]
  },

  // 3. Dynamic link element creation in init function
  createLinkInInit: {
    filename: 'blocks/form/custom-component.js',
    content: `
function init(container) {
  // This should be flagged - creating link element during init
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/styles/custom.css';
  document.head.appendChild(link);
}
`,
    expectedIssues: [
      { type: 'dynamic-style-injection', severity: 'error' }
    ]
  },

  // 4. Dynamic class manipulation inside subscribe callback (not direct body of decorate)
  classListInSubscribeCallback: {
    filename: 'blocks/form/consent-popup.js',
    content: `
import { subscribe } from './subscribe.js';

export default function decorate(element, fd, container, formId) {
  element.classList.add('consent-popup-wrapper');
  subscribe(element, formId, (_element, model) => {
    if (!model) return;
    const checkbox = model.items?.find((item) => item.fieldType === 'checkbox');
    const modal = model.items?.find((item) => item[':type'] === 'modal');
    const button = modal?.items?.find((item) => item.fieldType === 'button');
    if (!checkbox || !modal || !button) return;
    const checkboxElement = element.querySelector(\`input[id="\${checkbox?.id}"]\`);
    checkboxElement.classList.add('consent-checkbox-highlight');
    button.style.display = 'none';
  });
}
`,
    expectedIssues: [
      { type: 'dynamic-class-manipulation', severity: 'warning' },
      { type: 'direct-style-manipulation', severity: 'warning' }
    ]
  },

  // 5. Direct style manipulation inside subscribe callback
  styleInSubscribeCallback: {
    filename: 'blocks/form/component.js',
    content: `
import { subscribe } from './subscribe.js';

export function decorate(el, fd, container, formId) {
  el.classList.add('wrapper');
  subscribe(el, formId, (_, model) => {
    if (model?.properties?.visible) {
      el.style.display = 'block';
      el.style.visibility = 'visible';
    }
  });
}
`,
    expectedIssues: [
      { type: 'direct-style-manipulation', severity: 'warning' },
      { type: 'direct-style-manipulation', severity: 'warning' }
    ]
  },

  // 6. Top-level code in decorateForm.js file
  topLevelInDecorateFormFile: {
    filename: 'custom/decorateForm.js',
    content: `
import { loadCSS } from '../../scripts/aem.js';

// Top-level code in decorateForm.js - should be flagged
loadCSS('/styles/global.css');

const style = document.createElement('style');
document.head.appendChild(style);
`,
    expectedIssues: [
      { type: 'dynamic-css-loading', severity: 'error' },
      { type: 'dynamic-style-injection', severity: 'error' }
    ]
  },

  // 7. Dynamic CSS import
  dynamicCSSImport: {
    filename: 'blocks/form/decorateForm.js',
    content: `
export default async function decorateForm(form) {
  // Dynamic import of CSS - should be flagged
  await import('./styles/custom.css');
}
`,
    expectedIssues: [
      { type: 'dynamic-css-loading', severity: 'error' }
    ]
  },

  // 8. Class/style inside subscribe's REGISTER branch (one-time setup during load) - should FLAG
  classListAndStyleInSubscribeRegisterBranch: {
    filename: 'blocks/form/component.js',
    content: `
import { subscribe } from './subscribe.js';

export function decorate(el, fd, container, formId) {
  subscribe(el, formId, (element, model, eventType, payload) => {
    if (eventType === 'register') {
      element.classList.add('one-time-setup');
      element.style.display = 'block';
    } else if (eventType === 'change') {
      payload?.changes?.forEach(() => {});
    }
  }, { listenChanges: true });
}
`,
    expectedIssues: [
      { type: 'dynamic-class-manipulation', severity: 'warning' },
      { type: 'direct-style-manipulation', severity: 'warning' }
    ]
  },

  // 9. loadCSS still flagged in init (class in direct body is allowed)
  loadCSSInDecorateFormWithClass: {
    filename: 'blocks/form/decorateForm.js',
    content: `
import { loadCSS } from '../../scripts/aem.js';

export default function decorateForm(form) {
  form.classList.add('form-loaded');
  loadCSS('/styles/form.css');
}
`,
    expectedIssues: [
      { type: 'dynamic-css-loading', severity: 'error' }
    ]
  }
};

// Test file contents that should NOT trigger issues (after form load / event handlers)
const SHOULD_NOT_FLAG = {
  // 1. loadCSS inside click handler
  loadCSSInClickHandler: {
    filename: 'blocks/form/interaction.js',
    content: `
function setupInteractions(form) {
  form.addEventListener('click', () => {
    // This should NOT be flagged - inside click handler
    loadCSS('/styles/modal.css');
  });
}
`,
    expectedIssues: []
  },

  // 2. Class manipulation inside event handler
  classListInEventHandler: {
    filename: 'blocks/form/toggle.js',
    content: `
function setupToggle(button, panel) {
  button.addEventListener('click', function() {
    // This should NOT be flagged - inside click handler
    panel.classList.toggle('expanded');
    panel.classList.add('animated');
  });
}
`,
    expectedIssues: []
  },

  // 3. Style manipulation in change handler
  styleInChangeHandler: {
    filename: 'blocks/form/validation.js',
    content: `
function setupValidation(input) {
  input.addEventListener('change', (e) => {
    // This should NOT be flagged - inside change handler
    e.target.style.borderColor = 'green';
  });
  
  input.addEventListener('blur', () => {
    // This should NOT be flagged - inside blur handler
    input.style.backgroundColor = '#f0f0f0';
  });
}
`,
    expectedIssues: []
  },

  // 4. Class/style inside fieldModel.subscribe callback (runs on model change, after load) - should NOT flag
  classListAndStyleInModelSubscribeCallback: {
    filename: 'blocks/form/components/card-choice/card-choice.js',
    content: `
import { subscribe } from '../../rules/index.js';

export function decorate(element, fd, container, formId) {
  subscribe(element, formId, (fieldDiv, fieldModel) => {
    fieldModel.subscribe((e) => {
      const { payload } = e;
      payload?.changes?.forEach((change) => {
        const { propertyName, currentValue } = change;
        if (propertyName === 'enum') {
          fieldDiv.classList.add('updated');
          fieldDiv.style.visibility = 'visible';
        }
      });
    });
  });
}
`,
    expectedIssues: []
  },

  // 5. Class/style inside subscribe's CHANGE branch (runs after form load) - should NOT flag
  classListAndStyleInSubscribeChangeBranch: {
    filename: 'blocks/form/component.js',
    content: `
import { subscribe } from './subscribe.js';

export function decorate(el, fd, container, formId) {
  subscribe(el, formId, (element, model, eventType, payload) => {
    if (eventType === 'register') {
      // one-time setup only, no class/style here
    } else if (eventType === 'change') {
      element.classList.add('updated');
      element.style.visibility = 'visible';
    }
  }, { listenChanges: true });
}
`,
    expectedIssues: []
  },

  // 5b. CHANGE branch with generic variable name (a === 'change') - should NOT flag
  classListInSubscribeChangeBranchGenericVar: {
    filename: 'blocks/form/component.js',
    content: `
import { subscribe } from './subscribe.js';

export function decorate(el, fd, container, formId) {
  subscribe(el, formId, (element, model, a, payload) => {
    if (a === 'register') {
      // no class here
    } else if (a === 'change') {
      element.classList.add('updated');
    }
  }, { listenChanges: true });
}
`,
    expectedIssues: []
  },

  // 5c. a.subscribe (any name, not just fieldModel) - should NOT flag
  classListInGenericModelSubscribe: {
    filename: 'blocks/form/component.js',
    content: `
import { subscribe } from './subscribe.js';

export function decorate(el, fd, container, formId) {
  subscribe(el, formId, (fieldDiv, a) => {
    a.subscribe((e) => {
      fieldDiv.classList.add('updated');
    });
  });
}
`,
    expectedIssues: []
  },

  // 6. Negative test: class/style in direct body of decorate must NOT be flagged.
  //    If the analyzer wrongly flagged this, we would get 1+ issues and this test would fail.
  negativeTest_directBodyNotFlagged: {
    filename: 'blocks/form/negative-test-decorate.js',
    content: `
export default function decorate(element) {
  element.classList.add('wrapper');
  element.style.display = 'block';
}
`,
    expectedIssues: []
  },

  // 7. Class/style in direct body of decorate (one-time setup) - allowed
  classListInDirectBodyOfDecorate: {
    filename: 'blocks/form/consent-popup.js',
    content: `
export default function decorate(element, fd, container, formId) {
  element.classList.add('consent-popup-wrapper');
  const wrapper = document.createElement('div');
  wrapper.className = 'inner';
  element.style.position = 'relative';
  element.appendChild(wrapper);
}
`,
    expectedIssues: []
  },

  // 8. Class/style in direct body of decorateForm - allowed
  classListInDirectBodyOfDecorateForm: {
    filename: 'blocks/form/decorateForm.js',
    content: `
export default function decorateForm(form, formDef) {
  form.classList.add('large-form-layout');
  form.classList.remove('compact-mode');
  form.style.display = 'flex';
}
`,
    expectedIssues: []
  },

  // 9. Style in direct body of setup - allowed
  directStyleInDirectBodyOfSetup: {
    filename: 'blocks/form/layout.js',
    content: `
function setup(element) {
  element.style.display = 'block';
  element.style.width = '100%';
}
`,
    expectedIssues: []
  },

  // 10. State classes should be allowed
  stateClassesInDecorate: {
    filename: 'blocks/form/decorateForm.js',
    content: `
export default function decorateForm(form, formDef) {
  // State classes should NOT be flagged (allowlisted)
  form.classList.add('valid');
  form.classList.add('focused');
  form.classList.remove('error');
  form.classList.toggle('loading');
}
`,
    expectedIssues: []
  },

  // 11. Class with state suffix should be allowed
  stateClassSuffix: {
    filename: 'blocks/form/decorateForm.js',
    content: `
export default function decorateForm(form, formDef) {
  // Classes containing state names should NOT be flagged
  form.classList.add('field-valid');
  form.classList.add('input-error');
  form.classList.add('is-loading');
}
`,
    expectedIssues: []
  },

  // 12. onclick property assignment
  onclickHandler: {
    filename: 'blocks/form/buttons.js',
    content: `
function setupButtons(container) {
  const button = container.querySelector('button');
  button.onclick = function() {
    // This should NOT be flagged - inside onclick handler
    container.classList.add('submitted');
    container.style.opacity = '0.5';
  };
}
`,
    expectedIssues: []
  },

  // 13. Submit handler
  submitHandler: {
    filename: 'blocks/form/submit.js',
    content: `
function setupSubmit(form) {
  form.addEventListener('submit', async (e) => {
    // This should NOT be flagged - inside submit handler
    form.classList.add('submitting');
    const loader = document.createElement('style');
    document.head.appendChild(loader);
  });
}
`,
    expectedIssues: []
  },

  // 14. Non-layout style properties in decorateForm
  nonLayoutStyles: {
    filename: 'blocks/form/decorateForm.js',
    content: `
export default function decorateForm(form) {
  // Non-layout affecting styles - should NOT be flagged
  form.style.color = 'blue';
  form.style.cursor = 'pointer';
}
`,
    expectedIssues: []
  },

  // 15. Regular function not related to initialization
  regularFunction: {
    filename: 'blocks/form/utils.js',
    content: `
// Regular function (not initialization) - should NOT be flagged
function handleUserAction(element) {
  element.classList.add('clicked');
  element.style.backgroundColor = 'blue';
}

// Not flagged because function name doesn't indicate initialization
function processData(data) {
  const element = document.getElementById('output');
  element.style.display = 'block';
}
`,
    expectedIssues: []
  },

  // 16. Focus/blur handlers
  focusBlurHandlers: {
    filename: 'blocks/form/focus.js',
    content: `
function setupFocus(input) {
  input.addEventListener('focus', () => {
    input.classList.add('ring');
    input.style.outline = '2px solid blue';
  });
  
  input.addEventListener('focusin', () => {
    input.classList.add('focused-within');
  });
}
`,
    expectedIssues: []
  }
};

// Mixed test case - some should flag, some shouldn't
const MIXED_CASES = {
  // decorateForm: loadCSS flagged; class/style in direct body not flagged; event handler not flagged
  mixedContext: {
    filename: 'blocks/form/decorateForm.js',
    content: `
import { loadCSS } from '../../scripts/aem.js';

export default function decorateForm(form, formDef) {
  loadCSS('/styles/form.css');
  form.classList.add('custom-layout');
  form.addEventListener('click', () => {
    form.classList.add('clicked');
    loadCSS('/styles/modal.css');
  });
  form.style.display = 'flex';
}
`,
    expectedIssueCount: 1, // only loadCSS (class/style in direct body allowed)
    shouldFlagTypes: ['dynamic-css-loading']
  }
};

// Run tests
function runTests() {
  const analyzer = new RuntimeCLSAnalyzer();
  let passed = 0;
  let failed = 0;

  console.log('\\n=== RuntimeCLSAnalyzer Test Suite ===\\n');

  // Test SHOULD_FLAG cases
  console.log('--- Testing cases that SHOULD flag issues ---\\n');
  for (const [testName, testCase] of Object.entries(SHOULD_FLAG)) {
    const result = analyzer.analyze([testCase]);
    const issueCount = result.issues.length;
    const expectedCount = testCase.expectedIssues.length;
    
    if (issueCount >= expectedCount) {
      // Verify issue types match
      const foundTypes = result.issues.map(i => i.type);
      const expectedTypes = testCase.expectedIssues.map(i => i.type);
      const allTypesFound = expectedTypes.every(t => foundTypes.includes(t));
      
      if (allTypesFound) {
        console.log(`✓ PASS: ${testName}`);
        console.log(`  Found ${issueCount} issue(s): ${foundTypes.join(', ')}`);
        passed++;
      } else {
        console.log(`✗ FAIL: ${testName}`);
        console.log(`  Expected types: ${expectedTypes.join(', ')}`);
        console.log(`  Found types: ${foundTypes.join(', ')}`);
        failed++;
      }
    } else {
      console.log(`✗ FAIL: ${testName}`);
      console.log(`  Expected at least ${expectedCount} issue(s), found ${issueCount}`);
      if (result.issues.length > 0) {
        console.log(`  Issues found: ${result.issues.map(i => i.type).join(', ')}`);
      }
      failed++;
    }
    console.log('');
  }

  // Test SHOULD_NOT_FLAG cases
  console.log('\\n--- Testing cases that should NOT flag issues ---\\n');
  for (const [testName, testCase] of Object.entries(SHOULD_NOT_FLAG)) {
    const result = analyzer.analyze([testCase]);
    const issueCount = result.issues.length;
    
    if (issueCount === 0) {
      console.log(`✓ PASS: ${testName}`);
      console.log(`  Correctly found 0 issues (code runs after form load or uses allowed patterns)`);
      passed++;
    } else {
      console.log(`✗ FAIL: ${testName}`);
      console.log(`  Expected 0 issues, found ${issueCount}:`);
      result.issues.forEach(issue => {
        console.log(`    - ${issue.type} at line ${issue.line}: ${issue.message}`);
      });
      failed++;
    }
    console.log('');
  }

  // Test MIXED_CASES
  console.log('\\n--- Testing mixed context cases ---\\n');
  for (const [testName, testCase] of Object.entries(MIXED_CASES)) {
    const result = analyzer.analyze([testCase]);
    const issueCount = result.issues.length;
    const foundTypes = result.issues.map(i => i.type);
    
    // Check if we found the expected number and types
    const hasExpectedCount = issueCount >= testCase.expectedIssueCount;
    const hasExpectedTypes = testCase.shouldFlagTypes.every(t => foundTypes.includes(t));
    
    if (hasExpectedCount && hasExpectedTypes) {
      console.log(`✓ PASS: ${testName}`);
      console.log(`  Found ${issueCount} issue(s) (expected at least ${testCase.expectedIssueCount})`);
      console.log(`  Types: ${foundTypes.join(', ')}`);
      passed++;
    } else {
      console.log(`✗ FAIL: ${testName}`);
      console.log(`  Expected at least ${testCase.expectedIssueCount} issues with types: ${testCase.shouldFlagTypes.join(', ')}`);
      console.log(`  Found ${issueCount} issues with types: ${foundTypes.join(', ')}`);
      failed++;
    }
    console.log('');
  }

  // Summary
  console.log('\\n=== Test Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);
  
  if (failed > 0) {
    console.log('\\n⚠️  Some tests failed!');
    process.exit(1);
  } else {
    console.log('\\n✅ All tests passed!');
  }
}

// Run if called directly
runTests();
