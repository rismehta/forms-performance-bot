# Contributing to Performance Bot

Thank you for your interest in contributing to Performance Bot! This document provides guidelines for contributing.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/your-org/performance-bot/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - PR link if applicable
   - Workflow run link
   - Error messages/logs

### Suggesting Enhancements

1. Check existing issues for similar suggestions
2. Create a new issue describing:
   - Use case
   - Proposed solution
   - Alternative approaches considered
   - Impact on existing functionality

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit with clear messages
6. Push to your fork
7. Open a pull request

## Development Setup

### Prerequisites

- Node.js 20+
- npm or yarn
- Git

### Local Setup

```bash
# Clone repository
git clone https://github.com/your-org/performance-bot.git
cd performance-bot

# Install dependencies
npm install

# Run locally (with environment variables)
export GITHUB_TOKEN=your_token
npm start
```

### Project Structure

```
src/
├── index.js              # Entry point
├── analyzers/            # Analysis modules
│   ├── url-analyzer.js
│   ├── form-analyzer.js
│   ├── html-analyzer.js
│   └── js-analyzer.js
├── extractors/           # Data extraction
│   ├── json-extractor.js
│   └── html-extractor.js
├── reporters/            # Report generation
│   └── pr-reporter.js
└── utils/                # Utilities
    └── github-helper.js
```

## Coding Standards

### JavaScript Style

- Use ES6+ features
- Use `const` and `let`, avoid `var`
- Use arrow functions where appropriate
- Add JSDoc comments for functions
- Follow existing code style

### Example:

```javascript
/**
 * Analyze a form JSON structure
 * @param {Object} formJson - Form JSON object
 * @returns {Object} Analysis results
 */
export function analyzeForm(formJson) {
  // Implementation
}
```

### Linting

Run ESLint before committing:

```bash
npx eslint src/
```

## Adding Features

### Adding a New Analyzer

1. Create file in `src/analyzers/`
2. Implement `analyze()` method
3. Implement `compare()` method for before/after
4. Export the class
5. Import in `src/index.js`
6. Add to analysis pipeline
7. Update report generation

Example:

```javascript
// src/analyzers/css-analyzer.js
export class CSSAnalyzer {
  analyze(cssData) {
    // Analyze CSS
    return {
      rules: 0,
      selectors: 0,
      issues: []
    };
  }

  compare(before, after) {
    // Compare analyses
    return {
      before,
      after,
      delta: {}
    };
  }
}
```

### Adding a New Extractor

1. Create file in `src/extractors/`
2. Implement `extract()` method
3. Return structured data
4. Handle errors gracefully

Example:

```javascript
// src/extractors/css-extractor.js
export class CSSExtractor {
  extract(html) {
    // Extract CSS from HTML
    return {
      stylesheets: [],
      inlineStyles: [],
      errors: []
    };
  }
}
```

### Adding New Metrics

1. Update relevant analyzer
2. Add to comparison logic
3. Update PR reporter to display metric
4. Update documentation

### Adding New Thresholds

1. Update `.performance-bot.json` schema
2. Add threshold checks in analyzer
3. Document in README and SETUP.md

## Testing

### Manual Testing

Test with a real PR:

1. Create test repository
2. Add workflow file
3. Create PR with test URLs
4. Verify analysis runs correctly
5. Check PR comment output

### Test Data

Use examples in `examples/` for testing:
- `sample-form-json.json` - Sample form structure
- `example-pr-description.md` - PR template

### Edge Cases to Test

- Empty forms
- Malformed JSON
- Missing URLs
- Network timeouts
- Large files
- Complex nested structures
- Invalid HTML

## Documentation

### When to Update Documentation

- Adding new features
- Changing behavior
- Adding configuration options
- Fixing bugs that affect usage

### Documentation Files

- **README.md** - User-facing overview
- **ARCHITECTURE.md** - Technical details
- **DEPLOYMENT.md** - Deployment instructions
- **SETUP.md** - Setup guide
- **CONTRIBUTING.md** - This file

### Documentation Standards

- Clear, concise language
- Code examples where helpful
- Keep table of contents updated
- Use proper markdown formatting
- Add diagrams where beneficial

## Release Process

### Version Numbering

Follow [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes

### Creating a Release

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Commit: `git commit -m "chore: release v1.1.0"`
4. Tag: `git tag -a v1.1.0 -m "Release v1.1.0"`
5. Push: `git push origin main --tags`
6. Create GitHub release

### Changelog Format

```markdown
## [1.1.0] - 2024-01-15

### Added
- New CSS analyzer
- Support for custom thresholds

### Changed
- Improved JSON extraction accuracy

### Fixed
- Network timeout handling
```

## Code Review

### As a Reviewer

- Check code quality and style
- Verify tests pass
- Review documentation updates
- Test changes locally
- Provide constructive feedback

### As a Contributor

- Respond to feedback promptly
- Keep PRs focused and small
- Write clear commit messages
- Update based on reviews

## Git Commit Messages

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation
- **style**: Formatting
- **refactor**: Code restructuring
- **test**: Adding tests
- **chore**: Maintenance

### Examples

```
feat(analyzer): add CSS analysis support

Implements CSS analyzer to extract and analyze stylesheets
from HTML pages. Includes rule counting, selector analysis,
and specificity calculations.

Closes #123
```

```
fix(extractor): handle malformed JSON gracefully

Adds try-catch around JSON parsing to prevent crashes
when encountering invalid JSON in page sources.
```

## Community

### Code of Conduct

Be respectful, inclusive, and professional. See CODE_OF_CONDUCT.md.

### Getting Help

- GitHub Issues - Bug reports and feature requests
- Discussions - Questions and ideas
- Documentation - Comprehensive guides

### Recognition

Contributors will be:
- Listed in CONTRIBUTORS.md
- Mentioned in release notes
- Credited in commit messages

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

Feel free to open an issue for any questions about contributing!

---

Thank you for making Performance Bot better! 🚀

