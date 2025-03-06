// Charger les variables d'environnement
require('dotenv').config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { PeerServer } = require('peer');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

// Configuration des ports
const PORT = process.env.PORT || 3000;
const PEER_PORT = process.env.PEER_PORT || 9000;
const isProd = process.env.NODE_ENV === 'production';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Configuration du serveur PeerJS
// En local, on veut un serveur PeerJS séparé sur le port 9000
// En production sur Render, on veut utiliser le même port que l'application

// Si nous sommes en production (sur Render par exemple)
if (isProd) {
  // Intégrer PeerServer dans l'application Express existante
  app.use('/peerjs', require('peer').ExpressPeerServer(server, {
    path: '/myapp',
    proxied: true,
    debug: true
  }));
  console.log("PeerServer intégré au serveur Express en mode production");
} else {
  // En local, exécuter PeerServer sur un port séparé
  const peerServer = PeerServer({
    port: PEER_PORT,
    path: '/myapp',
    proxied: false
  });
  
  // Logging pour debug
  peerServer.on('connection', (client) => {
    console.log('Nouvelle connexion PeerJS en local:', client.id);
  });
  
  peerServer.on('error', (error) => {
    console.error('Erreur PeerServer en local:', error);
  });
  
  console.log(`PeerServer indépendant démarré sur le port ${PEER_PORT}`);
}

app.use(express.static(path.join(__dirname, "public")));

const rooms = {};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRoomCode() {
  return uuidv4().slice(0, 6).toUpperCase();
}

function generatePrompt() {
  const prompts = [
    "ar", "be", "co", "in", "ex", "re", "st", "un", "de", "ab",
    "ad", "an", "as", "at", "if", "of", "on", "or", "to", "up",
    "ly", "ed", "en", "ic", "al", "er", "nt", "ma", "pa", "si",
    "li", "go", "lo", "me", "by", "id", "am", "it", "ox", "pi",
    "ce", "ra", "ch", "pr", "di", "fi", "nu", "vi", "ta", "mi"
  ];
  return prompts[Math.floor(Math.random() * prompts.length)];
}


async function validateWord(word, prompt, usedWords) {
  const lower = word.toLowerCase().trim();
  const lowerPrompt = prompt.toLowerCase();

  if (lower === lowerPrompt) {
    return { success: false, message: "Word cannot be exactly the prompt." };
  }

  if (!lower.includes(lowerPrompt)) {
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

server.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});

// Fonction de sécurité pour traiter les roomIds
function safeRoomId(roomId, eventName) {
  if (!roomId) {
    console.log(`${eventName}: appelé avec un roomId null ou undefined`);
    return null;
  }
  return String(roomId).toUpperCase();
}

