
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

var roomId = null;
var users = {};
var conn;
var localStream;
// single global reference to active MediaConnection (set when call is made/answered)
var activeCall = null;
var remoteOverlayVideo = document.getElementById('remoteOverlayVideo');
var localVideo = document.getElementById('localVideo');
var cameraSelect = document.getElementById('cameraSelect');
var canvas = document.getElementById('canvas');
var context = canvas.getContext('2d');

// New: chat storage and UI helpers
var messages = {}; // { peerId: [{text, from, isImage, me, ts}, ...] }
var currentPeer = null;
var refreshTimer = null;
// directory of peerId -> display name
var peerDirectory = {};

function appendMessage(text, from, isImage, me, peerId) {
    peerId = peerId || currentPeer;
    if (!peerId) return;
    messages[peerId] = messages[peerId] || [];
    messages[peerId].push({ text: text, from: from, isImage: !!isImage, me: !!me, ts: Date.now() });

    // only render if the chat with this peer is active
    if (peerId === currentPeer) {
        var messagesDiv = document.getElementById('chatLog');
        // render single message
        var wrapper = document.createElement('div');
        wrapper.className = 'message ' + (me ? 'me' : 'other');
        var bubble = document.createElement('div');
        bubble.className = 'bubble ' + (me ? 'right' : 'left');
        if (isImage) {
            var img = document.createElement('img');
            img.className = 'msg-img';
            img.src = text;
            // fallback: if image fails to load, replace bubble content with a download link
            img.onerror = function() {
                bubble.innerHTML = '';
                appendFileLink(text, 'image-' + Date.now() + '.png', from, me, peerId, bubble);
            };
            // click to open/download image in new tab
            img.addEventListener('click', function() {
                try { window.open(text, '_blank'); } catch (e) {}
                // attempt programmatic download (some browsers ignore download on cross-origin)
                try {
                    var a = document.createElement('a');
                    a.href = text;
                    a.download = 'image_' + Date.now() + '.png';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                } catch (e) {}
            });
            bubble.appendChild(img);
        } else {
            bubble.textContent = text;
        }
        wrapper.appendChild(bubble);
        var time = document.createElement('div');
        time.className = 'msg-time';
        time.textContent = (from ? (from + ' ') : '') + new Date().toLocaleTimeString();
        wrapper.appendChild(time);
        messagesDiv.appendChild(wrapper);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}

// New helper to append a download link for files/blobs
function appendFileLink(url, filename, from, me, peerId, targetBubble) {
    peerId = peerId || currentPeer;
    messages[peerId] = messages[peerId] || [];
    messages[peerId].push({ text: url, from: from, isImage: false, me: !!me, filename: filename, ts: Date.now() });

    // render into the provided bubble element if one was passed (used by image.onerror) else create wrapper
    var messagesDiv = document.getElementById('chatLog');
    var wrapper = document.createElement('div');
    wrapper.className = 'message ' + (me ? 'me' : 'other');

    var bubble = targetBubble || document.createElement('div');
    if (!targetBubble) bubble.className = 'bubble ' + (me ? 'right' : 'left');

    var a = document.createElement('a');
    a.href = url;
    a.download = filename || '';
    a.textContent = filename || 'Download file';
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.color = '#00c853';
    a.style.textDecoration = 'none';
    a.style.fontWeight = '600';

    // Some environments/browsers ignore download on blob/data URLs. Add a click fallback that fetches and forces download.
    a.addEventListener('click', function(evt) {
        try {
            // If it's a data: URL or same-origin blob: URL, default behavior is usually fine.
            // For others, we attempt fetch->blob->download to increase chance of download working.
            if (url.indexOf('http') === 0) return; // allow normal navigation for http(s)
            evt.preventDefault();
            fetch(url).then(function(res) { return res.blob(); }).then(function(blob) {
                var blobUrl = URL.createObjectURL(blob);
                var ta = document.createElement('a');
                ta.href = blobUrl;
                ta.download = filename || ('file_' + Date.now());
                document.body.appendChild(ta);
                ta.click();
                ta.remove();
                setTimeout(function() { URL.revokeObjectURL(blobUrl); }, 10000);
            }).catch(function() {
                // if fetch fails, fall back to opening the URL in a new tab
                window.open(url, '_blank');
            });
        } catch (e) {
            // ignore and let default behavior occur
        }
    });

    bubble.appendChild(a);
    if (!targetBubble) {
        wrapper.appendChild(bubble);
        var time = document.createElement('div');
        time.className = 'msg-time';
        time.textContent = (from ? (from + ' ') : '') + new Date().toLocaleTimeString();
        wrapper.appendChild(time);
        messagesDiv.appendChild(wrapper);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}

function renderChat(peerId) {
    currentPeer = peerId;
    var messagesDiv = document.getElementById('chatLog');
    messagesDiv.innerHTML = '';
    if (!peerId) {
        document.getElementById('chatTitle') && (document.getElementById('chatTitle').textContent = 'Select a contact');
        return;
    }
    var titleName = peerDirectory[peerId] || peerId;
    document.getElementById('chatTitle') && (document.getElementById('chatTitle').textContent = titleName);
    var list = messages[peerId] || [];
    list.forEach(function(m) {
        var wrapper = document.createElement('div');
        wrapper.className = 'message ' + (m.me ? 'me' : 'other');
        var bubble = document.createElement('div');
        bubble.className = 'bubble ' + (m.me ? 'right' : 'left');
        if (m.isImage) {
            var img = document.createElement('img');
            img.className = 'msg-img';
            img.src = m.text;
            bubble.appendChild(img);
        } else {
            bubble.textContent = m.text;
        }
        wrapper.appendChild(bubble);
        var time = document.createElement('div');
        time.className = 'msg-time';
        time.textContent = (m.from ? (m.from + ' ') : '') + new Date(m.ts).toLocaleTimeString();
        wrapper.appendChild(time);
        messagesDiv.appendChild(wrapper);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Contacts rendering helpers
var contactsListDiv = document.getElementById('contactsList');

function renderContacts(peers) {
    contactsListDiv.innerHTML = '';
    peers.forEach(function(id) {
        if (id !== peer.id) {
            addContact(id);
            // restore selected state if this was the currentPeer
            if (currentPeer && id === currentPeer) {
                var sel = contactsListDiv.querySelector('.contact[data-id="'+id+'"]');
                if (sel) sel.classList.add('selected');
            }
        }
    });
}

// Replace addContact to reliably set currentPeer and support touch
function addContact(id) {
    // Skip if id is null, undefined, or empty
    if (!id) return;
    if (contactsListDiv.querySelector('.contact[data-id="'+id+'"]')) return;
    var el = document.createElement('div');
    el.className = 'contact';
    el.dataset.id = id;
    // Use username if available
    var displayName = peerDirectory[id] || id;
    var safeText = String(displayName);
    var displayShort = safeText.substring(0, 20) + (safeText.length > 20 ? '...' : '');
    el.innerHTML = '<div class="avatar"></div><div class="meta"><strong>' + displayShort + '</strong><small>Tap to chat</small></div><span class="unread-dot"></span>';

    function selectContact() {
        // highlight selection
        Array.from(contactsListDiv.children).forEach(function(c){ c.classList.remove('selected'); });
        el.classList.add('selected');

        // update hidden select (keeps existing logic compatible)
        var us = document.getElementById('userSelect');
        if (us) us.value = id;

        // authoritative selection used by sendAll and render
        currentPeer = id;
        clearUnread(id);
        renderChat(id);
    }

    el.addEventListener('click', selectContact);
    // touchstart improves responsiveness on mobile/touch devices
    el.addEventListener('touchstart', function(evt){
        evt.preventDefault(); // prevent 300ms delay / synthetic mouse events
        selectContact();
    }, { passive:false });

    contactsListDiv.appendChild(el);
}

function markUnread(id) {
    if (!id || id === currentPeer) return;
    var el = contactsListDiv.querySelector('.contact[data-id="'+id+'"]');
    if (el) el.classList.add('unread');
}

function clearUnread(id) {
    var el = contactsListDiv.querySelector('.contact[data-id="'+id+'"]');
    if (el) el.classList.remove('unread');
}

peer.on('error', function(err) {
    console.error('Peer error:', err);
});

// Helper: get or create a DataConnection and reuse it (important for iOS/Safari)
function getOrCreateConnection(userId, cb) {
    if (!userId) return;
    // reuse existing open connection
    if (users[userId] && users[userId].conn && users[userId].conn.open) {
        return cb(users[userId].conn);
    }
    // create a new connection with reliable flag (helps Safari)
    var c = peer.connect(userId, { reliable: true });
    users[userId] = users[userId] || { id: userId };
    users[userId].conn = c;

    c.on('open', function() {
        console.log('Connection open to', userId);
        cb(c);
    });

    // <-- FIX: single data handler (removed nested c.on('data') duplication) -->
    c.on('data', function(data) {
        var peerId = userId;

        // small helper to store a file message and render a download link in chat UI
        function storeAndRenderFile(url, filename) {
            var fromName = peerDirectory[peerId] || peerId;
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
                    appendMessage(fileData, (peerDirectory[peerId] || peerId), true, false, peerId);
                } else {
                    // other file — offer as downloadable link
                    storeAndRenderFile(fileData, fileName);
                }
            } else if (typeof data === 'string') {
                // data URL (image or other) or plain text
                if (data.indexOf('data:') === 0) {
                    if (data.indexOf('data:image/') === 0) {
                        // image data URL — render image
                        appendMessage(data, (peerDirectory[peerId] || peerId), true, false, peerId);
                } else {
                    // other data URL — offer as downloadable link with extension from MIME
                    var mimeMatch = data.match(/^data:([^;,]+)[;,]/);
                    var mimeType = mimeMatch ? mimeMatch[1] : '';
                    var ext = getExtensionFromMime(mimeType);
                    var fn = 'file_' + Date.now() + (ext ? ('.' + ext) : '');
                    storeAndRenderFile(data, fn);
                }
                } else {
                    // plain text
                    appendMessage(data, (peerDirectory[peerId] || peerId), false, false, peerId);
                }
            } else if (data instanceof Blob) {
                var mime = data.type || '';
                if (mime.indexOf('image/') === 0) {
                    // image Blob
                    var imgUrl = URL.createObjectURL(data);
                    appendMessage(imgUrl, (peerDirectory[peerId] || peerId), true, false, peerId);
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
                try { appendMessage(JSON.stringify(data), (peerDirectory[peerId] || peerId), false, false, peerId); } catch (e) { appendMessage('Peer sent data', (peerDirectory[peerId] || peerId), false, false, peerId); }
            }
        } catch (e) {
            console.error('Error handling incoming data from', peerId, e);
        }

        // ensure contact appears in list (only if peerId is valid)
        if (peerId) {
            addContact(peerId);
            if (peerId !== currentPeer) markUnread(peerId);
        }
    });

    c.on('error', function(err) {
        console.error('Connection error with', userId, err);
    });

    c.on('close', function() {
        console.log('Connection closed to', userId);
        if (users[userId]) delete users[userId].conn;
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
                        if (typeof p.name === 'string') peerDirectory[p.id] = p.name || '';
                    }
                });
                renderContacts(ids);
                var userSelect = document.getElementById('userSelect');
                if (userSelect) {
                    userSelect.innerHTML = '<option value="">Select a user to chat with</option>';
                    ids.forEach(function(peerId) {
                        if (peerId !== peer.id) {
                            var option = document.createElement('option');
                            option.value = peerId;
                            option.text = peerDirectory[peerId] || peerId;
                            userSelect.add(option);
                        }
                    });
                }
            } catch (e) { console.warn('Invalid peers response', e); }
        }
    };
}

