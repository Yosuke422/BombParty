const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { PeerServer } = require('peer');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Configuration du serveur PeerJS
const peerServer = PeerServer({
  port: 9000,
  path: '/myapp'
});

// Logging pour debug
peerServer.on('connection', (client) => {
  console.log('Nouvelle connexion PeerJS:', client.id);
});

peerServer.on('error', (error) => {
  console.error('Erreur PeerServer:', error);
});

app.use(express.static(path.join(__dirname, "public")));

const rooms = {};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRoomCode() {
  return uuidv4().slice(0, 6).toUpperCase();
}

function generatePrompt() {
  const prompts = [ "ar", "be", "co", "ing", "pre", "tion", "que", "st", "tri", "com", "re", "str" ];
  return prompts[Math.floor(Math.random() * prompts.length)];
}

async function validateWord(word, prompt, usedWords) {
  const lower = word.toLowerCase().trim();

  if (!lower.includes(prompt.toLowerCase())) {
    return { success: false, message: "Word does not contain the prompt." };
  }
  if (usedWords.has(lower)) {
    return { success: false, message: "Word already used this round." };
  }

  try {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${lower}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      return { success: false, message: "Not a valid English word." };
    }
    const data = await resp.json();
    if (!Array.isArray(data) || !data[0]?.word) {
      return { success: false, message: "Not a valid English word." };
    }
    return { success: true, message: "Valid word." };
  } catch (err) {
    console.error("Dictionary API error:", err);
    return { success: false, message: "Dictionary API error." };
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("createRoom", (data, cb) => {
    const { hostName, lives } = data;
    let numLives = parseInt(lives) || 3;
    if (numLives < 1) numLives = 1;
    if (numLives > 5) numLives = 5;

    const roomId = generateRoomCode();
    rooms[roomId] = {
      settings: {
        hostName: hostName || "Host",
        lives: numLives,
        minBombTime: 5,
        maxBombTime: 40
      },
      players: [
        {
          id: socket.id,
          name: hostName || "Host",
          lives: numLives,
          isAlive: true
        }
      ],
      status: "lobby",
      currentPrompt: "",
      currentPlayerIndex: 0,
      bombTimer: null,
      usedWords: new Set()
    };

    socket.join(roomId);
    console.log(`Room ${roomId} created by ${hostName}`);
    cb({ success: true, roomId });
    io.to(roomId).emit("playerListUpdate", { players: rooms[roomId].players });
  });

  socket.on("joinRoom", ({ roomId, playerName, peerId }, cb) => {
    roomId = roomId.toUpperCase();
    const room = rooms[roomId];
    if (!room) {
      cb({ success: false, message: "Room not found." });
      return;
    }
    if (room.status !== "lobby") {
      cb({ success: false, message: "Game already started." });
      return;
    }
    if (room.players.length >= 4) {
      cb({ success: false, message: "Room is full (max 4 players)." });
      return;
    }
    const name = playerName.trim() || "Player";
    room.players.push({
      id: socket.id,
      name,
      lives: room.settings.lives,
      isAlive: true,
      peerId: peerId
    });
    socket.join(roomId);
    console.log(`${name} joined room ${roomId}`);
    cb({ success: true });
    io.to(roomId).emit("playerListUpdate", { players: room.players });
  });

  socket.on("startGame", (roomId) => {
    roomId = roomId.toUpperCase();
    const room = rooms[roomId];
    if (!room || room.status !== "lobby") return;

    // Vérifier qu'il y a au moins 2 joueurs
    if (room.players.length < 2) {
      socket.emit("gameError", { message: "Il faut au moins 2 joueurs pour commencer la partie." });
      return;
    }

    room.status = "playing";
    room.currentPrompt = generatePrompt();
    room.currentPlayerIndex = 0;
    room.usedWords.clear();

    io.to(roomId).emit("gameStarted", {
      prompt: room.currentPrompt,
      currentPlayerId: room.players[0].id
    });

    startTurn(roomId);
  });

  socket.on("submitWord", async ({ roomId, word }) => {
    roomId = roomId.toUpperCase();
    const room = rooms[roomId];
    if (!room || room.status !== "playing") return;

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.id !== socket.id) {
      return; 
    }

    const result = await validateWord(word, room.currentPrompt, room.usedWords);
    if (result.success) {
      room.usedWords.add(word.toLowerCase());
      clearTimeout(room.bombTimer);
      io.to(roomId).emit("wordAccepted", { playerId: socket.id, word });
      moveToNextTurn(roomId);
    } else {
      socket.emit("wordInvalid", { reason: result.message });
    }
  });

  socket.on("getPlayerList", (roomId) => {
    roomId = roomId.toUpperCase();
    const room = rooms[roomId];
    if (room) {
      socket.emit("playerListUpdate", { players: room.players });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    for (const [rid, room] of Object.entries(rooms)) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        io.to(rid).emit("playerListUpdate", { players: room.players });
        if (room.players.length === 0) {
          delete rooms[rid];
          console.log(`Room ${rid} removed (no players left).`);
        } else {
          if (room.status === "playing") {
            checkForGameOver(rid);
          }
        }
        break;
      }
    }
  });

  function startTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    checkForGameOver(roomId); 

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (!currentPlayer.isAlive) {
      moveToNextTurn(roomId);
      return;
    }

    // Augmenter le temps minimum pour mieux percevoir l'accélération
    const minTime = 10; // Au moins 10 secondes
    const maxTime = 20; // Maximum 20 secondes
    const bombTime = randomInt(minTime, maxTime);

    io.to(roomId).emit("turnStarted", {
      currentPlayerId: currentPlayer.id,
      prompt: room.currentPrompt,
      bombTime: bombTime
    });

    room.bombTimer = setTimeout(() => {
      currentPlayer.lives -= 1;
    
      if (currentPlayer.lives <= 0) {
        currentPlayer.isAlive = false;
        io.to(roomId).emit("playerEliminated", { playerId: currentPlayer.id });
      } else {
        io.to(roomId).emit("bombExploded", {
          playerId: currentPlayer.id,
          remainingLives: currentPlayer.lives
        });
      }
    
      io.to(roomId).emit("playerListUpdate", { players: room.players });
    
      moveToNextTurn(roomId);
    }, bombTime * 1000);
    
  }

  function moveToNextTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    clearTimeout(room.bombTimer);

    checkForGameOver(roomId);

    let nextIndex = (room.currentPlayerIndex + 1) % room.players.length;
    let safeCount = 0;
    while (!room.players[nextIndex].isAlive && safeCount < room.players.length) {
      nextIndex = (nextIndex + 1) % room.players.length;
      safeCount++;
    }
    room.currentPlayerIndex = nextIndex;

    room.currentPrompt = generatePrompt();
    io.to(roomId).emit("nextTurn", {
      currentPlayerId: room.players[room.currentPlayerIndex].id,
      prompt: room.currentPrompt
    });
    startTurn(roomId);
  }

  function checkForGameOver(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    if (room.status !== "playing") return;

    const alivePlayers = room.players.filter(p => p.isAlive);
    if (alivePlayers.length <= 1) {
      room.status = "lobby";
      clearTimeout(room.bombTimer);
      const winnerName = alivePlayers[0]?.name || "No Winner";
      io.to(roomId).emit("gameOver", { winnerName });
    }
  }
});
