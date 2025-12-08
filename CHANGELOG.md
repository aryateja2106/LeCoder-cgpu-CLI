# Changelog

All notable changes to LeCoder cGPU will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
