// public/js/main.js
// (Restored original socket path)
import * as LobbyListUI from './ui/lobbyListUI.js';

const usernameForm = document.getElementById('username-form');
const usernameInput = document.getElementById('username');
const createLobbyBtn = document.getElementById('create-lobby-btn');
const showJoinBtn = document.getElementById('show-join-btn');
const errorMessage = document.getElementById('error-message');

const lobbyListSection = document.getElementById('lobby-list-section');
const lobbyListUl = document.getElementById('lobby-list');
const refreshLobbiesBtn = document.getElementById('refresh-lobbies-btn');
const backToUsernameBtn = document.getElementById('back-to-username-btn');

let socket = null;

// ------------------- [CHANGED] -------------------
// 1) On connection errors, clear sessionStorage so
//    the user won’t keep a stale username after a server
//    restart or pm2 reload.
// -------------------------------------------------

function connectSocket() {
    if (socket && socket.connected) {
        requestLobbyList();
        return;
    }
    const socketPath = '/game/socket.io';
    console.log(`Attempting to connect socket at ${socketPath}`);
    socket = io({ path: socketPath });

    socket.on('connect', () => {
        console.log('Connected to server for lobby list.');
        requestLobbyList(); // Request on connect
    });

    socket.on('disconnect', (reason) => {
        console.log(`Disconnected from server. Reason: ${reason}`);
        LobbyListUI.showError("Disconnected from server. Cannot fetch lobbies.");
        enableLobbyListButtons();
        enableUsernameForm();
    });

    socket.on('connect_error', (err) => {
        console.error("Main page connection Error:", err);
        // [CHANGED] Clear the stored username so we don’t keep reusing
        // it if the server is fresh after a restart.
        sessionStorage.removeItem('drawingGameUsername');
        LobbyListUI.showError("Failed to connect to server.");
        enableLobbyListButtons();
        enableUsernameForm();
    });

    socket.on('lobby list update', (lobbies) => {
        console.log('Received lobby list:', lobbies);
        LobbyListUI.updateLobbyList(lobbies, handleJoinLobbyClick);
        enableLobbyListButtons();
    });

    // Creation & join responses
    socket.on('lobby created', ({ lobbyId }) => {
        console.log('Lobby created successfully:', lobbyId);
        window.location.href = `/game/lobby?id=${lobbyId}`;
    });

    socket.on('lobby creation failed', (reason) => {
        console.error('Lobby creation failed:', reason);
        errorMessage.textContent = `Failed to create lobby: ${reason}`;
        enableUsernameForm();
    });

    socket.on('join success', ({ lobbyId }) => {
        console.log('Joined lobby successfully:', lobbyId);
        window.location.href = `/game/lobby?id=${lobbyId}`;
    });

    socket.on('join failed', (reason) => {
        console.error('Join lobby failed:', reason);
        LobbyListUI.showError(`Failed to join lobby: ${reason}`);
        enableLobbyListButtons();
    });
}

function disconnectSocket() {
    if (socket) {
        socket.disconnect();
        socket = null;
        console.log('Socket disconnected.');
    }
}

// ---------- UI / Form Handling ----------
function validateUsername() {
    const username = usernameInput.value.trim();
    errorMessage.textContent = '';

    if (!username) {
        errorMessage.textContent = 'Please enter a username.';
        return null;
    }
    if (!/^[A-Za-z0-9_]+$/.test(username)) {
        errorMessage.textContent = 'Invalid characters (use A-Z, a-z, 0-9, _).';
        return null;
    }
    if (username.length > 16) {
        errorMessage.textContent = 'Max 16 characters.';
        return null;
    }
    return username;
}

function disableUsernameForm() {
    usernameInput.disabled = true;
    createLobbyBtn.disabled = true;
    showJoinBtn.disabled = true;
    createLobbyBtn.textContent = 'Creating...';
}
function enableUsernameForm() {
    usernameInput.disabled = false;
    createLobbyBtn.disabled = false;
    showJoinBtn.disabled = false;
    createLobbyBtn.textContent = 'Create Lobby';
}

