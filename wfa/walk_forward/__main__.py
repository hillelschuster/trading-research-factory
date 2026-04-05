"""
WFA CLI Module Entry Point.

Allows running the WFA CLI as a module:
python -m src.walk_forward [CLI_ARGS]

This module provides access to the Epic 10 CLI system for WFA operations.
"""

import sys
from pathlib import Path

# Add src directory to path for CLI imports
src_path = Path(__file__).parent.parent
sys.path.insert(0, str(src_path))

try:
    from cli.main import cli
except ImportError as e:
    print(f"❌ Failed to import WFA CLI system: {e}")
    print("   Please ensure Epic 10 CLI infrastructure is available")
    sys.exit(1)

if __name__ == "__main__":
    cli()
