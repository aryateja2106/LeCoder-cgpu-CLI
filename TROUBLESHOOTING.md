# Troubleshooting Guide

Common issues and their solutions when using LeCoder cGPU CLI.

## Table of Contents

- [Quick Diagnostics](#quick-diagnostics)
- [Installation Issues](#installation-issues)
- [Authentication Issues](#authentication-issues)
- [Connection Issues](#connection-issues)
- [Runtime Issues](#runtime-issues)
- [File Transfer Issues](#file-transfer-issues)
- [Notebook Management Issues](#notebook-management-issues)
- [Performance Issues](#performance-issues)
- [Platform-Specific Issues](#platform-specific-issues)
- [Getting More Help](#getting-more-help)

---

## Quick Diagnostics

Before diving into specific issues, run these commands:

```bash
# Check version
lecoder-cgpu --version

# Check Node.js version (must be 18+)
node --version

# Check authentication status
lecoder-cgpu status

# Enable verbose logging for any command
lecoder-cgpu --verbose connect
```

---

## Installation Issues

### Error: "npm: command not found"

**Problem**: Node.js/npm not installed or not in PATH

**Solution**:
```bash
# Install Node.js from https://nodejs.org/
# Then verify:
node --version
npm --version
```

### Error: "Permission denied" during npm link

**Problem**: Missing sudo privileges on Linux/macOS

**Solution**:
```bash
sudo npm link
```

### Error: Build fails with TypeScript errors

**Problem**: Incompatible Node.js version or corrupted dependencies

**Solution**:
```bash
# Check Node.js version (must be 18+)
node --version

# Clean install
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Error: "Cannot find module '@google-auth-library/...'"

**Problem**: Dependencies not installed properly

**Solution**:
```bash
# Reinstall dependencies
npm install

# If still failing, force clean install
rm -rf node_modules
npm ci
```

### Installation Hangs at "npm install"

**Problem**: Network issues or npm registry problems

**Solution**:
```bash
# Try a different registry
npm install --registry https://registry.npmjs.org/

# Or clear npm cache
npm cache clean --force
npm install
```

---

## Authentication Issues

### Error: "Authentication failed"

**Problem**: OAuth flow interrupted or expired credentials

**Solution**:
```bash
# Clear credentials and re-authenticate
rm -rf ~/.config/lecoder-cgpu/credentials
lecoder-cgpu connect
```

### Error: "Invalid scope" or "Insufficient permissions"

**Problem**: Outdated session with old OAuth scopes

**Solution**:
```bash
# Re-authenticate to get updated scopes
rm -rf ~/.config/lecoder-cgpu/credentials
lecoder-cgpu connect
```

### Browser doesn't open during OAuth

**Problem**: No default browser or headless environment

**Solution**:
```bash
# The CLI will show a URL
# Copy and paste it into a browser manually
```

### Error: "redirect_uri_mismatch"

**Problem**: OAuth client configuration issue

**Solution**:
1. Check that `http://localhost:3000/callback` is in your OAuth client's redirect URIs
2. If you created your own OAuth client, update it in Google Cloud Console
3. Use the default client provided in the repo

### Can't Find OAuth Callback Page

**Problem**: Browser opened but shows "This site can't be reached"

**Solution**:
- Wait for the local server to start (takes 1-2 seconds)
- Check if another process is using port 3000
- Try closing and reopening the browser

---

## Connection Issues

### Error: "Cannot connect to runtime"

**Problem**: Runtime not available or network issues

**Solution**:
```bash
# Check Colab status manually
# Visit https://colab.research.google.com/

# Try creating runtime manually first in Colab UI
# Then connect with CLI

# Check your internet connection
ping google.com
```

### Error: "Runtime creation timed out"

**Problem**: Colab is busy or quota limits reached

**Solutions**:
1. Wait a few minutes and retry
2. Check if you've hit Colab usage limits
3. Try requesting a different runtime:
```bash
lecoder-cgpu connect --cpu  # Try CPU if GPU fails
```

### Connection Hangs Indefinitely

**Problem**: Network firewall or proxy blocking WebSocket connections

**Solution**:
```bash
# Check if corporate firewall blocks WebSockets
# Try from a different network

# Enable verbose mode to see where it hangs
lecoder-cgpu --verbose connect
```

### Error: "WebSocket connection failed"

**Problem**: Firewall or proxy blocking WebSocket protocol

**Solutions**:
- Check firewall rules
- Try without VPN
- If on corporate network, check with IT about WebSocket access
- Try from personal network/hotspot

### Runtime Disconnects Frequently

**Problem**: Network instability or Colab idle timeout

**Solutions**:
- Check your network stability
- Colab free tier has shorter idle timeout
- Upgrade to Colab Pro for longer sessions
- Keep connection active with periodic commands:
```bash
# Send keep-alive command every 10 minutes
while true; do lecoder-cgpu run "echo keepalive"; sleep 600; done
```

---

## Runtime Issues

### Error: "No runtime available"

**Problem**: Runtime was terminated or expired

**Solution**:
```bash
# Create a new runtime
lecoder-cgpu connect --new-runtime
```

### GPU Not Available (nvidia-smi fails)

**Problem**: Got CPU runtime instead of GPU

**Solutions**:
```bash
# Explicitly request GPU
lecoder-cgpu connect --variant gpu

# Check Colab GPU availability
# Free tier has limited GPU access
# Peak hours may have no GPUs available

# Consider Colab Pro for guaranteed GPU access
```

### Runtime Runs Out of Memory

**Problem**: Code using too much RAM/VRAM

**Solutions**:
```bash
# Check memory usage
lecoder-cgpu run "free -h"
lecoder-cgpu run "nvidia-smi"

# Clear variables in Python
lecoder-cgpu run --mode kernel "import gc; gc.collect()"

# Restart runtime with more memory (Colab Pro)
lecoder-cgpu connect --new-runtime
```

### Code Execution Times Out

**Problem**: Long-running code or infinite loop

**Solution**:
```bash
# Use background mode for long jobs
lecoder-cgpu run "python long_training.py" --background

# Then check logs
lecoder-cgpu logs

# Or interrupt with Ctrl+C
```

### Error: "Kernel died"

**Problem**: Python kernel crashed (usually out of memory)

**Solutions**:
- Reduce batch size or model size
- Clear unused variables
- Restart kernel:
```bash
lecoder-cgpu connect --new-runtime --mode kernel
```

---

## File Transfer Issues

### Upload Fails with "Permission denied"

**Problem**: Trying to write to protected directory

**Solution**:
```bash
# Upload to /content (recommended)
lecoder-cgpu upload file.py /content/file.py

# Not to system directories like /usr or /bin
```

### Download Fails with "File not found"

**Problem**: File doesn't exist on runtime

**Solution**:
```bash
# Check if file exists
lecoder-cgpu run "ls -la /content/"

# Use correct path
lecoder-cgpu download /content/results.csv ./results.csv
```

### Large File Transfer is Slow

**Problem**: Network speed or file size

**Solutions**:
- Use compression:
```bash
lecoder-cgpu run "tar -czf data.tar.gz /content/data/"
lecoder-cgpu download /content/data.tar.gz ./data.tar.gz
```
- Transfer multiple small files instead of one large file
- Check your network speed

### Upload Interrupted Mid-Transfer

**Problem**: Network interruption or timeout

**Solution**:
- Retry the upload (it will overwrite)
- For very large files, consider uploading to Google Drive and accessing from Colab

---

## Notebook Management Issues

### Error: "Drive API not enabled"

**Problem**: Google Drive API not enabled in Google Cloud Console

**Solution**:
1. Visit https://console.developers.google.com/apis/api/drive.googleapis.com/overview
2. Select your project (or the default one)
3. Click "Enable API"
4. Re-authenticate: `rm -rf ~/.config/lecoder-cgpu/credentials && lecoder-cgpu connect`

### Notebook List is Empty

**Problem**: No notebooks created yet, or wrong account

**Solution**:
```bash
# Check authenticated account
lecoder-cgpu status

# Create a test notebook
lecoder-cgpu notebook create "Test Notebook"

# List again
lecoder-cgpu notebook list
```

### Cannot Delete Notebook

**Problem**: Permission issues or notebook in use

**Solutions**:
- Close the notebook in Colab UI first
- Check if you own the notebook (can't delete shared notebooks)
- Ensure correct notebook ID:
```bash
lecoder-cgpu notebook list  # Get correct ID
lecoder-cgpu notebook delete <id>
```

### Template Not Found

**Problem**: Invalid template name

**Solution**:
```bash
# Valid templates: default, gpu, tpu
lecoder-cgpu notebook create "My Notebook" --template gpu
```

---

## Performance Issues

### Commands Feel Slow

**Problem**: Network latency or API rate limiting

**Solutions**:
- Use verbose mode to see where time is spent:
```bash
lecoder-cgpu --verbose run "command"
```
- Batch operations when possible
- Reuse existing runtime (don't use `--new-runtime`)

### Execution History Growing Large

**Problem**: history.jsonl file getting big

**Solution**:
```bash
# Clear old history
# Backup first if needed
mv ~/.config/lecoder-cgpu/state/history.jsonl ~/.config/lecoder-cgpu/state/history.jsonl.bak

# Or manually trim to recent entries
tail -n 1000 ~/.config/lecoder-cgpu/state/history.jsonl > history_recent.jsonl
mv history_recent.jsonl ~/.config/lecoder-cgpu/state/history.jsonl
```

---

## Platform-Specific Issues

### macOS: "Operation not permitted"

**Problem**: macOS security restrictions

**Solution**:
1. System Preferences → Security & Privacy → Privacy
2. Grant terminal/IDE full disk access
3. Retry command

### macOS: "Unidentified developer" warning

**Problem**: Gatekeeper blocking unsigned binary (if using pre-built binary)

**Solution**:
1. System Preferences → Security & Privacy → General
2. Click "Allow Anyway" next to the blocked message
3. Retry

### Linux: "EACCES: permission denied" on npm link

**Problem**: Need sudo for global npm packages

**Solution**:
```bash
sudo npm link
```

Or setup npm to install globally without sudo:
```bash
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.profile
source ~/.profile
```

### Windows (Native): Terminal Display Issues

**Problem**: ANSI colors or interactive features not working

**Solution**:
- Use WSL2 instead (highly recommended)
- Or use Windows Terminal instead of Command Prompt
- Enable ANSI support:
```powershell
Set-ItemProperty HKCU:\Console VirtualTerminalLevel -Type DWORD 1
```

### Windows (WSL2): "Cannot connect to localhost"

**Problem**: WSL2 networking issues

**Solution**:
```bash
# Check if localhost resolves
ping localhost

# Restart WSL2
wsl --shutdown
# Then reopen WSL terminal
```

---

## Error Codes Reference

When using `--json` mode, errors have numeric codes:

| Code | Category | Description | Solution |
|------|----------|-------------|----------|
| 0 | SUCCESS | Execution successful | N/A |
| 1001 | SYNTAX | Python syntax error | Check code syntax |
| 1002 | RUNTIME | Runtime error | Check error traceback |
| 1003 | TIMEOUT | Execution timed out | Optimize code or increase timeout |
| 1004 | MEMORY | Out of memory | Reduce memory usage or upgrade runtime |
| 1005 | IMPORT | Module import failed | Install missing package |
| 1006 | IO | File/resource error | Check file paths and permissions |
| 1999 | UNKNOWN | Unrecognized error | Check full error message |

---

## Debugging Tips

### Enable Verbose Logging

```bash
lecoder-cgpu --verbose [command]
```

### Check Execution History

```bash
# View recent executions
lecoder-cgpu logs -n 20

# Filter by status
lecoder-cgpu logs --status error

# See statistics
lecoder-cgpu logs --stats
```

### Inspect Credentials

```bash
# Check credential file exists
ls -la ~/.config/lecoder-cgpu/credentials/

# View session info (careful: contains sensitive data)
cat ~/.config/lecoder-cgpu/credentials/session.json
```

### Test Colab Directly

If CLI fails, test Colab manually:
1. Visit https://colab.research.google.com/
2. Create a new notebook
3. Run `!nvidia-smi`
4. If this fails, the issue is with Colab, not the CLI

### Network Debugging

```bash
# Test Google API connectivity
curl -I https://colab.research.google.com/

# Test DNS resolution
nslookup colab.research.google.com

# Check for proxy/firewall
env | grep -i proxy
```

---

## Common Error Messages

### "ECONNREFUSED" or "ENOTFOUND"

**Meaning**: Cannot reach Google APIs

**Solutions**:
- Check internet connection
- Check DNS settings
- Try without VPN
- Check firewall rules

### "401 Unauthorized"

**Meaning**: Invalid or expired credentials

**Solution**:
```bash
rm -rf ~/.config/lecoder-cgpu/credentials
lecoder-cgpu connect
```

### "403 Forbidden"

**Meaning**: Insufficient permissions or API not enabled

**Solutions**:
- Enable Google Drive API (for notebook commands)
- Re-authenticate with correct scopes
- Check Colab usage limits

### "429 Too Many Requests"

**Meaning**: Hit API rate limit

**Solution**:
- Wait a few minutes before retrying
- Batch operations instead of many small requests
- Don't spam commands

### "500 Internal Server Error"

**Meaning**: Colab API temporary issue

**Solution**:
- Wait and retry
- Check Colab status page
- If persists, report to Google

---

## Still Having Issues?

### Before Opening an Issue

1. ✅ Read this troubleshooting guide
2. ✅ Search [existing issues](https://github.com/aryateja2106/LeCoder-cgpu-CLI/issues)
3. ✅ Try with `--verbose` flag
4. ✅ Update to latest version
5. ✅ Try the same action manually in Colab UI

### Opening an Issue

Include in your bug report:

```bash
# System information
uname -a
node --version
npm --version
lecoder-cgpu --version

# Full command with verbose output
lecoder-cgpu --verbose [your-command] 2>&1 | tee error.log
```

**Provide**:
- Operating system and version
- Node.js version
- CLI version
- Full error output (with `--verbose`)
- Steps to reproduce
- Expected vs actual behavior
- What you've tried

### Getting Help

- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/aryateja2106/LeCoder-cgpu-CLI/issues)
- 💬 **Questions**: [GitHub Discussions](https://github.com/aryateja2106/LeCoder-cgpu-CLI/discussions)
- 🔒 **Security Issues**: Email aryateja2106@gmail.com

---

## Known Issues

### Colab Free Tier Limitations

- GPU access not guaranteed (availability varies)
- Shorter idle timeout (~30 minutes)
- Sessions can be terminated during high demand
- **Solution**: Upgrade to Colab Pro for priority access

### Interactive Terminal Lag

- Remote terminal has inherent latency
- Expect 100-300ms delay per keystroke
- **Solution**: Use `run` command for scripts instead of interactive mode

### Large File Handling

- Uploading/downloading very large files (>1GB) can be slow
- **Solution**: Use Google Drive mount or compress files

---

## FAQ

**Q: Why does `connect` take so long?**  
A: Creating a runtime can take 30-60 seconds. Colab needs to provision resources.

**Q: Can I use multiple runtimes simultaneously?**  
A: Currently, CLI manages one runtime at a time per session.

**Q: Does this work with Colab Pro?**  
A: Yes! You'll get priority GPU access and longer sessions.

**Q: Why do I need to re-authenticate?**  
A: OAuth tokens expire after some time. Re-auth is automatic when needed.

**Q: Can I use this in CI/CD?**  
A: Not recommended due to OAuth requirement. Better suited for interactive development.

---

**Still stuck? Open an issue on GitHub with full details!**
