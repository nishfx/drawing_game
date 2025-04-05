// server/lobbyManager.js
import Lobby from './lobby.js';

const MAX_LOBBIES = 50;
const LOBBY_EMPTY_GRACE_PERIOD_MS = 5000;

class LobbyManager {
    constructor(io) {
        this.io = io;
        this.lobbies = new Map();
        this.recentlyCreated = new Set();
    }

    generateLobbyId() {
        let newId;
        do { newId = Math.random().toString(36).substring(2, 6).toUpperCase(); }
        while (this.lobbies.has(newId));
        return newId;
    }

    createLobby(hostSocket, username) {
        if (this.lobbies.size >= MAX_LOBBIES) { hostSocket.emit('lobby creation failed', 'Max lobbies.'); return; }
        if (!this.isValidUsername(username)) { hostSocket.emit('lobby creation failed', 'Invalid username.'); return; }
        const lobbyId = this.generateLobbyId();
        const newLobby = new Lobby(lobbyId, this.io, this);
        this.lobbies.set(lobbyId, newLobby);
        this.recentlyCreated.add(lobbyId);
        console.log(`Lobby ${lobbyId} added to recent set.`);
        setTimeout(() => { const wasPresent = this.recentlyCreated.delete(lobbyId); if (wasPresent) { console.log(`Grace ended for ${lobbyId}.`); } }, LOBBY_EMPTY_GRACE_PERIOD_MS);
        console.log(`Lobby created: ${lobbyId} by ${username}`);
        const added = newLobby.addPlayer(hostSocket, username, true);
        if (added) {
            hostSocket.emit('lobby created', { lobbyId });
            setTimeout(() => newLobby.broadcastSystemMessage(`${username} has joined the lobby.`), 100);
        }
        else {
            console.error(`Failed add host ${username} to ${lobbyId}`);
            this.lobbies.delete(lobbyId);
            this.recentlyCreated.delete(lobbyId);
            hostSocket.emit('lobby creation failed', 'Server error.');
        }
    }

