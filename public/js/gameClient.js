// public/js/gameClient.js - Script for game.html
import * as UIManager from './uiManager.js';
import * as CanvasManager from './canvasManager.js';
import * as VotingUI from './ui/votingUI.js'; // Import needed UI module

console.log("Game Client script loaded.");

// --- Specify path for Socket.IO connection ---
const socket = io({ path: '/game/socket.io' });
// --- End Specify ---

let myPlayerId = null;
let currentLobbyId = null;

// --- DOM Elements ---
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const readyButton = document.getElementById('ready-button');
const votingArea = document.getElementById('voting-area');

// --- Initial Setup ---
function initializeGame() {
    const urlParams = new URLSearchParams(window.location.search);
    currentLobbyId = urlParams.get('lobbyId'); // Get lobbyId from query param
    const username = sessionStorage.getItem('drawingGameUsername');

    if (!currentLobbyId || !username) { handleFatalError("Missing lobby ID or username."); return; }

    console.log(`Initializing game for lobby: ${currentLobbyId}, user: ${username}`);
    if (!CanvasManager.initCanvas('drawing-canvas')) { // Check return value
        handleFatalError("Failed to initialize game canvas."); return;
    }

    // --- Socket Event Listeners ---
    socket.on('connect', () => {
        console.log('Connected to game server!', socket.id);
        UIManager.updateStatus(true);
        // --- Emit event to join the specific game room ---
        console.log(`Emitting join game room for lobby ${currentLobbyId}`);
        socket.emit('join game room', { lobbyId: currentLobbyId, username }); // Send necessary info
    });

    socket.on('disconnect', (reason) => {
        console.log(`Disconnected. Reason: ${reason}`);
        UIManager.updateStatus(false); UIManager.stopTimer(); myPlayerId = null;
        UIManager.showGamePhaseUI('WAITING', { playerCount: 0, minPlayers: 2 });
        document.getElementById('game-status').textContent = "Disconnected. Refresh or return to start.";
    });
    socket.on('connect_error', (err) => {
        console.error("Game connection Error:", err);
        UIManager.updateStatus(false); document.getElementById('game-status').textContent = "Connection failed.";
        alert("Connection failed. Please refresh.");
    });
    socket.on('connection rejected', (reason) => {
        console.error('Game Rejected:', reason); alert(`Cannot join game: ${reason}`);
        window.location.href = '/game/'; // Redirect to game start page
    });
    socket.on('my info', (player) => { myPlayerId = player.id; console.log("My game info:", player); });
    socket.on('update player list', (players) => { UIManager.updatePlayerList(players, myPlayerId); });
    socket.on('chat message', (msgData) => { UIManager.addChatMessage(msgData); });
    socket.on('system message', (message) => { UIManager.addChatMessage({ text: message }, 'system'); });

    // --- Game Flow Events ---
    socket.on('game state update', (state) => {
        console.log("Game State Update:", state);
        if (!myPlayerId && state.scores) { const myInfo = state.scores.find(p => p.id === socket.id); if (myInfo) myPlayerId = myInfo.id; }
        UIManager.showGamePhaseUI(state.phase, {
            word: state.word, drawings: state.drawings, scores: state.scores,
            myPlayerId: myPlayerId, minPlayers: state.minPlayers, playerCount: state.playerCount
        });
        // Sync timer based on state
        if ((state.phase === 'DRAWING' || state.phase === 'VOTING') && state.timerDuration && state.timerStart) {
            const serverStartTime = state.timerStart; const totalDuration = state.timerDuration * 1000;
            const elapsed = Date.now() - serverStartTime; const remainingDurationSeconds = Math.max(0, (totalDuration - elapsed) / 1000);
            console.log(`Syncing timer for ${state.phase}. Remaining: ${remainingDurationSeconds.toFixed(1)}s`);
            if (remainingDurationSeconds > 0) { UIManager.startTimer(remainingDurationSeconds); }
            else { UIManager.stopTimer(); }
        } else if (state.phase !== 'DRAWING' && state.phase !== 'VOTING') { UIManager.stopTimer(); }
    });
    socket.on('round start', ({ word, duration }) => {
        console.log(`Round Start. Word: ${word}, Duration: ${duration}s`);
        CanvasManager.clearCanvas(); CanvasManager.enableDrawing();
        if (typeof duration === 'number' && duration > 0) { UIManager.startTimer(duration); }
        else { console.error(`Invalid duration: ${duration}`); }
    });
    socket.on('voting start', ({ duration }) => {
        console.log(`Voting Start. Duration: ${duration}s`);
        CanvasManager.disableDrawing();
        if (typeof duration === 'number' && duration > 0) { UIManager.startTimer(duration); }
        else { console.error(`Invalid duration: ${duration}`); }
    });
    socket.on('vote error', (message) => {
        console.warn("Vote Error:", message); UIManager.addChatMessage({ text: `Vote Error: ${message}` }, 'system');
        VotingUI.enableVotingButtons(); // Use imported module
    });
    socket.on('vote accepted', () => {
        console.log("Vote accepted."); UIManager.addChatMessage({ text: "Vote cast!" }, 'system');
    });

    // --- Client Actions ---
    if (chatForm) { chatForm.addEventListener('submit', (e) => { e.preventDefault(); if (chatInput && chatInput.value.trim() && socket && socket.connected) { socket.emit('chat message', chatInput.value); chatInput.value = ''; } }); }
    else { console.error("Chat form not found!"); }

    if (readyButton) { readyButton.addEventListener('click', () => {
        console.log("Ready clicked"); const drawingDataUrl = CanvasManager.getDrawingDataURL();
        if (drawingDataUrl) {
            if (drawingDataUrl.length > 500000) { console.error("Drawing too large:", drawingDataUrl.length); UIManager.addChatMessage({ text: "Error: Drawing too large!" }, 'system'); return; }
            socket.emit('player ready', drawingDataUrl);
            CanvasManager.disableDrawing(); readyButton.disabled = true; readyButton.textContent = "Waiting..."; UIManager.addChatMessage({ text: "You are ready!" }, 'system');
        } else { console.error("Could not get drawing URL"); UIManager.addChatMessage({ text: "Error submitting drawing!" }, 'system'); }
    }); }
    else { console.warn("Ready button not found."); }

    if (votingArea) { votingArea.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' && e.target.classList.contains('vote-button') && e.target.dataset.voteFor) {
            const votedForId = e.target.dataset.voteFor; console.log(`Voting for ${votedForId}`);
            VotingUI.disableVotingButtons(); // Use imported module
            socket.emit('submit vote', votedForId);
        }
    }); }
    else { console.warn("Voting area not found."); }
} // End of initializeGame

function handleFatalError(message) {
    console.error("Fatal Error:", message);
    alert(`Error: ${message}. Redirecting to start page.`);
    window.location.href = '/game/'; // Redirect to game start page
}

// --- Initialize ---
try { initializeGame(); }
catch (error) { handleFatalError(`Initialization error: ${error.message}`); }