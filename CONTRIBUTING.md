# Contributing to LeCoder cGPU CLI

First off, thank you for considering contributing to LeCoder cGPU CLI! 🎉

It's people like you that make LeCoder cGPU CLI such a great tool for the community.

## 🌟 Ways to Contribute

There are many ways to contribute to this project:

- 🐛 Report bugs
- 💡 Suggest new features
- 📝 Improve documentation
- 🔧 Fix issues
- ✨ Add new features
- 🧪 Write tests
- 🎨 Improve UI/UX (CLI output, error messages)
- 📚 Create tutorials and examples

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and npm 9+
- Git
- A Google account (for testing Colab integration)
- Basic knowledge of TypeScript and CLI development

### Setting Up Your Development Environment

1. **Fork the repository** on GitHub

2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/LeCoder-cgpu-CLI.git
   cd LeCoder-cgpu-CLI
   ```

3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/aryateja2106/LeCoder-cgpu-CLI.git
   ```

4. **Install dependencies**:
   ```bash
   npm install
   ```

5. **Build the project**:
   ```bash
   npm run build
   ```

6. **Link for local testing**:
   ```bash
   npm link
   ```

7. **Run tests**:
   ```bash
   npm test
   ```

### Development Workflow

1. **Create a new branch** for your feature or fix:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-number-description
   ```

2. **Make your changes** following our coding standards

3. **Test your changes** thoroughly:
   ```bash
   npm test
   npm run build
   lecoder-cgpu --help  # Test CLI
   ```

4. **Commit your changes** with a clear message:
   ```bash
   git add .
   git commit -m "feat: add new feature X"
   # or
   git commit -m "fix: resolve issue #123"
   ```

5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request** on GitHub

## 📝 Coding Standards

### TypeScript Style Guide

- Use TypeScript for all new code
- Follow existing code style (we use Prettier and ESLint)
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Prefer `const` over `let`, avoid `var`
- Use async/await over raw promises
- Handle errors explicitly

### Project Structure

```
src/
├── auth/           # OAuth and authentication
├── colab/          # Colab API client
├── drive/          # Google Drive API client
├── jupyter/        # Jupyter kernel protocol
├── runtime/        # Runtime management
├── serve/          # MCP server
├── commands/       # CLI command handlers (future)
├── types/          # TypeScript type definitions
└── utils/          # Utility functions
```

### Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

Examples:
```
feat: add notebook execution from CLI
fix: handle connection timeout gracefully
docs: improve installation instructions
test: add unit tests for DriveClient
```

### Testing Guidelines

- Write tests for new features
- Maintain or improve test coverage
- Run the test suite before submitting PR
- Use descriptive test names
- Test both success and error cases

**Test Structure:**
```typescript
import { describe, it, expect } from 'vitest';

describe('FeatureName', () => {
  it('should handle normal case', async () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = await yourFunction(input);
    
    // Assert
    expect(result).toBe('expected');
  });

  it('should handle error case', async () => {
    expect(() => yourFunction(null)).toThrow();
  });
});
```

## 🐛 Reporting Bugs

### Before Submitting a Bug Report

1. **Check existing issues** - Your bug might already be reported
2. **Update to latest version** - The bug might be fixed
3. **Try to reproduce** - Can you consistently trigger the bug?

### How to Submit a Good Bug Report

Use the bug report template and include:

1. **Clear title** - Summarize the issue in one line
2. **Environment details**:
   - OS and version
   - Node.js version (`node --version`)
   - Package version (`lecoder-cgpu --version`)
3. **Steps to reproduce** - Exact commands that trigger the bug
4. **Expected behavior** - What should happen
5. **Actual behavior** - What actually happens
6. **Error messages** - Full error output with `--verbose`
7. **Screenshots/logs** - If applicable

**Example:**
```markdown
## Bug: Connection hangs on macOS 14.1

**Environment:**
- OS: macOS 14.1 Sonoma
- Node.js: v20.10.0
- lecoder-cgpu: v0.4.0

**Steps to reproduce:**
1. Run `lecoder-cgpu connect`
2. Complete OAuth flow
3. Runtime creation succeeds but connection hangs

**Expected:** Should open interactive shell
**Actual:** Hangs indefinitely with spinner

