// public/js/drawing/fillUtil.js

/**
 * Gets the color [r, g, b, a] of a specific pixel on the canvas.
 * @param {CanvasRenderingContext2D} ctx - The canvas context.
 * @param {number} x - The x-coordinate.
 * @param {number} y - The y-coordinate.
 * @returns {Uint8ClampedArray|null} An array [r, g, b, a] or null if coords are invalid.
 */
export function getPixelColor(ctx, x, y) {
    if (!ctx || x < 0 || y < 0 || x >= ctx.canvas.width || y >= ctx.canvas.height) {
        return null; // Invalid coordinates
    }
    try {
        // Ensure coordinates are integers for getImageData
        const intX = Math.floor(x);
        const intY = Math.floor(y);
        const pixelData = ctx.getImageData(intX, intY, 1, 1).data;
        return pixelData;
    } catch (e) {
        console.error("Error getting pixel data (maybe tainted canvas?):", e);
        return null;
    }
}

/**
 * Converts a hex color string (#RRGGBB or #RGB) to an RGBA array [r, g, b, a].
 * @param {string} hex - The hex color string.
 * @returns {number[]} An array [r, g, b, 255].
 */
function hexToRgba(hex) {
    // Handle shorthand hex (e.g., #03F) -> #0033FF
    if (hex.length === 4) {
        hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    if (hex.length !== 7 || hex[0] !== '#') {
        console.warn(`Invalid hex color format: ${hex}. Defaulting to black.`);
        return [0, 0, 0, 255]; // Default to black if format is wrong
    }
    try {
        const bigint = parseInt(hex.slice(1), 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;
        return [r, g, b, 255]; // Assume full opacity
    } catch (e) {
        console.error(`Error parsing hex color: ${hex}`, e);
        return [0, 0, 0, 255]; // Default to black on error
    }
}

/**
 * Compares two color arrays [r, g, b, a] within a tolerance.
 * @param {Uint8ClampedArray|number[]} color1
 * @param {Uint8ClampedArray|number[]} color2
 * @param {number} tolerance - Max difference allowed for R, G, B values (e.g., 2).
 * @returns {boolean} True if colors are similar within tolerance.
 */
function colorsMatch(color1, color2, tolerance = 2) {
    if (!color1 || !color2) return false;
    // Check RGB similarity within tolerance. Alpha is often less critical for fill boundaries.
    const rDiff = Math.abs(color1[0] - color2[0]);
    const gDiff = Math.abs(color1[1] - color2[1]);
    const bDiff = Math.abs(color1[2] - color2[2]);
    // Optional: Check alpha similarity if needed: const aDiff = Math.abs(color1[3] - color2[3]);
    return rDiff <= tolerance && gDiff <= tolerance && bDiff <= tolerance; // && aDiff <= tolerance;
}

/**
 * Performs a flood fill operation on the canvas.
 * Uses a non-recursive queue-based approach to avoid stack overflow.
 * @param {CanvasRenderingContext2D} ctx - The canvas context.
 * @param {number} startX - The starting x-coordinate.
 * @param {number} startY - The starting y-coordinate.
 * @param {string} fillColorHex - The hex color string (#RRGGBB) to fill with.
 */
export function floodFill(ctx, startX, startY, fillColorHex) {
    if (!ctx || !fillColorHex) return;

    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;
    startX = Math.round(startX);
    startY = Math.round(startY);

    // 1. Get target color data
    const fillColorRgba = hexToRgba(fillColorHex);

    // 2. Get start color data
    const startColorRgba = getPixelColor(ctx, startX, startY);

    // 3. Check if start color is same as fill color or invalid
    if (!startColorRgba) {
        console.warn("Flood fill: Start coordinates out of bounds or failed to get color.");
        return;
    }
    // Use tolerance when comparing start color to fill color
    if (colorsMatch(startColorRgba, fillColorRgba, 2)) {
        console.log("Flood fill: Start color is already the fill color.");
        return;
    }

    // 4. Get image data for the entire canvas
    let imageData;
    try {
        imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    } catch (e) {
        console.error("Flood fill: Could not get ImageData (tainted canvas?):", e);
        alert("Could not perform fill operation. Canvas might be tainted by external images.");
        return;
    }
    const data = imageData.data;
    const visited = new Uint8Array(canvasWidth * canvasHeight); // Use typed array for visited check (more efficient)

    // 5. Initialize queue with start pixel
    const pixelQueue = [[startX, startY]];
    const startIndex = (startY * canvasWidth + startX);
    visited[startIndex] = 1; // Mark start pixel as visited

    // Helper to get index in the ImageData array (4 bytes per pixel)
    const getIndex = (x, y) => (y * canvasWidth + x) * 4;
    // Helper to get index for the visited array (1 byte per pixel)
    const getVisitedIndex = (x, y) => y * canvasWidth + x;

    let iterations = 0;
    const maxIterations = canvasWidth * canvasHeight * 2; // Safety break

    // 6. Process the queue
    while (pixelQueue.length > 0) {
        iterations++;
        if (iterations > maxIterations) {
            console.error("Flood fill exceeded max iterations. Stopping.");
            break; // Safety break
        }

        const [x, y] = pixelQueue.shift();

        // Color the current pixel (it was already checked before being added)
        const currentIndex = getIndex(x, y);
        data[currentIndex] = fillColorRgba[0];     // R
        data[currentIndex + 1] = fillColorRgba[1]; // G
        data[currentIndex + 2] = fillColorRgba[2]; // B
        data[currentIndex + 3] = fillColorRgba[3]; // A

        // Check neighbors
        const neighbors = [
            [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
        ];

        for (const [nx, ny] of neighbors) {
            // Check bounds
            if (nx >= 0 && nx < canvasWidth && ny >= 0 && ny < canvasHeight) {
                const visitedIndex = getVisitedIndex(nx, ny);
                // Check if already visited
                if (visited[visitedIndex] === 0) {
                    visited[visitedIndex] = 1; // Mark as visited immediately
                    const neighborIndex = getIndex(nx, ny);
                    const neighborColor = [
                        data[neighborIndex],
                        data[neighborIndex + 1],
                        data[neighborIndex + 2],
                        data[neighborIndex + 3]
                    ];
                    // Check if neighbor color matches the original start color (with tolerance)
                    if (colorsMatch(neighborColor, startColorRgba, 2)) {
                        pixelQueue.push([nx, ny]);
                    }
                }
            }
        }
         // Optimization: Limit queue size (optional, but can prevent memory issues)
         // if (pixelQueue.length > canvasWidth * canvasHeight) {
         //    console.warn("Flood fill queue exceeded maximum size. Stopping fill.");
         //    break;
         // }
    }

    // 7. Put the modified image data back onto the canvas
    ctx.putImageData(imageData, 0, 0);
    console.log("Flood fill complete.");
}