peer.on('open', function(id) {
    console.log('My peer ID is: ' + id);
    users[id] = users[id] || { id: id };
    addContact(id); // optional, shows self in contacts
    document.getElementById('myPeerId').innerHTML = 'My Peer ID: ' + id;
    // if already had roomId (reconnect), refresh peers once (no polling)
    if (roomId) { refreshPeersFromServer(); if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } }
});

document.getElementById('joinRoomLeft').addEventListener('click', function() {
    roomId = document.getElementById('roomIdLeft').value;
    if (!roomId) { alert('Enter a room id'); return; }
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/join', true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    var username = document.getElementById('usernameInput') ? (document.getElementById('usernameInput').value || '') : '';
    xhr.send('roomId=' + encodeURIComponent(roomId) + '&peerId=' + encodeURIComponent(peer.id) + '&username=' + encodeURIComponent(username));
    xhr.onload = function() {
        if (xhr.status === 200) {
            // single immediate refresh (stop periodic polling)
            refreshPeersFromServer();
            if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        } else {
            alert('Failed to join room');
        }
    };
});

// unified send: prefer currentPeer (explicitly selected contact)
document.getElementById('sendAll').addEventListener('click', function() {
    // prefer currentPeer first
    var userId = currentPeer || (document.getElementById('userSelect') && document.getElementById('userSelect').value) || '';
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

// New helper: request local media on demand (use user gesture)
function ensureLocalStream(cb) {
    if (localStream) {
        // if a camera is selected that differs from current stream, recreate
        var selectedId = cameraSelect.value || null;
        var currentDeviceId = null;
        try {
            var tracks = localStream.getVideoTracks();
            if (tracks && tracks.length) {
                // many browsers provide getSettings().deviceId
                currentDeviceId = tracks[0].getSettings ? tracks[0].getSettings().deviceId : null;
            }
        } catch (e) { currentDeviceId = null; }

        if (selectedId && currentDeviceId !== selectedId) {
            // stop old tracks and fall through to request new stream
            localStream.getTracks().forEach(function(t){ try{ t.stop(); }catch(e){} });
            localStream = null;
        } else {
            if (cb) cb(localStream);
            // try to populate list now that permission granted
            populateCameraList();
            return;
        }
    }

    var selectedDeviceId = cameraSelect.value || null;
    var videoConstraints = selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : { facingMode: 'user' };

    navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true })
    .then(function(stream) {
        localStream = stream;
        // stop previously attached srcObject tracks if any (defensive)
        try {
            localVideo.srcObject = stream;
            localVideo.muted = true;
            localVideo.setAttribute('playsinline', '');
            localVideo.play().catch(function(){ /* ignore autoplay rejection */ });
        } catch (e) {
            console.warn('Could not set localVideo srcObject:', e);
        }
        // update camera dropdown labels now we have permission
        populateCameraList();
        if (cb) cb(stream);
    })
    .catch(function(err) {
        console.error('getUserMedia error:', err);
        alert('Camera/microphone access is required to make/answer calls.');
        if (cb) cb(null);
    });
}

