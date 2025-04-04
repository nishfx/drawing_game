// public/js/ui/chatUI.js
const messagesList = document.getElementById('messages');
let lastSystemMessageText = ''; // Track the last system message text
let lastSystemMessageTime = 0; // Track the time of the last system message

export function addChatMessage(msgData, type = 'normal') {
    if (!messagesList) return;
    const item = document.createElement('li');
    let messageText = '';
    let isSystem = false;
    let currentUsername = null; // Store username if it's a join/leave message

    // Handle different message formats
    if (msgData && msgData.senderName && msgData.text) {
        // Player message
        const senderSpan = document.createElement('span');
        senderSpan.style.color = msgData.senderColor || '#333';
        senderSpan.style.fontWeight = 'bold';
        senderSpan.textContent = `${msgData.senderName}: `;
        item.appendChild(senderSpan);
        item.appendChild(document.createTextNode(msgData.text));
    } else if (msgData && msgData.text) {
        // System message
        messageText = msgData.text;
        type = 'system';
        isSystem = true;
        item.textContent = messageText;
        // Extract username from join/leave messages for filtering
        const joinMatch = messageText.match(/^(.+?) has joined the lobby.$/);
        const leaveMatch = messageText.match(/^(.+?) has left the lobby.$/);
        currentUsername = joinMatch ? joinMatch[1] : (leaveMatch ? leaveMatch[1] : null);
    } else {
        // Fallback
        messageText = JSON.stringify(msgData);
        item.textContent = messageText;
    }

    // --- Filter duplicate/rapid join/leave system messages ---
    const now = Date.now();
    if (isSystem && currentUsername) { // Only filter join/leave messages
        const isJoinMessage = messageText.includes(" has joined the lobby.");
        const isLeaveMessage = messageText.includes(" has left the lobby.");

        // Check if the *exact same message* (join or leave) for the *same user* arrived recently
        if (messageText === lastSystemMessageText && (now - lastSystemMessageTime < 1500)) { // Increased threshold slightly
            console.log(`Skipping duplicate system message: "${messageText}"`);
            return; // Don't add the message
        }

        // Check specifically for the "leave" then immediate "join" pattern for the same user
        const lastWasJoin = lastSystemMessageText.includes(`${currentUsername} has joined the lobby.`);
        if (isLeaveMessage && lastWasJoin && (now - lastSystemMessageTime < 2000)) { // Increased threshold
             console.log(`Skipping leave message for ${currentUsername} due to rapid rejoin.`);
             // Don't update lastSystemMessageText here, keep the "join" as the last significant event
             // lastSystemMessageTime = now; // Update time though
             return; // Skip the "leave" message
        }

        // Update tracking variables *after* checks pass
        lastSystemMessageText = messageText;
        lastSystemMessageTime = now;
    } else if (isSystem) {
         // For other system messages, just update tracking
         lastSystemMessageText = messageText;
         lastSystemMessageTime = now;
    }
    // --- End Filter ---


    // Apply styles
    if (type === 'system') {
        item.style.fontStyle = 'italic';
        item.style.color = '#6c757d';
    }

    messagesList.appendChild(item);
    // Scroll to bottom only if user isn't scrolled up
    if (messagesList.scrollHeight - messagesList.scrollTop <= messagesList.clientHeight + 50) {
         messagesList.scrollTop = messagesList.scrollHeight;
    }
}

export function clearChat() {
    if (messagesList) messagesList.innerHTML = '';
    lastSystemMessageText = ''; // Reset tracking when chat clears
    lastSystemMessageTime = 0;
}