import { getSession } from '../auth.js';
import { insertMessage, isUserActiveById, requireAccessibleRoom } from '../db.js';
import { pickAttachment } from '../utils.js';

const WS_CLOSE_UNAUTHORIZED = 4401;
const WS_CLOSE_FORBIDDEN = 4403;
const WS_REASON_UNAUTHORIZED = 'session_invalid';
const WS_REASON_FORBIDDEN = 'room_forbidden';

function socketMeta(token, room) {
  return {
    token,
    room: {
      id: Number(room.id),
      kind: room.kind,
      name: room.name
    }
  };
}

function normalizeSocketMeta(rawMeta) {
  if (!rawMeta) {
    return null;
  }

  const token = String(rawMeta.token || rawMeta.session?.token || '').trim();
  const room = rawMeta.room;
  const roomId = Number(room?.id);
  const kind = String(room?.kind || '').trim();

  if (!token || !Number.isFinite(roomId) || !kind) {
    return null;
  }

  return {
    token,
    room: {
      id: roomId,
      kind,
      name: String(room?.name || '')
    }
  };
}

export class ChannelRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Map();

    for (const socket of this.state.getWebSockets()) {
      const meta = normalizeSocketMeta(socket.deserializeAttachment());
      if (meta) {
        this.connections.set(socket, meta);
      } else {
        this.closeAndForget(socket, WS_CLOSE_UNAUTHORIZED, WS_REASON_UNAUTHORIZED);
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

    const meta = socketMeta(session.token, room);
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

  closeAndForget(ws, code, reason) {
    this.connections.delete(ws);
    try {
      ws.close(code, reason);
    } catch {
      // Ignore close errors from stale sockets.
    }
  }

  async validateConnection(meta) {
    const session = await getSession(this.env, meta.token);
    if (!session) {
      return { ok: false, closeCode: WS_CLOSE_UNAUTHORIZED, closeReason: WS_REASON_UNAUTHORIZED };
    }

    const isActive = await isUserActiveById(this.env.DB, session.userId);
    if (!isActive) {
      return { ok: false, closeCode: WS_CLOSE_UNAUTHORIZED, closeReason: WS_REASON_UNAUTHORIZED };
    }

    const room = await requireAccessibleRoom(
      this.env.DB,
      session.userId,
      meta.room.kind,
      meta.room.id,
      session.isAdmin
    );

    if (!room) {
      return { ok: false, closeCode: WS_CLOSE_FORBIDDEN, closeReason: WS_REASON_FORBIDDEN };
    }

    return {
      ok: true,
      session,
      room
    };
  }

  async prunePrivateConnections() {
    for (const [socket, meta] of this.connections.entries()) {
      if (meta.room.kind !== 'private') {
        continue;
      }

      const validation = await this.validateConnection(meta);
      if (!validation.ok) {
        this.closeAndForget(socket, validation.closeCode, validation.closeReason);
      }
    }
  }

  async webSocketMessage(ws, message) {
    const meta = this.connections.get(ws);
    if (!meta) {
      this.closeAndForget(ws, WS_CLOSE_UNAUTHORIZED, WS_REASON_UNAUTHORIZED);
      return;
    }

    let payload;
    try {
      const text =
        typeof message === 'string'
          ? message
          : message instanceof ArrayBuffer
            ? new TextDecoder().decode(message)
            : String(message || '');
      payload = JSON.parse(text);
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
      return;
    }

    if (payload.type !== 'send') {
      ws.send(JSON.stringify({ type: 'error', error: 'Unsupported message type' }));
      return;
    }

    const validation = await this.validateConnection(meta);
    if (!validation.ok) {
      ws.send(JSON.stringify({ type: 'error', error: 'Room access has changed' }));
      this.closeAndForget(ws, validation.closeCode, validation.closeReason);
      return;
    }

    try {
      const saved = await insertMessage(this.env.DB, {
        channelId: validation.room.id,
        senderId: validation.session.userId,
        content: payload.content,
        attachment: pickAttachment(payload.attachment)
      });

      if (validation.room.kind === 'private') {
        await this.prunePrivateConnections();
      }

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
      ws.send(JSON.stringify({ type: 'error', error: error.message || 'Failed to send message' }));
    }
  }

  webSocketClose(ws) {
    this.connections.delete(ws);
  }

  webSocketError(ws) {
    this.connections.delete(ws);
  }
}