    joinLobby(playerSocket, lobbyId, username) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) { playerSocket.emit('join failed', 'Not found.'); return; }
        if (!this.isValidUsername(username)) { playerSocket.emit('join failed', 'Invalid username.'); return; }
        if (lobby.isFull()) { playerSocket.emit('join failed', 'Full.'); return; }
        // Check username taken BEFORE adding
        if (lobby.isUsernameTakenByOther(username, playerSocket.id)) {
             playerSocket.emit('join failed', 'Username taken.');
             return;
        }
        console.log(`${username} joining ${lobbyId}`);
        const added = lobby.addPlayer(playerSocket, username, lobby.players.size === 0);
        if (added) {
            playerSocket.emit('join success', { lobbyId });
            setTimeout(() => lobby.broadcastSystemMessage(`${username} has joined the lobby.`), 100);
        }
        else {
            console.error(`Failed add player ${username} to ${lobbyId} unexpectedly.`);
            playerSocket.emit('join failed', 'Server error during join.');
        }
    }

    // --- Handle Rejoining Game ---
    rejoinGame(socket, lobbyId, username) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) {
            console.warn(`Socket ${socket.id} tried to rejoin non-existent lobby ${lobbyId}`);
            socket.emit('connection rejected', 'Game lobby not found.');
            socket.disconnect(true); return;
        }
        if (!this.isValidUsername(username)) {
             socket.emit('connection rejected', 'Invalid username for rejoin.');
             socket.disconnect(true); return;
        }

        // Find if player with this username already exists
        let existingPlayer = null;
        let oldSocketId = null;
        for (const [id, player] of lobby.players.entries()) {
            if (player.name === username) {
                existingPlayer = player;
                oldSocketId = id;
                break;
            }
        }

        if (existingPlayer) {
            // *** CRITICAL CHANGE: Always treat finding player by username as a reconnect ***
            // If the username matches, assume it's the same user reconnecting,
            // regardless of whether the old socket ID matches the new one or if the
            // old socket has fully disconnected on the server yet.

            console.log(`Player ${username} attempting to rejoin/refresh lobby ${lobbyId}. Found existing entry with socket ${oldSocketId}. New socket is ${socket.id}.`);

            // Remove the old entry *unconditionally* if the socket ID is different.
            // If the socket ID is the same, we don't need to remove/re-add, just update the socket ref.
            if (oldSocketId !== socket.id) {
                 console.log(`Removing old socket entry ${oldSocketId} for ${username}.`);
                 lobby.players.delete(oldSocketId); // Remove old mapping

                 // Update the player data object with the new socket details
                 existingPlayer.id = socket.id;
                 existingPlayer.socket = socket; // Update the socket reference

                 // Add the player back with the NEW socket ID
                 lobby.players.set(socket.id, existingPlayer);
                 console.log(`Re-added ${username} with new socket ID ${socket.id}.`);
            } else {
                 console.log(`Socket ID ${socket.id} is the same. Updating socket reference just in case.`);
                 existingPlayer.socket = socket; // Ensure socket reference is current
            }


            // Ensure the socket is in the room
            socket.join(lobby.id);

            // Re-register listeners
            if (typeof lobby.registerSocketEvents === 'function') {
                 lobby.registerSocketEvents(socket);
            } else {
                 console.error(`Lobby ${lobbyId} missing registerSocketEvents method!`);
            }

            // Send state
            lobby.sendLobbyState(socket);
            lobby.gameManager.broadcastGameState();

            // Update list for others (might show the user briefly disappear/reappear if disconnect was processed)
            lobby.broadcastLobbyPlayerList();
            // Optionally send a reconnect message if the socket ID changed
            if (oldSocketId !== socket.id) {
                lobby.broadcastSystemMessage(`${username} has reconnected.`);
            }

        } else {
            // Player with this username NOT found. Treat as a fresh join attempt.
            console.log(`Player ${username} not found in lobby ${lobbyId} on rejoin attempt. Treating as fresh join.`);
            // Check standard join conditions
             if (lobby.isFull()) {
                 socket.emit('connection rejected', 'Lobby is full.');
                 socket.disconnect(true); return;
             }
             // isUsernameTaken check is implicitly handled by addPlayer

            const added = lobby.addPlayer(socket, username, lobby.players.size === 0);
            if (added) {
                 lobby.broadcastSystemMessage(`${username} has joined the game.`);
                 lobby.broadcastLobbyPlayerList();
                 lobby.sendLobbyState(socket); // Send state after adding
                 lobby.gameManager.broadcastGameState();
            } else {
                 console.warn(`Failed to add player ${username} to lobby ${lobbyId} during rejoin.`);
                 socket.emit('connection rejected', 'Failed to join lobby.');
                 socket.disconnect(true);
            }
        }
    }

    leaveLobby(socket) {
        const lobby = this.findLobbyBySocketId(socket.id);
        if (lobby) {
            // Pass the socket itself to removePlayer for logging/checks
            lobby.removePlayer(socket);

            // Check if lobby is empty *after* removal attempt
            if (lobby.isEmpty()) {
                if (!this.recentlyCreated.has(lobby.id)) {
                    console.log(`Lobby ${lobby.id} is empty and past grace period, removing.`);
                    this.removeLobby(lobby.id);
                } else {
                    console.log(`Lobby ${lobby.id} is empty but within grace period.`);
                }
            }
        } else {
             console.log(`Socket ${socket.id} disconnected but was not found in any active lobby.`);
        }
    }

    findLobbyBySocketId(socketId) {
        for (const lobby of this.lobbies.values()) {
            if (lobby.players.has(socketId)) { return lobby; }
        }
        return null;
    }

    getLobbyList() {
        return Array.from(this.lobbies.values()).map(lobby => ({
            id: lobby.id, hostName: lobby.getHostName(), playerCount: lobby.players.size,
            maxPlayers: lobby.maxPlayers, gamePhase: lobby.gameManager?.gamePhase || 'LOBBY'
        }));
    }

    sendLobbyList(socket) {
        socket.emit('lobby list update', this.getLobbyList());
    }

    isValidUsername(username) {
         return username && typeof username === 'string' && username.trim().length > 0 && username.length <= 16 && /^[A-Za-z0-9_]+$/.test(username);
    }

    removeLobby(lobbyId) {
        const lobby = this.lobbies.get(lobbyId);
        if (lobby) {
            console.log(`LobbyManager removing lobby: ${lobbyId}`);
            if (lobby.gameManager && lobby.gameManager.roundTimer) {
                clearTimeout(lobby.gameManager.roundTimer);
            }
            this.lobbies.delete(lobbyId);
            this.recentlyCreated.delete(lobbyId);
        }
    }
}

export default LobbyManager;