function disableLobbyListButtons() {
    if (refreshLobbiesBtn) refreshLobbiesBtn.disabled = true;
    if (backToUsernameBtn) backToUsernameBtn.disabled = true;
    if (lobbyListUl) {
        lobbyListUl.querySelectorAll('button.join-lobby-btn').forEach(btn => btn.disabled = true);
    }
}
function enableLobbyListButtons() {
    if (refreshLobbiesBtn) refreshLobbiesBtn.disabled = false;
    if (backToUsernameBtn) backToUsernameBtn.disabled = false;
    if (lobbyListUl) {
        lobbyListUl.querySelectorAll('li').forEach(item => {
            const button = item.querySelector('button.join-lobby-btn');
            if (button) {
                let isJoinable = true;
                const phaseSpan = item.querySelector('.lobby-phase');
                if (phaseSpan && !phaseSpan.textContent.includes('LOBBY')) {
                    isJoinable = false;
                    button.textContent = 'In Game';
                }
                const playersSpan = item.querySelector('.lobby-players');
                if (playersSpan) {
                    const match = playersSpan.textContent.match(/(\d+)\/(\d+)/);
                    if (match && parseInt(match[1], 10) >= parseInt(match[2], 10)) {
                        isJoinable = false;
                        button.textContent = 'Full';
                    }
                }
                button.disabled = !isJoinable;
                if (isJoinable) {
                    button.textContent = 'Join';
                }
            }
        });
    }
}

function requestLobbyList() {
    if (socket && socket.connected) {
        console.log('Requesting lobby list...');
        socket.emit('request lobby list');
        LobbyListUI.showLoading();
        disableLobbyListButtons();
    } else {
        console.warn('Cannot request lobby list, socket not connected.');
        LobbyListUI.showError("Not connected to server.");
        connectSocket();
    }
}

usernameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = validateUsername();
    if (!username) return;
    sessionStorage.setItem('drawingGameUsername', username);
    console.log('Attempting to create lobby...');
    disableUsernameForm();
    if (!socket || !socket.connected) {
        connectSocket();
        socket.once('connect', () => {
            console.log("Connected, emitting create lobby");
            socket.emit('create lobby', username);
        });
        setTimeout(() => {
            if (!socket || !socket.connected) {
                errorMessage.textContent = 'Connection failed. Cannot create lobby.';
                enableUsernameForm();
            }
        }, 5000);
    } else {
        socket.emit('create lobby', username);
    }
});

showJoinBtn.addEventListener('click', () => {
    const username = validateUsername();
    if (!username) return;
    sessionStorage.setItem('drawingGameUsername', username);
    console.log('Showing lobby list section...');
    usernameForm.parentElement.style.display = 'none';
    lobbyListSection.style.display = 'block';
    connectSocket();
});

refreshLobbiesBtn.addEventListener('click', requestLobbyList);

backToUsernameBtn.addEventListener('click', () => {
    lobbyListSection.style.display = 'none';
    usernameForm.parentElement.style.display = 'block';
    errorMessage.textContent = '';
    disconnectSocket();
});

// Join-lobby callback from the UI
function handleJoinLobbyClick(lobbyId) {
    const username = sessionStorage.getItem('drawingGameUsername');
    if (!username) {
        errorMessage.textContent = 'Username not set. Please go back.';
        return;
    }
    if (socket && socket.connected) {
        console.log(`Attempting join ${lobbyId} as ${username}`);
        disableLobbyListButtons();
        socket.emit('join lobby', { lobbyId, username });
    } else {
        LobbyListUI.showError("Not connected. Please refresh.");
        connectSocket();
    }
}

// Pre-populate from session
const storedUsername = sessionStorage.getItem('drawingGameUsername');
if (storedUsername && usernameInput) {
    usernameInput.value = storedUsername;
}