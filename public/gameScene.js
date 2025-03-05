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
    this.load.audio('explosionSound', 'assets/explosion.mp3')
  }

  create() {
    this.centerX = this.cameras.main.centerX;
    this.centerY = this.cameras.main.centerY;

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
    this.wordDisplay = this.add.text(this.centerX, this.centerY + 120, "", {
      fontSize: '28px',
      color: '#00ff00'
    }).setOrigin(0.5);

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
    this.registerKeyboard();
    this.socket.emit("getPlayerList", this.roomId);
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

    this.socket.on("turnStarted", (payload) => {
      const { currentPlayerId, prompt } = payload;
      this.currentTurnPlayerId = currentPlayerId;
      this.promptText.setText(`Prompt: ${prompt}`);
      this.currentWord = "";
      this.wordDisplay.setText("");
      this.updateArrowPosition();
    });

    this.socket.on("wordAccepted", (info) => {
      if (info.playerId === this.socket.id) {
        this.flashText(this.wordDisplay, '#00FF00');
      }
    });

    this.socket.on("wordInvalid", (info) => {
      this.flashText(this.wordDisplay, '#FF0000');
    });

    this.socket.on("nextTurn", (data) => {
      const { currentPlayerId, prompt } = data;
      this.currentTurnPlayerId = currentPlayerId;
      this.promptText.setText(`Prompt: ${prompt}`);
      this.currentWord = "";
      this.wordDisplay.setText("");
      this.updateArrowPosition();
    });

    this.socket.on("bombExploded", (data) => {
      this.cameras.main.shake(200, 0.03);
      this.explosionSound.play()
    });

    this.socket.on("playerEliminated", (data) => {
      if (data.playerId === this.socket.id) {
        this.flashText(this.wordDisplay, '#FF0000');
      }
    });

    this.socket.on("gameOver", (res) => {
      const { winnerName } = res;
      this.add.text(this.centerX, this.centerY + 200, `Game Over! Winner: ${winnerName}`, {
        fontSize: '28px',
        color: '#FFC600'
      }).setOrigin(0.5);
    });
  }

  registerKeyboard() {
    this.input.keyboard.on('keydown', (event) => {
      if (this.currentTurnPlayerId !== this.socket.id) return;
      if (event.key === "Enter") {
        if (this.currentWord.length > 0) {
          this.socket.emit("submitWord", { roomId: this.roomId, word: this.currentWord });
        }
      } else if (event.key === "Backspace") {
        this.currentWord = this.currentWord.slice(0, -1);
        this.wordDisplay.setText(this.currentWord);
      } else if (/^[a-zA-Z]$/.test(event.key)) {
        this.currentWord += event.key;
        this.wordDisplay.setText(this.currentWord);
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
