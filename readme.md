# PeerJS P2P Chat (Irange Chat)

Simple PeerJS-based peer-to-peer chat + video demo served by a minimal Flask host.

Features
- Text and file/image transfer over PeerJS DataConnections.
- One-to-one video calls (getUserMedia + PeerJS MediaConnection).
- Simple room registry (Flask) to discover peers by room ID.
- Small UI with contact list, file attach, camera selection and an overlay for remote video.

Prerequisites
- Python 3.7+
- A modern browser (Chrome/Edge/Firefox; Safari support may be limited)
- Network connectivity between peers (STUN used; a TURN server may be required for strict NATs)

Quick setup
1. Create a Python virtualenv (recommended)
   - python -m venv .venv
   - .venv\Scripts\activate (Windows) or source .venv/bin/activate (macOS/Linux)

2. Install Flask
   - pip install flask

Run the local host
- From the project folder run:
  - python d:\notebook\p2p\central_host.py
- The app runs with a self-signed HTTPS (Flask `ssl_context='adhoc'`) on:
  - https://0.0.0.0:7890

Usage
1. Open the URL shown in your browser (use https://localhost:7890 if testing locally).
2. The page will create a PeerJS ID (displayed in the header).
3. Enter a Room ID and click "Join Room" to register your peer with the Flask registry.
4. The contacts list updates (peers in the same room). Select a contact to open chat.
5. Send text or attach a file/image and click Send. Click "Call" to start a video call.
6. Incoming calls prompt to answer (or show the Answer button as fallback).

Notes & Troubleshooting
- HTTPS / getUserMedia:
  - Browsers require secure contexts for camera/microphone. The adhoc cert is self-signed — expect browser warnings. For production use a valid certificate.
- File downloads / data URLs:
  - Some browsers restrict `download` on cross-origin or blob URLs. The UI includes fallback to fetch+download, but if a browser blocks it, open the file in a new tab and save manually.
- Mobile / Safari:
  - Autoplay/policy differences require user gestures. The UI mutes local preview and uses `playsinline` to help.
  - Safari may need `reliable: true` on PeerJS connections and may not support all features.
- NAT / Connectivity:
  - Only STUN servers are configured by default. If peers cannot connect, add a TURN server to the PeerJS config.
- Security:
  - This example is educational. Do not expose adhoc self-signed servers to production traffic. Validate inputs and add authentication for real deployments.

Files of interest
- templates/peers.html — main client UI and PeerJS logic.
- central_host.py — minimal Flask host that serves peers.html and a simple room registry.

License
- MIT (use/modify as you like).

If you want, I can add a requirements.txt, an optional TURN server config block, or a small shell script to run the app with a user-provided TLS certificate.
