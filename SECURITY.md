# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.4.x   | :white_check_mark: |
| 0.3.x   | :white_check_mark: |
| < 0.3   | :x:                |

## Security Model

LeCoder cGPU implements a defense-in-depth security model:

### 1. Authentication & Authorization

- **OAuth 2.0 with PKCE**: All authentication uses industry-standard OAuth 2.0 with Proof Key for Code Exchange (PKCE) for enhanced security
- **Minimal Scopes**: Only requests necessary Google API scopes (`profile`, `email`, `colaboratory`, `drive.file`)
- **Restricted Drive Access**: Uses `drive.file` scope (app-created files only) instead of full Drive access
- **Token Management**: Access tokens are never logged or exposed in error messages
- **Secure Storage**: Refresh tokens are stored locally with file system permissions (600)

### 2. Data Protection

- **Local Storage Only**: All credentials stored in `~/.config/lecoder-cgpu/` with restricted permissions
- **No Cloud Storage**: No credentials or sensitive data transmitted to third-party services
- **Execution History**: History files contain execution metadata but no credentials
- **HTTPS Only**: All API communication uses HTTPS with certificate validation

### 3. Input Validation

- **Command Sanitization**: All user inputs are validated before execution
- **Path Validation**: File paths validated to prevent directory traversal attacks
- **Schema Validation**: All API responses validated using Zod schemas
- **Error Handling**: Structured error handling prevents information leakage

### 4. Dependency Security

- **Minimal Dependencies**: Only essential, well-maintained packages used
- **Regular Updates**: Dependencies updated regularly for security patches
- **No Eval**: No dynamic code evaluation or `eval()` usage
- **Type Safety**: Full TypeScript coverage with strict mode enabled

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

### Private Reporting

1. **Email**: Send details to [aryateja2106@gmail.com](mailto:aryateja2106@gmail.com)
2. **Subject**: `[SECURITY] LeCoder cGPU - Brief Description`
3. **Include**:
   - Type of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if available)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Fix Timeline**: Critical issues within 14 days, others within 30 days

### Disclosure Policy

- We follow responsible disclosure practices
- Security fixes released before public disclosure
- Credit given to reporters (unless anonymity requested)

## Security Best Practices for Users

### 1. Credential Management

```bash
# NEVER commit these files
client_secret_*.json
config/
state/

# Check your .gitignore
cat .gitignore | grep client_secret
```

### 2. Permission Management

```bash
# Verify credential file permissions
ls -la ~/.config/lecoder-cgpu/
# Should show: -rw------- (600) for session.json
```

### 3. Regular Re-authentication

```bash
# Re-authenticate periodically to rotate tokens
lecoder-cgpu auth --force
```

### 4. Audit Execution History

```bash
# Review execution history regularly
lecoder-cgpu logs --stats

# Clear history if needed
lecoder-cgpu logs --clear
```

### 5. Environment Security

```bash
# Use in trusted environments only
# Avoid shared or public computers
# Ensure no screen recording/sharing during auth

# For CI/CD, use service accounts (not personal credentials)
```

## Known Security Considerations

### 1. Local Storage

- Credentials stored in `~/.config/lecoder-cgpu/session.json`
- Protected by file system permissions (not encrypted at rest)
- Users responsible for securing their file system

### 2. OAuth Tokens

- Access tokens valid for 1 hour
- Refresh tokens stored for persistent authentication
- Tokens automatically refreshed when expired

### 3. Network Security

- All communication uses HTTPS
- Certificate validation enabled by default
- Localhost development mode disables certificate validation (development only)

### 4. Execution Environment

- Code executed on Google's Colab infrastructure (not local machine)
- User responsible for code safety and data handling on Colab
- LeCoder cGPU does not inspect or modify executed code

## Security Checklist for Contributors

- [ ] No hardcoded credentials or API keys
- [ ] All user inputs validated and sanitized
- [ ] API responses validated with schemas
- [ ] Error messages don't leak sensitive information
- [ ] Dependencies reviewed and up-to-date
- [ ] Tests include security edge cases
- [ ] Documentation updated with security implications
- [ ] `.gitignore` properly configured

## Compliance

- **GDPR**: User data stored locally only; no data sharing with third parties
- **OAuth 2.0**: Compliant with RFC 6749 and RFC 7636 (PKCE)
- **Google API Terms**: Compliant with Google API Terms of Service

## Security Tooling

### Static Analysis

```bash
# Run TypeScript compiler with strict mode
npm run lint

# Run tests including security edge cases
npm test
```

### Dependency Auditing

```bash
# Check for vulnerable dependencies
npm audit

# Fix automatically if possible
npm audit fix
```

## Updates and Patches

Security updates announced via:
- GitHub Security Advisories
- Release notes (CHANGELOG.md)
- NPM package metadata

## Contact

For security concerns: [aryateja2106@gmail.com](mailto:aryateja2106@gmail.com)

For general issues: [GitHub Issues](https://github.com/aryateja2106/nested-learning/issues)
