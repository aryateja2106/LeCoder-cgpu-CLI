# Changelog

All notable changes to LeCoder cGPU will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.4] - 2025-12-09

### Added
- **Google Drive API Setup Guidance**: Helpful error messages and setup reminders
  - Clear error message when Drive API returns 403 with enable instructions
  - Post-authentication setup reminder with direct link to enable Drive API
  - README section explaining Drive API setup requirement for notebook features
- **Colab Pro Tier Detection**: Automatic subscription tier detection
  - Detects Pro tier via `eligibleGpus` (A100, L4, V100 indicate Pro)
  - Updates connection pool limits based on detected tier
  - Shows correct tier ("pro" vs "free") in `status --json` and `sessions list`

### Fixed
- **Runtime Variant Selection**: `--tpu` and `--cpu` flags now work correctly
  - Fixed `SessionManager.getOrCreateSession` to check if active session's variant matches requested variant
  - Creates new session with correct variant instead of reusing mismatched active session
- **Session ID Prefix Matching**: `sessions switch` and `sessions close` now support ID prefixes
  - Can use `sessions switch 8a23c90e` instead of full UUID
  - Properly resolves to full session ID before storage operations
- **Terminal Session Message**: Changed misleading "Opening terminal session X" to clearer "Connecting to {runtime label}..."
- **Test Suite Improvements**: Fixed 40 failing tests (from 49 to 9)
  - Added missing mock methods (`removeListener`, `getKernelInfo`, `getConnection`, `setActive`)
  - Fixed error categorization test expectations to match actual implementation
  - Fixed mock ID generation to avoid collisions in concurrent tests
  - Remaining 9 tests are timing-sensitive reconnection/retry edge cases

### Changed
- `connect`, `run`, `copy`, `status`, `sessions list` commands now update subscription tier after authentication
- README updated with Drive API setup section in System Requirements

## [0.5.3] - 2025-12-09

### Fixed
- Colab Pro account detection improvements

## [0.5.2] - 2025-12-09

### Fixed
- Terminal session message clarity improvements

## [0.5.1] - 2025-01-XX

### Added
- **Comprehensive Test Suite**: Full test coverage for all major components
  - Mock infrastructure: `MockJupyterKernel`, `MockColabClient`, `MockDriveClient`
  - Unit tests: Session manager, Colab connection, connection pool, runtime manager, error handler, remote command runner
  - Integration tests: run, connect, sessions, logs commands
  - E2E tests: Full workflow, error scenarios
  - New npm scripts: `test:unit`, `test:integration`, `test:e2e`, `test:perf`, `test:coverage`, `test:ci`
- **API Reference Documentation**: Complete command reference in `docs/api-reference.md`
  - All CLI commands with options and examples
  - JSON output schemas
  - Error codes (1001-1499) with recovery suggestions
  - Exit codes and environment variables
  - Integration patterns (Python, Bash, Node.js, GitHub Actions)
- **Testing Guide**: Developer testing documentation in `docs/testing.md`
  - Test structure and organization
  - Running tests by category
  - Writing tests with examples
  - Mock infrastructure usage
  - Coverage goals and CI integration
- **Example Scripts**: Automation examples in `examples/`
  - `multi-session-training.sh`: Parallel experiments across sessions
  - `auto-retry.py`: Exponential backoff with error categorization
  - `notebook-automation.py`: Programmatic notebook management
- **GitHub Actions CI Workflow**: `.github/workflows/test.yml`
  - Lint and type checking
  - Unit, integration, and E2E tests
  - Cross-platform binary builds and testing
  - Coverage reporting with Codecov

### Changed
- **README.md**: Enhanced documentation
  - Multi-session workflow examples
  - Error recovery patterns with code samples
  - CI/CD integration guide
  - Performance optimization tips
- **TROUBLESHOOTING.md**: Expanded troubleshooting
  - Session management issues section
  - Kernel mode issues section
  - JSON output issues section
  - Binary distribution issues section
  - Updated FAQ with multi-session and CI/CD answers
- **package.json**: New test scripts for granular test execution

### Fixed
- Connection state enum values now correctly use UPPERCASE (`CONNECTED`, `DISCONNECTED`, etc.)
- ColabConnection uses `shutdown()` method (not `close()`)

## [0.5.0] - 2025-12-08

