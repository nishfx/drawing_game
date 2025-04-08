/* public/js/lobbyClient.js */
import * as CanvasManager from './canvasManager.js';
import * as PlayerListUI from './ui/playerListUI.js';
import * as ChatUI from './ui/chatUI.js';

console.log("Lobby Client script loaded.");

let socket = null;
let myPlayerId = null;
let currentLobbyId = null;
let isHost = false;
let hasJoined = false;
let minPlayersToStart = 2; // default
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

// AI Elements
const askAiBtn = document.getElementById('ask-ai-btn');
const aiInterpretationBox = document.getElementById('ai-interpretation-box');

// NEW: Updated Settings Window Elements
const settingsWindow = document.getElementById('settings-window');
const settingsForm = document.getElementById('settings-form');
const saveSettingsBtn = document.getElementById('save-settings-btn');

// The newly added dropdowns:
const gameModeSelect = document.getElementById('game-mode-select');
const drawTimeSelect = document.getElementById('draw-time-select');
const voteTimeSelect = document.getElementById('vote-time-select');
const pointsToWinSelect = document.getElementById('points-to-win-select');

/** Local in-memory game settings. For now, only Artist PvP with these 3. */
let currentSettings = {
    gameMode: 'artist-pvp',
    drawTime: 120,  // 2m by default
    voteTime: 45,   // 45s by default
    pointsToWin: 15
};

function initializeLobby() {
    console.log("Initializing Lobby UI...");
    hasJoined = false;

    const urlParams = new URLSearchParams(window.location.search);
    currentLobbyId = urlParams.get('id');
    const username = sessionStorage.getItem('drawingGameUsername');

    if (!currentLobbyId || !username) {
        handleFatalError("Missing lobby ID or username.");
        return;
    }

    console.log(`Lobby ID: ${currentLobbyId}, Username: ${username}`);
    if (!CanvasManager.initCanvas('lobby-canvas', handleDrawEvent, null)) {
        handleFatalError("Failed to initialize lobby canvas.");
        return;
    }

    // Set initial tool state
    CanvasManager.setColor(colorPicker?.value || '#000000');
    CanvasManager.setLineWidth(lineWidthSelector?.value || 5);
    CanvasManager.setTool('pencil');

    setupSocketConnection(currentLobbyId, username);
    setupActionListeners();
    populateEmojiPicker();

    // For now, disable the settings form by default. We'll enable it if we detect host.
    disableSettingsForm(true);
    if (askAiBtn) askAiBtn.disabled = true;
}

