#!/bin/bash
set -e

echo "🔨 Building Blue-Green Deployment Action..."

# Install dependencies
echo "📦 Installing dependencies..."
if [ ! -f "package-lock.json" ]; then
    echo "No package-lock.json found, running npm install..."
    npm install
else
    npm ci
fi

# Run tests
echo "🧪 Running tests..."
npm test

# Build the action
echo "🏗️ Building action..."
npm run build

# Verify build
if [ ! -f "dist/index.js" ]; then
    echo "❌ Build failed: dist/index.js not found"
    exit 1
fi

echo "✅ Build completed successfully!"
echo "📁 Action files:"
echo "   - action.yml (metadata)"
echo "   - dist/index.js (compiled action)"
echo "   - README.md (documentation)"

echo ""
echo "🚀 Ready to publish! Create a release on GitHub to make this action available."