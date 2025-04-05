import * as UIManager from './uiManager.js';
import * as CanvasManager from './canvasManager.js';
import * as ChatUI from './ui/chatUI.js';
import * as ResultsUI from './ui/resultsUI.js';
import * as RatingUI from './ui/ratingUI.js'; // NEW UI module for rating phase

console.log("Game Client script loaded.");

const socketPath = '/game/socket.io';
const socket = io({ path: socketPath });

let myPlayerId = null;
let currentLobbyId = null;
let currentWord = ''; // Single word for the round
let isHost = false; // Track if the current client is the host

// --- DOM Elements ---
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const readyButton = document.getElementById('ready-button');
const statusDisplay = document.getElementById('status');
const wordHintElement = document.getElementById('word-hint');
const gameModeDisplay = document.getElementById('game-mode-display'); // To show game mode
const roundDisplay = document.getElementById('round-display'); // To show round number
const ratingGrid = document.getElementById('rating-grid'); // Container for rating items

// --- Initial Setup ---
function initializeGame() {
    const urlParams = new URLSearchParams(window.location.search);
    currentLobbyId = urlParams.get('lobbyId');
    const username = sessionStorage.getItem('drawingGameUsername');

    if (!currentLobbyId || !username) { handleFatalError("Missing lobby ID or username."); return; }

    console.log(`Initializing game for lobby: ${currentLobbyId}, user: ${username}`);

    if (!CanvasManager.initCanvas('drawing-canvas', null)) { handleFatalError("Failed to initialize game canvas."); return; }
    CanvasManager.disableDrawing();

    // --- Socket Event Listeners ---
    socket.on('connect', () => {
        console.log('Connected!', socket.id);
        myPlayerId = socket.id;
        CanvasManager.setPlayerId(myPlayerId);
        if (statusDisplay) { statusDisplay.textContent = 'Connected'; statusDisplay.style.color = 'green'; }
        socket.emit('join game room', { lobbyId: currentLobbyId, username });
    });

    socket.on('disconnect', (reason) => {
        console.log(`Disconnected: ${reason}`);
        if (statusDisplay) { statusDisplay.textContent = 'Disconnected'; statusDisplay.style.color = 'red'; }
        UIManager.stopTimer(); myPlayerId = null; CanvasManager.setPlayerId(null); isHost = false;
        UIManager.showGamePhaseUI('WAITING', {});
        document.getElementById('game-status').textContent = "Disconnected.";
        ChatUI.addChatMessage({ text: "Disconnected.", type: 'system' });
    });
    socket.on('connect_error', (err) => { /* ... error handling ... */ });
    socket.on('connection rejected', (reason) => { /* ... rejection handling ... */ });

    socket.on('update player list', (players) => { UIManager.updatePlayerList(players, myPlayerId); });
    socket.on('chat message', (msgData) => { ChatUI.addChatMessage(msgData, msgData.type || 'normal'); });
    socket.on('system message', (message) => { ChatUI.addChatMessage({ text: message, type: 'system' }); });

    // Word assignment is handled in game state update now for single word

    // --- Game Flow Events ---
    socket.on('game state update', (state) => {
        console.log("Game State Update:", state);
        if (!myPlayerId) myPlayerId = socket.id;
        CanvasManager.setPlayerId(myPlayerId);
        isHost = (state.hostId === myPlayerId); // Update host status

        // Update general UI elements
        if (gameModeDisplay) gameModeDisplay.textContent = state.gameMode || 'Game'; // Show game mode if available
        if (roundDisplay) roundDisplay.textContent = (state.phase !== 'LOBBY' && state.currentRound && state.totalRounds) ? `Round ${state.currentRound} / ${state.totalRounds}` : '';

        currentWord = state.word || ''; // Update current word

        // Update UI based on phase
        UIManager.showGamePhaseUI(state.phase, {
            myPlayerId: myPlayerId,
            isHost: isHost, // Pass host status to UI Manager
            word: state.word,
            scores: state.scores,
            drawings: state.drawings,
            ratings: state.ratings,
            isRatingInProgress: state.isRatingInProgress, // Pass rating progress info
            minPlayers: state.minPlayers,
            playerCount: state.playerCount,
            readyCount: state.readyCount,
            currentRound: state.currentRound,
            totalRounds: state.totalRounds,
        });

        // Sync timer
        if ((state.phase === 'DRAWING' || state.phase === 'MANUAL_RATING' || state.phase === 'RESULTS' || state.phase === 'FINAL_SCOREBOARD') && state.timerDuration && state.timerStart) {
            const serverStartTime = state.timerStart;
            const totalDuration = state.timerDuration * 1000;
            const elapsed = Date.now() - serverStartTime;
            const remainingDurationSeconds = Math.max(0, (totalDuration - elapsed) / 1000);
            if (remainingDurationSeconds > 0) { UIManager.startTimer(remainingDurationSeconds); }
            else { UIManager.stopTimer(); }
        } else {
            UIManager.stopTimer();
        }

        // Enable/disable drawing
        if (state.phase === 'DRAWING') {
            if (readyButton && !readyButton.disabled) {
                CanvasManager.enableDrawing();
                if (wordHintElement) wordHintElement.textContent = `Your word: ${currentWord}`;
            } else {
                CanvasManager.disableDrawing();
                if (wordHintElement) wordHintElement.textContent = `Waiting for others...`;
            }
        } else {
            CanvasManager.disableDrawing();
            // Clear word hint unless in rating/results
            if (!['MANUAL_RATING', 'RESULTS', 'FINAL_SCOREBOARD'].includes(state.phase) && wordHintElement) {
                 wordHintElement.textContent = '---';
            } else if (wordHintElement && currentWord) {
                 // Show word during rating/results
                 wordHintElement.textContent = `Word was: ${currentWord}`;
            }
        }
    });

    // --- NEW: Handle individual AI rating updates ---
    socket.on('ai rating update', ({ targetPlayerId, rating }) => {
        console.log(`Received rating update for ${targetPlayerId}:`, rating);
        RatingUI.updateRatingDisplay(targetPlayerId, rating); // Update specific rating box
    });
    // --- End NEW ---


    // --- Client Actions ---
    if (chatForm) { /* ... chat submit listener ... */
         chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (chatInput && chatInput.value.trim() && socket && socket.connected) {
                socket.emit('chat message', chatInput.value); // Server handles context
                chatInput.value = '';
            }
        });
    }
    if (readyButton) { /* ... ready button listener ... */
         readyButton.addEventListener('click', () => {
            console.log("Submit Drawing clicked");
            const drawingDataUrl = CanvasManager.getDrawingDataURL();
            if (drawingDataUrl) {
                if (drawingDataUrl.length > 2 * 1024 * 1024) { ChatUI.addChatMessage({ text: "Error: Drawing too large!", type: 'system' }); return; }
                socket.emit('player ready', drawingDataUrl);
                CanvasManager.disableDrawing();
                readyButton.disabled = true;
                readyButton.textContent = "Waiting for others...";
                if (wordHintElement) wordHintElement.textContent = `Waiting for others...`;
            } else {
                ChatUI.addChatMessage({ text: "Error submitting drawing!", type: 'system' });
            }
        });
    }

    // --- NEW: Listener for Rating Buttons ---
    if (ratingGrid) {
        ratingGrid.addEventListener('click', (e) => {
            const button = e.target.closest('button.rate-btn');
            if (button && !button.disabled && button.dataset.targetPlayerId) {
                const targetPlayerId = button.dataset.targetPlayerId;
                if (!isHost) {
                    console.warn("Non-host clicked rate button.");
                    return;
                }
                console.log(`Requesting rating for player ${targetPlayerId}`);
                button.disabled = true; // Disable button immediately
                button.textContent = 'Rating...';
                RatingUI.showRatingInProgress(targetPlayerId, true); // Show overlay
                socket.emit('rate drawing request', { targetPlayerId });
            }
        });
    }
    // --- End NEW ---


} // End of initializeGame

function handleFatalError(message) { /* ... remains the same ... */
    console.error("Fatal Error:", message);
    alert(`Error: ${message}. Redirecting to start page.`);
    window.location.href = '/game/';
}

// --- Initialize ---
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initializeGame); }
else { initializeGame(); }