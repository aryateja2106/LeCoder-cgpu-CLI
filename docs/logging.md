# Logging System Documentation

## Overview

LeCoder-cgpu includes a comprehensive file-based logging system designed to help developers and users debug issues, monitor application behavior, and track API interactions with Google Colab services. The logging system operates in the background without impacting user experience and provides powerful tools for troubleshooting.

## Architecture

### Core Components

#### FileLogger Class
Located in `src/utils/file-logger.ts`, the FileLogger is the main logging engine that handles:
- Asynchronous log writing with a write queue
- Automatic log file rotation by date and size
- JSON-formatted log entries for easy parsing
- Log level filtering (DEBUG, INFO, WARN, ERROR)
- Log retention policies (configurable, defaults to 7 days)

#### Log Entry Format
Each log entry is stored as a single-line JSON object:

```json
{
  "timestamp": "2025-12-08T19:50:43.681Z",
  "level": 0,
  "levelName": "DEBUG",
  "category": "API",
  "message": "GET /tun/m/assignments",
  "data": {
    "statusCode": 200,
    "durationMs": 128
  }
}
```

**Fields:**
- `timestamp`: ISO 8601 formatted UTC timestamp
- `level`: Numeric level (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
- `levelName`: Human-readable level name
- `category`: Log category (CLI, API, SESSION, RUNTIME, WEBSOCKET, KERNEL, COMMAND)
- `message`: Primary log message
- `data`: Optional structured data object
- `error`: Optional error object with name, message, and stack trace

### Log Categories

The logging system organizes entries by category:

| Category | Purpose | Example Events |
|----------|---------|----------------|
| **CLI** | Application lifecycle | Startup, shutdown, command execution |
| **API** | Colab API interactions | HTTP requests/responses, status codes, timing |
| **SESSION** | Session management | Create, switch, close, expire events |
| **RUNTIME** | Runtime operations | Assignment, connection, disconnection |
| **WEBSOCKET** | WebSocket events | Open, close, message, reconnect |
| **KERNEL** | Jupyter kernel messages | Execute requests, outputs, status changes |
| **COMMAND** | Command execution | Shell commands with exit codes and timing |

### Log Levels

The system supports four log levels in order of severity:

1. **DEBUG** (0): Detailed diagnostic information for development
   - API request/response details
   - Session state changes
   - Internal function calls

2. **INFO** (1): General informational messages
   - Application startup
   - Successful operations
   - Session lifecycle events

3. **WARN** (2): Warning messages for potential issues
   - Deprecated feature usage
   - Recoverable errors
   - Configuration warnings

4. **ERROR** (3): Error conditions requiring attention
   - API failures
   - Connection errors
   - Unrecoverable operations

## Storage Location

### Default Paths

**macOS:**
```
~/Library/Preferences/cgpu/state/logs/
```

**Linux:**
```
~/.config/cgpu/state/logs/
```

### File Naming

Log files are named by date: `cgpu-YYYY-MM-DD.log`

Examples:
- `cgpu-2025-12-08.log`
- `cgpu-2025-12-07.log`

### Rotation Policy

**Daily Rotation:**
- New log file created at midnight (local time)
- Previous day's logs are kept according to retention policy

**Size-Based Rotation:**
- If a single log file exceeds 10MB, it's rotated with a timestamp suffix
- Example: `cgpu-2025-12-08-1733687123456.log`

**Retention:**
- Logs older than 7 days are automatically deleted
- Configurable via `retentionDays` option

## CLI Commands

### View Logs

#### Show Recent Entries
```bash
lecoder-cgpu debug show
```

Display the 50 most recent log entries with formatted output.

**Options:**
- `-n, --lines <count>` - Number of entries to show (default: 50)
- `-l, --level <level>` - Minimum log level: debug, info, warn, error (default: info)
- `-c, --category <category>` - Filter by category (CLI, API, SESSION, etc.)
- `-s, --search <text>` - Search for text in messages or data
- `--json` - Output raw JSON instead of formatted text

**Examples:**
```bash
# Show last 100 entries at DEBUG level
lecoder-cgpu debug show -n 100 -l debug

# Show only API errors
lecoder-cgpu debug show -l error -c API

# Search for a specific session ID
lecoder-cgpu debug show -s "66fb1911"

# Get JSON output for further processing
lecoder-cgpu debug show --json | jq '.[] | select(.category=="API")'
```

#### Tail Logs
```bash
lecoder-cgpu debug tail
```

Show the most recent log entries in chronological order (oldest first), similar to `tail -f`.

**Options:**
- `-n, --lines <count>` - Number of entries to show (default: 20)

**Example:**
```bash
lecoder-cgpu debug tail -n 50
```

### Manage Log Files

#### List Available Logs
```bash
lecoder-cgpu debug list
```

Shows all log files with their filenames, sorted by date (newest first).

**Output:**
```
Log files:
Location: /Users/username/Library/Preferences/cgpu/state/logs

  cgpu-2025-12-08.log
  cgpu-2025-12-07.log
  cgpu-2025-12-06.log
```

#### Show Log Directory Path
```bash
lecoder-cgpu debug path
```

Prints the absolute path to the logs directory. Useful for scripts or manual inspection.

**Output:**
```
/Users/username/Library/Preferences/cgpu/state/logs
```

## Programmatic Access

### Initialize Logger

The logger is automatically initialized when the application starts, but you can also initialize it manually:

```typescript
import { initFileLogger, LogLevel } from "./utils/file-logger.js";

const logger = initFileLogger("/path/to/logs", {
  minLevel: LogLevel.DEBUG,
  consoleOutput: false,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  retentionDays: 7,
});
```

### Get Global Logger Instance

```typescript
import { getFileLogger } from "./utils/file-logger.js";

const logger = getFileLogger();
if (logger) {
  logger.info("MyCategory", "Operation completed", { duration: 123 });
}
```

### Logging Methods

#### Basic Logging
```typescript
logger.debug("CATEGORY", "Debug message", { key: "value" });
logger.info("CATEGORY", "Info message", { userId: 123 });
logger.warn("CATEGORY", "Warning message", { deprecated: true });
logger.error("CATEGORY", "Error occurred", error, { context: "data" });
```

#### Specialized Logging

**API Calls:**
```typescript
logger.logApi("POST", "/api/endpoint", 200, 145);
// Logs with statusCode and durationMs
```

**Session Events:**
```typescript
logger.logSession("create", sessionId, { label: "GPU Session" });
logger.logSession("switch", sessionId, { previousSession: oldId });
logger.logSession("close", sessionId);
```

**Runtime Events:**
```typescript
logger.logRuntime("assign", { variant: "GPU", accelerator: "A100" });
logger.logRuntime("connect", { endpoint: "gpu-a100-123" });
logger.logRuntime("error", { endpoint: "gpu-a100-123" }, error);
```

**Command Execution:**
```typescript
logger.logCommand("python", ["script.py"], 1234, 0);
// Logs: command, args, durationMs, exitCode
```

**WebSocket Events:**
```typescript
logger.logWebSocket("open", { endpoint: "wss://..." });
logger.logWebSocket("error", { reason: "timeout" }, error);
```

**Kernel Messages:**
```typescript
logger.logKernel("execute_request", { code: "print('hello')" });
logger.logKernel("stream", { name: "stdout", text: "hello" });
```

### Create Category-Specific Logger

For convenience, create a logger bound to a specific category:

```typescript
import { createCategoryLogger } from "./utils/file-logger.js";

const logger = createCategoryLogger("MYMODULE");

logger.debug("Starting operation", { param: value });
logger.info("Operation completed");
logger.warn("Deprecated method used");
logger.error("Operation failed", error);
```

### Search and Query Logs

```typescript
const logger = getFileLogger();

// Search with filters
const entries = await logger.searchLogs({
  level: LogLevel.ERROR,
  category: "API",
  startDate: new Date("2025-12-01"),
  endDate: new Date("2025-12-08"),
  searchText: "timeout",
  limit: 100,
});

for (const entry of entries) {
  console.log(`${entry.timestamp} [${entry.levelName}] ${entry.message}`);
}
```

### Read Specific Log File

```typescript
const logger = getFileLogger();

// List available files
const files = await logger.listLogFiles();
// ["cgpu-2025-12-08.log", "cgpu-2025-12-07.log", ...]

// Read specific file
const entries = await logger.readLogFile("cgpu-2025-12-08.log");
for (const entry of entries) {
  // Process each log entry
}
```

## Configuration

### Environment Variables

**LECODER_CGPU_DEBUG**
When set, enables console output in addition to file logging:
```bash
export LECODER_CGPU_DEBUG=1
lecoder-cgpu run "python script.py"
```

This will show debug logs in the terminal while also writing to files.

### Programmatic Configuration

Customize logger behavior when initializing:

```typescript
const logger = initFileLogger(logsDir, {
  minLevel: LogLevel.INFO,        // Don't log DEBUG messages
  maxFileSize: 50 * 1024 * 1024,  // 50MB per file
  retentionDays: 30,              // Keep logs for 30 days
  consoleOutput: true,            // Mirror logs to console
});
```

## Best Practices

### When to Log

**DO Log:**
- API requests and responses (timing, status codes)
- Session lifecycle events (create, switch, close)
- Runtime assignments and connections
- Error conditions with full context
- User-initiated commands
- Performance metrics

**DON'T Log:**
- Sensitive data (OAuth tokens, API keys, passwords)
- Large binary data
- High-frequency polling events (use sampling)
- Normal control flow in hot paths

### Log Level Guidelines

**Use DEBUG for:**
- Detailed function entry/exit traces
- Variable values during debugging
- API request/response bodies
- Internal state changes

**Use INFO for:**
- Application startup/shutdown
- Successful operations
- Session creation/switching
- Runtime assignments

**Use WARN for:**
- Deprecated feature usage
- Recoverable errors
- Fallback behavior triggered
- Configuration issues

**Use ERROR for:**
- Failed API calls
- Unrecoverable errors
- Resource exhaustion
- Invalid user input

### Performance Considerations

The logging system is designed for minimal performance impact:

1. **Async Writing**: Logs are written asynchronously using a queue
2. **Non-blocking**: Application doesn't wait for log writes
3. **Batch Processing**: Multiple logs can be written in a single I/O operation
4. **Level Filtering**: DEBUG logs can be disabled in production

### Privacy and Security

**Automatic Safeguards:**
- OAuth tokens are not logged
- Authorization headers are stripped
- User passwords never appear in logs

**Manual Review:**
- Before sharing logs, review for sensitive data
- Use `debug show --json` to filter specific fields
- Redact session IDs or endpoints if needed

## Troubleshooting

### Logs Not Appearing

1. **Check log directory exists:**
   ```bash
   lecoder-cgpu debug path
   ls -la $(lecoder-cgpu debug path)
   ```

2. **Verify log level:**
   ```bash
   # Try with DEBUG level
   lecoder-cgpu debug show -l debug
   ```

3. **Check file permissions:**
   ```bash
   ls -la $(lecoder-cgpu debug path)
   # Should be readable/writable by current user
   ```

### Disk Space Issues

If logs consume too much space:

1. **Reduce retention period** (edit initialization in `src/index.ts`):
   ```typescript
   retentionDays: 3  // Keep only 3 days
   ```

2. **Manually delete old logs:**
   ```bash
   cd $(lecoder-cgpu debug path)
   find . -name "cgpu-*.log" -mtime +7 -delete
   ```

3. **Increase rotation size** to have fewer files:
   ```typescript
   maxFileSize: 50 * 1024 * 1024  // 50MB
   ```

### Parsing JSON Logs

Use `jq` for powerful log analysis:

```bash
# Extract all API errors
lecoder-cgpu debug show --json | jq '.[] | select(.category=="API" and .level==3)'

# Show timing for slow API calls
lecoder-cgpu debug show --json | jq '.[] | select(.category=="API" and .data.durationMs > 1000)'

# Count errors by category
lecoder-cgpu debug show --json | jq -r '.[] | select(.level==3) | .category' | sort | uniq -c

# Export to CSV
lecoder-cgpu debug show --json | jq -r '.[] | [.timestamp, .levelName, .category, .message] | @csv'
```

## Integration with Monitoring

### Export to External Systems

**Example: Send errors to monitoring service**
```typescript
import { getFileLogger } from "./utils/file-logger.js";

const logger = getFileLogger();
if (logger) {
  logger.on("error", async (entry) => {
    // Only send ERROR level
    if (entry.level === LogLevel.ERROR) {
      await sendToMonitoring(entry);
    }
  });
}
```

**Note:** The FileLogger extends EventEmitter and emits an "error" event for all logged errors.

### Real-time Log Monitoring

For development, use file watching:

```bash
# macOS/Linux
tail -f $(lecoder-cgpu debug path)/cgpu-$(date +%Y-%m-%d).log | jq .

# Or with grep for specific categories
tail -f $(lecoder-cgpu debug path)/cgpu-*.log | grep -E '"category":"API"'
```

## Examples

### Debug Runtime Assignment Issues

```bash
# Show all runtime-related logs
lecoder-cgpu debug show -c RUNTIME -l debug -n 100

# Check for assignment failures
lecoder-cgpu debug show -c RUNTIME -l error
```

### Track Session Lifecycle

```bash
# Show session events
lecoder-cgpu debug show -c SESSION -n 50

# Search for specific session
lecoder-cgpu debug show -s "66fb1911" -l debug
```

### Analyze API Performance

```bash
# Export API calls to JSON and analyze
lecoder-cgpu debug show -c API --json > api-logs.json

# Find slow API calls (> 500ms)
cat api-logs.json | jq '.[] | select(.data.durationMs > 500)'

# Calculate average API response time
cat api-logs.json | jq '[.[] | .data.durationMs] | add / length'
```

### Debug Connection Issues

```bash
# Show WebSocket events
lecoder-cgpu debug show -c WEBSOCKET -l debug

# Check for connection errors
lecoder-cgpu debug show -c WEBSOCKET -l error

# Correlate with runtime logs
lecoder-cgpu debug show -l debug | grep -E '(WEBSOCKET|RUNTIME)'
```

## Future Enhancements

Planned improvements to the logging system:

1. **Structured Metrics**: Export metrics in Prometheus format
2. **Log Aggregation**: Support for remote log shipping (syslog, Loki)
3. **Performance Profiling**: Built-in flamegraph generation
4. **Interactive Browser**: Web UI for log exploration
5. **Alerting**: Configurable alerts for error patterns

## Related Documentation

- [Session Management](./sessions.md) - Multi-session support
- [API Reference](./api.md) - Colab API integration
- [Troubleshooting Guide](../TROUBLESHOOTING.md) - Common issues
- [Development Guide](../CONTRIBUTING.md) - Contributing to cgpu

## Support

If you encounter issues with the logging system:

1. Check this documentation
2. Review existing logs: `lecoder-cgpu debug show -l error`
3. Open an issue with relevant log excerpts (redact sensitive data)
4. Include output of `lecoder-cgpu --version` and `lecoder-cgpu debug path`
