import * as CanvasManager from './canvasManager.js';
import * as PlayerListUI from './ui/playerListUI.js';
import * as ChatUI from './ui/chatUI.js';

console.log("Lobby Client script loaded.");

let socket = null;
let myPlayerId = null;
let currentLobbyId = null;
let isHost = false;
let hasJoined = false;
let minPlayersToStart = 2;
const MAX_PLAYERS = 4;

// DOM elements
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
const askAiBtn = document.getElementById('ask-ai-btn');
const aiInterpretationBox = document.getElementById('ai-interpretation-box');
// --- NEW Settings Elements ---
const gameSettingsArea = document.getElementById('game-settings-area');
const gameModeSelect = document.getElementById('game-mode-select');
const roundsSelect = document.getElementById('rounds-select');
const drawTimeSelect = document.getElementById('draw-time-select');
const saveSettingsBtn = document.getElementById('save-settings-btn');
// --- End NEW Settings Elements ---

// ---------------------------------

function initializeLobby() {
    console.log("Initializing Lobby UI...");
    hasJoined = false;

    const urlParams = new URLSearchParams(window.location.search);
    currentLobbyId = urlParams.get('id');
    const username = sessionStorage.getItem('drawingGameUsername');

    if (!currentLobbyId || !username) { handleFatalError("Missing lobby ID or username."); return; }

    console.log(`Lobby ID: ${currentLobbyId}, Username: ${username}`);
    if (!CanvasManager.initCanvas('lobby-canvas', handleDrawEvent)) { handleFatalError("Failed to initialize lobby canvas."); return; }

    CanvasManager.setColor(colorPicker?.value || '#000000');
    CanvasManager.setLineWidth(lineWidthSelector?.value || 5);
    CanvasManager.setTool('pencil');

    setupSocketConnection(currentLobbyId, username);
    setupActionListeners();
    populateEmojiPicker();
    if (askAiBtn) askAiBtn.disabled = true;
    if (gameSettingsArea) gameSettingsArea.style.display = 'none'; // Hide settings initially
}

