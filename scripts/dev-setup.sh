#!/bin/bash
set -e

echo "🚀 Setting up LeCoder cGPU development environment..."

# Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null || echo "not found")
if [[ "$NODE_VERSION" == "not found" ]]; then
  echo "❌ Node.js is not installed. Please install Node.js 18+ first."
  exit 1
fi

echo "✓ Node.js version: $NODE_VERSION"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the project
echo "🔨 Building TypeScript project..."
npm run build

# Link globally for development
echo "🔗 Linking lecoder-cgpu globally..."
npm link

echo ""
echo "✅ Development environment ready!"
echo ""
echo "You can now use: lecoder-cgpu --help"
echo ""
echo "Development commands:"
echo "  npm run dev          - Run CLI in development mode"
echo "  npm run build        - Compile TypeScript"
echo "  npm run test         - Run tests"
echo "  npm run test:watch   - Run tests in watch mode"
echo "  npm run lint         - Type-check code"
echo ""
