// public/js/lobbyClient.js - Script for lobby.html
import * as UIManager from './uiManager.js'; // UIManager might not be needed here anymore
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
const playerCountDisplay = document.getElementById('player-count-display'); // Added
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const drawingToolsContainer = document.getElementById('lobby-drawing-tools');
const clearCanvasBtn = document.getElementById('clear-canvas-btn');
const colorPicker = document.getElementById('color-picker');
const lineWidthSelector = document.getElementById('line-width-selector');
const statusDisplay = document.getElementById('status'); // Ref to the connection status span

// --- Initial Setup ---
function initializeLobby() {
    console.log("Initializing Lobby UI...");
    hasJoined = false;

    const urlParams = new URLSearchParams(window.location.search);
    currentLobbyId = urlParams.get('id');
    const username = sessionStorage.getItem('drawingGameUsername');

    if (!currentLobbyId || !username) { handleFatalError("Missing lobby ID or username."); return; }

    console.log(`Lobby ID: ${currentLobbyId}, Username: ${username}`);

    if (!CanvasManager.initCanvas('lobby-canvas')) { handleFatalError("Failed to initialize lobby canvas."); return; }

    CanvasManager.setColor(colorPicker?.value || '#000000');
    CanvasManager.setLineWidth(lineWidthSelector?.value || 5);
    CanvasManager.setTool('pencil');

    setupSocketConnection(currentLobbyId, username);
    setupActionListeners();
    populateEmojiPicker();

} // End of initializeLobby

function setupSocketConnection(lobbyId, username) {
    if (socket && socket.connected) socket.disconnect();
    console.log("Attempting to connect socket at /game/socket.io");
    socket = io({ path: '/game/socket.io' });

    socket.on('connect', () => {
        console.log('Connected to server!', socket.id);
        if (statusDisplay) { // Update connection status text
             statusDisplay.textContent = 'Connected';
             statusDisplay.style.color = 'green';
        }
        if (!hasJoined) {
            console.log(`Emitting join lobby for ${lobbyId} as ${username}`);
            socket.emit('join lobby', { lobbyId, username });
        } else { console.log("Reconnected, join already confirmed."); }
    });

    socket.on('disconnect', (reason) => {
        console.log(`Disconnected from server. Reason: ${reason}`);
        if (statusDisplay) { // Update connection status text
             statusDisplay.textContent = 'Disconnected';
             statusDisplay.style.color = 'red';
        }
        if(lobbyStatus) lobbyStatus.textContent = "Disconnected. Please refresh.";
        if(startGameBtn) startGameBtn.style.display = 'none';
        if(playerCountDisplay) playerCountDisplay.textContent = '(0/?)'; // Reset count display
        CanvasManager.disableDrawing();
        hasJoined = false; myPlayerId = null; isHost = false;
    });

    socket.on('connect_error', (err) => {
        console.error("Lobby connection Error:", err);
         if (statusDisplay) { // Update connection status text
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
    });

    socket.on('join failed', (reason) => {
        console.error('Join lobby failed:', reason);
        if (!hasJoined) {
            alert(`Failed to join lobby: ${reason}`);
            window.location.href = '/game/';
        } else { console.warn("Received 'join failed' potentially after successful join."); }
    });

    socket.on('lobby state', (state) => {
        console.log('Received lobby state:', state);
        if (!hasJoined) { console.warn("State before join success?"); hasJoined = true; }
        myPlayerId = socket.id;
        minPlayersToStart = state.minPlayers || 2;
        PlayerListUI.updatePlayerList(state.players, myPlayerId);
        ChatUI.clearChat();
        state.chatHistory?.forEach(msg => ChatUI.addChatMessage(msg));
        CanvasManager.clearCanvas(false);
        if (state.canvasCommands && Array.isArray(state.canvasCommands)) {
             console.log(`Redrawing ${state.canvasCommands.length} canvas commands.`);
             setTimeout(() => {
                 state.canvasCommands.forEach(cmd => CanvasManager.drawExternalCommand(cmd));
             }, 100);
        } else { console.log("No canvas commands in initial state."); }
        isHost = (state.hostId === myPlayerId);
        updateLobbyUI(state); // Pass full state
        CanvasManager.enableDrawing();
    });

    socket.on('lobby player list update', (players) => {
        console.log('Player list update:', players);
        PlayerListUI.updatePlayerList(players, myPlayerId);
        const me = players.find(p => p.id === myPlayerId);
        isHost = me ? me.isHost : false;
        updateLobbyUI({ players }); // Pass only players for partial update
    });
    socket.on('lobby chat message', (msgData) => { ChatUI.addChatMessage(msgData); });
    socket.on('lobby draw update', (drawData) => { CanvasManager.drawExternalCommand(drawData); });
    socket.on('promoted to host', () => { console.log("Promoted to host!"); isHost = true; ChatUI.addChatMessage({ text: "You are now the host." }, 'system'); if(startGameBtn) startGameBtn.style.display = 'block'; updateLobbyUI({}); });
    socket.on('game starting', ({ lobbyId: confirmedLobbyId }) => {
        console.log(`Game starting for ${confirmedLobbyId}!`);
        alert("Game is starting!");
        window.location.href = `/game/game?lobbyId=${confirmedLobbyId}`;
    });
    socket.on('system message', (message) => { ChatUI.addChatMessage({ text: message }, 'system'); });

} // End of setupSocketConnection

function setupActionListeners() {
    // Chat Form
    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (chatInput && chatInput.value.trim() && socket && socket.connected) {
                socket.emit('lobby chat message', chatInput.value);
                chatInput.value = '';
                emojiPicker.style.display = 'none';
            }
        });
    } else { console.error("Lobby chat form not found!"); }

    // Start Game Button
    if (startGameBtn) {
        startGameBtn.addEventListener('click', () => {
            if (isHost && socket && socket.connected) {
                console.log("Requesting start...");
                socket.emit('start game');
                startGameBtn.disabled = true;
                startGameBtn.textContent = 'Starting...';
            }
        });
    } else { console.warn("Start button not found."); }

    // Lobby Canvas Drawing Event
    if (lobbyCanvas) {
        lobbyCanvas.addEventListener('lobbyDraw', (e) => {
            if (socket && socket.connected && hasJoined) {
                socket.emit('lobby draw', e.detail);
            }
        });
    } else { console.error("Lobby canvas not found!"); }

    // Emoji Button
    if (emojiBtn) {
        emojiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            emojiPicker.style.display = emojiPicker.style.display === 'block' ? 'none' : 'block';
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
            if (e.target.classList.contains('tool-button') && e.target.dataset.tool) {
                drawingToolsContainer.querySelectorAll('.tool-button.active').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                const selectedTool = e.target.dataset.tool;
                CanvasManager.setTool(selectedTool);
                if (selectedTool === 'fill' || selectedTool === 'shapes') {
                    console.log(`${selectedTool} tool selected (Not Implemented)`);
                }
            }
        });

        if (colorPicker) {
            colorPicker.addEventListener('input', (e) => {
                CanvasManager.setColor(e.target.value);
            });
        }

        if (lineWidthSelector) {
            lineWidthSelector.addEventListener('change', (e) => {
                CanvasManager.setLineWidth(e.target.value);
            });
        }

        const undoBtn = drawingToolsContainer.querySelector('#undo-btn');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => {
                console.log("Undo clicked (Not Implemented)");
            });
        }

        if (clearCanvasBtn) {
             clearCanvasBtn.addEventListener('click', () => {
                 console.log("Clear Canvas clicked");
                 CanvasManager.clearCanvas(); // Emits event
             });
        }
    }

} // End of setupActionListeners

