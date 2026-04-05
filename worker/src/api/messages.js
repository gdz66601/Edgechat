import { listMessages, requireAccessibleRoom } from '../db.js';
import { errorResponse, sanitizeLimit } from '../utils.js';

export function registerMessageRoutes(app) {
  app.get('/api/messages', async (c) => {
    const session = c.get('session');
    const kind = c.req.query('kind');
    const roomId = Number(c.req.query('roomId'));
    const before = c.req.query('before');
    const limit = sanitizeLimit(c.req.query('limit'));

    if (!['public', 'private', 'dm'].includes(kind) || !Number.isFinite(roomId)) {
      return errorResponse('参数无效');
    }

    const room = await requireAccessibleRoom(
      c.env.DB,
      session.userId,
      kind,
      roomId,
      session.isAdmin
    );

    if (!room) {
      return errorResponse('无权访问该会话', 403);
    }

    const messages = await listMessages(c.env.DB, roomId, before, limit);
    return c.json({
      room: {
        id: Number(room.id),
        kind: room.kind,
        name: room.name,
        description: room.description
      },
      messages
    });
  });
}
