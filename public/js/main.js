// public/js/main.js - Script for index.html (start page)
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
    // --- Connect specifying the path ---
    console.log("Attempting to connect socket at /game/socket.io");
    socket = io({ path: '/game/socket.io' }); // Tell client where Socket.IO is served by Nginx
    // --- End Connect ---

    socket.on('connect', () => {
        console.log('Connected to server for lobby list.');
        requestLobbyList(); // Request list on connect
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server.');
        LobbyListUI.showError("Disconnected from server. Cannot fetch lobbies.");
    });

     socket.on('connect_error', (err) => {
        console.error("Main page connection Error:", err);
        LobbyListUI.showError("Failed to connect to server.");
    });

    socket.on('lobby list update', (lobbies) => {
        console.log('Received lobby list:', lobbies);
        LobbyListUI.updateLobbyList(lobbies, handleJoinLobbyClick); // Pass click handler
        enableLobbyListButtons(); // Re-enable buttons after update
    });

    // Listen for creation/join responses
    socket.on('lobby created', ({ lobbyId }) => {
        console.log('Lobby created successfully:', lobbyId);
        // --- Add /game prefix ---
        window.location.href = `/game/lobby?id=${lobbyId}`;
        // --- End Add ---
    });

    socket.on('lobby creation failed', (reason) => {
        console.error('Lobby creation failed:', reason);
        errorMessage.textContent = `Failed to create lobby: ${reason}`;
        enableUsernameForm();
    });

     socket.on('join success', ({ lobbyId }) => {
        console.log('Joined lobby successfully:', lobbyId);
         // --- Add /game prefix ---
        window.location.href = `/game/lobby?id=${lobbyId}`;
        // --- End Add ---
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
    if (!/^[A-Za-z0-9_]+$/.test(username)) { errorMessage.textContent = 'Invalid characters.'; return null; }
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
     refreshLobbiesBtn.disabled = true; backToUsernameBtn.disabled = true;
     lobbyListUl.querySelectorAll('button.join-lobby-btn').forEach(btn => btn.disabled = true);
}
function enableLobbyListButtons() {
     refreshLobbiesBtn.disabled = false; backToUsernameBtn.disabled = false;
     lobbyListUl.querySelectorAll('button.join-lobby-btn').forEach(btn => {
         // Re-enable only if lobby isn't full/in-game based on its text content perhaps?
         // For simplicity, re-enable all for now. List update will disable again if needed.
         btn.disabled = false;
     });
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
        }, 3000); // 3 second timeout
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
     if (!username) { /* ... handle error ... */ return; }
     if (socket && socket.connected) {
         console.log(`Attempting join ${lobbyId} as ${username}`);
         disableLobbyListButtons();
         socket.emit('join lobby', { lobbyId, username });
     } else { LobbyListUI.showError("Not connected."); }
}

// --- Initial State ---
lobbyListSection.style.display = 'none';