function setupSocketConnection(lobbyId, username) {
    if (socket && socket.connected) socket.disconnect();

    const socketPath = '/game/socket.io';
    socket = io({ path: socketPath });

    socket.on('connect', () => {
        console.log('Connected!', socket.id);
        myPlayerId = socket.id;
        CanvasManager.setPlayerId(myPlayerId);
        if (statusDisplay) { statusDisplay.textContent = 'Connected'; statusDisplay.style.color = 'green'; }
        if (!hasJoined) { socket.emit('join lobby', { lobbyId, username }); }
        else { socket.emit('join lobby', { lobbyId, username }); } // Rejoin logic
    });

    socket.on('disconnect', reason => {
        console.log(`Disconnected: ${reason}`);
        if (statusDisplay) { statusDisplay.textContent = 'Disconnected'; statusDisplay.style.color = 'red'; }
        if (lobbyStatus) lobbyStatus.textContent = "Disconnected.";
        if (startGameBtn) startGameBtn.style.display = 'none';
        if (gameSettingsArea) gameSettingsArea.style.display = 'none'; // Hide settings on disconnect
        if (askAiBtn) askAiBtn.disabled = true;
        CanvasManager.disableDrawing();
        hasJoined = false; myPlayerId = null; isHost = false; CanvasManager.setPlayerId(null);
    });

    socket.on('connect_error', err => {
        console.error("Conn Error:", err);
        if (statusDisplay) { statusDisplay.textContent = 'Connection Failed'; statusDisplay.style.color = 'red'; }
        if (lobbyStatus) lobbyStatus.textContent = "Connection failed.";
        if (gameSettingsArea) gameSettingsArea.style.display = 'none';
        if (askAiBtn) askAiBtn.disabled = true;
        alert("Failed to connect. Please refresh.");
    });

    socket.on('join success', ({ lobbyId: confirmedLobbyId }) => {
        console.log(`Joined lobby ${confirmedLobbyId}`);
        hasJoined = true; currentLobbyId = confirmedLobbyId;
    });
    socket.on('join failed', reason => {
        console.error('Join failed:', reason);
        if (!hasJoined) { alert(`Failed to join: ${reason}`); window.location.href = '/game/'; }
        else { ChatUI.addChatMessage({ text: `Error: ${reason}`, type: 'system' }); }
    });

    socket.on('lobby state', state => {
        console.log('Lobby state:', state);
        if (!myPlayerId) myPlayerId = socket.id;
        CanvasManager.setPlayerId(myPlayerId);
        hasJoined = true;
        minPlayersToStart = state.minPlayers || 2;
        PlayerListUI.updatePlayerList(state.players, myPlayerId);
        ChatUI.clearChat();
        state.chatHistory?.forEach(msg => ChatUI.addChatMessage(msg));
        CanvasManager.loadAndDrawHistory(state.canvasCommands || []);
        isHost = (state.hostId === myPlayerId);
        updateLobbySettingsUI(state.settings); // Update UI with current settings
        updateLobbyUI(state); // Update buttons/status based on host status etc.
        // Only enable drawing if game is not running
        if (!state.gamePhase || state.gamePhase === 'LOBBY') {
            CanvasManager.enableDrawing();
        } else {
            CanvasManager.disableDrawing();
        }
    });

    // --- NEW: Listener for settings updates from server ---
    socket.on('lobby settings update', (settings) => {
        console.log('Received settings update:', settings);
        updateLobbySettingsUI(settings);
        ChatUI.addChatMessage({ text: "Lobby settings updated by host.", type: 'system' });
    });
    // --- End NEW ---

    socket.on('lobby player list update', players => {
        PlayerListUI.updatePlayerList(players, myPlayerId);
        const me = players.find(p => p.id === myPlayerId);
        isHost = me ? me.isHost : false;
        updateLobbyUI({ players }); // Update host-specific UI (start button, settings area)
    });

    socket.on('lobby chat message', msgData => ChatUI.addChatMessage(msgData, msgData.type || 'normal'));
    socket.on('lobby commands removed', ({ cmdIds, strokeId, playerId }) => CanvasManager.removeCommands(cmdIds || [], strokeId || null, playerId));
    socket.on('lobby draw update', drawData => CanvasManager.drawExternalCommand(drawData));

    socket.on('promoted to host', () => {
        console.log("Promoted to host!");
        isHost = true;
        ChatUI.addChatMessage({ text: "You are now the host.", type: 'system' });
        updateLobbyUI({}); // Update host-specific UI
    });

    socket.on('game starting', ({ lobbyId: confirmedLobbyId, gameMode }) => {
        console.log(`Game starting (Mode: ${gameMode}) for ${confirmedLobbyId}!`);
        if (startGameBtn) startGameBtn.disabled = true;
        if (askAiBtn) askAiBtn.disabled = true;
        if (gameSettingsArea) gameSettingsArea.style.display = 'none'; // Hide settings when game starts
        CanvasManager.disableDrawing();
        ChatUI.addChatMessage({ text: `Starting ${gameMode} game...`, type: 'system' });
        // Redirect to the game page
        setTimeout(() => { window.location.href = `/game/game?lobbyId=${confirmedLobbyId}`; }, 1000);
    });

    socket.on('system message', message => ChatUI.addChatMessage({ text: message, type: 'system' }));
    socket.on('ai interpretation result', ({ interpretation, error }) => {
        if (askAiBtn) askAiBtn.disabled = !isHost;
        if (aiInterpretationBox) {
            if (error) { aiInterpretationBox.value = `Error: ${error}`; aiInterpretationBox.style.color = 'red'; }
            else { aiInterpretationBox.value = interpretation || "AI couldn't interpret."; aiInterpretationBox.style.color = '#495057'; }
            aiInterpretationBox.placeholder = "AI interpretation...";
        }
    });
}

function handleDrawEvent(drawDetail) {
    if (socket && socket.connected && hasJoined) { socket.emit('lobby draw', drawDetail); }
}

// --------------

