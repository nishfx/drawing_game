import { getRandomWord } from './game/wordlist.js';

// Constants remain the same
const MAX_PLAYERS = 4; // Keep for reference, but Lobby enforces
const MIN_PLAYERS_TO_START = 2;
const DRAW_TIME_SECONDS = 120;
const VOTE_TIME_SECONDS = 60;
const RESULTS_TIME_SECONDS = 15;

class GameManager {
    // Modified Constructor: Takes io and lobbyId
    constructor(io, lobbyId) {
        this.io = io;
        this.lobbyId = lobbyId; // ID of the lobby this belongs to
        this.lobby = null; // Reference to the parent Lobby instance (set externally)

        // Game-specific state
        this.gamePhase = 'LOBBY'; // Initial state is Lobby (controlled by Lobby class)
        this.currentWord = "";
        this.roundTimer = null;
        this.readyPlayers = new Set();
        this.playerDrawings = {}; // Stores { playerId: drawingDataUrl }
        this.playerVotes = {}; // Stores { voterId: votedForId }
        this.currentTimerDuration = 0;
        this.currentTimerStart = 0;
    }

    // Method to link back to the parent lobby (called after instantiation)
    setLobbyReference(lobbyInstance) {
        this.lobby = lobbyInstance;
    }

    // --- Helpers ---
    // Use lobby's player map
    getPlayers() {
        return this.lobby ? this.lobby.players : new Map();
    }
    getPlayerName(socketId) {
        return this.lobby?.players?.get(socketId)?.name || 'Unknown';
    }

    // Broadcast specifically to this lobby's room
    broadcastToLobby(event, data) {
        this.io.to(this.lobbyId).emit(event, data);
    }

    broadcastGameState() {
        if (!this.lobby) return; // Need lobby reference

        let drawingsToSend = null;
        if (this.gamePhase === 'VOTING' || this.gamePhase === 'RESULTS') {
            drawingsToSend = this.playerDrawings;
        }

        // Get current scores from lobby player data
        const currentScores = Array.from(this.getPlayers().values(), p => ({
            id: p.id,
            name: p.name,
            score: p.score || 0,
            receivedVotes: p.receivedVotes || 0 // Include votes received in this round for results phase
        }));


        const state = {
            phase: this.gamePhase,
            word: (this.gamePhase === 'DRAWING' || this.gamePhase === 'RESULTS') ? this.currentWord : null,
            drawings: drawingsToSend,
            scores: currentScores, // Send updated scores
            timerDuration: (this.gamePhase === 'DRAWING' || this.gamePhase === 'VOTING') ? this.currentTimerDuration : null,
            timerStart: (this.gamePhase === 'DRAWING' || this.gamePhase === 'VOTING') ? this.currentTimerStart : null,
            minPlayers: MIN_PLAYERS_TO_START,
            playerCount: this.getPlayers().size,
            lobbyId: this.lobbyId,
            hostId: this.lobby.hostId
        };
        this.broadcastToLobby('game state update', state); // Use specific broadcast
        console.log(`Lobby ${this.lobbyId}: Broadcasting state: ${this.gamePhase} (${state.playerCount} players)`);
    }

    // --- Phase Transitions ---
    // startGame is now called by the Lobby when host clicks Start
    startGame() {
        if (this.gamePhase !== 'LOBBY') {
             console.warn(`Lobby ${this.lobbyId}: startGame called but phase is ${this.gamePhase}`);
             return; // Should only start from Lobby
        }
        console.log(`Lobby ${this.lobbyId}: Starting game sequence.`);
        // Reset scores at the beginning of a new game sequence
        this.getPlayers().forEach(p => {
            p.score = 0;
            p.receivedVotes = 0;
            p.hasVoted = false;
        });
        this.startDrawingPhase();
    }

    startDrawingPhase() {
        this.gamePhase = 'DRAWING';
        this.currentWord = getRandomWord();
        this.readyPlayers.clear();
        this.playerDrawings = {};
        this.playerVotes = {};
        // Reset round-specific player state (votes)
        this.getPlayers().forEach(p => {
            p.hasVoted = false;
            p.receivedVotes = 0; // Reset votes received for the new round
        });
        console.log(`Lobby ${this.lobbyId}: Drawing phase started. Word: ${this.currentWord}`);
        this.currentTimerDuration = DRAW_TIME_SECONDS;
        this.currentTimerStart = Date.now();
        this.broadcastGameState(); // Broadcast state *before* round start event
        this.broadcastToLobby('round start', { word: this.currentWord, duration: this.currentTimerDuration });
        if (this.roundTimer) clearTimeout(this.roundTimer);
        this.roundTimer = setTimeout(this.startVotingPhase.bind(this), this.currentTimerDuration * 1000);
    }

