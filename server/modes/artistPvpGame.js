// server/modes/artistPvpGame.js
import BaseGame, { GamePhase } from './baseGame.js';
import { getRandomWord } from '../wordlist.js';
import { evaluateDrawing } from '../aiService.js';

// const DRAW_TIME_SECONDS = 90; // Now comes from options in BaseGame
const RATING_TIMEOUT_SECONDS = 180; // Max time host has to rate all drawings
const RESULTS_DISPLAY_SECONDS = 15; // Time to show round results
const FINAL_SCOREBOARD_DISPLAY_SECONDS = 30; // Time to show final winner
const MIN_PLAYERS_PVP = 2;

class ArtistPvpGame extends BaseGame {
    constructor(io, lobbyId, lobbyRef, options) {
        super(io, lobbyId, lobbyRef, options); // Pass options up
        this.minPlayers = MIN_PLAYERS_PVP;
        this.currentWord = ""; // Single word for the round
        this.playerDrawings = new Map(); // { playerId: drawingDataUrl }
        this.readyPlayers = new Set(); // Players who submitted drawing
        this.aiRatings = new Map(); // { targetPlayerId: { score: number, explanation: string, error?: boolean, raterId?: string } }
        this.roundScores = new Map(); // { playerId: pointsAwardedThisRound }
        this.isRatingInProgress = new Set(); // Track which drawings are currently being rated by AI
    }

    // --- Overridden Methods ---

    startGame() {
        if (!super.startGame()) return; // Base checks + score reset
        this.startNextRound(); // Start the first round
    }

    startNextRound() {
        super.startNextRound(); // Increments round counter
        if (this.currentRound > this.totalRounds) {
            this.startFinalScoreboardPhase();
        } else {
            this.startDrawingPhase();
        }
    }

    goToLobby() {
        super.goToLobby(); // Base cleanup
        this.currentWord = "";
        this.playerDrawings.clear();
        this.readyPlayers.clear();
        this.aiRatings.clear();
        this.roundScores.clear();
        this.isRatingInProgress.clear();
    }

    broadcastGameState() {
        const players = this.getPlayers();
        const currentScores = Array.from(players.values(), p => ({
            id: p.id,
            name: p.name,
            score: p.score || 0,
        }));

        let drawingsToSend = null;
        let ratingsToSend = null;

        // Send drawings in Rating, Results, and Final Scoreboard phases
        if ([GamePhase.MANUAL_RATING, GamePhase.RESULTS, GamePhase.FINAL_SCOREBOARD].includes(this.gamePhase)) {
            drawingsToSend = Object.fromEntries(this.playerDrawings);
        }
        // Send ratings in Rating (partial), Results, and Final Scoreboard phases
         if ([GamePhase.MANUAL_RATING, GamePhase.RESULTS, GamePhase.FINAL_SCOREBOARD].includes(this.gamePhase)) {
            ratingsToSend = Object.fromEntries(this.aiRatings);
        }


        const state = {
            // Base state
            phase: this.gamePhase,
            currentRound: this.currentRound,
            totalRounds: this.totalRounds,
            timerDuration: this.currentTimerDuration > 0 ? this.currentTimerDuration : null,
            timerStart: this.currentTimerStart > 0 ? this.currentTimerStart : null,
            minPlayers: this.minPlayers,
            playerCount: players.size,
            lobbyId: this.lobbyId,
            hostId: this.lobby.hostId,
            // PvP specific state
            word: (this.gamePhase === GamePhase.DRAWING || this.gamePhase === GamePhase.MANUAL_RATING || this.gamePhase === GamePhase.RESULTS) ? this.currentWord : null,
            drawings: drawingsToSend,
            ratings: ratingsToSend, // Send current ratings
            scores: currentScores, // Overall scores
            readyCount: this.readyPlayers.size,
            isRatingInProgress: Array.from(this.isRatingInProgress), // Send IDs being rated
        };
        this.broadcastToLobby('game state update', state);
        console.log(`[${this.lobbyId}] Broadcasting PvP state: ${this.gamePhase} R:${this.currentRound}/${this.totalRounds} (${state.playerCount} players, ${state.readyCount} ready)`);
    }

    // --- Phase Transitions ---

    startDrawingPhase() {
        this.gamePhase = GamePhase.DRAWING;
        this.currentWord = getRandomWord(); // Single word for everyone
        this.playerDrawings.clear();
        this.readyPlayers.clear();
        this.aiRatings.clear(); // Clear ratings for the new round
        this.roundScores.clear();
        this.isRatingInProgress.clear();

        console.log(`[${this.lobbyId}] Round ${this.currentRound} Drawing phase. Word: ${this.currentWord}`);

        this.broadcastGameState(); // Includes the single word
        // Use drawTime from options (set in BaseGame constructor)
        this.startTimer(this.drawTime, this.startManualRatingPhase);
    }

