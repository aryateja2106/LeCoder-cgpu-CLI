# Pre-Deployment Security Checklist ✅

Run this checklist before every deployment to ensure security compliance.

## Quick Checks (5 minutes)

```bash
# Navigate to project root
cd /path/to/lecoder-cgpu

# 1. Check for secrets in git
echo "1. Checking for secrets in git..."
git log --all --pretty=format: --name-only | grep -iE "client_secret|credentials|\.env[^.example]" && echo "❌ FAIL: Secrets found in history" || echo "✅ PASS"

# 2. Verify .gitignore
echo "2. Checking .gitignore..."
git check-ignore client_secret_*.json && echo "✅ PASS" || echo "❌ FAIL: client_secret_*.json not ignored"

# 3. Check current git status
echo "3. Checking git status..."
git status --short | grep -iE "client_secret|\.env[^.example]" && echo "❌ FAIL: Secrets staged" || echo "✅ PASS"

# 4. Run npm audit
echo "4. Running npm audit..."
npm audit --production | grep "0 vulnerabilities" && echo "✅ PASS" || echo "⚠️  WARNING: Review vulnerabilities"

# 5. TypeScript compilation
echo "5. Running TypeScript compiler..."
npm run lint &>/dev/null && echo "✅ PASS" || echo "❌ FAIL: Compilation errors"

# 6. Run tests
echo "6. Running tests..."
npm test &>/dev/null && echo "✅ PASS" || echo "❌ FAIL: Tests failed"

# 7. Check file permissions
echo "7. Checking script permissions..."
[ -x scripts/pre-commit.sh ] && echo "✅ PASS" || echo "⚠️  WARNING: pre-commit.sh not executable"

# 8. Verify documentation
echo "8. Checking documentation..."
for file in SECURITY.md PRODUCTION.md SECURITY_AUDIT.md README.md CHANGELOG.md; do
  [ -f "$file" ] && echo "  ✅ $file" || echo "  ❌ $file missing"
done

echo ""
echo "═══════════════════════════════════════"
echo "Security check complete!"
echo "═══════════════════════════════════════"
```

## Detailed Checklist

### 🔐 Secrets & Credentials

- [ ] No `client_secret_*.json` files in git
- [ ] No `.env` files committed (only `.env.example`)
- [ ] No API keys hardcoded in source
- [ ] No passwords or tokens in config files
- [ ] `.gitignore` includes all secret patterns
- [ ] No secrets in git history (`git log`)
- [ ] No secrets in staged files (`git status`)

**Verify with**:
```bash
git ls-files | grep -iE "secret|credentials|\.env[^.example]"
# Should return nothing
```

### 🔒 Authentication

- [ ] OAuth 2.0 with PKCE implemented
- [ ] Minimal scopes requested (`profile`, `email`, `colaboratory`, `drive.file`)
- [ ] Tokens never logged or exposed
- [ ] Session storage uses secure permissions (600)
- [ ] No plaintext credentials stored
- [ ] Token refresh mechanism working

**Test with**:
```bash
lecoder-cgpu auth --validate
lecoder-cgpu status
```

### 📦 Dependencies

- [ ] `npm audit --production` shows 0 vulnerabilities
- [ ] All dependencies up-to-date
- [ ] No deprecated packages
- [ ] Dev dependencies isolated from production
- [ ] License compatibility verified

**Check with**:
```bash
npm audit --production
npm outdated
```

### 🧪 Testing

- [ ] Unit tests passing (`npm test`)
- [ ] Integration tests completed
- [ ] Security test cases included
- [ ] Error handling tested
- [ ] Input validation verified
- [ ] Edge cases covered

**Run with**:
```bash
npm test
npm run test:watch # for development
```

### 📝 Code Quality

- [ ] TypeScript strict mode enabled
- [ ] No `any` types (or documented exceptions)
- [ ] Input validation on all user inputs
- [ ] Output sanitization for errors
- [ ] No `eval()` or dynamic code execution
- [ ] Proper error handling throughout

**Verify with**:
```bash
npm run lint
grep -r "console.log" src/ # Should be minimal
```

### 📚 Documentation

