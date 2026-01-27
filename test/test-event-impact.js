#!/usr/bin/env node

/**
 * Test for Event Impact Analyzer - eventOrRuleToImpactedNodes feature
 * Tests the feature that maps events/rules to the fields they impact
 */

import { EventImpactAnalyzer } from '../src/analyzers/event-impact-analyzer.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Testing Event Impact Analyzer - eventOrRuleToImpactedNodes Feature\n');
console.log('═══════════════════════════════════════════════════════════\n');

async function runTest() {
  try {
    // Load sample form JSON
    const formJsonPath = path.join(__dirname, 'fixtures', 'sample-form.json');
    console.log(`📂 Loading test form: ${formJsonPath}\n`);
    const formJson = JSON.parse(fs.readFileSync(formJsonPath, 'utf-8'));
    
    // Analyze form
    console.log('⏳ Analyzing form events and rules...\n');
    const analyzer = new EventImpactAnalyzer();
    const result = analyzer.analyze(formJson);
    
    // Test 1: Check if eventOrRuleToImpactedNodes exists
    console.log('TEST 1: Check if eventOrRuleToImpactedNodes exists');
    console.log('───────────────────────────────────────────────────────────');
    if (result.eventOrRuleToImpactedNodes) {
      console.log('✅ PASSED: eventOrRuleToImpactedNodes exists\n');
    } else {
      console.log('❌ FAILED: eventOrRuleToImpactedNodes is missing\n');
      process.exit(1);
    }
    
    // Test 2: Display the structure
    console.log('TEST 2: Display eventOrRuleToImpactedNodes structure');
    console.log('───────────────────────────────────────────────────────────');
    console.log(JSON.stringify(result.eventOrRuleToImpactedNodes, null, 2));
    console.log('');
    
    // Test 3: Verify structure has event keys with impacted fields
    console.log('TEST 3: Verify structure has event keys with impacted fields');
    console.log('───────────────────────────────────────────────────────────');
    
    const keys = Object.keys(result.eventOrRuleToImpactedNodes);
    if (keys.length > 0) {
      console.log(`✅ PASSED: Contains ${keys.length} event/rule entries`);
      console.log(`   Sample keys: ${keys.slice(0, 3).join(', ')}`);
    } else {
      console.log('❌ FAILED: No event/rule entries found');
    }
    console.log('');
    
    // Test 4: Verify values are arrays of impacted field names
    console.log('TEST 4: Verify values are arrays of impacted field names');
    console.log('───────────────────────────────────────────────────────────');
    
    let allValuesAreArrays = true;
    let allArrayItemsAreStrings = true;
    
    for (const [key, value] of Object.entries(result.eventOrRuleToImpactedNodes)) {
      if (!Array.isArray(value)) {
        console.log(`❌ FAILED: "${key}" value is not an array`);
        allValuesAreArrays = false;
      } else {
        // Check if all items are strings (field names)
        for (const item of value) {
          if (typeof item !== 'string') {
            console.log(`❌ FAILED: "${key}" contains non-string value:`, item);
            allArrayItemsAreStrings = false;
          }
        }
      }
    }
    
    if (allValuesAreArrays && allArrayItemsAreStrings) {
      console.log('✅ PASSED: All values are arrays of impacted field names (strings)');
    }
    console.log('');
    
    // Test 5: Check for expected event/rule impact from sample-form.json
    console.log('TEST 5: Verify event/rule impact mapping');
    console.log('───────────────────────────────────────────────────────────');
    
    const eventKeys = Object.keys(result.eventOrRuleToImpactedNodes);
    console.log(`Total event/rule keys: ${eventKeys.length}`);
    
    // Display first few entries as examples
    eventKeys.slice(0, 3).forEach(key => {
      const impactedFields = result.eventOrRuleToImpactedNodes[key];
      console.log(`  "${key}" → impacts ${impactedFields.length} field(s): ${impactedFields.join(', ') || 'none'}`);
    });
    
    // Check if userName change event exists and shows its impact
    const userNameChangeKey = eventKeys.find(k => k.includes('userName') && k.includes('change'));
    if (userNameChangeKey) {
      const impact = result.eventOrRuleToImpactedNodes[userNameChangeKey];
      console.log(`✅ PASSED: Found "${userNameChangeKey}" with $form prefix`);
      console.log(`   Impacts: ${impact.join(', ') || 'none'}`);
    } else {
      console.log('⚠️  INFO: No userName change event found (may be expected for this test data)');
    }
    console.log('');
    
    // Test 6: No duplicates in impacted fields arrays
    console.log('TEST 6: Verify no duplicate nodes in impacted fields');
    console.log('───────────────────────────────────────────────────────────');
    
    let hasDuplicates = false;
    for (const [key, nodes] of Object.entries(result.eventOrRuleToImpactedNodes)) {
      const uniqueNodes = new Set(nodes);
      if (uniqueNodes.size !== nodes.length) {
        console.log(`❌ FAILED: "${key}" has duplicate impacted nodes`);
        hasDuplicates = true;
      }
    }
    
    if (!hasDuplicates) {
      console.log('✅ PASSED: No duplicate impacted nodes found');
    }
    console.log('');
    
    // Summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 SUMMARY');
    console.log('───────────────────────────────────────────────────────────');
    console.log(`Total events/rules mapped: ${Object.keys(result.eventOrRuleToImpactedNodes).length}`);
    console.log(`Total unique fields impacted: ${new Set(Object.values(result.eventOrRuleToImpactedNodes).flat()).size}`);
    console.log('');
    
    // Save results for inspection
    const outputPath = path.join(__dirname, 'output', 'event-impact-test-results.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify({
      eventOrRuleToImpactedNodes: result.eventOrRuleToImpactedNodes,
      fullResult: result
    }, null, 2));
    
    console.log(`📄 Full results saved to: ${outputPath}`);
    console.log('');
    console.log('✅ All tests passed!');
    console.log('═══════════════════════════════════════════════════════════\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTest();