    checkEndDrawingPhase() {
        if (this.gamePhase === 'DRAWING' && this.readyPlayers.size === this.getPlayers().size && this.getPlayers().size > 0) {
            console.log(`Lobby ${this.lobbyId}: All players ready, ending drawing phase early.`);
            if (this.roundTimer) clearTimeout(this.roundTimer);
            this.startVotingPhase();
        }
    }

    startVotingPhase() {
        if (this.gamePhase !== 'DRAWING') return; // Prevent accidental transitions

        // Ensure all players who didn't submit are marked as ready (with no drawing)
        this.getPlayers().forEach(p => {
            if (!this.readyPlayers.has(p.id)) {
                console.log(`Lobby ${this.lobbyId}: Player ${p.name} did not submit drawing in time.`);
                // Don't add to playerDrawings, they just can't be voted for
            }
        });

        this.gamePhase = 'VOTING';
        console.log(`Lobby ${this.lobbyId}: Voting phase started.`);
        this.getPlayers().forEach(p => { p.hasVoted = false; }); // Reset vote status
        this.playerVotes = {}; // Clear previous votes
        this.currentTimerDuration = VOTE_TIME_SECONDS;
        this.currentTimerStart = Date.now();
        this.broadcastGameState(); // State includes drawings submitted
        this.broadcastToLobby('voting start', { duration: this.currentTimerDuration });
        if (this.roundTimer) clearTimeout(this.roundTimer);
        this.roundTimer = setTimeout(this.startResultsPhase.bind(this), this.currentTimerDuration * 1000);
    }

    startResultsPhase() {
        if (this.gamePhase !== 'VOTING') return; // Prevent accidental transitions

        this.gamePhase = 'RESULTS';
        this.currentTimerDuration = 0;
        this.currentTimerStart = 0;
        console.log(`Lobby ${this.lobbyId}: Results phase started.`);

        // Calculate scores based on votes received
        this.getPlayers().forEach(p => { p.receivedVotes = 0; }); // Reset vote counts first
        Object.values(this.playerVotes).forEach(votedForId => {
            const votedPlayer = this.getPlayers().get(votedForId);
            if (votedPlayer) {
                votedPlayer.receivedVotes = (votedPlayer.receivedVotes || 0) + 1;
            }
        });

        // Award points (e.g., 1 point per vote)
        this.getPlayers().forEach(p => {
            p.score = (p.score || 0) + (p.receivedVotes || 0);
        });

        this.broadcastGameState(); // State includes final scores/results for the round
        if (this.roundTimer) clearTimeout(this.roundTimer);
        // Decide whether to start next round or go back to lobby
        // For now, always go back to lobby after results
        this.roundTimer = setTimeout(this.goToLobby.bind(this), RESULTS_TIME_SECONDS * 1000);
    }

    // Renamed from original goToLobby - this resets the *game* state back to lobby mode
    goToLobby() {
        console.log(`Lobby ${this.lobbyId}: Game returning to Lobby state.`);
        this.gamePhase = 'LOBBY'; // Set game manager's phase
        this.currentWord = "";
        if (this.roundTimer) clearTimeout(this.roundTimer); this.roundTimer = null;
        this.currentTimerDuration = 0; this.currentTimerStart = 0;
        this.readyPlayers.clear(); this.playerDrawings = {}; this.playerVotes = {};
        // Scores persist on the player objects in the Lobby instance
        this.broadcastGameState(); // Broadcast the LOBBY state for this game instance
        // The Lobby instance itself doesn't change phase here, only the game within it
        if (this.lobby) {
            this.lobby.attemptAutoStartGame(); // Check if lobby should restart game (currently disabled)
        }
    }

    // --- Event Handlers (Called by Lobby instance via server.js forwarder) ---

