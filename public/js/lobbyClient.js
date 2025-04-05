// public/js/lobbyClient.js
// (Restored original socket path)
import * as CanvasManager from './canvasManager.js';
import * as PlayerListUI from './ui/playerListUI.js';
import * as ChatUI from './ui/chatUI.js';

console.log("Lobby Client script loaded.");

// --- Global Variables ---
let socket = null;
let myPlayerId = null;
let currentLobbyId = null;
let isHost = false;
let hasJoined = false;
let minPlayersToStart = 2; // Default, will be updated by lobby state
const MAX_PLAYERS = 4; // Define max players constant for UI

// --- DOM Elements ---
const lobbyStatus = document.getElementById('lobby-status');
const startGameBtn = document.getElementById('start-game-btn');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const lobbyCanvas = document.getElementById('lobby-canvas');
const playerListElement = document.getElementById('player-list');
const playerCountDisplay = document.getElementById('player-count-display');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const drawingToolsContainer = document.getElementById('lobby-drawing-tools');
const clearCanvasBtn = document.getElementById('clear-canvas-btn');
const colorPicker = document.getElementById('color-picker');
const lineWidthSelector = document.getElementById('line-width-selector');
const statusDisplay = document.getElementById('status');
const lobbyTitleDisplay = document.getElementById('lobby-title-display');
const undoBtn = document.getElementById('undo-btn');

// --- Initial Setup ---
function initializeLobby() {
    console.log("Initializing Lobby UI...");
    hasJoined = false;

    const urlParams = new URLSearchParams(window.location.search);
    currentLobbyId = urlParams.get('id');
    const username = sessionStorage.getItem('drawingGameUsername');

    if (!currentLobbyId || !username) { handleFatalError("Missing lobby ID or username."); return; }

    console.log(`Lobby ID: ${currentLobbyId}, Username: ${username}`);

    if (!CanvasManager.initCanvas('lobby-canvas', handleDrawEvent)) { // Pass event handler
        handleFatalError("Failed to initialize lobby canvas.");
        return;
    }

    // Set initial tool state from UI elements
    CanvasManager.setColor(colorPicker?.value || '#000000');
    CanvasManager.setLineWidth(lineWidthSelector?.value || 5);
    CanvasManager.setTool('pencil'); // Default tool

    setupSocketConnection(currentLobbyId, username);
    setupActionListeners();
    populateEmojiPicker();

} // End of initializeLobby

