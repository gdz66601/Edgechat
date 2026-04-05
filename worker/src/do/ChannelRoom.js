import { getSession } from '../auth.js';
import { insertMessage, requireAccessibleRoom } from '../db.js';
import { pickAttachment } from '../utils.js';

function socketMeta(session, room) {
  return {
    session,
    room
  };
}

export class ChannelRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Map();

    for (const socket of this.state.getWebSockets()) {
      const meta = socket.deserializeAttachment();
      if (meta) {
        this.connections.set(socket, meta);
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const token = url.searchParams.get('token') || '';
    const kind = url.searchParams.get('kind') || '';
    const roomId = Number(url.searchParams.get('id') || '');
    const session = await getSession(this.env, token);

    if (!session) {
      return new Response('Unauthorized', { status: 401 });
    }

    const room = await requireAccessibleRoom(
      this.env.DB,
      session.userId,
      kind,
      roomId,
      session.isAdmin
    );

    if (!room) {
      return new Response('Forbidden', { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    const meta = socketMeta(session, room);
    server.serializeAttachment(meta);
    this.connections.set(server, meta);
    server.send(
      JSON.stringify({
        type: 'ready',
        room: {
          id: Number(room.id),
          kind: room.kind,
          name: room.name
        }
      })
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const meta = this.connections.get(ws);
    if (!meta) {
      return;
    }

    let payload;
    try {
      payload = JSON.parse(message);
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: '无效消息格式' }));
      return;
    }

    if (payload.type !== 'send') {
      ws.send(JSON.stringify({ type: 'error', error: '不支持的消息类型' }));
      return;
    }

    try {
      const saved = await insertMessage(this.env.DB, {
        channelId: meta.room.id,
        senderId: meta.session.userId,
        content: payload.content,
        attachment: pickAttachment(payload.attachment)
      });
      const packet = JSON.stringify({
        type: 'message',
        message: saved
      });

      for (const socket of this.connections.keys()) {
        try {
          socket.send(packet);
        } catch {
          this.connections.delete(socket);
        }
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', error: error.message || '发送失败' }));
    }
  }

  webSocketClose(ws) {
    this.connections.delete(ws);
  }

  webSocketError(ws) {
    this.connections.delete(ws);
  }
}
