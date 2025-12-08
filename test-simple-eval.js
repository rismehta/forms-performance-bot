#!/usr/bin/env node
/**
 * Test evaluating ESM by removing exports and capturing functions
 */

import { readFileSync } from 'fs';
import nodeCrypto from 'crypto';
import vm from 'vm';

const functionsPath = '/Users/rismehta/forms-engine/blocks/form/functions.js';

console.log('🧪 Testing simple evaluation with export removal...\n');

async function testSimpleEval() {
  try {
    console.log('✓ Reading file...');
    let sourceCode = readFileSync(functionsPath, 'utf-8');
    console.log(`✓ File loaded: ${sourceCode.length} bytes`);
    
    console.log('\n✓ Removing export statements...');
    
    // Extract function names from export block
    const exportMatch = sourceCode.match(/export\s*\{([^}]+)\}/s);
    let exportedNames = [];
    if (exportMatch) {
      exportedNames = exportMatch[1]
        .split(',')
        .map(name => name.trim())
        .filter(name => name && !name.startsWith('//'));
      console.log(`Found ${exportedNames.length} exported names in export block`);
    }
    
    // Remove ALL export statements
    sourceCode = sourceCode
      .replace(/export\s+function\s+/g, 'function ')  // export function -> function
      .replace(/export\s*\{[^}]+\}/gs, '')             // remove export { ... }
      .replace(/export\s+default\s+/g, '');            // export default (if any)
    
    console.log('✓ Setting up sandbox context...');
    
    // Create sandbox with browser globals
    const sandbox = {
      console,
      crypto: nodeCrypto.webcrypto || nodeCrypto,
      window: {
        msCrypto: undefined,
        location: { href: '', protocol: 'https:' },
        navigator: { userAgent: 'Node.js' },
        document: {},
        addEventListener: () => {},
      },
      document: {
        createElement: () => ({}),
        querySelector: () => null,
        querySelectorAll: () => [],
        getElementById: () => null,
        body: {},
        head: {},
      },
    };
    
    // Make crypto available as bare identifier too
    sandbox.crypto = nodeCrypto.webcrypto || nodeCrypto;
    
    console.log('✓ Creating context...');
    const context = vm.createContext(sandbox);
    
    console.log('✓ Running script...');
    vm.runInContext(sourceCode, context, {
      filename: 'functions.js',
      timeout: 10000,
    });
    
    console.log('✓ Script executed successfully!');
    
    // Collect functions from the context
    const functions = {};
    let foundCount = 0;
    
    for (const name of exportedNames) {
      if (typeof context[name] === 'function') {
        functions[name] = context[name];
        foundCount++;
      }
    }
    
    console.log(`\n✅ SUCCESS! Found ${foundCount} / ${exportedNames.length} exported functions`);
    console.log('First 10 functions:');
    Object.keys(functions).slice(0, 10).forEach(fn => console.log(`  - ${fn}()`));
    
  } catch (error) {
    console.error('\n❌ FAILED!');
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    process.exit(1);
  }
}

testSimpleEval();

