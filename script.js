import Matter from 'matter-js';

const { Engine, Render, Runner, World, Bodies, Body, Events, Composite } = Matter;

const canvas = document.getElementById('gameCanvas');
const loadingDiv = document.getElementById('loading');
const instructionsDiv = document.getElementById('instructions');
const winnerBanner = document.getElementById('winner-banner');

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

const room = new WebsimSocket();
let gameStarted = false;
let marbles = {}; // Store marble bodies and labels, keyed by clientId
let labels = {}; // Store label elements keyed by clientId

// --- Game Setup ---

const trackWidth = 600;
const trackHeight = 500;
const wallThickness = 20;
const marbleRadius = 15;
const startAreaHeight = 100;
const finishLineY = 550; // Y-coordinate of the finish line

// Walls
const walls = [
  Bodies.rectangle(400, 50, trackWidth + wallThickness * 2, wallThickness, { isStatic: true, label: 'wall' }), // Top wall/gate
  Bodies.rectangle(100 - wallThickness / 2, 300, wallThickness, trackHeight + startAreaHeight, { isStatic: true, label: 'wall' }), // Left wall
  Bodies.rectangle(700 + wallThickness / 2, 300, wallThickness, trackHeight + startAreaHeight, { isStatic: true, label: 'wall' }), // Right wall
  Bodies.rectangle(400, 600 + wallThickness / 2, trackWidth + wallThickness * 2, wallThickness, { isStatic: true, label: 'wall' }) // Bottom wall
];
World.add(world, walls);

