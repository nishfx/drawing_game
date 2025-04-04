// public/js/gameClient.js - Script for game.html
import * as UIManager from './uiManager.js';
import * as CanvasManager from './canvasManager.js';
// Import specific UI modules if needed directly (e.g., for enabling/disabling buttons)
import * as VotingUI from './ui/votingUI.js';

console.log("Game Client script loaded.");

const socket = io();
let myPlayerId = null;
let currentLobbyId = null; // Store the lobby ID for this game instance

// --- DOM Elements ---
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const readyButton = document.getElementById('ready-button');
const votingArea = document.getElementById('voting-area');

// --- Initial Setup ---
function initializeGame() {
    const urlParams = new URLSearchParams(window.location.search);
    currentLobbyId = urlParams.get('lobbyId');
    const username = sessionStorage.getItem('drawingGameUsername');

    if (!currentLobbyId) {
        alert("Error: No lobby ID specified for the game.");
        window.location.href = '/'; return;
    }
    if (!username) {
        alert("Error: Username not found.");
        window.location.href = '/'; return;
    }

    console.log(`Initializing game for lobby: ${currentLobbyId}, user: ${username}`);
    CanvasManager.initCanvas('drawing-canvas'); // Initialize game canvas

    // --- Socket Event Listeners ---
    socket.on('connect', () => {
        console.log('Connected to game server!', socket.id);
        UIManager.updateStatus(true);
        // Emit event to rejoin the specific game lobby session
        console.log(`Emitting rejoin game for lobby ${currentLobbyId}`);
        // Server needs to handle 'rejoin game' - map socket to lobby, send state
        // For now, we rely on the server associating the socket with the lobby
        // based on the initial join. If reconnections are needed, 'rejoin game' is crucial.
        // Let's assume server handles this via LobbyManager finding the socket.
        // We might need to send username/lobbyId if server loses track on disconnect.
        // For simplicity, we assume the server's 'connection' handler routes correctly.
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from game server.');
        UIManager.updateStatus(false);
        UIManager.stopTimer();
        myPlayerId = null;
        // Show a disconnected message, maybe prompt to rejoin?
        UIManager.showGamePhaseUI('WAITING', { playerCount: 0, minPlayers: 2 }); // Show waiting state
        document.getElementById('game-status').textContent = "Disconnected. Please refresh or return to lobby.";
    });

    // Rejection should ideally happen before reaching game page, but handle defensively
    socket.on('connection rejected', (reason) => {
        console.error('Game Connection Rejected:', reason);
        alert(`Cannot join game: ${reason}`);
        window.location.href = '/';
    });

    // Receive own player info (might be redundant if set in lobby)
    socket.on('my info', (player) => {
        myPlayerId = player.id;
        console.log("My game info:", player);
    });

    // Update player list (scores change during game)
    socket.on('update player list', (players) => {
        UIManager.updatePlayerList(players, myPlayerId);
    });

    // Handle game chat messages
    socket.on('chat message', (msgData) => {
        UIManager.addChatMessage(msgData);
    });

    // Generic system messages
    socket.on('system message', (message) => {
        UIManager.addChatMessage({ text: message }, 'system');
    });

    // --- Game Flow Events ---
    socket.on('game state update', (state) => {
        // Filter state updates for *this* lobby only? Server should handle via rooms.
        console.log("Received game state update:", state);
        // Update myPlayerId if it wasn't set yet (e.g., on rejoin)
        if (!myPlayerId && state.scores) {
             const myInfo = state.scores.find(p => p.id === socket.id);
             if (myInfo) myPlayerId = myInfo.id;
        }
        UIManager.showGamePhaseUI(state.phase, {
            word: state.word, drawings: state.drawings, scores: state.scores,
            myPlayerId: myPlayerId, // Pass own ID
            minPlayers: state.minPlayers, playerCount: state.playerCount // Pass lobby info
        });
    });

    socket.on('round start', ({ word, duration }) => {
        console.log(`Game Round Start. Word: ${word}, Duration: ${duration}s`);
        CanvasManager.clearCanvas();
        CanvasManager.enableDrawing();
        if (typeof duration === 'number' && duration > 0) { UIManager.startTimer(duration); }
        else { console.error(`Invalid duration in 'round start': ${duration}`); }
    });

    socket.on('voting start', ({ duration }) => {
        console.log(`Game Voting Start. Duration: ${duration}s`);
        CanvasManager.disableDrawing();
        if (typeof duration === 'number' && duration > 0) { UIManager.startTimer(duration); }
        else { console.error(`Invalid duration in 'voting start': ${duration}`); }
    });

    socket.on('vote error', (message) => {
        console.warn("Vote Error:", message);
        UIManager.addChatMessage({ text: `Vote Error: ${message}` }, 'system');
        VotingUI.enableVotingButtons(); // Use imported module
    });

    socket.on('vote accepted', () => {
        console.log("Vote accepted.");
        UIManager.addChatMessage({ text: "Vote cast!" }, 'system');
        // Buttons visually disabled on click
    });

    // --- Client Actions ---
    if (chatForm) { chatForm.addEventListener('submit', (e) => { e.preventDefault(); if (chatInput && chatInput.value.trim()) { socket.emit('chat message', chatInput.value); chatInput.value = ''; } }); }
    else { console.error("Chat form not found!"); }

    if (readyButton) { readyButton.addEventListener('click', () => {
        console.log("Ready button clicked");
        const drawingDataUrl = CanvasManager.getDrawingDataURL();
        if (drawingDataUrl) {
            if (drawingDataUrl.length > 500000) { console.error("Drawing data URL too large:", drawingDataUrl.length); UIManager.addChatMessage({ text: "Error: Drawing is too large!" }, 'system'); return; }
            socket.emit('player ready', drawingDataUrl);
            CanvasManager.disableDrawing(); readyButton.disabled = true; readyButton.textContent = "Waiting..."; UIManager.addChatMessage({ text: "You are ready!" }, 'system');
        } else { console.error("Could not get drawing data URL"); UIManager.addChatMessage({ text: "Error submitting drawing!" }, 'system'); }
    }); }
    else { console.warn("Ready button not found."); }

    if (votingArea) { votingArea.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' && e.target.classList.contains('vote-button') && e.target.dataset.voteFor) {
            const votedForId = e.target.dataset.voteFor;
            console.log(`Attempting vote for ${votedForId}`);
            VotingUI.disableVotingButtons(); // Use imported module
            socket.emit('submit vote', votedForId);
        }
    }); }
    else { console.warn("Voting area not found."); }
}

// --- Initialize ---
initializeGame();