    handleChatMessage(socket, msg) {
        // Game chat could be different from lobby chat if needed
        if (!this.lobby?.players?.has(socket.id) || typeof msg !== 'string' || msg.trim().length === 0) return;
        const senderName = this.getPlayerName(socket.id);
        const cleanMsg = msg.substring(0, 100); // Limit message length

        // Basic word checking (example - needs refinement)
        let isCorrectGuess = false;
        if (this.currentWord && cleanMsg.toLowerCase().trim() === this.currentWord.toLowerCase()) {
            isCorrectGuess = true;
            // Handle correct guess logic (e.g., award points, notify others)
            // For now, just mark the message
            console.log(`Lobby ${this.lobbyId}: Correct guess by ${senderName}!`);
            this.broadcastToLobby('system message', `${senderName} guessed the word!`);
            // Prevent further guesses? Or allow multiple? TBD.
        }

        console.log(`Lobby ${this.lobbyId} (Game Chat): ${senderName}: ${cleanMsg}`);
        this.broadcastToLobby('chat message', {
            senderName: senderName,
            senderColor: this.lobby.players.get(socket.id)?.color,
            text: cleanMsg,
            isCorrectGuess: isCorrectGuess // Add flag for UI styling
        });
    }

    handlePlayerReady(socket, drawingDataUrl) {
        if (this.gamePhase === 'DRAWING' && this.lobby?.players?.has(socket.id) && !this.readyPlayers.has(socket.id)) {
            // Validate Data URL (basic check)
            if (drawingDataUrl && typeof drawingDataUrl === 'string' && drawingDataUrl.startsWith('data:image/png;base64,') && drawingDataUrl.length < 1000000) { // Increased limit slightly to 1MB
                 this.playerDrawings[socket.id] = drawingDataUrl;
                 this.readyPlayers.add(socket.id);
                 console.log(`Lobby ${this.lobbyId}: ${this.getPlayerName(socket.id)} is ready with drawing.`);
                 socket.emit('system message', 'Drawing submitted successfully!'); // Feedback to player
                 this.checkEndDrawingPhase();
            } else {
                 console.warn(`Lobby ${this.lobbyId}: Invalid or missing drawing data from ${socket.id}. Size: ${drawingDataUrl?.length}`);
                 socket.emit('system message', 'Error submitting drawing. It might be too large or invalid.');
            }
        } else if (this.gamePhase !== 'DRAWING') {
             console.warn(`Lobby ${this.lobbyId}: Player ${socket.id} sent 'ready' outside of DRAWING phase.`);
             socket.emit('system message', 'Cannot submit drawing now.');
        } else if (this.readyPlayers.has(socket.id)) {
             console.warn(`Lobby ${this.lobbyId}: Player ${socket.id} sent 'ready' multiple times.`);
             socket.emit('system message', 'You have already submitted your drawing.');
        }
    }

    handleSubmitVote(socket, votedForId) {
         if (this.gamePhase === 'VOTING' && this.lobby?.players?.has(socket.id)) {
             const voter = this.lobby.players.get(socket.id);
             if (!voter) return; // Should not happen

             if (voter.hasVoted) {
                 socket.emit('vote error', "You have already voted.");
                 return; // Prevent double voting
             }

             if (votedForId === socket.id) {
                 socket.emit('vote error', "You cannot vote for yourself.");
                 return;
             }
             // Check if the player being voted for exists AND submitted a drawing
             if (!this.lobby.players.has(votedForId) || !this.playerDrawings[votedForId]) {
                  socket.emit('vote error', "Invalid player or drawing voted for.");
                  return;
             }

             console.log(`Lobby ${this.lobbyId}: ${this.getPlayerName(socket.id)} voted for ${this.getPlayerName(votedForId)}`);
             voter.hasVoted = true; // Mark voter
             this.playerVotes[socket.id] = votedForId; // Store vote { voterId: votedForId }
             socket.emit('vote accepted');

             // Optional: Check if all players have voted to end phase early
             const totalPlayers = this.getPlayers().size;
             const totalVotes = Object.keys(this.playerVotes).length;
             if (totalVotes === totalPlayers && totalPlayers > 0) {
                 console.log(`Lobby ${this.lobbyId}: All players have voted, ending voting phase early.`);
                 if (this.roundTimer) clearTimeout(this.roundTimer);
                 this.startResultsPhase();
             }
         } else if (this.gamePhase !== 'VOTING') {
             socket.emit('vote error', "Voting is not active.");
         }
    }
}

export default GameManager;