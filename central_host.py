from flask import Flask, render_template, request
import threading
import time

app = Flask(__name__)

peers = {}
room_timestamps = {}  # Track when rooms were last accessed
ROOM_TIMEOUT = 30 * 60  # 30 minutes in seconds

def cleanup_old_rooms():
    """Remove rooms that are older than 30 minutes"""
    while True:
        current_time = time.time()
        rooms_to_remove = []
        
        for room_id, last_access_time in room_timestamps.items():
            if current_time - last_access_time > ROOM_TIMEOUT:
                rooms_to_remove.append(room_id)
        
        for room_id in rooms_to_remove:
            del peers[room_id]
            del room_timestamps[room_id]
            print(f"Cleaned up room: {room_id}")
        
        time.sleep(60)  # Check every minute

@app.route('/')
def index():
    return render_template('peers.html')

@app.route('/join', methods=['POST'])
def join_room():
    room_id = request.form['roomId']
    peer_id = request.form['peerId']
    peers[room_id] = peers.get(room_id, []) + [peer_id]
    room_timestamps[room_id] = time.time()  # Update last access time
    return 'Joined room: ' + room_id

@app.route('/get_peers', methods=['POST'])
def get_peers():
    room_id = request.form['roomId']
    if room_id in room_timestamps:
        room_timestamps[room_id] = time.time()  # Update last access time
    return {'peers': peers.get(room_id, [])}


if __name__ == '__main__':
    # Start cleanup thread
    cleanup_thread = threading.Thread(target=cleanup_old_rooms, daemon=True)
    cleanup_thread.start()
    
    app.run(debug=False, 
        host="localhost", 
        port="17890",
        # ssl_context='adhoc'
     )
