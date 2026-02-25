#!/usr/bin/env python3
"""
Install numpy into Blender's Python environment.
Run this script once before using the auto‑rigging backend.
"""

import subprocess
import sys
import os
import platform

def find_blender_python():
    """Find the Python executable used by Blender."""
    # Try to get it via blender command
    try:
        result = subprocess.run(
            ['blender', '--background', '--python-expr', 'import sys; print(sys.executable)'],
            capture_output=True, text=True, check=True
        )
        # The output contains lines; the last non-empty line is the path
        lines = result.stdout.strip().split('\n')
        for line in reversed(lines):
            path = line.strip()
            if path and os.path.exists(path):
                return path
    except subprocess.CalledProcessError:
        pass
    except FileNotFoundError:
        print("❌ Blender not found in PATH. Please install Blender first.")
        return None

    # Fallback: common locations
    common_paths = [
        "/usr/bin/blender",  # Linux
        "/usr/local/bin/blender",
        "/Applications/Blender.app/Contents/Resources/2.93/python/bin/python3.9",  # macOS
        "/Applications/Blender.app/Contents/Resources/3.0/python/bin/python3.9",
        "C:\\Program Files\\Blender Foundation\\Blender 3.0\\python\\bin\\python.exe",  # Windows
    ]
    for base in common_paths:
        if os.path.exists(base):
            # This is the blender executable, not the python. We need to find python relative to blender.
            # This is complex; better rely on the first method.
            pass
    print("❌ Could not determine Blender's Python path automatically.")
    return None

def install_numpy(python_path):
    """Install numpy using the given Python interpreter."""
    print(f"📌 Using Python: {python_path}")
    # Ensure pip is available
    try:
        subprocess.run([python_path, '-m', 'ensurepip', '--upgrade'], check=True)
    except subprocess.CalledProcessError:
        print("⚠️  ensurepip failed, but maybe pip already exists.")
    # Install numpy
    try:
        subprocess.run([python_path, '-m', 'pip', 'install', 'numpy'], check=True)
        print("✅ numpy installed successfully.")
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to install numpy: {e}")
        return False
    return True

def verify_numpy(python_path):
    """Check if numpy can be imported."""
    try:
        result = subprocess.run(
            [python_path, '-c', 'import numpy; print(numpy.__version__)'],
            capture_output=True, text=True, check=True
        )
        print(f"✅ numpy version {result.stdout.strip()} is available.")
        return True
    except subprocess.CalledProcessError:
        return False

def main():
    python_path = find_blender_python()
    if not python_path:
        sys.exit(1)
    if verify_numpy(python_path):
        print("✅ numpy already installed.")
        return
    if install_numpy(python_path):
        verify_numpy(python_path)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()