io.on("connection", (socket) => {
  console.log("Nouveau client connecté:", socket.id);
  console.log("Salles actuelles:", Object.keys(rooms));

  socket.on("createRoom", ({ hostName, lives, peerId }, cb) => {
    console.log(`Tentative de création de salle par ${hostName} avec peerId ${peerId}`);
    const numLives = parseInt(lives) || 3;

    const roomId = generateRoomCode();
    console.log(`Code de salle généré: ${roomId}`);
    
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
          isAlive: true,
          peerId: peerId,
          wins: 0
        }
      ],
      status: "lobby",
      currentPrompt: "",
      currentPlayerIndex: 0,
      bombTimer: null,
      usedWords: new Set()
    };

    console.log(`Salle ${roomId} ajoutée à la liste des salles. Total: ${Object.keys(rooms).length}`);
    socket.join(roomId);
    console.log(`Salle ${roomId} créée par ${hostName} avec peerId ${peerId}`);
    cb({ success: true, roomId });
    io.to(roomId).emit("playerListUpdate", { players: rooms[roomId].players });
  });

  socket.on("joinRoom", ({ roomId, playerName, peerId }, cb) => {
    const safeId = safeRoomId(roomId, "joinRoom");
    if (!safeId) {
      console.log("Tentative de rejoindre une salle avec un roomId invalide:", roomId);
      cb({ success: false, message: "ID de salle invalide." });
      return;
    }
    
    console.log(`Tentative de connexion à la salle ${safeId} par ${playerName} avec peerId ${peerId}`);
    console.log(`Salles existantes: ${Object.keys(rooms).join(', ')}`);
    
    const room = rooms[safeId];
    if (!room) {
      console.log(`Salle ${safeId} non trouvée`);
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
      peerId: peerId,
      wins: 0
    });
    socket.join(safeId);
    console.log(`${name} joined room ${safeId}`);
    cb({ success: true });
    io.to(safeId).emit("playerListUpdate", { players: room.players });
  });

  socket.on("startGame", (roomId) => {
    const safeId = safeRoomId(roomId, "startGame");
    if (!safeId) return;
    
    const room = rooms[safeId];
    if (!room || room.status !== "lobby") return;

    if (room.players.length < 2) {
      socket.emit("gameError", { message: "Il faut au moins 2 joueurs pour commencer la partie." });
      return;
    }

    room.status = "playing";
    room.currentPrompt = generatePrompt();
    room.currentPlayerIndex = 0;
    room.usedWords.clear();

    io.to(safeId).emit("gameStarted", {
      prompt: room.currentPrompt,
      currentPlayerId: room.players[0].id
    });

    startTurn(safeId);
  });

  socket.on("submitWord", async ({ roomId, word }) => {
    const safeId = safeRoomId(roomId, "submitWord");
    if (!safeId) return;
    
    const room = rooms[safeId];
    if (!room || room.status !== "playing") return;

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.id !== socket.id) {
      return; 
    }

    const result = await validateWord(word, room.currentPrompt, room.usedWords);
    if (result.success) {
      room.usedWords.add(word.toLowerCase());
      clearTimeout(room.bombTimer);
      io.to(safeId).emit("wordAccepted", { playerId: socket.id, word });
      moveToNextTurn(safeId);
    } else {
      socket.emit("wordInvalid", { reason: result.message });
    }
  });

  socket.on("getPlayerList", (roomId) => {
    const safeId = safeRoomId(roomId, "getPlayerList");
    if (!safeId) {
      console.log("getPlayerList appelé avec un roomId invalide:", roomId);
      return;
    }
    
    console.log(`getPlayerList: Demande de la liste des joueurs pour la salle ${safeId}`);
    console.log(`Salles disponibles: ${Object.keys(rooms).join(', ')}`);
    
    const room = rooms[safeId];
    if (room) {
      console.log(`getPlayerList: Envoi de la liste des joueurs pour la salle ${safeId}:`, room.players.map(p => p.name));
      socket.emit("playerListUpdate", { players: room.players });
    } else {
      console.log(`getPlayerList: Salle ${safeId} non trouvée`);
    }
  });

  socket.on("restartGame", ({ roomId, lives }) => {
    const safeId = safeRoomId(roomId, "restartGame");
    if (!safeId) {
      console.log("restartGame avec un ID de salle invalide");
      return;
    }
    
    const room = rooms[safeId];
    if (!room) {
      console.log(`restartGame: salle ${safeId} introuvable`);
      return;
    }
    
    // Vérifier si la personne qui demande le restart est l'hôte
    const player = room.players.find(p => p.id === socket.id);
    console.log("Joueur qui demande le redémarrage:", player?.name);
    console.log("Hôte de la salle:", room.settings.hostName);
    
    const isHost = player && player.name === room.settings.hostName;
    console.log("Est-ce l'hôte:", isHost);
    
    if (!isHost) {
      console.log("Redémarrage refusé: ce n'est pas l'hôte qui demande");
      socket.emit("gameError", { message: "Seul l'hôte peut redémarrer la partie" });
      return;
    }
    
    console.log("Redémarrage de la partie accepté");
    
    // Mettre à jour le nombre de vies si spécifié
    if (lives) {
      let numLives = parseInt(lives) || 3;
      if (numLives < 1) numLives = 1;
      if (numLives > 5) numLives = 5;
      room.settings.lives = numLives;
    }
    
    // Réinitialiser les vies des joueurs
    room.players.forEach(p => {
      p.lives = room.settings.lives;
      p.isAlive = true;
    });
    
    room.status = "playing";
    room.currentPrompt = generatePrompt();
    room.currentPlayerIndex = 0; 
    room.usedWords.clear();
    
    // Informer les clients
    io.to(safeId).emit("gameRestarted", {
      livesPerPlayer: room.settings.lives,
      prompt: room.currentPrompt,
      currentPlayerId: room.players[0].id,
      players: room.players
    });
    
    startTurn(safeId);
  });

  socket.on("leaveRoom", (roomId) => {
    const safeId = safeRoomId(roomId, "leaveRoom");
    if (!safeId) return;
    
    const room = rooms[safeId];
    if (!room) return;
    
    // Trouver et retirer le joueur de la salle
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return;
    
    console.log(`Joueur ${socket.id} quitte la salle ${safeId}`);
    socket.leave(safeId);
    room.players.splice(playerIndex, 1);
    
    // Envoyer la mise à jour de la liste des joueurs aux autres joueurs
    io.to(safeId).emit("playerListUpdate", { players: room.players });
    
    // Si la salle est vide, la supprimer
    if (room.players.length === 0) {
      delete rooms[safeId];
      console.log(`Salle ${safeId} supprimée (plus de joueurs)`);
    } else {
      // Si le jeu est en cours, vérifier s'il doit être arrêté
      if (room.status === "playing") {
        checkForGameOver(safeId);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("Client déconnecté:", socket.id);
    
    // Parcourir toutes les salles pour trouver et retirer le joueur déconnecté
    for (const [rid, room] of Object.entries(rooms)) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        console.log(`Joueur ${socket.id} retiré de la salle ${rid} suite à la déconnexion`);
        room.players.splice(idx, 1);
        io.to(rid).emit("playerListUpdate", { players: room.players });
        
        if (room.players.length === 0) {
          delete rooms[rid];
          console.log(`Salle ${rid} supprimée (plus de joueurs après déconnexion)`);
        } else if (room.status === "playing") {
          // Utiliser une version sécurisée pour checkForGameOver
          const safeRid = safeRoomId(rid, "disconnect->checkForGameOver");
          if (safeRid) {
            checkForGameOver(safeRid);
          }
        }
        break;
      }
    }
  });

  function startTurn(roomId) {
    const safeId = safeRoomId(roomId, "startTurn");
    if (!safeId) return;
    
    const room = rooms[safeId];
    if (!room) return;

    if (checkForGameOver(safeId)) return;

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (!currentPlayer.isAlive) {
      moveToNextTurn(safeId);
      return;
    }

    const bombTime = randomInt(room.settings.minBombTime, room.settings.maxBombTime);
    io.to(safeId).emit("turnStarted", {
      currentPlayerId: currentPlayer.id,
      prompt: room.currentPrompt,
      bombTime: bombTime
    });

    room.bombTimer = setTimeout(() => {
      currentPlayer.lives -= 1;
      
      io.to(safeId).emit("bombExploded", {
        playerId: currentPlayer.id,
        remainingLives: currentPlayer.lives
      });
      
      if (currentPlayer.lives <= 0) {
        currentPlayer.isAlive = false;
        console.log(`[playerEliminated] Player ${currentPlayer.name} eliminated, remaining lives: ${currentPlayer.lives}, isAlive: ${currentPlayer.isAlive}`);
        
        // On vérifie d'abord si le jeu est terminé
        const isGameOver = checkForGameOver(safeId);
        
        setTimeout(() => {
          io.to(safeId).emit("playerEliminated", { playerId: currentPlayer.id });
          io.to(safeId).emit("playerListUpdate", { players: room.players });
          
          // Si le jeu n'est pas terminé, on passe au tour suivant
          if (!isGameOver) {
            moveToNextTurn(safeId);
          }
        }, 500);
      } else {
        io.to(safeId).emit("playerListUpdate", { players: room.players });
        moveToNextTurn(safeId);
      }
    }, bombTime * 1000);
  }

  function moveToNextTurn(roomId) {
    const safeId = safeRoomId(roomId, "moveToNextTurn");
    if (!safeId) return;
    
    const room = rooms[safeId];
    if (!room) return;
    clearTimeout(room.bombTimer);

    console.log(`[moveToNextTurn] Checking if game is over for room ${safeId}`);
    if (checkForGameOver(safeId)) {
      console.log(`[moveToNextTurn] Game is over, not moving to next turn`);
      return;
    }

    // Passer au joueur suivant qui est toujours en vie
    let nextPlayerIndex = room.currentPlayerIndex;
    let counter = 0;
    
    do {
      nextPlayerIndex = (nextPlayerIndex + 1) % room.players.length;
      counter++;
      
      // Éviter une boucle infinie si tous les joueurs sont éliminés
      if (counter > room.players.length) {
        console.log(`[moveToNextTurn] No alive players found after checking all players`);
        checkForGameOver(safeId);
        return;
      }
    } while (!room.players[nextPlayerIndex].isAlive);
    
    room.currentPlayerIndex = nextPlayerIndex;
    
    room.currentPrompt = generatePrompt();
    io.to(safeId).emit("nextTurn", {
      currentPlayerId: room.players[room.currentPlayerIndex].id,
      prompt: room.currentPrompt
    });
    
    startTurn(safeId);
  }

  function checkForGameOver(roomId) {
    const safeId = safeRoomId(roomId, "checkForGameOver");
    if (!safeId) return false;
    
    const room = rooms[safeId];
    if (!room) return false;
    if (room.status !== "playing") return false;

    const alivePlayers = room.players.filter(p => p.isAlive);
    console.log(`[checkForGameOver] Room: ${safeId}, Alive players: ${alivePlayers.length}`);
    console.log(`[checkForGameOver] Players status:`, room.players.map(p => `${p.name}: ${p.isAlive ? 'alive' : 'eliminated'}`));
    
    // Si un seul joueur est vivant, c'est le gagnant
    if (alivePlayers.length === 1 && room.players.length > 1) {
      const winner = alivePlayers[0];
      winner.wins += 1;
      
      const winnerName = winner.name;
      console.log(`[checkForGameOver] Game over! Winner: ${winnerName}`);
      
      room.status = "over";
      clearTimeout(room.bombTimer);
      
      // Envoyer les informations de fin de partie avec le tableau des scores
      io.to(safeId).emit("gameOver", { 
        winnerName,
        scoreboard: room.players.map(p => ({
          name: p.name,
          isAlive: p.isAlive,
          lives: p.lives,
          wins: p.wins,
          isHost: p.name === room.settings.hostName
        }))
      });
      
      return true;
    }
    
    return false;
  }
});
