// public/js/ui/chatUI.js
const messagesList = document.getElementById('messages');
let lastSystemMessageText = ''; // Track the last system message text
let lastSystemMessageTime = 0; // Track the time of the last system message

export function addChatMessage(msgData, type = 'normal') {
    if (!messagesList) {
        console.error("Chat message list element not found!");
        return;
    }
    const item = document.createElement('li');
    let messageText = '';
    let isSystem = false;
    let currentUsername = null; // Store username if it's a join/leave message

    // Handle different message formats
    if (msgData && msgData.senderName && msgData.text) {
        // Player message
        const senderSpan = document.createElement('span');
        senderSpan.style.color = msgData.senderColor || '#333'; // Use sender color if provided
        senderSpan.style.fontWeight = 'bold';
        senderSpan.textContent = `${msgData.senderName}: `;
        item.appendChild(senderSpan);
        item.appendChild(document.createTextNode(msgData.text)); // Append text separately
    } else if (msgData && msgData.text) {
        // System message
        messageText = msgData.text;
        type = 'system'; // Force type
        isSystem = true;
        item.textContent = messageText; // Set text directly
        // Extract username from join/leave messages for filtering
        // Updated regex to be slightly more robust
        const joinMatch = messageText.match(/^([\w_]+) has joined the lobby.$/);
        const leaveMatch = messageText.match(/^([\w_]+) has left the lobby.$/);
        currentUsername = joinMatch ? joinMatch[1] : (leaveMatch ? leaveMatch[1] : null);
    } else {
        // Fallback for unexpected data format
        messageText = JSON.stringify(msgData);
        item.textContent = messageText;
        console.warn("Received unexpected chat message format:", msgData);
    }

    // --- Filter duplicate/rapid join/leave system messages ---
    const now = Date.now();
    if (isSystem) { // Apply filtering only to system messages
        // Check if the *exact same message* arrived very recently
        if (messageText === lastSystemMessageText && (now - lastSystemMessageTime < 1500)) { // 1.5 second threshold for exact duplicates
            console.log(`Skipping duplicate system message: "${messageText}"`);
            return; // Don't add the message
        }

        // Check specifically for the "leave" then immediate "join" pattern for the same user
        if (currentUsername) { // Only apply join/leave pattern check if username was extracted
            const isLeaveMessage = messageText.includes(" has left the lobby.");
            const lastWasJoin = lastSystemMessageText === `${currentUsername} has joined the lobby.`; // Exact match for last join

            if (isLeaveMessage && lastWasJoin && (now - lastSystemMessageTime < 2000)) { // 2 second threshold for leave after join
                 console.log(`Skipping leave message for ${currentUsername} due to rapid rejoin.`);
                 // Don't update lastSystemMessageText here, keep the "join" as the last significant event
                 // Update time to prevent immediate duplicate "leave" if server sends multiple
                 lastSystemMessageTime = now;
                 return; // Skip the "leave" message
            }
        }

        // Update tracking variables *after* checks pass for the message being added
        lastSystemMessageText = messageText;
        lastSystemMessageTime = now;
    }
    // --- End Filter ---


    // Apply styles
    if (type === 'system') {
        item.style.fontStyle = 'italic';
        item.style.color = '#6c757d'; // Use style.css class?
    }

    messagesList.appendChild(item);
    // Scroll to bottom only if user isn't scrolled up significantly
    const scrollThreshold = 50; // Pixels from bottom
    const isScrolledNearBottom = messagesList.scrollHeight - messagesList.clientHeight <= messagesList.scrollTop + scrollThreshold;
    if (isScrolledNearBottom) {
         messagesList.scrollTop = messagesList.scrollHeight;
    }
}

export function clearChat() {
    if (messagesList) messagesList.innerHTML = '';
    lastSystemMessageText = ''; // Reset tracking when chat clears
    lastSystemMessageTime = 0;
}