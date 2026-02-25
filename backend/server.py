import os
import uuid
import hashlib
import threading
import time
import logging
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import pipeline  # our new pipeline module

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(__file__)
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
OUTPUT_FOLDER = os.path.join(BASE_DIR, 'outputs')
TEMPLATE_FOLDER = os.path.join(BASE_DIR, 'templates')
ALLOWED_EXT = {'glb', 'gltf', 'obj', 'fbx'}
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

tasks = {}  # in-memory task store

def get_file_hash(data):
    return hashlib.sha256(data).hexdigest()

def run_pipeline_task(input_path, template_path, output_path, task_id):
    """Background task that runs the pipeline and updates task status."""
    try:
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # Run the pipeline
        final_path = pipeline.run_pipeline(input_path, os.path.dirname(output_path), template_path)

        # final_path should be the same as output_path (if not, copy it)
        if final_path != output_path:
            import shutil
            shutil.copy2(final_path, output_path)

        tasks[task_id] = {'status': 'SUCCESS', 'output': output_path}
        logger.info(f"Pipeline succeeded for task {task_id}")
    except Exception as e:
        logger.exception(f"Pipeline failed for task {task_id}")
        tasks[task_id] = {'status': 'FAILURE', 'error': str(e)}
    finally:
        # Clean up uploaded file
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
    if len(data) > MAX_FILE_SIZE:
        return jsonify({'error': f'File too large (max {MAX_FILE_SIZE//1024//1024}MB)'}), 400

    file_hash = get_file_hash(data)
    cached_path = os.path.join(OUTPUT_FOLDER, f"{file_hash}.glb")
    if os.path.exists(cached_path):
        logger.info(f"Cache hit for hash {file_hash}")
        task_id = str(uuid.uuid4())
        tasks[task_id] = {'status': 'SUCCESS', 'output': cached_path}
        return jsonify({'task_id': task_id})

    # Save uploaded file
    input_filename = f"{uuid.uuid4()}.{ext}"
    input_path = os.path.join(UPLOAD_FOLDER, input_filename)
    with open(input_path, 'wb') as f:
        f.write(data)

    # Use template (human.glb by default)
    template_path = os.path.join(TEMPLATE_FOLDER, 'human.glb')
    if not os.path.exists(template_path):
        logger.error("Template file missing: human.glb")
        return jsonify({'error': 'Template not found. Please run convert_templates.py first.'}), 500

    task_id = str(uuid.uuid4())
    tasks[task_id] = {'status': 'PROCESSING'}

    # Start pipeline in background thread
    threading.Thread(target=run_pipeline_task, args=(input_path, template_path, cached_path, task_id)).start()
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
    filepath = task['output']
    if not os.path.exists(filepath):
        logger.error(f"Download failed: file not found {filepath}")
        return jsonify({'error': 'Rigged file missing on server'}), 500
    return send_file(filepath, as_attachment=True, download_name='rigged.glb')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)