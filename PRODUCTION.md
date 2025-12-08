# Production Deployment Checklist

This checklist ensures LeCoder cGPU is production-ready and secure.

## Pre-Release Security Checklist

### 1. Secrets & Credentials
- [ ] ✅ `.gitignore` includes all credential patterns
- [ ] ✅ No `client_secret_*.json` files in repository
- [ ] ✅ No API keys or tokens hardcoded in source
- [ ] ✅ `SECURITY.md` documentation complete
- [ ] ✅ Session storage uses secure file permissions (600)

### 2. Code Quality
- [ ] ✅ All TypeScript compiler errors resolved
- [ ] ✅ All linter warnings addressed or documented
- [ ] ✅ SonarQube analysis completed
- [ ] ✅ No console.log statements in production code (use logger)
- [ ] ✅ Error messages don't expose sensitive information

### 3. Testing
- [ ] ⚠️ Unit tests passing (run `npm test`)
- [ ] ⚠️ Integration tests completed
- [ ] ✅ Manual testing of all commands
- [ ] ✅ Error handling tested for edge cases
- [ ] ✅ OAuth flow tested end-to-end

### 4. Dependencies
- [ ] ⚠️ `npm audit` shows no critical vulnerabilities
- [ ] ✅ All dependencies up-to-date
- [ ] ✅ No deprecated packages
- [ ] ✅ License compatibility verified
- [ ] ✅ Dependencies documented in README

### 5. Documentation
- [ ] ✅ README.md complete and accurate
- [ ] ✅ CHANGELOG.md updated for v0.4.0
- [ ] ✅ API documentation current
- [ ] ✅ Security policy documented
- [ ] ✅ Installation instructions tested
- [ ] ✅ Troubleshooting guide included

### 6. Build & Distribution
- [ ] ✅ `npm run build` completes successfully
- [ ] ✅ `.npmignore` configured properly
- [ ] ✅ Package.json metadata complete
- [ ] ✅ Binary builds tested (if applicable)
- [ ] ✅ Version bumped appropriately (0.4.0)

### 7. Git & Repository
- [ ] ✅ All changes committed with descriptive messages
- [ ] ✅ Branch up-to-date with main
- [ ] ✅ No merge conflicts
- [ ] ✅ `.gitignore` validated
- [ ] ✅ Repository cleanup completed

## Production Environment Setup

### Google Cloud Console Configuration

1. **Enable Required APIs**:
   - Google Drive API: https://console.developers.google.com/apis/api/drive.googleapis.com
   - Google Colaboratory API: https://console.developers.google.com/apis/api/colab.googleapis.com

2. **OAuth Consent Screen**:
   - Application name: "LeCoder cGPU"
   - Scopes: `profile`, `email`, `colaboratory`, `drive.file`
   - Privacy policy URL (if publishing)
   - Terms of service URL (if publishing)

3. **OAuth 2.0 Credentials**:
   - Application type: Desktop app
   - Download `client_secret_*.json`
   - **DO NOT** commit to repository

### User Installation

```bash
# From NPM (after publishing)
npm install -g lecoder-cgpu

# From source (development)
git clone https://github.com/aryateja2106/nested-learning.git
cd nested-learning/lecoder-cgpu
npm install
npm run build
npm link
```

### First-Time Setup

```bash
# Authenticate
lecoder-cgpu auth --validate

# Verify status
lecoder-cgpu status

# Test notebook features (requires Drive API enabled)
lecoder-cgpu notebook list
```

## Monitoring & Maintenance

### Regular Tasks

**Weekly**:
- Check GitHub issues for bug reports
- Review security advisories
- Monitor npm audit results

**Monthly**:
- Update dependencies
- Review and update documentation
- Check for TypeScript/Node.js updates

**Quarterly**:
- Security audit
- Performance profiling
- User feedback review

### Metrics to Track

- Installation count (npm downloads)
- Error rates from logs
- Authentication success rate
- API rate limit hits
- User-reported issues

## Rollback Plan

If critical issues discovered post-release:

1. **Immediate**:
   ```bash
   # Unpublish if < 72 hours
   npm unpublish lecoder-cgpu@0.4.0
   
   # Or deprecate
   npm deprecate lecoder-cgpu@0.4.0 "Critical bug - use 0.3.0"
   ```

2. **Communication**:
   - GitHub issue explaining the problem
   - Update README with warning
   - Email maintainers list (if exists)

3. **Fix & Re-release**:
   - Hotfix branch from release tag
   - Version bump to 0.4.1
   - Expedited testing
   - Re-publish with fixes

## Post-Release Tasks

- [ ] Tag release in Git: `git tag v0.4.0`
- [ ] Create GitHub release with changelog
- [ ] Publish to NPM: `npm publish`
- [ ] Announce on relevant channels
- [ ] Update documentation website (if exists)
- [ ] Monitor initial user feedback
- [ ] Prepare hotfix branch if needed

## Known Limitations (Document for Users)

1. **Drive API Requirement**: First run after upgrade requires re-authentication
2. **Rate Limits**: Google APIs have rate limits (300 requests/minute for Drive)
3. **Network Dependency**: Requires internet connection for all operations
4. **Local Storage**: Credentials stored locally (not encrypted at rest)
5. **Colab Limits**: Subject to Google Colab usage limits and quotas

## Support Channels

- GitHub Issues: Bug reports and feature requests
- GitHub Discussions: General questions
- Email: Critical security issues only
- Documentation: README.md and docs/

## Success Criteria

Release considered successful when:
- ✅ No critical bugs reported in first week
- ✅ Authentication flow works for 95%+ of users
- ✅ No security vulnerabilities identified
- ✅ Documentation clear (< 5 "how do I?" issues)
- ✅ Installation success rate > 90%

## Emergency Contact

For production incidents:
- Primary: aryateja2106@gmail.com
- GitHub: @aryateja2106
- Response time: < 24 hours for critical issues

---

**Last Updated**: 2025-12-07  
**Version**: 0.4.0  
**Status**: Pre-release verification in progress
