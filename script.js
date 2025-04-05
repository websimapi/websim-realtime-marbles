import * as Matter from 'matter-js';

const { Engine, Render, Runner, World, Bodies, Body, Events, Composite } = Matter;

const canvas = document.getElementById('gameCanvas');
const loadingDiv = document.getElementById('loading');
const instructionsDiv = document.getElementById('instructions');
const winnerBanner = document.getElementById('winner-banner');

// --- Matter.js Setup ---
const engine = Engine.create({
  gravity: { x: 0, y: 0 } // Start with no gravity
});
const world = engine.world;

const render = Render.create({
  canvas: canvas,
  engine: engine,
  options: {
    width: 800,
    height: 600,
    wireframes: false,
    background: '#add8e6' // Light blue background
  }
});

Render.run(render);
const runner = Runner.create();
Runner.run(runner, engine);

// --- Game Variables ---
const room = new WebsimSocket();
let gameStarted = false;
let marbles = {}; // Store marble bodies, keyed by clientId
let labels = {}; // Store label elements keyed by clientId

const trackWidth = 600;
const trackHeight = 500;
const wallThickness = 20;
const marbleRadius = 15;
const startAreaHeight = 100;
const finishLineY = 550; // Y-coordinate of the finish line
const worldBounds = { minX: 0, minY: 0, maxX: 800, maxY: 600 }; // For label positioning

// --- Game World Creation ---

// Walls
const wallOptions = {
    isStatic: true,
    label: 'wall',
    render: { fillStyle: '#696969' } // Dark grey walls
};
const walls = [
  Bodies.rectangle(400, 50, trackWidth + wallThickness * 2, wallThickness, {...wallOptions, label: 'gate'}), // Top wall/gate
  Bodies.rectangle(100 - wallThickness / 2, 300, wallThickness, trackHeight + startAreaHeight, wallOptions), // Left wall
  Bodies.rectangle(700 + wallThickness / 2, 300, wallThickness, trackHeight + startAreaHeight, wallOptions), // Right wall
  Bodies.rectangle(400, 600 + wallThickness / 2, trackWidth + wallThickness * 2, wallThickness, wallOptions) // Bottom wall
];
World.add(world, walls);

// Obstacles
const obstacleOptions = {
    isStatic: true,
    label: 'obstacle',
    render: { fillStyle: '#8b4513' } // Brown obstacles
};
const obstacles = [
  Bodies.rectangle(400, 250, 300, 20, { ...obstacleOptions, angle: Math.PI / 12 }),
  Bodies.rectangle(250, 350, 200, 20, { ...obstacleOptions, angle: -Math.PI / 10 }),
  Bodies.rectangle(550, 450, 200, 20, { ...obstacleOptions, angle: Math.PI / 8 }),
  // Funnel
  Bodies.rectangle(300, 500, 20, 100, { ...obstacleOptions, angle: -Math.PI / 6 }),
  Bodies.rectangle(500, 500, 20, 100, { ...obstacleOptions, angle: Math.PI / 6 })
];
World.add(world, obstacles);

// Finish line visual (doesn't affect physics)
const finishLine = Bodies.rectangle(400, finishLineY, trackWidth, 5, {
    isStatic: true,
    isSensor: true, // Doesn't collide with anything
    label: 'finishLine',
    render: {
        fillStyle: 'red'
    }
});
World.add(world, finishLine);

// --- Websim Integration ---

async function initializeWebsim() {
    await room.initialize();
    loadingDiv.style.display = 'none';
    instructionsDiv.style.display = 'block';
    console.log("Websim initialized. My ID:", room.clientId);
    console.log("Peers:", room.peers);
    console.log("Initial Room State:", room.roomState);
    console.log("Initial Presence:", room.presence);

    // Initial setup based on current state
    updateMarbles(room.presence);
    updateLabels();
    checkGameState(room.roomState); // Check initial game state


    room.subscribePresence((currentPresence) => {
        console.log("Presence updated:", currentPresence);
        updateMarbles(currentPresence);
        updateLabels(); // Ensure labels are updated when presence changes
    });

    room.subscribeRoomState((currentRoomState) => {
        console.log("Room state updated:", currentRoomState);
        checkGameState(currentRoomState);
    });

    room.onmessage = (event) => {
        console.log("Received message:", event);
        // Handle custom events if needed in the future
    };

}

