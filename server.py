from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import subprocess
import threading
import queue
import sys
import os

app = Flask(__name__)
CORS(app)

# Global queue to hold log messages
log_queue = queue.Queue()

def run_scraper(args):
    """Run the scraper script and pipe output to log_queue."""
    # Ensure unbuffered output so we get lines immediately
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    
    # Path to python executable in virtual env
    venv_python = os.path.join(os.path.dirname(__file__), '.venv', 'Scripts', 'python.exe')
    if not os.path.exists(venv_python):
        venv_python = sys.executable

    cmd = [venv_python, "gmaps_scraper.py"] + args
    
    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env
        )
        
        for line in process.stdout:
            log_queue.put(line)
            
        process.wait()
        log_queue.put(f"\n[DONE] Scraper finished with exit code {process.returncode}")
    except Exception as e:
        log_queue.put(f"\n[ERROR] Failed to run scraper: {str(e)}")

@app.route('/api/scrape', methods=['POST'])
def start_scrape():
    data = request.json
    
    mode = data.get('mode', 'auto')
    input_text = data.get('input_text', '')
    fields = data.get('fields', [])
    max_results = data.get('max_results', 0)
    output_csv = data.get('output_csv', 'output.csv')
    
    if not input_text:
        return jsonify({"error": "URL atau Kata Kunci tidak boleh kosong!"}), 400
        
    args = []
    if "maps" in input_text.lower():
        args.extend(["--url", input_text])
    else:
        args.extend(["--keyword", input_text])
        
    if fields:
        args.extend(["--fields", ",".join(fields)])
        
    if int(max_results) > 0:
        args.extend(["--max-results", str(max_results)])
        
    if output_csv:
        args.extend(["--output", output_csv])
        
    if mode != "auto":
        args.extend(["--mode", mode])
        
    # Clear queue
    while not log_queue.empty():
        try:
            log_queue.get_nowait()
        except:
            pass

    # Start scraping in background thread
    thread = threading.Thread(target=run_scraper, args=(args,))
    thread.daemon = True
    thread.start()
    
    return jsonify({"message": "Scraping started"})

@app.route('/api/logs', methods=['GET'])
def stream_logs():
    def generate():
        while True:
            try:
                # Block for 1 second, yield empty comment to keep connection alive
                line = log_queue.get(timeout=1)
                yield f"data: {line}\n\n"
            except queue.Empty:
                yield ": keep-alive\n\n"
    return Response(generate(), mimetype='text/event-stream')

if __name__ == '__main__':
    print("🚀 Local Engine is running on http://localhost:5000")
    print("⚠️  Dilarang menutup terminal ini selama web frontend digunakan!")
    app.run(port=5000)