// --- Updated UI Update Logic ---
function updateLobbyUI(state) {
    // Use state.players if provided (full update), otherwise get from DOM (partial update)
    const players = state.players || Array.from(playerListElement?.children || []).map(li => ({ id: li.dataset.playerId, name: li.textContent.split(' (')[0], isHost: li.querySelector('.host-indicator') !== null }));
    const playerCount = players.length;

    // Update Player Count Display
    if (playerCountDisplay) {
        playerCountDisplay.textContent = `(${playerCount}/${MAX_PLAYERS})`;
    }

    // Update Lobby Status Text (Simplified)
    if (lobbyStatus) {
        if (playerCount < minPlayersToStart) {
            lobbyStatus.textContent = `Waiting for more players...`;
        } else {
            const host = players.find(p => p.isHost);
            const hostName = host ? host.name : '...';
            lobbyStatus.textContent = isHost ? `Waiting for players` : `Waiting for host (${hostName})...`;
        }
    }

    // Update Start Game Button Visibility
    if (startGameBtn) {
        if (isHost && playerCount >= minPlayersToStart) {
            startGameBtn.style.display = 'block';
            startGameBtn.disabled = false;
            startGameBtn.textContent = 'Start Game';
        } else {
            startGameBtn.style.display = 'none';
        }
    }
} // End of updateLobbyUI


function populateEmojiPicker() {
    if (!emojiPicker) return;
    const emojis = ['😊', '😂', '😍', '🤔', '😢', '😠', '👍', '👎', '❤️', '🎉', '✨', '🔥', '💡', '❓', '❗', '👋'];
    emojiPicker.innerHTML = ''; // Clear existing
    emojis.forEach(emoji => {
        const span = document.createElement('span');
        span.textContent = emoji;
        span.addEventListener('click', () => {
            chatInput.value += emoji;
            emojiPicker.style.display = 'none'; // Hide after selection
            chatInput.focus(); // Keep focus on input
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
try { initializeLobby(); }
catch (error) { handleFatalError(`Initialization error: ${error.message}`); }