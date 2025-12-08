#!/bin/bash
set -e

echo "🧹 Cleaning and rebuilding LeCoder cGPU..."

# Clean dist directory
echo "Removing dist directory..."
npm run clean

# Rebuild
echo "Building TypeScript project..."
npm run build

# Show results
if [ -d "dist" ] && [ -f "dist/src/index.js" ]; then
  echo ""
  echo "✅ Clean build complete!"
  echo ""
  echo "Build artifacts:"
  du -sh dist
  echo ""
  echo "Entry point: dist/src/index.js"
else
  echo ""
  echo "❌ Build failed - dist/src/index.js not found"
  exit 1
fi