function checkGameState(state) {
     // Handle game start
     if (state.gameStarted && !gameStarted) {
         startGame();
     } else if (!state.gameStarted && gameStarted) {
         // This case might happen if a reset occurs while client was disconnected briefly
         // Or if state resets before local gameStarted flag does.
         console.log("Game ended or reset externally.");
         // Avoid resetting if already resetting
         if (engine.gravity.y !== 0) {
             resetGameLocal();
         }
     }

     // Handle winner display
     if (state.winner && !winnerBanner.textContent) {
         displayWinner(state.winner);
     } else if (!state.winner && winnerBanner.textContent) {
         // Winner cleared, likely due to reset
         winnerBanner.style.display = 'none';
         winnerBanner.textContent = '';
     }

     // Handle explicit reset signal - check local gameStarted too
     if (state.reset && gameStarted) {
         console.log("Reset signal received.");
         resetGameLocal(); // If a reset is triggered
         if (isHost()) {
            // Host clears the reset flag after processing
            // Use timeout to prevent race condition if multiple clients reset simultaneously
            setTimeout(() => room.updateRoomState({ reset: null }), 100);
         }
     }
}


// Only the "host" (first player to join) can start the game and declare winner/reset
const isHost = () => {
    if (!room.clientId || !room.peers || Object.keys(room.peers).length === 0) return false;
    // Sort by clientId to ensure consistent host selection
    const sortedPeerIds = Object.keys(room.peers).sort();
    return room.clientId === sortedPeerIds[0];
};

function startGame() {
    if (gameStarted) return;
    gameStarted = true;
    instructionsDiv.style.display = 'none';
    engine.gravity.y = 1; // Apply gravity

    // Remove the top wall/gate
    const gate = Composite.allBodies(world).find(body => body.label === 'gate');
    if (gate) {
        World.remove(world, gate);
    }

     // Ensure all marbles are non-static
    Object.values(marbles).forEach(marbleBody => {
        if (marbleBody) {
            Body.setStatic(marbleBody, false);
        }
    });


    console.log("Game Started!");
}

function displayWinner(winnerInfo) {
    // Prevent displaying winner multiple times or if game already reset locally
    if (winnerBanner.textContent || !gameStarted) return;

    const winnerName = room.peers[winnerInfo.clientId]?.username || 'Someone';
    winnerBanner.textContent = `${winnerName} wins!`;
    winnerBanner.style.display = 'block';
    engine.gravity.y = 0.1; // Reduce gravity significantly, but don't stop completely yet
    engine.timing.timeScale = 0.5; // Slow down physics simulation

    // Stop marble movement gently
    Object.values(marbles).forEach(marbleBody => {
        if (marbleBody) {
             // Reduce velocity gradually instead of abrupt stop
             Body.setVelocity(marbleBody, { x: marbleBody.velocity.x * 0.5, y: marbleBody.velocity.y * 0.5 });
             Body.setAngularVelocity(marbleBody, marbleBody.angularVelocity * 0.5);
        }
    });

    console.log(`Winner displayed: ${winnerName}`);

    // Host initiates reset after a delay
    setTimeout(() => {
         // Check roomState again to ensure we are still in the 'winner' state before resetting
         // This prevents accidental reset if another client reset first
         if (isHost() && room.roomState.winner && room.roomState.winner.clientId === winnerInfo.clientId) {
             console.log("Host triggering reset.");
             room.updateRoomState({ winner: null, gameStarted: false, reset: true });
         }
     }, 5000); // Reset after 5 seconds
}

function resetGameLocal() {
    // Prevent multiple resets stacking up
    if (!gameStarted && engine.gravity.y === 0) {
        console.log("Reset already in progress or completed.");
        return;
    }
    console.log("Resetting game locally...");

    // Remove existing marbles and their labels
    Object.keys(marbles).forEach(clientId => {
        if (marbles[clientId]) {
            World.remove(world, marbles[clientId]);
        }
        if (labels[clientId]) {
            labels[clientId].remove();
        }
    });
    marbles = {};
    labels = {};

    // Re-add the gate if it was removed
    const gateExists = Composite.allBodies(world).some(body => body.label === 'gate');
     if (!gateExists) {
        // Find the original gate definition in the walls array
        const gateDefinition = walls.find(w => w.label === 'gate');
        if (gateDefinition) {
            // Re-create the gate body from its definition if needed
            const newGate = Bodies.rectangle(gateDefinition.position.x, gateDefinition.position.y, gateDefinition.vertices[2].x - gateDefinition.vertices[0].x, gateDefinition.vertices[2].y - gateDefinition.vertices[0].y, {...gateDefinition, label: 'gate'}); // Recreate from definition props
            World.add(world, newGate);
        } else {
            console.error("Could not find gate definition to re-add.");
        }
     }


    // Reset game state variables
    gameStarted = false; // Set gameStarted to false *before* updating marbles
    winnerBanner.style.display = 'none';
    winnerBanner.textContent = '';
    engine.gravity.y = 0; // Reset gravity
    engine.timing.timeScale = 1; // Reset physics speed

    // Re-create marbles based on current presence
    updateMarbles(room.presence); // This will now correctly set marbles to static
    updateLabels();

    // Show instructions again
    instructionsDiv.style.display = 'block';
    console.log("Local reset complete.");
}