// Obstacles (Example: add some static rectangles)
const obstacles = [
  Bodies.rectangle(400, 250, 300, 20, { isStatic: true, angle: Math.PI / 12, label: 'obstacle', render: { fillStyle: '#8b4513' } }),
  Bodies.rectangle(250, 350, 200, 20, { isStatic: true, angle: -Math.PI / 10, label: 'obstacle', render: { fillStyle: '#8b4513' } }),
  Bodies.rectangle(550, 450, 200, 20, { isStatic: true, angle: Math.PI / 8, label: 'obstacle', render: { fillStyle: '#8b4513' } }),
  // Funnel
  Bodies.rectangle(300, 500, 20, 100, { isStatic: true, angle: -Math.PI / 6, label: 'obstacle', render: { fillStyle: '#8b4513' } }),
  Bodies.rectangle(500, 500, 20, 100, { isStatic: true, angle: Math.PI / 6, label: 'obstacle', render: { fillStyle: '#8b4513' } })
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

await room.initialize();
loadingDiv.style.display = 'none';
instructionsDiv.style.display = 'block';

room.subscribePresence((currentPresence) => {
  updateMarbles(currentPresence);
  updateLabels(); // Ensure labels are updated when presence changes
});

room.subscribeRoomState((currentRoomState) => {
    if (currentRoomState.gameStarted && !gameStarted) {
        startGame();
    }
    if (currentRoomState.winner && !winnerBanner.textContent) {
        displayWinner(currentRoomState.winner);
    }
     if (currentRoomState.reset && gameStarted) {
        resetGameLocal(); // If a reset is triggered
    }
});

// Only the "host" (first player to join) can start the game
const isHost = () => {
    if (!room.peers || Object.keys(room.peers).length === 0) return false;
    const sortedPeerIds = Object.keys(room.peers).sort();
    return room.clientId === sortedPeerIds[0];
};

function startGame() {
    if (gameStarted) return;
    gameStarted = true;
    instructionsDiv.style.display = 'none';
    engine.gravity.y = 1; // Apply gravity
    // Remove the top wall/gate
    const topWall = walls[0];
    World.remove(world, topWall);

    console.log("Game Started!");
}

function displayWinner(winnerInfo) {
    const winnerName = room.peers[winnerInfo.clientId]?.username || 'Someone';
    winnerBanner.textContent = `${winnerName} wins!`;
    winnerBanner.style.display = 'block';
    engine.gravity.y = 0; // Stop gravity
    // Stop all marble movement
    Object.values(marbles).forEach(data => {
        if (data.body) {
             Body.setVelocity(data.body, { x: 0, y: 0 });
             Body.setAngularVelocity(data.body, 0);
             Body.setStatic(data.body, true); // Make marbles static
        }
    });

    // Add a reset button (or automatically reset after a delay)
    setTimeout(() => {
         if (isHost()) {
             room.updateRoomState({ winner: null, reset: true }); // Signal reset
         }
     }, 5000); // Reset after 5 seconds
}

function resetGameLocal() {
    console.log("Resetting game locally");
    // Remove existing marbles and labels
    Object.values(marbles).forEach(data => {
        if (data.body) World.remove(world, data.body);
        if (data.labelElement) data.labelElement.remove();
    });
    marbles = {};
    labels = {};

    // Re-add the top wall if it was removed
    if (!Composite.get(world, walls[0].id, 'body')) {
        World.add(world, walls[0]);
    }

    // Reset game state variables
    gameStarted = false;
    winnerBanner.style.display = 'none';
    winnerBanner.textContent = '';
    engine.gravity.y = 0; // Reset gravity


    // Re-add marbles based on current presence
    updateMarbles(room.presence);
     updateLabels();

    // Allow starting again
    instructionsDiv.style.display = 'block';
    room.updateRoomState({ reset: null }); // Clear reset flag
}


// Function to create or update marble visuals and physics bodies
function updateMarbles(presence) {
    const currentClients = Object.keys(presence);
    const existingMarbleClients = Object.keys(marbles);

    // Add/Update marbles for current clients
    currentClients.forEach((clientId, index) => {
        const peerData = room.peers[clientId];
        if (!peerData) return; // Skip if peer data isn't available yet

        const startX = 100 + wallThickness + (trackWidth - wallThickness * 2) * (index + 1) / (currentClients.length + 1);
        const startY = 50 + startAreaHeight / 2 - marbleRadius; // Position above the floor of the start area


        if (!marbles[clientId]) {
            // Create new marble
            const color = randomColor(); // Assign a random color
             const newMarble = Bodies.circle(startX, startY, marbleRadius, {
                 restitution: 0.8,
                 friction: 0.05,
                 label: `marble-${clientId}`,
                 render: {
                    //  fillStyle: color // Matter.js color
                    sprite: {
                         texture: peerData.avatarUrl,
                         xScale: (marbleRadius * 2) / 50, // Assuming avatar is 50x50
                         yScale: (marbleRadius * 2) / 50
                    }
                 }
             });
             // Make marbles static initially if game hasn't started
             if (!gameStarted) {
                Body.setStatic(newMarble, true);
             }

             World.add(world, newMarble);

             // Create label element
             const labelElement = document.createElement('div');
             labelElement.classList.add('marble-label');
             labelElement.textContent = peerData.username;
             document.body.appendChild(labelElement);

             marbles[clientId] = { body: newMarble, color: color, labelElement: labelElement };

        } else if (!gameStarted) {
             // Update position if game hasn't started (e.g., if players join late)
             Body.setPosition(marbles[clientId].body, { x: startX, y: startY });
             Body.setVelocity(marbles[clientId].body, { x: 0, y: 0 }); // Reset velocity
             Body.setAngle(marbles[clientId].body, 0); // Reset angle
             Body.setStatic(marbles[clientId].body, true); // Ensure static before start
        }

         // Ensure the label text is up-to-date
         if (marbles[clientId].labelElement.textContent !== peerData.username) {
             marbles[clientId].labelElement.textContent = peerData.username;
         }
    });

    // Remove marbles for disconnected clients
    existingMarbleClients.forEach(clientId => {
        if (!currentClients.includes(clientId)) {
            if (marbles[clientId]) {
                World.remove(world, marbles[clientId].body);
                if (marbles[clientId].labelElement) {
                    marbles[clientId].labelElement.remove();
                }
                delete marbles[clientId];
            }
        }
    });
}

// Update label positions based on marble physics bodies
function updateLabels() {
    Object.entries(marbles).forEach(([clientId, data]) => {
        if (data.body && data.labelElement) {
            const pos = data.body.position;
            // Convert world coordinates to screen coordinates (assuming 1:1 mapping for now)
            // Adjust based on canvas position if necessary
            const canvasRect = canvas.getBoundingClientRect();
            const screenX = pos.x + canvasRect.left;
            const screenY = pos.y + canvasRect.top;

            data.labelElement.style.left = `${screenX}px`;
            data.labelElement.style.top = `${screenY}px`; // Adjust vertical offset as needed
        }
    });
}

// --- Game Logic ---

// Check for winner
Events.on(engine, 'afterUpdate', () => {
    if (!gameStarted || room.roomState.winner) return; // Only check if game is running and no winner yet

    Object.entries(marbles).forEach(([clientId, data]) => {
        if (data.body.position.y > finishLineY) {
            // Check if this client hasn't already finished
            if (!room.roomState.winner) {
                 console.log(`${clientId} crossed the finish line!`);
                 if (isHost()) { // Only host declares the winner
                     room.updateRoomState({
                         winner: { clientId: clientId }
                     });
                 }
            }
        }
    });

    // Update label positions continuously
    updateLabels();
});

// Allow host to start the game by clicking
canvas.addEventListener('click', () => {
    if (!gameStarted && isHost()) {
        room.updateRoomState({ gameStarted: true });
        // startGame(); // Let roomState subscription handle the actual start
    }
});


// Helper function for random color
function randomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

// Initial setup
updateMarbles(room.presence);
updateLabels();
``````index.html
<!DOCTYPE html>
<html>
<head>
<title>Realtime Marbles</title>
<link rel="stylesheet" href="style.css">
<script src="https://cdn.jsdelivr.net/npm/matter-js@0.19.0/build/matter.min.js"></script>
</head>
<body>
  <div id="loading">Loading...</div>
  <div id="instructions" style="display: none;">Waiting for players... The first player to join clicks to start the race!</div>
  <div id="winner-banner" style="display: none;"></div>
  <canvas id="gameCanvas"></canvas>
  <script type="importmap">
    {
      "imports": {
        "matter-js": "https://cdn.jsdelivr.net/npm/matter-js@0.19.0/build/matter.min.js"
      }
    }
  </script>
  <script src="script.js" type="module"></script>
</body>
</html>

import Matter from 'matter-js';

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
         resetGameLocal();
     }

     // Handle winner display
     if (state.winner && !winnerBanner.textContent) {
         displayWinner(state.winner);
     } else if (!state.winner && winnerBanner.textContent) {
         // Winner cleared, likely due to reset
         winnerBanner.style.display = 'none';
         winnerBanner.textContent = '';
     }

     // Handle explicit reset signal
     if (state.reset && gameStarted) {
         console.log("Reset signal received.");
         resetGameLocal(); // If a reset is triggered
         if (isHost()) {
            // Host clears the reset flag after processing
            room.updateRoomState({ reset: null });
         }
     }
}


