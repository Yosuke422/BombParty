export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  init(data) {
    this.roomId = data.roomId;
    this.playerName = data.playerName;
    this.isHost = data.isHost;
    this.socket = this.game.socket;
  }

  preload() {
    this.load.audio('explosionSound', 'assets/explosion.mp3');
    this.load.image('spark', 'assets/yellow.png');
    this.load.image('confetti', 'assets/white.png');
  }

  create() {
    this.cameras.main.centerOn(400, 300);
    this.centerX = this.cameras.main.centerX;
    this.centerY = this.cameras.main.centerY;

    // Créer un conteneur pour le code de la salle et le bouton de copie
    const roomCodeContainer = this.add.dom(this.centerX, 20).createFromHTML(`
      <div class="room-code-container">
        <span class="room-code">Code de la salle: ${this.roomId}</span>
        <button class="copy-button" title="Copier le code">📋</button>
      </div>
    `);

    // Ajouter la fonctionnalité de copie
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

    this.explosionSound = this.sound.add('explosionSound', {
      volume: 1
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

    // Remplacer la création du wordDisplay par un conteneur DOM avec input
    const wordInputContainer = this.add.dom(this.centerX, this.centerY + 120).createFromHTML(`
      <div class="word-input">
        <label>Entrez un mot contenant la syllabe</label>
        <input type="text" id="wordInput" placeholder="Tapez votre mot ici" autocomplete="off">
      </div>
    `);

    const wordInput = wordInputContainer.node.querySelector('#wordInput');
    
    // Mettre à jour la gestion du clavier
    wordInput.addEventListener('keydown', (event) => {
      if (this.currentTurnPlayerId !== this.socket.id) {
        wordInput.blur(); // Enlever le focus si ce n'est pas son tour
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

    // Mettre à jour l'état du champ selon le tour
    this.socket.on("turnStarted", (payload) => {
      const { currentPlayerId, prompt } = payload;
      this.currentTurnPlayerId = currentPlayerId;
      this.promptText.setText(`Prompt: ${prompt}`);
      
      if (currentPlayerId === this.socket.id) {
        wordInput.removeAttribute('disabled');
        wordInput.focus();
      } else {
        wordInput.setAttribute('disabled', 'disabled');
        wordInput.blur();
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
        this.startBtn.setVisible(false);
      });
    }

    this.playerTextObjects = [];

    this.listenForSocketEvents();
    this.socket.emit("getPlayerList", this.roomId);

    // Configuration des particules d'explosion
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

    // Configuration des confettis
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
  }

  listenForSocketEvents() {
    this.socket.on("playerListUpdate", (data) => {
      this.updatePlayerList(data.players);
    });

    this.socket.on("gameStarted", (data) => {
      this.promptText.setText(`Prompt: ${data.prompt}`);
      this.currentTurnPlayerId = data.currentPlayerId;
      this.updateArrowPosition();
    });

    this.socket.on("wordAccepted", (info) => {
      if (info.playerId === this.socket.id) {
        this.flashText(this.wordInputContainer.node.querySelector('#wordInput'), '#00FF00');
      }
    });

    this.socket.on("wordInvalid", (info) => {
      this.flashText(this.wordInputContainer.node.querySelector('#wordInput'), '#FF0000');
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
      if (data.playerId === this.socket.id) {
        const playerObj = this.playerTextObjects.find(t => t.playerId === this.socket.id);
        if (playerObj) {
          this.explosionEmitter.setPosition(playerObj.x, playerObj.y);
          this.explosionEmitter.start();
          this.time.delayedCall(200, () => {
            this.explosionEmitter.stop();
          });
        }
      }
    });

    this.socket.on("playerEliminated", (data) => {
      if (data.playerId === this.socket.id) {
        this.flashText(this.wordInputContainer.node.querySelector('#wordInput'), '#FF0000');
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

  flashText(textObj, color) {
    this.tweens.add({
      targets: textObj,
      duration: 100,
      repeat: 2,
      yoyo: true,
      color,
      onComplete: () => {
        textObj.setColor('#00ff00');
      }
    });
  }
}
