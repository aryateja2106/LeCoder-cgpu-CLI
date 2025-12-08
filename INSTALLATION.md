# Installation Guide

Complete step-by-step instructions for installing LeCoder cGPU CLI on all platforms.

## Table of Contents

- [System Requirements](#system-requirements)
- [Quick Install](#quick-install)
- [Platform-Specific Instructions](#platform-specific-instructions)
  - [macOS](#macos)
  - [Linux](#linux)
  - [Windows](#windows)
- [Install from Source](#install-from-source)
- [Verify Installation](#verify-installation)
- [Initial Setup](#initial-setup)
- [Updating](#updating)
- [Uninstalling](#uninstalling)
- [Troubleshooting](#troubleshooting)

---

## System Requirements

### Minimum Requirements
- **Node.js**: 18.0.0 or higher
- **npm**: 9.0.0 or higher
- **Memory**: 512 MB RAM
- **Storage**: 50 MB free space
- **Network**: Internet connection for Colab API

### Recommended
- **Node.js**: 20.x or higher (LTS)
- **npm**: 10.x or higher
- **Memory**: 1 GB RAM
- **Storage**: 100 MB free space

### Supported Platforms
- ✅ macOS 11.0+ (Big Sur and later)
- ✅ Linux (Ubuntu 20.04+, Debian 11+, Fedora 35+, etc.)
- ✅ Windows 10/11 (WSL2 recommended)

### Google Account Requirements
- A Google account (free or paid)
- For best experience: Google Colab Pro or Pro+ subscription (optional)

---

## Quick Install

### Option 1: NPM (Coming Soon)

Once published to npm:

```bash
npm install -g lecoder-cgpu
```

### Option 2: From Source (Current Method)

```bash
# Clone the repository
git clone https://github.com/aryateja2106/LeCoder-cgpu-CLI.git
cd LeCoder-cgpu-CLI

# Install dependencies and build
npm install
npm run build

# Link globally
npm link

# Verify
lecoder-cgpu --version
```

---

## Platform-Specific Instructions

### macOS

#### Prerequisites

**Install Node.js:**

Using Homebrew (recommended):
```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node@20

# Verify installation
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x
```

Using official installer:
1. Download from [nodejs.org](https://nodejs.org/)
2. Install the `.pkg` file
3. Restart terminal

#### Install LeCoder cGPU

```bash
# Clone repository
git clone https://github.com/aryateja2106/LeCoder-cgpu-CLI.git
cd LeCoder-cgpu-CLI

# Install and build
npm install
npm run build

# Create global link
sudo npm link

# Verify
lecoder-cgpu --version
```

#### macOS-Specific Notes

- **Apple Silicon (M1/M2/M3)**: Fully supported, native ARM64 builds
- **Permissions**: May need to allow terminal access in System Preferences → Privacy & Security
- **Gatekeeper**: First run might require "Allow" in security settings

---

### Linux

#### Ubuntu/Debian

**Install Node.js:**

```bash
# Update package list
sudo apt update

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version
npm --version
```

**Install LeCoder cGPU:**

```bash
# Clone repository
git clone https://github.com/aryateja2106/LeCoder-cgpu-CLI.git
cd LeCoder-cgpu-CLI

# Install dependencies
npm install

# Build
npm run build

# Link globally
sudo npm link

# Verify
lecoder-cgpu --version
```

#### Fedora/RHEL/CentOS

**Install Node.js:**

```bash
# Install Node.js 20.x
sudo dnf module enable nodejs:20
sudo dnf install nodejs

# Or using NodeSource repository
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install nodejs
```

**Install LeCoder cGPU:** (same as Ubuntu above)

#### Arch Linux

```bash
# Install Node.js
sudo pacman -S nodejs npm

# Follow standard installation steps
git clone https://github.com/aryateja2106/LeCoder-cgpu-CLI.git
cd LeCoder-cgpu-CLI
npm install
npm run build
sudo npm link
```

---

### Windows

#### Using WSL2 (Recommended)

WSL2 provides the best experience on Windows.

**1. Install WSL2:**

```powershell
# In PowerShell (Admin)
wsl --install
```

Restart your computer.

**2. Install Ubuntu from Microsoft Store**

**3. Inside WSL2 Ubuntu:**

```bash
# Update system
sudo apt update && sudo apt upgrade

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install LeCoder cGPU
git clone https://github.com/aryateja2106/LeCoder-cgpu-CLI.git
cd LeCoder-cgpu-CLI
npm install
npm run build
sudo npm link

# Verify
lecoder-cgpu --version
```

#### Native Windows (Not Recommended)

If you must use native Windows:

**1. Install Node.js:**
- Download from [nodejs.org](https://nodejs.org/)
- Install the Windows Installer (`.msi`)
- Restart PowerShell/Command Prompt

**2. Install Git:**
- Download from [git-scm.com](https://git-scm.com/)

**3. Install LeCoder cGPU:**

```powershell
# In PowerShell
git clone https://github.com/aryateja2106/LeCoder-cgpu-CLI.git
cd LeCoder-cgpu-CLI
npm install
npm run build
npm link

# Verify
lecoder-cgpu --version
```

**Known Issues on Native Windows:**
- Interactive terminal mode may have display issues
- Path handling differences
- Better to use WSL2

---

## Install from Source

### For Development or Latest Features

```bash
# Clone the repository
git clone https://github.com/aryateja2106/LeCoder-cgpu-CLI.git
cd LeCoder-cgpu-CLI

# Checkout specific version (optional)
git checkout v0.4.0

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests (optional)
npm test

# Link globally for CLI access
npm link

# Or run without linking
node dist/src/index.js --help
```

### Development Mode

For contributors and developers:

```bash
# Clone and install
git clone https://github.com/aryateja2106/LeCoder-cgpu-CLI.git
cd LeCoder-cgpu-CLI
npm install

# Watch mode (auto-rebuild on changes)
npm run build -- --watch

# In another terminal, link
npm link

# Make changes and test immediately
lecoder-cgpu --version
```

---

## Verify Installation

After installation, verify everything works:

### 1. Check Version

```bash
lecoder-cgpu --version
# Should output: lecoder-cgpu v0.4.0 (or current version)
```

### 2. Check Help

```bash
lecoder-cgpu --help
# Should show all available commands
```

### 3. Check Node.js

```bash
node --version  # Should be v18.0.0 or higher
npm --version   # Should be 9.0.0 or higher
```

### 4. Test Authentication (Optional)

```bash
lecoder-cgpu status
# Will guide you through OAuth if not authenticated
```

---

## Initial Setup

### First-Time Configuration

1. **Authenticate with Google:**

```bash
lecoder-cgpu connect
```

This will:
- Open your browser for Google OAuth
- Request Colab and Drive permissions
- Save credentials locally
- Create and connect to a runtime

2. **Verify Connection:**

```bash
lecoder-cgpu status
# Should show: ✓ Authenticated as your-email@gmail.com
```

3. **Test GPU Access:**

```bash
lecoder-cgpu run "nvidia-smi"
# Should show GPU information
```

### Configuration Files

LeCoder cGPU stores configuration in:

- **macOS/Linux**: `~/.config/lecoder-cgpu/`
- **Windows**: `%APPDATA%/lecoder-cgpu/`

Structure:
```
~/.config/lecoder-cgpu/
├── credentials/
│   └── session.json        # OAuth credentials
└── state/
    └── history.jsonl       # Execution history
```

---

## Updating

### Update npm Installation (When Published)

```bash
npm update -g lecoder-cgpu
```

### Update from Source

```bash
cd LeCoder-cgpu-CLI

# Pull latest changes
git pull origin main

# Reinstall dependencies
npm install

# Rebuild
npm run build

# Relink if needed
npm link
```

### Check for Updates

```bash
lecoder-cgpu --version
# Compare with latest release on GitHub
```

---

## Uninstalling

### Remove Global Package

```bash
# If installed via npm
npm uninstall -g lecoder-cgpu

# If linked from source
cd LeCoder-cgpu-CLI
npm unlink
```

### Remove Configuration

```bash
# macOS/Linux
rm -rf ~/.config/lecoder-cgpu

# Windows
rmdir /s %APPDATA%\lecoder-cgpu
```

### Remove Source

```bash
# Delete cloned repository
rm -rf LeCoder-cgpu-CLI
```

---

## Troubleshooting

### Installation Issues

#### "npm: command not found"
- Node.js not installed or not in PATH
- Solution: Install Node.js from [nodejs.org](https://nodejs.org/)

#### "Permission denied" during npm link
- Missing sudo privileges
- Solution: Use `sudo npm link` (Linux/macOS)

#### Build errors during "npm install"
- Incompatible Node.js version
- Solution: Install Node.js 18+ (see platform instructions)

#### "Cannot find module" errors
- Dependencies not installed properly
- Solution: Delete `node_modules` and run `npm install` again

```bash
rm -rf node_modules
npm install
```

### Runtime Issues

#### "Authentication failed"
- Google OAuth flow interrupted
- Solution: Clear credentials and re-authenticate

```bash
rm -rf ~/.config/lecoder-cgpu/credentials
lecoder-cgpu connect
```

#### "Cannot connect to runtime"
- Colab API issues or quota limits
- Solution: Check Colab status, wait and retry

#### Command hangs
- Network issues or runtime unresponsive
- Solution: Enable verbose mode

```bash
lecoder-cgpu --verbose run "your command"
```

### Getting Help

If installation fails:

1. Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. Search [GitHub Issues](https://github.com/aryateja2106/LeCoder-cgpu-CLI/issues)
3. Open a new issue with:
   - Operating system and version
   - Node.js version (`node --version`)
   - npm version (`npm --version`)
   - Full error output
   - Steps you've tried

---

## Next Steps

After successful installation:

1. ✅ Read the [Quick Start](./README.md#quick-start) guide
2. ✅ Explore [common use cases](./README.md#common-use-cases)
3. ✅ Check the [full command reference](./README.md#commands-reference)
4. ✅ Join [GitHub Discussions](https://github.com/aryateja2106/LeCoder-cgpu-CLI/discussions)

---

**Need Help?** Open an issue or discussion on GitHub!
