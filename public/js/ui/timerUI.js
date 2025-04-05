const timerContainer = document.getElementById('timer-container');
const timerBar = document.getElementById('timer-bar');
const timerText = document.getElementById('timer-text');

let timerInterval = null;
let timerEndTime = 0;
let timerDuration = 0;

export function startTimer(durationSeconds) {
    if (!timerContainer || !timerBar || !timerText) { console.warn("Timer elements not found."); return; }
    stopTimer(); // Clear any existing timer
    timerDuration = durationSeconds * 1000;
    if (timerDuration <= 0 || isNaN(timerDuration)) {
        console.warn(`Invalid timer duration: ${durationSeconds}s`);
        hideTimer(); // Hide timer if duration is invalid
        return;
    }
    timerEndTime = Date.now() + timerDuration;
    timerContainer.style.display = 'block';
    updateTimerDisplay(); // Initial display update
    timerInterval = setInterval(updateTimerDisplay, 100); // Update frequently for smooth bar
}

export function stopTimer() {
    if (timerInterval !== null) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    // Optionally reset timer display when stopped
    // if (timerBar) timerBar.style.width = '100%';
    // if (timerText) timerText.textContent = '';
}

export function hideTimer() {
     if (timerContainer) timerContainer.style.display = 'none';
     stopTimer(); // Ensure interval is stopped when hidden
}

 export function showTimer() {
     if (timerContainer) timerContainer.style.display = 'block';
     // Note: Doesn't restart timer, just makes container visible
     // Timer should be started explicitly with startTimer() when needed
}


function updateTimerDisplay() {
    if (!timerBar || !timerText) { stopTimer(); return; }
    const now = Date.now();
    const timeRemaining = Math.max(0, timerEndTime - now);
    const percentageRemaining = timerDuration > 0 ? Math.max(0, (timeRemaining / timerDuration) * 100) : 0;
    const secondsRemaining = Math.ceil(timeRemaining / 1000);

    try {
        timerBar.style.width = `${percentageRemaining}%`;
        timerText.textContent = `${secondsRemaining}s`;

        // Change color based on time remaining
        if (percentageRemaining < 25) {
            timerBar.style.backgroundColor = '#f44336'; // Red
        } else if (percentageRemaining < 50) {
            timerBar.style.backgroundColor = '#ff9800'; // Orange
        } else {
            timerBar.style.backgroundColor = '#4caf50'; // Green
        }
    } catch (error) {
        console.error("Error updating timer display:", error);
        stopTimer();
        hideTimer(); // Hide timer on error
        return;
    }

    // Stop interval when time runs out
    if (timeRemaining <= 0 && timerInterval !== null) {
        stopTimer();
        // Optionally add a visual cue that time is up
        if (timerText) timerText.textContent = "0s";
        if (timerBar) timerBar.style.width = '0%';
    }
}