export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LobbyScene' });
  }

  create() {
    this.createNameUI();
  }

  createNameUI() {
    const container = this.add.dom(
      this.cameras.main.centerX,
      this.cameras.main.centerY
    ).createFromHTML(`
      <div class="lobby-container" id="nameContainer">
        <h1>Bomb Party</h1>
        
        <input type="text" id="playerName" placeholder="Entrez votre nom" />
        <button id="confirmNameBtn">Confirmer</button>

        <div class="error-message" id="errorMsg"></div>
      </div>
    `);

    const rootEle = container.node;
    const confirmBtn = rootEle.querySelector("#confirmNameBtn");
    const errorDiv = rootEle.querySelector("#errorMsg");
    const nameInput = rootEle.querySelector("#playerName");

    confirmBtn.onclick = () => {
      const playerName = nameInput.value.trim();
      if (!playerName) {
        errorDiv.textContent = "Veuillez entrer un nom";
        return;
      }
      
      this.playerName = playerName;
      container.destroy();
      this.createRoomUI();
    };
  }

  createRoomUI() {
    const container = this.add.dom(
      this.cameras.main.centerX,
      this.cameras.main.centerY
    ).createFromHTML(`
      <div class="lobby-container" id="roomContainer">
        <h1>Choisissez une option</h1>
        
        <div class="room-options">
          <div class="create-room">
            <h2>Créer une partie</h2>
            <div class="input-group">
              <label for="livesVal">Nombre de vies par joueur :</label>
              <input type="number" id="livesVal" value="3" min="1" max="5"/>
              <small class="input-help">Chaque joueur commence avec ce nombre de vies (1-5)</small>
            </div>
            <button id="createRoomBtn">Créer une partie</button>
          </div>

          <div class="join-room">
            <h2>Rejoindre une partie</h2>
            <div class="input-group">
              <label for="joinRoomId">Code de la salle :</label>
              <input type="text" id="joinRoomId" placeholder="Ex: ABC123" />
            </div>
            <button id="joinRoomBtn">Rejoindre</button>
          </div>
        </div>

        <div class="error-message" id="errorMsg"></div>
      </div>
    `);

    const rootEle = container.node;
    const joinBtn = rootEle.querySelector("#joinRoomBtn");
    const createBtn = rootEle.querySelector("#createRoomBtn");
    const errorDiv = rootEle.querySelector("#errorMsg");

    joinBtn.onclick = () => {
      const roomInput = rootEle.querySelector("#joinRoomId").value.trim().toUpperCase();
      console.log("Tentative de connexion à la salle:", roomInput);
      if (!roomInput) {
        errorDiv.textContent = "Veuillez entrer un code de salle";
        return;
      }
      
      localStorage.setItem('lastRoomId', roomInput);
      
      joinBtn.disabled = true;
      joinBtn.textContent = "Connexion...";
      
      this.game.socket.emit("joinRoom", { roomId: roomInput, playerName: this.playerName, peerId: this.game.peerId }, (res) => {
        console.log("Réponse de joinRoom:", res);
        joinBtn.disabled = false;
        joinBtn.textContent = "Rejoindre";
        
        if (res.success) {
          const { roomId } = res;
          console.log("Démarrage de GameScene avec roomId:", roomId);
          this.scene.start("GameScene", { roomId, playerName: this.playerName, isHost: false });
        } else {
          errorDiv.textContent = res.message || "Impossible de rejoindre la salle";
        }
      });
    };

    createBtn.onclick = () => {
      console.log("Création d'une nouvelle salle avec peerId:", this.game.peerId);
      const livesVal = rootEle.querySelector("#livesVal").value.trim() || "3";
      this.game.socket.emit("createRoom", { hostName: this.playerName, lives: livesVal, peerId: this.game.peerId }, (res) => {
        console.log("Réponse de createRoom:", res);
        if (res.success) {
          const { roomId } = res;
          console.log("Room ID reçu:", roomId);
          
          localStorage.setItem('lastRoomId', roomId);
          
          if (errorDiv) errorDiv.textContent = `Salle créée: ${roomId}`;
          
          setTimeout(() => {
            console.log("Démarrage de GameScene avec roomId:", roomId);
            this.scene.start("GameScene", { roomId, playerName: this.playerName, isHost: true });
          }, 1000);
        } else {
          errorDiv.textContent = "Échec de la création de la salle";
        }
      });
    };
  }
}
