// public/js/lobbyClient.js
import * as CanvasManager from './canvasManager.js';
import * as PlayerListUI from './ui/playerListUI.js';
import * as ChatUI from './ui/chatUI.js';

console.log("Lobby Client script loaded.");

let socket = null;
let myPlayerId = null;
let currentLobbyId = null;
let isHost = false;
let hasJoined = false;
let minPlayersToStart = 2; // Default
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

// ---------------------------------

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
    if (!CanvasManager.initCanvas('lobby-canvas', handleDrawEvent)) {
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

    // ***CHANGED***: We now pass data.playerId to removeCommands
    socket.on('lobby commands removed', ({ cmdIds, strokeId, playerId }) => { // <-- CHANGED
        console.log(`Received removal: cmdIds=${cmdIds}, strokeId=${strokeId}, player=${playerId}`);
        CanvasManager.removeCommands(cmdIds || [], strokeId || null, playerId); // <-- CHANGED
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
        CanvasManager.disableDrawing();
        ChatUI.addChatMessage({ text: "Game is starting...", type: 'system' });
        setTimeout(() => {
            window.location.href = `/game/game?lobbyId=${confirmedLobbyId}`;
        }, 1000);
    });

    socket.on('system message', message => {
        ChatUI.addChatMessage({ text: message, type: 'system' });
    });
}

function handleDrawEvent(drawDetail) {
    if (socket && socket.connected && hasJoined) {
        socket.emit('lobby draw', drawDetail);
    }
}

// --------------

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

    // Listen for tool selection
    if (drawingToolsContainer) {
        drawingToolsContainer.addEventListener('click', e => {
            const button = e.target.closest('.tool-button');
            if (button && button.dataset.tool) {
                drawingToolsContainer.querySelectorAll('.tool-button.active').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                const selectedTool = button.dataset.tool;
                CanvasManager.setTool(selectedTool);
                console.log(`Tool set to: ${selectedTool}`);
            } else if (button && button.id === 'undo-btn') {
                console.log("Undo clicked");
                CanvasManager.undoLastAction(socket);
            } else if (button && button.id === 'clear-canvas-btn') {
                console.log("Clear Canvas clicked");
                CanvasManager.clearCanvas(true);
            }
        });

        if (colorPicker) {
            colorPicker.addEventListener('input', e => {
                CanvasManager.setColor(e.target.value);
            });
            CanvasManager.setColor(colorPicker.value);
        }

        if (lineWidthSelector) {
            lineWidthSelector.addEventListener('change', e => {
                CanvasManager.setLineWidth(e.target.value);
            });
            CanvasManager.setLineWidth(lineWidthSelector.value);
        }
    }
}

// --------------

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
}

function populateEmojiPicker() {
    if (!emojiPicker) return;
    const emojis = ['😊','😂','😍','🤔','😢','😠','👍','👎','❤️','🎉','✨','🔥','💡','❓','❗','👋','👀','✅','❌','💯'];
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLobby);
} else {
    initializeLobby();
}
