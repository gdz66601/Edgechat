import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createSession, deleteSession, getSession, hashPassword, verifyPassword } from './auth.js';
import { getUserByUsername } from './db.js';
import { adminMiddleware, authMiddleware } from './middleware.js';
import { registerAdminRoutes } from './api/admin.js';
import { registerChannelRoutes } from './api/channels.js';
import { registerDmRoutes } from './api/dm.js';
import { registerMessageRoutes } from './api/messages.js';
import { registerUploadRoutes } from './api/upload.js';
import { ChannelRoom } from './do/ChannelRoom.js';
import { Scheduler } from './do/Scheduler.js';
import { errorResponse, parseJsonRequest } from './utils.js';

const app = new Hono();

app.use('/api/*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
}));

app.use('*', async (c, next) => {
  c.executionCtx.waitUntil(initScheduler(c.env));
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/auth/login', async (c) => {
  const payload = await parseJsonRequest(c.req.raw);
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');
  if (!username || !password) {
    return errorResponse('请输入用户名和密码');
  }

  const user = await getUserByUsername(c.env.DB, username);
  if (!user || Number(user.is_disabled)) {
    return errorResponse('账号或密码错误', 401);
  }

  const valid = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!valid) {
    return errorResponse('账号或密码错误', 401);
  }

  const session = await createSession(c.env, user);
  return c.json({
    token: session.token,
    session
  });
});

app.use('/api/*', authMiddleware);

app.get('/api/auth/session', async (c) => {
  const session = c.get('session');
  const user = await c.env.DB.prepare(
    `SELECT display_name, avatar_key, is_disabled
     FROM users
     WHERE id = ?
       AND deleted_at IS NULL
     LIMIT 1`
  )
    .bind(session.userId)
    .all();

  if (!user.results[0] || Number(user.results[0].is_disabled)) {
    await deleteSession(c.env, session.token);
    return errorResponse('账号已不可用', 401);
  }

  const freshSession = {
    ...session,
    displayName: user.results[0].display_name,
    avatarUrl: user.results[0].avatar_key ? `/files/${encodeURIComponent(user.results[0].avatar_key)}` : ''
  };
  await c.env.SESSIONS.put(session.token, JSON.stringify(freshSession), {
    expirationTtl: 60 * 60 * 24 * 7
  });

  return c.json({ session: freshSession });
});

app.post('/api/auth/logout', async (c) => {
  const session = c.get('session');
  await deleteSession(c.env, session.token);
  return c.json({ ok: true });
});

app.post('/api/auth/change-password', async (c) => {
  const session = c.get('session');
  const payload = await parseJsonRequest(c.req.raw);
  const currentPassword = String(payload.currentPassword || '');
  const newPassword = String(payload.newPassword || '');
  if (!currentPassword || !newPassword) {
    return errorResponse('请填写完整密码');
  }

  const user = await c.env.DB.prepare(
    `SELECT password_hash, password_salt
     FROM users
     WHERE id = ?
       AND deleted_at IS NULL
     LIMIT 1`
  )
    .bind(session.userId)
    .all();

  if (!user.results[0]) {
    return errorResponse('用户不存在', 404);
  }

  const valid = await verifyPassword(
    currentPassword,
    user.results[0].password_hash,
    user.results[0].password_salt
  );
  if (!valid) {
    return errorResponse('当前密码不正确', 400);
  }

  const hashed = await hashPassword(newPassword);
  await c.env.DB.prepare(
    `UPDATE users
     SET password_hash = ?,
         password_salt = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(hashed.hash, hashed.salt, session.userId)
    .run();

  return c.json({ ok: true });
});

app.patch('/api/me/profile', async (c) => {
  const session = c.get('session');
  const payload = await parseJsonRequest(c.req.raw);
  const displayName = String(payload.displayName || session.displayName).trim();
  const avatarKey = payload.avatarKey ? String(payload.avatarKey) : null;
  if (!displayName) {
    return errorResponse('显示名称不能为空');
  }

  await c.env.DB.prepare(
    `UPDATE users
     SET display_name = ?,
         avatar_key = COALESCE(?, avatar_key),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(displayName, avatarKey, session.userId)
    .run();

  const nextSession = await getSession(c.env, session.token);
  const merged = {
    ...nextSession,
    displayName,
    avatarUrl: avatarKey ? `/files/${encodeURIComponent(avatarKey)}` : nextSession.avatarUrl
  };
  await c.env.SESSIONS.put(session.token, JSON.stringify(merged), {
    expirationTtl: 60 * 60 * 24 * 7
  });

  return c.json({ session: merged });
});

app.get('/api/users', async (c) => {
  const session = c.get('session');
  const { results } = await c.env.DB.prepare(
    `SELECT id, username, display_name, avatar_key
     FROM users
     WHERE deleted_at IS NULL
       AND is_disabled = 0
       AND id != ?
     ORDER BY display_name ASC`
  )
    .bind(session.userId)
    .all();

  return c.json({
    users: results.map((row) => ({
      id: Number(row.id),
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_key ? `/files/${encodeURIComponent(row.avatar_key)}` : ''
    }))
  });
});

app.use('/api/admin/*', adminMiddleware);

registerMessageRoutes(app);
registerDmRoutes(app);
registerUploadRoutes(app);
registerChannelRoutes(app);
registerAdminRoutes(app);

app.get('/api/ws/:kind/:id', async (c) => {
  const session = c.get('session');
  const kind = c.req.param('kind');
  const id = c.req.param('id');
  if (!['public', 'private', 'dm'].includes(kind)) {
    return errorResponse('无效的会话类型');
  }

  const stub = c.env.CHANNEL_ROOM.get(c.env.CHANNEL_ROOM.idFromName(`${kind}:${id}`));
  const url = new URL(c.req.url);
  url.pathname = '/connect';
  url.searchParams.set('kind', kind);
  url.searchParams.set('id', id);
  url.searchParams.set('token', session.token);
  return stub.fetch(url.toString(), c.req.raw);
});

app.notFound(async (c) => {
  if (new URL(c.req.url).pathname.startsWith('/api/')) {
    return errorResponse('接口不存在', 404);
  }

  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
  if (assetResponse.status !== 404) {
    return assetResponse;
  }

  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
});

app.onError((error) => errorResponse(error.message || '服务器开小差了', 500));

async function initScheduler(env) {
  const stub = env.SCHEDULER.get(env.SCHEDULER.idFromName('global-cleanup'));
  await stub.fetch('https://scheduler.internal/init');
}

export default app;
export { ChannelRoom, Scheduler };
