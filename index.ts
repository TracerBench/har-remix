import * as http from "http";
import * as zlib from "zlib";
import * as fs from "fs";

/**
 * Delegate for archive server
 */
export interface ServerDelegate {
  /**
   * Create a key for the request that will be used to match
   * the server request to the archived response.
   *
   * Return undefined if you do not want to serve this request.
   */
  keyForArchiveEntry(entry: HAR.Entry): string | undefined;

  /**
   * Create a key from the request to match against the archived requests.
   */
  keyForServerRequest(req: http.IncomingMessage): string | undefined;

  /**
   * Allows simple text content to be transformed.
   */
  textFor?(entry: HAR.Entry, key: string, text: string): string;

  /**
   * By default, only 200 requests are responsed to.
   *
   * If you return a key for a non 200 request this method is called.
   */
  responseFor?(entry: HAR.Entry, key: string): Response | undefined;

  /**
   * Finalize the response before adding it, by default no headers are copied.
   *
   * This hook allows you to copy headers or alter response or return a new response before added.
   */
  finalizeResponse?(entry: HAR.Entry, key: string, response: Response): Response;

  /**
   * Called if no response found. Will 404 if no headers sent.
   *
   * Allows fallback.
   */
  missingResponse?(request: http.IncomingMessage, response: http.ServerResponse);
}

export interface Response {
  statusCode: number;
  headers: MapLike<string>;
  body: Buffer;
  next: Response | undefined;
}

export default class ArchiveServer {
  private responses = createMap<Response>();

  constructor(private delegate: ServerDelegate) {
  }

  public loadArchive(path: string) {
    this.addArchive(JSON.parse(fs.readFileSync(path, 'utf8')));
  }

  public addArchive(har: HAR) {
    this.addArchiveEntries(har.log.entries);
  }

  public addArchiveEntries(entries: HAR.Entry[]) {
    for (let i = 0; i < entries.length; i++) {
      this.addArchiveEntry(entries[i]);
    }
  }

  public addArchiveEntry(entry: HAR.Entry) {
    let key = this.delegate.keyForArchiveEntry(entry);
    if (!key) return;

    let statusCode = entry.response.status;

    let response: Response | undefined;
    if (statusCode >= 200 && statusCode < 300) {
      let { content } = entry.response;
      let { text, encoding } = content;
      let body: Buffer;
      if (encoding === 'base64') {
        body = new Buffer(text, 'base64');
      } else {
        if (this.delegate.textFor) {
          text = this.delegate.textFor(entry, key, text);
        }
        body = new Buffer(text);
      }
      let headers;
      if (content.compression && content.compression > 0) {
        body = zlib.gzipSync(body, {
          level: 9
        });
        headers = {
          'Content-Encoding': 'gzip',
          'Content-Length': '' + body.byteLength,
          'Content-Type': content.mimeType
        };
      } else {
        headers = {
          'Content-Length': '' + body.byteLength,
          'Content-Type': content.mimeType
        };
      }
      response = {
        statusCode, headers, body, next: undefined
      };
    } else {
      if (this.delegate.responseFor) {
        response = this.delegate.responseFor(entry, key);
      }
    }
    if (response) {
      if (this.delegate.finalizeResponse) {
        response = this.delegate.finalizeResponse(entry, key, response);
      }
      this.addResponse(key, response);
    }
  }

  public addResponse(key: string, response: Response) {
    console.log(`add:  ${key}`);
    let res = this.responses[key];
    if (res) {
      while (res.next) {
        res = res.next;
      }
      res.next = response;
    } else {
      this.responses[key] = response;
    }
  }

  public responseFor(key: string): Response | undefined {
    let res = this.responses[key];
    if (res && res.next) {
      this.responses[key] = res.next;
    }
    return res;
  }

  public handle(request: http.IncomingMessage, response: http.ServerResponse) {
    let key = this.delegate.keyForServerRequest(request);
    if (key) {
      let res = this.responseFor(key);
      if (res) {
        console.log(`hit:  ${key}`);
        response.writeHead(res.statusCode, res.headers);
        response.end(res.body);
      } else {
        console.log(`miss: ${key}`);
      }
    }

    if (this.delegate.missingResponse && !response.headersSent) {
      this.delegate.missingResponse(request, response);
    }

    if (!response.headersSent) {
      response.writeHead(404);
      response.end();
    }

    console.log(response.statusCode, request.method, request.url)
  }

  public createServer(): http.Server {
    return http.createServer((req, res) => this.handle(req, res));
  }
}

export interface MapLike<T> {
  [key: string]: T | undefined;
}

function createMap<T>(): MapLike<T> {
  let map: MapLike<T> = Object.create(null);
  map["__"] = undefined;
  delete map["__"];
  return map;
}

export interface HAR {
  log: HAR.Log
}

export namespace HAR {
  export interface Log {
    version: string;
    entries: Entry[];
  }

  export interface Entry {
    request: Request;
    response: Response;
  }

  export interface Request {
    method: string;
    url: string;
    httpVersion: string;
    cookies: {
      name: string;
      value: string;
      expires: string;
      httpOnly: boolean;
      secure: boolean;
    }[];
    headers: {
      name: string;
      value: string;
    }[];
    queryString: {
      name: string;
      value: string;
    }[];
    postData?: {
      mimeType: string;
      text: string;
      params?: {
        name: string;
        value?: string;
        fileName?: string;
        contentType?: string;
      }[];
    };
    headersSize: number;
    bodySize: number;
  }

  export interface Response {
    status: number;
    statusText: string;
    httpVersion: string;
    cookies: {
      name: string;
      value: string;
      path: string;
      domain: string;
      expires: string;
      httpOnly: boolean;
      secure: boolean;
    }[];
    headers: {
      name: string;
      value: string;
    }[];
    content: Content;
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  }

  export interface Content {
    size: number;
    compression?: number;
    mimeType: string;
    text: string;
    encoding?: string;
  }
}
