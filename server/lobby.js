// server/lobby.js
import GameManager from './gameManager.js';
import { getRandomColor } from './utils.js';

const MAX_PLAYERS_PER_LOBBY = 4;
const MIN_PLAYERS_TO_START = 1; // For testing

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
        this.lobbyCanvasCommands = [];
        this.maxLobbyCommands = 1000;
    }

    // --- Player Management ---
    addPlayer(socket, username, isHost = false) {
        const playerData = {
            id: socket.id, name: username, color: getRandomColor(),
            isHost: isHost, socket: socket, score: 0,
            hasVoted: false, receivedVotes: 0
        };
        this.players.set(socket.id, playerData);
        socket.join(this.id);

        if (isHost || !this.hostId) {
             this.hostId = socket.id;
             playerData.isHost = true;
             this.players.forEach((p) => { if (p.id !== this.hostId) p.isHost = false; });
        } else {
            playerData.isHost = false;
        }

        console.log(`[Lobby ${this.id}] ${username} (${socket.id}) added. Host: ${playerData.isHost}`);
        this.sendLobbyState(socket);
        this.broadcastLobbyPlayerList();
        return true;
    }

    removePlayer(socket) {
        const playerData = this.players.get(socket.id);
        if (!playerData) {
            console.log(`[Lobby ${this.id}] Attempted to remove player ${socket.id}, but not found.`);
            return; // Player not in this lobby
        }
        const username = playerData.name;
        const wasHost = playerData.isHost;
        const leavingSocketId = socket.id;
        const wasOnlyPlayer = this.players.size === 1;

        // *** Log before deleting ***
        console.log(`[Lobby ${this.id}] Removing player ${username} (${leavingSocketId}). Current size: ${this.players.size}`);
        const deleted = this.players.delete(leavingSocketId);
        if (!deleted) {
             console.error(`[Lobby ${this.id}] Failed to delete player ${leavingSocketId} from map!`);
        } else {
             console.log(`[Lobby ${this.id}] Player ${leavingSocketId} deleted from map. New size: ${this.players.size}`);
        }

        socket.leave(this.id); // Ensure socket leaves the room

        // Remove player's drawing commands
        const initialCmdCount = this.lobbyCanvasCommands.length;
        this.lobbyCanvasCommands = this.lobbyCanvasCommands.filter(cmd => cmd.playerId !== leavingSocketId);
        console.log(`[Lobby ${this.id}] Removed ${initialCmdCount - this.lobbyCanvasCommands.length} canvas commands for ${username}.`);

        // Broadcast leave message (unless grace period)
        const isGracePeriod = this.lobbyManager.recentlyCreated.has(this.id);
        if (!(wasOnlyPlayer && isGracePeriod)) {
            console.log(`[Lobby ${this.id}] Broadcasting leave message for ${username}.`);
            this.broadcastSystemMessage(`${username} has left the lobby.`);
        } else {
            console.log(`[Lobby ${this.id}] Suppressing leave message for ${username} (grace period).`);
        }

        // Promote new host if needed
        let newHostPromoted = false;
        if (wasHost && this.players.size > 0) {
            const nextHostEntry = this.players.entries().next().value;
            if (nextHostEntry) {
                const [nextHostId, nextHostData] = nextHostEntry;
                this.hostId = nextHostId;
                nextHostData.isHost = true;
                newHostPromoted = true;
                console.log(`[Lobby ${this.id}] Host left. New host: ${nextHostData.name} (${nextHostId})`);
                this.broadcastSystemMessage(`${nextHostData.name} is now the host.`);
                if (nextHostData.socket) {
                    nextHostData.socket.emit('promoted to host');
                } else {
                     console.warn(`[Lobby ${this.id}] New host ${nextHostData.name} has no socket reference!`);
                }
            } else {
                 console.error(`[Lobby ${this.id}] Host left, players remain, but failed to find next host!`);
                 this.hostId = null; // Set host to null if promotion fails
            }
        } else if (this.players.size === 0) {
            this.hostId = null;
            console.log(`[Lobby ${this.id}] Became empty.`);
        }

        // *** Broadcast updated player list AFTER potential promotion ***
        console.log(`[Lobby ${this.id}] Broadcasting player list update after player removal.`);
        this.broadcastLobbyPlayerList();

        // Check if game needs to stop
        if (this.gameManager.gamePhase !== 'LOBBY') {
            if (this.players.size < MIN_PLAYERS_TO_START && this.players.size > 0) {
                 console.log(`[Lobby ${this.id}] Not enough players (${this.players.size}/${MIN_PLAYERS_TO_START}), stopping game.`);
                 this.gameManager.goToLobby();
            } else if (this.players.size === 0) {
                 console.log(`[Lobby ${this.id}] Last player left during game, stopping.`);
                 this.gameManager.goToLobby();
            }
        }
    }

    // ... (isFull, isEmpty, isUsernameTaken, isUsernameTakenByOther, getHostName - unchanged) ...
    isFull() { return this.players.size >= this.maxPlayers; }
    isEmpty() { return this.players.size === 0; }
    isUsernameTaken(username) { return Array.from(this.players.values()).some(p => p.name.toLowerCase() === username.toLowerCase()); }
    isUsernameTakenByOther(username, ownSocketId) {
        const lowerUser = username.toLowerCase();
        for (const [id, player] of this.players.entries()) {
            if (id !== ownSocketId && player.name.toLowerCase() === lowerUser) return true;
        }
        return false;
    }
    getHostName() { const host = this.players.get(this.hostId); return host ? host.name : 'N/A'; }


    // --- Broadcasting & State ---
    // ... (sendLobbyState, broadcastLobbyPlayerList, broadcastSystemMessage - unchanged) ...
    sendLobbyState(socket) {
        const state = {
            lobbyId: this.id,
            players: Array.from(this.players.values(), p => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, score: p.score || 0 })),
            hostId: this.hostId,
            chatHistory: this.lobbyChatHistory,
            canvasCommands: this.lobbyCanvasCommands,
            gamePhase: this.gameManager.gamePhase,
            minPlayers: MIN_PLAYERS_TO_START
        };
        socket.emit('lobby state', state);
    }

    broadcastLobbyPlayerList() {
        const playerList = Array.from(this.players.values(), p => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, score: p.score || 0 }));
        console.log(`[Lobby ${this.id}] Broadcasting player list:`, playerList.map(p=>p.name)); // Log names being broadcast
        this.io.to(this.id).emit('lobby player list update', playerList);
    }

     broadcastSystemMessage(message) {
        const msgData = { text: message, type: 'system' };
        this.io.to(this.id).emit('lobby chat message', msgData);
    }


    // --- Event Handling ---
    // ... (registerSocketEvents, handleLobbyChatMessage, handleLobbyDraw, handleUndoLastDraw, handleStartGameRequest, etc. - unchanged from previous correct version) ...
    registerSocketEvents(socket) {
         console.log(`Registering lobby/game events for ${socket.id} in lobby ${this.id}`);
         socket.removeAllListeners('lobby chat message');
         socket.removeAllListeners('lobby draw');
         socket.removeAllListeners('start game');
         socket.removeAllListeners('player ready');
         socket.removeAllListeners('submit vote');
         socket.removeAllListeners('chat message');
         socket.removeAllListeners('undo last draw');
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
        const commandWithPlayer = { ...drawCommand, playerId: socket.id };
        let isValid = false;
        switch(drawCommand.type) {
            case 'line': isValid = typeof drawCommand.x0 === 'number' && typeof drawCommand.y0 === 'number' && typeof drawCommand.x1 === 'number' && typeof drawCommand.y1 === 'number' && typeof drawCommand.size === 'number' && typeof drawCommand.strokeId === 'string'; break;
            case 'fill': isValid = typeof drawCommand.x === 'number' && typeof drawCommand.y === 'number' && typeof drawCommand.color === 'string'; break;
            case 'rect': isValid = typeof drawCommand.x0 === 'number' && typeof drawCommand.y0 === 'number' && typeof drawCommand.x1 === 'number' && typeof drawCommand.y1 === 'number' && typeof drawCommand.color === 'string' && typeof drawCommand.size === 'number'; break;
            case 'ellipse': isValid = typeof drawCommand.cx === 'number' && typeof drawCommand.cy === 'number' && typeof drawCommand.rx === 'number' && typeof drawCommand.ry === 'number' && typeof drawCommand.color === 'string' && typeof drawCommand.size === 'number'; break;
            case 'clear': isValid = true; break;
            default: console.warn(`Lobby ${this.id}: Unknown draw command type: ${drawCommand.type}`); isValid = false;
        }
        if (!isValid) { console.warn(`Lobby ${this.id}: Invalid data for draw type ${drawCommand.type} from ${socket.id}:`, drawCommand); return; }

        if (commandWithPlayer.type === 'clear') {
            console.log(`[Lobby ${this.id}] Clearing canvas commands by ${socket.id}.`);
            this.lobbyCanvasCommands = [];
            this.lobbyCanvasCommands.push(commandWithPlayer);
            this.io.to(this.id).emit('lobby draw update', commandWithPlayer);
        } else {
            this.lobbyCanvasCommands.push(commandWithPlayer);
            if (this.lobbyCanvasCommands.length > this.maxLobbyCommands) { this.lobbyCanvasCommands.shift(); }
            socket.to(this.id).emit('lobby draw update', commandWithPlayer);
        }
    }

    handleUndoLastDraw(socket, data) {
        if (!this.players.has(socket.id)) return;
        const playerId = socket.id;
        const { cmdId, strokeId } = data || {};

        if (!cmdId && !strokeId) {
            console.warn(`[Lobby ${this.id}] Received undo request from ${playerId} without cmdId or strokeId.`);
            return;
        }

        let commandsToRemove = [];
        let initialLength = this.lobbyCanvasCommands.length;

        if (strokeId) {
            this.lobbyCanvasCommands = this.lobbyCanvasCommands.filter(cmd => {
                if (cmd.strokeId === strokeId && cmd.playerId === playerId) {
                    commandsToRemove.push(cmd.cmdId); return false;
                } return true;
            });
            if (commandsToRemove.length > 0) {
                 console.log(`[Lobby ${this.id}] Undoing stroke ${strokeId} (${commandsToRemove.length} commands) by ${playerId}`);
            }
        } else if (cmdId) {
            const commandIndex = this.lobbyCanvasCommands.findIndex(cmd => cmd.cmdId === cmdId);
            if (commandIndex !== -1) {
                if (this.lobbyCanvasCommands[commandIndex].playerId === playerId) {
                    const removedCommand = this.lobbyCanvasCommands.splice(commandIndex, 1)[0];
                    commandsToRemove.push(removedCommand.cmdId);
                    console.log(`[Lobby ${this.id}] Undoing command ${removedCommand.cmdId} by ${playerId}`);
                } else {
                    console.warn(`[Lobby ${this.id}] Player ${playerId} attempted to undo command ${cmdId} owned by ${this.lobbyCanvasCommands[commandIndex].playerId}.`);
                }
            }
        }

        if (commandsToRemove.length > 0) {
            this.io.to(this.id).emit('lobby commands removed', { cmdIds: commandsToRemove });
        } else {
             console.log(`[Lobby ${this.id}] No commands found to undo for player ${playerId} with data:`, data);
        }
    }

    handleStartGameRequest(socket) {
        if (socket.id !== this.hostId) { socket.emit('system message', 'Only host can start.'); return; }
        if (this.players.size < MIN_PLAYERS_TO_START) {
            socket.emit('system message', `Need ${MIN_PLAYERS_TO_START} player(s) to start (currently ${this.players.size}).`);
            return;
        }
        if (this.gameManager.gamePhase !== 'LOBBY') { socket.emit('system message', `Game already running.`); return; }
        console.log(`[Lobby ${this.id}] Host ${this.players.get(socket.id)?.name} starting game.`);
        this.io.to(this.id).emit('game starting', { lobbyId: this.id });
        setTimeout(() => { this.gameManager.startGame(); }, 500);
    }

    getPlayerCount() { return this.players.size; }
    attemptAutoStartGame() { /* Auto-start disabled */ }

}

export default Lobby;