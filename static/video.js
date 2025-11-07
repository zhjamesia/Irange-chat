// Video call and desktop sharing functionality
var localStream;
var activeCall = null;
var pendingCall = null;
var remoteOverlayVideo = document.getElementById('remoteOverlayVideo');
var localVideo = document.getElementById('localVideo');
var cameraSelect = document.getElementById('cameraSelect');
var desktopStream = null;
var isSharingDesktop = false;

// Camera and local media management
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

// When user changes camera selection, re-acquire stream
cameraSelect.addEventListener('change', function() {
    // attempt to switch camera; this will stop old tracks and request new stream
    ensureLocalStream(function(stream){
        if (!stream) {
            console.warn('Switch camera failed or permission denied');
        }
    });
});

// Making and answering calls
function makeCall() {
    var selectedUserId = getCurrentPeer() || (document.getElementById('userSelect') && document.getElementById('userSelect').value);
    if (!selectedUserId) {
        alert('Select a contact to call.');
        return;
    }
    // If desktop is already being shared, use that stream; otherwise get camera
    var streamToUse = isSharingDesktop && desktopStream ? desktopStream : null;
    if (streamToUse) {
        var call = window.peer.call(selectedUserId, streamToUse);
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
            var call = window.peer.call(selectedUserId, stream);
            activeCall = call;
            call.on('stream', function(remoteStream) {
                showRemoteStream(remoteStream);
            });
            call.on('close', function(){ hideRemoteStream(); });
            call.on('error', function(err){ console.error('Call error', err); hideRemoteStream(); });
        });
    }
}

function handleIncomingCall(call) {
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
        answerCallImmediately(call);
    } else {
        // user declined immediate popup — show the UI Answer button as fallback
        var answerBtn = document.getElementById('answerCall');
        if (answerBtn) answerBtn.style.display = 'inline-block';
        document.getElementById('chatLog').innerHTML += 'Incoming call from ' + call.peer + ' — click Answer to accept<br>';
    }
}

function answerCallImmediately(call) {
    var answerBtn = document.getElementById('answerCall');
    // use desktop stream if active, otherwise get local media and answer
    var streamToUse = isSharingDesktop && desktopStream ? desktopStream : null;
    if (streamToUse) {
        try {
            call.answer(streamToUse);
        } catch (e) {
            console.error('Error answering call immediately:', e);
            if (answerBtn) answerBtn.style.display = 'inline-block';
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
        if (answerBtn) answerBtn.style.display = 'none';
    } else {
        ensureLocalStream(function(stream) {
            if (!stream) {
                alert('Camera/microphone access required to answer the call.');
                // keep pendingCall so user may click Answer manually
                if (answerBtn) answerBtn.style.display = 'inline-block';
                return;
            }
            try {
                call.answer(stream);
            } catch (e) {
                console.error('Error answering call immediately:', e);
                if (answerBtn) answerBtn.style.display = 'inline-block';
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
            if (answerBtn) answerBtn.style.display = 'none';
        });
    }
}

function answerCallManually() {
    if (!pendingCall) return;
    var call = pendingCall;
    pendingCall = null;
    answerCallImmediately(call);
}

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

function hangupCall() {
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
}

// Desktop sharing functionality
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

function toggleDesktopShare() {
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
}
