import GameManager from './gameManager.js';
import { getRandomColor } from './utils.js';

const MAX_PLAYERS_PER_LOBBY = 4;
const MIN_PLAYERS_TO_START = 2; // Revert testing change

class Lobby {
    constructor(id, io, lobbyManager) {
        this.id = id;
        this.io = io;
        this.lobbyManager = lobbyManager;
        this.players = new Map();
        this.hostId = null;
        this.maxPlayers = MAX_PLAYERS_PER_LOBBY;
        this.gameManager = new GameManager(this.io, this.id);
        this.gameManager.setLobbyReference(this);
        this.lobbyChatHistory = [];
        this.lobbyCanvasCommands = []; // Stores { cmdId, playerId, type, data... }
        this.maxLobbyCommands = 1000; // Increased limit for more complex drawings/undos
    }

    // --- Player Management ---
    addPlayer(socket, username, isHost = false) {
        if (this.isFull()) { socket.emit('join failed', 'Lobby is full.'); return false; }
        if (this.isUsernameTakenByOther(username, socket.id)) { socket.emit('join failed', 'Username taken.'); return false; }

        const playerData = {
            id: socket.id, name: username, color: getRandomColor(),
            isHost: isHost, socket: socket, score: 0,
            hasVoted: false, receivedVotes: 0
        };
        this.players.set(socket.id, playerData);
        socket.join(this.id);

        if (isHost || !this.hostId) { // Ensure host is set if none exists
             this.hostId = socket.id;
             playerData.isHost = true;
        }

        console.log(`${username} (${socket.id}) added to lobby ${this.id}. Host: ${playerData.isHost}`);
        this.sendLobbyState(socket); // Send full state to new player
        this.broadcastLobbyPlayerList(); // Update list for others
        // Join message broadcast handled by LobbyManager after slight delay
        return true;
    }

    removePlayer(socket) {
        const playerData = this.players.get(socket.id);
        if (!playerData) return;
        const username = playerData.name;
        const wasHost = playerData.isHost;
        const leavingSocketId = socket.id;
        const wasOnlyPlayer = this.players.size === 1;
        this.players.delete(leavingSocketId);
        socket.leave(this.id);
        console.log(`${username} (${leavingSocketId}) left lobby ${this.id}.`);

        // Remove player's drawing commands from history
        this.lobbyCanvasCommands = this.lobbyCanvasCommands.filter(cmd => cmd.playerId !== leavingSocketId);

        const isGracePeriod = this.lobbyManager.recentlyCreated.has(this.id);
        if (!(wasOnlyPlayer && isGracePeriod)) {
            console.log(`Broadcasting leave message for ${username}.`);
            this.broadcastSystemMessage(`${username} has left the lobby.`);
        } else {
            console.log(`Suppressing leave message for ${username} (only player leaving during grace period).`);
        }

        this.broadcastLobbyPlayerList(); // Update list immediately

        if (wasHost && this.players.size > 0) {
            // Promote the player who joined earliest (first in Map iteration)
            const nextHostEntry = this.players.entries().next().value;
            if (nextHostEntry) {
                const [nextHostId, nextHostData] = nextHostEntry;
                this.hostId = nextHostId;
                nextHostData.isHost = true;
                console.log(`Host left. New host: ${nextHostData.name} (${nextHostId})`);
                this.broadcastSystemMessage(`${nextHostData.name} is now the host.`);
                this.broadcastLobbyPlayerList(); // Broadcast updated host status
                if (nextHostData.socket) {
                    nextHostData.socket.emit('promoted to host');
                }
            }
        } else if (this.players.size === 0) {
            this.hostId = null;
            console.log(`Lobby ${this.id} became empty.`);
        }

        if (this.gameManager.gamePhase !== 'LOBBY' && this.players.size < MIN_PLAYERS_TO_START && this.players.size > 0) {
             console.log(`Lobby ${this.id}: Not enough players (${this.players.size}/${MIN_PLAYERS_TO_START}), stopping game.`);
             this.gameManager.goToLobby();
        }
    }

