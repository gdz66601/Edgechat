import { deleteSession, getSession } from './auth.js';
import { isUserActiveById } from './db.js';
import { errorResponse } from './utils.js';

function extractToken(request) {
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }

  const url = new URL(request.url);
  return url.searchParams.get('token') || '';
}

export async function authMiddleware(c, next) {
  const token = extractToken(c.req.raw);
  const session = await getSession(c.env, token);
  if (!session) {
    return errorResponse('Please log in first', 401);
  }

  const isActive = await isUserActiveById(c.env.DB, session.userId);
  if (!isActive) {
    await deleteSession(c.env, session.token);
    return errorResponse('Account is unavailable', 401);
  }

  c.set('session', session);
  await next();
}

export async function adminMiddleware(c, next) {
  const session = c.get('session');
  if (!session?.isAdmin) {
    return errorResponse('Admin access required', 403);
  }

  await next();
}
