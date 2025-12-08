# Example PR Description

## Feature: Add new field to form

This PR adds a new email validation field to the SmartEMI form.

### Changes
- Added email field with validation
- Updated form styling
- Added new helper function for email validation

### Test URLs:

Before: https://main--forms-engine--hdfc-forms.aem.live/loan-against-assets/smartemi/smartemi

After: https://pr-123--forms-engine--hdfc-forms.aem.live/loan-against-assets/smartemi/smartemi

### Testing
- [x] Tested email validation
- [x] Tested form submission
- [x] Verified responsive design

---

When you create a PR with this description format, the Performance Bot will:

1. **Extract URLs**: Parse the "Before" and "After" URLs
2. **Fetch Content**: Load both URLs and extract:
   - Adaptive form JSON from the page source
   - HTML structure and metrics
   - Page resources and scripts
3. **Analyze Changes**:
   - Compare form component counts
   - Calculate complexity changes
   - Analyze DOM size differences
   - Check JavaScript changes in PR files
4. **Generate Report**: Post a comprehensive performance analysis comment

### Expected Bot Output

The bot will post a comment analyzing:
- **Form Analysis**: Components added/removed, complexity changes, new/resolved issues
- **HTML Analysis**: DOM size, script loading, resource optimization
- **JavaScript Analysis**: File complexity, performance issues, recommendations
- **Overall Assessment**: Performance impact rating and actionable recommendations

