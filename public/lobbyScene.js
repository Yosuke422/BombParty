export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LobbyScene' });
  }

  create() {
    this.createLobbyUI();
  }

  createLobbyUI() {
    const container = this.add.dom(
      this.cameras.main.centerX,
      this.cameras.main.centerY
    ).createFromHTML(`
      <div class="lobby-container">
        <h1>Bomb Party Clone</h1>
        
        <label>Name:</label>
        <input type="text" id="playerName" placeholder="Enter your name" />

        <label>Room Code (to join):</label>
        <input type="text" id="joinRoomId" placeholder="AB12CD" />

        <button id="joinRoomBtn">Join Room</button>

        <hr/>

        <label>Lives (1-5):</label>
        <input type="number" id="livesVal" value="3" min="1" max="5"/>

        <button id="createRoomBtn">Create Room</button>

        <div class="error-message" id="errorMsg"></div>
      </div>
    `);

    const rootEle = container.node;
    const joinBtn = rootEle.querySelector("#joinRoomBtn");
    const createBtn = rootEle.querySelector("#createRoomBtn");
    const errorDiv = rootEle.querySelector("#errorMsg");

    joinBtn.onclick = () => {
      const playerName = rootEle.querySelector("#playerName").value.trim() || "Player";
      const roomId = rootEle.querySelector("#joinRoomId").value.trim().toUpperCase();
      if (!roomId) {
        errorDiv.textContent = "Please enter a valid room code.";
        return;
      }
      this.game.socket.emit("joinRoom", { roomId, playerName }, (res) => {
        if (res.success) {
          this.scene.start("GameScene", { roomId, playerName, isHost: false });
        } else {
          errorDiv.textContent = res.message || "Cannot join room.";
        }
      });
    };

    createBtn.onclick = () => {
      const playerName = rootEle.querySelector("#playerName").value.trim() || "Host";
      const livesVal = rootEle.querySelector("#livesVal").value.trim() || "3";

      this.game.socket.emit("createRoom", { hostName: playerName, lives: livesVal }, (res) => {
        if (res.success) {
          const { roomId } = res;
          this.scene.start("GameScene", { roomId, playerName, isHost: true });
        } else {
          errorDiv.textContent = "Failed to create room.";
        }
      });
    };
  }
}