// New: populate available video input devices into cameraSelect
function populateCameraList() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices()
    .then(function(devices) {
        var videoInputs = devices.filter(function(d) { return d.kind === 'videoinput'; });
        // preserve current selection
        var current = cameraSelect.value;
        cameraSelect.innerHTML = '<option value="">Default camera</option>';
        videoInputs.forEach(function(device) {
            var option = document.createElement('option');
            option.value = device.deviceId;
            // use label when available (after permission), fallback to deviceId suffix
            option.text = device.label || ('Camera ' + (cameraSelect.length));
            cameraSelect.add(option);
        });
        // try to restore selection
        if (current) cameraSelect.value = current;
    })
    .catch(function(err) {
        console.warn('Could not list cameras:', err);
    });
}

// When user changes camera selection, re-acquire stream (user gesture recommended)
cameraSelect.addEventListener('change', function() {
    // attempt to switch camera; this will stop old tracks and request new stream
    ensureLocalStream(function(stream){
        if (!stream) {
            console.warn('Switch camera failed or permission denied');
        }
    });
});

document.getElementById('makeCall').addEventListener('click', function() {
    var selectedUserId = currentPeer || (document.getElementById('userSelect') && document.getElementById('userSelect').value);
    if (!selectedUserId) {
        alert('Select a contact to call.');
        return;
    }
    // If desktop is already being shared, use that stream; otherwise get camera
    var streamToUse = isSharingDesktop && desktopStream ? desktopStream : null;
    if (streamToUse) {
        var call = peer.call(selectedUserId, streamToUse);
        activeCall = call;
        call.on('stream', function(remoteStream) {
            showRemoteStream(remoteStream);
        });
        call.on('close', function(){ hideRemoteStream(); });
        call.on('error', function(err){ console.error('Call error', err); hideRemoteStream(); });
    } else {
        ensureLocalStream(function(stream) {
            if (!stream) {
                alert('Unable to get local media');
                return;
            }
            var call = peer.call(selectedUserId, stream);
            activeCall = call;
            call.on('stream', function(remoteStream) {
                showRemoteStream(remoteStream);
            });
            call.on('close', function(){ hideRemoteStream(); });
            call.on('error', function(err){ console.error('Call error', err); hideRemoteStream(); });
        });
    }
});

