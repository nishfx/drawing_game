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
        do {
            newId = Math.random().toString(36).substring(2, 6).toUpperCase();
        } while (this.lobbies.has(newId));
        return newId;
    }

    createLobby(hostSocket, username) {
        if (this.lobbies.size >= MAX_LOBBIES) { hostSocket.emit('lobby creation failed', 'Maximum lobbies reached.'); return; }
        if (!this.isValidUsername(username)) { hostSocket.emit('lobby creation failed', 'Invalid username.'); return; }

        const lobbyId = this.generateLobbyId();
        const newLobby = new Lobby(lobbyId, this.io, this);
        this.lobbies.set(lobbyId, newLobby);

        this.recentlyCreated.add(lobbyId);
        console.log(`Lobby ${lobbyId} added to recentlyCreated set.`);
        setTimeout(() => {
            const wasPresent = this.recentlyCreated.delete(lobbyId);
            if (wasPresent) {
                 console.log(`Grace period ended for lobby ${lobbyId}. Removed from recentlyCreated set.`);
            }
        }, LOBBY_EMPTY_GRACE_PERIOD_MS);

        console.log(`Lobby created: ${lobbyId} by ${username} (${hostSocket.id})`);
        const added = newLobby.addPlayer(hostSocket, username, true); // Sends initial state
        if (added) {
            hostSocket.emit('lobby created', { lobbyId });
            // Broadcast join message immediately after host is added
            newLobby.broadcastSystemMessage(`${username} has joined the lobby.`);
        } else {
            console.error(`Failed to add host ${username} to newly created lobby ${lobbyId}`);
            this.lobbies.delete(lobbyId);
            this.recentlyCreated.delete(lobbyId);
            hostSocket.emit('lobby creation failed', 'Internal server error adding host.');
        }
    }

    joinLobby(playerSocket, lobbyId, username) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) { playerSocket.emit('join failed', 'Lobby not found.'); return; }
        if (!this.isValidUsername(username)) { playerSocket.emit('join failed', 'Invalid username.'); return; }
        if (lobby.isFull()) { playerSocket.emit('join failed', 'Lobby is full.'); return; }
        if (lobby.isUsernameTakenByOther(username, playerSocket.id)) {
             playerSocket.emit('join failed', 'Username taken.'); return;
        }

        console.log(`${username} (${playerSocket.id}) joining lobby ${lobbyId}`);
        const added = lobby.addPlayer(playerSocket, username, lobby.players.size === 0); // Sends initial state

        if (added) {
            playerSocket.emit('join success', { lobbyId });
            // Broadcast join message immediately after player is added
            lobby.broadcastSystemMessage(`${username} has joined the lobby.`);
        } else {
             console.error(`Failed to add player ${username} to lobby ${lobbyId} despite passing checks.`);
             playerSocket.emit('join failed', 'Internal server error adding player.');
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