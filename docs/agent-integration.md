# AI Agent Integration Guide

This guide explains how to integrate `lecoder-cgpu` with AI agents and automation tools using structured JSON output and execution history.

## JSON Output Mode

All commands that produce execution results support a `--json` flag for machine-readable output.

### Run Command with JSON

```bash
lecoder-cgpu run --json "print('Hello from GPU!')"
```

**JSON Output Structure:**
```json
{
  "status": "ok",
  "errorCode": 0,
  "stdout": "Hello from GPU!\n",
  "timing": {
    "started": "2024-01-01T12:00:00.000Z",
    "completed": "2024-01-01T12:00:01.234Z",
    "duration_ms": 1234
  },
  "execution_count": 1
}
```

### Error Handling

When execution fails, the JSON includes detailed error information:

```json
{
  "status": "error",
  "errorCode": 1005,
  "error": {
    "name": "ImportError",
    "message": "No module named 'pandas'",
    "category": "import",
    "description": "Import Error - A required module could not be imported",
    "traceback": [
      "Traceback (most recent call last):",
      "  File \"<stdin>\", line 1, in <module>",
      "ImportError: No module named 'pandas'"
    ],
    "suggestion": "Install missing module with: pip install pandas"
  }
}
```

## Error Codes Reference

All errors include numeric codes for programmatic handling:

| Code | Category | Description | Common Causes |
|------|----------|-------------|---------------|
| 0 | SUCCESS | Execution completed successfully | N/A |
| 1001 | SYNTAX | Python syntax error | Typos, incorrect indentation, invalid Python syntax |
| 1002 | RUNTIME | Runtime error during execution | NameError, TypeError, ValueError, AttributeError |
| 1003 | TIMEOUT | Execution timed out or was interrupted | Long-running code, infinite loops, KeyboardInterrupt |
| 1004 | MEMORY | Out of memory error | Large tensors, memory leaks, insufficient GPU memory |
| 1005 | IMPORT | Module import failed | Missing dependencies, incorrect module names |
| 1006 | IO | File or resource access error | File not found, permission denied, disk full |
| 1999 | UNKNOWN | Unrecognized error type | Unexpected exceptions, system errors |

## Execution History

`lecoder-cgpu` automatically tracks all executions in `~/.config/lecoder-cgpu/state/history.jsonl`.

### Query History

```bash
# Get last 10 executions
lecoder-cgpu logs -n 10 --json

# Get failed executions from last hour
lecoder-cgpu logs --status error --since 1h --json

# Get import errors
lecoder-cgpu logs --category import --json

# Get kernel executions only
lecoder-cgpu logs --mode kernel --json
```

**History Entry Structure:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2024-01-01T12:00:00.000Z",
    "command": "import pandas as pd",
    "mode": "kernel",
    "runtime": {
      "label": "Colab GPU T4",
      "accelerator": "T4"
    },
    "status": "error",
    "errorCode": 1005,
    "error": {
      "ename": "ImportError",
      "evalue": "No module named 'pandas'",
      "traceback": ["..."]
    },
    "timing": {
      "duration_ms": 123
    }
  }
]
```

### History Statistics

```bash
lecoder-cgpu logs --stats --json
```

```json
{
  "totalExecutions": 150,
  "successfulExecutions": 130,
  "failedExecutions": 18,
  "abortedExecutions": 2,
  "successRate": 86.7,
  "errorsByCategory": {
    "import": 5,
    "runtime": 10,
    "syntax": 3
  },
  "executionsByMode": {
    "terminal": 50,
    "kernel": 100
  },
  "oldestEntry": "2024-01-01T00:00:00.000Z",
  "newestEntry": "2024-01-02T12:00:00.000Z"
}
```

## Integration Examples

### Python Integration

```python
import json
import subprocess

def run_on_gpu(code: str) -> dict:
    """Execute Python code on Colab GPU and return structured result."""
    result = subprocess.run(
        ["lecoder-cgpu", "run", "--json", "-m", "kernel", code],
        capture_output=True,
        text=True
    )
    
    output = json.loads(result.stdout)
    
    if output["errorCode"] != 0:
        raise RuntimeError(f"GPU execution failed: {output['error']['message']}")
    
    return output

# Usage
try:
    result = run_on_gpu("import torch; print(torch.cuda.is_available())")
    print(f"Output: {result['stdout']}")
    print(f"Duration: {result['timing']['duration_ms']}ms")
except RuntimeError as e:
    print(f"Error: {e}")
```

### LangChain Tool Integration

```python
from langchain.tools import Tool
from typing import Dict, Any
import json
import subprocess