// Only the "host" (first player to join) can start the game and declare winner/reset
const isHost = () => {
    if (!room.peers || Object.keys(room.peers).length === 0) return false;
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
    // Prevent displaying winner multiple times or if game already reset
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
         if (isHost() && room.roomState.winner) { // Check if still in winner state before resetting
             console.log("Host triggering reset.");
             room.updateRoomState({ winner: null, gameStarted: false, reset: true });
         }
     }, 5000); // Reset after 5 seconds
}

function resetGameLocal() {
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
        const gate = walls[0]; // Assuming walls[0] is the gate definition
        World.add(world, gate);
     }


    // Reset game state variables
    gameStarted = false;
    winnerBanner.style.display = 'none';
    winnerBanner.textContent = '';
    engine.gravity.y = 0; // Reset gravity
    engine.timing.timeScale = 1; // Reset physics speed

    // Re-create marbles based on current presence
    updateMarbles(room.presence);
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

    // Add/Update marbles for current clients
    currentClients.forEach((clientId, index) => {
        const peerData = room.peers[clientId];
        if (!peerData) {
            console.warn(`Peer data not found for clientId: ${clientId}`);
            return; // Skip if peer data isn't available yet
        }

        // Calculate start position dynamically based on number of players
        const spacing = (trackWidth - wallThickness * 2 - marbleRadius * 2) / Math.max(1, numPlayers); // Avoid division by zero
        const startX = 100 + wallThickness + marbleRadius + spacing * index + spacing / 2;
        const startY = 50 + startAreaHeight / 2 - marbleRadius - 10; // Slightly higher start


        if (!marbles[clientId]) {
            // --- Create new marble ---
            console.log(`Creating marble for ${peerData.username} (${clientId})`);
             const newMarble = Bodies.circle(startX, startY, marbleRadius, {
                 restitution: 0.6, // Slightly less bouncy
                 friction: 0.1, // Slightly more friction
                 frictionAir: 0.01, // Air friction
                 label: `marble-${clientId}`,
                 render: {
                    // Use avatar if available, otherwise fallback color
                    // fillStyle: randomColor(), // Fallback color
                    sprite: {
                         texture: peerData.avatarUrl || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', // Use transparent pixel if no avatar
                         xScale: peerData.avatarUrl ? (marbleRadius * 2) / 50 : 1, // Assume avatar is 50x50
                         yScale: peerData.avatarUrl ? (marbleRadius * 2) / 50 : 1
                    }
                 }
             });
             // Make marbles static initially
             Body.setStatic(newMarble, true);

             World.add(world, newMarble);
             marbles[clientId] = newMarble; // Store the body directly

             // --- Create label element ---
             const labelElement = document.createElement('div');
             labelElement.classList.add('marble-label');
             labelElement.textContent = peerData.username;
             document.body.appendChild(labelElement);
             labels[clientId] = labelElement;

        } else if (!gameStarted) {
             // --- Update position if game hasn't started ---
             const marbleBody = marbles[clientId];
             Body.setStatic(marbleBody, true); // Ensure static before moving
             Body.setPosition(marbleBody, { x: startX, y: startY });
             Body.setVelocity(marbleBody, { x: 0, y: 0 }); // Reset velocity
             Body.setAngle(marbleBody, 0); // Reset angle
             Body.setAngularVelocity(marbleBody, 0);
        }

         // Ensure the label text is up-to-date (handles username changes)
         if (labels[clientId] && labels[clientId].textContent !== peerData.username) {
             labels[clientId].textContent = peerData.username;
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

            // Clamp position within canvas bounds for label positioning
            const clampedX = Math.max(worldBounds.minX + marbleRadius, Math.min(pos.x, worldBounds.maxX - marbleRadius));
            const clampedY = Math.max(worldBounds.minY + marbleRadius, Math.min(pos.y, worldBounds.maxY - marbleRadius));

            // Convert world coordinates to screen coordinates relative to the viewport
            const screenX = clampedX + canvasRect.left;
            const screenY = clampedY + canvasRect.top;

            labelElement.style.left = `${screenX}px`;
            labelElement.style.top = `${screenY}px`;
        } else if (!marbleBody && labelElement) {
             // Remove label if marble body is missing (e.g., during cleanup race condition)
             labelElement.remove();
             delete labels[clientId];
        }
    });
}

