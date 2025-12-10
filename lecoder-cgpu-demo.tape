Output lecoder-cgpu-demo.gif

Set FontSize 15
Set Width 1200
Set Height 650
Set Shell bash
Set Theme "Dracula"

# Title
Type "# LeCoder cGPU - GPU Access from Your Terminal"
Enter
Sleep 2s
Enter

# Install
Type "npm install -g lecoder-cgpu"
Enter
Sleep 1s
Hide
Type "added 123 packages in 5s"
Enter
Show
Sleep 1.5s
Enter

# Check status
Type "lecoder-cgpu status"
Enter
Sleep 500ms
Hide
Type "✓ Authenticated"
Enter
Type "  Eligible GPUs: A100, L4, T4"
Enter
Enter
Type "Active Runtime: Colab GPU A100"
Enter
Type "  GPU: NVIDIA A100-SXM4-40GB"  
Enter
Type "  Status: Connected ✓"
Enter
Show
Sleep 2.5s
Enter

# Run Python
Type "lecoder-cgpu run -m kernel 'import torch; print(torch.cuda.is_available())'"
Enter
Sleep 800ms
Hide
Type "True"
Enter
Show
Sleep 1.5s
Enter

# Check GPU
Type "lecoder-cgpu run nvidia-smi"
Enter
Sleep 600ms
Hide
Type "NVIDIA A100-SXM4-40GB"
Enter
Type "Memory: 40960 MB"
Enter
Show
Sleep 1.5s
Enter

# List notebooks  
Type "lecoder-cgpu notebook list -n 2"
Enter
Sleep 600ms
Hide
Type "✔ Found 1 notebook"
Enter
Enter
Type "LeCoder-Notebook.ipynb"
Enter
Type "  Created: 12/8/2025"
Enter
Show
Sleep 2s
Enter

# Done
Type "echo '🚀 Ready to use!'"
Enter
Sleep 500ms
Hide
Type "🚀 Ready to use!"
Enter
Show
Sleep 2s