    checkEndDrawingPhase() {
        if (this.gamePhase === GamePhase.DRAWING && this.readyPlayers.size === this.getPlayers().size && this.getPlayers().size > 0) {
            console.log(`[${this.lobbyId}] All players ready, ending drawing phase early.`);
            this.clearTimer();
            this.startManualRatingPhase();
        }
    }

    startManualRatingPhase() {
        if (this.gamePhase !== GamePhase.DRAWING) return;

        // Mark players who didn't submit as having no drawing
        this.getPlayers().forEach(p => {
            if (!this.readyPlayers.has(p.id)) {
                console.log(`[${this.lobbyId}] Player ${p.name} did not submit drawing in time.`);
                // Ensure they don't have an entry in playerDrawings
                this.playerDrawings.delete(p.id);
            }
        });

        // Check if there are any drawings to rate
        if (this.playerDrawings.size === 0) {
             console.log(`[${this.lobbyId}] No drawings submitted, skipping rating and results.`);
             this.broadcastToLobby('system message', 'No drawings were submitted this round.');
             // Decide whether to start next round or end game
             if (this.currentRound >= this.totalRounds) {
                 this.startFinalScoreboardPhase();
             } else {
                 this.startNextRound();
             }
             return;
        }


        this.gamePhase = GamePhase.MANUAL_RATING;
        console.log(`[${this.lobbyId}] Manual Rating phase started. Waiting for host to rate ${this.playerDrawings.size} drawings.`);
        this.broadcastGameState(); // Show drawings, enable host rating buttons
        // Optional: Add a timeout for the host to rate all drawings
        this.startTimer(RATING_TIMEOUT_SECONDS, () => {
            console.warn(`[${this.lobbyId}] Rating phase timed out. Proceeding with available ratings.`);
            this.startResultsPhase();
        });
    }

    // --- NEW: Handler for Host Rating Request ---
    async handleRateDrawingRequest(socket, { targetPlayerId }) {
        if (this.gamePhase !== GamePhase.MANUAL_RATING) {
            console.warn(`[${this.lobbyId}] Rate request received outside of rating phase.`);
            return;
        }
        if (socket.id !== this.lobby.hostId) {
            console.warn(`[${this.lobbyId}] Non-host ${socket.id} tried to rate drawing.`);
            this.sendToPlayer(socket.id, 'system message', 'Only the host can rate drawings.');
            return;
        }
        if (!targetPlayerId || !this.playerDrawings.has(targetPlayerId)) {
            console.warn(`[${this.lobbyId}] Host tried to rate invalid/missing drawing for player ${targetPlayerId}.`);
            this.sendToPlayer(socket.id, 'system message', 'Cannot rate this drawing.');
            return;
        }
        if (this.aiRatings.has(targetPlayerId)) {
            console.log(`[${this.lobbyId}] Drawing for ${targetPlayerId} already rated.`);
            // Optionally allow re-rating? For now, prevent.
            this.sendToPlayer(socket.id, 'system message', 'This drawing has already been rated.');
            return;
        }
        if (this.isRatingInProgress.has(targetPlayerId)) {
             console.log(`[${this.lobbyId}] Rating already in progress for ${targetPlayerId}.`);
             this.sendToPlayer(socket.id, 'system message', 'Rating is already in progress for this drawing.');
             return;
        }


        const drawingDataUrl = this.playerDrawings.get(targetPlayerId);
        const word = this.currentWord; // Use the single round word

        console.log(`[${this.lobbyId}] Host requested AI rating for ${targetPlayerId}'s drawing of "${word}".`);
        this.isRatingInProgress.add(targetPlayerId);
        this.broadcastGameState(); // Update clients that rating is in progress

        try {
            const result = await evaluateDrawing(drawingDataUrl, word);
            console.log(`[${this.lobbyId}] AI Rating received for ${targetPlayerId}: ${result.score}/10`);
            this.aiRatings.set(targetPlayerId, {
                score: result.score,
                explanation: result.explanation,
                raterId: socket.id // Store who initiated the rating (host)
            });
        } catch (error) {
            console.error(`[${this.lobbyId}] AI Rating Error for ${targetPlayerId}:`, error);
            this.aiRatings.set(targetPlayerId, {
                score: 0,
                explanation: `AI Error: ${error}`,
                error: true,
                raterId: socket.id
            });
        } finally {
             this.isRatingInProgress.delete(targetPlayerId); // Remove from in-progress set
             // Send specific update for this rating
             this.broadcastToLobby('ai rating update', {
                 targetPlayerId: targetPlayerId,
                 rating: this.aiRatings.get(targetPlayerId)
             });
             this.checkIfAllRated(); // Check if ready to move to results
        }
    }

