// const roomid = "YOUR_ROOM_ID";
// const cookieDomain = ".your-domain.com";

const bypassExtensions = [
  "bmp",
  "ejs",
  "jpeg",
  "pdf",
  "ps",
  "ttf",
  "class",
  "eot",
  "jpg",
  "pict",
  "svg",
  "webp",
  "css",
  "eps",
  "js",
  "pls",
  "svgz",
  "woff",
  "csv",
  "gif",
  "mid",
  "png",
  "swf",
  "woff2",
  "doc",
  "ico",
  "midi",
  "ppt",
  "tif",
  "xls",
  "docx",
  "jar",
  "otf",
  "pptx",
  "tiff",
  "xlsx",
];

const skippers = [
  createBotSkipper(),
  createExtensionSkipper(bypassExtensions),
  Not(createHTTPMethodSkipper("GET")),
];

exports.handler = async (event, context) => {
  return await handleRequest(event.Records[0].cf.request);
};

async function postData(url = "", data = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "user-agent": "cloudflare-worker-roomq",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  return response.json();
}

const COOKIE_NAME = `noq-cf-${roomid}-token`;
const QUERY_PARAM = "noq_t";
const STATUS_API = "https://roomq.noqstatus.com/api/rooms/";

function getCookie(request, name) {
  let result = "";
  const cookieString = request.headers["cookie"]?.[0]?.value;
  if (cookieString) {
    const cookies = cookieString.split(";");
    cookies.forEach((cookie) => {
      const cookieName = cookie.split("=")[0].trim();
      if (cookieName === name) {
        const cookieVal = cookie.split("=")[1];
        result = cookieVal;
      }
    });
  }
  return result;
}

async function getStatusAPI(roomid) {
  try {
    const response = await fetch(
      `${STATUS_API}${roomid}?q=${Math.round(
        new Date().getTime() / 1000 / 60
      )}`,
      {
        method: "GET",
        headers: {
          "user-agent": "cloudflare-worker-roomq",
          "Content-Type": "application/json",
        },
      }
    );
    return response.json();
  } catch (e) {
    console.log(e.toString());

    return null;
  }
}

async function getRoomQServer(roomid) {
  try {
    const result = await getStatusAPI(roomid);
    if (result && result.backend) {
      return result.backend;
    } else {
      // Room is removed
      return null;
    }
  } catch (e) {
    return null;
  }
}

async function shouldRedirect(
  from,
  ip,
  userAgent,
  cookie,
  method,
  endpoint,
  id
) {
  try {
    return await postData(`https://${endpoint}/queue/${roomid}`, {
      action: "beep",
      client_id: roomid,
      ip,
      id: id,
      from: from,
      userAgent: userAgent,
      request_cookie: cookie,
      request_method: method,
    });
  } catch (e) {
    return { vd: 0 };
  }
}

function getFullURL(request) {
  let url = `https://${request.headers.host[0].value}${request.uri}`;
  if (request.querystring) {
    url += `?${request.querystring}`;
  }
  return url;
}

function removeNoQToken(request) {
  const url = getFullURL(request);
  return url.replace(new RegExp("(" + "noq_[^&]*" + "=[^&]*)(&?)", "gi"), "");
}

function getTokenFromRequest(request) {
  // grep from query string
  const urlParams = new URLSearchParams(request.querystring);
  let id = urlParams.get(QUERY_PARAM);
  if (!id || id === "undefined") {
    // grep from cookie
    id = getCookie(request, COOKIE_NAME);
  }
  return id === "undefined" ? null : id;
}

function generateRedirectResponse(url) {
  const headers = {
    location: [
      {
        key: "Location",
        value: url,
      },
    ],
  };
  const response = {
    status: "302",
    statusDescription: "Found",
    headers,
  };
  return response;
}

function generateQueuingResponse(url) {
  const headers = {
    location: [
      {
        key: "Location",
        value: url,
      },
    ],
    "cache-control": [
      {
        key: "Cache-Control",
        value: "no-cache, no-store, must-revalidate, max-age=0",
      },
    ],
    expires: [
      {
        key: "Expires",
        value: "Fri, 01 Jan 1990 00:00:00 GMT",
      },
    ],
  };
  const response = {
    status: "302",
    statusDescription: "Found",
    headers,
  };
  return response;
}

