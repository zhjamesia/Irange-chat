// Chat and messaging functionality
var messages = {}; // { peerId: [{text, from, isImage, me, ts}, ...] }
var currentPeer = null;
var peerDirectory = {}; // directory of peerId -> display name

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
        if (id !== window.peer.id) {
            addContact(id);
            // restore selected state if this was the currentPeer
            if (currentPeer && id === currentPeer) {
                var sel = contactsListDiv.querySelector('.contact[data-id="'+id+'"]');
                if (sel) sel.classList.add('selected');
            }
        }
    });
}

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

function getCurrentPeer() {
    return currentPeer;
}

function setCurrentPeer(peerId) {
    currentPeer = peerId;
}

function getPeerDirectory() {
    return peerDirectory;
}

function setPeerName(peerId, name) {
    if (typeof name === 'string') {
        peerDirectory[peerId] = name;
    }
}
