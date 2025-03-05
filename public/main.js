import LobbyScene from './lobbyScene.js';
import GameScene from './gameScene.js';

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#1e1f29',
  parent: 'game-container',
  dom: { createContainer: true },
  scene: [LobbyScene, GameScene]
};

const game = new Phaser.Game(config);
const socket = io();
game.socket = socket;

game.scene.start('LobbyScene');