// Answer incoming calls only after ensuring we have local media
var pendingCall = null;
var answerBtn = document.getElementById('answerCall');

// Replace incoming call handler to show a confirm popup and optionally auto-answer
// (replace the existing peer.on('call', ...) block)
peer.on('call', function(call) {
    console.log('Incoming call from', call.peer);
    // store temporarily so Answer button can still be used if user declines the immediate prompt
    pendingCall = call;

    // show a simple browser confirm popup asking user to accept now
    try {
        var answerNow = confirm('Incoming call from ' + call.peer + '. Answer now?');
    } catch (e) {
        // in some embedded contexts confirm may be blocked; fall back to showing the Answer button
        var answerNow = false;
    }

    if (answerNow) {
        // user accepted; use desktop stream if active, otherwise get local media and answer
        var streamToUse = isSharingDesktop && desktopStream ? desktopStream : null;
        if (streamToUse) {
            try {
                call.answer(streamToUse);
            } catch (e) {
                console.error('Error answering call immediately:', e);
                answerBtn.style.display = 'inline-block';
                return;
            }
            // set active call and wire handlers
            activeCall = call;
            call.on('stream', function(remoteStream) {
                showRemoteStream(remoteStream);
            });
            call.on('close', function() { hideRemoteStream(); });
            call.on('error', function(err){ console.error('Incoming call error', err); hideRemoteStream(); });
            // clear pending and hide answer button since we've answered
            pendingCall = null;
            answerBtn.style.display = 'none';
        } else {
            ensureLocalStream(function(stream) {
                if (!stream) {
                    alert('Camera/microphone access required to answer the call.');
                    // keep pendingCall so user may click Answer manually
                    answerBtn.style.display = 'inline-block';
                    return;
                }
                try {
                    call.answer(stream);
                } catch (e) {
                    console.error('Error answering call immediately:', e);
                    answerBtn.style.display = 'inline-block';
                    return;
                }

                // set active call and wire handlers
                activeCall = call;
                call.on('stream', function(remoteStream) {
                    showRemoteStream(remoteStream);
                });
                call.on('close', function() { hideRemoteStream(); });
                call.on('error', function(err){ console.error('Incoming call error', err); hideRemoteStream(); });

                // clear pending and hide answer button since we've answered
                pendingCall = null;
                answerBtn.style.display = 'none';
            });
        }
    } else {
        // user declined immediate popup — show the UI Answer button as fallback
        answerBtn.style.display = 'inline-block';
        document.getElementById('chatLog').innerHTML += 'Incoming call from ' + call.peer + ' — click Answer to accept<br>';
    }
});

