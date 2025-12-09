import * as cheerio from 'cheerio';

/**
 * Extracts JSON data from AEM Core Components forms
 * Form data is in data attributes or model.json
 */
export class CoreComponentsExtractor {
  
  /**
   * Extract form JSON from Core Components HTML
   * @param {string} html - HTML content
   * @param {string} pageUrl - Page URL (for model.json fetch)
   * @returns {Object} Extracted JSON data
   */
  async extract(html, pageUrl) {
    const $ = cheerio.load(html);
    const results = {
      formJson: null,
      formType: 'core-components',
      errors: []
    };

    try {
      // Strategy 1: Look for form container with embedded JSON
      const formContainer = $('[data-cmp-is="formcontainer"], [data-cmp-is="adaptiveFormContainer"], .cmp-adaptiveform-container');
      
      if (formContainer.length) {
        // Try embedded script JSON
        const scriptJson = formContainer.find('script[type="application/json"]');
        if (scriptJson.length) {
          results.formJson = this.parseJSON(scriptJson.text());
          if (results.formJson) return results;
        }

        // Try data-cmp-form-model attribute
        const formModel = formContainer.attr('data-cmp-form-model');
        if (formModel) {
          results.formJson = this.parseJSON(formModel);
          if (results.formJson) return results;
        }
      }

      // Strategy 2: Fetch model.json
      if (pageUrl) {
        const modelJson = await this.fetchModelJson(pageUrl);
        if (modelJson) {
          results.formJson = this.findFormInModel(modelJson);
          if (results.formJson) return results;
        }
      }

      results.errors.push({ message: 'Could not extract form JSON from Core Components page' });

    } catch (error) {
      results.errors.push({ message: error.message });
    }

    return results;
  }

