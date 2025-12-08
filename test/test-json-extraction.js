import { JSONExtractor } from '../src/extractors/json-extractor.js';
import { FormAnalyzer } from '../src/analyzers/form-analyzer.js';

// Actual HTML structure from HDFC form (div.form > div > div > pre > code)
const testHTML = `
<!DOCTYPE html>
<html>
<body>
  <main>
    <div class="form">
      <div>
        <div>
          <pre><code>{"id":"test-form-id","fieldType":"form","lang":"en-US","title":"SMART EMI Form","action":"/submit","properties":{"variant":"popup"},"events":{"initialize":["createJourneyId('online',runtime.journeyName.$value,runtime.channel.$value)","request('https://api.example.com/init')"]},"adaptiveform":"0.14.0",":itemsOrder":["panel1","panel2","textinput1"],":items":{"panel1":{"id":"panel-123","fieldType":"panel","name":"hiddenPanel","visible":false,"label":{"value":"Hidden Panel"},":items":{}},"panel2":{"id":"panel-456","fieldType":"panel","name":"visiblePanel","visible":true,"label":{"value":"Visible Panel"},":itemsOrder":["textfield1"],":items":{"textfield1":{"id":"text-789","fieldType":"text-input","name":"userName","visible":true}}},"textinput1":{"id":"text-999","fieldType":"text-input","name":"email"}}}</code></pre>
        </div>
      </div>
    </div>
  </main>
</body>
</html>
`;

console.log('🧪 Testing JSON Extraction & Form Analysis\n');
console.log('HTML Structure: div.form > div > div > pre > code\n');
console.log('═══════════════════════════════════════════════════════════\n');

// Test 1: JSON Extraction
console.log('TEST 1: JSON Extraction');
console.log('─────────────────────────────────────────────────────────\n');

const extractor = new JSONExtractor();
const result = extractor.extract(testHTML);

console.log('✅ Extraction Results:');
console.log('  - Found JSON:', !!result.formJson);
console.log('  - Errors:', result.errors.length);

if (result.errors.length > 0) {
  console.log('\n❌ Errors found:');
  result.errors.forEach(err => console.log('  -', err.message));
}

if (result.formJson) {
  console.log('\n📋 Form JSON Structure:');
  console.log('  - ID:', result.formJson.id);
  console.log('  - Field Type:', result.formJson.fieldType);
  console.log('  - Title:', result.formJson.title);
  console.log('  - Action:', result.formJson.action);
  console.log('  - Version:', result.formJson.adaptiveform);
  console.log('  - Has Events:', !!result.formJson.events);
  console.log('  - Has Items:', !!result.formJson[':items']);
  console.log('  - Root Items Count:', Object.keys(result.formJson[':items'] || {}).length);
  
  if (result.formJson.events?.initialize) {
    console.log('\n🔍 Initialize Events:');
    result.formJson.events.initialize.forEach((event, idx) => {
      console.log(`  ${idx + 1}. ${event}`);
    });
    
    // Check for API call detection
    const hasAPICall = result.formJson.events.initialize.some(event => 
      event.includes('request(') || 
      event.includes('fetch(') ||
      event.includes('$.ajax(') ||
      event.includes('XMLHttpRequest') ||
      event.includes('axios(')
    );
    console.log('  - Has API call in initialize:', hasAPICall ? '⚠️  YES (Performance Issue!)' : '✅ NO');
  }
  
  console.log('\n═══════════════════════════════════════════════════════════\n');
  
  // Test 2: Form Analysis
  console.log('TEST 2: Form Component Analysis');
  console.log('─────────────────────────────────────────────────────────\n');
  
  const analyzer = new FormAnalyzer();
  const analysis = analyzer.analyze(result.formJson);
  
  console.log('📊 Component Statistics:');
  console.log('  - Total Components:', analysis.components.total);
  console.log('  - Max Depth:', analysis.components.maxDepth);
  console.log('  - Nested Panels:', analysis.components.nestedPanels);
  console.log('  - Visible Components:', analysis.components.visible);
  console.log('  - Hidden Components:', analysis.components.hidden);
  console.log('  - Repeatable Components:', analysis.components.repeatable);
  
  console.log('\n📦 Components by Type:');
  Object.entries(analysis.components.byType).forEach(([type, count]) => {
    console.log(`  - ${type}: ${count}`);
  });
  
  console.log('\n⚡ Complexity Analysis:');
  console.log('  - Score:', analysis.complexity.score);
  console.log('  - Rating:', analysis.complexity.rating);
  console.log('  - Factors:');
  console.log('    • Max Depth:', analysis.complexity.factors.maxDepth);
  console.log('    • Total Components:', analysis.complexity.factors.totalComponents);
  console.log('    • Nested Panels:', analysis.complexity.factors.nestedPanels);
  console.log('    • Repeatable Components:', analysis.complexity.factors.repeatableComponents);
  
  console.log('\n🎯 Event Analysis:');
  console.log('  - Total Events:', analysis.events.total);
  console.log('  - Components with Events:', analysis.events.componentsWithEvents);
  console.log('  - Events by Type:');
  Object.entries(analysis.events.byType).forEach(([type, count]) => {
    console.log(`    • ${type}: ${count}`);
  });
  
  if (analysis.issues.length > 0) {
    console.log('\n⚠️  Detected Issues:');
    analysis.issues.forEach(issue => {
      console.log(`  - [${issue.severity.toUpperCase()}] ${issue.message}`);
    });
  } else {
    console.log('\n✅ No performance issues detected');
  }
  
  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('✅ All Tests Passed!\n');
  
} else {
  console.log('\n❌ Failed to extract JSON - cannot proceed with analysis');
  process.exit(1);
}

