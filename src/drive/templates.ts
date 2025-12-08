import type { NotebookContent } from "./types.js";

/**
 * Get minimal default notebook template.
 */
export function getDefaultTemplate(): NotebookContent {
  return {
    cells: [
      {
        cell_type: "markdown",
        source: ["# New Notebook\n", "\n", "Welcome to your new Colab notebook!"],
        metadata: {},
      },
    ],
    metadata: {
      colab: {
        name: "New Notebook",
        provenance: [],
      },
      kernelspec: {
        name: "python3",
        display_name: "Python 3",
      },
      language_info: {
        name: "python",
        version: "3.10.12",
      },
    },
    nbformat: 4,
    nbformat_minor: 0,
  };
}

/**
 * Get GPU template with GPU detection cells.
 */
export function getGpuTemplate(): NotebookContent {
  return {
    cells: [
      {
        cell_type: "markdown",
        source: ["# GPU Notebook\n", "\n", "This notebook includes GPU setup and detection."],
        metadata: {},
      },
      {
        cell_type: "code",
        source: ["# Check GPU availability\n", "!nvidia-smi"],
        metadata: {},
        outputs: [],
        execution_count: null,
      },
      {
        cell_type: "code",
        source: [
          "# Check PyTorch GPU\n",
          "import torch\n",
          "print(f'CUDA available: {torch.cuda.is_available()}')\n",
          "if torch.cuda.is_available():\n",
          "    print(f'GPU: {torch.cuda.get_device_name(0)}')\n",
          "    print(f'Memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB')",
        ],
        metadata: {},
        outputs: [],
        execution_count: null,
      },
    ],
    metadata: {
      colab: {
        name: "GPU Notebook",
        provenance: [],
      },
      kernelspec: {
        name: "python3",
        display_name: "Python 3",
      },
      language_info: {
        name: "python",
        version: "3.10.12",
      },
      accelerator: "GPU",
    },
    nbformat: 4,
    nbformat_minor: 0,
  };
}

/**
 * Get TPU template with TPU detection cells.
 */
export function getTpuTemplate(): NotebookContent {
  return {
    cells: [
      {
        cell_type: "markdown",
        source: ["# TPU Notebook\n", "\n", "This notebook includes TPU setup and detection."],
        metadata: {},
      },
      {
        cell_type: "code",
        source: [
          "# Check TPU availability\n",
          "import os\n",
          "import torch\n",
          "import torch_xla\n",
          "import torch_xla.core.xla_model as xm\n",
          "\n",
          "print(f'TPU available: {\"TPU_NAME\" in os.environ}')\n",
          "if 'TPU_NAME' in os.environ:\n",
          "    device = xm.xla_device()\n",
          "    print(f'TPU device: {device}')",
        ],
        metadata: {},
        outputs: [],
        execution_count: null,
      },
    ],
    metadata: {
      colab: {
        name: "TPU Notebook",
        provenance: [],
      },
      kernelspec: {
        name: "python3",
        display_name: "Python 3",
      },
      language_info: {
        name: "python",
        version: "3.10.12",
      },
      accelerator: "TPU",
    },
    nbformat: 4,
    nbformat_minor: 0,
  };
}