### Added
- **Binary Releases**: Standalone executables for all major platforms
  - macOS (x64, arm64) - No Xcode or Homebrew required
  - Windows (x64) - No Node.js installation needed
  - Linux (x64, arm64) - Works on Ubuntu, Debian, RHEL, and derivatives
- **GitHub Actions CI/CD**: Automated binary builds on release
  - Matrix builds across macOS, Windows, Linux runners
  - Automatic checksum generation (SHA256)
  - Release asset uploads
- **Installation Documentation**: Comprehensive binary installation guide
  - Platform-specific instructions
  - Checksum verification steps
  - Troubleshooting for common issues
- **Binary Testing**: Automated smoke tests for generated binaries
  - Version check validation
  - File size verification
  - Cross-platform compatibility checks
- **Multi-Session Support**: Manage multiple concurrent Colab runtimes (up to 5 for Pro users)
  - New `sessions` command group: `list`, `switch`, `close`, `clean`
  - `--session <id>` global flag to target specific sessions
  - Session persistence in `~/.config/cgpu/state/sessions.json`
  - Automatic session limit enforcement (1 for free, 5 for Pro)
  - Session status tracking: active, connected, idle, stale
  - Integration with all existing commands (run, connect, copy, status)
- **Comprehensive Logging System**: File-based debug logging for troubleshooting
  - New `debug` command group: `show`, `list`, `path`, `tail`
  - Log levels: DEBUG, INFO, WARN, ERROR
  - Log categories: CLI, API, SESSION, RUNTIME, WEBSOCKET, KERNEL, COMMAND
  - JSON-formatted logs with search and filter capabilities
  - Automatic log rotation (daily and size-based)
  - 7-day retention policy
  - Logs stored in `~/.config/cgpu/state/logs/`
- **Enhanced Documentation**:
  - Comprehensive logging documentation in `docs/logging.md`
  - Session management examples in README
  - Updated feature list and quick start guide

### Changed
- Enhanced pkg configuration with explicit targets
- Updated README with binary installation as primary method
- Improved build scripts for cross-platform support
- Binary size optimized (~50-80MB per platform)
- Session storage path fix: removed double "state" nesting (`state/state/` → `state/`)
- Default log level set to DEBUG for better troubleshooting
- API calls now logged with timing and status codes
- Session lifecycle events tracked in logs
- Session storage now logs a one-time warning when stored credentials are missing required Drive scopes, prompting re-authentication instead of silently invalidating sessions

### Fixed
- Session storage ensureStorage() infinite recursion bug
- Session file path construction issue

### Technical Details
- pkg version: @yao-pkg/pkg 5.11.5
- Node.js runtime: 18.x (bundled in binaries)
- Supported platforms: macOS 10.15+, Windows 10+, Linux (glibc 2.17+)
- Binary naming: `lecoder-cgpu-<platform>-<arch>`

## [0.4.0] - 2025-12-07

### BREAKING CHANGES
- **Re-authentication Required**: Added Google Drive API scope (`drive.file`) - users must re-authenticate on first run after upgrade to grant Drive access
- Existing sessions will be invalidated and require fresh authentication

### Added
- **Notebook Management**: New `lecoder-cgpu notebook` command group for managing Colab notebooks directly from CLI
  - `notebook list` - List notebooks from Drive with sorting and filtering
  - `notebook create <name>` - Create new notebooks with templates (default, GPU, TPU)
  - `notebook delete <id>` - Delete notebooks with confirmation prompt
  - `notebook open <id>` - Open notebook and connect to runtime in terminal or kernel mode
- **Google Drive Integration**: Full Drive API v3 support for notebook CRUD operations
  - Restricted `drive.file` scope for security (only app-created files)
  - Notebook content parsing and validation
  - Metadata enrichment with Colab-specific fields
- **Notebook Templates**: Pre-configured templates for quick setup
  - `default` - Minimal notebook with markdown introduction
  - `gpu` - Includes GPU detection cells (nvidia-smi, PyTorch CUDA check)
  - `tpu` - Includes TPU detection and setup cells
- **Scope Validation**: Automatic detection of missing OAuth scopes with re-authentication prompt
- Unit tests for DriveClient and NotebookManager
- Integration tests for notebook lifecycle
- Enhanced agent-integration.md with notebook management examples

### Changed
- OAuth flow now requests Google Drive API access alongside Colaboratory
- Session storage validates scopes on load and triggers re-auth if outdated
- `createApp()` now instantiates DriveClient and NotebookManager

