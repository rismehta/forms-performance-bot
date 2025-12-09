#!/usr/bin/env node

/**
 * Test AEM Authoring format (`:items` as object) cycle detection
 * Tests if RulePerformanceAnalyzer correctly detects cycles in authoring-format forms
 * 
 * Expected cycle: emailinput → text → emailinput
 * - emailinput depends on text (via text1765267502027.$value)
 * - text depends on emailinput (via emailinput1765267476175.$value)
 */

import { RulePerformanceAnalyzer } from '../src/analyzers/rule-performance-analyzer.js';
import { loadConfig } from '../src/utils/config-loader.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Testing AEM Authoring Format Cycle Detection\n');
console.log('═══════════════════════════════════════════════════════════\n');

async function runTest() {
  try {
    // Load authoring format form with circular dependencies
    const authoringFormPath = path.join(__dirname, 'fixtures', 'cycle-test-authoring.json');
    console.log('📂 Loading authoring form fixture:', authoringFormPath);
    const authoringForm = JSON.parse(fs.readFileSync(authoringFormPath, 'utf-8'));
    
    console.log('\n📋 Form structure:');
    console.log('  Format: AEM Authoring (`:items` as object)');
    console.log('  Fields: emailinput, telephoneinput, text');
    console.log('  Expected cycle: emailinput → text → emailinput\n');
    
    console.log('  Rules:');
    console.log('    emailinput.rules.value:', authoringForm[':items'].emailinput.rules.value);
    console.log('    text.rules.value:', authoringForm[':items'].text.rules.value);
    console.log('    telephoneinput: (no rules - just referenced)\n');
    
    // Load config
    const config = await loadConfig();
    
    // Analyze with RulePerformanceAnalyzer
    console.log('🔍 Running RulePerformanceAnalyzer...\n');
    const analyzer = new RulePerformanceAnalyzer(config);
    const result = await analyzer.analyze(authoringForm);
    
    // Check results
    console.log('\n📊 Analysis Results:');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Total Rules:', result.totalRules);
    console.log('Fields with Rules:', result.fieldsWithRules);
    console.log('Circular Dependencies Found:', result.cycles);
    console.log('Cycle Details:', JSON.stringify(result.cycleDetails, null, 2));
    
    if (result.skipped) {
      console.log('\n⚠️  Analysis was skipped!');
      console.log('Reason:', result.skipReason);
      process.exit(1);
    }
    
    if (result.cycles === 0) {
      console.log('\n❌ FAIL: Expected 1 cycle but found 0!');
      console.log('\nDEBUG INFO:');
      console.log('Dependencies:', JSON.stringify(result.dependencies, null, 2));
      console.log('\nPossible reasons:');
      console.log('- Rules not executing during form initialization');
      console.log('- Field name resolution failing');
      console.log('- Dependency tracking not working');
      process.exit(1);
    }
    
    if (result.cycles === 1 && result.cycleDetails.length === 1) {
      const cycle = result.cycleDetails[0];
      console.log('\n✅ SUCCESS: Detected expected cycle!');
      console.log('Cycle path:', cycle.path.join(' → '));
      console.log('Fields involved:', cycle.fields.join(', '));
      console.log('Cycle key:', cycle.key);
      
      // Verify it's the right cycle
      const hasEmailInput = cycle.fields.includes('emailinput1765267476175');
      const hasText = cycle.fields.includes('text1765267502027');
      
      if (hasEmailInput && hasText) {
        console.log('\n✅ Correct cycle detected: emailinput ↔ text');
      } else {
        console.log('\n⚠️  Cycle detected but wrong fields!');
        console.log('Expected: emailinput1765267476175, text1765267502027');
        console.log('Got:', cycle.fields);
      }
    } else {
      console.log(`\n⚠️  Expected 1 cycle, found ${result.cycles}`);
    }
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ Test complete!\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTest();

