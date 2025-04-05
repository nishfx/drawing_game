import * as TimerUI from './ui/timerUI.js';
import * as PlayerListUI from './ui/playerListUI.js';
import * as ChatUI from './ui/chatUI.js';
import * as VotingUI from './ui/votingUI.js';
import * as ResultsUI from './ui/resultsUI.js';

// --- DOM Elements (Only those needed for general phase control) ---
const gameStatusElement = document.getElementById('game-status');
const wordHintElement = document.getElementById('word-hint');
const readyButton = document.getElementById('ready-button');
const drawingControls = document.getElementById('drawing-controls'); // Wrapper for canvas/button

// --- Export Functions that delegate ---
export const updatePlayerList = PlayerListUI.updatePlayerList;
export const addChatMessage = ChatUI.addChatMessage;
export const startTimer = TimerUI.startTimer;
export const stopTimer = TimerUI.stopTimer;

// Removed updateStatus function as the element is gone

export function showGamePhaseUI(phase, data = {}) {
    console.log("UIManager: Updating UI for phase:", phase, data);

    // --- Hide all phase-specific sections ---
    if (readyButton) readyButton.style.display = 'none';
    VotingUI.hideVotingArea();
    ResultsUI.hideResultsArea();
    TimerUI.hideTimer(); // Hide timer by default, specific phases will show it

    // --- Reset general elements ---
    if (drawingControls) drawingControls.style.opacity = '0.5'; // Dim by default
    if (wordHintElement) { wordHintElement.textContent = ''; wordHintElement.classList.remove('is-word'); }
    if (gameStatusElement) gameStatusElement.textContent = '';

    // --- Show elements for the current phase ---
    switch (phase) {
        case 'LOBBY': // Game Manager is in Lobby state (e.g., between rounds)
            if (gameStatusElement) {
                gameStatusElement.textContent = `Waiting for next round...`;
            }
            if (drawingControls) drawingControls.style.opacity = '0.5'; // Keep canvas dimmed
            if (wordHintElement) wordHintElement.textContent = '--- ROUND OVER ---';
            break;

        case 'WAITING': // Fallback case or initial state before game starts
            if (gameStatusElement) gameStatusElement.textContent = 'Waiting for players...';
            if (drawingControls) drawingControls.style.opacity = '0.5';
            break;

        case 'DRAWING':
            if (gameStatusElement) gameStatusElement.textContent = 'Draw the word!';
            if (wordHintElement && data.word) {
                // Display underscores for word length hint
                const hint = data.word.replace(/[a-zA-Z]/g, '_').split('').join(' ');
                wordHintElement.textContent = hint;
                wordHintElement.classList.add('is-word'); // Style as word/hint
            }
            if (drawingControls) drawingControls.style.opacity = '1'; // Enable canvas visually
            if (readyButton) {
                readyButton.style.display = 'block';
                readyButton.disabled = false; // Re-enable button at start of phase
                readyButton.textContent = "Ready";
            }
            TimerUI.showTimer();
            break;

        case 'VOTING':
            if (gameStatusElement) gameStatusElement.textContent = 'Vote for your favorite drawing!';
            if (drawingControls) drawingControls.style.opacity = '0.5'; // Dim canvas
            if (data.drawings && Object.keys(data.drawings).length > 0 && data.myPlayerId) {
                VotingUI.displayVotingOptions(data.drawings, data.myPlayerId);
                VotingUI.showVotingArea();
                VotingUI.enableVotingButtons(); // Ensure buttons are enabled at start
            } else {
                console.warn("Voting phase UI: No drawings or missing myPlayerId.");
                VotingUI.showVotingArea();
                // Display a message if no drawings are available
                const votingArea = document.getElementById('voting-area');
                if (votingArea) {
                    votingArea.innerHTML = '<p>Waiting for drawings to vote on...</p>';
                    if (!data.drawings || Object.keys(data.drawings).length === 0) {
                         votingArea.innerHTML = '<p>No drawings were submitted this round.</p>';
                    }
                }
            }
            TimerUI.showTimer();
            break;

        case 'RESULTS':
            if (gameStatusElement) gameStatusElement.textContent = 'Round Over!';
            if (wordHintElement && data.word) {
                wordHintElement.textContent = `Word was: ${data.word}`;
                wordHintElement.classList.add('is-word');
            }
            if (data.scores) {
                ResultsUI.displayResults(data.scores, data.drawings || {});
                ResultsUI.showResultsArea();
            } else {
                console.warn("Results phase UI: Missing scores.");
                ResultsUI.showResultsArea();
                 const resultsArea = document.getElementById('results-area');
                 if(resultsArea) resultsArea.innerHTML = '<p>Calculating results...</p>';
            }
            break;

        default:
            if (gameStatusElement) gameStatusElement.textContent = 'Unknown game state';
    }
}