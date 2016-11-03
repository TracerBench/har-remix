# har-remix

Easily serve HAR archive with loose matching and alterations.

You can save a HAR archive with content from the Network tab of Chrome by right clicking the recorded responses.

```
import HARRemix from "har-remix";
import * as url from "url";

let harRemix = new HARRemix({
  keyForArchiveEntry(entry) {
    let { request, response } = entry;
    let { status } = response;
    if (status >= 200 && status < 300 && request.method !== 'OPTIONS') {
      return request.method + url.parse(request.url).path;
    }
  },

  keyForServerRequest(req) {
    return req.method + req.url;
  },

  textFor(entry, key, text) {
    if (key === 'GET/') {
      return text.replace(/my-cdn.com/, 'localhost:6789');
    }
    return text;
  }
});

harRemix.loadArchive('my-site.com/har');

harRemix.createServer().listen(6789);
```
