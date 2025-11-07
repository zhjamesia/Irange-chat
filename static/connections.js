// Peer connection management
var users = {};
var conn;
var roomId = null;
var refreshTimer = null;

// Helper: get or create a DataConnection and reuse it (important for iOS/Safari)
function getOrCreateConnection(userId, cb) {
    if (!userId) return;
    // reuse existing open connection
    if (users[userId] && users[userId].conn && users[userId].conn.open) {
        return cb(users[userId].conn);
    }
    // create a new connection with reliable flag (helps Safari)
    var c = window.peer.connect(userId, { reliable: true });
    users[userId] = users[userId] || { id: userId };
    users[userId].conn = c;

    c.on('open', function() {
        console.log('Connection open to', userId);
        cb(c);
    });

    c.on('data', function(data) {
        handleIncomingData(data, userId);
    });

    c.on('error', function(err) {
        console.error('Connection error with', userId, err);
    });

    c.on('close', function() {
        console.log('Connection closed to', userId);
        if (users[userId]) delete users[userId].conn;
    });
}

// Handle incoming data from a peer
function handleIncomingData(data, peerId) {
    var peerDir = getPeerDirectory();
    
    // small helper to store a file message and render a download link in chat UI
    function storeAndRenderFile(url, filename) {
        var fromName = peerDir[peerId] || peerId;
        appendFileLink(url, filename, fromName, false, peerId);
    }

    try {
        // Check if data is a file metadata object
        if (data && typeof data === 'object' && !(data instanceof Blob) && !(data instanceof ArrayBuffer) && data.type === 'file') {
            var fileMimeType = data.mimeType || '';
            var fileName = data.filename || ('file_' + Date.now());
            var fileData = data.data;
            
            // If filename doesn't have extension, try to add one from MIME type
            if (fileName.indexOf('.') === -1 && fileMimeType) {
                var ext = getExtensionFromMime(fileMimeType);
                if (ext && ext !== 'bin') {
                    fileName = fileName + '.' + ext;
                }
            }
            
            if (fileMimeType.indexOf('image/') === 0 && typeof fileData === 'string' && fileData.indexOf('data:image/') === 0) {
                // image file
                appendMessage(fileData, (peerDir[peerId] || peerId), true, false, peerId);
            } else {
                // other file — offer as downloadable link
                storeAndRenderFile(fileData, fileName);
            }
        } else if (typeof data === 'string') {
            // data URL (image or other) or plain text
            if (data.indexOf('data:') === 0) {
                handleDataUrlString(data, (peerDir[peerId] || peerId), peerId, false);
            } else {
                // plain text
                appendMessage(data, (peerDir[peerId] || peerId), false, false, peerId);
            }
        } else if (data instanceof Blob) {
            var mime = data.type || '';
            if (mime.indexOf('image/') === 0) {
                // image Blob
                var imgUrl = URL.createObjectURL(data);
                appendMessage(imgUrl, (peerDir[peerId] || peerId), true, false, peerId);
                // schedule revoke after some time (keep enough for user to view/download)
                setTimeout(function(){ URL.revokeObjectURL(imgUrl); }, 60000);
            } else {
                // non-image Blob -> create download link
                var ext = getExtensionFromMime(mime);
                var filename = 'file_' + Date.now() + '.' + ext;
                var url = URL.createObjectURL(data);
                storeAndRenderFile(url, filename);
                setTimeout(function(){ /* keep URL for download; optionally revoke later */ }, 60000);
            }
        } else if (data instanceof ArrayBuffer) {
            var blob = new Blob([data], { type: 'application/octet-stream' });
            var filename = 'file_' + Date.now() + '.bin';
            var url = URL.createObjectURL(blob);
            storeAndRenderFile(url, filename);
            setTimeout(function(){ /* optionally revoke later */ }, 60000);
        } else {
            // fallback: stringify unknown objects
            try { 
                appendMessage(JSON.stringify(data), (peerDir[peerId] || peerId), false, false, peerId); 
            } catch (e) { 
                appendMessage('Peer sent data', (peerDir[peerId] || peerId), false, false, peerId); 
            }
        }
    } catch (e) {
        console.error('Error handling incoming data from', peerId, e);
    }

    // ensure contact appears in list (only if peerId is valid)
    if (peerId) {
        addContact(peerId);
        if (peerId !== getCurrentPeer()) markUnread(peerId);
    }
}