    isFull() { return this.players.size >= this.maxPlayers; }
    isEmpty() { return this.players.size === 0; }
    isUsernameTaken(username) { return Array.from(this.players.values()).some(p => p.name.toLowerCase() === username.toLowerCase()); }
    isUsernameTakenByOther(username, ownSocketId) { return Array.from(this.players.values()).some(p => p.id !== ownSocketId && p.name.toLowerCase() === username.toLowerCase()); }
    getHostName() { const host = this.players.get(this.hostId); return host ? host.name : 'N/A'; }

    // --- Broadcasting & State ---
    sendLobbyState(socket) {
        const state = {
            lobbyId: this.id,
            players: Array.from(this.players.values(), p => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, score: p.score || 0 })),
            hostId: this.hostId,
            chatHistory: this.lobbyChatHistory,
            canvasCommands: this.lobbyCanvasCommands, // Send full command history
            gamePhase: this.gameManager.gamePhase,
            minPlayers: MIN_PLAYERS_TO_START
        };
        socket.emit('lobby state', state);
    }

    broadcastLobbyPlayerList() {
        const playerList = Array.from(this.players.values(), p => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, score: p.score || 0 }));
        this.io.to(this.id).emit('lobby player list update', playerList);
    }

     broadcastSystemMessage(message) {
        const msgData = { text: message, type: 'system' }; // Add type hint
        // Add system messages to chat history as well? Optional.
        // this.lobbyChatHistory.push(msgData);
        // if (this.lobbyChatHistory.length > 50) { this.lobbyChatHistory.shift(); }
        this.io.to(this.id).emit('lobby chat message', msgData); // Use lobby chat message for system messages too
    }

    // --- Event Handling ---

    // Method to re-register events (called by LobbyManager on rejoin)
    registerSocketEvents(socket) {
         console.log(`Registering lobby/game events for ${socket.id} in lobby ${this.id}`);
         // Clear potential old listeners first to prevent duplicates
         socket.removeAllListeners('lobby chat message');
         socket.removeAllListeners('lobby draw');
         socket.removeAllListeners('start game');
         socket.removeAllListeners('player ready');
         socket.removeAllListeners('submit vote');
         socket.removeAllListeners('chat message');
         socket.removeAllListeners('undo last draw'); // Add new event

         // Add listeners again (forwarding handled by server.js)
         // No actual handlers needed here, just ensures the socket object
         // used by the forwarder has the listeners attached.
         // The forwarder in server.js will call the methods below.
    }

    handleLobbyChatMessage(socket, msg) {
        const senderData = this.players.get(socket.id);
        if (!senderData || typeof msg !== 'string' || msg.trim().length === 0) return;
        const cleanMsg = msg.substring(0, 150);
        const msgData = { senderName: senderData.name, senderColor: senderData.color, text: cleanMsg };
        this.lobbyChatHistory.push(msgData);
        if (this.lobbyChatHistory.length > 50) { this.lobbyChatHistory.shift(); }
        this.io.to(this.id).emit('lobby chat message', msgData);
    }

    handleLobbyDraw(socket, drawCommand) {
        if (!this.players.has(socket.id) || !drawCommand || !drawCommand.type || !drawCommand.cmdId) {
            console.warn(`Lobby ${this.id}: Invalid lobby draw data from ${socket.id}:`, drawCommand);
            return;
        }

        // Add player ID to the command before storing and broadcasting
        const commandWithPlayer = { ...drawCommand, playerId: socket.id };

        // Basic validation based on type
        let isValid = false;
        switch(drawCommand.type) {
            case 'line':
                isValid = typeof drawCommand.x0 === 'number' && typeof drawCommand.y0 === 'number' &&
                          typeof drawCommand.x1 === 'number' && typeof drawCommand.y1 === 'number' &&
                          typeof drawCommand.size === 'number';
                break;
            case 'fill':
                isValid = typeof drawCommand.x === 'number' && typeof drawCommand.y === 'number' &&
                          typeof drawCommand.color === 'string';
                break;
            case 'rect': // Renamed from 'shape' for clarity
                isValid = typeof drawCommand.x0 === 'number' && typeof drawCommand.y0 === 'number' &&
                          typeof drawCommand.x1 === 'number' && typeof drawCommand.y1 === 'number' &&
                          typeof drawCommand.color === 'string' && typeof drawCommand.size === 'number';
                break;
            case 'clear':
                isValid = true; // No extra data needed
                break;
            default:
                console.warn(`Lobby ${this.id}: Unknown draw command type: ${drawCommand.type}`);
                isValid = false;
        }

        if (!isValid) {
            console.warn(`Lobby ${this.id}: Invalid data for draw type ${drawCommand.type} from ${socket.id}:`, drawCommand);
            return;
        }

        // Handle clear separately - it resets history
        if (commandWithPlayer.type === 'clear') {
            console.log(`Lobby ${this.id}: Clearing canvas commands by ${socket.id}.`);
            this.lobbyCanvasCommands = []; // Clear history
            // Broadcast clear command (others will clear and redraw empty)
            this.io.to(this.id).emit('lobby draw update', commandWithPlayer);
        } else {
            // Add command to history
            this.lobbyCanvasCommands.push(commandWithPlayer);
            if (this.lobbyCanvasCommands.length > this.maxLobbyCommands) {
                this.lobbyCanvasCommands.shift();
            }
            // Broadcast command to others in the lobby
            socket.to(this.id).emit('lobby draw update', commandWithPlayer);
        }
    }

    handleUndoLastDraw(socket) {
        if (!this.players.has(socket.id)) return;
        const playerId = socket.id;

        // Find the last command added by this player
        let lastCommandIndex = -1;
        for (let i = this.lobbyCanvasCommands.length - 1; i >= 0; i--) {
            if (this.lobbyCanvasCommands[i].playerId === playerId) {
                lastCommandIndex = i;
                break;
            }
        }

        if (lastCommandIndex !== -1) {
            const removedCommand = this.lobbyCanvasCommands.splice(lastCommandIndex, 1)[0];
            console.log(`Lobby ${this.id}: Undoing command ${removedCommand.cmdId} by ${playerId}`);
            // Broadcast that a command was removed
            this.io.to(this.id).emit('lobby command removed', { cmdId: removedCommand.cmdId });
        } else {
            console.log(`Lobby ${this.id}: No command found for player ${playerId} to undo.`);
            // Optionally send a message back to the user?
            // socket.emit('system message', 'Nothing to undo.');
        }
    }


    handleStartGameRequest(socket) {
        if (socket.id !== this.hostId) { socket.emit('system message', 'Only host can start.'); return; }
        if (this.players.size < MIN_PLAYERS_TO_START) {
            socket.emit('system message', `Need ${MIN_PLAYERS_TO_START} player(s) to start (currently ${this.players.size}).`);
            return;
        }
        if (this.gameManager.gamePhase !== 'LOBBY') { socket.emit('system message', `Game already running.`); return; }
        console.log(`Host ${this.players.get(socket.id)?.name} starting game in lobby ${this.id}`);
        this.io.to(this.id).emit('game starting', { lobbyId: this.id }); // Notify clients game is starting
        // Add a small delay before actually starting the game logic
        // to allow clients to navigate/prepare
        setTimeout(() => {
            this.gameManager.startGame();
        }, 500); // 500ms delay
    }

    getPlayerCount() { return this.players.size; }

    attemptAutoStartGame() {
        // Disable auto-start for now, requires explicit host action
        // if (this.gameManager.gamePhase === 'LOBBY' && this.players.size >= MIN_PLAYERS_TO_START) {
        //     console.log(`Lobby ${this.id}: Auto-starting game.`);
        //     this.gameManager.startGame();
        // }
    }
}

export default Lobby;