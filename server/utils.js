// server/utils.js

// Updated list with more saturated/darker colors
const playerColors = [
    "#E63946", // Red
    "#1255ba", // Blue
    "#2A9D8F", // Teal Green
    "#F4A261", // Dark Orange/Sandy Brown
    "#6A0DAD", // Purple
    "#E76F51", // Coral/Orange-Red
    "#8D4925", // Brown
    "#006400", // Dark Green
    "#FF00FF", // Magenta
    "#4B0082", // Indigo
    "#D2691E", // Chocolate Brown
    "#DC143C", // Crimson Red
];
let colorIndex = 0;

export function getRandomColor() {
    // Cycle through colors for better distinction initially
    const color = playerColors[colorIndex % playerColors.length];
    colorIndex++;
    return color;
}