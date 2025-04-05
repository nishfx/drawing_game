// Simple list of distinct colors
const playerColors = [
    "#E63946", // Red
    "#1D3557", // Dark Blue
    "#457B9D", // Medium Blue
    "#A8DADC", // Light Blue/Cyan
    "#F1FAEE", // Off White (maybe not best for background)
    "#F4A261", // Sandy Brown/Orange
    "#E76F51", // Coral
    "#2A9D8F", // Teal Green
    "#E9C46A", // Saffron Yellow
    "#6A0DAD", // Purple
    "#FFC0CB", // Pink
    "#008000", // Green
    "#808080", // Gray
];
let colorIndex = 0;

export function getRandomColor() {
    // Cycle through colors for better distinction initially
    const color = playerColors[colorIndex % playerColors.length];
    colorIndex++;
    return color;
    // Or truly random: return '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
}