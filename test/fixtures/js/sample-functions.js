// Sample JavaScript file for testing hidden field detection
// This file demonstrates various patterns the analyzer should detect

/**
 * This function makes hiddenPanel.tempField visible
 * Should NOT be flagged - tempField should be marked as "used"
 */
function showTempField(globals) {
  globals.functions.setProperty(
    globals.form?.hiddenPanel?.tempField,
    { visible: true }
  );
}

/**
 * Setup form on initialization
 * Sets values on hidden fields for data storage
 */
function setupForm(globals) {
  // This makes a hidden field visible
  globals.functions.setProperty(
    globals.form.hiddenPanel.tempField,
    { visible: true }
  );

  // This field is never made visible (should be flagged as unnecessary)
  // globals.form.hiddenPanel.unusedField

  // Set some values on hidden fields (just setting values, not visibility)
  globals.functions.setProperty(
    globals.form.dataStorage.userId,
    { value: '12345' }
  );

  // Another hidden field that's never shown
  globals.form.dataStorage.sessionId.value = 'session_123';
}

/**
 * ❌ VIOLATION: This function accesses DOM directly
 * Custom functions should NOT manipulate DOM
 * Recommendation: Use custom components instead
 */
function validateUserName(globals) {
  const input = document.querySelector('#userName');  // ❌ DOM access
  if (input && input.value.length < 3) {
    alert('Username must be at least 3 characters');  // ❌ DOM manipulation
    return false;
  }
  return true;
}

/**
 * ❌ VIOLATION: This function makes HTTP requests
 * Custom functions should NOT make API calls
 * Recommendation: Use API Tool instead
 */
function loadUserData(globals) {
  const xhr = new XMLHttpRequest();  // ❌ HTTP request
  xhr.open('GET', '/api/user', true);
  xhr.onload = function() {
    if (xhr.status === 200) {
      const data = JSON.parse(xhr.responseText);
      globals.form.userName.value = data.name;
    }
  };
  xhr.send();
}

/**
 * ✅ GOOD: This function is fine - no DOM or HTTP
 */
function createJourneyId(channel) {
  return 'journey_' + channel + '_' + Date.now();
}

/**
 * Complex validation logic
 */
function validateField(fieldValue) {
  if (!fieldValue) {
    return false;
  }
  
  // Complex nested logic
  if (fieldValue.length > 10) {
    for (let i = 0; i < fieldValue.length; i++) {
      for (let j = 0; j < fieldValue.length; j++) {
        // Nested loops
        if (fieldValue[i] === fieldValue[j]) {
          return true;
        }
      }
    }
  }
  
  return true;
}

// Synchronous XHR - should be flagged
function loadDataSync() {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/data', false); // false = synchronous
  xhr.send();
  return xhr.responseText;
}

// Console statements - should be flagged  
console.log('Form loaded');
console.debug('Debug info');