def execute_gpu_code(code: str) -> str:
    """Execute Python code on remote GPU."""
    result = subprocess.run(
        ["lecoder-cgpu", "run", "--json", "-m", "kernel", code],
        capture_output=True,
        text=True
    )
    
    output = json.loads(result.stdout)
    
    if output["errorCode"] != 0:
        error = output["error"]
        return f"Error ({error['category']}): {error['message']}\\nSuggestion: {error.get('suggestion', 'N/A')}"
    
    return output.get("stdout", "Execution completed successfully")

gpu_tool = Tool(
    name="GPU Executor",
    func=execute_gpu_code,
    description="Execute Python code on a remote GPU. Useful for training models, running computations, or testing GPU availability."
)
```

### Node.js Integration

```javascript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function runOnGPU(code) {
  const { stdout, stderr } = await execAsync(
    `lecoder-cgpu run --json -m kernel "${code.replace(/"/g, '\\\\"')}"`
  );
  
  if (stderr) {
    throw new Error(`Execution error: ${stderr}`);
  }
  
  const result = JSON.parse(stdout);
  
  if (result.errorCode !== 0) {
    throw new Error(`GPU Error [${result.errorCode}]: ${result.error.message}`);
  }
  
  return result;
}

// Usage
try {
  const result = await runOnGPU('print("Hello from GPU")');
  console.log('Output:', result.stdout);
  console.log('Duration:', result.timing.duration_ms, 'ms');
} catch (error) {
  console.error('Failed:', error.message);
}
```

## Retry Logic Based on Error Categories

```python
import time
import json
import subprocess
from typing import Optional

def execute_with_retry(code: str, max_retries: int = 3) -> dict:
    """Execute code with automatic retry for transient errors."""
    retryable_categories = ["timeout", "io", "unknown"]
    
    for attempt in range(max_retries):
        result = subprocess.run(
            ["lecoder-cgpu", "run", "--json", "-m", "kernel", code],
            capture_output=True,
            text=True
        )
        
        output = json.loads(result.stdout)
        
        # Success
        if output["errorCode"] == 0:
            return output
        
        # Check if error is retryable
        error_category = output.get("error", {}).get("category", "unknown")
        
        if error_category not in retryable_categories:
            # Non-retryable error (syntax, import, etc.)
            raise RuntimeError(f"Non-retryable error: {output['error']['message']}")
        
        # Last attempt
        if attempt == max_retries - 1:
            raise RuntimeError(f"Max retries exceeded: {output['error']['message']}")
        
        # Wait before retry
        wait_time = 2 ** attempt  # Exponential backoff
        time.sleep(wait_time)
    
    raise RuntimeError("Execution failed after all retries")
```

## Status Monitoring

```bash
# Check runtime status as JSON
lecoder-cgpu status --json
```

```json
{
  "authenticated": true,
  "account": {
    "id": "user@example.com",
    "label": "User Name"
  },
  "eligibleGpus": ["T4", "P100", "V100"],
  "runtimes": [
    {
      "label": "Colab GPU T4",
      "endpoint": "https://...",
      "accelerator": "T4",
      "connected": true,
      "gpu": {
        "name": "Tesla T4",
        "memory": {
          "total": "15360 MiB",
          "used": "1024 MiB",
          "free": "14336 MiB"
        },
        "utilization": {
          "gpu": "15%",
          "memory": "6%"
        }
      },
      "kernel": {
        "id": "abc123",
        "state": "idle",
        "executionCount": 5
      }
    }
  ]
}
```

## Notebook Management for AI Agents

AI agents can programmatically manage Colab notebooks using the `notebook` command group with JSON output.

### Create Notebook

```bash
lecoder-cgpu notebook create "experiment-001" --template gpu --json
```

**JSON Output:**
```json
{
  "id": "1abc123xyz",
  "name": "experiment-001.ipynb",
  "createdTime": "2024-01-01T12:00:00.000Z",
  "modifiedTime": "2024-01-01T12:00:00.000Z",
  "webViewLink": "https://colab.research.google.com/drive/1abc123xyz",
  "colabName": "experiment-001"
}
```

### List Notebooks

```bash
lecoder-cgpu notebook list --limit 10 --json
```

**JSON Output:**
```json
[
  {
    "id": "1abc123xyz",
    "name": "experiment-001.ipynb",
    "createdTime": "2024-01-01T12:00:00.000Z",
    "modifiedTime": "2024-01-01T12:05:30.000Z",
    "webViewLink": "https://colab.research.google.com/drive/1abc123xyz",
    "colabName": "experiment-001"
  }
]
```

### Delete Notebook

```bash
lecoder-cgpu notebook delete 1abc123xyz --force --json
```

**JSON Output:**
```json
{
  "deleted": true,
  "id": "1abc123xyz",
  "name": "experiment-001.ipynb"
}
```

### Example: Automated Experiment Tracking

```python
import json
import subprocess
from datetime import datetime