**Error output:**
```
[verbose logs here]
```
```

## 💡 Suggesting Features

### Before Submitting a Feature Request

1. **Check the roadmap** - Is it already planned?
2. **Search existing issues** - Has someone suggested it?
3. **Consider the scope** - Does it fit the project goals?

### How to Submit a Good Feature Request

Use the feature request template and include:

1. **Clear title** - Describe the feature concisely
2. **Problem statement** - What problem does this solve?
3. **Proposed solution** - How should it work?
4. **Alternatives considered** - Other ways to solve this
5. **Use cases** - Real-world scenarios
6. **Implementation ideas** - Optional technical details

## 🔍 Pull Request Process

### Before Submitting

- [ ] Code follows project style guidelines
- [ ] Tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Documentation updated (if needed)
- [ ] CHANGELOG.md updated (for significant changes)
- [ ] Commit messages follow convention
- [ ] Branch is up to date with main

### PR Guidelines

1. **Fill out the PR template** completely
2. **Link related issues** - Use "Fixes #123" or "Closes #123"
3. **Keep PRs focused** - One feature/fix per PR
4. **Small PRs are better** - Easier to review
5. **Respond to feedback** - Address review comments promptly
6. **Be patient** - Maintainers will review as soon as possible

### PR Title Format

Use conventional commit format:
```
feat: add notebook execution from CLI
fix: handle authentication timeout properly
docs: improve troubleshooting guide
```

### Review Process

1. Automated checks run (tests, build, linting)
2. Maintainer reviews code and design
3. Discussion and feedback
4. Revisions if needed
5. Approval and merge

## 🧪 Testing Your Changes

### Local Testing Checklist

Before submitting a PR, test these scenarios:

- [ ] Fresh install: `npm install && npm run build`
- [ ] Authentication flow: `lecoder-cgpu connect`
- [ ] Basic commands work:
  - [ ] `lecoder-cgpu status`
  - [ ] `lecoder-cgpu run "python --version"`
  - [ ] `lecoder-cgpu notebook list`
- [ ] Error handling:
  - [ ] Invalid commands show helpful errors
  - [ ] Network errors are handled gracefully
- [ ] Help text: `lecoder-cgpu --help`

### Testing with Real Colab

For features involving Colab integration:

1. Test with a real Google account
2. Try different runtime types (CPU, GPU, TPU)
3. Test authentication edge cases (expired tokens, etc.)
4. Verify file uploads/downloads work
5. Check command output formatting

## 📚 Documentation

### What Needs Documentation?

- New features and commands
- API changes
- Configuration options
- Common workflows
- Troubleshooting tips

### Documentation Standards

- Use clear, simple language
- Provide code examples
- Include both success and error cases
- Add screenshots for UI changes
- Keep README.md updated
- Update JSDoc comments in code

## 🎯 Areas We Need Help

Current priorities (check issues for details):

- 🌐 **Cross-platform testing** - Windows/Linux compatibility
- 🐳 **Docker support** - Containerized development environment
- 📦 **Binary releases** - Standalone executables for all platforms
- 🧪 **Integration tests** - End-to-end testing framework
- 📝 **Documentation** - Tutorials, examples, video guides
- 🎨 **UX improvements** - Better error messages, progress indicators
- ⚡ **Performance** - Optimize API calls and connection pooling

## 🤝 Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment. Please read our [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before participating.

### Expected Behavior

- Be respectful and inclusive
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards others

### Unacceptable Behavior

- Harassment or discrimination
- Trolling or insulting comments
- Personal or political attacks
- Publishing private information

## 📞 Getting Help

### Where to Ask Questions

- 💬 **GitHub Discussions** - General questions, ideas
- 🐛 **GitHub Issues** - Bug reports, feature requests
- 📧 **Email** - Security issues only: aryateja2106@gmail.com

### Response Times

- Issues: Usually within 48 hours
- PRs: Usually within 1 week
- Security issues: Within 24 hours

## 🏆 Recognition

Contributors are recognized in:

- CHANGELOG.md for significant contributions
- README.md contributors section
- GitHub contributors graph
- Release notes for features/fixes

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

## Thank You! 🙏

Every contribution, no matter how small, makes a difference. We appreciate your time and effort in making LeCoder cGPU CLI better for everyone!

**Happy Coding!** 🚀
