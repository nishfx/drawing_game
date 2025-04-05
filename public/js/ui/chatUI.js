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
    let isSystem = type === 'system';
    let isCorrectGuess = msgData?.isCorrectGuess || false;
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
        messageText = msgData.text; // Store text for potential filtering
    } else if (msgData && msgData.text && isSystem) {
        // System message explicitly passed with type='system' or inferred
        messageText = msgData.text;
        item.textContent = messageText; // Set text directly
        // Extract username from join/leave messages for filtering
        const joinMatch = messageText.match(/^([\w_]+) has joined the (lobby|game)\.$/);
        const leaveMatch = messageText.match(/^([\w_]+) has left the (lobby|game)\.$/);
        const reconnectMatch = messageText.match(/^([\w_]+) has reconnected\.$/);
        currentUsername = joinMatch ? joinMatch[1] : (leaveMatch ? leaveMatch[1] : (reconnectMatch ? reconnectMatch[1] : null));
    } else if (msgData && msgData.text) {
        // Fallback for messages with text but no sender/type (treat as system)
        messageText = msgData.text;
        item.textContent = messageText;
        isSystem = true;
        type = 'system';
        console.warn("Received chat message with text but no sender/type, treating as system:", msgData);
    }
    else {
        // Fallback for completely unexpected data format
        messageText = JSON.stringify(msgData);
        item.textContent = messageText;
        isSystem = true;
        type = 'system';
        console.warn("Received unexpected chat message format:", msgData);
    }

    // --- Filter duplicate/rapid join/leave/reconnect system messages ---
    const now = Date.now();
    if (isSystem) { // Apply filtering only to system messages
        // Check if the *exact same message* arrived very recently
        if (messageText === lastSystemMessageText && (now - lastSystemMessageTime < 1500)) { // 1.5 second threshold for exact duplicates
            console.log(`Skipping duplicate system message: "${messageText}"`);
            return; // Don't add the message
        }

        // Check specifically for the "leave" then immediate "join/reconnect" pattern for the same user
        if (currentUsername) { // Only apply join/leave pattern check if username was extracted
            const isLeaveMessage = messageText.includes(" has left the ");
            const lastWasJoin = lastSystemMessageText === `${currentUsername} has joined the lobby.` || lastSystemMessageText === `${currentUsername} has joined the game.`;
            const lastWasReconnect = lastSystemMessageText === `${currentUsername} has reconnected.`;

            // If current is leave, and last was join/reconnect very recently, skip leave
            if (isLeaveMessage && (lastWasJoin || lastWasReconnect) && (now - lastSystemMessageTime < 2000)) { // 2 second threshold for leave after join/reconnect
                 console.log(`Skipping leave message for ${currentUsername} due to rapid join/reconnect.`);
                 // Don't update lastSystemMessageText here, keep the join/reconnect as the last significant event
                 lastSystemMessageTime = now; // Update time to prevent immediate duplicate "leave"
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
        item.style.color = '#6c757d';
    }
    if (isCorrectGuess) {
        item.classList.add('correct-guess'); // Use CSS class for styling correct guesses
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