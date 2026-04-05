import { errorResponse } from '../utils.js';

function validateUpload(env, file) {
  const maxFileSize = Number(env.MAX_FILE_SIZE || 20971520);
  if (file.size > maxFileSize) {
    throw new Error(`文件大小不能超过 ${Math.round(maxFileSize / 1024 / 1024)}MB`);
  }

  const allowed = String(env.ALLOWED_FILE_TYPES || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowed.length && !allowed.some((prefix) => file.type.startsWith(prefix))) {
    throw new Error('该文件类型不允许上传');
  }
}

export function registerUploadRoutes(app) {
  app.post('/api/upload', async (c) => {
    const session = c.get('session');
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return errorResponse('请选择文件');
    }

    try {
      validateUpload(c.env, file);
    } catch (error) {
      return errorResponse(error.message);
    }

    const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
    const key = `${session.userId}/${Date.now()}-${crypto.randomUUID()}${extension}`;
    await c.env.FILES.put(key, await file.arrayBuffer(), {
      httpMetadata: {
        contentType: file.type || 'application/octet-stream'
      }
    });

    return c.json({
      file: {
        key,
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        url: `/files/${encodeURIComponent(key)}`
      }
    });
  });

  app.get('/files/:key{.+}', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const object = await c.env.FILES.get(key);
    if (!object) {
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    return new Response(object.body, { headers });
  });
}
