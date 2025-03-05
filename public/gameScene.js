export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  init(data) {
    this.roomId = data.roomId;
    this.playerName = data.playerName;
    this.isHost = data.isHost;
    this.socket = this.game.socket;
    this.peer = this.game.peer;
    this.peerConnections = new Map();
    this.tickTimer = null;
    this.currentBombTime = 0;

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
          this.addChatMessage(messageData.sender, messageData.message, messageData.time);
        }
      });

      conn.on('open', () => {
        console.log('Connexion entrante ouverte');
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

    // Conteneur pour le code de la salle et bouton copier
    const roomCodeContainer = this.add.dom(this.centerX, 20).createFromHTML(`
      <div class="room-code-container">
        <span class="room-code">Code de la salle: ${this.roomId}</span>
        <button class="copy-button" title="Copier le code">📋</button>
      </div>
    `);

    // Fonctionnalité de copie
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

    // Initialiser les sons
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

    // Création du conteneur de saisie du mot
    this.wordInputContainer = this.add.dom(this.centerX, this.centerY + 120).createFromHTML(`
      <div class="word-input">
        <label>Entrez un mot contenant la syllabe</label>
        <input type="text" id="wordInput" placeholder="Tapez votre mot ici" autocomplete="off">
      </div>
    `);

    const wordInput = this.wordInputContainer.node.querySelector('#wordInput');
    
    // Gestion de l'input clavier
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

    // Activation/désactivation de l'input selon le tour
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

    // Bouton START pour l'hôte
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

    // Particules d'explosion et de confettis (configuration inchangée)
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

    // Bouton de test pour le chat P2P
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
        this.addChatMessage(messageData.sender, messageData.message, messageData.time);
        // Envoi aux pairs
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
      
      // Pour chaque joueur distant, établir une connexion si elle n'existe pas déjà
      data.players.forEach(player => {
        // On ne crée la connexion que si :
        // • Ce n'est pas nous-même
        // • Aucune connexion n'existe déjà
        // • Le joueur a un peerId
        if (
          player.id !== this.socket.id &&
          !this.peerConnections.has(player.id) &&
          player.peerId
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
                this.addChatMessage(parsedData.sender, parsedData.message, parsedData.time);
              }
            });
  
            conn.on('open', () => {
              console.log('Connexion établie avec:', player.name);
              this.peerConnections.set(player.id, conn);
              // Envoyer un message de test une fois la connexion ouverte
              const messageData = {
                type: 'chat',
                sender: this.playerName,
                message: '👋 Connecté!',
                time: new Date().toLocaleTimeString()
              };
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
      const { winnerName } = res;
      const gameOverText = this.add.text(this.centerX, this.centerY + 200, 
        `Game Over! Winner: ${winnerName}`, {
        fontSize: '28px',
        color: '#FFC600'
      }).setOrigin(0.5);

      if (this.playerName === winnerName) {
        this.confettiEmitter.setPosition(this.centerX, 0);
        this.confettiEmitter.start();
        this.time.delayedCall(3000, () => {
          this.confettiEmitter.stop();
        });
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
      let label = `${p.name}\nLives: ${p.lives}`;
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
    const obj = this.playerTextObjects.find(t => t.playerId === this.currentTurnPlayerId);
    if (!obj) {
      this.turnArrow.setVisible(false);
      return;
    }
    this.turnArrow.setPosition(obj.x - 30, obj.y);
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
}