function setupSocketConnection(lobbyId, username) {
    if (socket && socket.connected) socket.disconnect();

    const socketPath = '/game/socket.io';
    console.log(`Connecting socket at ${socketPath}`);
    socket = io({ path: socketPath });

    socket.on('connect', () => {
        console.log('Connected to server!', socket.id);
        myPlayerId = socket.id;
        CanvasManager.setPlayerId(myPlayerId);
        if (statusDisplay) {
            statusDisplay.textContent = 'Connected';
            statusDisplay.style.color = 'green';
        }
        CanvasManager.initCanvas('lobby-canvas', handleDrawEvent, socket);

        if (!hasJoined) {
            console.log(`Emitting join lobby for ${lobbyId} as ${username}`);
            socket.emit('join lobby', { lobbyId, username });
        } else {
            console.log("Reconnected, rejoining lobby state.");
            socket.emit('join lobby', { lobbyId, username });
        }
    });

    socket.on('disconnect', reason => {
        console.log(`Disconnected: ${reason}`);
        if (statusDisplay) {
            statusDisplay.textContent = 'Disconnected';
            statusDisplay.style.color = 'red';
        }
        if (lobbyStatus) lobbyStatus.textContent = "Disconnected. Refresh?";
        if (startGameBtn) startGameBtn.style.display = 'none';
        if (playerCountDisplay) playerCountDisplay.textContent = '(0/?)';
        if (lobbyTitleDisplay) lobbyTitleDisplay.textContent = "Lobby";
        if (askAiBtn) askAiBtn.disabled = true;
        disableSettingsForm(true);

        CanvasManager.disableDrawing();
        hasJoined = false;
        myPlayerId = null;
        isHost = false;
        CanvasManager.setPlayerId(null);
    });

    socket.on('connect_error', err => {
        console.error("Lobby connection Error:", err);
        if (statusDisplay) {
            statusDisplay.textContent = 'Connection Failed';
            statusDisplay.style.color = 'red';
        }
        if (lobbyStatus) lobbyStatus.textContent = "Connection failed.";
        if (askAiBtn) askAiBtn.disabled = true;
        disableSettingsForm(true);
        alert("Failed to connect. Please refresh.");
    });

    socket.on('join success', ({ lobbyId: confirmedLobbyId }) => {
        console.log(`Joined lobby ${confirmedLobbyId}`);
        hasJoined = true;
        currentLobbyId = confirmedLobbyId;
    });

    socket.on('join failed', reason => {
        console.error('Join lobby failed:', reason);
        if (!hasJoined) {
            alert(`Failed to join lobby: ${reason}`);
            window.location.href = '/game/';
        } else {
            ChatUI.addChatMessage({ text: `Error: ${reason}`, type: 'system' });
        }
    });

    socket.on('lobby state', state => {
        console.log('Received lobby state:', state);
        if (!myPlayerId) myPlayerId = socket.id;
        CanvasManager.setPlayerId(myPlayerId);
        hasJoined = true;
        minPlayersToStart = state.minPlayers || 2;

        PlayerListUI.updatePlayerList(state.players, myPlayerId);
        ChatUI.clearChat();
        state.chatHistory?.forEach(msg => ChatUI.addChatMessage(msg));

        CanvasManager.loadAndDrawHistory(state.canvasCommands || []);

        // Determine if I'm host
        isHost = (state.hostId === myPlayerId);

        updateLobbyUI(state);
        CanvasManager.enableDrawing();
    });

    socket.on('lobby player list update', players => {
        console.log('Player list update:', players);
        PlayerListUI.updatePlayerList(players, myPlayerId);
        const me = players.find(p => p.id === myPlayerId);
        isHost = me ? me.isHost : false;
        updateLobbyUI({ players });
    });

    socket.on('lobby chat message', msgData => {
        ChatUI.addChatMessage(msgData, msgData.type || 'normal');
    });

    socket.on('lobby commands removed', ({ cmdIds, strokeId, playerId }) => {
        console.log(`Received removal: cmdIds=${cmdIds}, strokeId=${strokeId}, player=${playerId}`);
        if (playerId !== myPlayerId) {
            CanvasManager.removeCommands(cmdIds || [], strokeId || null, playerId);
        } else {
            console.log("Ignoring our own removal command from server.");
        }
    });

    socket.on('lobby draw update', drawData => {
        CanvasManager.drawExternalCommand(drawData);
    });

    socket.on('promoted to host', () => {
        console.log("Promoted to host!");
        isHost = true;
        ChatUI.addChatMessage({ text: "You are now the host.", type: 'system' });
        if (startGameBtn) startGameBtn.style.display = 'block';
        updateLobbyUI({});
    });

    socket.on('game starting', ({ lobbyId: confirmedLobbyId }) => {
        console.log(`Game starting for ${confirmedLobbyId}!`);
        if (startGameBtn) startGameBtn.disabled = true;
        if (askAiBtn) askAiBtn.disabled = true;
        disableSettingsForm(true);
        CanvasManager.disableDrawing();
        ChatUI.addChatMessage({ text: "Game is starting...", type: 'system' });
        setTimeout(() => {
            window.location.href = `/game/game?lobbyId=${confirmedLobbyId}`;
        }, 1000);
    });

    socket.on('system message', message => {
        ChatUI.addChatMessage({ text: message, type: 'system' });
    });

    // AI Interpretation
    socket.on('ai interpretation result', ({ interpretation, error }) => {
        if (askAiBtn) askAiBtn.disabled = !isHost;
        if (aiInterpretationBox) {
            if (error) {
                aiInterpretationBox.value = `Error: ${error}`;
                aiInterpretationBox.style.color = 'red';
            } else {
                aiInterpretationBox.value = interpretation || "AI couldn't interpret.";
                aiInterpretationBox.style.color = '#495057';
            }
            aiInterpretationBox.placeholder = "AI interpretation will appear here...";
        }
    });
}

function handleDrawEvent(drawDetail) {
    if (socket && socket.connected && hasJoined) {
        socket.emit('lobby draw', drawDetail);
    }
}