class ColabExperimentManager:
    def create_experiment(self, name: str, template: str = "gpu") -> dict:
        """Create a new experiment notebook."""
        result = subprocess.run(
            ["lecoder-cgpu", "notebook", "create", name, "--template", template, "--json"],
            capture_output=True,
            text=True,
            check=True
        )
        return json.loads(result.stdout)
    
    def list_experiments(self) -> list:
        """List all experiment notebooks."""
        result = subprocess.run(
            ["lecoder-cgpu", "notebook", "list", "--json"],
            capture_output=True,
            text=True,
            check=True
        )
        return json.loads(result.stdout)
    
    def cleanup_old_experiments(self, days: int = 7):
        """Delete experiments older than specified days."""
        notebooks = self.list_experiments()
        cutoff = datetime.now().timestamp() - (days * 86400)
        
        for nb in notebooks:
            created = datetime.fromisoformat(nb["createdTime"].replace("Z", "+00:00"))
            if created.timestamp() < cutoff:
                print(f"Deleting old notebook: {nb['name']}")
                subprocess.run(
                    ["lecoder-cgpu", "notebook", "delete", nb["id"], "--force", "--json"],
                    check=True
                )

# Usage
manager = ColabExperimentManager()

# Create experiment
exp = manager.create_experiment("training-run-001", template="gpu")
print(f"Created: {exp['webViewLink']}")

# List experiments
experiments = manager.list_experiments()
print(f"Total experiments: {len(experiments)}")

# Cleanup
manager.cleanup_old_experiments(days=7)
```

### Drive API Error Codes

Notebook operations may encounter Drive-specific errors:

| HTTP Status | Meaning | Suggested Action |
|-------------|---------|------------------|
| 404 | Notebook not found | Verify file ID, check if notebook was deleted |
| 403 | Permission denied | Re-authenticate with `lecoder-cgpu auth --force` |
| 429 | Rate limit exceeded | Implement exponential backoff (wait 1s, 2s, 4s...) |
| 500 | Drive API error | Retry with exponential backoff |

## Best Practices

1. **Always check error codes**: Use numeric error codes instead of parsing error messages
2. **Implement category-based retry logic**: Retry timeout/IO errors, fail fast on syntax/import errors
3. **Use execution history for debugging**: Query history to identify patterns in failures
4. **Parse suggestions for user feedback**: Error suggestions provide actionable next steps
5. **Monitor GPU memory**: Check status before running memory-intensive operations
6. **Clean up history periodically**: Use `lecoder-cgpu logs --clear` to reset history
7. **Store notebook IDs**: Save notebook IDs from create operations for later access
8. **Handle rate limits**: Implement exponential backoff for Drive API operations

## Advanced: Automated Dependency Installation

```python
import json
import subprocess
import re

def install_missing_modules(code: str) -> None:
    """Automatically install missing Python modules."""
    result = subprocess.run(
        ["lecoder-cgpu", "run", "--json", "-m", "kernel", code],
        capture_output=True,
        text=True
    )
    
    output = json.loads(result.stdout)
    
    if output["errorCode"] == 1005:  # Import error
        error_msg = output["error"]["message"]
        match = re.search(r"No module named '([^']+)'", error_msg)
        
        if match:
            module = match.group(1)
            print(f"Installing {module}...")
            
            # Install the module
            install_result = subprocess.run(
                ["lecoder-cgpu", "run", "-m", "kernel", f"!pip install {module}"],
                capture_output=True,
                text=True
            )
            
            if install_result.returncode == 0:
                print(f"Successfully installed {module}")
                # Retry original code
                return execute_gpu_code(code)
        
    return output
```

## Troubleshooting

### JSON Parsing Errors

If you encounter JSON parsing errors, ensure:
- You're using the `--json` flag
- No extra output is mixed with JSON (check stderr separately)
- The command completed successfully (check exit code)

### Missing History Entries

History is written after execution completes. If a command crashes or is interrupted, the entry may not be saved.

### Error Code Mappings

Error codes are consistent across all execution modes (terminal and kernel). The same error will always produce the same error code.

## Related Commands

- `lecoder-cgpu run --help` - Full options for run command
- `lecoder-cgpu logs --help` - Full options for logs command
- `lecoder-cgpu status --help` - Full options for status command
