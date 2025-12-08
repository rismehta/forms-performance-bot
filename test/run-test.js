#!/usr/bin/env node

/**
 * Test runner entry point
 * Usage:
 *   node test/run-test.js
 *   node test/run-test.js --before <url> --after <url>
 */

import { TestRunner } from './test-runner.js';
import { Command } from 'commander';

const program = new Command();

program
  .name('performance-bot-test')
  .description('Test Performance Bot locally with live URLs')
  .version('1.0.0');

program
  .option('-b, --before <url>', 'Before URL (e.g., main branch deployment)')
  .option('-a, --after <url>', 'After URL (e.g., feature branch deployment)')
  .option('--sample', 'Run with sample/default URLs')
  .parse();

const options = program.opts();

async function main() {
  console.log('🚀 Performance Bot Test Runner\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  const runner = new TestRunner();

  try {
    if (options.before && options.after) {
      // Run with provided URLs
      await runner.runLiveURLTest(options.before, options.after);
    } else if (options.sample) {
      // Run with sample data
      await runner.runSampleTest();
    } else {
      // Show usage
      console.log('Usage:');
      console.log('');
      console.log('  Test with your live URLs:');
      console.log('    node test/run-test.js \\');
      console.log('      --before https://main--forms-engine--hdfc-forms.aem.live/ \\');
      console.log('      --after https://branch--forms-engine--hdfc-forms.aem.live/');
      console.log('');
      console.log('  Test with sample URLs:');
      console.log('    node test/run-test.js --sample');
      console.log('');
      process.exit(1);
    }

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

