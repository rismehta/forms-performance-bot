#!/usr/bin/env node
/**
 * Test vm.SourceTextModule locally
 */

import vm from 'vm';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import nodeCrypto from 'crypto';

const functionsPath = '/Users/rismehta/forms-engine/blocks/form/functions.js';

console.log('🧪 Testing vm.SourceTextModule...\n');

async function testVMModule() {
  try {
    console.log('✓ Reading file...');
    const sourceCode = readFileSync(functionsPath, 'utf-8');
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
    };
    
    console.log('\n✓ Creating SourceTextModule...');
    const module = new vm.SourceTextModule(sourceCode, {
      identifier: pathToFileURL(functionsPath).href,
      context: vm.createContext(global),
    });
    
    console.log('✓ Module created!');
    console.log('✓ Linking...');
    
    await module.link(() => {
      return new vm.SyntheticModule(['default'], function() {
        this.setExport('default', {});
      }, { context: vm.createContext(global) });
    });
    
    console.log('✓ Evaluating...');
    await module.evaluate();
    
    console.log('✓ Module evaluated!');
    
    const namespace = module.namespace;
    const functions = Object.keys(namespace).filter(k => typeof namespace[k] === 'function');
    
    console.log(`\n✅ SUCCESS! Found ${functions.length} exported functions`);
    console.log('First 10 functions:');
    functions.slice(0, 10).forEach(fn => console.log(`  - ${fn}()`));
    
  } catch (error) {
    console.error('\n❌ FAILED!');
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    process.exit(1);
  }
}

testVMModule();