// Add event listener for manual answer button
if (answerBtn) {
    answerBtn.addEventListener('click', function() {
        if (!pendingCall) return;
        var call = pendingCall;
        pendingCall = null;
        
        // Use desktop stream if active, otherwise get local media
        var streamToUse = isSharingDesktop && desktopStream ? desktopStream : null;
        if (streamToUse) {
            try {
                call.answer(streamToUse);
            } catch (e) {
                console.error('Error answering call:', e);
                alert('Error answering call: ' + e.message);
                return;
            }
            activeCall = call;
            call.on('stream', function(remoteStream) {
                showRemoteStream(remoteStream);
            });
            call.on('close', function() { hideRemoteStream(); });
            call.on('error', function(err){ console.error('Incoming call error', err); hideRemoteStream(); });
            answerBtn.style.display = 'none';
        } else {
            ensureLocalStream(function(stream) {
                if (!stream) {
                    alert('Camera/microphone access required to answer the call.');
                    pendingCall = call; // restore pending call
                    return;
                }
                try {
                    call.answer(stream);
                } catch (e) {
                    console.error('Error answering call:', e);
                    alert('Error answering call: ' + e.message);
                    pendingCall = call; // restore pending call
                    return;
                }
                activeCall = call;
                call.on('stream', function(remoteStream) {
                    showRemoteStream(remoteStream);
                });
                call.on('close', function() { hideRemoteStream(); });
                call.on('error', function(err){ console.error('Incoming call error', err); hideRemoteStream(); });
                answerBtn.style.display = 'none';
            });
        }
    });
}

// --- Changed: store inbound connections so we can reuse them ---
peer.on('connection', function(c) {
    // store it
    users[c.peer] = users[c.peer] || { id: c.peer };
    users[c.peer].conn = c;

    c.on('data', function(data) {
        var peerId = c.peer;
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
                appendMessage(fileData, (peerDirectory[peerId] || peerId), true, false, peerId);
            } else {
                // other file — offer as downloadable link
                appendFileLink(fileData, fileName, (peerDirectory[peerId] || peerId), false, peerId);
            }
        } else if (typeof data === 'string') {
            if (data.indexOf('data:') === 0) {
                // data URL: convert and handle accordingly
                handleDataUrlString(data, (peerDirectory[peerId] || peerId), peerId, false);
            } else {
                appendMessage(data, (peerDirectory[peerId] || peerId), false, false, peerId);
            }
        } else if (data instanceof Blob) {
            var mime = data.type || '';
            if (mime.indexOf('image/') === 0) {
                var imgUrl = URL.createObjectURL(data);
                appendMessage(imgUrl, (peerDirectory[peerId] || peerId), true, false, peerId);
            } else {
                var ext = getExtensionFromMime(mime);
                var filename = 'file_' + Date.now() + '.' + ext;
                var url = URL.createObjectURL(data);
                appendFileLink(url, filename, (peerDirectory[peerId] || peerId), false, peerId);
            }
        } else if (data instanceof ArrayBuffer) {
            var blob = new Blob([data], { type: 'application/octet-stream' });
            var filename = 'file_' + Date.now() + '.bin';
            var url = URL.createObjectURL(blob);
            appendFileLink(url, filename, (peerDirectory[peerId] || peerId), false, peerId);
        } else {
            try { appendMessage(JSON.stringify(data), (peerDirectory[peerId] || peerId), false, false, peerId); } catch(e){ appendMessage('Peer sent data', (peerDirectory[peerId] || peerId), false, false, peerId); }
        }
        // if contact not in list yet, add it (only if peerId is valid)
        if (peerId) {
            addContact(peerId);
            if (peerId !== currentPeer) markUnread(peerId);
        }
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
});

// Helper function to handle data URL strings
function handleDataUrlString(data, from, peerId, me) {
    if (data.indexOf('data:image/') === 0) {
        // image data URL — render image
        appendMessage(data, from, true, me, peerId);
    } else {
        // other data URL — offer as downloadable link with extension from MIME
        var mimeMatch = data.match(/^data:([^;,]+)[;,]/);
        var mimeType = mimeMatch ? mimeMatch[1] : '';
        var ext = getExtensionFromMime(mimeType);
        var fn = 'file_' + Date.now() + (ext ? ('.' + ext) : '');
        appendFileLink(data, fn, from, me, peerId);
    }
}