function setupActionListeners() {
    if (chatForm) {
        chatForm.addEventListener('submit', e => {
            e.preventDefault();
            if (chatInput && chatInput.value.trim() && socket && socket.connected) {
                socket.emit('lobby chat message', chatInput.value);
                chatInput.value = '';
                if (emojiPicker) emojiPicker.style.display = 'none';
            }
        });
    }

    if (startGameBtn) {
        startGameBtn.addEventListener('click', () => {
            if (isHost && socket && socket.connected) {
                console.log("Requesting start game...");
                socket.emit('start game');
                startGameBtn.disabled = true;
                startGameBtn.textContent = 'Starting...';
            }
        });
    }

    if (emojiBtn) {
        emojiBtn.addEventListener('click', e => {
            e.stopPropagation();
            if (emojiPicker) {
                emojiPicker.style.display = (emojiPicker.style.display === 'block') ? 'none' : 'block';
            }
        });
    }

    document.addEventListener('click', e => {
        if (emojiPicker && emojiPicker.style.display === 'block' && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
            emojiPicker.style.display = 'none';
        }
    });

    if (drawingToolsContainer) {
        drawingToolsContainer.addEventListener('click', e => {
            const button = e.target.closest('.tool-button');
            if (button && button.dataset.tool) {
                drawingToolsContainer.querySelectorAll('.tool-button.active').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                const selectedTool = button.dataset.tool;
                CanvasManager.setTool(selectedTool);
            } else if (button && button.id === 'undo-btn') {
                if (socket) {
                    CanvasManager.undoLastAction(socket);
                } else {
                    console.error("Cannot undo: Socket not available.");
                }
            } else if (button && button.id === 'clear-canvas-btn') {
                CanvasManager.clearCanvas(true);
            }
        });

        if (colorPicker) {
            colorPicker.addEventListener('input', e => {
                CanvasManager.setColor(e.target.value);
            });
        }
        if (lineWidthSelector) {
            lineWidthSelector.addEventListener('change', e => {
                CanvasManager.setLineWidth(e.target.value);
            });
        }
    }

    // AI Button
    if (askAiBtn) {
        askAiBtn.addEventListener('click', () => {
            if (!isHost) {
                console.warn("Ask AI clicked by non-host.");
                return;
            }
            if (!socket || !socket.connected) {
                console.error("Cannot ask AI: Socket not connected.");
                if (aiInterpretationBox) aiInterpretationBox.value = "Error: Not connected.";
                return;
            }

            const imageDataUrl = CanvasManager.getDrawingDataURL();
            if (!imageDataUrl) {
                if (aiInterpretationBox) aiInterpretationBox.value = "Error: Could not capture drawing.";
                return;
            }
            if (imageDataUrl.length > 2 * 1024 * 1024) {
                if (aiInterpretationBox) aiInterpretationBox.value = "Error: Drawing is too large.";
                return;
            }

            console.log("Requesting AI interpretation...");
            if (aiInterpretationBox) {
                aiInterpretationBox.placeholder = "AI is thinking...";
                aiInterpretationBox.value = "";
                aiInterpretationBox.style.color = '#6c757d';
            }
            askAiBtn.disabled = true;
            socket.emit('request ai interpretation', imageDataUrl);
        });
    }

    // Save Settings
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => {
            if (!isHost) {
                console.log("Ignoring settings save from non-host.");
                return;
            }
            // Read the current dropdown values
            const selectedGameMode = gameModeSelect.value;
            const drawVal = parseInt(drawTimeSelect.value, 10);
            const voteVal = parseInt(voteTimeSelect.value, 10);
            const pointsVal = parseInt(pointsToWinSelect.value, 10);

            currentSettings.gameMode = selectedGameMode;
            currentSettings.drawTime = isNaN(drawVal) ? 120 : drawVal;
            currentSettings.voteTime = isNaN(voteVal) ? 45 : voteVal;
            currentSettings.pointsToWin = isNaN(pointsVal) ? 15 : pointsVal;

            console.log("Settings updated locally:", currentSettings);
            // In a real app, you'd do: socket.emit('update-settings', currentSettings);

            alert("Settings saved (client-only example).");
        });
    }
}

// Called in multiple places to keep UI consistent
function updateLobbyUI(state) {
    const players = state.players || PlayerListUI.getPlayersFromList();
    const playerCount = players.length;

    if (playerCountDisplay) {
        playerCountDisplay.textContent = `(${playerCount}/${MAX_PLAYERS})`;
    }

    if (lobbyTitleDisplay) {
        const host = players.find(p => p.isHost);
        const hostName = host ? host.name : null;
        lobbyTitleDisplay.textContent = hostName ? `${hostName}'s Lobby` : "Lobby";
        lobbyTitleDisplay.title = lobbyTitleDisplay.textContent;
    }

    if (lobbyStatus) {
        if (playerCount < minPlayersToStart) {
            lobbyStatus.textContent = `Waiting for ${minPlayersToStart - playerCount} more player(s)...`;
        } else {
            const host = players.find(p => p.isHost);
            const hostName = host ? host.name : '...';
            lobbyStatus.textContent = isHost ? `Ready when you are!` : `Waiting for host (${hostName})...`;
        }
    }

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

    if (askAiBtn) {
        askAiBtn.disabled = !isHost;
    }

    // Enable or disable settings form
    disableSettingsForm(!isHost);
}

// Disable or enable the entire settings form
function disableSettingsForm(disabled) {
    if (!settingsForm) return;
    Array.from(settingsForm.elements).forEach(el => {
        if (el.id !== 'save-settings-btn') {
            el.disabled = disabled;
        }
    });
    // Optionally hide the Save button if not host
    if (saveSettingsBtn) {
        saveSettingsBtn.style.display = disabled ? 'none' : 'inline-block';
    }
}

function populateEmojiPicker() {
    if (!emojiPicker) return;
    const emojis = [
        '😊','😂','😍','🤔','😢','😠','👍','👎','❤️','🎉','✨','🔥',
        '💡','❓','❗','👋','👀','✅','❌','💯'
    ];
    emojiPicker.innerHTML = '';
    emojis.forEach(emoji => {
        const span = document.createElement('span');
        span.textContent = emoji;
        span.addEventListener('click', () => {
            if (chatInput) {
                chatInput.value += emoji;
                chatInput.focus();
            }
            emojiPicker.style.display = 'none';
        });
        emojiPicker.appendChild(span);
    });
}

function handleFatalError(message) {
    console.error("Fatal:", message);
    alert(`Error: ${message}. Redirecting.`);
    window.location.href = '/game/';
}

// --------------
// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLobby);
} else {
    initializeLobby();
}
