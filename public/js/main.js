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
        return; // Already connected
    }
    socket = io(); // Connect to Socket.IO server

    socket.on('connect', () => {
        console.log('Connected to server for lobby list.');
        requestLobbyList(); // Request list on connect
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server.');
        LobbyListUI.showError("Disconnected from server. Cannot fetch lobbies.");
    });

    socket.on('lobby list update', (lobbies) => {
        console.log('Received lobby list:', lobbies);
        LobbyListUI.updateLobbyList(lobbies, handleJoinLobbyClick); // Pass click handler
    });

    // Listen for creation/join responses
    socket.on('lobby created', ({ lobbyId }) => {
        console.log('Lobby created successfully:', lobbyId);
        // Redirect to lobby page
        window.location.href = `/lobby?id=${lobbyId}`;
    });

    socket.on('lobby creation failed', (reason) => {
        console.error('Lobby creation failed:', reason);
        errorMessage.textContent = `Failed to create lobby: ${reason}`;
        enableUsernameForm();
    });

     socket.on('join success', ({ lobbyId }) => {
        console.log('Joined lobby successfully:', lobbyId);
        // Redirect to lobby page
        window.location.href = `/lobby?id=${lobbyId}`;
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

    if (!username) {
        errorMessage.textContent = 'Please enter a username.';
        return null;
    }
    if (!/^[A-Za-z0-9_]+$/.test(username)) {
         errorMessage.textContent = 'Username can only contain letters, numbers, and underscores.';
         return null;
    }
     if (username.length > 16) {
         errorMessage.textContent = 'Username cannot exceed 16 characters.';
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
     refreshLobbiesBtn.disabled = true;
     backToUsernameBtn.disabled = true;
     // Disable individual join buttons
     lobbyListUl.querySelectorAll('button').forEach(btn => btn.disabled = true);
}
function enableLobbyListButtons() {
     refreshLobbiesBtn.disabled = false;
     backToUsernameBtn.disabled = false;
     lobbyListUl.querySelectorAll('button').forEach(btn => btn.disabled = false);
}


function requestLobbyList() {
    if (socket && socket.connected) {
        console.log('Requesting lobby list...');
        socket.emit('request lobby list');
        LobbyListUI.showLoading();
    } else {
        console.warn('Cannot request lobby list, socket not connected.');
        LobbyListUI.showError("Not connected to server.");
    }
}

// --- Event Handlers ---

// Handle Create or Join attempt
usernameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = validateUsername();
    if (!username) return;

    // Store username for next page
    sessionStorage.setItem('drawingGameUsername', username);

    // Determine if Create or Join was intended (based on which button was clicked)
    // Since submit can be triggered by Enter key, we check which button was focused or default to Create
    const action = e.submitter?.id === 'create-lobby-btn' ? 'create' : 'create'; // Default to create on Enter

    if (action === 'create') {
        console.log('Attempting to create lobby...');
        disableUsernameForm();
        if (!socket || !socket.connected) {
            connectSocket(); // Connect if not already
            // Wait briefly for connection before emitting
            setTimeout(() => {
                 if (socket && socket.connected) {
                     socket.emit('create lobby', username);
                 } else {
                     errorMessage.textContent = 'Connection failed. Cannot create lobby.';
                     enableUsernameForm();
                 }
            }, 500); // Adjust delay if needed
        } else {
             socket.emit('create lobby', username);
        }
    }
    // Join action is handled by showJoinBtn click
});

// Show Lobby List Section
showJoinBtn.addEventListener('click', () => {
    const username = validateUsername();
    if (!username) return;

    // Store username
    sessionStorage.setItem('drawingGameUsername', username);

    console.log('Showing lobby list section...');
    usernameForm.parentElement.style.display = 'none'; // Hide username form container
    lobbyListSection.style.display = 'block'; // Show lobby list container
    connectSocket(); // Ensure socket is connected
});

// Refresh Lobby List Button
refreshLobbiesBtn.addEventListener('click', () => {
    requestLobbyList();
});

// Back Button from Lobby List
backToUsernameBtn.addEventListener('click', () => {
    lobbyListSection.style.display = 'none';
    usernameForm.parentElement.style.display = 'block';
    errorMessage.textContent = ''; // Clear errors
    disconnectSocket(); // Disconnect when going back
});

// Handle clicks on dynamically generated Join buttons in the lobby list
function handleJoinLobbyClick(lobbyId) {
     const username = sessionStorage.getItem('drawingGameUsername'); // Get stored username
     if (!username) {
         // Should not happen if validation passed, but handle defensively
         errorMessage.textContent = 'Username not found. Please go back.';
         lobbyListSection.style.display = 'none';
         usernameForm.parentElement.style.display = 'block';
         return;
     }
     if (socket && socket.connected) {
         console.log(`Attempting to join lobby ${lobbyId} as ${username}`);
         disableLobbyListButtons(); // Prevent multiple clicks
         socket.emit('join lobby', { lobbyId, username });
     } else {
         LobbyListUI.showError("Not connected. Cannot join lobby.");
     }
}

// --- Initial State ---
// Ensure lobby list is hidden initially
lobbyListSection.style.display = 'none';