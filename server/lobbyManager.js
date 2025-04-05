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
        if (this.lobbies.size >= MAX_LOBBIES) {
            hostSocket.emit('lobby creation failed', 'Max lobbies.');
            return;
        }
        if (!this.isValidUsername(username)) {
            hostSocket.emit('lobby creation failed', 'Invalid username.');
            return;
        }
        const lobbyId = this.generateLobbyId();
        const newLobby = new Lobby(lobbyId, this.io, this);
        this.lobbies.set(lobbyId, newLobby);
        this.recentlyCreated.add(lobbyId);

        setTimeout(() => {
            const wasPresent = this.recentlyCreated.delete(lobbyId);
            if (wasPresent) {
                console.log(`Grace ended for ${lobbyId}.`);
            }
        }, LOBBY_EMPTY_GRACE_PERIOD_MS);

        console.log(`Lobby created: ${lobbyId} by ${username}`);
        const added = newLobby.addPlayer(hostSocket, username, true /* isHost */);

        if (added) {
            hostSocket.emit('lobby created', { lobbyId });
            // [CHANGED] Removed the old setTimeout broadcastSystemMessage here.
            // We now handle "X joined the lobby" inside newLobby.addPlayer(...)
        } else {
            console.error(`Failed add host ${username} to ${lobbyId}`);
            this.lobbies.delete(lobbyId);
            this.recentlyCreated.delete(lobbyId);
            hostSocket.emit('lobby creation failed', 'Server error.');
        }
    }

    joinLobby(playerSocket, lobbyId, username) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) {
            playerSocket.emit('join failed', 'Not found.');
            return;
        }
        if (!this.isValidUsername(username)) {
            playerSocket.emit('join failed', 'Invalid username.');
            return;
        }
        if (lobby.isFull()) {
            playerSocket.emit('join failed', 'Full.');
            return;
        }
        // Check if username is taken
        if (lobby.isUsernameTakenByOther(username, playerSocket.id)) {
            playerSocket.emit('join failed', 'Username taken.');
            return;
        }

        console.log(`${username} joining ${lobbyId}`);
        const added = lobby.addPlayer(playerSocket, username, lobby.players.size === 0 /* isHost? */);
        if (added) {
            playerSocket.emit('join success', { lobbyId });
            // [CHANGED] Removed the old setTimeout broadcastSystemMessage
            // for "X has joined the lobby." We do that now in addPlayer(...)
        } else {
            console.error(`Failed add player ${username} to ${lobbyId} unexpectedly.`);
            playerSocket.emit('join failed', 'Server error during join.');
        }
    }

    rejoinGame(socket, lobbyId, username) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) {
            console.warn(`Socket ${socket.id} tried to rejoin non-existent lobby ${lobbyId}`);
            socket.emit('connection rejected', 'Game lobby not found.');
            socket.disconnect(true);
            return;
        }
        if (!this.isValidUsername(username)) {
            socket.emit('connection rejected', 'Invalid username for rejoin.');
            socket.disconnect(true);
            return;
        }

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
            console.log(`Player ${username} rejoining lobby ${lobbyId}. Old sock: ${oldSocketId}, new sock: ${socket.id}`);

            if (oldSocketId !== socket.id) {
                // Remove the old entry silently (don’t broadcast “left”).
                lobby.removePlayer({ id: oldSocketId }, { silent: true });

                // Re-map existing player data to this new socket
                existingPlayer.id = socket.id;
                existingPlayer.socket = socket;
                lobby.players.set(socket.id, existingPlayer);
                socket.join(lobby.id);

                // “Reconnected” message instead of “left + joined”
                lobby.broadcastSystemMessage(`${username} has reconnected.`);
            } else {
                console.log(`Socket ID ${socket.id} is the same; just updating the reference.`);
                existingPlayer.socket = socket;
                socket.join(lobby.id);
            }

            // Re-register
            if (typeof lobby.registerSocketEvents === 'function') {
                lobby.registerSocketEvents(socket);
            }
            lobby.sendLobbyState(socket);
            lobby.gameManager.broadcastGameState();
            lobby.broadcastLobbyPlayerList();
        } else {
            // No matching username -> treat as new join
            console.log(`Player ${username} not found in ${lobbyId}, treating as fresh join.`);
            if (lobby.isFull()) {
                socket.emit('connection rejected', 'Lobby is full.');
                socket.disconnect(true);
                return;
            }
            const added = lobby.addPlayer(socket, username, lobby.players.size === 0);
            if (added) {
                lobby.broadcastSystemMessage(`${username} has joined the game.`);
                lobby.broadcastLobbyPlayerList();
                lobby.sendLobbyState(socket);
                lobby.gameManager.broadcastGameState();
            } else {
                console.warn(`Failed to add player ${username} to lobby ${lobbyId} during rejoin attempt.`);
                socket.emit('connection rejected', 'Failed to join lobby.');
                socket.disconnect(true);
            }
        }
    }

    leaveLobby(socket) {
        const lobby = this.findLobbyBySocketId(socket.id);
        if (lobby) {
            lobby.removePlayer(socket);
            if (lobby.isEmpty()) {
                if (!this.recentlyCreated.has(lobby.id)) {
                    console.log(`Lobby ${lobby.id} is empty and past grace period, removing.`);
                    this.removeLobby(lobby.id);
                } else {
                    console.log(`Lobby ${lobby.id} is empty but within grace period.`);
                }
            }
        } else {
            console.log(`Socket ${socket.id} disconnected but not found in any lobby.`);
        }
    }

    findLobbyBySocketId(socketId) {
        for (const lobby of this.lobbies.values()) {
            if (lobby.players.has(socketId)) {
                return lobby;
            }
        }
        return null;
    }

    getLobbyList() {
        return Array.from(this.lobbies.values()).map(lobby => ({
            id: lobby.id,
            hostName: lobby.getHostName(),
            playerCount: lobby.players.size,
            maxPlayers: lobby.maxPlayers,
            gamePhase: lobby.gameManager?.gamePhase || 'LOBBY'
        }));
    }

    sendLobbyList(socket) {
        socket.emit('lobby list update', this.getLobbyList());
    }

    isValidUsername(username) {
        return (
            username &&
            typeof username === 'string' &&
            username.trim().length > 0 &&
            username.length <= 16 &&
            /^[A-Za-z0-9_]+$/.test(username)
        );
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
