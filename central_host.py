from flask import Flask, render_template, request

app = Flask(__name__)

peers = {}

@app.route('/')
def index():
    return render_template('peers.html')

@app.route('/join', methods=['POST'])
def join_room():
    room_id = request.form['roomId']
    peer_id = request.form['peerId']
    peers[room_id] = peers.get(room_id, []) + [peer_id]
    return 'Joined room: ' + room_id

@app.route('/get_peers', methods=['POST'])
def get_peers():
    room_id = request.form['roomId']
    return {'peers': peers.get(room_id, [])}


if __name__ == '__main__':
    app.run(debug=False, 
        host="0.0.0.0", 
        port="7890",
        ssl_context='adhoc'
     )
