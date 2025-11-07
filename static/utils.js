// Utility functions

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
