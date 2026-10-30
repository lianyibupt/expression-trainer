const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

function safeResourcePath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('资源路径无效');
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('资源路径超出允许范围');
  return target;
}

async function fileMatches(filename, spec) {
  let stat;
  try { stat = await fs.promises.stat(filename); } catch { return false; }
  if (!stat.isFile() || stat.size !== spec.size) return false;
  const hash = crypto.createHash(spec.sha256 ? 'sha256' : 'sha1');
  if (!spec.sha256) hash.update(`blob ${spec.size}\0`);
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex') === (spec.sha256 || spec.gitBlob);
}

async function downloadFile({ url, destination, size, sha256, gitBlob, signal, onProgress = () => {}, allowHttp = false, fetchImpl = globalThis.fetch }) {
  if (!Number.isSafeInteger(size) || size < 0 || (!/^[a-f0-9]{64}$/.test(sha256 || '') && !/^[a-f0-9]{40}$/.test(gitBlob || ''))) throw new Error('资源校验信息无效');
  if (new URL(url).protocol !== 'https:' && !allowHttp) throw new Error('资源下载仅允许 HTTPS');
  signal?.throwIfAborted();
  const spec = { size, sha256, gitBlob };
  if (await fileMatches(destination, spec)) { onProgress({ received: size, total: size }); return; }
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const partial = destination + '.part';
  let offset = 0;
  try { offset = (await fs.promises.stat(partial)).size; } catch {}
  if (offset === size && await fileMatches(partial, spec)) { await fs.promises.rename(partial, destination); onProgress({ received: size, total: size }); return; }
  if (offset >= size) { await fs.promises.rm(partial, { force: true }); offset = 0; }
  const timeout = new AbortController();
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  let timer;
  const resetTimeout = () => { clearTimeout(timer); timer = setTimeout(() => timeout.abort(new Error('下载连接超时，请重试')), 90000); timer.unref?.(); };
  resetTimeout();
  try {
    const response = await fetchImpl(url, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal: combined });
    if (response.url && new URL(response.url).protocol !== 'https:' && !allowHttp) throw new Error('资源重定向必须使用 HTTPS');
    if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}，请检查网络后重试`);
    if (response.status === 206) {
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      if (!match || Number(match[1]) !== offset || Number(match[2]) !== size - 1 || Number(match[3]) !== size) throw new Error('服务器返回的下载范围无效');
    } else offset = 0;
    let received = offset, lastUpdate = 0;
    const meter = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length; resetTimeout();
      if (received > size) return callback(new Error('下载文件大小超出校验范围'));
      if (Date.now() - lastUpdate > 200) { lastUpdate = Date.now(); onProgress({ received, total: size }); }
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(partial, { flags: offset ? 'a' : 'w' }), { signal: combined });
    signal?.throwIfAborted();
    if (!await fileMatches(partial, spec)) { await fs.promises.rm(partial, { force: true }); throw new Error('资源完整性校验失败，请重试下载'); }
    await fs.promises.rename(partial, destination);
    onProgress({ received: size, total: size });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (timeout.signal.aborted) throw timeout.signal.reason;
    throw error;
  } finally { clearTimeout(timer); }
}
module.exports = { downloadFile, safeResourcePath, fileMatches };