function setupActionListeners() {
    if (chatForm) { /* ... chat submit listener ... */
        chatForm.addEventListener('submit', e => {
            e.preventDefault();
            if (chatInput && chatInput.value.trim() && socket && socket.connected) {
                // Send as 'lobby chat message' - server decides context
                socket.emit('lobby chat message', chatInput.value);
                chatInput.value = '';
                if (emojiPicker) emojiPicker.style.display = 'none';
            }
        });
    }
    if (startGameBtn) { /* ... start game listener ... */
        startGameBtn.addEventListener('click', () => {
            if (isHost && socket && socket.connected) {
                console.log("Requesting start game...");
                socket.emit('start game'); // Server reads settings from lobby state
                startGameBtn.disabled = true;
                startGameBtn.textContent = 'Starting...';
            }
        });
    }
    if (emojiBtn) { /* ... emoji listener ... */
        emojiBtn.addEventListener('click', e => {
            e.stopPropagation();
            if (emojiPicker) emojiPicker.style.display = (emojiPicker.style.display === 'block') ? 'none' : 'block';
        });
    }
    document.addEventListener('click', e => { /* ... close emoji picker ... */
        if (emojiPicker && emojiPicker.style.display === 'block' && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
            emojiPicker.style.display = 'none';
        }
    });
    if (drawingToolsContainer) { /* ... drawing tools listeners ... */
        drawingToolsContainer.addEventListener('click', e => {
            const button = e.target.closest('.tool-button');
            if (button && button.dataset.tool) {
                drawingToolsContainer.querySelectorAll('.tool-button.active').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                CanvasManager.setTool(button.dataset.tool);
            } else if (button && button.id === 'undo-btn') {
                CanvasManager.undoLastAction(socket);
            } else if (button && button.id === 'clear-canvas-btn') {
                CanvasManager.clearCanvas(true);
            }
        });
        if (colorPicker) colorPicker.addEventListener('input', e => CanvasManager.setColor(e.target.value));
        if (lineWidthSelector) lineWidthSelector.addEventListener('change', e => CanvasManager.setLineWidth(e.target.value));
    }
    if (askAiBtn) { /* ... ask AI listener ... */
        askAiBtn.addEventListener('click', () => {
            if (!isHost || !socket || !socket.connected) return;
            const imageDataUrl = CanvasManager.getDrawingDataURL();
            if (!imageDataUrl) { if (aiInterpretationBox) aiInterpretationBox.value = "Error: Could not capture."; return; }
            if (imageDataUrl.length > 2 * 1024 * 1024) { if (aiInterpretationBox) aiInterpretationBox.value = "Error: Drawing too large."; return; }
            if (aiInterpretationBox) { aiInterpretationBox.placeholder = "AI thinking..."; aiInterpretationBox.value = ""; aiInterpretationBox.style.color = '#6c757d'; }
            askAiBtn.disabled = true;
            socket.emit('request ai interpretation', imageDataUrl);
        });
    }

    // --- NEW: Settings Save Button Listener ---
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => {
            if (!isHost || !socket || !socket.connected) return;
            const newSettings = {
                gameMode: gameModeSelect.value,
                totalRounds: roundsSelect.value,
                drawTime: drawTimeSelect.value,
            };
            console.log("Sending settings update:", newSettings);
            socket.emit('update settings', newSettings);
            // Optionally provide user feedback e.g., disable button briefly
            saveSettingsBtn.textContent = 'Applied!';
            setTimeout(() => { saveSettingsBtn.textContent = 'Apply Settings'; }, 1500);
        });
    }
    // --- End NEW ---
}

// --------------

// --- NEW: Update Settings UI ---
function updateLobbySettingsUI(settings) {
    if (!settings) return;
    if (gameModeSelect) gameModeSelect.value = settings.gameMode || 'ArtistPvp';
    if (roundsSelect) roundsSelect.value = settings.totalRounds || 3;
    if (drawTimeSelect) drawTimeSelect.value = settings.drawTime || 90;
}
// --- End NEW ---

function updateLobbyUI(state) {
    const players = state.players || PlayerListUI.getPlayersFromList();
    const playerCount = players.length;

    if (playerCountDisplay) playerCountDisplay.textContent = `(${playerCount}/${MAX_PLAYERS})`;
    if (lobbyTitleDisplay) { /* ... update lobby title ... */
        const host = players.find(p => p.isHost);
        lobbyTitleDisplay.textContent = host ? `${host.name}'s Lobby` : "Lobby";
        lobbyTitleDisplay.title = lobbyTitleDisplay.textContent;
    }
    if (lobbyStatus) { /* ... update lobby status ... */
        if (playerCount < minPlayersToStart) { lobbyStatus.textContent = `Waiting for ${minPlayersToStart - playerCount} more player(s)...`; }
        else { const host = players.find(p => p.isHost); lobbyStatus.textContent = isHost ? `Ready when you are!` : `Waiting for host (${host?.name || '...'})...`; }
    }
    if (startGameBtn) { /* ... update start button ... */
        if (isHost) {
            startGameBtn.style.display = 'block';
            startGameBtn.disabled = (playerCount < minPlayersToStart);
            startGameBtn.textContent = (playerCount < minPlayersToStart) ? `Need ${minPlayersToStart - playerCount} more` : 'Start Game';
        } else {
            startGameBtn.style.display = 'none';
        }
    }
    if (askAiBtn) askAiBtn.disabled = !isHost;

    // --- NEW: Show/Hide Settings Area ---
    if (gameSettingsArea) {
        gameSettingsArea.style.display = isHost ? 'block' : 'none';
    }
    // --- End NEW ---
}

function populateEmojiPicker() { /* ... remains the same ... */
    if (!emojiPicker) return;
    const emojis = ['😊','😂','😍','🤔','😢','😠','👍','👎','❤️','🎉','✨','🔥','💡','❓','❗','👋','👀','✅','❌','💯'];
    emojiPicker.innerHTML = '';
    emojis.forEach(emoji => {
        const span = document.createElement('span');
        span.textContent = emoji;
        span.addEventListener('click', () => {
            if (chatInput) { chatInput.value += emoji; chatInput.focus(); }
            emojiPicker.style.display = 'none';
        });
        emojiPicker.appendChild(span);
    });
}
function handleFatalError(message) { /* ... remains the same ... */
    console.error("Fatal:", message);
    alert(`Error: ${message}. Redirecting.`);
    window.location.href = '/game/';
}

// --------------

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initializeLobby); }
else { initializeLobby(); }