// Function to create or update marble visuals and physics bodies
function updateMarbles(presence) {
    const currentClients = Object.keys(presence);
    const existingMarbleClients = Object.keys(marbles);
    const numPlayers = currentClients.length;

    console.log(`Updating marbles. Game started: ${gameStarted}. Players: ${numPlayers}`);

    // Add/Update marbles for current clients
    currentClients.forEach((clientId, index) => {
        const peerData = room.peers[clientId];
        if (!peerData) {
            console.warn(`Peer data not found for clientId: ${clientId}, skipping marble update for this client.`);
            // Attempt to remove if exists locally but peerData is gone
            if (marbles[clientId]) {
                World.remove(world, marbles[clientId]);
                delete marbles[clientId];
            }
            if (labels[clientId]) {
                labels[clientId].remove();
                delete labels[clientId];
            }
            return; // Skip if peer data isn't available
        }

        // Calculate start position dynamically based on number of players
        // Ensure trackWidth is defined, provide default if not
        const currentTrackWidth = typeof trackWidth !== 'undefined' ? trackWidth : 600;
        const currentWallThickness = typeof wallThickness !== 'undefined' ? wallThickness : 20;
        const currentMarbleRadius = typeof marbleRadius !== 'undefined' ? marbleRadius : 15;
        const currentStartAreaHeight = typeof startAreaHeight !== 'undefined' ? startAreaHeight : 100;

        const availableWidth = currentTrackWidth - currentWallThickness * 2 - currentMarbleRadius * 2;
        const spacing = numPlayers > 1 ? availableWidth / (numPlayers -1) : 0; // Space between centers
        const startOffsetX = 100 + currentWallThickness + currentMarbleRadius; // Left edge for first marble center

        // const startX = startOffsetX + spacing * index;
         // Center marbles if only one player
        const startX = numPlayers === 1
            ? 100 + currentTrackWidth / 2 // Center of the track horizontally
            : startOffsetX + spacing * index;

        const startY = 50 + currentStartAreaHeight / 2 - currentMarbleRadius - 10; // Slightly higher start


        if (!marbles[clientId]) {
            // --- Create new marble ---
            console.log(`Creating marble for ${peerData.username} (${clientId}) at (${startX.toFixed(2)}, ${startY.toFixed(2)})`);
             const newMarble = Bodies.circle(startX, startY, currentMarbleRadius, {
                 restitution: 0.6, // Slightly less bouncy
                 friction: 0.1, // Slightly more friction
                 frictionAir: 0.01, // Air friction
                 label: `marble-${clientId}`,
                 render: {
                    // Use avatar if available, otherwise fallback color
                    // fillStyle: randomColor(), // Fallback color - useful for debugging missing avatars
                    sprite: {
                         texture: peerData.avatarUrl || createPlaceholderTexture(randomColor()), // Use placeholder if no avatar
                         xScale: (currentMarbleRadius * 2) / 50, // Assume avatar is 50x50
                         yScale: (currentMarbleRadius * 2) / 50
                    }
                 }
             });
             // Make marbles static initially OR if game hasn't started during an update
             Body.setStatic(newMarble, !gameStarted);

             World.add(world, newMarble);
             marbles[clientId] = newMarble; // Store the body directly

             // --- Create label element ---
             const labelElement = document.createElement('div');
             labelElement.classList.add('marble-label');
             labelElement.textContent = peerData.username;
             document.body.appendChild(labelElement);
             labels[clientId] = labelElement;

        } else if (!gameStarted) {
             // --- Update position ONLY if game hasn't started ---
             console.log(`Updating position for ${peerData.username} (${clientId}) to (${startX.toFixed(2)}, ${startY.toFixed(2)}) because game hasn't started`);
             const marbleBody = marbles[clientId];
             Body.setStatic(marbleBody, true); // Ensure static before moving
             Body.setPosition(marbleBody, { x: startX, y: startY });
             Body.setVelocity(marbleBody, { x: 0, y: 0 }); // Reset velocity
             Body.setAngle(marbleBody, 0); // Reset angle
             Body.setAngularVelocity(marbleBody, 0);
             // Ensure it stays static if game isn't started
             Body.setStatic(marbleBody, true);
        } else {
            // Game has started, ensure marble is not static (might have been set static briefly during a join/update)
             const marbleBody = marbles[clientId];
             if(marbleBody.isStatic) {
                console.log(`Ensuring marble for ${peerData.username} (${clientId}) is not static as game has started.`);
                Body.setStatic(marbleBody, false);
             }
        }

         // Ensure the label text is up-to-date (handles username changes)
         if (labels[clientId] && labels[clientId].textContent !== peerData.username) {
             labels[clientId].textContent = peerData.username;
         }
         // Ensure avatar is up-to-date (handles avatar changes)
         if(marbles[clientId] && marbles[clientId].render.sprite) {
             const expectedTexture = peerData.avatarUrl || createPlaceholderTexture(marbles[clientId].render.fillStyle); // Use existing color if no avatar now
             if (marbles[clientId].render.sprite.texture !== expectedTexture) {
                 marbles[clientId].render.sprite.texture = expectedTexture;
             }
         }

    });

    // Remove marbles for disconnected clients
    existingMarbleClients.forEach(clientId => {
        if (!currentClients.includes(clientId)) {
            console.log(`Removing marble for disconnected client: ${clientId}`);
            if (marbles[clientId]) {
                World.remove(world, marbles[clientId]);
                delete marbles[clientId];
            }
            if (labels[clientId]) {
                labels[clientId].remove();
                delete labels[clientId];
            }
        }
    });
}

