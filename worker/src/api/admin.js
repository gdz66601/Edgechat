import { hashPassword } from '../auth.js';
import { listMessages, requireAccessibleRoom } from '../db.js';
import { errorResponse, parseJsonRequest, sanitizeLimit } from '../utils.js';

export function registerAdminRoutes(app) {
  app.get('/api/admin/users', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT
         id,
         username,
         display_name,
         avatar_key,
         is_disabled,
         created_at
       FROM users
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC`
    ).all();

    return c.json({
      users: results.map((row) => ({
        id: Number(row.id),
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_key ? `/files/${encodeURIComponent(row.avatar_key)}` : '',
        isDisabled: Boolean(Number(row.is_disabled)),
        createdAt: row.created_at
      }))
    });
  });

  app.post('/api/admin/users', async (c) => {
    const payload = await parseJsonRequest(c.req.raw);
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    const displayName = String(payload.displayName || username).trim();

    if (!username || !password) {
      return errorResponse('用户名和密码不能为空');
    }

    const hashed = await hashPassword(password);
    const result = await c.env.DB.prepare(
      `INSERT INTO users (
         username,
         display_name,
         password_hash,
         password_salt
       ) VALUES (?, ?, ?, ?)`
    )
      .bind(username, displayName, hashed.hash, hashed.salt)
      .run()
      .catch((error) => {
        if (String(error.message).includes('UNIQUE')) {
          throw new Error('用户名已存在');
        }
        throw error;
      });

    return c.json({
      user: {
        id: result.meta.last_row_id,
        username,
        displayName,
        isDisabled: false
      }
    });
  });

  app.patch('/api/admin/users/:userId', async (c) => {
    const userId = Number(c.req.param('userId'));
    const payload = await parseJsonRequest(c.req.raw);
    await c.env.DB.prepare(
      `UPDATE users
       SET is_disabled = ?,
           display_name = COALESCE(?, display_name),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND deleted_at IS NULL`
    )
      .bind(payload.isDisabled ? 1 : 0, payload.displayName || null, userId)
      .run();

    return c.json({ ok: true });
  });

  app.post('/api/admin/users/:userId/reset-password', async (c) => {
    const userId = Number(c.req.param('userId'));
    const payload = await parseJsonRequest(c.req.raw);
    const password = String(payload.password || '');
    if (!password) {
      return errorResponse('新密码不能为空');
    }

    const hashed = await hashPassword(password);
    await c.env.DB.prepare(
      `UPDATE users
       SET password_hash = ?,
           password_salt = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND deleted_at IS NULL`
    )
      .bind(hashed.hash, hashed.salt, userId)
      .run();

    return c.json({ ok: true });
  });

  app.delete('/api/admin/users/:userId', async (c) => {
    const userId = Number(c.req.param('userId'));
    await c.env.DB.prepare(
      `UPDATE users
       SET deleted_at = CURRENT_TIMESTAMP,
           is_disabled = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(userId)
      .run();

    return c.json({ ok: true });
  });

  app.get('/api/admin/messages/search', async (c) => {
    const keyword = String(c.req.query('keyword') || '').trim();
    const channelId = Number(c.req.query('channelId') || '');
    const userId = Number(c.req.query('userId') || '');
    const kind = c.req.query('kind');
    const limit = sanitizeLimit(c.req.query('limit'), 50, 200);
    const filters = ['m.deleted_at IS NULL', 'c.deleted_at IS NULL'];
    const binds = [];

    if (keyword) {
      filters.push('(m.content LIKE ? OR m.attachment_name LIKE ?)');
      binds.push(`%${keyword}%`, `%${keyword}%`);
    }

    if (Number.isFinite(channelId)) {
      filters.push('c.id = ?');
      binds.push(channelId);
    }

    if (Number.isFinite(userId)) {
      filters.push('u.id = ?');
      binds.push(userId);
    }

    if (kind === 'public' || kind === 'private' || kind === 'dm') {
      filters.push('c.kind = ?');
      binds.push(kind);
    }

    const { results } = await c.env.DB.prepare(
      `SELECT
         m.id,
         m.content,
         m.attachment_name,
         m.created_at,
         c.id AS channel_id,
         c.name AS channel_name,
         c.kind AS channel_kind,
         u.id AS sender_id,
         u.display_name AS sender_display_name,
         u.username AS sender_username
       FROM messages m
       JOIN channels c ON c.id = m.channel_id
       JOIN users u ON u.id = m.sender_id
       WHERE ${filters.join(' AND ')}
       ORDER BY m.id DESC
       LIMIT ?`
    )
      .bind(...binds, limit)
      .all();

    return c.json({
      messages: results.map((row) => ({
        id: Number(row.id),
        content: row.content,
        attachmentName: row.attachment_name,
        createdAt: row.created_at,
        room: {
          id: Number(row.channel_id),
          name: row.channel_name,
          kind: row.channel_kind
        },
        sender: {
          id: Number(row.sender_id),
          username: row.sender_username,
          displayName: row.sender_display_name
        }
      }))
    });
  });

  app.get('/api/admin/rooms/:kind/:roomId/messages', async (c) => {
    const kind = c.req.param('kind');
    const roomId = Number(c.req.param('roomId'));
    const before = c.req.query('before');
    const room = await requireAccessibleRoom(c.env.DB, 0, kind, roomId, true);
    if (!room) {
      return errorResponse('会话不存在', 404);
    }

    const messages = await listMessages(c.env.DB, roomId, before, 50);
    return c.json({ room, messages });
  });
}
