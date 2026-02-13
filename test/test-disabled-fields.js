#!/usr/bin/env node

/**
 * Test cases for DisabledFieldsAnalyzer
 *
 * Tests detection of disabled fields from:
 * - Form JSON (enabled: false)
 * - Rules (fd:rules / setProperty with enabled: false)
 * - Events (dispatchEvent with enabled: true/false)
 * - JavaScript (setProperty, direct .enabled assignment)
 */

import { DisabledFieldsAnalyzer } from '../src/analyzers/disabled-fields-analyzer.js';

// Form JSON with enabled: false (AEM Adaptive Form structure)
const FORM_JSON_WITH_DISABLED = {
  fieldType: 'form',
  name: 'testForm',
  ':items': {
    root: {
      fieldType: 'panel',
      name: 'root',
      ':items': {
        disabledInJson: {
          fieldType: 'text-input',
          name: 'disabledInJson',
          enabled: false,
          label: { value: 'Disabled in JSON' },
        },
        enabledField: {
          fieldType: 'text-input',
          name: 'enabledField',
          enabled: true,
          label: { value: 'Enabled' },
        },
        noEnabledProp: {
          fieldType: 'number-input',
          name: 'noEnabledProp',
          label: { value: 'No enabled prop (default enabled)' },
        },
        disabledInProperties: {
          fieldType: 'text-input',
          name: 'disabledInProperties',
          properties: { enabled: false },
          label: { value: 'Disabled via properties' },
        },
      },
    },
  },
};

const FORM_JSON_NO_DISABLED = {
  fieldType: 'form',
  name: 'testForm',
  ':items': {
    root: {
      fieldType: 'panel',
      name: 'root',
      ':items': {
        field1: {
          fieldType: 'text-input',
          name: 'field1',
          label: { value: 'Field 1' },
        },
      },
    },
  },
};

// JS that sets enabled via setProperty or direct assignment
const JS_SET_PROPERTY_DISABLED = {
  filename: 'blocks/form/form.js',
  content: `
    globals.functions.setProperty(globals.form.panel.myField, { enabled: false });
    globals.functions.setProperty(globals.form?.panel?.otherField, { enabled: true });
  `,
};

const JS_DIRECT_ENABLED = {
  filename: 'blocks/form/toggle.js',
  content: `
    globals.form.submitButton.enabled = false;
    globals.form?.panel?.nextButton.enabled = true;
  `,
};

const JS_NO_ENABLED = {
  filename: 'blocks/form/utils.js',
  content: `
    function doSomething() {
      return globals.form.field1.value;
    }
  `,
};

