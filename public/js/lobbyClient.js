// public/js/lobbyClient.js - Script for lobby.html
import * as UIManager from './uiManager.js';
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

// --- DOM Elements ---
const lobbyIdDisplay = document.getElementById('lobby-id-display');
const lobbyStatus = document.getElementById('lobby-status');
const startGameBtn = document.getElementById('start-game-btn');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const lobbyCanvas = document.getElementById('lobby-canvas');
const playerListElement = document.getElementById('player-list');

// --- Initial Setup ---
function initializeLobby() {
    console.log("Initializing Lobby UI...");
    hasJoined = false;

    const urlParams = new URLSearchParams(window.location.search);
    currentLobbyId = urlParams.get('id');
    const username = sessionStorage.getItem('drawingGameUsername');

    if (!currentLobbyId || !username) { handleFatalError("Missing lobby ID or username."); return; }

    console.log(`Lobby ID: ${currentLobbyId}, Username: ${username}`);
    if (lobbyIdDisplay) lobbyIdDisplay.textContent = `(ID: ${currentLobbyId})`;

    if (!CanvasManager.initCanvas('lobby-canvas')) { handleFatalError("Failed to initialize lobby canvas."); return; }

    setupSocketConnection(currentLobbyId, username);
    setupActionListeners();

} // End of initializeLobby

function setupSocketConnection(lobbyId, username) {
    if (socket && socket.connected) socket.disconnect();
    // --- Specify path for Socket.IO connection - Add /game prefix back ---
    console.log("Attempting to connect socket at /game/socket.io");
    socket = io({ path: '/game/socket.io' }); // Use path WITH /game
    // --- End Specify ---

    // --- Socket Event Listeners ---
    socket.on('connect', () => {
        console.log('Connected to server!', socket.id);
        UIManager.updateStatus(true);
        if (!hasJoined) {
            console.log(`Emitting join lobby for ${lobbyId} as ${username}`);
            socket.emit('join lobby', { lobbyId, username });
        } else { console.log("Reconnected, join already confirmed."); }
    });

    socket.on('disconnect', (reason) => {
        console.log(`Disconnected from server. Reason: ${reason}`);
        UIManager.updateStatus(false);
        if(lobbyStatus) lobbyStatus.textContent = "Disconnected. Please refresh.";
        if(startGameBtn) startGameBtn.style.display = 'none';
        CanvasManager.disableDrawing();
        hasJoined = false; myPlayerId = null; isHost = false;
    });

    socket.on('connect_error', (err) => {
        console.error("Lobby connection Error:", err);
        UIManager.updateStatus(false);
        if(lobbyStatus) lobbyStatus.textContent = "Connection failed.";
        alert("Failed to connect to the server. Please check your connection and refresh.");
    });

    // --- Lobby Join/State Handling ---
    socket.on('join success', ({ lobbyId: confirmedLobbyId }) => {
        console.log(`Successfully registered in lobby ${confirmedLobbyId} on server.`);
        hasJoined = true;
        currentLobbyId = confirmedLobbyId;
    });

    socket.on('join failed', (reason) => {
        console.error('Join lobby failed:', reason);
        if (!hasJoined) {
            alert(`Failed to join lobby: ${reason}`);
            window.location.href = '/game/'; // Redirect to game base path
        } else { console.warn("Received 'join failed' potentially after successful join."); }
    });

    socket.on('lobby state', (state) => {
        console.log('Received lobby state:', state);
        if (!hasJoined) { console.warn("State before join success?"); hasJoined = true; }
        myPlayerId = socket.id;
        PlayerListUI.updatePlayerList(state.players, myPlayerId);
        ChatUI.clearChat();
        state.chatHistory?.forEach(msg => ChatUI.addChatMessage(msg));
        CanvasManager.clearCanvas();
        if (state.canvasCommands && Array.isArray(state.canvasCommands)) {
             console.log(`Redrawing ${state.canvasCommands.length} canvas commands.`);
             state.canvasCommands.forEach(cmd => CanvasManager.drawExternalCommand(cmd));
        } else { console.log("No canvas commands in initial state."); }
        isHost = (state.hostId === myPlayerId);
        updateLobbyUI(state);
        CanvasManager.enableDrawing(); // Enable drawing now state is loaded
    });

    // --- Other Lobby Updates ---
    socket.on('lobby player list update', (players) => { console.log('Player list update:', players); PlayerListUI.updatePlayerList(players, myPlayerId); const me = players.find(p => p.id === myPlayerId); isHost = me ? me.isHost : false; updateLobbyUI({ players }); });
    socket.on('lobby chat message', (msgData) => { ChatUI.addChatMessage(msgData); });
    socket.on('lobby draw update', (drawData) => { CanvasManager.drawExternalCommand(drawData); });
    socket.on('promoted to host', () => { console.log("Promoted to host!"); isHost = true; ChatUI.addChatMessage({ text: "You are now the host." }, 'system'); if(startGameBtn) startGameBtn.style.display = 'block'; });
    socket.on('game starting', ({ lobbyId: confirmedLobbyId }) => {
        console.log(`Game starting for ${confirmedLobbyId}!`);
        alert("Game is starting!");
        // --- Redirect path - Add /game prefix back ---
        window.location.href = `/game/game?lobbyId=${confirmedLobbyId}`; // Use path WITH /game prefix
        // --- End Redirect ---
    });
    socket.on('system message', (message) => { ChatUI.addChatMessage({ text: message }, 'system'); });

} // End of setupSocketConnection

function setupActionListeners() {
    if (chatForm) { chatForm.addEventListener('submit', (e) => { e.preventDefault(); if (chatInput && chatInput.value.trim() && socket && socket.connected) { socket.emit('lobby chat message', chatInput.value); chatInput.value = ''; } }); }
    else { console.error("Lobby chat form not found!"); }
    if (startGameBtn) { startGameBtn.addEventListener('click', () => { if (isHost && socket && socket.connected) { console.log("Requesting start..."); socket.emit('start game'); startGameBtn.disabled = true; startGameBtn.textContent = 'Starting...'; } }); }
    else { console.warn("Start button not found."); }
    if (lobbyCanvas) { lobbyCanvas.addEventListener('lobbyDraw', (e) => { if (socket && socket.connected && hasJoined) { socket.emit('lobby draw', e.detail); } }); }
    else { console.error("Lobby canvas not found!"); }
} // End of setupActionListeners

function updateLobbyUI(state) {
    const playerCount = state.players ? state.players.length : (playerListElement?.children?.length || 0);
    const minPlayers = 2; // TODO: Get from state
    if (lobbyStatus) {
        if (playerCount < minPlayers) { lobbyStatus.textContent = `Waiting... (${playerCount}/${minPlayers})`; }
        else { const host = state.players?.find(p => p.isHost); const hostName = host ? host.name : '...'; lobbyStatus.textContent = isHost ? `Ready when you are!` : `Waiting for host (${hostName})...`; }
    }
    if (startGameBtn) {
        if (isHost && playerCount >= minPlayers) { startGameBtn.style.display = 'block'; startGameBtn.disabled = false; startGameBtn.textContent = 'Start Game'; }
        else { startGameBtn.style.display = 'none'; }
    }
} // End of updateLobbyUI

function handleFatalError(message) {
    console.error("Fatal Error:", message);
    alert(`Error: ${message}. Redirecting.`);
    window.location.href = '/game/'; // Redirect to game base path
}

// --- Initialize ---
try { initializeLobby(); }
catch (error) { handleFatalError(`Initialization error: ${error.message}`); }