// Helper function to get file extension from MIME type
function getExtensionFromMime(mime) {
    if (!mime) return 'bin';
    // Remove parameters (e.g., charset) from MIME type
    var cleanMime = mime.split(';')[0].trim();
    var mimeMap = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'audio/mpeg': 'mp3',
        'audio/wav': 'wav',
        'audio/ogg': 'ogg',
        'application/pdf': 'pdf',
        'application/zip': 'zip',
        'application/x-zip-compressed': 'zip',
        'application/json': 'json',
        'application/javascript': 'js',
        'application/xml': 'xml',
        'text/plain': 'txt',
        'text/html': 'html',
        'text/css': 'css',
        'text/javascript': 'js',
        'text/csv': 'csv',
        'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/vnd.ms-excel': 'xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.ms-powerpoint': 'ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
    };
    // Check if we have a mapping
    if (mimeMap[cleanMime]) {
        return mimeMap[cleanMime];
    }
    // For known MIME types with standard extensions, try to extract
    var parts = cleanMime.split('/');
    if (parts.length === 2) {
        var type = parts[0];
        var subtype = parts[1];
        // For application types, use 'bin' unless we know the extension
        if (type === 'application' && subtype === 'octet-stream') {
            return 'bin';
        }
        // For other unknown types, use 'bin' as fallback
        // Don't use the subtype directly as it might be 'octet-stream' or other non-extension values
    }
    // Default to 'bin' for unknown types
    return 'bin';
}

// Remove any unconditional navigator.mediaDevices.getUserMedia(...) auto-call at bottom

