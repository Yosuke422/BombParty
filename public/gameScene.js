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

    // Gérer les connexions entrantes
    this.peer.on('connection', (conn) => {
      console.log('Nouvelle connexion P2P entrante');
      
      conn.on('open', () => {
        console.log('Connexion entrante ouverte');
        // Stocker la connexion
        this.peerConnections.set(conn.peer, conn);
      });
      
      conn.on('data', (data) => {
        console.log('Données P2P reçues:', data);
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

    // Initialiser les sons UNE SEULE FOIS
    this.explosionSound = this.sound.add('explosionSound', {
      volume: 1
    });

    this.tickSound = this.sound.add('tickSound', {
      volume: 0.5,
      loop: false
    });

    this.bombDisplay = this.add.text(this.centerX, this.centerY, "💣", {
      fontSize: '64px'
    }).setOrigin(0.5);

    this.promptText = this.add.text(this.centerX, this.centerY - 80, "Prompt: ???", {
      fontSize: '24px',
      color: '#FFC600'
    }).setOrigin(0.5);

    this.turnArrow = this.add.text(0, 0, "►", {
      fontSize: '24px',
      color: '#FF0000'
    });
    this.turnArrow.setVisible(false);

    this.currentWord = "";

    // Remplacer la création du wordDisplay par un conteneur DOM
    this.wordInputContainer = this.add.dom(this.centerX, this.centerY + 120).createFromHTML(`
      <div class="word-input">
        <label>Entrez un mot contenant la syllabe</label>
        <input type="text" id="wordInput" placeholder="Tapez votre mot ici" autocomplete="off">
      </div>
    `);

    const wordInput = this.wordInputContainer.node.querySelector('#wordInput');
    
    // Gestion du clavier
    wordInput.addEventListener('keydown', (event) => {
      // Empêcher la saisie si ce n'est pas le tour du joueur
      if (this.currentTurnPlayerId !== this.socket.id) {
        wordInput.blur();
        return;
      }

      if (event.key === "Enter") {
        const word = wordInput.value.trim();
        if (word.length > 0) {
          this.socket.emit("submitWord", { roomId: this.roomId, word: word });
          wordInput.value = ""; // Vider l'input après soumission
        }
      }
    });

    // Activer/désactiver l'input selon le tour
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

      // Désactiver le bouton par défaut
      this.startBtn.setTint(0x666666);
      this.startBtn.disableInteractive();
    }

    this.playerTextObjects = [];

    // Événements Socket
    this.listenForSocketEvents();
    this.socket.emit("getPlayerList", this.roomId);

    // Particules d'explosion
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

    // Particules de confettis
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

    // Ajouter un bouton de test pour le chat P2P
    this.add.text(10, 550, "[Test P2P]", {
      fontSize: '16px',
      backgroundColor: '#4b53ff',
      padding: { x: 10, y: 5 },
    })
    .setInteractive()
    .on('pointerdown', () => {
      // Envoyer un message à tous les peers connectés
      this.peerConnections.forEach((conn, playerId) => {
        conn.send({
          type: 'chat',
          message: `Message test de ${this.playerName} à ${new Date().toLocaleTimeString()}`
        });
      });
    });
  }

  // Gère la logique du timer de la bombe
  startTickTimer(bombTime) {
    this.stopTickTimer(); // Au cas où un timer tourne déjà
    this.currentBombTime = bombTime;
    const totalTime = bombTime;
    
    // Fonction appelée à chaque tick
    const updateTick = () => {
      if (this.currentBombTime <= 0) {
        this.stopTickTimer();
        return;
      }
      
      // Progression (de 1 à 0)
      const timeProgress = this.currentBombTime / totalTime;
      
      // Ajuster le volume
      const newVolume = 0.5 + (1 - timeProgress) * 0.5; // va de 0.5 à 1
      this.tickSound.setVolume(newVolume);
      this.tickSound.play();
      
      // Calculer le délai pour le prochain tick
      let nextTickDelay;
      
      if (timeProgress < 0.15) {      // Derniers 15%
        nextTickDelay = 200;         // 5 ticks/sec
      } else if (timeProgress < 0.3) {// 30–15%
        nextTickDelay = 300;         // ~3.33 ticks/sec
      } else if (timeProgress < 0.5) {// 50–30%
        nextTickDelay = 500;         // 2 ticks/sec
      } else if (timeProgress < 0.7) {// 70–50%
        nextTickDelay = 750;         // ~1.33 ticks/sec
      } else {                       // 100–70%
        nextTickDelay = 1000;        // 1 tick/sec
      }
      
      this.currentBombTime--;
      
      if (this.currentBombTime > 0) {
        this.tickTimer = this.time.delayedCall(nextTickDelay, updateTick);
      }
    };
    
    // Premier tick immédiat
    updateTick();
  }

  stopTickTimer() {
    if (this.tickTimer) {
      this.tickTimer.remove();
      this.tickTimer = null;
    }
    // Stopper le son si en cours
    if (this.tickSound) {
      this.tickSound.stop();
    }
  }

  listenForSocketEvents() {
    this.socket.on("playerListUpdate", (data) => {
      this.updatePlayerList(data.players);
      
      // Activer/désactiver le bouton START selon le nombre de joueurs
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
      
      // Établir les connexions P2P avec les nouveaux joueurs
      data.players.forEach(player => {
        if (player.id !== this.socket.id && !this.peerConnections.has(player.id) && player.peerId) {
          console.log("Tentative de connexion P2P avec:", player.name, "PeerID:", player.peerId);
          
          try {
            const conn = this.peer.connect(player.peerId);
            if (conn) {
              conn.on('open', () => {
                console.log('Connexion P2P établie avec', player.name);
                this.peerConnections.set(player.id, conn);
                
                // Test d'envoi de message
                conn.send({
                  type: 'test',
                  message: `Bonjour de ${this.playerName}!`
                });
              });
              
              conn.on('data', (data) => {
                console.log('Données P2P reçues de', player.name, ':', data);
              });

              conn.on('error', (err) => {
                console.error('Erreur de connexion P2P avec', player.name, ':', err);
              });
            }
          } catch (err) {
            console.error('Erreur lors de la création de la connexion P2P:', err);
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
      // Animer l'input en vert si c'est notre mot
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

      // Jouer l'explosion sur le joueur concerné
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
      // Petit effet rouge si c'est nous
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

      // Confettis pour le gagnant
      if (this.playerName === winnerName) {
        this.confettiEmitter.setPosition(this.centerX, 0);
        this.confettiEmitter.start();
        this.time.delayedCall(3000, () => {
          this.confettiEmitter.stop();
        });
      }
    });

    // Ajouter la gestion des erreurs
    this.socket.on("gameError", (data) => {
      // Afficher le message d'erreur
      const errorText = this.add.text(this.centerX, this.centerY - 150, data.message, {
        fontSize: '20px',
        color: '#FF0000',
        backgroundColor: '#000000',
        padding: { x: 10, y: 5 }
      }).setOrigin(0.5);

      // Faire disparaître le message après 3 secondes
      this.time.delayedCall(3000, () => {
        errorText.destroy();
      });
    });
  }

  updatePlayerList(players) {
    // Supprimer anciens textes
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
    // Petit tween sur la couleur (si besoin)
    const originalColor = domElement.style.color;

    this.tweens.add({
      targets: domElement,
      duration: 100,
      repeat: 2,
      yoyo: true,
      onStart: () => {
        domElement.style.color = color;
      },
      onComplete: () => {
        domElement.style.color = originalColor;
      }
    });
  }
}
