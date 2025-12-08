#!/usr/bin/env node
/**
 * Test script to debug why functions.js import is failing
 * Run: node test-import-functions.js
 */

import nodeCrypto from 'crypto';
import { resolve } from 'path';
import { existsSync } from 'fs';

const functionsPath = '/Users/rismehta/forms-engine/blocks/form/functions.js';

console.log('🧪 Testing functions.js import locally...\n');

async function testImport() {
  try {
    console.log(`📁 File path: ${functionsPath}`);
    console.log(`✓ File exists: ${existsSync(functionsPath)}`);
    
    if (!existsSync(functionsPath)) {
      console.error('❌ File not found!');
      process.exit(1);
    }
    
    console.log('\n📦 Setting up browser globals...');
    
    // Save originals
    const originalWindow = global.window;
    const originalDocument = global.document;
    const originalCrypto = global.crypto;
    
    // Make crypto available as a bare identifier
    if (!global.crypto) {
      try {
        Object.defineProperty(global, 'crypto', {
          value: nodeCrypto.webcrypto || nodeCrypto,
          writable: true,
          configurable: true
        });
        console.log('✓ Set global.crypto');
      } catch (e) {
        console.log(`⚠️  Could not set global.crypto: ${e.message}`);
      }
    }
    
    // Mock window
    global.window = {
      msCrypto: undefined,
      location: { href: '', protocol: 'https:' },
      navigator: { userAgent: 'Node.js' },
      document: {},
      crypto: global.crypto,
      addEventListener: () => {},
      removeEventListener: () => {},
      getComputedStyle: () => ({}),
      matchMedia: () => ({ matches: false }),
    };
    console.log('✓ Set global.window');
    
    // Mock document
    global.document = {
      createElement: () => ({}),
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      body: {},
      head: {},
      addEventListener: () => {},
    };
    console.log('✓ Set global.document');
    
    console.log('\n📥 Attempting dynamic import...');
    const fileUrl = `file://${functionsPath}`;
    console.log(`   URL: ${fileUrl}`);
    
    try {
      const module = await import(fileUrl);
      console.log('\n✅ SUCCESS! Module imported');
      
      // Count exported functions
      const functions = Object.entries(module).filter(([name, value]) => typeof value === 'function');
      console.log(`\n📊 Found ${functions.length} exported function(s):`);
      functions.slice(0, 10).forEach(([name]) => {
        console.log(`   - ${name}()`);
      });
      if (functions.length > 10) {
        console.log(`   ... and ${functions.length - 10} more`);
      }
      
    } catch (importError) {
      console.error('\n❌ Import failed!');
      console.error(`   Error: ${importError.message}`);
      console.error(`   Stack: ${importError.stack}`);
      
      // Try to get more details
      if (importError.code) {
        console.error(`   Code: ${importError.code}`);
      }
    } finally {
      // Cleanup
      console.log('\n🧹 Cleaning up globals...');
      if (originalWindow === undefined) {
        delete global.window;
      } else {
        global.window = originalWindow;
      }
      if (originalDocument === undefined) {
        delete global.document;
      } else {
        global.document = originalDocument;
      }
      if (originalCrypto === undefined) {
        try {
          delete global.crypto;
        } catch (e) {
          // crypto might be read-only
        }
      } else {
        global.crypto = originalCrypto;
      }
    }
    
  } catch (error) {
    console.error('\n❌ Test failed!');
    console.error(error);
    process.exit(1);
  }
}

testImport();