// Update label positions based on marble physics bodies
function updateLabels() {
    const canvasRect = canvas.getBoundingClientRect();

    Object.entries(labels).forEach(([clientId, labelElement]) => {
        const marbleBody = marbles[clientId];
        if (marbleBody && labelElement) {
            const pos = marbleBody.position;
            const currentMarbleRadius = typeof marbleRadius !== 'undefined' ? marbleRadius : 15;
            const currentWorldBounds = typeof worldBounds !== 'undefined' ? worldBounds : { minX: 0, minY: 0, maxX: 800, maxY: 600 };


            // Clamp position within canvas bounds for label positioning
            const clampedX = Math.max(currentWorldBounds.minX + currentMarbleRadius, Math.min(pos.x, currentWorldBounds.maxX - currentMarbleRadius));
            const clampedY = Math.max(currentWorldBounds.minY + currentMarbleRadius, Math.min(pos.y, currentWorldBounds.maxY - currentMarbleRadius));

            // Convert world coordinates to screen coordinates relative to the viewport
            const screenX = clampedX + canvasRect.left;
            const screenY = clampedY + canvasRect.top;

            labelElement.style.left = `${screenX}px`;
            // Adjust vertical offset to be above the marble based on its radius
            labelElement.style.top = `${screenY - currentMarbleRadius - 5}px`; // 5px gap above marble
            labelElement.style.display = 'block'; // Make sure it's visible
        } else if (labelElement) {
             // Hide or remove label if marble body is missing
             console.log(`Hiding label for ${clientId} as marble body is missing.`);
             labelElement.style.display = 'none';
             // Optionally remove it completely after a delay or if it persists
             // labelElement.remove();
             // delete labels[clientId];
        }
    });
}

// --- Game Logic ---

// Check for winner
Events.on(engine, 'afterUpdate', () => {
    // Update label positions continuously
    updateLabels(); // Update labels every frame

    // Only check for winner if game is running and no winner yet declared in roomState
    if (!gameStarted || room.roomState.winner) return;

    let winnerFound = false; // Flag to ensure only the first finisher wins per frame check
    Object.entries(marbles).forEach(([clientId, marbleBody]) => {
        // Check if already found winner in this frame or if marbleBody is invalid
        if (winnerFound || !marbleBody || !marbleBody.position) return;

        const currentFinishLineY = typeof finishLineY !== 'undefined' ? finishLineY : 550;

        if (marbleBody.position.y > currentFinishLineY) {
            // Check if this client hasn't already finished and if no winner is set
            if (!room.roomState.winner) {
                 console.log(`${clientId} crossed the finish line! Position Y: ${marbleBody.position.y}`);
                 winnerFound = true; // Set flag
                 if (isHost()) { // Only host declares the winner
                     console.log("Host is declaring winner:", clientId);
                     room.updateRoomState({
                         winner: { clientId: clientId }
                         // Keep gameStarted: true until reset
                     });
                     // Immediately call displayWinner locally for the host for responsiveness
                     // Need to check if winnerInfo structure is okay for displayWinner
                     displayWinner({ clientId: clientId });
                 }
                 // No need to return here, let flag handle it.
            }
        }
    });

});

// Allow host to start the game by clicking anywhere
document.body.addEventListener('click', () => {
    console.log(`Click detected. gameStarted: ${gameStarted}, isHost: ${isHost()}, roomState.gameStarted: ${room.roomState.gameStarted}`);
    // Check room state as well to prevent starting if already started by another client quickly
    if (!gameStarted && isHost() && !room.roomState.gameStarted) {
        console.log("Host is starting the game via click.");
        // Set gameStarted immediately for host responsiveness, roomState will confirm for others
        // gameStarted = true; // Let checkGameState handle setting this based on roomState update
        room.updateRoomState({ gameStarted: true });
    }
});


// Helper function for random color (fallback)
function randomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

// Creates a simple 1x1 colored pixel PNG data URL as a texture fallback
function createPlaceholderTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    return canvas.toDataURL();
}


// --- Start Initialization ---
initializeWebsim();