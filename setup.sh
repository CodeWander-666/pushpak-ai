#!/bin/bash
# setup.sh – Install Blender and Python dependencies

set -e  # exit on error

echo "=== Bio‑React Backend Setup ==="

# Install Blender (Ubuntu/Debian)
if ! command -v blender &> /dev/null; then
    echo "Installing Blender..."
    sudo apt update
    sudo apt install blender -y
else
    echo "Blender already installed."
fi

# Install Python dependencies
echo "Installing Python packages..."
pip install -r requirements.txt

# Ensure numpy is available for Blender's Python
echo "Checking numpy for Blender..."
BLENDER_PYTHON=$(blender --background --python-expr "import sys; print(sys.executable)" 2>/dev/null | tail -n1 | tr -d '\r')
if [ -n "$BLENDER_PYTHON" ] && [ -f "$BLENDER_PYTHON" ]; then
    echo "Blender Python: $BLENDER_PYTHON"
    "$BLENDER_PYTHON" -m ensurepip --upgrade
    "$BLENDER_PYTHON" -m pip install numpy
else
    echo "⚠️  Could not determine Blender's Python path."
    echo "   Please install numpy manually:"
    echo "   - Find Blender's Python: blender --background --python-expr \"import sys; print(sys.executable)\""
    echo "   - Then run: <python_path> -m pip install numpy"
fi

# Create templates folder and convert any FBX
mkdir -p templates
if [ -f templates/human.fbx ]; then
    echo "Found human.fbx, converting to GLB..."
    python convert_templates.py
else
    echo "No human.fbx found in templates/."
    echo "Please place your Mixamo FBX file in templates/ and run: python convert_templates.py"
fi

echo "✅ Setup complete. Run 'python server.py' to start the backend."