  /**
   * Parse JSON string safely
   */
  parseJSON(jsonText) {
    try {
      if (!jsonText || !jsonText.trim()) return null;
      let parsed = JSON.parse(jsonText.trim());
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      return typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Fetch model.json from page URL
   */
  async fetchModelJson(pageUrl) {
    try {
      const url = new URL(pageUrl);
      // Remove .html and query params, add .model.json
      let pathname = url.pathname.replace(/\.html$/, '');
      const modelUrl = `${url.origin}${pathname}.model.json`;
      
      console.log(`Fetching model.json from: ${modelUrl}`);
      
      const headers = { 'Accept': 'application/json' };
      
      // Add basic auth for localhost AEM (default credentials)
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        const credentials = process.env.AEM_CREDENTIALS || 'admin:admin';
        headers['Authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`;
      }
      
      const response = await fetch(modelUrl, { headers });
      
      if (!response.ok) {
        console.log(`model.json fetch failed: ${response.status} ${response.statusText}`);
        return null;
      }
      
      const json = await response.json();
      console.log(`model.json fetched successfully, keys: ${Object.keys(json).join(', ')}`);
      return json;
    } catch (e) {
      console.log(`Error fetching model.json: ${e.message}`);
      return null;
    }
  }

  /**
   * Find form container in model.json
   */
  findFormInModel(obj) {
    if (!obj || typeof obj !== 'object') return null;
    
    const type = obj[':type'] || '';
    if (type.includes('formcontainer') || type.includes('form/container')) {
      return this.normalizeForm(obj);
    }

    // Search in children
    for (const key of [':items', 'items', 'children']) {
      if (obj[key]) {
        const items = Array.isArray(obj[key]) ? obj[key] : Object.values(obj[key]);
        for (const item of items) {
          const found = this.findFormInModel(item);
          if (found) return found;
        }
      }
    }
    return null;
  }

  /**
   * Normalize Core Components form JSON to standard format
   */
  normalizeForm(formJson) {
    const normalized = {
      fieldType: 'form',
      formType: 'core-components',
      id: formJson.id || formJson[':path'] || 'form',
      name: formJson.name || formJson.title || formJson['jcr:title'] || 'form',
      title: formJson.title || formJson['jcr:title'],
      ':items': {},
      ':itemsOrder': []
    };

    // Normalize children
    const items = formJson[':items'] || formJson.items || {};
    const entries = Array.isArray(items) ? items.map((v, i) => [v.name || `item_${i}`, v]) : Object.entries(items);
    
    for (const [key, value] of entries) {
      normalized[':items'][key] = this.normalizeField(value);
      normalized[':itemsOrder'].push(key);
    }

    if (formJson[':itemsOrder']) normalized[':itemsOrder'] = formJson[':itemsOrder'];
    return normalized;
  }

  /**
   * Normalize a single field
   */
  normalizeField(field) {
    if (!field || typeof field !== 'object') return field;

    const normalized = {
      id: field.id || field.name,
      name: field.name || field.id,
      fieldType: this.normalizeFieldType(field[':type'] || field.fieldType),
      visible: field.visible !== false && field.hidden !== true,
      label: field.label || { value: field['jcr:title'] || field.title || field.name }
    };

    // Copy common properties
    ['required', 'placeholder', 'description', 'default', 'value', 'enum', 'enumNames'].forEach(prop => {
      if (field[prop] !== undefined) normalized[prop] = field[prop];
    });

    // Copy events and rules
    if (field.events) normalized.events = field.events;
    if (field.rules) normalized.rules = field.rules;

    // Normalize nested items (panels)
    if (field[':items'] || field.items) {
      normalized[':items'] = {};
      normalized[':itemsOrder'] = [];
      const items = field[':items'] || field.items || {};
      const entries = Array.isArray(items) ? items.map((v, i) => [v.name || `item_${i}`, v]) : Object.entries(items);
      
      for (const [key, value] of entries) {
        normalized[':items'][key] = this.normalizeField(value);
        normalized[':itemsOrder'].push(key);
      }
    }

    return normalized;
  }

  /**
   * Normalize Core Components field type to standard format
   * Based on: https://github.com/adobe/aem-core-forms-components
   * 
   * Handles:
   * 1. Direct fieldType values (e.g., "email", "panel", "text-input")
   * 2. Resource types (e.g., "core/fd/components/form/textinput")
   */
  normalizeFieldType(type) {
    if (!type) return 'text-input';
    
    const t = type.toLowerCase();
    
    // Map of all component types to normalized fieldType
    // Handles both direct fieldType values and resource type component names
    const typeMap = {
      // Direct fieldType values that need mapping
      'email': 'email-input',
      'text': 'plain-text',
      
      // Resource type component names (from path like core/fd/components/form/XXX)
      'textinput': 'text-input',
      'emailinput': 'email-input',
      'telephoneinput': 'telephone-input',
      'numberinput': 'number-input',
      'datepicker': 'date-input',
      'dropdown': 'drop-down',
      'checkboxgroup': 'checkbox-group',
      'radiobutton': 'radio-group',
      'fileinput': 'file-input',
      'container': 'panel',
      'panelcontainer': 'panel',
      'formcontainer': 'form',
      'horizontaltabs': 'tabs',
      'verticaltabs': 'tabs',
      'pageheader': 'page-header',
      // Component names that match their fieldType (for resource type paths)
      'panel': 'panel',
      'wizard': 'wizard',
      'tabs': 'tabs',
      'accordion': 'accordion',
      'button': 'button',
      'checkbox': 'checkbox',
      'image': 'image',
      'title': 'title',
      'fragment': 'fragment',
      'footer': 'footer',
    };
    
    // If already a valid normalized type, return as-is
    const validTypes = [
      'text-input', 'email-input', 'telephone-input', 'number-input', 
      'date-input', 'drop-down', 'checkbox-group', 'radio-group', 
      'file-input', 'plain-text', 'multiline-input', 'panel', 'form',
      'button', 'checkbox', 'image', 'wizard', 'tabs', 'accordion',
      'fragment', 'title', 'page-header', 'footer'
    ];
    
    if (validTypes.includes(t)) {
      return t;
    }
    
    // Check direct mapping
    if (typeMap[t]) {
      return typeMap[t];
    }

    // Extract component name from resource type path
    // e.g., "core/fd/components/form/textinput" or "mysite/components/adaptiveForm/textinput"
    const parts = t.split('/');
    const componentName = parts[parts.length - 1];
    
    if (typeMap[componentName]) {
      return typeMap[componentName];
    }

    // Fallback: check if type contains any known component name
    for (const [key, value] of Object.entries(typeMap)) {
      if (t.includes(key)) return value;
    }
    
    return 'text-input';
  }

  /**
   * Static method to detect if HTML is Core Components
   */
  static isCoreComponentsForm(html) {
    const $ = cheerio.load(html);
    return $('[data-cmp-is="formcontainer"], [data-cmp-is="adaptiveFormContainer"], .cmp-adaptiveform-container, .cmp-form-container').length > 0;
  }
}
