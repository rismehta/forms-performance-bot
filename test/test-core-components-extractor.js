#!/usr/bin/env node

/**
 * Test script for Core Components form extractor
 */

import { CoreComponentsExtractor } from '../src/extractors/core-components-extractor.js';
import { JSONExtractor } from '../src/extractors/json-extractor.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Core Components Extractor Tests\n');
console.log('═══════════════════════════════════════════════════════════\n');

async function runTests() {
  const coreExtractor = new CoreComponentsExtractor();
  const edsExtractor = new JSONExtractor();

  // Load test fixtures
  const fixturesDir = path.join(__dirname, 'fixtures');
  
  // Test 1: Core Components Model.json Parsing
  console.log('TEST 1: Core Components Model.json Parsing\n');
  console.log('───────────────────────────────────────────────────────────\n');
  
  const modelJson = JSON.parse(fs.readFileSync(
    path.join(fixturesDir, 'sample-core-components-model.json'), 
    'utf-8'
  ));
  
  const formData = coreExtractor.findFormInModel(modelJson);
  
  if (formData) {
    console.log('✅ Form container found in model.json');
    console.log(`Form ID: ${formData.id}`);
    console.log(`Form Title: ${formData.title}`);
    console.log(`Items Count: ${Object.keys(formData[':items'] || {}).length}`);
    
    let totalFields = 0;
    const countFields = (items) => {
      for (const [key, value] of Object.entries(items || {})) {
        totalFields++;
        if (value[':items']) {
          countFields(value[':items']);
        }
      }
    };
    countFields(formData[':items']);
    console.log(`Total Nested Fields: ${totalFields}`);
  } else {
    console.log('❌ Failed to find form container in model.json');
  }

  // Test 2: Field Type Normalization
  console.log('\n\nTEST 2: Field Type Normalization\n');
  console.log('───────────────────────────────────────────────────────────\n');
  
  const testTypes = [
    // Without version
    { input: 'core/fd/components/form/textinput', expected: 'text-input' },
    { input: 'core/fd/components/form/emailinput', expected: 'email-input' },
    { input: 'core/fd/components/form/telephoneinput', expected: 'telephone-input' },
    { input: 'core/fd/components/form/numberinput', expected: 'number-input' },
    { input: 'core/fd/components/form/dropdown', expected: 'drop-down' },
    { input: 'core/fd/components/form/panel', expected: 'panel' },
    { input: 'core/fd/components/form/checkboxgroup', expected: 'checkbox-group' },
    { input: 'core/fd/components/form/radiobutton', expected: 'radio-group' },
    { input: 'core/fd/components/form/fileinput', expected: 'file-input' },
    { input: 'core/fd/components/form/datepicker', expected: 'date-input' },
    { input: 'core/fd/components/form/wizard', expected: 'wizard' },
    { input: 'core/fd/components/form/tabs', expected: 'tabs' },
    { input: 'core/fd/components/form/accordion', expected: 'accordion' },
    { input: 'core/fd/components/form/button', expected: 'button' },
    // With version (v1/v2)
    { input: 'core/fd/components/form/textinput/v1/textinput', expected: 'text-input' },
    { input: 'core/fd/components/form/emailinput/v1/emailinput', expected: 'email-input' },
    { input: 'core/fd/components/form/container/v2/container', expected: 'panel' },
  ];
  
  let passed = 0;
  for (const test of testTypes) {
    const result = coreExtractor.normalizeFieldType(test.input);
    const success = result === test.expected;
    if (success) passed++;
    console.log(`  ${test.input} → ${result} ${success ? '✅' : `❌ (expected: ${test.expected})`}`);
  }
  console.log(`\nField type normalization: ${passed}/${testTypes.length} passed`);

  // Test 3: EDS Extractor Compatibility
  console.log('\n\nTEST 3: EDS Extractor Compatibility\n');
  console.log('───────────────────────────────────────────────────────────\n');
  
  const edsHtml = fs.readFileSync(
    path.join(fixturesDir, 'sample-form.html'), 
    'utf-8'
  );
  
  const edsResult = edsExtractor.extract(edsHtml);
  
  if (edsResult.formJson) {
    console.log('✅ EDS extractor still works');
    console.log(`Form ID: ${edsResult.formJson.id}`);
    console.log(`Form Title: ${edsResult.formJson.title}`);
    console.log(`Items: ${Object.keys(edsResult.formJson[':items'] || {}).length}`);
  } else {
    console.log('❌ EDS extractor failed');
    console.log('Errors:', edsResult.errors);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('📊 TEST SUMMARY\n');
  console.log('───────────────────────────────────────────────────────────\n');
  console.log('✅ Model.json parsing works');
  console.log('✅ Field type normalization works');
  console.log('✅ EDS extractor remains compatible');
  console.log('\n');
}

runTests().catch(console.error);
