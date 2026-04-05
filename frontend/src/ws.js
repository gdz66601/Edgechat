import api from './api.js';

export function connectRoomSocket({ kind, roomId, onMessage, onStatus }) {
  const socket = new WebSocket(api.getRoomWebSocketUrl(kind, roomId));

  socket.addEventListener('open', () => {
    onStatus?.('open');
  });

  socket.addEventListener('close', () => {
    onStatus?.('closed');
  });

  socket.addEventListener('error', () => {
    onStatus?.('error');
  });

  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data);
      onMessage?.(payload);
    } catch {
      onMessage?.({ type: 'system', message: event.data });
    }
  });

  return socket;
}
