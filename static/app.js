// Main application initialization and coordination
// Dependencies: chat.js, utils.js, video.js, connections.js

var peer = new Peer({
    secure: true,
    debug: 2,
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    }
});

// Make peer globally accessible for other modules
window.peer = peer;

var canvas = document.getElementById('canvas');
var context = canvas ? canvas.getContext('2d') : null;

// Peer event handlers
peer.on('error', function(err) {
    console.error('Peer error:', err);
});

peer.on('open', function(id) {
    console.log('My peer ID is: ' + id);
    addContact(id); // optional, shows self in contacts
    document.getElementById('myPeerId').innerHTML = 'My Peer ID: ' + id;
    // if already had roomId (reconnect), refresh peers once (no polling)
    var currentRoomId = getRoomId();
    if (currentRoomId) { 
        refreshPeersFromServer(); 
    }
});

peer.on('call', function(call) {
    handleIncomingCall(call);
});

peer.on('connection', function(c) {
    setupInboundConnection(c);
});

// UI Event Listeners
document.getElementById('joinRoomLeft').addEventListener('click', function() {
    joinRoom();
});

document.getElementById('sendAll').addEventListener('click', function() {
    sendMessage();
});

// Send on Enter when focused in the message textbox (Shift+Enter inserts newline)
var messageInputEl = document.getElementById('messageInput');
if (messageInputEl) {
    messageInputEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            var sendBtn = document.getElementById('sendAll');
            if (sendBtn) sendBtn.click();
        }
    });
}

document.getElementById('makeCall').addEventListener('click', function() {
    makeCall();
});

// Answer call button
var answerBtn = document.getElementById('answerCall');
if (answerBtn) {
    answerBtn.addEventListener('click', function() {
        answerCallManually();
    });
}

document.getElementById('hangupBtn').addEventListener('click', function() {
    hangupCall();
});

// Desktop sharing button
document.getElementById('shareDesktop').addEventListener('click', function() {
    toggleDesktopShare();
});
