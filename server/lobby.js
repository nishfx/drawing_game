// server/lobby.js
import GameManager from './gameManager.js';
import { getRandomColor } from './utils.js';

const MAX_PLAYERS_PER_LOBBY = 4;
const MIN_PLAYERS_TO_START = 2; // Keep consistent with gameManager

class Lobby {
    constructor(id, io, lobbyManager) {
        this.id = id;
        this.io = io; // Socket.IO server instance
        this.lobbyManager = lobbyManager; // To notify when empty
        this.players = new Map(); // socketId -> { id, name, color, isHost, socket, score, hasVoted, receivedVotes }
        this.hostId = null;
        this.maxPlayers = MAX_PLAYERS_PER_LOBBY;
        // Instantiate GameManager here, pass io and lobbyId
        this.gameManager = new GameManager(this.io, this.id);
        this.gameManager.setLobbyReference(this); // Link gameManager back to lobby
        this.lobbyChatHistory = [];
        this.lobbyCanvasCommands = []; // Store drawing commands
        this.maxLobbyCommands = 500; // Limit history size
    }

    // --- Player Management ---
    addPlayer(socket, username, isHost = false) {
        if (this.isFull()) { socket.emit('join failed', 'Lobby is full.'); return false; }
        // Check if username is taken by a *different* socket ID
        if (this.isUsernameTakenByOther(username, socket.id)) {
             socket.emit('join failed', 'Username taken.'); return false;
        }

        const playerData = {
            id: socket.id, name: username, color: getRandomColor(),
            isHost: isHost, socket: socket, score: 0, // Initialize score
            hasVoted: false, receivedVotes: 0 // Initialize game state props
        };
        this.players.set(socket.id, playerData);
        socket.join(this.id); // Join Socket.IO room for this lobby

        // Ensure first player becomes host
        if (this.players.size === 1) {
             this.hostId = socket.id;
             playerData.isHost = true; // Ensure host status is set
        } else if (isHost) { // If explicitly passed as host (e.g. createLobby)
             this.hostId = socket.id;
        }


        console.log(`${username} (${socket.id}) added to lobby ${this.id}. Host: ${playerData.isHost}`);

        // Send current lobby state (including canvas/chat history) to the new player ONLY
        this.sendLobbyState(socket);

        // THEN update player list for others
        this.broadcastLobbyPlayerList();

        // Join message broadcast handled by LobbyManager after 'join success' emit

        return true; // Indicate success
    }

    removePlayer(socket) {
        const playerData = this.players.get(socket.id);
        if (!playerData) return; // Player already removed or never fully joined

        const username = playerData.name;
        const wasHost = playerData.isHost;
        const leavingSocketId = socket.id;
        const wasOnlyPlayer = this.players.size === 1; // Check if they were the only one *before* deleting

        // Delete the player first
        this.players.delete(leavingSocketId);
        socket.leave(this.id); // Leave Socket.IO room

        console.log(`${username} (${leavingSocketId}) left lobby ${this.id}.`);

        // --- MODIFIED: Suppress leave message if only player leaves during grace period ---
        const isGracePeriod = this.lobbyManager.recentlyCreated.has(this.id);
        if (!(wasOnlyPlayer && isGracePeriod)) {
            // Broadcast "left" only if NOT the single player leaving during grace period
            console.log(`Broadcasting leave message for ${username}. (Was only: ${wasOnlyPlayer}, Grace: ${isGracePeriod})`);
            this.broadcastSystemMessage(`${username} has left the lobby.`);
        } else {
            console.log(`Suppressing leave message for ${username} (only player leaving during grace period).`);
        }
        // --- END MODIFICATION ---

        // Update player list for remaining players (needed regardless of message)
        this.broadcastLobbyPlayerList();

        // Handle host leaving promotion
        if (wasHost && this.players.size > 0) {
            // Promote the next player (first in Map iterator)
            const nextHostEntry = this.players.entries().next().value;
            if (nextHostEntry) {
                const [nextHostId, nextHostData] = nextHostEntry;
                this.hostId = nextHostId;
                nextHostData.isHost = true;
                console.log(`Host left. New host: ${nextHostData.name} (${nextHostId})`);
                this.broadcastSystemMessage(`${nextHostData.name} is now the host.`);
                this.broadcastLobbyPlayerList(); // Update list again with new host status
                nextHostData.socket.emit('promoted to host');
            }
        } else if (this.players.size === 0) {
            this.hostId = null;
            console.log(`Lobby ${this.id} became empty.`);
            // LobbyManager handles actual deletion check
        }

        // If game was active and player count drops below minimum, stop game
        if (this.gameManager.gamePhase !== 'LOBBY' && this.players.size < MIN_PLAYERS_TO_START && this.players.size > 0) {
             console.log(`Lobby ${this.id}: Not enough players, stopping game.`);
             this.gameManager.goToLobby(); // Reset game state within this lobby
        }
    }