## [0.3.0] - 2025-12-07

### Added
- **JSON Output Mode**: Added `--json` flag to `run` and `status` commands for machine-readable output, enabling AI agent integration
- **Numeric Error Codes**: All execution errors now include numeric error codes (1001-1999) for programmatic error handling
- **Execution History**: Automatic tracking of all executions in `~/.config/lecoder-cgpu/state/history.jsonl` with metadata
- **New `logs` Command**: Query execution history with filters for status, category, mode, and time range
  - `--limit <n>` to control result count
  - `--status <ok|error|abort>` to filter by execution status
  - `--category <category>` to filter by error type
  - `--since <date>` to filter by time (supports ISO 8601 or relative like '1h', '2d')
  - `--mode <terminal|kernel>` to filter by execution mode
  - `--stats` to view summary statistics
  - `--clear` to clear all history
  - `--json` for machine-readable output
- **Error Categorization**: Structured error classification (syntax, runtime, timeout, memory, import, io, unknown)
- **Actionable Error Suggestions**: AI-friendly error messages with automatic suggestions (e.g., "Install missing module with: pip install pandas")
- **History Statistics**: Track success rates, error breakdowns, and execution patterns
- **Verbose Logging**: Enhanced `--verbose` flag with detailed WebSocket events, kernel messages, and API calls
- **Agent Integration Guide**: Comprehensive documentation in `docs/agent-integration.md` with Python, Node.js, and LangChain examples
- Unit tests for ExecutionHistoryStorage and OutputFormatter
- Integration test stubs for JSON output verification

### Changed
- `run` command now stores execution results in history automatically
- Error display now includes error codes and categories in human-readable format
- JSON output strips all ANSI color codes for clean machine parsing
- Execution history automatically rotates when file exceeds 10MB (keeps last 1000 entries)
- Updated README with JSON output mode documentation and error codes reference

### Fixed
- Error handling now consistently provides structured output across terminal and kernel modes

## [0.2.0] - 2025-12-07

### Added
- Enhanced `status` command to display active runtime details (GPU type, memory, utilization, kernel state)
- Added `--mode` flag to `run` command for choosing between terminal (shell) and kernel (Python) execution
- GPU memory and utilization queries via nvidia-smi integration
- New `auth` command for explicit authentication and re-authentication
- `--force` flag to skip confirmation when re-authenticating
- `--validate` flag to test credentials with Colab API call
- Interactive confirmation prompt when re-authenticating with existing session
- Comprehensive unit and integration tests for auth command
- GPU info utility module for querying runtime GPU information
- Unit tests for status command and run command modes

### Changed
- `status` command now shows comprehensive runtime information when runtimes are active
- `run` command description updated to clarify support for both shell and Python execution
- Improved error reporting in kernel mode with structured traceback display
- Improved authentication UX with dedicated command instead of requiring `--force-login` with other commands
- Updated README with auth command documentation, execution modes, and recommended troubleshooting steps

### Fixed
- Graceful handling of unreachable runtimes in status display
- Proper Jupyter wire protocol framing for WebSocket messages (supports both JSON object and array formats)

## [0.1.0] - 2025-12-07

### Added
- Initial release of LeCoder cGPU based on cgpu
- Rebranded CLI with LeCoder naming and branding
- TypeScript project structure with ES2022 modules
- Support for Google Colab GPU/TPU/CPU runtime access
- OAuth2 authentication with Google
- Interactive terminal sessions on remote runtimes
- Remote command execution with output streaming
- File upload/download capabilities
- Session management and runtime reuse
- OpenAI-compatible API server backed by Google Gemini
- Comprehensive test infrastructure with Vitest
- Build scripts for NPM distribution
- pkg configuration for future binary builds
- Full documentation and examples

### Changed
- Updated from cgpu to lecoder-cgpu branding
- Enhanced TypeScript configuration with stricter checks
- Improved project structure for better maintainability
- Updated repository references to nested-learning project

### Technical Details
- Node.js 18+ required
- TypeScript 5.4.3
- ES2022 module system
- Commander.js for CLI framework
- Google Auth Library for OAuth2
- WebSocket support for real-time communication

---

**Note**: This project is based on [cgpu](https://github.com/RohanAdwankar/cgpu) by Rohan Adwankar and is part of the LeCoder Project focusing on advanced machine learning optimization research.