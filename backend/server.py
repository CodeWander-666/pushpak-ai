import os
import uuid
import hashlib
import subprocess
import threading
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(__file__)
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
OUTPUT_FOLDER = os.path.join(BASE_DIR, 'outputs')
TEMPLATE_FOLDER = os.path.join(BASE_DIR, 'templates')
ALLOWED_EXT = {'glb', 'gltf', 'obj', 'fbx'}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

# In-memory task storage (for production, replace with Redis)
tasks = {}

def get_file_hash(data):
    return hashlib.sha256(data).hexdigest()

def run_blender(input_path, template_path, output_path, task_id):
    """Run Blender headless with rigger.py."""
    cmd = [
        'blender', '--background', '--python', os.path.join(BASE_DIR, 'rigger.py'),
        '--', input_path, template_path, output_path
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode == 0:
            tasks[task_id] = {'status': 'SUCCESS', 'output': output_path}
        else:
            tasks[task_id] = {'status': 'FAILURE', 'error': result.stderr}
    except Exception as e:
        tasks[task_id] = {'status': 'FAILURE', 'error': str(e)}
    finally:
        # Clean up input file
        if os.path.exists(input_path):
            os.remove(input_path)

@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Empty filename'}), 400
    ext = file.filename.rsplit('.', 1)[-1].lower()
    if ext not in ALLOWED_EXT:
        return jsonify({'error': f'Unsupported file type. Allowed: {ALLOWED_EXT}'}), 400

    data = file.read()
    if len(data) > 50 * 1024 * 1024:  # 50 MB
        return jsonify({'error': 'File too large (max 50MB)'}), 400

    # Check cache by file hash
    file_hash = get_file_hash(data)
    cached_path = os.path.join(OUTPUT_FOLDER, f"{file_hash}.glb")
    if os.path.exists(cached_path):
        task_id = str(uuid.uuid4())
        tasks[task_id] = {'status': 'SUCCESS', 'output': cached_path}
        return jsonify({'task_id': task_id})

    # Save uploaded file
    input_filename = f"{uuid.uuid4()}.{ext}"
    input_path = os.path.join(UPLOAD_FOLDER, input_filename)
    with open(input_path, 'wb') as f:
        f.write(data)

    # Use human template by default (you can extend to multiple templates)
    template_path = os.path.join(TEMPLATE_FOLDER, 'human.glb')
    if not os.path.exists(template_path):
        return jsonify({'error': 'Template not found. Please run convert_templates.py first.'}), 500

    task_id = str(uuid.uuid4())
    tasks[task_id] = {'status': 'PROCESSING'}
    threading.Thread(target=run_blender, args=(input_path, template_path, cached_path, task_id)).start()
    return jsonify({'task_id': task_id})

@app.route('/status/<task_id>')
def status(task_id):
    task = tasks.get(task_id)
    if not task:
        return jsonify({'error': 'Invalid task ID'}), 404
    if task['status'] == 'SUCCESS':
        return jsonify({'status': 'SUCCESS', 'download_url': f'/download/{task_id}'})
    elif task['status'] == 'FAILURE':
        return jsonify({'status': 'FAILURE', 'error': task.get('error', 'Unknown error')})
    else:
        return jsonify({'status': 'PROCESSING'})

@app.route('/download/<task_id>')
def download(task_id):
    task = tasks.get(task_id)
    if not task or task['status'] != 'SUCCESS':
        return jsonify({'error': 'File not ready'}), 404
    return send_file(task['output'], as_attachment=True, download_name='rigged.glb')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)