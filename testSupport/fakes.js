// Спільні підробки для тестів: підроблені res/req і fetch. Жодної мережі.

// Підроблена відповідь Node: пам'ятає, що в неї записали. writeHead повертає this, бо код пише res.writeHead(405).end()
export function fakeRes() {
  return {
    status: null,
    headers: null,
    body: undefined,
    headersSent: false,
    ended: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers ?? null;
      this.headersSent = true;
      return this;
    },
    end(body) {
      this.body = body;
      this.ended = true;
      return this;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

export const fakeReq = (url, method = 'GET', host = 'localhost') => ({ url, method, headers: { host } });

// Підроблений fetch: повертає задану відповідь (status + тіло) і запам'ятовує, що просили
export function fakeFetch({ status = 200, json = {}, bytes = new Uint8Array([1, 2, 3]), error = null } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (error) throw error;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };
  fn.calls = calls;
  return fn;
}