// --- Changed: show/hide remote video overlay and handle active call reference ---
// activeCall handled above (remove duplicate declaration)
function showRemoteStream(remoteStream) {
    var overlay = document.getElementById('remoteOverlay');
    overlay.style.display = 'block';
    remoteOverlayVideo.srcObject = remoteStream;
    remoteOverlayVideo.setAttribute('playsinline', '');
    remoteOverlayVideo.play().catch(function(){ /* ignore */ });
    
    // Show share desktop button when video call is active
    var shareBtn = document.getElementById('shareDesktop');
    if (shareBtn && activeCall) {
        shareBtn.style.display = 'inline-block';
        // Update button text based on current sharing state
        shareBtn.textContent = isSharingDesktop ? 'Stop Sharing' : 'Share Desktop';
    }
    
    // Handle track changes (e.g., when screen sharing starts during a call)
    // Remove old listeners if any
    if (remoteOverlayVideo._trackListeners) {
        remoteOverlayVideo._trackListeners.forEach(function(cleanup) { cleanup(); });
    }
    if (remoteOverlayVideo._trackMonitorInterval) {
        clearInterval(remoteOverlayVideo._trackMonitorInterval);
        remoteOverlayVideo._trackMonitorInterval = null;
    }
    
    remoteOverlayVideo._trackListeners = [];
    var lastTrackId = null;
    var lastTrackLabel = null;
    
    // Function to refresh the video display
    var refreshVideoDisplay = function() {
        // Always ensure overlay is visible first
        if (overlay) {
            overlay.style.display = 'block';
            overlay.setAttribute('aria-hidden', 'false');
        }
        
        // Ensure video element is properly set up
        if (!remoteOverlayVideo.srcObject || remoteOverlayVideo.srcObject !== remoteStream) {
            remoteOverlayVideo.srcObject = remoteStream;
            remoteOverlayVideo.setAttribute('playsinline', '');
        }
        
        // Force play and refresh
        remoteOverlayVideo.play().catch(function(err) {
            console.warn('Video play failed, retrying:', err);
            // Retry after a short delay
            setTimeout(function() {
                if (remoteOverlayVideo.srcObject === remoteStream) {
                    remoteOverlayVideo.play().catch(function(){ /* ignore */ });
                }
            }, 200);
        });
        
        // Force refresh by temporarily clearing and resetting if needed
        if (remoteOverlayVideo.readyState === 0 || remoteOverlayVideo.paused) {
            var tempSrc = remoteOverlayVideo.srcObject;
            remoteOverlayVideo.srcObject = null;
            setTimeout(function() {
                remoteOverlayVideo.srcObject = tempSrc;
                remoteOverlayVideo.setAttribute('playsinline', '');
                remoteOverlayVideo.play().catch(function(){ /* ignore */ });
                console.log('Remote video display force refreshed');
            }, 100);
        } else {
            console.log('Remote video display refreshed (already playing)');
        }
    };
    
    // Monitor track changes (when replaceTrack is used, the track object changes)
    var monitorTrackChanges = function() {
        var currentTracks = remoteStream.getVideoTracks();
        if (currentTracks.length > 0) {
            var currentTrack = currentTracks[0];
            var currentTrackId = currentTrack.id;
            var currentTrackLabel = currentTrack.label || '';
            var currentTrackReadyState = currentTrack.readyState;
            
            // Always ensure overlay is visible when there's a video track
            if (overlay && overlay.style.display !== 'block') {
                console.log('Video track detected but overlay hidden - showing overlay');
                overlay.style.display = 'block';
            }
            
            // Detect if track has changed (different ID or label indicates replacement)
            var isScreenShare = currentTrackLabel.toLowerCase().indexOf('screen') !== -1 || 
                               currentTrackLabel.toLowerCase().indexOf('display') !== -1 ||
                               currentTrackLabel.toLowerCase().indexOf('desktop') !== -1;
            
            if (lastTrackId !== null && (currentTrackId !== lastTrackId || currentTrackLabel !== lastTrackLabel)) {
                console.log('Remote video track changed (ID or label) - refreshing display. Label:', currentTrackLabel);
                if (isScreenShare) {
                    console.log('Screen sharing detected - ensuring overlay is visible');
                }
                refreshVideoDisplay();
                lastTrackId = currentTrackId;
                lastTrackLabel = currentTrackLabel;
            } else if (lastTrackId === currentTrackId && currentTrackReadyState === 'live' && remoteOverlayVideo.readyState < 2) {
                // Track is live but video element might not be playing - force refresh
                console.log('Track is live but video not playing - refreshing display');
                refreshVideoDisplay();
            } else if (lastTrackId === null) {
                // First time detecting a track - ensure overlay is shown
                console.log('First video track detected - showing overlay. Label:', currentTrackLabel);
                if (isScreenShare) {
                    console.log('Screen sharing detected on first track - showing overlay');
                }
                refreshVideoDisplay();
                lastTrackId = currentTrackId;
                lastTrackLabel = currentTrackLabel;
            } else if (isScreenShare && overlay && overlay.style.display !== 'block') {
                // Screen sharing track detected but overlay not visible - show it
                console.log('Screen sharing track detected but overlay hidden - showing overlay');
                refreshVideoDisplay();
            }
            
            // Update last known values
            if (lastTrackId !== currentTrackId) {
                lastTrackId = currentTrackId;
                lastTrackLabel = currentTrackLabel;
            }
        } else if (lastTrackId !== null) {
            // Track was removed
            console.log('Remote video track removed');
            lastTrackId = null;
            lastTrackLabel = null;
        }
    };
    
    // Initial track info
    var initialTracks = remoteStream.getVideoTracks();
    if (initialTracks.length > 0) {
        lastTrackId = initialTracks[0].id;
        lastTrackLabel = initialTracks[0].label || '';
    }
    
    // Poll for track changes (replaceTrack doesn't fire standard events)
    // Use a shorter interval for more responsive detection
    remoteOverlayVideo._trackMonitorInterval = setInterval(monitorTrackChanges, 300);
    
    // Also do an immediate check after a short delay to catch quick changes
    setTimeout(monitorTrackChanges, 100);
    setTimeout(monitorTrackChanges, 500);
    
    // Listen for track additions (e.g., when desktop sharing replaces camera)
    var handleAddTrack = function(event) {
        if (event.stream === remoteStream && event.track.kind === 'video') {
            console.log('New video track added to remote stream');
            refreshVideoDisplay();
        }
    };
    
    var handleRemoveTrack = function(event) {
        if (event.stream === remoteStream && event.track.kind === 'video') {
            console.log('Video track removed from remote stream');
            // Check if there are still video tracks
            var hasVideo = remoteStream.getVideoTracks().length > 0;
            if (!hasVideo) {
                console.log('No video tracks left in remote stream');
            } else {
                // Track was replaced, refresh display
                setTimeout(refreshVideoDisplay, 100);
            }
        }
    };
    
    // Add listeners to the stream
    remoteStream.addEventListener('addtrack', handleAddTrack);
    remoteStream.addEventListener('removetrack', handleRemoveTrack);
    
    // Store cleanup functions
    remoteOverlayVideo._trackListeners.push(function() {
        remoteStream.removeEventListener('addtrack', handleAddTrack);
        remoteStream.removeEventListener('removetrack', handleRemoveTrack);
        if (remoteOverlayVideo._trackMonitorInterval) {
            clearInterval(remoteOverlayVideo._trackMonitorInterval);
            remoteOverlayVideo._trackMonitorInterval = null;
        }
    });
    
    // Also listen for video track ended events
    remoteStream.getVideoTracks().forEach(function(track) {
        var handleTrackEnded = function() {
            console.log('Remote video track ended');
            // Track ended, check if there's a new track or refresh
            setTimeout(function() {
                var tracks = remoteStream.getVideoTracks();
                if (tracks.length > 0) {
                    refreshVideoDisplay();
                }
            }, 100);
        };
        track.addEventListener('ended', handleTrackEnded);
        remoteOverlayVideo._trackListeners.push(function() {
            track.removeEventListener('ended', handleTrackEnded);
        });
    });
}