function runTests() {
  const analyzer = new DisabledFieldsAnalyzer();
  let passed = 0;
  let failed = 0;

  console.log('\n=== DisabledFieldsAnalyzer Test Suite ===\n');

  // --- 1. Form JSON: disabled in JSON ---
  console.log('--- 1. Form JSON with enabled: false ---\n');
  const resultWithDisabled = analyzer.analyze(FORM_JSON_WITH_DISABLED, []);
  const totalDisabled = resultWithDisabled.totalDisabledFields ?? resultWithDisabled.disabledFields?.length ?? 0;

  if (totalDisabled >= 2) {
    const names = (resultWithDisabled.disabledFields || []).map((f) => f.name);
    if (names.includes('disabledInJson') && names.includes('disabledInProperties')) {
      console.log(`✓ PASS: Found disabled fields in JSON (total: ${totalDisabled})`);
      console.log(`  Fields: ${names.join(', ')}`);
      passed++;
    } else {
      console.log(`✗ FAIL: Expected disabledInJson and disabledInProperties, got: ${names.join(', ')}`);
      failed++;
    }
  } else {
    console.log(`✗ FAIL: Expected at least 2 disabled fields, got totalDisabledFields=${totalDisabled}`);
    failed++;
  }
  console.log('');

  // --- 2. Form JSON: no disabled ---
  console.log('--- 2. Form JSON with no disabled fields ---\n');
  const resultNoDisabled = analyzer.analyze(FORM_JSON_NO_DISABLED, []);
  const totalNoDisabled = resultNoDisabled.totalDisabledFields ?? resultNoDisabled.disabledFields?.length ?? 0;

  if (totalNoDisabled === 0) {
    console.log('✓ PASS: No disabled fields when none in JSON');
    passed++;
  } else {
    console.log(`✗ FAIL: Expected 0 disabled fields, got ${totalNoDisabled}`);
    failed++;
  }
  console.log('');

  // --- 3. JS: setProperty with enabled ---
  console.log('--- 3. JS setProperty with enabled: true/false ---\n');
  const resultJs = analyzer.analyze(FORM_JSON_NO_DISABLED, [JS_SET_PROPERTY_DISABLED]);
  const jsChanges = Object.keys(resultJs.enabledChangesInJS || {}).length;

  if (jsChanges >= 1) {
    console.log(`✓ PASS: JS enabled changes detected (${jsChanges} field refs)`);
    passed++;
  } else {
    console.log(`✗ FAIL: Expected JS enabled changes, got ${jsChanges}`);
    failed++;
  }
  console.log('');

  // --- 4. JS: direct .enabled assignment ---
  console.log('--- 4. JS direct .enabled assignment ---\n');
  const resultDirect = analyzer.analyze(FORM_JSON_NO_DISABLED, [JS_DIRECT_ENABLED]);
  const directChanges = Object.keys(resultDirect.enabledChangesInJS || {}).length;

  if (directChanges >= 1) {
    console.log(`✓ PASS: Direct .enabled changes detected (${directChanges} field refs)`);
    passed++;
  } else {
    console.log(`✗ FAIL: Expected direct .enabled changes, got ${directChanges}`);
    failed++;
  }
  console.log('');

  // --- 5. analyze() result shape ---
  console.log('--- 5. analyze() result shape ---\n');
  const shapeResult = analyzer.analyze(FORM_JSON_WITH_DISABLED, []);
  const hasTotal = typeof shapeResult.totalDisabledFields === 'number';
  const hasArray = Array.isArray(shapeResult.disabledFields);
  const hasEnabledChangesInJS = typeof shapeResult.enabledChangesInJS === 'object';
  const hasEnabledChangesInEvents = typeof shapeResult.enabledChangesInEvents === 'object';

  if (hasTotal && hasArray && hasEnabledChangesInJS && hasEnabledChangesInEvents) {
    console.log('✓ PASS: Result has totalDisabledFields, disabledFields, enabledChangesInJS, enabledChangesInEvents');
    passed++;
  } else {
    console.log(`✗ FAIL: Result shape missing. total=${hasTotal} array=${hasArray} js=${hasEnabledChangesInJS} events=${hasEnabledChangesInEvents}`);
    failed++;
  }
  console.log('');

  // --- 6. compare() ---
  console.log('--- 6. compare(before, after) ---\n');
  const before = analyzer.analyze(FORM_JSON_NO_DISABLED, []);
  const after = analyzer.analyze(FORM_JSON_WITH_DISABLED, []);
  const compared = analyzer.compare(before, after);

  const hasBeforeAfter = compared.before && compared.after && compared.delta;
  const deltaNum = typeof compared.delta?.disabledFields === 'number';

  if (hasBeforeAfter && deltaNum) {
    console.log(`✓ PASS: compare() returns before, after, delta (delta.disabledFields=${compared.delta.disabledFields})`);
    passed++;
  } else {
    console.log(`✗ FAIL: compare() shape. before=${!!compared.before} after=${!!compared.after} delta=${!!compared.delta} delta.disabledFields=${compared.delta?.disabledFields}`);
    failed++;
  }
  console.log('');

  // --- 7. null formJson ---
  console.log('--- 7. analyze(null) returns error ---\n');
  const nullResult = analyzer.analyze(null, []);
  if (nullResult && nullResult.error) {
    console.log('✓ PASS: analyze(null) returns { error }');
    passed++;
  } else {
    console.log('✗ FAIL: analyze(null) should return { error }');
    failed++;
  }
  console.log('');

  // Summary
  console.log('=== Test Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);

  if (failed > 0) {
    console.log('\n⚠️  Some tests failed!');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
  }
}

runTests();