function setupSocketConnection(lobbyId, username) {
    if (socket && socket.connected) socket.disconnect();

    // --- Connect specifying the original path ---
    const socketPath = '/game/socket.io'; // Use path WITH /game prefix
    console.log(`Attempting to connect socket at ${socketPath}`);
    socket = io({ path: socketPath });

    socket.on('connect', () => {
        console.log('Connected to server!', socket.id);
        myPlayerId = socket.id; // Set player ID immediately on connect
        CanvasManager.setPlayerId(myPlayerId); // Inform CanvasManager
        if (statusDisplay) {
             statusDisplay.textContent = 'Connected';
             statusDisplay.style.color = 'green';
        }
        if (!hasJoined) {
            console.log(`Emitting join lobby for ${lobbyId} as ${username}`);
            socket.emit('join lobby', { lobbyId, username });
        } else {
            console.log("Reconnected, attempting to rejoin lobby state.");
            // Re-emit join lobby to ensure server recognizes the new socket ID for the user
            socket.emit('join lobby', { lobbyId, username });
        }
    });

    socket.on('disconnect', (reason) => {
        console.log(`Disconnected from server. Reason: ${reason}`);
        if (statusDisplay) {
             statusDisplay.textContent = 'Disconnected';
             statusDisplay.style.color = 'red';
        }
        if(lobbyStatus) lobbyStatus.textContent = "Disconnected. Please refresh.";
        if(startGameBtn) startGameBtn.style.display = 'none';
        if(playerCountDisplay) playerCountDisplay.textContent = '(0/?)';
        if(lobbyTitleDisplay) lobbyTitleDisplay.textContent = "Lobby"; // Reset title
        CanvasManager.disableDrawing();
        hasJoined = false; myPlayerId = null; isHost = false;
        CanvasManager.setPlayerId(null); // Clear player ID
    });

    socket.on('connect_error', (err) => {
        console.error("Lobby connection Error:", err);
         if (statusDisplay) {
             statusDisplay.textContent = 'Connection Failed';
             statusDisplay.style.color = 'red';
        }
        if(lobbyStatus) lobbyStatus.textContent = "Connection failed.";
        alert("Failed to connect to the server. Please check your connection and refresh.");
    });

    socket.on('join success', ({ lobbyId: confirmedLobbyId }) => {
        console.log(`Successfully registered in lobby ${confirmedLobbyId} on server.`);
        hasJoined = true;
        currentLobbyId = confirmedLobbyId;
        // Request full state after successful join confirmation
        // (Server might send 'lobby state' automatically, but this ensures it)
        // socket.emit('request lobby state'); // Might be redundant if server sends state
    });

    socket.on('join failed', (reason) => {
        console.error('Join lobby failed:', reason);
        if (!hasJoined) { // Only redirect if initial join failed
            alert(`Failed to join lobby: ${reason}`);
            window.location.href = '/game/';
        } else {
            // If already joined and received this, it might be a server hiccup or duplicate message
            console.warn("Received 'join failed' potentially after successful join/reconnect.");
            ChatUI.addChatMessage({ text: `Error: ${reason}`, type: 'system' });
        }
    });

    socket.on('lobby state', (state) => {
        console.log('Received lobby state:', state);
        if (!myPlayerId) myPlayerId = socket.id; // Ensure player ID is set
        CanvasManager.setPlayerId(myPlayerId); // Update CanvasManager just in case

        hasJoined = true; // Mark as joined upon receiving state
        minPlayersToStart = state.minPlayers || 2;
        PlayerListUI.updatePlayerList(state.players, myPlayerId);
        ChatUI.clearChat();
        state.chatHistory?.forEach(msg => ChatUI.addChatMessage(msg));

        // Process canvas commands *after* setting player ID
        CanvasManager.loadAndDrawHistory(state.canvasCommands || []);

        isHost = (state.hostId === myPlayerId);
        updateLobbyUI(state); // Pass full state
        CanvasManager.enableDrawing(); // Enable drawing after state is loaded
    });

    socket.on('lobby player list update', (players) => {
        console.log('Player list update:', players);
        PlayerListUI.updatePlayerList(players, myPlayerId);
        const me = players.find(p => p.id === myPlayerId);
        isHost = me ? me.isHost : false;
        updateLobbyUI({ players }); // Pass only players for partial update
    });

    socket.on('lobby chat message', (msgData) => {
        // Add type if missing (e.g., for system messages)
        ChatUI.addChatMessage(msgData, msgData.type || 'normal');
    });

    socket.on('lobby draw update', (drawData) => {
        // Received a command from another player
        CanvasManager.drawExternalCommand(drawData);
    });

    socket.on('lobby command removed', ({ cmdId }) => {
        // Received notification that a command was undone by someone
        CanvasManager.removeCommandById(cmdId);
    });

    socket.on('promoted to host', () => {
        console.log("Promoted to host!");
        isHost = true;
        ChatUI.addChatMessage({ text: "You are now the host.", type: 'system' });
        if(startGameBtn) startGameBtn.style.display = 'block';
        updateLobbyUI({}); // Trigger UI update to reflect host status potentially
    });

    socket.on('game starting', ({ lobbyId: confirmedLobbyId }) => {
        console.log(`Game starting for ${confirmedLobbyId}!`);
        // Disable UI elements immediately
        if(startGameBtn) startGameBtn.disabled = true;
        CanvasManager.disableDrawing();
        ChatUI.addChatMessage({ text: "Game is starting...", type: 'system' });
        // Redirect after a short delay to allow message display
        setTimeout(() => {
            window.location.href = `/game/game?lobbyId=${confirmedLobbyId}`;
        }, 1000); // 1 second delay
    });

    socket.on('system message', (message) => { // General system messages
        ChatUI.addChatMessage({ text: message, type: 'system' });
    });

} // End of setupSocketConnection

// Callback function for CanvasManager to emit draw events
function handleDrawEvent(drawDetail) {
    if (socket && socket.connected && hasJoined) {
        // console.log('Emitting draw event:', drawDetail);
        socket.emit('lobby draw', drawDetail);
    }
}