function attachNoQToken(request, id) {
  if (id) {
    if (cookieDomain) {
      request.headers["set-cookie"] = [
        {
          key: "Set-Cookie",
          value: `${COOKIE_NAME}=${id}; Max-Age=${
            60 * 60 * 12
          }; Path=/; domain=${cookieDomain}`,
        },
      ];
    } else {
      request.headers["set-cookie"] = [
        {
          key: "Set-Cookie",
          value: `${COOKIE_NAME}=${id}; Max-Age=${60 * 60 * 12}; Path=/`,
        },
      ];
    }
  }
}

async function handleRequest(request) {
  const skip = await processSkippers(request);
  if (skip) {
    request.headers["X-NOQ-CLIENT"] = [
      { key: "X-NOQ-CLIENT", value: "LAMBDA" },
    ];
    request.headers["X-NOQ-SKIP"] = [{ key: "X-NOQ-SKIP", value: "SKIPPER" }];
    request.headers["X-NOQ-ROOM"] = [{ key: "X-NOQ-ROOM", value: roomid }];
    return request;
  }

  // Skip removed room
  let endpoint = await getRoomQServer(roomid);
  if (!endpoint) {
    request.headers["X-NOQ-CLIENT"] = [
      { key: "X-NOQ-CLIENT", value: "LAMBDA" },
    ];
    request.headers["X-NOQ-SKIP"] = [{ key: "X-NOQ-SKIP", value: "NO-ROOM" }];
    request.headers["X-NOQ-ROOM"] = [{ key: "X-NOQ-ROOM", value: roomid }];
    return request;
  }

  let id = getTokenFromRequest(request);
  const requestUrlWithoutToken = removeNoQToken(request);
  const url = getFullURL(request);

  try {
    const {
      id: newId,
      vd,
      waiting_room_url: waitingRoomUrl,
    } = await shouldRedirect(
      url,
      request.clientIp,
      request.headers["user-agent"]?.[0]?.value,
      request.headers["cookie"]?.[0]?.value,
      request.method,
      endpoint,
      id
    );
    attachNoQToken(request, newId);
    if (vd % 2 === 1) {
      let aurl = `${waitingRoomUrl}?${QUERY_PARAM}=${newId}&c=${roomid}&noq_r=${encodeURIComponent(
        requestUrlWithoutToken
      )}`;
      if (!newId) {
        aurl = `${waitingRoomUrl}?c=${roomid}&noq_r=${encodeURIComponent(
          requestUrlWithoutToken
        )}`;
      }
      return generateQueuingResponse(aurl);
    } else {
      if (url !== requestUrlWithoutToken) {
        // remove token => redirect
        return generateRedirectResponse(requestUrlWithoutToken);
      } else {
        // no need to queue
        return request;
      }
    }
  } catch (e) {
    console.log("ERROR:" + e);
    request.headers["X-NOQ-CLIENT"] = [
      { key: "X-NOQ-CLIENT", value: "LAMBDA" },
    ];
    return request;
  }
}

async function processSkippers(request) {
  try {
    for (let skipper of skippers) {
      if (await skipper(request)) {
        return true;
      }
    }
  } catch (e) {}
  return false;
}

function And(...skippers) {
  return function (request) {
    for (let skipper of skippers) {
      if (skipper(request)) {
        return true;
      }
    }
    return false;
  };
}

function Not(skipper) {
  return function (request) {
    return !skipper(request);
  };
}

function createBotSkipper() {
  const botPattern =
    "googlebot|adsbot|facebookexternalhit|Bingbot|BingPreview|bot|spider|whatsapp";

  return async function (request) {
    const userAgent = request.headers["User-Agent"]?.[0]?.value ?? "";
    const re = new RegExp(botPattern, "i");
    if (re.test(userAgent)) {
      console.log("the user agent is a crawler!");
      const ip = request.clientIp;

      const response = await fetch(
        "https://asia-east2-room-queue.cloudfunctions.net/roomq-bot-checker",
        {
          method: "post",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ip, userAgent, roomId: roomid }),
        }
      );
      const json = await response.json();
      return json.isGoodBot;
    } else {
      return false;
    }
  };
}

function createHTTPMethodSkipper(method) {
  return function (request) {
    return request.method === method;
  };
}

function createExtensionSkipper(exts) {
  function getExtension(url) {
    return url.split(/[#?]/)[0].split(".").pop().trim().toLowerCase();
  }

  return function (request) {
    const extension = getExtension(request.url);
    const skip = exts.includes(extension);
    return skip;
  };
}

function createHeaderSkipper(header, value) {
  return function (request) {
    if (typeof value === "string") {
      return request.headers.get(header) === value;
    } else {
      return value.test(request.headers.get(header));
    }
  };
}

function createURLSkipper(url) {
  return function (request) {
    return url.test(request.url);
  };
}
