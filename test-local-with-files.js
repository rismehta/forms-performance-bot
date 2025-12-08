#!/usr/bin/env node

/**
 * Enhanced local test that loads JS/CSS from local directories
 * Usage:
 *   node test-local-with-files.js \
 *     --before <url> \
 *     --after <url> \
 *     --js-dir <path-to-js-directory> \
 *     --css-dir <path-to-css-directory>
 */

import { TestRunner } from './test/test-runner.js';
import { Command } from 'commander';
import { readdir, readFile } from 'fs/promises';
import { join, extname } from 'path';

const program = new Command();

program
  .name('performance-bot-test-with-files')
  .description('Test Performance Bot with local JS/CSS files')
  .requiredOption('-b, --before <url>', 'Before URL')
  .requiredOption('-a, --after <url>', 'After URL')
  .option('--js-dir <path>', 'Path to directory containing JavaScript files')
  .option('--css-dir <path>', 'Path to directory containing CSS files')
  .parse();

const options = program.opts();

/**
 * Recursively load all JS files from a directory
 */
async function loadJSFiles(dirPath) {
  const files = [];
  
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        // Skip common directories
        if (['node_modules', 'test', '__tests__', 'dist', 'build'].includes(entry.name)) {
          continue;
        }
        files.push(...await loadJSFiles(fullPath));
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (ext === '.js' || ext === '.mjs') {
          const content = await readFile(fullPath, 'utf-8');
          files.push({
            filename: fullPath,
            content
          });
        }
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not read directory ${dirPath}: ${error.message}`);
  }
  
  return files;
}

/**
 * Recursively load all CSS files from a directory
 */
async function loadCSSFiles(dirPath) {
  const files = [];
  
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        if (['node_modules', 'test', '__tests__', 'dist', 'build'].includes(entry.name)) {
          continue;
        }
        files.push(...await loadCSSFiles(fullPath));
      } else if (entry.isFile() && extname(entry.name) === '.css') {
        const content = await readFile(fullPath, 'utf-8');
        files.push({
          filename: fullPath,
          content
        });
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not read directory ${dirPath}: ${error.message}`);
  }
  
  return files;
}

async function main() {
  console.log('🚀 Performance Bot Test Runner (with local files)\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  const runner = new TestRunner();

  try {
    // Load JS files if directory provided
    let jsFiles = [];
    if (options.jsDir) {
      console.log(`📂 Loading JavaScript files from: ${options.jsDir}`);
      jsFiles = await loadJSFiles(options.jsDir);
      console.log(`✅ Loaded ${jsFiles.length} JavaScript files\n`);
    } else {
      console.log('⚠️  No --js-dir provided. Hidden field and custom function analysis will be limited.\n');
    }

    // Load CSS files if directory provided
    let cssFiles = [];
    if (options.cssDir) {
      console.log(`📂 Loading CSS files from: ${options.cssDir}`);
      cssFiles = await loadCSSFiles(options.cssDir);
      console.log(`✅ Loaded ${cssFiles.length} CSS files\n`);
    } else {
      console.log('⚠️  No --css-dir provided. CSS analysis will be skipped.\n');
    }

    // Run test with loaded files
    await runner.runLiveURLTest(options.before, options.after, {
      jsFiles,
      cssFiles
    });

    console.log('✅ Test completed successfully!');
    console.log('');
    console.log('📄 Output saved to: test/output/pr-comment.md');
    console.log('');

  } catch (error) {
    console.error('❌ Test failed:');
    console.error(error);
    process.exit(1);
  }
}

main();