- [ ] `README.md` complete and accurate
- [ ] `SECURITY.md` documents security model
- [ ] `CHANGELOG.md` updated for this version
- [ ] `PRODUCTION.md` deployment guide ready
- [ ] `SECURITY_AUDIT.md` audit complete
- [ ] API documentation current
- [ ] Installation instructions tested

### 🔧 Configuration

- [ ] `.gitignore` comprehensive
- [ ] `.npmignore` excludes dev files
- [ ] `.env.example` template provided
- [ ] No sensitive data in config examples
- [ ] Default settings are secure
- [ ] Error messages don't leak info

### 🏗️ Build

- [ ] `npm run build` completes successfully
- [ ] No warnings in build output
- [ ] Output directory (`dist/`) created correctly
- [ ] Binary is executable (if building binaries)
- [ ] Package.json metadata complete
- [ ] Version bumped appropriately

**Build with**:
```bash
npm run clean
npm run build
ls -lh dist/
```

### 🚀 Git & Version Control

- [ ] All changes committed
- [ ] Commit messages descriptive
- [ ] Branch up-to-date with main
- [ ] No merge conflicts
- [ ] Tags created for release (`v0.4.0`)
- [ ] No sensitive data in commit history

**Check with**:
```bash
git status
git log --oneline -5
git diff origin/main
```

### 🌐 Network Security

- [ ] All API calls use HTTPS
- [ ] Certificate validation enabled (production)
- [ ] No hardcoded URLs with secrets
- [ ] Timeout configured for API calls
- [ ] Retry logic with exponential backoff
- [ ] Rate limiting considered

### 🛡️ Runtime Security

- [ ] File permissions validated before write
- [ ] Path traversal prevention implemented
- [ ] User input sanitized
- [ ] Environment variables validated
- [ ] Process signals handled correctly
- [ ] Cleanup on exit/error

## Critical Pre-Deploy Commands

```bash
# 1. Full security scan
npm audit --production

# 2. Check for secrets
git log --all --pretty=format: --name-only | grep -i secret

# 3. Verify .gitignore
git check-ignore -v client_secret_*.json

# 4. Build and test
npm run clean
npm run build
npm test

# 5. Check git status
git status

# 6. Create release tag
git tag -a v0.4.0 -m "Release v0.4.0 - Notebook management"

# 7. Final review
echo "Review CHANGELOG.md, README.md, and SECURITY.md"
```

## Post-Deployment

- [ ] Monitor initial installation success rate
- [ ] Watch for security issues/bug reports
- [ ] Verify authentication flow for new users
- [ ] Check error rates in first 24 hours
- [ ] Prepare hotfix branch if needed
- [ ] Update documentation based on feedback

## Emergency Rollback

If critical issues found:

```bash
# Unpublish (within 72 hours)
npm unpublish lecoder-cgpu@0.4.0

# Or deprecate
npm deprecate lecoder-cgpu@0.4.0 "Critical issue - use v0.3.0"

# Git revert
git revert v0.4.0
git push origin main
```

## Sign-off

**Date**: _______________  
**Version**: 0.4.0  
**Reviewed by**: _______________  
**Status**: ☐ APPROVED  ☐ NEEDS WORK

**Notes**:
_______________________________________
_______________________________________
_______________________________________

---

## Automated Check Script

Save as `scripts/security-check.sh`:

```bash
#!/bin/bash
# Run full security check
set -e

echo "🔒 Running comprehensive security check..."
echo ""

PASS=0
FAIL=0

check() {
  if $1; then
    echo "✅ $2"
    ((PASS++))
  else
    echo "❌ $2"
    ((FAIL++))
  fi
}

# Run checks
check "! git ls-files | grep -qiE 'client_secret|credentials'" "No secrets in git"
check "npm audit --production | grep -q '0 vulnerabilities'" "No production vulnerabilities"
check "npm run lint &>/dev/null" "TypeScript compilation"
check "npm test &>/dev/null" "Tests passing"
check "[ -f SECURITY.md ]" "Security documentation"
check "[ -f .env.example ]" "Environment template"

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ $FAIL -gt 0 ]; then
  echo "❌ Security check FAILED"
  exit 1
else
  echo "✅ Security check PASSED"
  exit 0
fi
```

Make it executable:
```bash
chmod +x scripts/security-check.sh
```

Run it:
```bash
./scripts/security-check.sh
```