function hideRemoteStream() {
    var overlay = document.getElementById('remoteOverlay');
    overlay.style.display = 'none';
    // clear and stop remote video element
    try {
        if (remoteOverlayVideo && remoteOverlayVideo.srcObject) {
            // Clean up track listeners
            if (remoteOverlayVideo._trackListeners) {
                remoteOverlayVideo._trackListeners.forEach(function(cleanup) { cleanup(); });
                remoteOverlayVideo._trackListeners = null;
            }
            remoteOverlayVideo.pause();
            remoteOverlayVideo.srcObject = null;
        }
    } catch (e) { /* ignore */ }
    // hide local preview and clear it as user asked not to show local video
    try {
        if (localVideo) { localVideo.style.display = 'none'; localVideo.srcObject = null; }
    } catch (e) {}
    // Hide share desktop button when call ends
    var shareBtn = document.getElementById('shareDesktop');
    if (shareBtn) {
        shareBtn.style.display = 'none';
    }
    // clear activeCall reference (call will be closed where appropriate)
    activeCall = null;
}

document.getElementById('hangupBtn').addEventListener('click', function() {
    if (!activeCall && !pendingCall) return;
    if (!confirm('Hang up the call?')) return;
    // close active media call (PeerJS MediaConnection) if present
    try {
        if (activeCall && typeof activeCall.close === 'function') {
            activeCall.close();
        }
    } catch (e) { console.warn('Error closing active call', e); }
    // also close pending/incoming call if present
    try {
        if (pendingCall && typeof pendingCall.close === 'function') pendingCall.close();
    } catch (e) {}
    // hide overlay and clear video UI
    hideRemoteStream();
});

// Desktop sharing functionality
var desktopStream = null;
var isSharingDesktop = false;

function startDesktopShare() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert('Desktop sharing is not supported in your browser. Please use Chrome, Edge, or Firefox.');
        return;
    }

    navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        .then(function(stream) {
            desktopStream = stream;
            isSharingDesktop = true;
            
            // Update local video to show desktop
            if (localVideo) {
                localVideo.srcObject = stream;
                localVideo.muted = true;
                localVideo.style.display = 'block';
                localVideo.play().catch(function() { /* ignore */ });
            }

            // If there's an active call, replace the video track
            if (activeCall) {
                var videoTrack = stream.getVideoTracks()[0];
                var sender = activeCall.peerConnection.getSenders().find(function(s) {
                    return s.track && s.track.kind === 'video';
                });
                if (sender && videoTrack) {
                    sender.replaceTrack(videoTrack).catch(function(err) {
                        console.error('Error replacing track:', err);
                    });
                }
            }

            // Handle when user stops sharing via browser UI
            stream.getVideoTracks()[0].onended = function() {
                stopDesktopShare();
            };

            // Update button text (only if button is visible, i.e., during active call)
            var shareBtn = document.getElementById('shareDesktop');
            if (shareBtn && activeCall) {
                shareBtn.textContent = 'Stop Sharing';
            }
        })
        .catch(function(err) {
            console.error('Error getting display media:', err);
            if (err.name === 'NotAllowedError') {
                alert('Desktop sharing permission was denied.');
            } else if (err.name === 'NotFoundError') {
                alert('No screen/window/tab available to share.');
            } else {
                alert('Error starting desktop share: ' + err.message);
            }
        });
}

function stopDesktopShare() {
    if (desktopStream) {
        // Stop all tracks in the desktop stream
        desktopStream.getTracks().forEach(function(track) {
            track.stop();
        });
        desktopStream = null;
        isSharingDesktop = false;
    }

    // If there's an active call, switch back to camera or stop video
    if (activeCall) {
        ensureLocalStream(function(stream) {
            if (stream) {
                var videoTrack = stream.getVideoTracks()[0];
                var sender = activeCall.peerConnection.getSenders().find(function(s) {
                    return s.track && s.track.kind === 'video';
                });
                if (sender && videoTrack) {
                    sender.replaceTrack(videoTrack).catch(function(err) {
                        console.error('Error replacing track with camera:', err);
                    });
                }
            } else {
                // No camera available, remove video track
                var sender = activeCall.peerConnection.getSenders().find(function(s) {
                    return s.track && s.track.kind === 'video';
                });
                if (sender) {
                    sender.replaceTrack(null).catch(function(err) {
                        console.error('Error removing video track:', err);
                    });
                }
            }
        });
    } else {
        // No active call, just ensure local video shows camera
        ensureLocalStream(function(stream) {
            if (stream && localVideo) {
                localVideo.srcObject = stream;
                localVideo.style.display = 'block';
            } else if (localVideo) {
                localVideo.style.display = 'none';
            }
        });
    }

    // Update button text (only if button is visible, i.e., during active call)
    var shareBtn = document.getElementById('shareDesktop');
    if (shareBtn && activeCall) {
        shareBtn.textContent = 'Share Desktop';
    }
}

// Add event listener for desktop sharing button
document.getElementById('shareDesktop').addEventListener('click', function() {
    // Only allow sharing if there's an active call
    if (!activeCall) {
        alert('Please start a video call first before sharing your desktop.');
        return;
    }
    if (isSharingDesktop) {
        stopDesktopShare();
    } else {
        startDesktopShare();
    }
});