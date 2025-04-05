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

let socket = null; // Initialize socket connection later if needed for lobby list

function connectSocket() {
    if (socket && socket.connected) {
        requestLobbyList(); // Request list if already connected
        return;
    }
    // --- Connect specifying the path - Add /game prefix ---
    // If running WITHOUT Nginx locally, change path to '/game/socket.io'
    const socketPath = '/socket.io'; // For Nginx setup removing /game prefix
    // const socketPath = '/game/socket.io'; // For local testing without Nginx
    console.log(`Attempting to connect socket at ${socketPath}`);
    socket = io({ path: socketPath });
    // --- End Connect ---

    socket.on('connect', () => {
        console.log('Connected to server for lobby list.');
        requestLobbyList(); // Request list on connect
    });

    socket.on('disconnect', (reason) => {
        console.log(`Disconnected from server. Reason: ${reason}`);
        LobbyListUI.showError("Disconnected from server. Cannot fetch lobbies.");
        enableLobbyListButtons(); // Re-enable buttons on disconnect
        enableUsernameForm(); // Re-enable create/join
    });

     socket.on('connect_error', (err) => {
        console.error("Main page connection Error:", err);
        LobbyListUI.showError("Failed to connect to server.");
        enableLobbyListButtons();
        enableUsernameForm();
    });

    socket.on('lobby list update', (lobbies) => {
        console.log('Received lobby list:', lobbies);
        LobbyListUI.updateLobbyList(lobbies, handleJoinLobbyClick); // Pass click handler
        enableLobbyListButtons(); // Re-enable buttons after update
    });

    // Listen for creation/join responses
    socket.on('lobby created', ({ lobbyId }) => {
        console.log('Lobby created successfully:', lobbyId);
        // --- Redirect path - Add /game prefix ---
        window.location.href = `/game/lobby?id=${lobbyId}`; // Path WITH /game
        // --- End Redirect ---
    });

    socket.on('lobby creation failed', (reason) => {
        console.error('Lobby creation failed:', reason);
        errorMessage.textContent = `Failed to create lobby: ${reason}`;
        enableUsernameForm();
    });

     socket.on('join success', ({ lobbyId }) => {
        console.log('Joined lobby successfully:', lobbyId);
         // --- Redirect path - Add /game prefix ---
        window.location.href = `/game/lobby?id=${lobbyId}`; // Path WITH /game
        // --- End Redirect ---
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

function validateUsername() {
    const username = usernameInput.value.trim();
    errorMessage.textContent = ''; // Clear previous errors

    if (!username) { errorMessage.textContent = 'Please enter a username.'; return null; }
    if (!/^[A-Za-z0-9_]+$/.test(username)) { errorMessage.textContent = 'Invalid characters (use A-Z, a-z, 0-9, _).'; return null; }
    if (username.length > 16) { errorMessage.textContent = 'Max 16 characters.'; return null; }
    return username;
}

function disableUsernameForm() {
    usernameInput.disabled = true; createLobbyBtn.disabled = true; showJoinBtn.disabled = true;
    createLobbyBtn.textContent = 'Creating...';
}
function enableUsernameForm() {
    usernameInput.disabled = false; createLobbyBtn.disabled = false; showJoinBtn.disabled = false;
    createLobbyBtn.textContent = 'Create Lobby';
}

function disableLobbyListButtons() {
     if(refreshLobbiesBtn) refreshLobbiesBtn.disabled = true;
     if(backToUsernameBtn) backToUsernameBtn.disabled = true;
     if(lobbyListUl) lobbyListUl.querySelectorAll('button.join-lobby-btn').forEach(btn => btn.disabled = true);
}
function enableLobbyListButtons() {
     if(refreshLobbiesBtn) refreshLobbiesBtn.disabled = false;
     if(backToUsernameBtn) backToUsernameBtn.disabled = false;
     if(lobbyListUl) {
        // Re-enable buttons based on lobby state shown in the list item
        lobbyListUl.querySelectorAll('li').forEach(item => {
            const button = item.querySelector('button.join-lobby-btn');
            if (button) {
                const phaseSpan = item.querySelector('.lobby-phase');
                const playersSpan = item.querySelector('.lobby-players');
                let isJoinable = true;
                if (phaseSpan && phaseSpan.textContent.includes('LOBBY') === false) {
                    isJoinable = false; // In game
                    button.textContent = 'In Game';
                }
                if (playersSpan) {
                    const match = playersSpan.textContent.match(/(\d+)\/(\d+)/);
                    if (match && parseInt(match[1], 10) >= parseInt(match[2], 10)) {
                        isJoinable = false; // Full
                        button.textContent = 'Full';
                    }
                }
                button.disabled = !isJoinable;
                if (isJoinable) {
                    button.textContent = 'Join'; // Reset text if it became joinable
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
        disableLobbyListButtons(); // Disable while loading
    } else {
        console.warn('Cannot request lobby list, socket not connected.');
        LobbyListUI.showError("Not connected to server.");
        // Attempt to connect if not connected
        connectSocket();
    }
}

// --- Event Handlers ---
usernameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = validateUsername();
    if (!username) return;
    sessionStorage.setItem('drawingGameUsername', username);
    // Default action on Enter is Create
    console.log('Attempting to create lobby...');
    disableUsernameForm();
    if (!socket || !socket.connected) {
        connectSocket();
        // Wait for connection before emitting
        socket.once('connect', () => { // Use 'once' to avoid multiple emits on reconnect
             console.log("Connected, emitting create lobby");
             socket.emit('create lobby', username);
        });
        // Add a timeout in case connection fails
        setTimeout(() => {
             if (!socket || !socket.connected) {
                 errorMessage.textContent = 'Connection failed. Cannot create lobby.';
                 enableUsernameForm();
             }
        }, 5000); // 5 second timeout
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
    connectSocket(); // Ensure socket is connected and request list
});

refreshLobbiesBtn.addEventListener('click', requestLobbyList);

backToUsernameBtn.addEventListener('click', () => {
    lobbyListSection.style.display = 'none';
    usernameForm.parentElement.style.display = 'block';
    errorMessage.textContent = '';
    disconnectSocket(); // Disconnect socket when going back
});

function handleJoinLobbyClick(lobbyId) {
     const username = sessionStorage.getItem('drawingGameUsername');
     if (!username) {
        errorMessage.textContent = 'Username not set. Please go back.';
        return;
     }
     if (socket && socket.connected) {
         console.log(`Attempting join ${lobbyId} as ${username}`);
         disableLobbyListButtons(); // Disable all buttons while attempting join
         socket.emit('join lobby', { lobbyId, username });
     } else {
        LobbyListUI.showError("Not connected. Please refresh.");
        // Attempt to reconnect?
        connectSocket();
     }
}

// --- Initial State ---
lobbyListSection.style.display = 'none';
// Attempt to retrieve username from session storage on load
const storedUsername = sessionStorage.getItem('drawingGameUsername');
if (storedUsername && usernameInput) {
    usernameInput.value = storedUsername;
}