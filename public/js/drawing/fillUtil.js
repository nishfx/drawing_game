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
        const pixelData = ctx.getImageData(x, y, 1, 1).data;
        return pixelData;
    } catch (e) {
        console.error("Error getting pixel data (maybe tainted canvas?):", e);
        return null;
    }
}

/**
 * Converts a hex color string (#RRGGBB) to an RGBA array [r, g, b, a].
 * @param {string} hex - The hex color string.
 * @returns {number[]} An array [r, g, b, 255].
 */
function hexToRgba(hex) {
    const bigint = parseInt(hex.slice(1), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return [r, g, b, 255]; // Assume full opacity
}

/**
 * Compares two color arrays [r, g, b, a].
 * @param {Uint8ClampedArray|number[]} color1
 * @param {Uint8ClampedArray|number[]} color2
 * @returns {boolean} True if colors are the same (ignoring minor alpha differences).
 */
function colorsMatch(color1, color2) {
    // Basic check: compare RGB values. Alpha can sometimes vary slightly.
    return color1 && color2 &&
           color1[0] === color2[0] &&
           color1[1] === color2[1] &&
           color1[2] === color2[2];
           // Optionally add a tolerance for alpha: Math.abs(color1[3] - color2[3]) < 5
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
        console.warn("Flood fill: Start coordinates out of bounds.");
        return;
    }
    if (colorsMatch(startColorRgba, fillColorRgba)) {
        console.log("Flood fill: Start color is the same as fill color.");
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

    // 5. Initialize queue with start pixel
    const pixelQueue = [[startX, startY]];
    const visited = new Set(); // Keep track of visited pixels to prevent infinite loops

    // Helper to get index in the ImageData array
    const getIndex = (x, y) => (y * canvasWidth + x) * 4;

    // Mark start pixel as visited
    visited.add(`${startX},${startY}`);

    // 6. Process the queue
    while (pixelQueue.length > 0) {
        const [x, y] = pixelQueue.shift();

        // Get current pixel's color directly from ImageData
        const currentIndex = getIndex(x, y);
        const currentPixelColor = [
            data[currentIndex],
            data[currentIndex + 1],
            data[currentIndex + 2],
            data[currentIndex + 3]
        ];

        // Check if current pixel matches the start color
        if (colorsMatch(currentPixelColor, startColorRgba)) {
            // Color the pixel with the fill color
            data[currentIndex] = fillColorRgba[0];     // R
            data[currentIndex + 1] = fillColorRgba[1]; // G
            data[currentIndex + 2] = fillColorRgba[2]; // B
            data[currentIndex + 3] = fillColorRgba[3]; // A

            // Add neighbors to the queue if they are within bounds, match start color, and haven't been visited
            const neighbors = [
                [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
            ];

            for (const [nx, ny] of neighbors) {
                const neighborKey = `${nx},${ny}`;
                if (nx >= 0 && nx < canvasWidth && ny >= 0 && ny < canvasHeight && !visited.has(neighborKey)) {
                    // Check neighbor color *before* adding to queue to optimize
                    const neighborIndex = getIndex(nx, ny);
                    const neighborColor = [
                        data[neighborIndex],
                        data[neighborIndex + 1],
                        data[neighborIndex + 2],
                        data[neighborIndex + 3]
                    ];
                    if (colorsMatch(neighborColor, startColorRgba)) {
                        pixelQueue.push([nx, ny]);
                    }
                    visited.add(neighborKey); // Mark as visited even if color doesn't match to avoid re-checking
                }
            }
        }
         // Optimization: Limit queue size to prevent excessive memory usage on large fills
         if (pixelQueue.length > canvasWidth * canvasHeight) {
            console.warn("Flood fill queue exceeded maximum size. Stopping fill.");
            break;
         }
    }

    // 7. Put the modified image data back onto the canvas
    ctx.putImageData(imageData, 0, 0);
    console.log("Flood fill complete.");
}