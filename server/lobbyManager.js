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
        if (added) { hostSocket.emit('lobby created', { lobbyId }); newLobby.broadcastSystemMessage(`${username} joined.`); }
        else { console.error(`Failed add host ${username} to ${lobbyId}`); this.lobbies.delete(lobbyId); this.recentlyCreated.delete(lobbyId); hostSocket.emit('lobby creation failed', 'Server error.'); }
    }

    joinLobby(playerSocket, lobbyId, username) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) { playerSocket.emit('join failed', 'Not found.'); return; }
        if (!this.isValidUsername(username)) { playerSocket.emit('join failed', 'Invalid username.'); return; }
        if (lobby.isFull()) { playerSocket.emit('join failed', 'Full.'); return; }
        if (lobby.isUsernameTakenByOther(username, playerSocket.id)) { playerSocket.emit('join failed', 'Username taken.'); return; }
        console.log(`${username} joining ${lobbyId}`);
        const added = lobby.addPlayer(playerSocket, username, lobby.players.size === 0);
        if (added) { playerSocket.emit('join success', { lobbyId }); lobby.broadcastSystemMessage(`${username} joined.`); }
        else { console.error(`Failed add player ${username} to ${lobbyId}`); playerSocket.emit('join failed', 'Server error.'); }
    }

    // --- NEW: Handle Rejoining Game ---
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

        // Find if player with this username already exists (maybe disconnected briefly)
        let existingPlayer = null;
        let oldSocketId = null;
        for (const [id, player] of lobby.players.entries()) {
            if (player.name === username) {
                existingPlayer = player;
                oldSocketId = id; // Store the old socket ID if found
                break;
            }
        }

        if (existingPlayer) {
            // If socket ID is different, it's a reconnect - update socket ref
            if (oldSocketId !== socket.id) {
                console.log(`Player ${username} reconnected with new socket ${socket.id} in lobby ${lobbyId}. Updating references.`);
                // Remove old entry, add new one with updated socket/id
                lobby.players.delete(oldSocketId);
                existingPlayer.id = socket.id; // Update ID in player data
                existingPlayer.socket = socket; // Update socket reference
                lobby.players.set(socket.id, existingPlayer); // Re-add with new ID
                // Re-join the Socket.IO room
                socket.join(lobby.id);
                // Re-register listeners for the new socket (Lobby needs this method)
                if (typeof lobby.registerSocketEvents === 'function') {
                     lobby.registerSocketEvents(socket);
                } else {
                     console.error(`Lobby ${lobbyId} missing registerSocketEvents method!`);
                }
                // Send current state to ensure sync
                lobby.sendLobbyState(socket); // Send lobby state first
                lobby.gameManager.broadcastGameState(); // Then send game state
                // Update player list for everyone
                lobby.broadcastLobbyPlayerList();
            } else {
                 // Same socket ID, maybe just a refresh? Ensure they are in the room.
                 socket.join(lobby.id);
                 console.log(`Player ${username} (${socket.id}) confirmed in lobby ${lobbyId} room.`);
                 // Send state again just in case
                 lobby.sendLobbyState(socket);
                 lobby.gameManager.broadcastGameState();
            }
        } else {
            // If player wasn't found, try adding them (maybe server restarted?)
            console.warn(`Player ${username} not found in lobby ${lobbyId} on rejoin attempt. Trying to add.`);
            const added = lobby.addPlayer(socket, username, lobby.players.size === 0); // Attempt add
            if (added) {
                 lobby.broadcastSystemMessage(`${username} has joined the game.`); // Announce join
                 lobby.broadcastLobbyPlayerList(); // Update list
            }
            // If add failed (e.g., lobby full), addPlayer already emits 'join failed'
        }
    }

    leaveLobby(socket) {
        const lobby = this.findLobbyBySocketId(socket.id);
        if (lobby) {
            console.log(`Player ${socket.id} leaving lobby ${lobby.id}`);
            lobby.removePlayer(socket); // Update lobby internal state (handles leave message now)

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