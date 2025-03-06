export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  init(data) {
    this.roomId = data.roomId;
    this.playerName = data.playerName;
    this.isHost = data.isHost;
    this.socket = this.game.socket
    this.peer = this.game.peer;
    this.peerConnections = new Map();
    this.tickTimer = null;
    this.currentBombTime = 0;
    this.messagesSeen = new Set(); // Pour éviter les doublons

    // Gestion des connexions entrantes (pour le host ou tous les pairs)
    this.peer.on('connection', (conn) => {
      console.log('Nouvelle connexion P2P entrante de:', conn.peer);

      // Configurer le canal de données
      conn.peerConnection.addEventListener('datachannel', (event) => {
        const channel = event.channel;
        channel.binaryType = 'arraybuffer';
      });

      conn.on('data', (data) => {
        let messageData = null;
        // Si c'est un ArrayBuffer, on le décode et parse en JSON
        if (data instanceof ArrayBuffer) {
          const decoder = new TextDecoder();
          const text = decoder.decode(data);
          try {
            messageData = JSON.parse(text);
          } catch (e) {
            console.error('Erreur de parsing (ArrayBuffer) :', e);
            return;
          }
        } else if (typeof data === 'string') {
          try {
            messageData = JSON.parse(data);
          } catch (e) {
            console.error('Erreur de parsing (string) :', e);
            return;
          }
        } else if (typeof data === 'object') {
          messageData = data;
        }
  
        console.log('Message reçu sur connexion entrante:', messageData);
        if (messageData && messageData.type === 'chat') {
          // Créer un identifiant unique pour le message
          const msgId = `${messageData.sender}-${messageData.time}-${messageData.message}`;
          
          // Vérifier si on a déjà vu ce message
          if (!this.messagesSeen.has(msgId)) {
            this.messagesSeen.add(msgId);
            this.addChatMessage(messageData.sender, messageData.message, messageData.time);
            
            // Relayer le message aux autres joueurs (pour que tout le monde le voie)
            this.relayMessageToOthers(messageData, conn.peer);
          }
        }
      });

      conn.on('open', () => {
        console.log('Connexion entrante ouverte avec peer ID:', conn.peer);
        // On stocke la connexion avec la clé correspondant au peerId distant
        this.peerConnections.set(conn.peer, conn);
      });
    });
  }

  preload() {
    this.load.audio('explosionSound', 'assets/explosion.mp3');
    this.load.audio('tickSound', 'assets/BombTick.mp3');
    this.load.image('spark', 'assets/yellow.png');
    this.load.image('confetti', 'assets/white.png');
  }

  create() {
    this.cameras.main.centerOn(400, 300);
    this.centerX = this.cameras.main.centerX;
    this.centerY = this.cameras.main.centerY;

    const roomCodeContainer = this.add.dom(this.centerX, 20).createFromHTML(`
      <div class="room-code-container">
        <span class="room-code">Code de la salle: ${this.roomId}</span>
        <button class="copy-button" title="Copier le code">📋</button>
      </div>
    `);

    const copyBtn = roomCodeContainer.node.querySelector('.copy-button');
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(this.roomId)
        .then(() => {
          copyBtn.textContent = '✓';
          setTimeout(() => {
            copyBtn.textContent = '📋';
          }, 1000);
        })
        .catch(err => console.error('Erreur lors de la copie:', err));
    };

    this.explosionSound = this.sound.add('explosionSound', { volume: 1 });
    this.tickSound = this.sound.add('tickSound', { volume: 0.5, loop: false });

    this.bombDisplay = this.add.text(this.centerX, this.centerY, "💣", { fontSize: '64px' }).setOrigin(0.5);
    this.promptText = this.add.text(this.centerX, this.centerY - 80, "Prompt: ???", {
      fontSize: '24px',
      color: '#FFC600'
    }).setOrigin(0.5);
    this.turnArrow = this.add.text(0, 0, "►", { fontSize: '24px', color: '#FF0000' });
    this.turnArrow.setVisible(false);
    this.currentWord = "";

    const wordInputContainer = this.add.dom(this.centerX, this.centerY + 120).createFromHTML(`
      <div class="word-input">
        <input type="text" id="wordInput" placeholder="Tapez votre mot ici" autocomplete="off">
      </div>
    `);

    const wordInput = wordInputContainer.node.querySelector('#wordInput');
    
    wordInput.addEventListener('keydown', (event) => {
      if (this.currentTurnPlayerId !== this.socket.id) {
        wordInput.blur(); 
        return;
      }

      if (event.key === "Enter") {
        const word = wordInput.value.trim();
        if (word.length > 0) {
          this.socket.emit("submitWord", { roomId: this.roomId, word: word });
          wordInput.value = ""; 
        }
      }
    });

    this.socket.on("turnStarted", (payload) => {
      const { currentPlayerId, prompt, bombTime } = payload;
      this.currentTurnPlayerId = currentPlayerId;
      this.promptText.setText(`Prompt: ${prompt}`);
      
      if (currentPlayerId === this.socket.id) {
        wordInput.removeAttribute('disabled');
        wordInput.focus();
        this.startTickTimer(bombTime);
      } else {
        wordInput.setAttribute('disabled', 'disabled');
        wordInput.blur();
        this.stopTickTimer();
      }
      this.updateArrowPosition();
    });

    if (this.isHost) {
      this.startBtn = this.add.text(40, 40, "[START GAME]", {
        fontSize: '16px',
        backgroundColor: '#4b53ff',
        padding: { x: 10, y: 5 },
      })
      .setInteractive()
      .on('pointerdown', () => {
        this.socket.emit("startGame", this.roomId);
      });
      this.startBtn.setTint(0x666666);
      this.startBtn.disableInteractive();
    }

    this.playerTextObjects = [];
    this.listenForSocketEvents();
    this.socket.emit("getPlayerList", this.roomId);

    this.explosionEmitter = this.add.particles(0, 0, 'spark', {
      lifespan: 800,
      speed: { min: -400, max: 400 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.6, end: 0 },
      quantity: 40,
      blendMode: 'ADD',
      gravityY: 500,
      tint: [0xFF5733, 0xFFC300, 0xFF0000],
      emitting: false
    });

    this.confettiEmitter = this.add.particles(0, 0, 'confetti', {
      lifespan: 4000,
      speed: { min: -200, max: 200 },
      angle: { min: 250, max: 290 },
      scale: { start: 0.3, end: 0.1 },
      quantity: 3,
      frequency: 30,
      gravityY: 200,
      tint: [0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF],
      emitting: false,
      rotate: { min: -180, max: 180 }
    });
    this.add.text(10, 550, "[Test P2P]", {
      fontSize: '16px',
      backgroundColor: '#4b53ff',
      padding: { x: 10, y: 5 },
    })
    .setInteractive()
    .on('pointerdown', () => {
      // Envoi d'un message de test à tous les pairs
      this.peerConnections.forEach((conn) => {
        const messageData = {
          type: 'chat',
          sender: this.playerName,
          message: `Message test de ${this.playerName} à ${new Date().toLocaleTimeString()}`,
          time: new Date().toLocaleTimeString()
        };
        conn.send(JSON.stringify(messageData));
      });
    });

    this.createChat();
  }

  createChat() {
    const chatHTML = `
      <div class="chat-container">
        <div class="chat-messages"></div>
        <div class="chat-input-container">
          <input type="text" class="chat-input" placeholder="Tapez votre message...">
        </div>
      </div>
    `;
    const gameContainer = document.getElementById('game-container');
    gameContainer.insertAdjacentHTML('beforeend', chatHTML);

    const chatInput = document.querySelector('.chat-input');
    chatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && chatInput.value.trim()) {
        const message = chatInput.value.trim();
        chatInput.value = '';
        
        const messageData = {
          type: 'chat',
          sender: this.playerName,
          message: message,
          time: new Date().toLocaleTimeString()
        };
        
        // Créer un identifiant unique pour le message
        const msgId = `${messageData.sender}-${messageData.time}-${messageData.message}`;
        this.messagesSeen.add(msgId);
        
        // Afficher le message localement
        this.addChatMessage(messageData.sender, messageData.message, messageData.time);
        
        // Envoi aux autres joueurs
        this.peerConnections.forEach((conn) => {
          if (conn.open) {
            console.log('Envoi du message à:', conn.peer);
            try {
              conn.send(JSON.stringify(messageData));
            } catch (err) {
              console.error('Erreur lors de l\'envoi du message:', err);
            }
          }
        });
      }
    });
  }

  startTickTimer(bombTime) {
    this.stopTickTimer();
    this.currentBombTime = bombTime;
    const totalTime = bombTime;
    const updateTick = () => {
      if (this.currentBombTime <= 0) {
        this.stopTickTimer();
        return;
      }
      const timeProgress = this.currentBombTime / totalTime;
      const newVolume = 0.5 + (1 - timeProgress) * 0.5;
      this.tickSound.setVolume(newVolume);
      this.tickSound.play();
      
      let nextTickDelay;
      if (timeProgress < 0.15) {
        nextTickDelay = 200;
      } else if (timeProgress < 0.3) {
        nextTickDelay = 300;
      } else if (timeProgress < 0.5) {
        nextTickDelay = 500;
      } else if (timeProgress < 0.7) {
        nextTickDelay = 750;
      } else {
        nextTickDelay = 1000;
      }
      
      this.currentBombTime--;
      if (this.currentBombTime > 0) {
        this.tickTimer = this.time.delayedCall(nextTickDelay, updateTick);
      }
    };
    updateTick();
  }

  stopTickTimer() {
    if (this.tickTimer) {
      this.tickTimer.remove();
      this.tickTimer = null;
    }
    if (this.tickSound) {
      this.tickSound.stop();
    }
  }
  
  listenForSocketEvents() {
    this.socket.on("playerListUpdate", (data) => {
      this.updatePlayerList(data.players);
      
      // Activation/désactivation du bouton START pour l'hôte
      if (this.isHost && this.startBtn) {
        if (data.players.length >= 2) {
          this.startBtn.clearTint();
          this.startBtn.setInteractive();
        } else {
          this.startBtn.setTint(0x666666);
          this.startBtn.disableInteractive();
        }
      }
      
      console.log("Liste des joueurs mise à jour:", data.players);
      
      // Établir des connexions P2P avec tous les joueurs qui ont un peerId
      data.players.forEach(player => {
        if (
          player.id !== this.socket.id && // On ne se connecte pas à soi-même
          player.peerId && // Le joueur doit avoir un peerId
          !this.peerConnections.has(player.peerId) // On n'établit pas de connexion si elle existe déjà
        ) {
          console.log("Tentative de connexion avec:", player.name, player.peerId);
          try {
            const conn = this.peer.connect(player.peerId);
            
            conn.on('data', (data) => {
              let parsedData = null;
              if (data instanceof ArrayBuffer) {
                const decoder = new TextDecoder();
                const text = decoder.decode(data);
                try {
                  parsedData = JSON.parse(text);
                } catch (e) {
                  console.error('Erreur de parsing (ArrayBuffer) :', e);
                  return;
                }
              } else if (typeof data === 'string') {
                try {
                  parsedData = JSON.parse(data);
                } catch (err) {
                  console.error('Erreur de parsing (string) :', err);
                  return;
                }
              } else if (typeof data === 'object') {
                parsedData = data;
              }

              console.log('Message reçu de', player.name, ':', parsedData);
              if (parsedData && parsedData.type === 'chat') {
                // Créer un identifiant unique pour le message
                const msgId = `${parsedData.sender}-${parsedData.time}-${parsedData.message}`;
                
                // Vérifier si on a déjà vu ce message
                if (!this.messagesSeen.has(msgId)) {
                  this.messagesSeen.add(msgId);
                  this.addChatMessage(parsedData.sender, parsedData.message, parsedData.time);
                  
                  // Relayer le message aux autres joueurs
                  this.relayMessageToOthers(parsedData, player.peerId);
                }
              }
            });

            conn.on('open', () => {
              console.log('Connexion sortante établie avec:', player.name, player.peerId);
              this.peerConnections.set(player.peerId, conn);
              
              // Envoyer un message de bienvenue
              const messageData = {
                type: 'chat',
                sender: this.playerName,
                message: '👋 Connecté!',
                time: new Date().toLocaleTimeString()
              };
              
              // Ajouter à la liste des messages vus pour éviter les duplications
              const msgId = `${messageData.sender}-${messageData.time}-${messageData.message}`;
              this.messagesSeen.add(msgId);
              
              conn.send(JSON.stringify(messageData));
            });

            conn.on('error', (err) => {
              console.error('Erreur de connexion avec', player.name, ':', err);
            });
          } catch (err) {
            console.error('Erreur lors de la création de la connexion:', err);
          }
        }
      });
    });

    this.socket.on("gameStarted", (data) => {
      this.promptText.setText(`Prompt: ${data.prompt}`);
      this.currentTurnPlayerId = data.currentPlayerId;
      this.updateArrowPosition();
    });

    this.socket.on("wordAccepted", (info) => {
      if (info.playerId === this.socket.id) {
        const input = this.wordInputContainer.node.querySelector('#wordInput');
        this.flashText(input, '#00FF00');
        this.stopTickTimer();
      }
    });

    this.socket.on("wordInvalid", (info) => {
      const input = this.wordInputContainer.node.querySelector('#wordInput');
      this.flashText(input, '#FF0000');
    });
    

    this.socket.on("nextTurn", (data) => {
      const { currentPlayerId, prompt } = data;
      this.currentTurnPlayerId = currentPlayerId;
      this.promptText.setText(`Prompt: ${prompt}`);
      this.updateArrowPosition();
    });

    this.socket.on("bombExploded", (data) => {
      this.cameras.main.shake(200, 0.03);
      this.explosionSound.play();
      this.stopTickTimer();

      const playerObj = this.playerTextObjects.find(t => t.playerId === data.playerId);
      if (playerObj) {
        this.explosionEmitter.setPosition(playerObj.x, playerObj.y);
        this.explosionEmitter.start();
        this.time.delayedCall(200, () => {
          this.explosionEmitter.stop();
        });
      }
    });

    this.socket.on("playerEliminated", (data) => {
      if (data.playerId === this.socket.id) {
        const input = this.wordInputContainer.node.querySelector('#wordInput');
        this.flashText(input, '#FF0000');
      }
    });

    this.socket.on("gameOver", (res) => {
      console.log("Event gameOver reçu:", res);
      const { winnerName, scoreboard } = res;
      
      // Affiche directement le gagnant sur l'écran (en plus du tableau des scores)
      this.gameOverText = this.add.text(this.centerX, this.centerY - 150, 
        `PARTIE TERMINÉE! Gagnant: ${winnerName}`, {
        fontSize: '28px',
        color: '#FFC600',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        padding: { x: 20, y: 10 }
      }).setOrigin(0.5);
      
      // Créer un conteneur pour les informations de fin de partie
      const gameOverContainer = document.createElement('div');
      gameOverContainer.className = 'game-over-container';
      gameOverContainer.style.position = 'absolute';
      gameOverContainer.style.top = '50%';
      gameOverContainer.style.left = '50%';
      gameOverContainer.style.transform = 'translate(-50%, -50%)';
      gameOverContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
      gameOverContainer.style.padding = '20px';
      gameOverContainer.style.borderRadius = '8px';
      gameOverContainer.style.color = 'white';
      gameOverContainer.style.textAlign = 'center';
      gameOverContainer.style.minWidth = '300px';
      gameOverContainer.style.zIndex = '1000';
      
      // Titre
      const title = document.createElement('h2');
      title.textContent = `Game Over! Winner: ${winnerName}`;
      title.style.color = '#FFC600';
      title.style.marginBottom = '20px';
      gameOverContainer.appendChild(title);
      
      // Tableau des scores
      const scoreTable = document.createElement('table');
      scoreTable.style.width = '100%';
      scoreTable.style.borderCollapse = 'collapse';
      scoreTable.style.marginBottom = '20px';
      
      // En-tête du tableau
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      ['Joueur', 'Victoires'].forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        th.style.padding = '8px';
        th.style.borderBottom = '1px solid #666';
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      scoreTable.appendChild(thead);
      
      // Corps du tableau
      const tbody = document.createElement('tbody');
      scoreboard.sort((a, b) => b.wins - a.wins).forEach(player => {
        const row = document.createElement('tr');
        
        const nameCell = document.createElement('td');
        nameCell.textContent = player.name + (player.isHost ? ' (Hôte)' : '');
        nameCell.style.padding = '8px';
        nameCell.style.borderBottom = '1px solid #444';
        row.appendChild(nameCell);
        
        const winsCell = document.createElement('td');
        winsCell.textContent = player.wins;
        winsCell.style.padding = '8px';
        winsCell.style.borderBottom = '1px solid #444';
        winsCell.style.textAlign = 'center';
        row.appendChild(winsCell);
        
        tbody.appendChild(row);
      });
      scoreTable.appendChild(tbody);
      gameOverContainer.appendChild(scoreTable);
      
      // Options de redémarrage (uniquement pour l'hôte)
      const isHost = scoreboard.find(p => p.name === this.playerName)?.isHost;
      if (isHost) {
        // Sélecteur de nombre de vies
        const livesGroup = document.createElement('div');
        livesGroup.style.marginBottom = '15px';
        
        const livesLabel = document.createElement('label');
        livesLabel.textContent = 'Nombre de vies: ';
        livesLabel.style.marginRight = '10px';
        livesGroup.appendChild(livesLabel);
        
        const livesSelect = document.createElement('select');
        livesSelect.id = 'restartLives';
        for (let i = 1; i <= 5; i++) {
          const option = document.createElement('option');
          option.value = i;
          option.textContent = i;
          livesSelect.appendChild(option);
        }
        livesSelect.value = 3; // Valeur par défaut
        livesGroup.appendChild(livesSelect);
        
        gameOverContainer.appendChild(livesGroup);
        
        // Bouton de redémarrage
        const restartBtn = document.createElement('button');
        restartBtn.textContent = 'Redémarrer la partie';
        restartBtn.style.padding = '10px 15px';
        restartBtn.style.backgroundColor = '#4b53ff';
        restartBtn.style.color = 'white';
        restartBtn.style.border = 'none';
        restartBtn.style.borderRadius = '4px';
        restartBtn.style.cursor = 'pointer';
        restartBtn.style.fontSize = '16px';
        restartBtn.onclick = () => {
          const lives = document.getElementById('restartLives').value;
          this.socket.emit('restartGame', { roomId: this.roomId, lives });
          gameOverContainer.remove();
        };
        gameOverContainer.appendChild(restartBtn);
      } else {
        // Message pour les non-hôtes
        const waitText = document.createElement('p');
        waitText.textContent = "En attente que l'hôte redémarre la partie...";
        waitText.style.fontStyle = 'italic';
        waitText.style.marginTop = '15px';
        gameOverContainer.appendChild(waitText);
      }
      
      document.body.appendChild(gameOverContainer);
      
      if (this.playerName === winnerName) {
        this.confettiEmitter.setPosition(this.centerX, 0);
        this.confettiEmitter.start();
        this.time.delayedCall(3000, () => {
          this.confettiEmitter.stop();
        });
      }
    });

    this.socket.on("gameRestarted", (data) => {
      // Supprimer le conteneur de fin de partie s'il existe encore
      const existingContainer = document.querySelector('.game-over-container');
      if (existingContainer) {
        existingContainer.remove();
      }
      
      // Supprimer le texte de fin de partie
      if (this.gameOverText) {
        this.gameOverText.destroy();
        this.gameOverText = null;
      }
      
      // Mettre à jour l'interface
      this.currentTurnPlayerId = data.currentPlayerId;
      this.promptText.setText(`Prompt: ${data.prompt}`);
      
      // Mettre à jour les joueurs
      this.updatePlayerList(data.players);
      this.updateArrowPosition();
      
      const input = document.querySelector('#wordInput');
      if (input && this.currentTurnPlayerId === this.socket.id) {
        input.removeAttribute('disabled');
        input.focus();
      }
    });

    this.socket.on("gameError", (data) => {
      const errorText = this.add.text(this.centerX, this.centerY - 150, data.message, {
        fontSize: '20px',
        color: '#FF0000',
        backgroundColor: '#000000',
        padding: { x: 10, y: 5 }
      }).setOrigin(0.5);
      this.time.delayedCall(3000, () => {
        errorText.destroy();
      });
    });
  }

  updatePlayerList(players) {
    this.playerTextObjects.forEach(obj => obj.destroy());
    this.playerTextObjects = [];

    const count = players.length;
    const radius = 200;
    const angleStep = (2 * Math.PI) / count;

    for (let i = 0; i < count; i++) {
      const p = players[i];
      const angle = angleStep * i - Math.PI / 2; 
      const px = this.centerX + radius * Math.cos(angle);
      const py = this.centerY + radius * Math.sin(angle);

      const hearts = "❤️".repeat(p.lives);
      let label = `${p.name}\n${hearts}`;
      if (!p.isAlive) {
        label += "\n(ELIM)";
      }
      const pText = this.add.text(px, py, label, {
        fontSize: '16px',
        color: '#fff',
        align: 'center'
      }).setOrigin(0.5);

      pText.playerId = p.id;  
      this.playerTextObjects.push(pText);
    }
    this.updateArrowPosition();
  }

  updateArrowPosition() {
    if (!this.currentTurnPlayerId) {
      this.turnArrow.setVisible(false);
      return;
    }
    
    const playerText = this.playerTextObjects.find(
      t => t.playerId === this.currentTurnPlayerId
    );
    
    if (!playerText) {
      this.turnArrow.setVisible(false);
      return;
    }
    
    const leftEdge = playerText.x - playerText.width / 2;
    const topEdge = playerText.y - playerText.height / 2;
    
    const arrowX = leftEdge - 20;          
    const arrowY = topEdge + 8;             
    
    this.turnArrow.setPosition(arrowX, arrowY);
    this.turnArrow.setVisible(true);
  }
  
  flashText(domElement, color) {
    const originalColor = domElement.style.color;
    this.tweens.add({
      targets: domElement,
      duration: 100,
      repeat: 2,
      yoyo: true,
      onStart: () => { domElement.style.color = color; },
      onComplete: () => { domElement.style.color = originalColor; }
    });
  }
  
  addChatMessage(sender, message, time = new Date().toLocaleTimeString()) {
    const chatMessages = document.querySelector('.chat-messages');
    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    
    // Déterminer si c'est un message de l'utilisateur actuel
    const isOwnMessage = sender === this.playerName;
    
    // Ajouter une classe supplémentaire si c'est un message de l'utilisateur actuel
    if (isOwnMessage) {
      messageElement.classList.add('own-message');
    }
    
    messageElement.innerHTML = `
      <span class="time">[${time}]</span>
      <span class="sender">${sender}:</span>
      <span class="message">${message}</span>
    `;
    
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  shutdown() {
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer) {
      chatContainer.remove();
    }
  }

  // Méthode pour relayer un message aux autres joueurs (sauf à l'expéditeur original)
  relayMessageToOthers(messageData, senderPeerId) {
    this.peerConnections.forEach((conn, peerId) => {
      if (peerId !== senderPeerId && conn.open) {
        try {
          console.log('Relais du message à:', peerId);
          conn.send(JSON.stringify(messageData));
        } catch (err) {
          console.error('Erreur lors du relais du message:', err);
        }
      }
    });
  }
}