    isFull() {
        return this.players.size >= this.maxPlayers;
    }

    isEmpty() {
        return this.players.size === 0;
    }

    // Original check - is name taken by anyone?
    isUsernameTaken(username) {
        return Array.from(this.players.values()).some(p => p.name.toLowerCase() === username.toLowerCase());
    }
    // New check - is name taken by someone ELSE?
    isUsernameTakenByOther(username, ownSocketId) {
         return Array.from(this.players.values()).some(p => p.id !== ownSocketId && p.name.toLowerCase() === username.toLowerCase());
    }


    getHostName() {
        const host = this.players.get(this.hostId);
        return host ? host.name : 'N/A';
    }

    // --- Broadcasting & State ---
    sendLobbyState(socket) {
        const state = {
            lobbyId: this.id,
            players: Array.from(this.players.values(), p => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, score: p.score || 0 })),
            hostId: this.hostId,
            chatHistory: this.lobbyChatHistory,
            canvasCommands: this.lobbyCanvasCommands, // Send canvas state
            gamePhase: this.gameManager.gamePhase
        };
        socket.emit('lobby state', state);
    }

    broadcastLobbyPlayerList() {
        const playerList = Array.from(this.players.values(), p => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, score: p.score || 0 }));
        this.io.to(this.id).emit('lobby player list update', playerList);
    }

     broadcastSystemMessage(message) {
        const msgData = { text: message };
        this.io.to(this.id).emit('lobby chat message', msgData);
    }

    // --- Event Handling ---
    handleLobbyChatMessage(socket, msg) {
        const senderData = this.players.get(socket.id);
        if (!senderData || typeof msg !== 'string' || msg.trim().length === 0) return;
        const cleanMsg = msg.substring(0, 150);
        const msgData = { senderName: senderData.name, senderColor: senderData.color, text: cleanMsg };
        this.lobbyChatHistory.push(msgData);
        if (this.lobbyChatHistory.length > 50) { this.lobbyChatHistory.shift(); }
        this.io.to(this.id).emit('lobby chat message', msgData);
    }

    handleLobbyDraw(socket, drawData) {
        if (!this.players.has(socket.id) || !drawData) return;
        if (drawData.type === 'line' && typeof drawData.x0 === 'number') {
            this.lobbyCanvasCommands.push(drawData);
            if (this.lobbyCanvasCommands.length > this.maxLobbyCommands) { this.lobbyCanvasCommands.shift(); }
            socket.to(this.id).emit('lobby draw update', drawData);
        } else { console.warn(`Lobby ${this.id}: Invalid lobby draw data from ${socket.id}:`, drawData); }
    }

    handleStartGameRequest(socket) {
        if (socket.id !== this.hostId) { socket.emit('system message', 'Only host can start.'); return; }
        if (this.players.size < MIN_PLAYERS_TO_START) { socket.emit('system message', `Need ${MIN_PLAYERS_TO_START} players.`); return; }
        if (this.gameManager.gamePhase !== 'LOBBY') { socket.emit('system message', `Game already running.`); return; }
        console.log(`Host ${this.players.get(socket.id)?.name} starting game in lobby ${this.id}`);
        this.gameManager.startGame();
    }

    getPlayerCount() { return this.players.size; }
    attemptAutoStartGame() { if (this.gameManager.gamePhase === 'LOBBY' && this.players.size >= MIN_PLAYERS_TO_START) { console.log(`Lobby ${this.id}: Auto-starting game.`); this.gameManager.startGame(); } }
}

export default Lobby;