    checkIfAllRated() {
        const drawingsToRateCount = this.playerDrawings.size;
        const ratedCount = this.aiRatings.size;
        console.log(`[${this.lobbyId}] Checking if all rated: ${ratedCount}/${drawingsToRateCount}`);
        if (drawingsToRateCount > 0 && ratedCount >= drawingsToRateCount) {
            console.log(`[${this.lobbyId}] All drawings rated, proceeding to results.`);
            this.clearTimer(); // Stop the rating timeout timer
            this.startResultsPhase();
        }
    }


    startResultsPhase() {
        // Can be triggered by checkIfAllRated or timeout
        if (this.gamePhase !== GamePhase.MANUAL_RATING) return;

        this.gamePhase = GamePhase.RESULTS;
        console.log(`[${this.lobbyId}] Round ${this.currentRound} Results phase started.`);
        this.calculateScores(); // Calculate points based on AI ratings
        this.broadcastGameState(); // Send final state for the round
        this.startTimer(RESULTS_DISPLAY_SECONDS, this.startNextRound); // Timer to start next round or final scoreboard
    }

    startFinalScoreboardPhase() {
        this.gamePhase = GamePhase.FINAL_SCOREBOARD;
        console.log(`[${this.lobbyId}] Final Scoreboard phase started.`);
        this.clearTimer(); // Ensure no other timers interfere
        // Scores are already calculated and stored on player objects
        this.broadcastGameState(); // Broadcast final state
        this.startTimer(FINAL_SCOREBOARD_DISPLAY_SECONDS, this.goToLobby); // Timer to return to lobby
    }


    // --- Event Handlers --- (handlePlayerReady, handleChatMessage - remain similar)
     handlePlayerReady(socket, drawingDataUrl) {
        if (this.gamePhase !== GamePhase.DRAWING) {
            this.sendToPlayer(socket.id, 'system message', 'Cannot submit drawing now.');
            return;
        }
        if (this.readyPlayers.has(socket.id)) {
             this.sendToPlayer(socket.id, 'system message', 'You have already submitted.');
             return;
        }
        if (!this.getPlayerById(socket.id)) return;

        if (drawingDataUrl && typeof drawingDataUrl === 'string' && drawingDataUrl.startsWith('data:image/png;base64,') && drawingDataUrl.length < 2 * 1024 * 1024) {
             this.playerDrawings.set(socket.id, drawingDataUrl);
             this.readyPlayers.add(socket.id);
             console.log(`[${this.lobbyId}] ${this.getPlayerName(socket.id)} ready. (${this.readyPlayers.size}/${this.getPlayers().size})`);
             this.sendToPlayer(socket.id, 'system message', 'Drawing submitted!');
             this.broadcastGameState(); // Update ready count
             this.checkEndDrawingPhase();
        } else {
             this.sendToPlayer(socket.id, 'system message', 'Error submitting drawing.');
        }
    }

    handleChatMessage(socket, msg) {
        const sender = this.getPlayerById(socket.id);
        if (!sender || typeof msg !== 'string' || msg.trim().length === 0) return;
        const cleanMsg = msg.substring(0, 100);
        this.broadcastToLobby('chat message', {
            senderName: sender.name,
            senderColor: sender.color,
            text: cleanMsg,
            isCorrectGuess: false
        });
    }


    handlePlayerDisconnect(socketId) {
        const wasPresent = this.playerDrawings.has(socketId);
        super.handlePlayerDisconnect(socketId); // Basic checks (min players)

        // Remove PvP data
        this.playerDrawings.delete(socketId);
        this.readyPlayers.delete(socketId);
        this.aiRatings.delete(socketId);
        this.roundScores.delete(socketId);
        this.isRatingInProgress.delete(socketId);

        console.log(`[${this.lobbyId}] Cleaned up PvP data for disconnected player ${socketId}.`);

        // If in drawing phase, check if remaining players are all ready
        if (this.gamePhase === GamePhase.DRAWING) {
            this.checkEndDrawingPhase();
        }
        // If in rating phase, check if all *remaining* drawings are rated
        else if (this.gamePhase === GamePhase.MANUAL_RATING && wasPresent) {
             this.checkIfAllRated();
        }

        this.broadcastGameState(); // Update player list etc.
    }


    // --- Scoring Logic ---
    calculateScores() {
        this.roundScores.clear();
        this.aiRatings.forEach((rating, playerId) => {
            const player = this.getPlayerById(playerId);
            if (!player) return;

            let points = 0;
            // Award points directly based on AI score (0-10)
            if (!rating.error && typeof rating.score === 'number') {
                points = Math.max(0, Math.min(10, rating.score)); // Ensure score is 0-10
            }

            this.roundScores.set(playerId, points);
            player.score = (player.score || 0) + points; // Add to overall score
            console.log(`[${this.lobbyId}] Player ${player.name} scored ${points} points this round. Total: ${player.score}`);
        });
        // Update player list to reflect new scores immediately after calculation
        this.lobby.broadcastLobbyPlayerList();
    }
}

export default ArtistPvpGame;