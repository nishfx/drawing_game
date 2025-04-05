// public/js/gameClient.js
// (Restored original socket path)
import * as UIManager from './uiManager.js';
import * as CanvasManager from './canvasManager.js'; // Game uses canvas but without tools
import * as VotingUI from './ui/votingUI.js';
import * as ChatUI from './ui/chatUI.js'; // Import ChatUI

console.log("Game Client script loaded.");

// --- Specify path for Socket.IO connection ---
const socketPath = '/game/socket.io'; // Use path WITH /game prefix
const socket = io({ path: socketPath });
// --- End Specify ---

let myPlayerId = null;
let currentLobbyId = null;

// --- DOM Elements ---
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const readyButton = document.getElementById('ready-button');
const votingArea = document.getElementById('voting-area');
const statusDisplay = document.getElementById('status'); // Connection status

// --- Initial Setup ---
function initializeGame() {
    const urlParams = new URLSearchParams(window.location.search);
    currentLobbyId = urlParams.get('lobbyId'); // Get lobbyId from query param
    const username = sessionStorage.getItem('drawingGameUsername');

    if (!currentLobbyId || !username) { handleFatalError("Missing lobby ID or username."); return; }

    console.log(`Initializing game for lobby: ${currentLobbyId}, user: ${username}`);
    // Initialize canvas but don't pass draw handler (no drawing tools here)
    // Game canvas doesn't need the event emitter callback
    if (!CanvasManager.initCanvas('drawing-canvas', null)) {
        handleFatalError("Failed to initialize game canvas."); return;
    }
    // Game canvas starts disabled, enabled only by server state
    CanvasManager.disableDrawing();

    // --- Socket Event Listeners ---
    socket.on('connect', () => {
        console.log('Connected to game server!', socket.id);
        myPlayerId = socket.id; // Set player ID
        CanvasManager.setPlayerId(myPlayerId); // Inform CanvasManager
        if (statusDisplay) {
            statusDisplay.textContent = 'Connected';
            statusDisplay.style.color = 'green';
        }
        // --- Emit event to join the specific game room ---
        console.log(`Emitting join game room for lobby ${currentLobbyId}`);
        socket.emit('join game room', { lobbyId: currentLobbyId, username }); // Send necessary info
    });

    socket.on('disconnect', (reason) => {
        console.log(`Disconnected. Reason: ${reason}`);
        if (statusDisplay) {
            statusDisplay.textContent = 'Disconnected';
            statusDisplay.style.color = 'red';
        }
        UIManager.stopTimer();
        myPlayerId = null;
        CanvasManager.setPlayerId(null);
        UIManager.showGamePhaseUI('WAITING', { playerCount: 0, minPlayers: 2 });
        document.getElementById('game-status').textContent = "Disconnected. Refresh or return to start.";
        ChatUI.addChatMessage({ text: "Disconnected from server.", type: 'system' });
    });
    socket.on('connect_error', (err) => {
        console.error("Game connection Error:", err);
        if (statusDisplay) {
            statusDisplay.textContent = 'Connection Failed';
            statusDisplay.style.color = 'red';
        }
        document.getElementById('game-status').textContent = "Connection failed.";
        alert("Connection failed. Please refresh.");
    });
    socket.on('connection rejected', (reason) => {
        console.error('Game Rejected:', reason); alert(`Cannot join game: ${reason}`);
        window.location.href = '/game/'; // Redirect to game base path
    });

    // No 'my info' needed, ID set on connect

    socket.on('update player list', (players) => { UIManager.updatePlayerList(players, myPlayerId); });
    socket.on('chat message', (msgData) => {
        ChatUI.addChatMessage(msgData, msgData.type || 'normal'); // Use ChatUI
    });
    socket.on('system message', (message) => {
        ChatUI.addChatMessage({ text: message, type: 'system' }); // Use ChatUI
    });

    // --- Game Flow Events ---
    socket.on('game state update', (state) => {
        console.log("Game State Update:", state);
        if (!myPlayerId) myPlayerId = socket.id; // Ensure ID is set
        CanvasManager.setPlayerId(myPlayerId);

        // Update UI based on phase
        UIManager.showGamePhaseUI(state.phase, {
            word: state.word,
            drawings: state.drawings,
            scores: state.scores,
            myPlayerId: myPlayerId,
            minPlayers: state.minPlayers,
            playerCount: state.playerCount
        });

        // Sync timer based on state
        if ((state.phase === 'DRAWING' || state.phase === 'VOTING') && state.timerDuration && state.timerStart) {
            const serverStartTime = state.timerStart;
            const totalDuration = state.timerDuration * 1000;
            const elapsed = Date.now() - serverStartTime;
            const remainingDurationSeconds = Math.max(0, (totalDuration - elapsed) / 1000);
            console.log(`Syncing timer for ${state.phase}. Remaining: ${remainingDurationSeconds.toFixed(1)}s`);
            if (remainingDurationSeconds > 0) {
                UIManager.startTimer(remainingDurationSeconds);
            } else {
                UIManager.stopTimer();
            }
        } else if (state.phase !== 'DRAWING' && state.phase !== 'VOTING') {
            UIManager.stopTimer();
        }

        // Enable/disable drawing based on phase
        if (state.phase === 'DRAWING') {
            // Only enable drawing if the player hasn't submitted yet
            // We check the readyButton state which is disabled after submission
            if (readyButton && !readyButton.disabled) {
                CanvasManager.enableDrawing();
            } else {
                CanvasManager.disableDrawing(); // Keep disabled if already submitted
            }
            CanvasManager.clearCanvas(false); // Clear canvas at start of drawing phase
        } else {
            CanvasManager.disableDrawing();
        }
    });

    socket.on('round start', ({ word, duration }) => {
        console.log(`Round Start. Word: ${word}, Duration: ${duration}s`);
        // State update handles canvas clear/enable and timer start
    });

    socket.on('voting start', ({ duration }) => {
        console.log(`Voting Start. Duration: ${duration}s`);
        // State update handles canvas disable and timer start
    });

    socket.on('vote error', (message) => {
        console.warn("Vote Error:", message);
        ChatUI.addChatMessage({ text: `Vote Error: ${message}`, type: 'system' });
        VotingUI.enableVotingButtons(); // Re-enable buttons on error
    });

    socket.on('vote accepted', () => {
        console.log("Vote accepted.");
        ChatUI.addChatMessage({ text: "Vote cast!", type: 'system' });
        // Buttons remain disabled after successful vote
    });

    // --- Client Actions ---
    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (chatInput && chatInput.value.trim() && socket && socket.connected) {
                socket.emit('chat message', chatInput.value); // Use 'chat message' for game context
                chatInput.value = '';
            }
        });
    } else { console.error("Chat form not found!"); }

    if (readyButton) {
        readyButton.addEventListener('click', () => {
            console.log("Ready clicked");
            const drawingDataUrl = CanvasManager.getDrawingDataURL();
            if (drawingDataUrl) {
                // Basic size check (adjust limit as needed)
                if (drawingDataUrl.length > 1000000) { // 1MB limit
                    console.error("Drawing too large:", drawingDataUrl.length);
                    ChatUI.addChatMessage({ text: "Error: Drawing is too large to submit!", type: 'system' });
                    return;
                }
                socket.emit('player ready', drawingDataUrl);
                CanvasManager.disableDrawing(); // Disable drawing after submitting
                readyButton.disabled = true;
                readyButton.textContent = "Waiting...";
                // Server will send confirmation via system message if needed
            } else {
                console.error("Could not get drawing URL");
                ChatUI.addChatMessage({ text: "Error submitting drawing!", type: 'system' });
            }
        });
    } else { console.warn("Ready button not found."); }

    if (votingArea) {
        votingArea.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON' && e.target.classList.contains('vote-button') && e.target.dataset.voteFor) {
                const votedForId = e.target.dataset.voteFor;
                console.log(`Voting for ${votedForId}`);
                VotingUI.disableVotingButtons(); // Disable all buttons immediately
                socket.emit('submit vote', votedForId);
            }
        });
    } else { console.warn("Voting area not found."); }
} // End of initializeGame

function handleFatalError(message) {
    console.error("Fatal Error:", message);
    alert(`Error: ${message}. Redirecting to start page.`);
    window.location.href = '/game/'; // Redirect to game base path
}

// --- Initialize ---
// Ensure DOM is fully loaded before initializing
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeGame);
} else {
    initializeGame();
}