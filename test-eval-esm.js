#!/usr/bin/env node
/**
 * Test evaluating ESM by transforming exports
 */

import { readFileSync } from 'fs';
import nodeCrypto from 'crypto';

const functionsPath = '/Users/rismehta/forms-engine/blocks/form/functions.js';

console.log('🧪 Testing ESM evaluation with export transformation...\n');

async function testEvalESM() {
  try {
    console.log('✓ Reading file...');
    let sourceCode = readFileSync(functionsPath, 'utf-8');
    console.log(`✓ File loaded: ${sourceCode.length} bytes`);
    
    // Setup globals
    if (!global.crypto) {
      try {
        Object.defineProperty(global, 'crypto', {
          value: nodeCrypto.webcrypto || nodeCrypto,
          writable: true,
          configurable: true
        });
      } catch (e) {
        // ignore
      }
    }
    
    global.window = {
      msCrypto: undefined,
      crypto: global.crypto,
      location: {},
      navigator: {},
      document: {},
    };
    
    global.document = {
      createElement: () => ({}),
      querySelector: () => null,
    };
    
    console.log('\n✓ Transforming exports...');
    
    // Transform ESM exports to object assignments
    // Replace: export function name(...) { ... }
    // With: __exports.name = function name(...) { ... }
    const exportedFunctions = {};
    const transformedCode = sourceCode.replace(
      /export\s+function\s+(\w+)/g,
      'exportedFunctions.$1 = function $1'
    );
    
    console.log('✓ Evaluating code...');
    
    // Create a function scope with our context
    const evalFunc = new Function('exportedFunctions', 'crypto', 'window', 'document', transformedCode);
    evalFunc(exportedFunctions, global.crypto, global.window, global.document);
    
    const functionNames = Object.keys(exportedFunctions);
    console.log(`\n✅ SUCCESS! Found ${functionNames.length} exported functions`);
    console.log('First 10 functions:');
    functionNames.slice(0, 10).forEach(fn => console.log(`  - ${fn}()`));
    
  } catch (error) {
    console.error('\n❌ FAILED!');
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    process.exit(1);
  }
}

testEvalESM();