function setupActionListeners() {
    // Chat Form
    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (chatInput && chatInput.value.trim() && socket && socket.connected) {
                socket.emit('lobby chat message', chatInput.value);
                chatInput.value = '';
                if (emojiPicker) emojiPicker.style.display = 'none';
            }
        });
    } else { console.error("Lobby chat form not found!"); }

    // Start Game Button
    if (startGameBtn) {
        startGameBtn.addEventListener('click', () => {
            if (isHost && socket && socket.connected) {
                console.log("Requesting start game...");
                socket.emit('start game');
                startGameBtn.disabled = true;
                startGameBtn.textContent = 'Starting...';
            }
        });
    } else { console.warn("Start button not found."); }

    // Emoji Button
    if (emojiBtn) {
        emojiBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent document click listener from closing it immediately
            if (emojiPicker) {
                emojiPicker.style.display = emojiPicker.style.display === 'block' ? 'none' : 'block';
            }
        });
    }

    // Close Emoji Picker when clicking outside
    document.addEventListener('click', (e) => {
        if (emojiPicker && emojiPicker.style.display === 'block' && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
            emojiPicker.style.display = 'none';
        }
    });

    // Drawing Tools Listener
    if (drawingToolsContainer) {
        drawingToolsContainer.addEventListener('click', (e) => {
            const button = e.target.closest('.tool-button'); // Find the button element
            if (button && button.dataset.tool) {
                // Handle tool selection
                drawingToolsContainer.querySelectorAll('.tool-button.active').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                const selectedTool = button.dataset.tool;
                CanvasManager.setTool(selectedTool);
                console.log(`Tool set to: ${selectedTool}`);
            } else if (button && button.id === 'undo-btn') {
                // Handle Undo button click
                console.log("Undo clicked");
                CanvasManager.undoLastAction(socket); // Pass socket to emit undo event
            } else if (button && button.id === 'clear-canvas-btn') {
                 // Handle Clear Canvas button click
                 console.log("Clear Canvas clicked");
                 CanvasManager.clearCanvas(true); // true to emit event
            }
        });

        if (colorPicker) {
            colorPicker.addEventListener('input', (e) => {
                CanvasManager.setColor(e.target.value);
            });
            // Ensure initial color is set
            CanvasManager.setColor(colorPicker.value);
        }

        if (lineWidthSelector) {
            lineWidthSelector.addEventListener('change', (e) => {
                CanvasManager.setLineWidth(e.target.value);
            });
            // Ensure initial width is set
            CanvasManager.setLineWidth(lineWidthSelector.value);
        }
    }

} // End of setupActionListeners

// --- Updated UI Update Logic ---
function updateLobbyUI(state) {
    // Use state.players if provided, otherwise get from current UI list
    const players = state.players || PlayerListUI.getPlayersFromList();
    const playerCount = players.length;

    // Update Player Count Display
    if (playerCountDisplay) {
        playerCountDisplay.textContent = `(${playerCount}/${MAX_PLAYERS})`;
    }

    // Update Lobby Title
    if (lobbyTitleDisplay) {
        const host = players.find(p => p.isHost);
        const hostName = host ? host.name : null;
        lobbyTitleDisplay.textContent = hostName ? `${hostName}'s Lobby` : "Lobby";
        lobbyTitleDisplay.title = lobbyTitleDisplay.textContent; // Tooltip for full name
    }


    // Update Lobby Status Text
    if (lobbyStatus) {
        if (playerCount < minPlayersToStart) {
            lobbyStatus.textContent = `Waiting for ${minPlayersToStart - playerCount} more player(s)...`;
        } else {
            const host = players.find(p => p.isHost);
            const hostName = host ? host.name : '...';
            lobbyStatus.textContent = isHost ? `Ready when you are!` : `Waiting for host (${hostName}) to start...`;
        }
    }

    // Update Start Game Button Visibility and State
    if (startGameBtn) {
        if (isHost) {
            startGameBtn.style.display = 'block';
            if (playerCount >= minPlayersToStart) {
                startGameBtn.disabled = false;
                startGameBtn.textContent = 'Start Game';
            } else {
                startGameBtn.disabled = true;
                startGameBtn.textContent = `Need ${minPlayersToStart - playerCount} more`;
            }
        } else {
            startGameBtn.style.display = 'none';
        }
    }
} // End of updateLobbyUI


function populateEmojiPicker() {
    if (!emojiPicker) return;
    const emojis = ['😊', '😂', '😍', '🤔', '😢', '😠', '👍', '👎', '❤️', '🎉', '✨', '🔥', '💡', '❓', '❗', '👋', '👀', '✅', '❌', '💯'];
    emojiPicker.innerHTML = ''; // Clear existing
    emojis.forEach(emoji => {
        const span = document.createElement('span');
        span.textContent = emoji;
        span.addEventListener('click', () => {
            if (chatInput) {
                chatInput.value += emoji;
                chatInput.focus(); // Keep focus on input
            }
            emojiPicker.style.display = 'none'; // Hide after selection
        });
        emojiPicker.appendChild(span);
    });
}

function handleFatalError(message) {
    console.error("Fatal Error:", message);
    alert(`Error: ${message}. Redirecting.`);
    window.location.href = '/game/'; // Redirect to game base path
}

// --- Initialize ---
// Ensure DOM is fully loaded before initializing
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLobby);
} else {
    initializeLobby();
}