// --- Game Logic ---

// Check for winner
Events.on(engine, 'afterUpdate', () => {
    // Only check if game is running and no winner yet declared in roomState
    if (!gameStarted || room.roomState.winner) return;

    Object.entries(marbles).forEach(([clientId, marbleBody]) => {
        if (marbleBody.position.y > finishLineY) {
            // Check if this client hasn't already finished and if no winner is set
            // We rely on isHost check before sending update to prevent race conditions
            if (!room.roomState.winner) {
                 console.log(`${clientId} crossed the finish line!`);
                 if (isHost()) { // Only host declares the winner
                     console.log("Host is declaring winner:", clientId);
                     room.updateRoomState({
                         winner: { clientId: clientId }
                         // Keep gameStarted: true until reset
                     });
                     // Immediately call displayWinner locally for the host for responsiveness
                     displayWinner({ clientId: clientId });
                 }
                 // Break loop after first finisher detected to avoid multiple winners in same frame
                 return;
            }
        }
    });

    // Update label positions continuously
    updateLabels();
});

// Allow host to start the game by clicking anywhere
document.body.addEventListener('click', () => {
    console.log(`Click detected. gameStarted: ${gameStarted}, isHost: ${isHost()}`);
    // Check room state as well to prevent starting if already started by another client quickly
    if (!gameStarted && isHost() && !room.roomState.gameStarted) {
        console.log("Host is starting the game via click.");
        room.updateRoomState({ gameStarted: true });
        // startGame(); // Let roomState subscription handle the actual start
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

// --- Start Initialization ---
initializeWebsim();

