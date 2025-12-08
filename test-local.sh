#!/bin/bash
# Quick test script for Performance Bot

set -e

echo "🚀 Performance Bot - Local Test"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if URLs are provided
if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: ./test-local.sh <before-url> <after-url>"
  echo ""
  echo "Example:"
  echo "  ./test-local.sh \\"
  echo "    https://main--forms-engine--hdfc-forms.aem.live/ \\"
  echo "    https://branch--forms-engine--hdfc-forms.aem.live/"
  echo ""
  exit 1
fi

BEFORE_URL="$1"
AFTER_URL="$2"

echo "Before URL: $BEFORE_URL"
echo "After URL: $AFTER_URL"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
  echo ""
fi

# Run test
echo "🧪 Running analysis..."
echo ""

node test/run-test.js --before "$BEFORE_URL" --after "$AFTER_URL"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ Test complete!"
echo ""
echo "📄 Check the output at: test/output/pr-comment.md"
echo ""

