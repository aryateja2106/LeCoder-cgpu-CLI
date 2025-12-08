#!/bin/bash
# Git pre-commit hook for security checks
# Install: cp scripts/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

set -e

echo "🔒 Running pre-commit security checks..."

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check for secrets in staged files
echo "1️⃣ Checking for secrets..."
if git diff --cached --name-only | grep -qE "client_secret.*\.json|credentials\.json|\.env"; then
    echo -e "${RED}❌ ERROR: Attempting to commit secret files!${NC}"
    echo "   Found:"
    git diff --cached --name-only | grep -E "client_secret.*\.json|credentials\.json|\.env"
    echo ""
    echo "   These files should be in .gitignore"
    exit 1
fi

# Check for hardcoded secrets in code
echo "2️⃣ Scanning for hardcoded secrets..."
if git diff --cached | grep -qiE "(password|api[_-]?key|secret|token)\s*=\s*['\"][^'\"]{10,}"; then
    echo -e "${YELLOW}⚠️  WARNING: Possible hardcoded secret detected${NC}"
    echo "   Please review your changes carefully"
    # Don't fail, just warn
fi

# Check for console.log in production code
echo "3️⃣ Checking for console.log statements..."
if git diff --cached --name-only | grep -E "^src/.*\.ts$" | xargs grep -n "console\.log" 2>/dev/null; then
    echo -e "${YELLOW}⚠️  WARNING: console.log found in source files${NC}"
    echo "   Consider using a proper logger"
    # Don't fail, just warn
fi

# Run TypeScript compiler
echo "4️⃣ Running TypeScript compiler..."
if ! npm run lint --silent; then
    echo -e "${RED}❌ ERROR: TypeScript compilation failed${NC}"
    exit 1
fi

# Run tests
echo "5️⃣ Running tests..."
if ! npm test --silent; then
    echo -e "${RED}❌ ERROR: Tests failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All pre-commit checks passed!${NC}"
exit 0
