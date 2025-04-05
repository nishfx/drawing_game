// server/lobby.js
import GameManager from './gameManager.js';
import { getRandomColor } from './utils.js';

const MAX_PLAYERS_PER_LOBBY = 4;
const MIN_PLAYERS_TO_START = 1; // For easy local testing

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

    addPlayer(socket, username, isHost = false) {
        const playerData = {
            id: socket.id,
            name: username,
            color: getRandomColor(),
            isHost: isHost,
            socket: socket,
            score: 0,
            hasVoted: false,
            receivedVotes: 0
        };
        this.players.set(socket.id, playerData);
        socket.join(this.id);

        if (isHost || !this.hostId) {
            this.hostId = socket.id;
            playerData.isHost = true;
            this.players.forEach(p => {
                if (p.id !== this.hostId) p.isHost = false;
            });
        } else {
            playerData.isHost = false;
        }

        console.log(`[Lobby ${this.id}] ${username} (${socket.id}) added. Host? ${playerData.isHost}`);
        this.sendLobbyState(socket);
        this.broadcastLobbyPlayerList();
        return true;
    }

    removePlayer(socket) {
        const playerData = this.players.get(socket.id);
        if (!playerData) {
            console.log(`[Lobby ${this.id}] removePlayer: not found: ${socket.id}`);
            return;
        }
        const username = playerData.name;
        const wasHost = playerData.isHost;
        const wasOnlyPlayer = (this.players.size === 1);

        console.log(`[Lobby ${this.id}] Removing player ${username} (${socket.id}).`);
        this.players.delete(socket.id);
        socket.leave(this.id);

        // Remove player's commands
        const initialCount = this.lobbyCanvasCommands.length;
        this.lobbyCanvasCommands = this.lobbyCanvasCommands.filter(cmd => cmd.playerId !== socket.id);
        console.log(`[Lobby ${this.id}] Removed ${initialCount - this.lobbyCanvasCommands.length} commands for ${username}.`);

        const isGracePeriod = this.lobbyManager.recentlyCreated.has(this.id);
        if (!(wasOnlyPlayer && isGracePeriod)) {
            this.broadcastSystemMessage(`${username} has left the lobby.`);
        }

        if (wasHost && this.players.size > 0) {
            const nextHostEntry = this.players.entries().next().value;
            if (nextHostEntry) {
                const [nextHostId, nextHostData] = nextHostEntry;
                this.hostId = nextHostId;
                nextHostData.isHost = true;
                console.log(`[Lobby ${this.id}] Host left. New host: ${nextHostData.name}`);
                this.broadcastSystemMessage(`${nextHostData.name} is now the host.`);
                if (nextHostData.socket) {
                    nextHostData.socket.emit('promoted to host');
                }
            } else {
                this.hostId = null;
                console.error(`[Lobby ${this.id}] Host left but no next host?`);
            }
        } else if (this.players.size === 0) {
            this.hostId = null;
            console.log(`[Lobby ${this.id}] Became empty.`);
        }

        this.broadcastLobbyPlayerList();

        if (this.gameManager.gamePhase !== 'LOBBY') {
            if (this.players.size < MIN_PLAYERS_TO_START && this.players.size > 0) {
                console.log(`[Lobby ${this.id}] Not enough players, stopping game.`);
                this.gameManager.goToLobby();
            } else if (this.players.size === 0) {
                console.log(`[Lobby ${this.id}] Last player left, stopping game.`);
                this.gameManager.goToLobby();
            }
        }
    }

    isFull() { return this.players.size >= this.maxPlayers; }
    isEmpty() { return this.players.size === 0; }

    isUsernameTaken(username) {
        return Array.from(this.players.values()).some(p => p.name.toLowerCase() === username.toLowerCase());
    }
    isUsernameTakenByOther(username, ownSocketId) {
        const lower = username.toLowerCase();
        for (const [id, p] of this.players.entries()) {
            if (id !== ownSocketId && p.name.toLowerCase() === lower) return true;
        }
        return false;
    }
    getHostName() {
        const host = this.players.get(this.hostId);
        return host ? host.name : 'N/A';
    }

    // ---------------------------------------------------
    sendLobbyState(socket) {
        const state = {
            lobbyId: this.id,
            players: Array.from(this.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                color: p.color,
                isHost: p.isHost,
                score: p.score || 0
            })),
            hostId: this.hostId,
            chatHistory: this.lobbyChatHistory,
            canvasCommands: this.lobbyCanvasCommands,
            gamePhase: this.gameManager.gamePhase,
            minPlayers: MIN_PLAYERS_TO_START
        };
        socket.emit('lobby state', state);
    }

    broadcastLobbyPlayerList() {
        const playerList = Array.from(this.players.values(), p => ({
            id: p.id, name: p.name, color: p.color, isHost: p.isHost, score: p.score || 0
        }));
        this.io.to(this.id).emit('lobby player list update', playerList);
    }

    broadcastSystemMessage(msg) {
        const data = { text: msg, type: 'system' };
        this.io.to(this.id).emit('lobby chat message', data);
    }

    registerSocketEvents(socket) {
        console.log(`Registering events for ${socket.id} in lobby ${this.id}`);
        // Remove old listeners
        socket.removeAllListeners('lobby chat message');
        socket.removeAllListeners('lobby draw');
        socket.removeAllListeners('start game');
        socket.removeAllListeners('player ready');
        socket.removeAllListeners('submit vote');
        socket.removeAllListeners('chat message');
        socket.removeAllListeners('undo last draw');
    }

    handleLobbyChatMessage(socket, msg) {
        const sender = this.players.get(socket.id);
        if (!sender || typeof msg !== 'string' || msg.trim().length === 0) return;
        const cleanMsg = msg.substring(0, 150);
        const msgData = {
            senderName: sender.name,
            senderColor: sender.color,
            text: cleanMsg
        };
        this.lobbyChatHistory.push(msgData);
        if (this.lobbyChatHistory.length > 50) {
            this.lobbyChatHistory.shift();
        }
        this.io.to(this.id).emit('lobby chat message', msgData);
    }

    handleLobbyDraw(socket, drawCommand) {
        if (!this.players.has(socket.id) || !drawCommand || !drawCommand.type || !drawCommand.cmdId) {
            console.warn(`Lobby ${this.id}: invalid draw data from ${socket.id}`, drawCommand);
            return;
        }
        const commandWithPlayer = { ...drawCommand, playerId: socket.id };

        let isValid = false;
        switch (drawCommand.type) {
            case 'line':
                isValid = (
                    typeof drawCommand.x0 === 'number' && typeof drawCommand.y0 === 'number' &&
                    typeof drawCommand.x1 === 'number' && typeof drawCommand.y1 === 'number' &&
                    typeof drawCommand.size === 'number' && typeof drawCommand.strokeId === 'string'
                );
                break;
            case 'fill':
                isValid = (
                    typeof drawCommand.x === 'number' && typeof drawCommand.y === 'number' &&
                    typeof drawCommand.color === 'string'
                );
                break;
            case 'rect':
                isValid = (
                    typeof drawCommand.x0 === 'number' && typeof drawCommand.y0 === 'number' &&
                    typeof drawCommand.x1 === 'number' && typeof drawCommand.y1 === 'number' &&
                    typeof drawCommand.color === 'string' && typeof drawCommand.size === 'number'
                );
                break;
            case 'ellipse':
                isValid = (
                    typeof drawCommand.cx === 'number' &&
                    typeof drawCommand.cy === 'number' &&
                    typeof drawCommand.rx === 'number' &&
                    typeof drawCommand.ry === 'number' &&
                    typeof drawCommand.color === 'string' &&
                    typeof drawCommand.size === 'number'
                );
                break;
            case 'clear':
                isValid = true;
                break;
            default:
                console.warn(`Lobby ${this.id}: unknown draw type: ${drawCommand.type}`);
        }
        if (!isValid) {
            console.warn(`Lobby ${this.id}: invalid data for type=${drawCommand.type} from ${socket.id}`, drawCommand);
            return;
        }

        if (commandWithPlayer.type === 'clear') {
            // remove all commands from this socket
            const removedCmdIds = [];
            const initialLen = this.lobbyCanvasCommands.length;
            this.lobbyCanvasCommands = this.lobbyCanvasCommands.filter(cmd => {
                if (cmd.playerId === socket.id) {
                    removedCmdIds.push(cmd.cmdId);
                    return false;
                }
                return true;
            });
            console.log(`[Lobby ${this.id}] Player ${socket.id} cleared their lines. Removed ${removedCmdIds.length} commands.`);

            if (removedCmdIds.length > 0) {
                this.io.to(this.id).emit('lobby commands removed', {
                    cmdIds: removedCmdIds,
                    strokeId: null,
                    playerId: socket.id
                });
            }
        } else {
            this.lobbyCanvasCommands.push(commandWithPlayer);
            if (this.lobbyCanvasCommands.length > this.maxLobbyCommands) {
                this.lobbyCanvasCommands.shift();
            }
            socket.to(this.id).emit('lobby draw update', commandWithPlayer);
        }
    }

    /**
     * ***CHANGED*** so we broadcast `playerId` in “lobby commands removed”
     * ensuring only that player's strokes get removed on the client side.
     */
    handleUndoLastDraw(socket, data) {
        if (!this.players.has(socket.id)) return;
        const playerId = socket.id;
        const { cmdId, strokeId } = data || {};
        if (!cmdId && !strokeId) {
            console.warn(`[Lobby ${this.id}] Undo request from ${playerId} missing cmdId/strokeId`);
            return;
        }
        let commandsToRemove = [];
        if (strokeId) {
            this.lobbyCanvasCommands = this.lobbyCanvasCommands.filter(cmd => {
                if (cmd.strokeId === strokeId && cmd.playerId === playerId) {
                    commandsToRemove.push(cmd.cmdId);
                    return false;
                }
                return true;
            });
            if (commandsToRemove.length > 0) {
                console.log(`[Lobby ${this.id}] Undo stroke=${strokeId} by player=${playerId}, removed ${commandsToRemove.length} commands.`);
                this.io.to(this.id).emit('lobby commands removed', {
                    cmdIds: commandsToRemove,
                    strokeId,
                    playerId // <-- CHANGED
                });
            }
        } else if (cmdId) {
            const index = this.lobbyCanvasCommands.findIndex(cmd => cmd.cmdId === cmdId);
            if (index !== -1) {
                const foundCmd = this.lobbyCanvasCommands[index];
                if (foundCmd.playerId === playerId) {
                    this.lobbyCanvasCommands.splice(index, 1);
                    commandsToRemove.push(foundCmd.cmdId);
                    console.log(`[Lobby ${this.id}] Undo single cmd=${foundCmd.cmdId} by player=${playerId}`);
                    this.io.to(this.id).emit('lobby commands removed', {
                        cmdIds: commandsToRemove,
                        strokeId: null,
                        playerId // <-- CHANGED
                    });
                } else {
                    console.warn(`[Lobby ${this.id}] Player ${playerId} tried to undo command of another player?`);
                }
            }
        }
    }

    handleStartGameRequest(socket) {
        if (socket.id !== this.hostId) {
            socket.emit('system message', 'Only the host can start.');
            return;
        }
        if (this.players.size < MIN_PLAYERS_TO_START) {
            socket.emit('system message', `Need ${MIN_PLAYERS_TO_START} players to start.`);
            return;
        }
        if (this.gameManager.gamePhase !== 'LOBBY') {
            socket.emit('system message', 'Game is already running.');
            return;
        }
        console.log(`[Lobby ${this.id}] Host starting game.`);
        this.io.to(this.id).emit('game starting', { lobbyId: this.id });
        setTimeout(() => this.gameManager.startGame(), 500);
    }

    getPlayerCount() {
        return this.players.size;
    }
    attemptAutoStartGame() {
        // no-op
    }
}

export default Lobby;
