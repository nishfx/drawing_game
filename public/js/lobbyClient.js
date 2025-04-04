// public/js/lobbyClient.js - Script for lobby.html
import * as UIManager from './uiManager.js';
import * as CanvasManager from './canvasManager.js';
// Import specific UI modules needed
import * as PlayerListUI from './ui/playerListUI.js';
import * as ChatUI from './ui/chatUI.js';

console.log("Lobby Client script loaded.");

// --- Global Variables ---
let socket = null; // Initialize socket variable
let myPlayerId = null;
let currentLobbyId = null;
let isHost = false;
let hasJoined = false; // Flag to prevent duplicate join attempts

// --- DOM Elements ---
const lobbyIdDisplay = document.getElementById('lobby-id-display');
const lobbyStatus = document.getElementById('lobby-status');
const startGameBtn = document.getElementById('start-game-btn');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const lobbyCanvas = document.getElementById('lobby-canvas');
const playerListElement = document.getElementById('player-list'); // Needed for UI updates

// --- Initial Setup ---
function initializeLobby() {
    console.log("Initializing Lobby UI...");
    hasJoined = false; // Reset join flag

    const urlParams = new URLSearchParams(window.location.search);
    currentLobbyId = urlParams.get('id');
    const username = sessionStorage.getItem('drawingGameUsername');

    if (!currentLobbyId) {
        console.error("Initialization Error: No lobby ID found in URL.");
        alert("Error: No lobby ID specified.");
        window.location.href = '/'; return;
    }
    if (!username) {
        console.error("Initialization Error: No username found in sessionStorage.");
        alert("Error: Username not found.");
        window.location.href = '/'; return;
    }

    console.log(`Lobby ID: ${currentLobbyId}, Username: ${username}`);
    if (lobbyIdDisplay) lobbyIdDisplay.textContent = `(ID: ${currentLobbyId})`;

    // Initialize lobby canvas FIRST
    if (!CanvasManager.initCanvas('lobby-canvas')) {
        alert("Fatal Error: Failed to initialize lobby canvas.");
        return; // Stop initialization if canvas fails
    }
    // Enable drawing AFTER successful connection and join
    // CanvasManager.enableDrawing(); // Moved to after 'lobby state' received

    // --- Connect Socket ---
    // Disconnect previous socket if any (e.g., from index page)
    if (socket && socket.connected) {
        console.log("Disconnecting existing socket before creating new one...");
        socket.disconnect();
    }
    socket = io(); // Establish new connection

    // --- Socket Event Listeners ---
    socket.on('connect', () => {
        console.log('Connected to server!', socket.id);
        UIManager.updateStatus(true);
        // Attempt to join the lobby ONLY ONCE per connection attempt
        if (!hasJoined) {
            console.log(`Emitting join lobby for ${currentLobbyId} as ${username}`);
            socket.emit('join lobby', { lobbyId: currentLobbyId, username });
        } else {
            console.log("Already attempted join on this connection.");
        }
    });

    socket.on('disconnect', (reason) => {
        console.log(`Disconnected from server. Reason: ${reason}`);
        UIManager.updateStatus(false);
        if(lobbyStatus) lobbyStatus.textContent = "Disconnected. Please refresh.";
        if(startGameBtn) startGameBtn.style.display = 'none';
        CanvasManager.disableDrawing();
        hasJoined = false; // Reset flag on disconnect
    });

    // --- Lobby Join/State Handling ---
    socket.on('join success', ({ lobbyId }) => {
        console.log(`Successfully registered in lobby ${lobbyId} on server.`);
        hasJoined = true; // Mark as joined for this connection
        // Server will now send 'lobby state'
    });

    socket.on('join failed', (reason) => {
        console.error('Join lobby failed:', reason);
        // Only redirect if we haven't successfully joined previously on this socket instance
        if (!hasJoined) {
            alert(`Failed to join lobby: ${reason}`);
            window.location.href = '/'; // Redirect back
        } else {
            // If already joined, this might be a spurious message, log it
             console.warn("Received 'join failed' after potentially joining successfully.");
        }
    });

    socket.on('lobby state', (state) => {
        console.log('Received lobby state:', state);
        if (!hasJoined) {
             console.warn("Received lobby state before join success confirmation?");
             hasJoined = true; // Assume join was successful if state arrives
        }
        myPlayerId = socket.id; // Update own ID
        PlayerListUI.updatePlayerList(state.players, myPlayerId);
        ChatUI.clearChat();
        state.chatHistory?.forEach(msg => ChatUI.addChatMessage(msg));
        CanvasManager.clearCanvas();
        state.canvasCommands?.forEach(cmd => CanvasManager.drawExternalCommand(cmd));
        isHost = (state.hostId === myPlayerId);
        updateLobbyUI(state);
        CanvasManager.enableDrawing(); // Enable drawing now that state is loaded
    });

    // --- Other Lobby Updates ---
    socket.on('lobby player list update', (players) => {
        console.log('Player list update:', players);
        PlayerListUI.updatePlayerList(players, myPlayerId);
        const me = players.find(p => p.id === myPlayerId);
        isHost = me ? me.isHost : false;
        updateLobbyUI({ players }); // Update UI based on player changes
    });

    socket.on('lobby chat message', (msgData) => {
        ChatUI.addChatMessage(msgData);
    });

    socket.on('lobby draw update', (drawData) => {
        CanvasManager.drawExternalCommand(drawData);
    });

    socket.on('promoted to host', () => {
        console.log("You have been promoted to host!");
        isHost = true;
        ChatUI.addChatMessage({ text: "You are now the host." }, 'system');
        if(startGameBtn) startGameBtn.style.display = 'block';
    });

    socket.on('game starting', ({ lobbyId }) => {
        console.log(`Game starting for lobby ${lobbyId}! Redirecting...`);
        // Optional: Add a small delay before redirecting?
        alert("Game is starting!");
        window.location.href = `/game?lobbyId=${lobbyId}`;
    });

    socket.on('system message', (message) => {
        ChatUI.addChatMessage({ text: message }, 'system');
    });


    // --- Event Listeners for Lobby Actions ---
    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (chatInput && chatInput.value.trim()) {
                socket.emit('lobby chat message', chatInput.value);
                chatInput.value = '';
            }
        });
    } else { console.error("Lobby chat form not found!"); }

    if (startGameBtn) {
        startGameBtn.addEventListener('click', () => {
            if (isHost) {
                console.log("Requesting game start...");
                socket.emit('start game');
                startGameBtn.disabled = true;
                startGameBtn.textContent = 'Starting...';
            }
        });
    } else { console.warn("Start game button not found."); }

    if (lobbyCanvas) {
        lobbyCanvas.addEventListener('lobbyDraw', (e) => {
            if (socket && socket.connected && hasJoined) { // Only emit if connected and joined
                 socket.emit('lobby draw', e.detail);
            }
        });
    } else { console.error("Lobby canvas element not found!"); }

} // End of initializeLobby

function updateLobbyUI(state) {
    const playerCount = state.players ? state.players.length : (playerListElement?.children?.length || 0);
    const minPlayers = 2; // TODO: Get from state if available
    if (lobbyStatus) {
        if (playerCount < minPlayers) {
            lobbyStatus.textContent = `Waiting for more players... (${playerCount}/${minPlayers})`;
        } else {
            const host = state.players?.find(p => p.isHost);
            const hostName = host ? host.name : '...';
            lobbyStatus.textContent = isHost ? `Ready to start when you are!` : `Waiting for host (${hostName}) to start...`;
        }
    }

    if (startGameBtn) {
        if (isHost && playerCount >= minPlayers) {
            startGameBtn.style.display = 'block';
            startGameBtn.disabled = false;
            startGameBtn.textContent = 'Start Game';
        } else {
            startGameBtn.style.display = 'none';
        }
    }
}

// --- Initialize ---
// Wrap initialization in try/catch for better error reporting
try {
    initializeLobby();
} catch (error) {
    console.error("Error during lobby initialization:", error);
    alert("A critical error occurred while loading the lobby. Please try again.");
    window.location.href = '/'; // Redirect on critical error
}