// Handle inbound connections
function setupInboundConnection(c) {
    // store it
    users[c.peer] = users[c.peer] || { id: c.peer };
    users[c.peer].conn = c;

    c.on('data', function(data) {
        handleIncomingData(data, c.peer);
    });

    c.on('open', function() {
        console.log('Inbound connection open from', c.peer);
        if (c.peer) {
            addContact(c.peer);
        }
    });

    c.on('close', function() {
        console.log('Inbound connection closed from', c.peer);
        if (users[c.peer]) delete users[c.peer].conn;
    });

    c.on('error', function(err){
        console.error('Inbound connection error from', c.peer, err);
    });
}

// Refresh peers from server and update UI
function refreshPeersFromServer() {
    if (!roomId) return;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/get_peers', true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.send('roomId=' + encodeURIComponent(roomId));
    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                var respPeers = JSON.parse(xhr.responseText).peers || [];
                // Build directory and ids list (supports both old string and new {id,name})
                var ids = [];
                respPeers.forEach(function(p) {
                    if (typeof p === 'string') {
                        ids.push(p);
                    } else if (p && p.id) {
                        ids.push(p.id);
                        if (typeof p.name === 'string') setPeerName(p.id, p.name || '');
                    }
                });
                renderContacts(ids);
                var userSelect = document.getElementById('userSelect');
                if (userSelect) {
                    userSelect.innerHTML = '<option value="">Select a user to chat with</option>';
                    var peerDir = getPeerDirectory();
                    ids.forEach(function(peerId) {
                        if (peerId !== window.peer.id) {
                            var option = document.createElement('option');
                            option.value = peerId;
                            option.text = peerDir[peerId] || peerId;
                            userSelect.add(option);
                        }
                    });
                }
            } catch (e) { console.warn('Invalid peers response', e); }
        }
    };
}

function joinRoom() {
    var roomIdInput = document.getElementById('roomIdLeft');
    roomId = roomIdInput ? roomIdInput.value : null;
    if (!roomId) { alert('Enter a room id'); return; }
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/join', true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    var username = document.getElementById('usernameInput') ? (document.getElementById('usernameInput').value || '') : '';
    xhr.send('roomId=' + encodeURIComponent(roomId) + '&peerId=' + encodeURIComponent(window.peer.id) + '&username=' + encodeURIComponent(username));
    xhr.onload = function() {
        if (xhr.status === 200) {
            // single immediate refresh (stop periodic polling)
            refreshPeersFromServer();
            if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        } else {
            alert('Failed to join room');
        }
    };
}

function sendMessage() {
    // prefer currentPeer first
    var userId = getCurrentPeer() || (document.getElementById('userSelect') && document.getElementById('userSelect').value) || '';
    if (!userId) { alert('Select a contact to send to.'); return; }

    var imageInput = document.getElementById('imageInput');
    var messageInput = document.getElementById('messageInput');

    if (imageInput && imageInput.files && imageInput.files.length > 0) {
        var file = imageInput.files[0];
        var reader = new FileReader();
        reader.onload = function() {
            var imageData = reader.result;
            // Send file with metadata (filename and type) as an object
            var fileData = {
                type: 'file',
                filename: file.name || 'file',
                mimeType: file.type || '',
                data: imageData
            };
            getOrCreateConnection(userId, function(conn) {
                conn.send(fileData);
                // store and render locally
                if (file.type && file.type.indexOf('image/') === 0) {
                    appendMessage(imageData, 'You', true, true, userId);
                } else {
                    appendFileLink(imageData, file.name || ('file_' + Date.now()), 'You', true, userId);
                }
                imageInput.value = '';
            });
        };
        reader.readAsDataURL(file);
        return;
    }

    var message = messageInput.value && messageInput.value.trim();
    if (message) {
        getOrCreateConnection(userId, function(conn) {
            conn.send(message);
            appendMessage(message, 'You', false, true, userId);
            messageInput.value = '';
        });
    }
}

function getRoomId() {
    return roomId;
}
