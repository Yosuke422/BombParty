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

// Initialisation de PeerJS
const isProd = window.location.hostname !== 'localhost';
let peerConfig;

if (isProd) {
  // Configuration pour l'environnement de production (Render)
  peerConfig = {
    host: window.location.hostname,
    path: '/peerjs/myapp',
    secure: true,
    port: 443,
    debug: 1
  };
} else {
  // Configuration pour l'environnement local
  peerConfig = {
    host: 'localhost',
    port: 9000,
    path: '/myapp',
    debug: 3
  };
}

const peer = new Peer(undefined, peerConfig);

peer.on('open', (id) => {
  console.log('Mon Peer ID:', id);
  game.peerId = id;
});

peer.on('error', (error) => {
  console.error('Erreur PeerJS:', error);
});

// Ajouter un gestionnaire de déconnexion
peer.on('disconnected', () => {
  console.log('Déconnecté du serveur PeerJS');
  // Tentative de reconnexion
  peer.reconnect();
});

game.peer = peer;
game.scene.start('LobbyScene');
